import { readFileSync, statSync } from "node:fs";
import { basename, dirname } from "node:path";
import { decodeProjectDir } from "./paths.ts";

export type TitleSource = "custom" | "ai" | "prompt" | "none";

export interface SessionMeta {
  id: string;
  file: string;
  projectDir: string;
  cwd: string;
  gitBranch?: string;
  created: number;
  updated: number;
  title: string;
  titleSource: TitleSource;
  firstPrompt?: string;
  lastPrompt?: string;
  tag?: string;
  agentName?: string;
  continuedIn?: string;
  messageCount: number;
  replyCount: number;
  model?: string;
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
  costUSD?: number;
  filesTouched: string[];
  size: number;
  mtime: number;
}

export interface TranscriptItem {
  role: "user" | "assistant";
  text: string;
  tools: string[];
  timestamp?: string;
}

type Entry = Record<string, any>;

export function* readEntries(file: string): Generator<Entry> {
  const raw = readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object") yield entry;
    } catch {
      // Tolerate truncated or partially written lines.
    }
  }
}

const COMMAND_RE = /<command-name>([^<]*)<\/command-name>[\s\S]*?(?:<command-args>([^<]*)<\/command-args>)?/;

/** The human-typed text of a user entry, or undefined for tool results, meta and system-injected messages. */
export function userText(entry: Entry): string | undefined {
  if (entry.type !== "user" || entry.isMeta || entry.isCompactSummary || entry.isSidechain) return;
  const content = entry.message?.content;
  let text: string | undefined;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === "tool_result")) return;
    text = content.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  }
  text = text?.trim();
  if (!text) return;
  const cmd = text.match(COMMAND_RE);
  if (cmd) return `${cmd[1]}${cmd[2] ? " " + cmd[2] : ""}`.trim();
  if (text.startsWith("<")) return; // local-command-stdout, caveats, reminders
  return text;
}

const TOOL_ARG_KEYS = ["command", "file_path", "pattern", "path", "url", "query", "description", "prompt"];

export function summarizeToolUse(block: Entry): string {
  const input = block.input ?? {};
  const key = TOOL_ARG_KEYS.find((k) => typeof input[k] === "string");
  const arg = key ? String(input[key]).split("\n")[0]!.slice(0, 120) : "";
  return arg ? `${block.name}: ${arg}` : String(block.name);
}

const oneLine = (s: string, max = 200) => s.replace(/\s+/g, " ").trim().slice(0, max);

export function parseSessionMeta(file: string): SessionMeta {
  const st = statSync(file);
  const projectDir = basename(dirname(file));
  const meta: SessionMeta = {
    id: basename(file, ".jsonl"),
    file,
    projectDir,
    cwd: "",
    created: 0,
    updated: 0,
    title: "",
    titleSource: "none",
    messageCount: 0,
    replyCount: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    filesTouched: [],
    size: st.size,
    mtime: st.mtimeMs,
  };
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let relocatedCwd: string | undefined;
  const files = new Set<string>();
  const seenAssistantIds = new Set<string>();

  for (const e of readEntries(file)) {
    if (e.timestamp && !e.isSidechain) {
      const t = Date.parse(e.timestamp);
      if (!Number.isNaN(t)) {
        if (!meta.created || t < meta.created) meta.created = t;
        if (t > meta.updated) meta.updated = t;
      }
    }
    switch (e.type) {
      case "custom-title":
        customTitle = e.customTitle || undefined;
        break;
      case "ai-title":
        aiTitle = e.aiTitle || undefined;
        break;
      case "tag":
        meta.tag = e.tag || undefined;
        break;
      case "agent-name":
        meta.agentName = e.agentName || undefined;
        break;
      case "last-prompt":
        if (e.lastPrompt) meta.lastPrompt = oneLine(e.lastPrompt);
        break;
      case "relocated":
        relocatedCwd = e.relocatedCwd;
        break;
      case "continued-in":
        meta.continuedIn = e.continuedInSessionId;
        break;
      case "cost-state":
        if (typeof e.totalCostUSD === "number") meta.costUSD = e.totalCostUSD;
        break;
      case "user": {
        if (e.isSidechain) break;
        if (!meta.cwd && e.cwd) meta.cwd = e.cwd;
        if (e.gitBranch) meta.gitBranch = e.gitBranch;
        const text = userText(e);
        if (text) {
          meta.messageCount++;
          // Prefer the first real prompt over leading slash commands like /model.
          if (!meta.firstPrompt || (meta.firstPrompt.startsWith("/") && !text.startsWith("/"))) meta.firstPrompt = oneLine(text);
        }
        break;
      }
      case "assistant": {
        if (e.isSidechain) break;
        if (!meta.cwd && e.cwd) meta.cwd = e.cwd;
        const msg = e.message ?? {};
        if (msg.model && msg.model !== "<synthetic>") meta.model = msg.model;
        // One API message is written as several entries (one per content block) sharing message.id.
        if (msg.id && !seenAssistantIds.has(msg.id)) {
          seenAssistantIds.add(msg.id);
          meta.messageCount++;
          meta.replyCount++;
          const u = msg.usage ?? {};
          meta.tokens.input += u.input_tokens ?? 0;
          meta.tokens.output += u.output_tokens ?? 0;
          meta.tokens.cacheRead += u.cache_read_input_tokens ?? 0;
          meta.tokens.cacheCreate += u.cache_creation_input_tokens ?? 0;
        }
        for (const b of Array.isArray(msg.content) ? msg.content : []) {
          if (b?.type === "tool_use" && typeof b.input?.file_path === "string" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name)) {
            files.add(b.input.file_path);
          }
        }
        break;
      }
    }
  }

  meta.cwd = relocatedCwd || meta.cwd || decodeProjectDir(projectDir);
  meta.filesTouched = [...files];
  if (!meta.updated) meta.updated = st.mtimeMs;
  if (!meta.created) meta.created = meta.updated;
  if (customTitle) [meta.title, meta.titleSource] = [customTitle, "custom"];
  else if (aiTitle) [meta.title, meta.titleSource] = [aiTitle, "ai"];
  else if (meta.firstPrompt) [meta.title, meta.titleSource] = [meta.firstPrompt, "prompt"];
  else meta.title = "(empty session)";
  return meta;
}

export function parseTranscript(file: string): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const e of readEntries(file)) {
    if (e.isSidechain) continue;
    if (e.type === "user") {
      const text = userText(e);
      if (text) items.push({ role: "user", text, tools: [], timestamp: e.timestamp });
    } else if (e.type === "assistant") {
      const content = Array.isArray(e.message?.content) ? e.message.content : [];
      const text = content.filter((b: Entry) => b?.type === "text").map((b: Entry) => b.text).join("\n").trim();
      const tools = content.filter((b: Entry) => b?.type === "tool_use").map(summarizeToolUse);
      if (!text && !tools.length) continue;
      const last = items.at(-1);
      if (last?.role === "assistant") {
        if (text) last.text = last.text ? `${last.text}\n\n${text}` : text;
        last.tools.push(...tools);
      } else {
        items.push({ role: "assistant", text, tools, timestamp: e.timestamp });
      }
    }
  }
  return items;
}
