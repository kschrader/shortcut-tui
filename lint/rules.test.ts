import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { rules } from "./plugin.ts";

const fixturesRoot = join(import.meta.dir, "fixtures");
const projectRoot = join(import.meta.dir, "..");

const OxlintReport = z.object({
  diagnostics: z.array(z.object({ code: z.string(), filename: z.string() })),
});
const OxlintConfig = z.object({ rules: z.record(z.string(), z.unknown()) });

const lintFixtures = () => {
  const run = Bun.spawnSync(["./node_modules/.bin/oxlint", "--format", "json", "lint/fixtures"], {
    cwd: projectRoot,
  });
  return OxlintReport.parse(JSON.parse(run.stdout.toString())).diagnostics;
};

const diagnostics = lintFixtures();
const configuredRules = OxlintConfig.parse(
  JSON.parse(readFileSync(join(projectRoot, ".oxlintrc.json"), "utf8")),
).rules;

for (const ruleName of Object.keys(rules)) {
  const code = `shortcut-tui(${ruleName})`;
  const filesIn = (kind: "valid" | "invalid") =>
    readdirSync(join(fixturesRoot, ruleName, kind)).map((file) =>
      join("lint/fixtures", ruleName, kind, file),
    );
  const flaggedFiles = new Set(diagnostics.filter((d) => d.code === code).map((d) => d.filename));

  test(`${ruleName} is enabled as an error`, () => {
    expect(configuredRules[`shortcut-tui/${ruleName}`]).toBe("error");
  });

  test(`${ruleName} flags every invalid fixture`, () => {
    const invalid = filesIn("invalid");
    expect(invalid.length).toBeGreaterThan(0);
    expect(invalid.filter((file) => !flaggedFiles.has(file))).toEqual([]);
  });

  test(`${ruleName} passes every valid fixture`, () => {
    const valid = filesIn("valid");
    expect(valid.length).toBeGreaterThan(0);
    expect(valid.filter((file) => flaggedFiles.has(file))).toEqual([]);
  });
}
