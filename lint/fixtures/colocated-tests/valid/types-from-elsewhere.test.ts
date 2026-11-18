import type { Rule } from "../../../plugin.ts";
import { double } from "./subject.ts";

export const ruleCount = (rules: Record<string, Rule>) => double(Object.keys(rules).length);
