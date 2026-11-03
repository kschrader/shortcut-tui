---------------------------- MODULE StoryBrowser ----------------------------
(* Mirrors src/app/update.ts. Each operator returns <<model, requests sent>>. *)
(* The network keeps every request ever sent, so any of them can be         *)
(* answered at any time, in any order, any number of times.                 *)
(*                                                                          *)
(* A remote either has nothing to show (absent, firstLoad, failed) or holds *)
(* a value ("loaded") whose reload is idle, in flight, or failed. rid is    *)
(* the one request the remote waits on; answer is the request whose answer *)
(* it last applied.                                                         *)
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
    IdleChecksRequests

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

Absent == [status |-> "absent", reload |-> "idle", rid |-> 0, query |-> NoQuery, stories |-> {}, story |-> NoStory, answer |-> 0]
FirstLoad(rid) == [Absent EXCEPT !.status = "firstLoad", !.rid = rid]
Failed(rid) == [Absent EXCEPT !.status = "failed", !.answer = rid]
NoPullRequests == [Absent EXCEPT !.status = "loaded"]

HasValue(remote) == remote.status = "loaded"
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
Clamp(i, lo, hi) == IF i < lo THEN lo ELSE IF i > hi THEN hi ELSE i

Search(model, q) ==
    LET rid == model.nextRid
        same == HasValue(model.results) /\ model.results.query = q
    IN << [model EXCEPT !.query = q,
                        !.results = IF same THEN Refetch(model.results, rid) ELSE FirstLoad(rid),
                        !.prs = IF same /\ KeepOnRefresh THEN model.prs ELSE NoPullRequests,
                        !.nextRid = rid + 1],
          {Request("search", rid, q, NoStory)} >>

FetchDetail(model, s) ==
    LET rid == model.nextRid
    IN << [model EXCEPT !.details[s] = Refetch(model.details[s], rid), !.nextRid = rid + 1],
          {Request("detail", rid, NoQuery, s)} >>

LoadPullRequests(model, found) ==
    LET linking == found \cap StoriesWithPullRequests
        rid == model.nextRid
        kept == [model.prs EXCEPT !.stories = model.prs.stories \cap linking]
    IN IF linking = {}
       THEN <<[model EXCEPT !.prs = NoPullRequests], {}>>
       ELSE << [model EXCEPT !.prs = Refetch(kept, rid), !.nextRid = rid + 1],
               {PullRequestsRequest(rid, linking)} >>

Select(model, s) ==
    LET picked == [model EXCEPT !.selected = s]
    IN IF s # NoStory /\ NeedsFetch(model.details[s])
       THEN FetchDetail(picked, s)
       ELSE <<picked, {}>>

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
                                           !.stories = found, !.answer = req.rid]]
             selected == Select(loaded, IF model.selected \in found THEN model.selected ELSE FirstOf(found))
             checking == LoadPullRequests(selected[1], found)
         IN <<checking[1], selected[2] \cup checking[2]>>

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

OnPullRequestsLoaded(model, req) ==
    IF ~PullRequestsResponseApplies(model, req) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.prs =
               [Absent EXCEPT !.status = "loaded", !.stories = req.stories, !.answer = req.rid]], {}>>

OnPullRequestsFailed(model, req) ==
    IF ~Awaiting(model.prs, req.rid) THEN <<model, {}>>
    ELSE <<[model EXCEPT !.prs = Fail(model.prs, req.rid)], {}>>

OnSelectionMoved(model, delta) ==
    IF ~HasValue(model.results) \/ model.results.stories = {} THEN <<model, {}>>
    ELSE LET S == model.results.stories
             current == IF model.selected \in S THEN Rank(S, model.selected) ELSE -1
         IN Select(model, At(S, Clamp(current + delta, 0, Cardinality(S) - 1)))

OnStoryClicked(model, s) ==
    IF model.focus.mode # "browsing" \/ ~Shows(model, s) THEN <<model, {}>>
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

Init ==
    /\ m = [ workspace |-> FirstLoad(1),
             query |-> NoQuery,
             results |-> [Absent EXCEPT !.status = "loaded"],
             selected |-> NoStory,
             details |-> [s \in Stories |-> Absent],
             prs |-> NoPullRequests,
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
    \/ \E s \in Stories : Shows(m, s) /\ UserSends(OnStoryClicked(m, s))
    \/ UserSends(OnQueryEditStarted(m))
    \/ \E draft \in Queries \cup {DefaultQuery} : UserSends(OnQueryDraftChanged(m, draft))
    \/ UserSends(OnQueryEditCancelled(m))
    \/ UserSends(OnQuerySubmitted(m))
    \/ UserSends(Refresh(m))
    \/ UserSends(OnHelpOpened(m))
    \/ UserSends(OnHelpClosed(m))

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
                Apply(OnPullRequestsLoaded(m, req)) \/ Apply(OnPullRequestsFailed(m, req))

NetworkAnswers(rid) == \E req \in network : req.rid = rid /\ Answer(req)

(* The timer shares the user's request budget, so it adds interleavings *)
(* without growing the model.                                           *)
TimerFires == UserSends(OnAutoRefreshDue(m))

Next == UserActs \/ TimerFires \/ \E req \in network : Answer(req)

Spec == Init /\ [][Next]_vars /\ \A rid \in RequestIds : WF_vars(NetworkAnswers(rid))

-----------------------------------------------------------------------------

Remote == [status : Statuses, reload : Reloads, rid : RequestIds \cup {MaxRequestId + 1},
           query : AllQueries, stories : SUBSET Stories, story : Stories \cup {NoStory},
           answer : RequestIds \cup {MaxRequestId + 1}]

TypeOK ==
    /\ m.workspace \in Remote
    /\ m.query \in AllQueries
    /\ m.results \in Remote
    /\ m.selected \in Stories \cup {NoStory}
    /\ m.details \in [Stories -> Remote]
    /\ m.prs \in Remote
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
    m.workspace.status # "loaded" => m.query = NoQuery /\ m.focus.mode # "editing"

OnlyEditingHoldsADraft ==
    m.focus.mode # "editing" => m.focus.draft = NoQuery

SelectionIsInResults ==
    HasValue(m.results) =>
        /\ m.selected = NoStory \/ m.selected \in m.results.stories
        /\ m.results.stories # {} => m.selected # NoStory

SelectedStoryHasDetail ==
    m.selected # NoStory => m.details[m.selected].status # "absent"

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
    <>[](m.selected # NoStory => Answered(m.details[m.selected]))

HasBadge(model, s) == HasValue(model.prs) /\ s \in model.prs.stories

(* With the question unchanged, no step hides shown results, a shown detail, *)
(* or a badge on a story that is still shown.                                *)
RefreshNeverHidesShownData ==
    [][m'.query = m.query =>
         /\ HasValue(m.results) => HasValue(m'.results)
         /\ \A s \in Stories : HasValue(m.details[s]) => HasValue(m'.details[s])
         /\ \A s \in Stories : HasBadge(m, s) /\ Shows(m', s) => HasBadge(m', s)]_vars

=============================================================================
