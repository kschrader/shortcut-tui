# shortcut-tui

A terminal client for [Shortcut](https://www.shortcut.com). It lists your open stories and shows the selected story's details, comments, and labels.

Built on [OpenTUI](https://github.com/anomalyco/opentui) 0.8 and the Shortcut REST API v4 through [`@shortcut/client/v4`](https://www.npmjs.com/package/@shortcut/client).

## Run it

1. Install [Bun](https://bun.sh).
2. Create a Shortcut API v4 token. A v4 token starts with `sct_`; older v3 tokens do not work. A read-only token (`sct_r_...`) is enough.
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

## Keys

| Key | Action |
| --- | --- |
| `j` / `k`, arrows | Move the selection |
| `/` | Edit the search query. `enter` searches, `esc` cancels |
| `r` | Refresh the results and the selected story |
| `o` | Open the selected story in the browser |
| `pgup` / `pgdn` | Scroll the detail pane |
| `q`, `ctrl-c` | Quit |

The default query is `owner:<you> !is:done !is:archived`. Stories are sorted by workflow state, with states further right in the workflow at the top. Started states come before unstarted ones, which keeps stories from different workflows in a sensible order. Stories in the same state are sorted with the most recently updated first. The query uses Shortcut's [search operators](https://help.shortcut.com/hc/en-us/articles/360000046646-Search-Operators).

## Checks

`bun run check` runs everything below. CI and local runs use the same commands.

| Command | What it checks |
| --- | --- |
| `bun run lint` | oxlint (type-aware) and oxfmt, including the project rules in `lint/` |
| `bun run type-check` | TypeScript 7 |
| `bun test` | Unit, frame, and interleaving tests, plus a fixture test for each project lint rule |
| `bun run tlc` | TLA+ model checks of the story-browser state machine in `spec/` |
| `bun run tlc:big` | A larger TLA+ model. It takes about 13 minutes |
| `bun run smoke` | Read-only calls to the live API with your token |

`bun run tlc` needs Java and the TLA+ tools. Download [`tla2tools.jar` v1.8.0](https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar) to `spec/tools/`. Git ignores that directory.

## Project rules

The lint config enforces these rules. `no-comments` is the founding rule. `switch-on-discriminant` and `paginate-v4-lists` came from defects found while building, and their fixtures in `lint/fixtures/<rule>/` reproduce those defects. `opentui-text-placement` guards a documented OpenTUI pitfall.

| Rule | Enforced by |
| --- | --- |
| No comments. Use a better name or a test | `shortcut-tui/no-comments` |
| Branch on a union with a `switch`, so new variants fail type-check | `shortcut-tui/switch-on-discriminant` |
| Read every page of a v4 list | `shortcut-tui/paginate-v4-lists` |
| Put text only inside `<text>` | `shortcut-tui/opentui-text-placement` |
| No `console` output. It corrupts the screen | `no-console` |
| No `process.exit`. Destroy the renderer so the terminal is restored | `unicorn/no-process-exit` |
| Parse API data at the boundary | `typescript/no-unsafe-*` |

When you find a defect, add a lint rule against it if a lint can detect it. Otherwise add a test that fails on it.
