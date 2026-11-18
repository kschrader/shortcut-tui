import { doubled } from "./far-from-its-subject.test.ts";
import { rules } from "../../../plugin.ts";

export const count = doubled + Object.keys(rules).length;
