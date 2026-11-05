# shortcut-tui

A terminal client for [Shortcut](https://www.shortcut.com). It lists your open stories and shows the selected story's details, comments, and labels.

Built on [OpenTUI](https://github.com/anomalyco/opentui) 0.8 and the Shortcut REST API v4 through [`@shortcut/client/v4`](https://www.npmjs.com/package/@shortcut/client).

## Run it

1. Install [Bun](https://bun.sh).
2. Create a Shortcut API v4 token. A v4 token starts with `sct_`; older v3 tokens do not work. A read-only token (`sct_r_...`) is enough to browse; moving stories needs a read-write token.
3. Put the token in `.env.local` in this directory. Git ignores the file.

   ```
   SHORTCUT_API_TOKEN=sct_r_...
   ```

4. Install and start:

   ```sh
   bun install
   bun start
   ```

To try the app without a token, run `bun start --demo`.

To start it from any directory, link the launcher onto your `PATH`:

```sh
ln -s "$PWD/bin/shortcut-tui" ~/.local/bin/shortcut-tui
shortcut-tui            # or: shortcut-tui --demo
```

The launcher runs from this directory, so `.env.local` is always found.

## Pull request status

Each story that links pull requests shows a merge status after its name. The detail pane lists every linked pull request with its number, status, and title. Shortcut supplies the links; GitHub supplies the status through the [`gh` CLI](https://cli.github.com), so install it and run `gh auth login` once. Without `gh`, the app still works and the status bar says how to set it up. When `gh` is logged in but cannot see any linked repository, for example because single sign-on is not authorized for its token, the status bar shows GitHub's error. A query that fails or takes longer than 20 seconds affects only its own pull requests. When every query fails, the status bar shows the first error.

For a pull request GitHub does not answer, including links to other hosts such as GitLab, the badge uses what Shortcut records: closed, then draft, otherwise unknown. Shortcut cannot tell merged from closed, so a merged GitLab merge request shows as closed.

The app asks Shortcut for at most 6 stories' pull requests at a time and runs at most 4 `gh` queries at once. If Shortcut cannot list one story's pull requests, that story shows `? unknown`, its detail pane shows the error, and the status bar counts the stories that failed. The whole load fails only when every story fails.

A story shows the status of its least ready open pull request. An unknown link counts as open, because Shortcut records it as open. When none is open, the story shows merged if any was merged, otherwise closed.

| Badge | Meaning |
| --- | --- |
| `≠ conflicts` | The branch conflicts with its base |
| `✗ CI failing` | A required check failed or errored |
| `! changes` | A reviewer requested changes |
| `↓ behind` | The branch must be updated from its base before merging |
| `◌ draft` | The pull request is a draft |
| `○ review` | A review is required before merging, or the `review-gate` check is waiting for approval |
| `⊟ blocked` | A branch rule other than review blocks merging, such as unresolved conversations or required signed commits |
| `◔ CI running` | Required checks are still running |
| `? unknown` | Open, with no status from GitHub. The link is not a GitHub pull request, `gh` cannot see it, the query failed or timed out, GitHub was still computing mergeability after a second look, or Shortcut could not list the story's pull requests. Press `r` to ask again; that does not help for links to other hosts or pull requests `gh` cannot see |
| `✓ ready` | GitHub reports the pull request can be merged |
| `◉ merged` | Merged into any base branch, as GitHub's `MERGED` state reports. This need not be the repository's default branch |
| `⊘ closed` | Closed without merging |

CI failing and CI running count only the checks that the branch rules require. When GitHub's overall check status is failing or pending and that could decide the badge, the app asks GitHub for every check on the pull request and whether it is required, 100 checks per query page. A check that is not required never makes the badge failing or running. The detail pane names the ones that failed under the pull request, for example `optional check failing: pr-preview`. A `review-gate` check in progress means the pull request is waiting for approval, so it shows `○ review` even when it is a required check. Conflicts and a failed required check still take precedence. If GitHub cannot list a pull request's checks, its badge falls back to the overall status: any failed check counts as failing, and any pending check counts as running.

In narrow terminals the badge shows only its symbol. Press `?` for the same legend in the app.

Under each pull request, the detail pane says who it asks for review and who has reviewed it, for example `review requested from you (via engineering), @andreas`, `approved by @priya · changes requested by @sam`, or `no review requested`. To tell which requests are yours, the app asks GitHub for your login and for your teams in each organization, once each while it runs, and only when a pull request asks someone for review. Reading teams needs the `read:org` scope, which `gh auth login` grants by default. If GitHub does not answer, requests to your login still count, team requests read `could not tell which are for you` and do not mark the row, and the next refresh asks again.

## Moving stories

Press `m` on a story to move it to another state in its workflow. The list shows the story in its new group at once with a `⟳ saving` marker, then replaces it with the story Shortcut returns. If Shortcut refuses the move, the story goes back to the state Shortcut last reported, the row shows `✗ failed`, and the bottom bar shows the error with `m to retry`. Picking the state the story is already in does nothing.

Moves to one story are sent one at a time. Picking again while a move is saving records a single pending intent (the latest pick wins), which is sent when the saving move settles. Moves to different stories run in parallel. A refresh that races with a move cannot roll the story back: results that load while a move is saving show the picked state, and results from a search sent before the move settled keep the moved state. `spec/StoryMoves.tla` model checks these rules; see Checks.

Moving needs a read-write token. With a read-only token (`sct_r_...`, whose whoami scopes are only `read`) `m` opens a notice explaining that and sends nothing.

## Auto-refresh

The app refreshes on its own every 60 seconds, the same as pressing `r`, so stories and pull request badges keep up with changes made in Shortcut and GitHub. Each refresh is one Shortcut search plus one `gh` call per story with pull requests, well below the rate limits of both. The selected story stays selected. A refresh is skipped while you edit the query, pick a state, or read help or the read-only notice, and while a search or pull request status is still loading. The next interval tries again. Any search, including `r` and a new query, restarts the countdown.

The app also refreshes when you switch back to its terminal, if the shown results are at least 30 seconds old, so switching windows back and forth does not repeat the search. The same skips apply. This needs a terminal that reports focus changes; most modern terminals do. It still works with auto-refresh turned off.

While a refresh is out, the list, the badges, and the selected story's details stay on screen and the header says `loading…`. Every key keeps working on the shown list. The answer replaces the list when it arrives. A story that had a badge keeps it until GitHub answers again; a story with no badge yet shows `… checking`. If the refresh fails, the list stays, the story count takes the warning color, and the bottom bar says `✗ Refresh failed  ·  r to retry` with the error. A detail that fails to reload keeps its body and reports the failure above it. Only the first load of a query shows the full-screen loading and failure views.

To change the interval, set `SHORTCUT_TUI_REFRESH_SECONDS` in the environment or in `.env.local`. Set it to `0` to turn auto-refresh off.

```sh
SHORTCUT_TUI_REFRESH_SECONDS=120 bun start
```

The value must be a whole number of seconds from 0 to 2147483, about 24 days. Any other value stops the app at startup with a message.

The status bar ends with how long ago the results loaded, such as `↻ 2m ago`. The age updates once a minute. It stays while a refresh is out, because it describes the list still on screen. It is hidden until the first results load, and in a terminal too narrow to show it after every key hint.

## Changed stories

After a refresh, a story that changed since you last looked at it gets an accent `•` in the left gutter of its row, and the header adds a count, such as `4 stories  ·  1 updated`. A story counts as changed when it is new to the list, its workflow state changed, its pull request status changed, or its Shortcut update time moved for another reason, such as a rename, an owner or description edit, or possibly a comment. A pull request status counts only when GitHub answered both times. A status that is still loading, a failed load, and `? unknown` are not changes. A move you make yourself is not a change.

Selecting a story clears its mark. While it stays selected, the detail pane says what changed, for example `Changed since you last looked: state In Progress → In Review`, including changes that arrive while you look. When you move on, the app records the story as it was at that moment. The first results for a new query or filter mark nothing, because you have not seen them before. Marks are kept in memory only, so each start begins with none. In `--demo`, a teammate moves one of your stories on the first refresh, so press `r` to see a mark.

## Keys

| Key | Action |
| --- | --- |
| `j` / `k`, arrows | Move the selection |
| `/` | Edit the search query. `enter` searches, `esc` cancels. A changed query shows the loading screen; the same query refreshes in place |
| `f` | Switch to the next filter: your started stories, then team stories waiting for review, then team stories whose pull requests merged but which never moved, then back. From a typed query, `f` starts at your started stories. The header names the filter in place of the query |
| `a` | Show only stories that have been in their current state for 4 weeks or more. Press `a` again to show every story. The header adds `· 4w+` while it is on, and it stays on when you press `f` or search |
| `r` | Refresh the results, the selected story, and pull request status. The shown list stays until the answer arrives. Also restarts the auto-refresh countdown |
| `o` | Open the selected story in the browser |
| `y` | Copy the selected story's link. The bottom bar says whether it was copied |
| `p` | Open the pull request that sets the story's badge: the least ready open one, otherwise the newest merged or closed one. Does nothing until pull request status has loaded |
| `m` | Move the selected story to another state. `j` / `k` choose, `enter` moves, `esc` cancels |
| `?` | Show every key, the mouse actions, and the badge legend. `?` or `esc` closes it |
| `pgup` / `pgdn` | Scroll the detail pane |
| `q`, `ctrl-c` | Quit. `ctrl-c` also quits from the query editor and the help overlay |
| Click a story | Select it, the same as moving the selection onto it with `j` / `k` |
| Drag the line between the panes | Resize the list and the detail pane. Each keeps at least 30 columns when the terminal has room. The width lasts until you quit |

The story URL and each pull request URL in the detail pane are terminal hyperlinks. In a terminal that supports OSC 8, cmd-click or ctrl-click one to open it. The app captures the mouse, so you cannot select the URL to copy it; press `y` instead. On macOS, `y` copies with `pbcopy`, and the bottom bar reports whether `pbcopy` succeeded. `y` also sends the link through OSC 52, so copying works over SSH in terminals that allow it. Elsewhere `y` relies on OSC 52 alone, and the bottom bar says the terminal has no clipboard access only when the terminal reports that it does not support OSC 52.

The default query is `owner:<you> is:started !is:archived`, which shows your in-progress stories. Press `/` to change it, for example to `owner:<you> !is:done` to include unstarted stories. Stories are sorted by workflow state, with states further right in the workflow at the top. Started states come before unstarted ones, which keeps stories from different workflows in a sensible order. Stories in the same state are sorted with the most recently updated first. A divider above each group shows the state, its story count, and its workflow. The query uses Shortcut's [search operators](https://help.shortcut.com/hc/en-us/articles/360000046646-Search-Operators).

The review filter shows stories in any workflow state with "review" in its name, such as "Ready for Review" or "In Review", in every workflow. It leaves out stories you own and archived stories. Shortcut search cannot match several states in one query, so the app runs one search per review state and merges the answers. The review filter groups stories by owner instead of by state, and a story with several owners appears once, under a group that names all of them, such as `Priya Shah + Sam Okafor`. Pressing `/` from the review filter starts an empty query.

Every row shows how long the story has been in its current state, such as `5h`, `3d`, or `2w`. In the review filter, each engineer's longest-waiting story comes first. A row gets an accent `@` before its type when one of its open pull requests asks for your review, either by your GitHub login or through one of your GitHub teams in the pull request's organization. A pull request you wrote never counts. The header counts these stories, such as `2 stories  ·  1 for you`. The mark appears once GitHub answers. In every view, the detail pane's State line says how long the story has been in that state, such as `In Review for 3 days`.

The merged, not moved filter shows started stories that look finished but were never moved: stories whose linked pull requests are all merged or closed, with at least one merged. It covers every owner, you included, and every workflow, and leaves out archived stories. A story whose pull requests were only closed is left out, because closed without merging usually means abandoned work. Shortcut search cannot tell merged from closed, so the app searches for started stories that link a pull request and asks GitHub through `gh` for each one's status. The list shows `Checking 12 stories' pull requests…` until GitHub answers, and says the filter needs GitHub if `gh` cannot answer at all. A story whose own pull requests could not be read is left out. Like the review filter, it groups stories by owner with each engineer's longest-waiting story first. Pressing `/` from it starts an empty query. To clean up, press `m` on each story to move it, one story at a time. The filter itself never moves anything.

Press `a` to show only stories that have been in their current state for 4 weeks or more, by when they last moved, the same clock as the review view's waiting times. It works on any view: your started stories, the review filter, the merged filter, or a typed query. Shortcut search applies it. The app adds `moved:*..<date>` to each query, where the date is the calendar day 28 days before you pressed `a`. A story that moved on that day counts, and a refresh keeps the same date.

## Checks

`bun run check` runs everything below. CI and local runs use the same commands.

| Command | What it checks |
| --- | --- |
| `bun run lint` | oxlint (type-aware) and oxfmt, including the project rules in `lint/` |
| `bun run type-check` | TypeScript 7 |
| `bun test` | Unit, frame, and interleaving tests, plus a fixture test for each project lint rule |
| `bun run tlc` | TLA+ model checks in `spec/`: the story-browser state machine with its auto-refresh guard and its rule that a refresh never hides shown data (`StoryBrowser.tla`), and the story-move protocol (`StoryMoves.tla`), each with deliberately broken configurations that TLC must reject |
| `bun run tlc:big` | A larger TLA+ model, with no pull request links so it stays at about 18 minutes |
| `bun run smoke` | Read-only calls to the live API with your token |

`bun run tlc` needs Java and the TLA+ tools. Download [`tla2tools.jar` v1.7.4](https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar) to `spec/tools/`. It must be the stable v1.7.4 release: the v1.8.0 prerelease is rebuilt in place, so it cannot be pinned by checksum. Git ignores that directory.

## Project rules

The lint config enforces these rules. `no-comments` is the founding rule. `switch-on-discriminant` and `paginate-v4-lists` came from defects found while building, and their fixtures in `lint/fixtures/<rule>/` reproduce those defects. `opentui-text-placement` guards a documented OpenTUI pitfall.

| Rule | Enforced by |
| --- | --- |
| No comments. Use a better name or a test | `shortcut-tui/no-comments` |
| Branch on a union with a `switch`, so new variants fail type-check | `shortcut-tui/switch-on-discriminant` |
| Read every page of a v4 list | `shortcut-tui/paginate-v4-lists` |
| Read keys through `keyBindings` in `src/ui/keys.ts`, so help and the hint bar match the handler | `shortcut-tui/keys-from-table` |
| Put text only inside `<text>` | `shortcut-tui/opentui-text-placement` |
| No `console` output. It corrupts the screen | `no-console` |
| No `process.exit`. Destroy the renderer so the terminal is restored | `unicorn/no-process-exit` |
| Parse API data at the boundary | `typescript/no-unsafe-*` |

When you find a defect, add a lint rule against it if a lint can detect it. Otherwise add a test that fails on it.
