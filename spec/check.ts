import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

type Outcome = "pass" | `violation of ${string}`;
type ModelCheck = { cfg: string; tla: string; expect: Outcome; budgetSeconds: number };

const specDir = import.meta.dir;
const projectRoot = join(specDir, "..");
const jar = join(specDir, "tools", "tla2tools.jar");
const jarUrl = "https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar";

const suites: Record<string, readonly ModelCheck[]> = {
  default: [
    { cfg: "StoryBrowser.cfg", tla: "StoryBrowser.tla", expect: "pass", budgetSeconds: 60 },
    {
      cfg: "Naive.cfg",
      tla: "StoryBrowser.tla",
      expect: "violation of ResultsComeFromLatestSearch",
      budgetSeconds: 60,
    },
    {
      cfg: "NaivePullRequests.cfg",
      tla: "StoryBrowser.tla",
      expect: "violation of PullRequestStatusesComeFromLatestLoad",
      budgetSeconds: 60,
    },
  ],
  big: [{ cfg: "Big.cfg", tla: "StoryBrowser.tla", expect: "pass", budgetSeconds: 3600 }],
};

const say = (line: string) => process.stdout.write(`${line}\n`);

const outcomeOf = (exitCode: number, output: string): Outcome | null => {
  const violated =
    /^Error: Invariant (\S+) is violated/m.exec(output) ??
    /^Error: Action property (\S+) is violated/m.exec(output);
  if (violated?.[1] !== undefined) return `violation of ${violated[1]}`;
  if (/^Error: Temporal properties were violated/m.test(output)) {
    return "violation of temporal properties";
  }
  if (/^Error: Deadlock reached/m.test(output)) return "violation of deadlock freedom";
  if (exitCode === 0 && output.includes("Model checking completed. No error has been found.")) {
    return "pass";
  }
  return null;
};

const runModelCheck = ({ cfg, tla, expect, budgetSeconds }: ModelCheck): boolean => {
  const metadir = mkdtempSync(join(tmpdir(), "shortcut-tui-tlc-"));
  const started = performance.now();
  const run = Bun.spawnSync(
    [
      "java",
      "-XX:+UseParallelGC",
      "-cp",
      relative(projectRoot, jar),
      "tlc2.TLC",
      "-workers",
      "auto",
      "-cleanup",
      "-noGenerateSpecTE",
      "-metadir",
      metadir,
      "-config",
      relative(projectRoot, join(specDir, cfg)),
      relative(projectRoot, join(specDir, tla)),
    ],
    { cwd: projectRoot, stdout: "pipe", stderr: "pipe", timeout: budgetSeconds * 1000 },
  );
  rmSync(metadir, { recursive: true, force: true });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const output = run.stdout.toString() + run.stderr.toString();
  const outcome =
    run.exitedDueToTimeout === true
      ? `exceeded its ${String(budgetSeconds)}s budget`
      : outcomeOf(run.exitCode, output);
  const finalCount = /^(\d+) states generated, (\d+) distinct states found/m.exec(output);
  const states =
    finalCount === null
      ? "state count not reported"
      : `${finalCount[1] ?? "?"} generated, ${finalCount[2] ?? "?"} distinct`;
  const ok: boolean = outcome === expect;
  say(
    `${ok ? "ok  " : "FAIL"} ${cfg}: ${outcome ?? `unrecognized TLC result (exit ${String(run.exitCode)})`}, expected ${expect}; ${states} states in ${seconds}s`,
  );
  if (!ok) say(output.split("\n").slice(-40).join("\n"));
  return ok;
};

const suiteName = process.argv[2] ?? "default";
const suite = suites[suiteName];

if (suite === undefined) {
  say(`unknown suite "${suiteName}"; choose one of: ${Object.keys(suites).join(", ")}`);
  process.exitCode = 2;
} else if (!existsSync(jar)) {
  say(`TLC is missing: download ${jarUrl} to spec/tools/`);
  process.exitCode = 1;
} else {
  const failures = suite.filter((check) => !runModelCheck(check)).length;
  if (failures > 0) process.exitCode = 1;
}
