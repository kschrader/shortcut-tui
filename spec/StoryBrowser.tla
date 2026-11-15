---------------------------- MODULE StoryBrowser ----------------------------
(* Mirrors src/app/update.ts. Each operator returns <<model, requests sent>>. *)
(* The network keeps every request ever sent, so any of them can be         *)
(* answered at any time, in any order, any number of times.                 *)
(*                                                                          *)
(* A remote either has nothing to show (absent, firstLoad, failed) or holds *)
(* a value ("loaded") whose reload is idle, in flight, or failed. rid is    *)
(* the one request the remote waits on; answer is the request whose answer *)
(* it last applied. cached marks results read from the startup cache file  *)
(* rather than from a search answer.                                        *)
EXTENDS Integers, FiniteSets

CONSTANTS
    Stories,
    Queries,
    DefaultQuery,
    MaxUserRequests,
    MaxRequestId,
    StoriesWithPullRequests,
    CheckSearchRequestId,
    CheckPullRequestsRequestId,
    GuardAutoRefresh,
    KeepOnRefresh,
    KeepOnFailure,
    IdleChecksRequests,
    MergedQueries,
    SelectFromShownRows,
    FollowLeavingRow,
    StartsWithoutCache,
    CachedLists,
    RefuseMovesOnCache

NoStory == 0
NoQuery == ""

VARIABLES m, network, userRequests

vars == <<m, network, userRequests>>

Statuses == {"absent", "firstLoad", "loaded", "failed"}
Reloads == {"idle", "inFlight", "failed"}
AllQueries == Queries \cup {DefaultQuery, NoQuery}
RequestIds == 0..MaxRequestId

Request(kind, rid, q, s) == [kind |-> kind, rid |-> rid, query |-> q, story |-> s, stories |-> {}]
PullRequestsRequest(rid, S) == [kind |-> "prs", rid |-> rid, query |-> NoQuery, story |-> NoStory, stories |-> S]

Absent == [status |-> "absent", reload |-> "idle", rid |-> 0, query |-> NoQuery, stories |-> {}, merged |-> {}, story |-> NoStory, answer |-> 0, cached |-> FALSE]
FirstLoad(rid) == [Absent EXCEPT !.status = "firstLoad", !.rid = rid]
Failed(rid) == [Absent EXCEPT !.status = "failed", !.answer = rid]
NoPullRequests == [Absent EXCEPT !.status = "loaded"]

HasValue(remote) == remote.status = "loaded"
ShowsCachedList(model) == HasValue(model.results) /\ model.results.cached
Awaited(remote) ==
    IF remote.status = "firstLoad" \/ (HasValue(remote) /\ remote.reload = "inFlight")
    THEN remote.rid ELSE 0
InFlight(remote) == Awaited(remote) # 0
Answered(remote) == remote.status \in {"loaded", "failed"} /\ ~InFlight(remote)
Awaiting(remote, rid) == Awaited(remote) = rid

(* KeepOnRefresh and KeepOnFailure are TRUE in every faithful configuration.   *)
(* FALSE restores the behavior this spec was changed to rule out: a request   *)
(* or a failure replacing the value already shown.                            *)
Refetch(remote, rid) ==
    IF KeepOnRefresh /\ HasValue(remote)
    THEN [remote EXCEPT !.reload = "inFlight", !.rid = rid]
    ELSE FirstLoad(rid)

Fail(remote, rid) ==
    IF KeepOnFailure /\ HasValue(remote)
    THEN [remote EXCEPT !.reload = "failed", !.rid = 0, !.answer = rid]
    ELSE Failed(rid)

NeedsFetch(remote) ==
    remote.status \in {"absent", "failed"} \/ (HasValue(remote) /\ remote.reload = "failed")

FirstOf(S) == IF S = {} THEN NoStory ELSE CHOOSE s \in S : \A t \in S : s <= t
Rank(S, s) == Cardinality({t \in S : t < s})
At(S, i) == CHOOSE s \in S : Rank(S, s) = i
Shows(model, s) == HasValue(model.results) /\ s \in model.results.stories

(* A query in MergedQueries lists only the stories whose latest pull       *)
(* request answer says merged, as the merged-not-moved filter does. A story *)
(* whose confirmed move its search would no longer find has left the rows.  *)
Left(model) == {s \in Stories : model.left[s] # 0}

ShownRows(model) ==
    IF ~HasValue(model.results) THEN {}
    ELSE (IF model.results.query \in MergedQueries
          THEN model.results.stories \cap model.prs.stories \cap model.prs.merged
          ELSE model.results.stories) \ Left(model)

(* SelectFromShownRows is TRUE in every faithful configuration. FALSE      *)
(* selects from every searched story, hidden ones included.                *)
Selectable(model) ==
    IF SelectFromShownRows THEN ShownRows(model)
    ELSE IF HasValue(model.results) THEN model.results.stories ELSE {}

LastOf(S) == IF S = {} THEN NoStory ELSE CHOOSE s \in S : \A t \in S : t <= s

InPlaceOf(rows, s) ==
    IF \E t \in rows : t > s THEN FirstOf({t \in rows : t > s}) ELSE LastOf({t \in rows : t < s})

Clamp(i, lo, hi) == IF i < lo THEN lo ELSE IF i > hi THEN hi ELSE i

Search(model, q) ==
    LET rid == model.nextRid
        same == HasValue(model.results) /\ model.results.query = q
    IN << [model EXCEPT !.query = q,
                        !.results = IF same THEN Refetch(model.results, rid) ELSE FirstLoad(rid),
                        !.selected = IF same \/ ~ShowsCachedList(model)
                                     THEN model.selected ELSE NoStory,
                        !.prs = IF same /\ KeepOnRefresh THEN model.prs ELSE NoPullRequests,
                        !.nextRid = rid + 1],
          {Request("search", rid, q, NoStory)} >>

(* A cached row's id may be stale, so no detail is fetched for it. *)
FetchDetail(model, s) ==
    LET rid == model.nextRid
    IN IF ShowsCachedList(model) THEN <<model, {}>>
       ELSE << [model EXCEPT !.details[s] = Refetch(model.details[s], rid), !.nextRid = rid + 1],
               {Request("detail", rid, NoQuery, s)} >>

LoadPullRequests(model, found) ==
    LET linking == found \cap StoriesWithPullRequests
        rid == model.nextRid
        kept == [model.prs EXCEPT !.stories = model.prs.stories \cap linking,
                                  !.merged = model.prs.merged \cap linking]
    IN IF linking = {}
       THEN <<[model EXCEPT !.prs = NoPullRequests], {}>>
       ELSE << [model EXCEPT !.prs = Refetch(kept, rid), !.nextRid = rid + 1],
               {PullRequestsRequest(rid, linking)} >>

Select(model, s) ==
    LET picked == [model EXCEPT !.selected = s]
    IN IF s # NoStory /\ NeedsFetch(model.details[s])
       THEN FetchDetail(picked, s)
       ELSE <<picked, {}>>

FollowShownRows(model) ==
    LET rows == Selectable(model)
        next == IF model.selected \in rows THEN model.selected ELSE FirstOf(rows)
    IN IF next = model.selected THEN <<model, {}>> ELSE Select(model, next)

(* Shortcut confirmed a move that takes s out of what its search asks for. *)
(* The move took a request id, and searches sent after it is confirmed are *)
(* trusted to say whether s is still found. FollowLeavingRow is TRUE in   *)
(* every faithful configuration. FALSE leaves the selection where it was. *)
OnMoveLeaves(model, s) ==
    LET trust == model.nextRid + 1
        gone == [model EXCEPT !.left[s] = trust, !.nextRid = trust]
    IN IF FollowLeavingRow /\ model.selected = s
       THEN Select(gone, InPlaceOf(ShownRows(gone), s))
       ELSE <<gone, {}>>

Refresh(model) ==
    CASE model.workspace.status = "firstLoad" -> <<model, {}>>
      [] model.workspace.status = "failed" ->
            LET rid == model.nextRid
            IN << [model EXCEPT !.workspace = FirstLoad(rid), !.nextRid = rid + 1],
                  {Request("workspace", rid, NoQuery, NoStory)} >>
      [] OTHER ->
            LET searching == Search(model, model.query)
            IN IF model.selected = NoStory
               THEN searching
               ELSE LET fetching == FetchDetail(searching[1], model.selected)
                    IN <<fetching[1], searching[2] \cup fetching[2]>>

(* IdleChecksRequests is TRUE in every faithful configuration. FALSE reads  *)
(* the status instead, which a reload of a held value never changes.        *)
NotLoading(remote) == IF IdleChecksRequests THEN ~InFlight(remote) ELSE remote.status # "firstLoad"

Idle(model) ==
    /\ model.focus.mode = "browsing"
    /\ NotLoading(model.results)
    /\ NotLoading(model.prs)

OnAutoRefreshDue(model) ==
    IF ~GuardAutoRefresh \/ Idle(model) THEN Refresh(model) ELSE <<model, {}>>

OnWorkspaceLoaded(model, req) ==
    IF ~Awaiting(model.workspace, req.rid) THEN <<model, {}>>
    ELSE Search([model EXCEPT !.workspace = [Absent EXCEPT !.status = "loaded", !.answer = req.rid]],
                DefaultQuery)

OnWorkspaceFailed(model, req) ==
    IF ~Awaiting(model.workspace, req.rid) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.workspace = Fail(model.workspace, req.rid)], {}>>

SearchResponseApplies(model, req) ==
    ~CheckSearchRequestId \/ Awaiting(model.results, req.rid)

OnSearchSucceeded(model, req, found) ==
    IF ~SearchResponseApplies(model, req) THEN <<model, {}>>
    ELSE LET loaded == [model EXCEPT !.results =
                            [Absent EXCEPT !.status = "loaded", !.query = req.query,
                                           !.stories = found, !.answer = req.rid],
                            !.left = [s \in Stories |->
                                IF req.rid >= model.left[s] THEN 0 ELSE model.left[s]]]
             checking == LoadPullRequests(loaded, found)
             rows == Selectable(checking[1])
             selected == Select(checking[1], IF model.selected \in rows THEN model.selected ELSE FirstOf(rows))
         IN <<selected[1], checking[2] \cup selected[2]>>

OnSearchFailed(model, req) ==
    IF ~SearchResponseApplies(model, req) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.results = Fail(model.results, req.rid)], {}>>

OnDetailSucceeded(model, req) ==
    IF ~Awaiting(model.details[req.story], req.rid) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.details[req.story] =
               [Absent EXCEPT !.status = "loaded", !.story = req.story, !.answer = req.rid]], {}>>

OnDetailFailed(model, req) ==
    IF ~Awaiting(model.details[req.story], req.rid) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.details[req.story] = Fail(model.details[req.story], req.rid)], {}>>

PullRequestsResponseApplies(model, req) ==
    ~CheckPullRequestsRequestId \/ Awaiting(model.prs, req.rid)

OnPullRequestsLoaded(model, req, merged) ==
    IF ~PullRequestsResponseApplies(model, req) THEN <<model, {}>>
    ELSE FollowShownRows([model EXCEPT !.prs =
               [Absent EXCEPT !.status = "loaded", !.stories = req.stories, !.merged = merged,
                              !.answer = req.rid]])

OnPullRequestsFailed(model, req) ==
    IF ~Awaiting(model.prs, req.rid) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.prs = Fail(model.prs, req.rid)], {}>>

OnSelectionMoved(model, delta) ==
    IF Selectable(model) = {} THEN <<model, {}>>
    ELSE LET S == Selectable(model)
             current == IF model.selected \in S THEN Rank(S, model.selected) ELSE -1
         IN Select(model, At(S, Clamp(current + delta, 0, Cardinality(S) - 1)))

OnStoryClicked(model, s) ==
    IF model.focus.mode # "browsing" \/ s \notin Selectable(model) THEN <<model, {}>>
    ELSE Select(model, s)

OnQueryEditStarted(model) ==
    IF model.workspace.status # "loaded" \/ model.focus.mode # "browsing" THEN <<model, {}>>
    ELSE <<[model EXCEPT !.focus = [mode |-> "editing", draft |-> model.query]], {}>>

OnQueryDraftChanged(model, draft) ==
    IF model.focus.mode # "editing" THEN <<model, {}>>
    ELSE <<[model EXCEPT !.focus.draft = draft], {}>>

OnQueryEditCancelled(model) ==
    IF model.focus.mode # "editing" THEN <<model, {}>>
    ELSE <<[model EXCEPT !.focus = [mode |-> "browsing", draft |-> NoQuery]], {}>>

OnQuerySubmitted(model) ==
    IF model.focus.mode # "editing" THEN <<model, {}>>
    ELSE Search([model EXCEPT !.focus = [mode |-> "browsing", draft |-> NoQuery]], model.focus.draft)

OnHelpOpened(model) ==
    IF model.focus.mode # "browsing" THEN <<model, {}>>
    ELSE <<[model EXCEPT !.focus = [mode |-> "help", draft |-> NoQuery]], {}>>

OnHelpClosed(model) ==
    IF model.focus.mode # "help" THEN <<model, {}>>
    ELSE <<[model EXCEPT !.focus = [mode |-> "browsing", draft |-> NoQuery]], {}>>

(* RefuseMovesOnCache is TRUE in every faithful configuration. FALSE lets *)
(* m open the picker once the workspace loads, before the first search    *)
(* replaces the cached list.                                              *)
CanMove(model) ==
    /\ model.workspace.status = "loaded"
    /\ RefuseMovesOnCache => ~ShowsCachedList(model)

EmptyStart ==
    [ workspace |-> FirstLoad(1),
      query |-> NoQuery,
      results |-> [Absent EXCEPT !.status = "loaded"],
      selected |-> NoStory,
      details |-> [s \in Stories |-> Absent],
      prs |-> NoPullRequests,
      left |-> [s \in Stories |-> 0],
      focus |-> [mode |-> "browsing", draft |-> NoQuery],
      nextRid |-> 2 ]

(* The cache file holds the last answer to the startup query. *)
CachedStart(S) ==
    [EmptyStart EXCEPT
        !.query = DefaultQuery,
        !.results = [Absent EXCEPT !.status = "loaded", !.query = DefaultQuery, !.stories = S,
                                   !.cached = TRUE],
        !.selected = FirstOf(S)]

Init ==
    /\ \/ StartsWithoutCache /\ m = EmptyStart
       \/ \E S \in CachedLists : m = CachedStart(S)
    /\ network = {Request("workspace", 1, NoQuery, NoStory)}
    /\ userRequests = 0

Apply(step) ==
    /\ m' = step[1]
    /\ network' = network \cup step[2]

UserSends(step) ==
    \/ /\ step[2] = {}
       /\ Apply(step)
       /\ UNCHANGED userRequests
    \/ /\ step[2] # {}
       /\ userRequests < MaxUserRequests
       /\ Apply(step)
       /\ userRequests' = userRequests + 1

UserActs ==
    \/ \E delta \in {-1, 1} : UserSends(OnSelectionMoved(m, delta))
    \/ \E s \in Stories : Shows(m, s) /\ UserSends(OnStoryClicked(m, s))
    \/ UserSends(OnQueryEditStarted(m))
    \/ \E draft \in Queries \cup {DefaultQuery} : UserSends(OnQueryDraftChanged(m, draft))
    \/ UserSends(OnQueryEditCancelled(m))
    \/ UserSends(OnQuerySubmitted(m))
    \/ UserSends(Refresh(m))
    \/ UserSends(OnHelpOpened(m))
    \/ UserSends(OnHelpClosed(m))
    \/ /\ userRequests < MaxUserRequests
       /\ CanMove(m)
       /\ \E s \in ShownRows(m) : Apply(OnMoveLeaves(m, s))
       /\ userRequests' = userRequests + 1

(* Which linked stories GitHub says are merged matters only to a query in    *)
(* MergedQueries, so other queries take one answer and keep the state space. *)
MergedAnswers(req) == IF m.query \in MergedQueries THEN SUBSET req.stories ELSE {{}}

Answer(req) ==
    /\ UNCHANGED userRequests
    /\ CASE req.kind = "workspace" ->
                Apply(OnWorkspaceLoaded(m, req)) \/ Apply(OnWorkspaceFailed(m, req))
         [] req.kind = "search" ->
                \/ \E found \in SUBSET Stories : Apply(OnSearchSucceeded(m, req, found))
                \/ Apply(OnSearchFailed(m, req))
         [] req.kind = "detail" ->
                Apply(OnDetailSucceeded(m, req)) \/ Apply(OnDetailFailed(m, req))
         [] req.kind = "prs" ->
                \/ \E merged \in MergedAnswers(req) : Apply(OnPullRequestsLoaded(m, req, merged))
                \/ Apply(OnPullRequestsFailed(m, req))

NetworkAnswers(rid) == \E req \in network : req.rid = rid /\ Answer(req)

(* The timer shares the user's request budget, so it adds interleavings *)
(* without growing the model.                                           *)
TimerFires == UserSends(OnAutoRefreshDue(m))

Next == UserActs \/ TimerFires \/ \E req \in network : Answer(req)

Spec == Init /\ [][Next]_vars /\ \A rid \in RequestIds : WF_vars(NetworkAnswers(rid))

-----------------------------------------------------------------------------

Remote == [status : Statuses, reload : Reloads, rid : RequestIds \cup {MaxRequestId + 1},
           query : AllQueries, stories : SUBSET Stories, merged : SUBSET Stories,
           story : Stories \cup {NoStory},
           answer : RequestIds \cup {MaxRequestId + 1}, cached : BOOLEAN]

TypeOK ==
    /\ m.workspace \in Remote
    /\ m.query \in AllQueries
    /\ m.results \in Remote
    /\ m.selected \in Stories \cup {NoStory}
    /\ m.details \in [Stories -> Remote]
    /\ m.prs \in Remote
    /\ m.left \in [Stories -> 0..(MaxRequestId + 1)]
    /\ m.focus \in [mode : {"browsing", "editing", "help"}, draft : AllQueries]
    /\ userRequests \in 0..MaxUserRequests

RequestIdsStayInModelBounds == m.nextRid <= MaxRequestId + 1

LatestRid(kind, s) ==
    LET sent == {req.rid : req \in {r \in network : r.kind = kind /\ r.story = s}}
    IN IF sent = {} THEN 0 ELSE CHOOSE rid \in sent : \A other \in sent : other <= rid

ResultsAnswerCurrentQuery ==
    HasValue(m.results) => m.results.query = m.query

(* A value shown during a reload may come from an older request. Once      *)
(* nothing is in flight, what is shown or reported came from the latest.    *)
WorkspaceComesFromLatestLoad ==
    Answered(m.workspace) => m.workspace.answer = LatestRid("workspace", NoStory)

ResultsComeFromLatestSearch ==
    Answered(m.results) => m.results.answer = LatestRid("search", NoStory)

QueryEditingNeedsWorkspace ==
    m.workspace.status # "loaded" =>
        /\ m.query = NoQuery \/ ShowsCachedList(m)
        /\ m.focus.mode # "editing"

OnlyEditingHoldsADraft ==
    m.focus.mode # "editing" => m.focus.draft = NoQuery

SelectionIsShown ==
    HasValue(m.results) =>
        /\ m.selected = NoStory \/ m.selected \in ShownRows(m)
        /\ ShownRows(m) # {} => m.selected # NoStory

SelectedStoryHasDetail ==
    m.selected # NoStory /\ ~ShowsCachedList(m) => m.details[m.selected].status # "absent"

(* A cached list is only ever replaced: it never gets a badge or a detail. *)
CachedListFetchesNothing ==
    ShowsCachedList(m) =>
        /\ \A s \in Stories : m.details[s] = Absent
        /\ m.prs = NoPullRequests

RequestIdsAreUnique ==
    \A a, b \in network : a.rid = b.rid => a = b

LoadingAwaitsMatchingRequest ==
    /\ InFlight(m.workspace) =>
           Request("workspace", Awaited(m.workspace), NoQuery, NoStory) \in network
    /\ InFlight(m.results) =>
           Request("search", Awaited(m.results), m.query, NoStory) \in network
    /\ \A s \in Stories : InFlight(m.details[s]) =>
           Request("detail", Awaited(m.details[s]), NoQuery, s) \in network
    /\ InFlight(m.prs) =>
           /\ HasValue(m.results)
           /\ PullRequestsRequest(Awaited(m.prs), m.results.stories \cap StoriesWithPullRequests) \in network

LoadedDetailMatchesKey ==
    \A s \in Stories : HasValue(m.details[s]) => m.details[s].story = s

DetailComesFromLatestFetch ==
    \A s \in Stories : Answered(m.details[s]) =>
        m.details[s].answer = LatestRid("detail", s)

PullRequestStatusesComeFromLatestLoad ==
    Answered(m.prs) /\ m.prs.answer # 0 =>
        m.prs.answer = LatestRid("prs", NoStory)

(* Kept statuses are pruned to the shown stories when a reload starts, so   *)
(* they can be a strict subset until that reload answers.                    *)
PullRequestStatusesCoverOnlyShownStories ==
    LET shown == IF HasValue(m.results) THEN m.results.stories \cap StoriesWithPullRequests ELSE {}
    IN /\ m.prs.stories \subseteq shown
       /\ (m.prs.reload = "idle" /\ m.prs.answer # 0) => m.prs.stories = shown

PullRequestStatusAlwaysHasAValue == HasValue(m.prs)

EverythingSettles ==
    <>[](/\ ~InFlight(m.workspace)
         /\ ~InFlight(m.results)
         /\ ~InFlight(m.prs)
         /\ \A s \in Stories : ~InFlight(m.details[s]))

(* Spelled out rather than through Idle, so a wrong Idle cannot agree with itself. *)
AutoRefreshWaitsForIdle ==
    [][LET step == OnAutoRefreshDue(m)
       IN (m' = step[1] /\ network' = network \cup step[2] /\ step[2] # {}) =>
            (m.focus.mode = "browsing" /\ ~InFlight(m.results) /\ ~InFlight(m.prs))]_vars

SelectedDetailArrives ==
    <>[](m.selected # NoStory /\ ~ShowsCachedList(m) => Answered(m.details[m.selected]))

HasBadge(model, s) == HasValue(model.prs) /\ s \in model.prs.stories

LeavesNow(s) == m.left[s] = 0 /\ m'.left[s] # 0

(* With the question unchanged, no step hides shown results, a shown detail, *)
(* a badge on a story that is still shown, or a listed row that is still     *)
(* found before GitHub answers again, unless a confirmed move took it out.   *)
RefreshNeverHidesShownData ==
    [][m'.query = m.query =>
         /\ HasValue(m.results) => HasValue(m'.results)
         /\ \A s \in Stories : HasValue(m.details[s]) => HasValue(m'.details[s])
         /\ \A s \in Stories : HasBadge(m, s) /\ Shows(m', s) => HasBadge(m', s)
         /\ \A s \in ShownRows(m) :
                Shows(m', s) /\ m'.prs.answer = m.prs.answer /\ ~LeavesNow(s) =>
                    s \in ShownRows(m')]_vars


CachedListNeverAcceptsAMove ==
    [][ShowsCachedList(m) => \A s \in Stories : ~LeavesNow(s)]_vars

=============================================================================
