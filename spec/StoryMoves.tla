----------------------------- MODULE StoryMoves -----------------------------
(* Mirrors the move protocol in src/app/moves.ts: nextMove for a pick and  *)
(* for a move's answer, and shownAfterRefresh and moveAfterRefresh for a   *)
(* search's answer. Each operator returns <<model, requests sent>>. The    *)
(* network keeps every request ever sent, so any of them can be answered   *)
(* at any time, in any order, any number of times. A move's outcome is     *)
(* fixed, and the server applies it, the first time it is answered; later  *)
(* answers only replay the response. Every story is in every search        *)
(* result.                                                                 *)
(*                                                                         *)
(* With ReadBeforeWrite, Shortcut answers a move in two steps, as the      *)
(* moveStory effect in src/app/effects.ts asks for them: it reads the      *)
(* story, and it writes the story only when the read saw the state the     *)
(* app believed. A teammate can move the story between the two steps.      *)
(* Shortcut has no conditional update, so nothing closes that window.      *)
(* StoryMoves.cfg has no teammates and answers a move in one step. The     *)
(* read in its own step would take that config past its state budget, and  *)
(* TeammateMoves.cfg checks that the read changes nothing until a teammate *)
(* moves a story.                                                          *)
EXTENDS Integers, FiniteSets

CONSTANTS
    Stories,
    States,
    MaxPicks,
    MaxSearches,
    MaxRid,
    Serialize,
    ReadBeforeWrite,
    MaxTeammateMoves

NoStory == 0
NoState == 0
Initial == CHOOSE st \in States : \A other \in States : st <= other

VARIABLES m, server, outcome, network, picks, searches, read, replaced,
          teammateMoves

vars == <<m, server, outcome, network, picks, searches, read, replaced,
          teammateMoves>>

RequestIds == 1..MaxRid
NoSnap == [s \in Stories |-> NoState]

MoveRequest(rid, s, t, known) ==
    [kind |-> "move", rid |-> rid, story |-> s, target |-> t, known |-> known,
     snap |-> NoSnap]
SearchRequest(rid, snap) ==
    [kind |-> "search", rid |-> rid, story |-> NoStory, target |-> NoState,
     known |-> NoState, snap |-> snap]

Slot(status, rid, target, pending, known, trustFrom) ==
    [status |-> status, rid |-> rid, target |-> target, pending |-> pending,
     known |-> known, trustFrom |-> trustFrom]
NoMove == Slot("none", 0, NoState, NoState, NoState, 0)
Saving(rid, target, known, trustFrom) == Slot("saving", rid, target, NoState, known, trustFrom)
Moved(known, trustFrom) == Slot("moved", 0, NoState, NoState, known, trustFrom)
FailedMove(known, trustFrom) == Slot("failed", 0, NoState, NoState, known, trustFrom)

(* Every search re-asks the same question, so results always hold a value *)
(* and only their reload changes.                                           *)
Reloading(rid) == [reload |-> "inFlight", rid |-> rid]
Settled == [reload |-> "idle", rid |-> 0]
ReloadFailed == [reload |-> "failed", rid |-> 0]

Awaiting(results, rid) == results.reload = "inFlight" /\ results.rid = rid

Intent(slot) == IF slot.pending # NoState THEN slot.pending ELSE slot.target
Trusts(slot, rid) == rid >= slot.trustFrom

StartMove(model, s, t, known, trustFrom) ==
    LET rid == model.nextRid
    IN << [model EXCEPT !.display[s] = t,
                        !.move[s] = Saving(rid, t, known, trustFrom),
                        !.nextRid = rid + 1],
          {MoveRequest(rid, s, t, known)} >>

Pick(model, s, t) ==
    LET slot == model.move[s]
    IN IF slot.status = "saving" /\ Serialize
       THEN <<[model EXCEPT !.move[s].pending = t, !.display[s] = t], {}>>
       ELSE StartMove(model, s, t,
                      IF slot.status = "none" THEN model.display[s] ELSE slot.known,
                      IF slot.status = "none" THEN 1 ELSE slot.trustFrom)

Search(model, snap) ==
    LET rid == model.nextRid
    IN << [model EXCEPT !.results = Reloading(rid), !.nextRid = rid + 1],
          {SearchRequest(rid, snap)} >>

ShownAfterSearch(slot, rid, seen) ==
    CASE slot.status = "none" -> seen
      [] slot.status = "saving" -> Intent(slot)
      [] OTHER -> IF Trusts(slot, rid) THEN seen ELSE slot.known

SlotAfterSearch(slot, rid, seen) ==
    CASE slot.status = "none" \/ ~Trusts(slot, rid) -> slot
      [] slot.status = "saving" -> [slot EXCEPT !.known = seen]
      [] OTHER -> NoMove

OnSearchSucceeded(model, req, seen) ==
    IF ~Awaiting(model.results, req.rid) THEN <<model, {}>>
    ELSE << [model EXCEPT
                !.results = Settled,
                !.display = [s \in Stories |-> ShownAfterSearch(model.move[s], req.rid, seen[s])],
                !.move = [s \in Stories |-> SlotAfterSearch(model.move[s], req.rid, seen[s])]],
            {} >>

OnSearchFailed(model, req) ==
    IF ~Awaiting(model.results, req.rid) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.results = ReloadFailed], {}>>

MoveAnswerApplies(model, req) ==
    model.move[req.story].status = "saving" /\ model.move[req.story].rid = req.rid

OnMoveSucceeded(model, req) ==
    IF ~MoveAnswerApplies(model, req) THEN <<model, {}>>
    ELSE LET s == req.story
             slot == model.move[s]
             known == req.target
             trustFrom == model.nextRid
             settled == [model EXCEPT !.display[s] = known, !.move[s] = Moved(known, trustFrom)]
         IN IF slot.pending \notin {NoState, known}
            THEN StartMove(settled, s, slot.pending, known, trustFrom)
            ELSE <<settled, {}>>

OnMoveFailed(model, req) ==
    IF ~MoveAnswerApplies(model, req) THEN <<model, {}>>
    ELSE LET s == req.story
             slot == model.move[s]
         IN IF slot.pending \notin {NoState, slot.known}
            THEN StartMove(model, s, slot.pending, slot.known, slot.trustFrom)
            ELSE << [model EXCEPT !.display[s] = slot.known,
                                  !.move[s] = FailedMove(slot.known, slot.trustFrom)],
                    {} >>

(* The app shows what the read found and sends nothing, the queued pick    *)
(* included: the user picked it against a state that no longer holds.      *)
OnMoveConflicted(model, req, found) ==
    IF ~MoveAnswerApplies(model, req) THEN <<model, {}>>
    ELSE << [model EXCEPT !.display[req.story] = found,
                          !.move[req.story] = FailedMove(found, model.nextRid)],
            {} >>

Init ==
    /\ m = [ display |-> [s \in Stories |-> Initial],
             move |-> [s \in Stories |-> NoMove],
             results |-> Settled,
             nextRid |-> 1 ]
    /\ server = [s \in Stories |-> Initial]
    /\ outcome = [rid \in RequestIds |-> "undecided"]
    /\ network = {}
    /\ picks = 0
    /\ searches = 0
    /\ read = [rid \in RequestIds |-> NoState]
    /\ replaced = [rid \in RequestIds |-> NoState]
    /\ teammateMoves = 0

Apply(step) ==
    /\ m' = step[1]
    /\ network' = network \cup step[2]

(* A pick is allowed while a search is in flight, which is the interleaving *)
(* that keeping results on screen during a refresh opens up.                *)
UserPicks ==
    /\ picks < MaxPicks
    /\ \E s \in Stories : \E t \in States \ {m.display[s]} : Apply(Pick(m, s, t))
    /\ picks' = picks + 1
    /\ UNCHANGED <<server, outcome, searches, read, replaced, teammateMoves>>

UserSearches ==
    /\ searches < MaxSearches
    /\ Apply(Search(m, server))
    /\ searches' = searches + 1
    /\ UNCHANGED <<server, outcome, picks, read, replaced, teammateMoves>>

(* Someone else moves a story in Shortcut. Nothing tells the app.          *)
ATeammateMoves ==
    /\ teammateMoves < MaxTeammateMoves
    /\ \E s \in Stories : \E t \in States \ {server[s]} :
           server' = [server EXCEPT ![s] = t]
    /\ teammateMoves' = teammateMoves + 1
    /\ UNCHANGED <<m, outcome, network, picks, searches, read, replaced>>

(* The server reads each story either when the search was sent or when it  *)
(* is answered, so a response can mix pre-move and post-move states.        *)
AnswerSearch(req) ==
    /\ UNCHANGED <<server, outcome, read, replaced>>
    /\ \/ \E seen \in {f \in [Stories -> States] : \A s \in Stories : f[s] \in {req.snap[s], server[s]}} :
             Apply(OnSearchSucceeded(m, req, seen))
       \/ Apply(OnSearchFailed(m, req))

(* Shortcut answers the read that the app makes before it writes. A story  *)
(* already in the picked state needs no write. A story in the state the    *)
(* app believes goes on to the write. Any other state is a conflict.       *)
ShortcutReads(req) ==
    LET found == server[req.story]
        result == IF found = req.target THEN "ok"
                  ELSE IF found = req.known THEN "undecided" ELSE "conflict"
    IN /\ read' = [read EXCEPT ![req.rid] = found]
       /\ outcome' = [outcome EXCEPT ![req.rid] = result]
       /\ UNCHANGED <<server, replaced>>
       /\ IF result = "ok" THEN Apply(OnMoveSucceeded(m, req))
          ELSE IF result = "conflict"
               THEN Apply(OnMoveConflicted(m, req, found))
               ELSE UNCHANGED <<m, network>>

ShortcutWrites(req) ==
    /\ outcome' = [outcome EXCEPT ![req.rid] = "ok"]
    /\ replaced' = [replaced EXCEPT ![req.rid] = server[req.story]]
    /\ server' = [server EXCEPT ![req.story] = req.target]
    /\ UNCHANGED read
    /\ Apply(OnMoveSucceeded(m, req))

(* Either the read or the write can fail, and the story then stays as it   *)
(* was.                                                                    *)
ShortcutRefuses(req) ==
    /\ outcome' = [outcome EXCEPT ![req.rid] = "fail"]
    /\ read' = [read EXCEPT ![req.rid] = NoState]
    /\ UNCHANGED <<server, replaced>>
    /\ Apply(OnMoveFailed(m, req))

Replay(req) ==
    /\ UNCHANGED <<server, outcome, read, replaced>>
    /\ Apply(IF outcome[req.rid] = "ok" THEN OnMoveSucceeded(m, req)
             ELSE IF outcome[req.rid] = "fail" THEN OnMoveFailed(m, req)
             ELSE OnMoveConflicted(m, req, read[req.rid]))

AnswerMove(req) ==
    IF outcome[req.rid] # "undecided" THEN Replay(req)
    ELSE \/ ShortcutRefuses(req)
         \/ IF ReadBeforeWrite /\ read[req.rid] = NoState
            THEN ShortcutReads(req)
            ELSE ShortcutWrites(req)

Answer(req) ==
    /\ UNCHANGED <<picks, searches, teammateMoves>>
    /\ CASE req.kind = "search" -> AnswerSearch(req)
         [] req.kind = "move" -> AnswerMove(req)

NetworkAnswers(rid) == \E req \in network : req.rid = rid /\ Answer(req)

Next ==
    UserPicks \/ UserSearches \/ ATeammateMoves \/ \E req \in network : Answer(req)

Spec == Init /\ [][Next]_vars /\ \A rid \in RequestIds : WF_vars(NetworkAnswers(rid))

-----------------------------------------------------------------------------

MoveSlots == [status : {"none", "saving", "moved", "failed"},
              rid : {0} \cup RequestIds,
              target : {NoState} \cup States,
              pending : {NoState} \cup States,
              known : {NoState} \cup States,
              trustFrom : 0..(MaxRid + 1)]

Results == [reload : {"idle", "inFlight", "failed"}, rid : {0} \cup RequestIds]

TypeOK ==
    /\ m.display \in [Stories -> States]
    /\ m.move \in [Stories -> MoveSlots]
    /\ m.results \in Results
    /\ server \in [Stories -> States]
    /\ outcome \in [RequestIds -> {"undecided", "ok", "fail", "conflict"}]
    /\ picks \in 0..MaxPicks
    /\ searches \in 0..MaxSearches
    /\ read \in [RequestIds -> {NoState} \cup States]
    /\ replaced \in [RequestIds -> {NoState} \cup States]
    /\ teammateMoves \in 0..MaxTeammateMoves

RequestIdsStayInModelBounds == m.nextRid <= MaxRid + 1

Undecided(s) ==
    {req \in network : req.kind = "move" /\ req.story = s /\ outcome[req.rid] = "undecided"}

DisplayIsIntentWhileSaving ==
    \A s \in Stories : m.move[s].status = "saving" => m.display[s] = Intent(m.move[s])

AtMostOneMoveInFlight ==
    \A s \in Stories : \A a, b \in Undecided(s) : a = b

SavingTracksTheInFlightMove ==
    \A s \in Stories :
        {<<req.rid, req.target>> : req \in Undecided(s)} =
            IF m.move[s].status = "saving"
            THEN {<<m.move[s].rid, m.move[s].target>>}
            ELSE {}

KnownMatchesServer ==
    \A s \in Stories : m.move[s].status # "none" => m.move[s].known = server[s]

SettledDisplayMatchesServer ==
    \A s \in Stories : Undecided(s) = {} => m.display[s] = server[s]

(* While the app is the only one moving stories, the read finds what the   *)
(* app believes, and the rules for the app alone hold with the read in     *)
(* its own step.                                                           *)
ConflictsNeedATeammate ==
    teammateMoves = 0 => \A rid \in RequestIds : outcome[rid] # "conflict"

RulesForTheAppAloneHoldUntilATeammateMoves ==
    teammateMoves = 0 => KnownMatchesServer /\ SettledDisplayMatchesServer

MoveRequests == {req \in network : req.kind = "move"}

(* A write changed a state other than the one the app believed Shortcut    *)
(* held when it sent the move.                                             *)
WroteOverAMove(req) ==
    replaced[req.rid] \notin {NoState, req.known, req.target}

(* What the read gives: a write goes over another move only when that move *)
(* came after the app read the story in the state it believed.             *)
NeverWritesOverAMoveMadeBeforeItsRead ==
    \A req \in MoveRequests : WroteOverAMove(req) => read[req.rid] = req.known

(* What the read cannot give: this fails when a teammate moves the story   *)
(* between the read and the write.                                         *)
NeverWritesOverATeammatesMove ==
    \A req \in MoveRequests : ~WroteOverAMove(req)

EverythingSettles ==
    <>[](/\ m.results.reload # "inFlight"
         /\ \A s \in Stories : m.move[s].status # "saving")

=============================================================================
