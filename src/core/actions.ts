import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SessionRecord } from "./index.ts";
import { loadMeta, saveMeta } from "./meta.ts";
import { parseTranscript } from "./parse.ts";
import { archiveDir, claudeDir, projectsDir, shortPath } from "./paths.ts";

function assertIdle(s: SessionRecord) {
  if (s.running) throw new Error("Session is open in a running Claude Code process; close it first.");
}

/** Same entry `/rename` writes, so the title shows up in the built-in /resume picker too. */
export function renameSession(s: SessionRecord, title: string) {
  assertIdle(s);
  appendFileSync(s.file, JSON.stringify({ type: "custom-title", customTitle: title.trim(), sessionId: s.id }) + "\n");
}

/** Same entry the built-in session tag writes; an empty tag clears it. */
export function tagSession(s: SessionRecord, tag: string) {
  assertIdle(s);
  appendFileSync(s.file, JSON.stringify({ type: "tag", tag: tag.trim(), sessionId: s.id }) + "\n");
}

/** Moves the .jsonl plus its sibling <id>/ dir (tool results, subagents) between projects/ and the csm archive. */
function moveSession(s: SessionRecord, toRoot: string) {
  const destDir = join(toRoot, s.projectDir);
  mkdirSync(destDir, { recursive: true });
  const siblingDir = join(dirname(s.file), s.id);
  if (existsSync(siblingDir)) renameSync(siblingDir, join(destDir, s.id));
  renameSync(s.file, join(destDir, basename(s.file)));
}

export function archiveSession(s: SessionRecord) {
  assertIdle(s);
  if (!s.archived) moveSession(s, archiveDir());
}

export function unarchiveSession(s: SessionRecord) {
  if (s.archived) moveSession(s, projectsDir());
}

export function deleteSession(s: SessionRecord) {
  assertIdle(s);
  rmSync(join(dirname(s.file), s.id), { recursive: true, force: true });
  rmSync(join(claudeDir(), "file-history", s.id), { recursive: true, force: true });
  rmSync(s.file, { force: true });
  const meta = loadMeta();
  if (meta.stars[s.id]) {
    delete meta.stars[s.id];
    saveMeta(meta);
  }
}

export function sessionToMarkdown(s: SessionRecord): string {
  const lines = [
    `# ${s.title}`,
    "",
    `- **Session:** \`${s.id}\``,
    `- **Project:** \`${shortPath(s.cwd)}\`${s.gitBranch ? ` (branch \`${s.gitBranch}\`)` : ""}`,
    `- **Dates:** ${new Date(s.created).toISOString()} → ${new Date(s.updated).toISOString()}`,
    ...(s.model ? [`- **Model:** ${s.model}`] : []),
    "",
  ];
  for (const item of parseTranscript(s.file)) {
    lines.push(`## ${item.role === "user" ? "User" : "Assistant"}`, "");
    if (item.text) lines.push(item.text, "");
    for (const t of item.tools) lines.push(`> 🔧 ${t}`);
    if (item.tools.length) lines.push("");
  }
  return lines.join("\n");
}

export function exportSession(s: SessionRecord, outFile?: string): string {
  const file = outFile ?? join(process.cwd(), `claude-session-${s.id.slice(0, 8)}.md`);
  writeFileSync(file, sessionToMarkdown(s));
  return file;
}
