---------------------------- MODULE StoryBrowser ----------------------------
(* Mirrors src/app/update.ts. Each operator returns <<model, requests sent>>. *)
(* The network keeps every request ever sent, so any of them can be         *)
(* answered at any time, in any order, any number of times.                 *)
EXTENDS Integers, FiniteSets

CONSTANTS
    Stories,
    Queries,
    DefaultQuery,
    MaxUserRequests,
    MaxRequestId,
    CheckSearchRequestId

NoStory == 0
NoQuery == ""

VARIABLES m, network, userRequests

vars == <<m, network, userRequests>>

Statuses == {"absent", "loading", "loaded", "failed"}
AllQueries == Queries \cup {DefaultQuery, NoQuery}
RequestIds == 0..MaxRequestId

Request(kind, rid, q, s) == [kind |-> kind, rid |-> rid, query |-> q, story |-> s]

Loading(rid) == [status |-> "loading", rid |-> rid, query |-> NoQuery, stories |-> {}, story |-> NoStory, answer |-> 0]
Failed(rid) == [status |-> "failed", rid |-> 0, query |-> NoQuery, stories |-> {}, story |-> NoStory, answer |-> rid]
Absent == [status |-> "absent", rid |-> 0, query |-> NoQuery, stories |-> {}, story |-> NoStory, answer |-> 0]

Awaiting(remote, rid) == remote.status = "loading" /\ remote.rid = rid

FirstOf(S) == IF S = {} THEN NoStory ELSE CHOOSE s \in S : \A t \in S : s <= t
Rank(S, s) == Cardinality({t \in S : t < s})
At(S, i) == CHOOSE s \in S : Rank(S, s) = i
Clamp(i, lo, hi) == IF i < lo THEN lo ELSE IF i > hi THEN hi ELSE i

Search(model, q) ==
    LET rid == model.nextRid
    IN << [model EXCEPT !.query = q, !.results = Loading(rid), !.nextRid = rid + 1],
          {Request("search", rid, q, NoStory)} >>

FetchDetail(model, s) ==
    LET rid == model.nextRid
    IN << [model EXCEPT !.details[s] = Loading(rid), !.nextRid = rid + 1],
          {Request("detail", rid, NoQuery, s)} >>

Select(model, s) ==
    LET picked == [model EXCEPT !.selected = s]
    IN IF s # NoStory /\ model.details[s].status \in {"absent", "failed"}
       THEN FetchDetail(picked, s)
       ELSE <<picked, {}>>

Refresh(model) ==
    CASE model.workspace.status = "loading" -> <<model, {}>>
      [] model.workspace.status = "failed" ->
            LET rid == model.nextRid
            IN << [model EXCEPT !.workspace = Loading(rid), !.nextRid = rid + 1],
                  {Request("workspace", rid, NoQuery, NoStory)} >>
      [] OTHER ->
            LET searching == Search(model, model.query)
            IN IF model.selected = NoStory
               THEN searching
               ELSE LET fetching == FetchDetail(searching[1], model.selected)
                    IN <<fetching[1], searching[2] \cup fetching[2]>>

OnWorkspaceLoaded(model, req) ==
    IF ~Awaiting(model.workspace, req.rid) THEN <<model, {}>>
    ELSE Search([model EXCEPT !.workspace = [Absent EXCEPT !.status = "loaded", !.answer = req.rid]],
                DefaultQuery)

OnWorkspaceFailed(model, req) ==
    IF ~Awaiting(model.workspace, req.rid) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.workspace = Failed(req.rid)], {}>>

SearchResponseApplies(model, req) ==
    ~CheckSearchRequestId \/ Awaiting(model.results, req.rid)

OnSearchSucceeded(model, req, found) ==
    IF ~SearchResponseApplies(model, req) THEN <<model, {}>>
    ELSE LET loaded == [model EXCEPT !.results =
                            [Absent EXCEPT !.status = "loaded", !.query = req.query,
                                           !.stories = found, !.answer = req.rid]]
         IN Select(loaded, IF model.selected \in found THEN model.selected ELSE FirstOf(found))

OnSearchFailed(model, req) ==
    IF ~SearchResponseApplies(model, req) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.results = Failed(req.rid)], {}>>

OnDetailSucceeded(model, req) ==
    IF ~Awaiting(model.details[req.story], req.rid) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.details[req.story] =
               [Absent EXCEPT !.status = "loaded", !.story = req.story, !.answer = req.rid]], {}>>

OnDetailFailed(model, req) ==
    IF ~Awaiting(model.details[req.story], req.rid) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.details[req.story] = Failed(req.rid)], {}>>

OnSelectionMoved(model, delta) ==
    IF model.results.status # "loaded" \/ model.results.stories = {} THEN <<model, {}>>
    ELSE LET S == model.results.stories
             current == IF model.selected \in S THEN Rank(S, model.selected) ELSE -1
         IN Select(model, At(S, Clamp(current + delta, 0, Cardinality(S) - 1)))

OnQueryEditStarted(model) ==
    IF model.workspace.status # "loaded" THEN <<model, {}>>
    ELSE <<[model EXCEPT !.focus = [mode |-> "editing", draft |-> model.query]], {}>>

OnQueryDraftChanged(model, draft) ==
    IF model.focus.mode # "editing" THEN <<model, {}>>
    ELSE <<[model EXCEPT !.focus.draft = draft], {}>>

OnQueryEditCancelled(model) ==
    <<[model EXCEPT !.focus = [mode |-> "browsing", draft |-> NoQuery]], {}>>

OnQuerySubmitted(model) ==
    IF model.focus.mode # "editing" THEN <<model, {}>>
    ELSE Search([model EXCEPT !.focus = [mode |-> "browsing", draft |-> NoQuery]], model.focus.draft)

Init ==
    /\ m = [ workspace |-> Loading(1),
             query |-> NoQuery,
             results |-> [Absent EXCEPT !.status = "loaded"],
             selected |-> NoStory,
             details |-> [s \in Stories |-> Absent],
             focus |-> [mode |-> "browsing", draft |-> NoQuery],
             nextRid |-> 2 ]
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
    \/ UserSends(OnQueryEditStarted(m))
    \/ \E draft \in Queries \cup {DefaultQuery} : UserSends(OnQueryDraftChanged(m, draft))
    \/ UserSends(OnQueryEditCancelled(m))
    \/ UserSends(OnQuerySubmitted(m))
    \/ UserSends(Refresh(m))

Answer(req) ==
    /\ UNCHANGED userRequests
    /\ CASE req.kind = "workspace" ->
                Apply(OnWorkspaceLoaded(m, req)) \/ Apply(OnWorkspaceFailed(m, req))
         [] req.kind = "search" ->
                \/ \E found \in SUBSET Stories : Apply(OnSearchSucceeded(m, req, found))
                \/ Apply(OnSearchFailed(m, req))
         [] req.kind = "detail" ->
                Apply(OnDetailSucceeded(m, req)) \/ Apply(OnDetailFailed(m, req))

NetworkAnswers(rid) == \E req \in network : req.rid = rid /\ Answer(req)

Next == UserActs \/ \E req \in network : Answer(req)

Spec == Init /\ [][Next]_vars /\ \A rid \in RequestIds : WF_vars(NetworkAnswers(rid))

-----------------------------------------------------------------------------

Remote == [status : Statuses, rid : RequestIds \cup {MaxRequestId + 1}, query : AllQueries,
           stories : SUBSET Stories, story : Stories \cup {NoStory}, answer : RequestIds \cup {MaxRequestId + 1}]

TypeOK ==
    /\ m.workspace \in Remote
    /\ m.query \in AllQueries
    /\ m.results \in Remote
    /\ m.selected \in Stories \cup {NoStory}
    /\ m.details \in [Stories -> Remote]
    /\ m.focus \in [mode : {"browsing", "editing"}, draft : AllQueries]
    /\ userRequests \in 0..MaxUserRequests

RequestIdsStayInModelBounds == m.nextRid <= MaxRequestId + 1

LatestRid(kind, s) ==
    LET sent == {req.rid : req \in {r \in network : r.kind = kind /\ r.story = s}}
    IN IF sent = {} THEN 0 ELSE CHOOSE rid \in sent : \A other \in sent : other <= rid

ResultsAnswerCurrentQuery ==
    m.results.status = "loaded" => m.results.query = m.query

WorkspaceComesFromLatestLoad ==
    m.workspace.status \in {"loaded", "failed"} =>
        m.workspace.answer = LatestRid("workspace", NoStory)

ResultsComeFromLatestSearch ==
    m.results.status \in {"loaded", "failed"} =>
        m.results.answer = LatestRid("search", NoStory)

QueryEditingNeedsWorkspace ==
    m.workspace.status # "loaded" => m.query = NoQuery /\ m.focus.mode = "browsing"

SelectionIsInResults ==
    m.results.status = "loaded" =>
        /\ m.selected = NoStory \/ m.selected \in m.results.stories
        /\ m.results.stories # {} => m.selected # NoStory

SelectedStoryHasDetail ==
    m.selected # NoStory => m.details[m.selected].status # "absent"

RequestIdsAreUnique ==
    \A a, b \in network : a.rid = b.rid => a = b

LoadingAwaitsMatchingRequest ==
    /\ m.workspace.status = "loading" =>
           Request("workspace", m.workspace.rid, NoQuery, NoStory) \in network
    /\ m.results.status = "loading" =>
           Request("search", m.results.rid, m.query, NoStory) \in network
    /\ \A s \in Stories : m.details[s].status = "loading" =>
           Request("detail", m.details[s].rid, NoQuery, s) \in network

LoadedDetailMatchesKey ==
    \A s \in Stories : m.details[s].status = "loaded" => m.details[s].story = s

DetailComesFromLatestFetch ==
    \A s \in Stories : m.details[s].status \in {"loaded", "failed"} =>
        m.details[s].answer = LatestRid("detail", s)

EverythingSettles ==
    <>[](/\ m.workspace.status # "loading"
         /\ m.results.status # "loading"
         /\ \A s \in Stories : m.details[s].status # "loading")

SelectedDetailArrives ==
    <>[](m.selected # NoStory => m.details[m.selected].status \in {"loaded", "failed"})

=============================================================================
