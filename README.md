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
| `✗ CI failing` | A check failed or errored |
| `! changes` | A reviewer requested changes |
| `↓ behind` | The branch must be updated from its base before merging |
| `◌ draft` | The pull request is a draft |
| `○ review` | A review is required before merging |
| `⊟ blocked` | A branch rule other than review blocks merging, such as unresolved conversations or required signed commits |
| `◔ CI running` | Checks are still running |
| `? unknown` | Open, with no status from GitHub. The link is not a GitHub pull request, `gh` cannot see it, the query failed or timed out, GitHub was still computing mergeability after a second look, or Shortcut could not list the story's pull requests. Press `r` to ask again; that does not help for links to other hosts or pull requests `gh` cannot see |
| `✓ ready` | GitHub reports the pull request can be merged |
| `◉ merged` | Merged into any base branch, as GitHub's `MERGED` state reports. This need not be the repository's default branch |
| `⊘ closed` | Closed without merging |

In narrow terminals the badge shows only its symbol. Press `?` for the same legend in the app.

## Moving stories

Press `m` on a story to move it to another state in its workflow. The list shows the story in its new group at once with a `⟳ saving` marker, then replaces it with the story Shortcut returns. If Shortcut refuses the move, the story goes back to the state Shortcut last reported, the row shows `✗ failed`, and the bottom bar shows the error with `m to retry`. Picking the state the story is already in does nothing.

Moves to one story are sent one at a time. Picking again while a move is saving records a single pending intent (the latest pick wins), which is sent when the saving move settles. Moves to different stories run in parallel. A refresh that races with a move cannot roll the story back: results that load while a move is saving show the picked state, and results from a search sent before the move settled keep the moved state. `spec/StoryMoves.tla` model checks these rules; see Checks.

Moving needs a read-write token. With a read-only token (`sct_r_...`, whose whoami scopes are only `read`) `m` opens a notice explaining that and sends nothing.

## Auto-refresh

The app refreshes on its own every 5 minutes, the same as pressing `r`, so pull request badges keep up with CI and reviews. The selected story stays selected. A refresh is skipped while you edit the query, pick a state, or read help or the read-only notice, and while a search or pull request status is still loading. The next interval tries again. Any search, including `r` and a new query, restarts the countdown.

To change the interval, set `SHORTCUT_TUI_REFRESH_SECONDS` in the environment or in `.env.local`. Set it to `0` to turn auto-refresh off.

```sh
SHORTCUT_TUI_REFRESH_SECONDS=120 bun start
```

The value must be a whole number of seconds from 0 to 2147483, about 24 days. Any other value stops the app at startup with a message.

The status bar ends with how long ago the results loaded, such as `↻ 2m ago`. The age updates once a minute. It is hidden while results load, and in a terminal too narrow to show it after every key hint.

## Keys

| Key | Action |
| --- | --- |
| `j` / `k`, arrows | Move the selection |
| `/` | Edit the search query. `enter` searches, `esc` cancels |
| `r` | Refresh the results, the selected story, and pull request status. Also restarts the auto-refresh countdown |
| `o` | Open the selected story in the browser |
| `p` | Open the pull request that sets the story's badge: the least ready open one, otherwise the newest merged or closed one. Does nothing until pull request status has loaded |
| `m` | Move the selected story to another state. `j` / `k` choose, `enter` moves, `esc` cancels |
| `?` | Show every key and the badge legend. `?` or `esc` closes it |
| `pgup` / `pgdn` | Scroll the detail pane |
| `q`, `ctrl-c` | Quit. `ctrl-c` also quits from the query editor and the help overlay |

The default query is `owner:<you> is:started !is:archived`, which shows your in-progress stories. Press `/` to change it, for example to `owner:<you> !is:done` to include unstarted stories. Stories are sorted by workflow state, with states further right in the workflow at the top. Started states come before unstarted ones, which keeps stories from different workflows in a sensible order. Stories in the same state are sorted with the most recently updated first. A divider above each group shows the state, its story count, and its workflow. The query uses Shortcut's [search operators](https://help.shortcut.com/hc/en-us/articles/360000046646-Search-Operators).

## Checks

`bun run check` runs everything below. CI and local runs use the same commands.

| Command | What it checks |
| --- | --- |
| `bun run lint` | oxlint (type-aware) and oxfmt, including the project rules in `lint/` |
| `bun run type-check` | TypeScript 7 |
| `bun test` | Unit, frame, and interleaving tests, plus a fixture test for each project lint rule |
| `bun run tlc` | TLA+ model checks in `spec/`: the story-browser state machine with its auto-refresh guard (`StoryBrowser.tla`) and the story-move protocol (`StoryMoves.tla`), each with a deliberately broken configuration that TLC must reject |
| `bun run tlc:big` | A larger TLA+ model, with no pull request links so it stays at about 14 minutes |
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
