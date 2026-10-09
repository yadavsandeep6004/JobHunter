import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const DEBUG_DIR = path.join(ROOT, "debug");
export const EXPORT_DIR = path.join(ROOT, "exports");
export const PROFILE_DIR = path.join(ROOT, ".browser-profile");
export const DB_PATH = path.join(DATA_DIR, "jobs.db");

export interface SearchConfig {
  queries: string[];
  skills: string[];
  minSkillMatches: number;
  hiringSignals: string[];
  exclude: string[];
  /** Stacks you don't work in; a post leading with one needs extra skill matches. */
  otherStacks: string[];
  minSkillsIfOtherStack: number;
  /** Keep a post naming a foreign location only if it also names one of these (India / remote). */
  homeLocations: string[];
  foreignLocations: string[];
  myExperienceYears: number;
  experienceTolerance: number;
  requireContact: boolean;
  firstRunLookbackHours: number;
  maxPostsPerQuery: number;
  stopAfterOldPosts: number;
  delayMs: { min: number; max: number };
  headless: boolean;
  /** ChatGPT tab: start a new chat after this many posts (keeps the context small). */
  chatgpt: { maxPostsPerChat: number; replyTimeoutSec: number; delayMs: { min: number; max: number } };
}

export function loadConfig(): SearchConfig {
  const raw = readFileSync(path.join(ROOT, "config", "search.json"), "utf8");
  return JSON.parse(raw) as SearchConfig;
}
