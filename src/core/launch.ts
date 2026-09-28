import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unarchiveSession } from "./actions.ts";
import type { SessionRecord } from "./index.ts";

export interface LaunchRequest {
  session: SessionRecord;
  fork: boolean;
}

/** Runs `claude --resume` in the session's original cwd, since Claude Code looks sessions up by project. */
export function launchClaude({ session, fork }: LaunchRequest): number {
  if (session.archived) unarchiveSession(session);
  let cwd = session.cwd;
  if (!existsSync(cwd)) {
    process.stderr.write(`csm: ${cwd} no longer exists; resuming from ${process.cwd()} instead.\n`);
    cwd = process.cwd();
  }
  const args = ["--resume", session.id, ...(fork ? ["--fork-session"] : [])];
  const claude = process.env.CSM_CLAUDE_BIN || "claude";
  const result = spawnSync(claude, args, { cwd, stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`csm: failed to run ${claude}: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 0;
}
