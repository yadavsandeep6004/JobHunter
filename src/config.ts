import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The project's own Chrome profile (ChatGPT login lives here). */
export const PROFILE_DIR = path.join(ROOT, ".browser-profile");

export interface Settings {
  headless: boolean;
  /** ChatGPT tab: start a new chat after this many posts (keeps the context small). */
  chatgpt: { maxPostsPerChat: number; replyTimeoutSec: number; delayMs: { min: number; max: number } };
}

export function loadConfig(): Settings {
  return JSON.parse(readFileSync(path.join(ROOT, "config", "settings.json"), "utf8")) as Settings;
}
