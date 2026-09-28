// The bundle must run on plain Node, so core code sticks to node:* APIs rather than Bun.*.
import { homedir } from "node:os";
import { join } from "node:path";

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
export const projectsDir = () => join(claudeDir(), "projects");
export const liveSessionsDir = () => join(claudeDir(), "sessions");
export const csmDir = () => join(claudeDir(), "csm");
export const archiveDir = () => join(csmDir(), "archive");
export const indexFile = () => join(csmDir(), "index.json");
export const metaFile = () => join(csmDir(), "meta.json");

/** Claude Code encodes a cwd as its project dir name by replacing every non-alphanumeric char with "-". */
export const encodeProjectDir = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

/** Lossy fallback when a session has no cwd recorded. */
export const decodeProjectDir = (dir: string) => dir.replace(/-/g, "/");

export const shortPath = (p: string) => {
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
};
