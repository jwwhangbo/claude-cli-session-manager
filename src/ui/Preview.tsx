import { Box, Text } from "ink";
import type { SessionRecord } from "../core/index.ts";
import type { TranscriptItem } from "../core/parse.ts";
import { shortPath } from "../core/paths.ts";
import { compactNum, fit, relTime, wrap } from "./format.ts";

export interface Line {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

const MAX_TOOLS_SHOWN = 4;

export function buildPreviewLines(s: SessionRecord, transcript: TranscriptItem[] | undefined, width: number, groups: string[] = []): Line[] {
  const lines: Line[] = [];
  const kv = (k: string, v: string | undefined) => v && lines.push({ text: fit(`${k.padEnd(8)}${v}`, width), dim: false });
  for (const l of wrap(s.title, width)) lines.push({ text: l, bold: true, color: "cyan" });
  kv("id", s.id);
  kv("cwd", shortPath(s.cwd));
  kv("branch", s.gitBranch);
  kv("model", s.model);
  kv("dates", `${new Date(s.created).toLocaleString()} → ${new Date(s.updated).toLocaleString()}`);
  const t = s.tokens;
  kv("tokens", `in ${compactNum(t.input + t.cacheRead + t.cacheCreate)} (cached ${compactNum(t.cacheRead)}) · out ${compactNum(t.output)} · ${s.messageCount} msgs`);
  if (s.costUSD) kv("cost", `$${s.costUSD.toFixed(2)}`);
  kv("tag", s.tag);
  kv("agent", s.agentName);
  kv("groups", groups.join(", ") || undefined);
  kv("next", s.continuedIn && `continued in ${s.continuedIn}`);
  if (s.filesTouched.length) {
    kv("files", `${s.filesTouched.length} edited`);
    for (const f of s.filesTouched.slice(0, 6)) lines.push({ text: fit(`        ${shortPath(f)}`, width), dim: true });
    if (s.filesTouched.length > 6) lines.push({ text: `        … ${s.filesTouched.length - 6} more`, dim: true });
  }
  if (s.running) lines.push({ text: "● open in a running Claude Code session", color: "green" });
  if (s.archived) lines.push({ text: "archived (resuming restores it)", color: "yellow" });
  lines.push({ text: "─".repeat(width), dim: true });

  if (!transcript) {
    lines.push({ text: "loading transcript…", dim: true });
    return lines;
  }
  for (const item of transcript) {
    const user = item.role === "user";
    lines.push({ text: user ? "▌ You" : "▌ Claude", bold: true, color: user ? "yellow" : "magenta" });
    if (item.text) for (const l of wrap(item.text, width)) lines.push({ text: l });
    for (const tool of item.tools.slice(0, MAX_TOOLS_SHOWN)) lines.push({ text: fit(`  ⚙ ${tool}`, width), dim: true });
    if (item.tools.length > MAX_TOOLS_SHOWN) lines.push({ text: `  ⚙ … ${item.tools.length - MAX_TOOLS_SHOWN} more tool calls`, dim: true });
    lines.push({ text: "" });
  }
  return lines;
}

/** Preview for a group header: aggregate stats and the member list. */
export function buildGroupLines(name: string, members: SessionRecord[], width: number): Line[] {
  const lines: Line[] = [{ text: fit(name, width), bold: true, color: "magenta" }];
  const projects = new Set(members.map((s) => s.cwd));
  const out = members.reduce((n, s) => n + s.tokens.output, 0);
  const cost = members.reduce((n, s) => n + (s.costUSD ?? 0), 0);
  const kv = (k: string, v: string) => lines.push({ text: fit(`${k.padEnd(9)}${v}`, width) });
  kv("sessions", String(members.length));
  kv("projects", [...projects].map((p) => shortPath(p)).join(", "));
  if (members.length) kv("age", `oldest ${relTime(Math.min(...members.map((s) => s.created)))} · latest ${relTime(Math.max(...members.map((s) => s.updated)))}`);
  kv("output", `${compactNum(out)} tokens${cost ? ` · $${cost.toFixed(2)}` : ""}`);
  lines.push({ text: "─".repeat(width), dim: true });
  for (const s of members) {
    lines.push({ text: fit(s.title, width), bold: s.titleSource === "custom" });
    lines.push({ text: fit(`  ${shortPath(s.cwd)}${s.gitBranch ? ` · ${s.gitBranch}` : ""} · ${relTime(s.updated)} · ${s.messageCount} msgs`, width), dim: true });
  }
  return lines;
}

export function Preview({ lines, scroll, height, width, focused }: { lines: Line[]; scroll: number; height: number; width: number; focused: boolean }) {
  const visible = lines.slice(scroll, scroll + height);
  return (
    <Box flexDirection="column" width={width + 2} height={height + 2} borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={0}>
      {visible.map((l, i) => (
        <Text key={i} wrap="truncate" color={l.color} bold={l.bold} dimColor={l.dim}>
          {l.text || " "}
        </Text>
      ))}
    </Box>
  );
}
