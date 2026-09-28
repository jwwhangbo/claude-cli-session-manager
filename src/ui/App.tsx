import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import TextInput from "ink-text-input";
import { basename } from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { archiveSession, deleteSession, exportSession, renameSession, tagSession, unarchiveSession } from "../core/actions.ts";
import { loadSessions, type SessionRecord } from "../core/index.ts";
import type { LaunchRequest } from "../core/launch.ts";
import { loadMeta, setStarred } from "../core/meta.ts";
import { parseTranscript, type TranscriptItem } from "../core/parse.ts";
import { filterSessions } from "../core/search.ts";
import { buildPreviewLines, Preview } from "./Preview.tsx";
import { SessionList } from "./SessionList.tsx";

type Mode = "list" | "preview" | "search" | "rename" | "tag" | "delete" | "help";

export interface AppProps {
  initialCwd?: string;
  initialQuery?: string;
  onLaunch: (req: LaunchRequest) => void;
}

const HELP: [string, string][] = [
  ["↑↓ / j k", "move            PgUp/PgDn  page    g/G  top/bottom"],
  ["→ l / ← h", "focus the preview pane (↑↓ PgUp/PgDn scroll) / back to the list"],
  ["/", "fuzzy search (title, prompts, project, branch, tag)"],
  ["Enter / f", "resume / fork the session in its original directory"],
  ["Tab / S-Tab", "select and move down / deselect and move up"],
  ["Ctrl+A", "select all visible (again to deselect them)"],
  ["p / b", "filter to this project / this project+branch"],
  ["* / A", "starred only / show archived"],
  ["s", "star          t  tag           r  rename"],
  ["a", "archive (or restore in archive view)"],
  ["d", "delete permanently (type 'delete' to confirm)"],
  ["e", "export transcript to markdown in the current dir"],
  ["R / q", "reload / quit"],
  ["", "s t a d e act on every selected session when there is a selection"],
];

export function App({ initialCwd, initialQuery = "", onLaunch }: AppProps) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions());
  const [stars, setStars] = useState(() => loadMeta().stars);
  const [mode, setMode] = useState<Mode>("list");
  const [query, setQuery] = useState(initialQuery);
  const [cwdFilter, setCwdFilter] = useState<string | undefined>(initialCwd);
  const [branchFilter, setBranchFilter] = useState<string | undefined>();
  const [starredOnly, setStarredOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [cursorId, setCursorId] = useState<string | undefined>();
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const [previewScroll, setPreviewScroll] = useState(0);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | undefined>();
  const [transcript, setTranscript] = useState<{ key: string; items: TranscriptItem[] }>();
  const transcriptCache = useRef(new Map<string, TranscriptItem[]>());

  const visible = useMemo(
    () => filterSessions(sessions, { query, cwd: cwdFilter, branch: branchFilter, starredOnly, showArchived, stars }),
    [sessions, query, cwdFilter, branchFilter, starredOnly, showArchived, stars],
  );
  const cursor = Math.max(0, visible.findIndex((s) => s.id === cursorId));
  const current = visible[cursor];
  // The selection survives filter changes, so bulk actions use every selected session, visible or not.
  const selection = useMemo(() => sessions.filter((s) => marked.has(s.id)), [sessions, marked]);

  // Layout: header + two bordered panes + footer. Narrow terminals show one pane at a time.
  const bodyH = Math.max(3, rows - 4);
  const split = columns >= 90;
  const listW = split ? Math.floor(columns * 0.45) - 2 : columns - 2;
  const previewW = split ? columns - listW - 4 : columns - 2;
  const listOffset = Math.min(Math.max(0, cursor - Math.floor(bodyH / 2)), Math.max(0, visible.length - bodyH));

  const transcriptKey = current ? `${current.file}:${current.mtime}` : "";
  useEffect(() => {
    if (!current) return;
    const cached = transcriptCache.current.get(transcriptKey);
    if (cached) return setTranscript({ key: transcriptKey, items: cached });
    // Debounce so holding ↓ doesn't parse every session it passes.
    const timer = setTimeout(() => {
      let items: TranscriptItem[] = [];
      try {
        items = parseTranscript(current.file);
      } catch {}
      transcriptCache.current.set(transcriptKey, items);
      setTranscript({ key: transcriptKey, items });
    }, 80);
    return () => clearTimeout(timer);
  }, [transcriptKey]);

  const previewLines = useMemo(
    () => (current ? buildPreviewLines(current, transcript?.key === transcriptKey ? transcript.items : undefined, previewW) : []),
    [current, transcript, transcriptKey, previewW],
  );
  const maxScroll = Math.max(0, previewLines.length - bodyH);

  const moveTo = (index: number) => {
    const s = visible[Math.min(Math.max(0, index), visible.length - 1)];
    if (s && s.id !== current?.id) {
      setCursorId(s.id);
      setPreviewScroll(0);
    }
  };

  const mark = (ids: string[], on: boolean) =>
    setMarked((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });

  const reload = (keepId = current?.id) => {
    const fresh = loadSessions();
    setSessions(fresh);
    setStars(loadMeta().stars);
    setCursorId(keepId);
    const ids = new Set(fresh.map((s) => s.id));
    setMarked((prev) => new Set([...prev].filter((id) => ids.has(id))));
  };

  const run = (label: string, fn: () => string | void, keepId = current?.id) => {
    try {
      const msg = fn();
      setStatus({ text: msg || label });
    } catch (err) {
      setStatus({ text: (err as Error).message, error: true });
    }
    reload(keepId);
  };

  /** Applies fn to each target, skipping (and counting) sessions it refuses, e.g. running ones. */
  const runEach = (verb: string, targets: SessionRecord[], fn: (s: SessionRecord) => void, { clear = false, keepId = current?.id } = {}) => {
    let done = 0;
    const errors: string[] = [];
    for (const s of targets) {
      try {
        fn(s);
        done++;
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    const noun = done === 1 ? "session" : "sessions";
    const skipped = errors.length ? ` · skipped ${errors.length}: ${errors[0]}` : "";
    setStatus({ text: `${verb} ${done} ${noun}${skipped}`, error: done === 0 && errors.length > 0 });
    if (clear) setMarked(new Set());
    reload(keepId);
  };

  /** Selected sessions if there is a selection, otherwise the one under the cursor. */
  const targets = () => (selection.length ? selection : current ? [current] : []);

  const neighborId = (leaving: Set<string>) =>
    (visible.slice(cursor).find((s) => !leaving.has(s.id)) ?? visible.slice(0, cursor).reverse().find((s) => !leaving.has(s.id)))?.id;

  const launch = (fork: boolean) => {
    if (!current) return;
    onLaunch({ session: current, fork });
    exit();
  };

  // Esc backs out of any text-entry mode.
  useInput(
    (_, key) => {
      if (key.escape) {
        if (mode === "search") setQuery("");
        setMode("list");
      }
    },
    { isActive: mode === "search" || mode === "rename" || mode === "tag" || mode === "delete" },
  );

  useInput(
    (ch, key) => {
      setStatus(undefined);
      if (mode === "help") return setMode("list");
      if (mode === "preview") {
        if (key.leftArrow || ch === "h" || key.escape || ch === "q") return setMode("list");
        if (key.downArrow || ch === "j") return setPreviewScroll((s) => Math.min(maxScroll, s + 1));
        if (key.upArrow || ch === "k") return setPreviewScroll((s) => Math.max(0, s - 1));
        if (key.pageDown || ch === " ") return setPreviewScroll((s) => Math.min(maxScroll, s + bodyH - 2));
        if (key.pageUp) return setPreviewScroll((s) => Math.max(0, s - bodyH + 2));
        if (ch === "g") return setPreviewScroll(0);
        if (ch === "G") return setPreviewScroll(maxScroll);
        if (key.return) return launch(false);
        return;
      }

      if (key.downArrow || ch === "j") return moveTo(cursor + 1);
      if (key.upArrow || ch === "k") return moveTo(cursor - 1);
      if (key.pageDown) return moveTo(cursor + bodyH);
      if (key.pageUp) return moveTo(cursor - bodyH);
      if (ch === "g" || key.home) return moveTo(0);
      if (ch === "G" || key.end) return moveTo(visible.length - 1);
      if (ch === "q") return exit();
      if (key.escape) {
        if (marked.size) setMarked(new Set());
        else if (query) setQuery("");
        else if (cwdFilter || branchFilter || starredOnly) {
          setCwdFilter(undefined);
          setBranchFilter(undefined);
          setStarredOnly(false);
        } else exit();
        return;
      }
      if (ch === "/") return setMode("search");
      if (ch === "?") return setMode("help");
      if (key.rightArrow || ch === "l") return current && setMode("preview");
      if (ch === "*") return setStarredOnly((v) => !v);
      if (ch === "A") return setShowArchived((v) => !v);
      if (ch === "R") return reload(), setStatus({ text: "Reloaded" });
      if (key.ctrl && ch === "a") {
        const allMarked = visible.length > 0 && visible.every((s) => marked.has(s.id));
        return mark(visible.map((s) => s.id), !allMarked);
      }
      if (!current) return;
      if (key.tab) {
        mark([current.id], !key.shift);
        return moveTo(cursor + (key.shift ? -1 : 1));
      }
      if (key.return) return launch(false);
      if (ch === "f") return launch(true);
      if (ch === "p") {
        setBranchFilter(undefined);
        return setCwdFilter((c) => (c ? undefined : current.cwd));
      }
      if (ch === "b") {
        const on = !branchFilter && current.gitBranch;
        setCwdFilter(on ? current.cwd : undefined);
        return setBranchFilter(on ? current.gitBranch : undefined);
      }
      if (ch === "r") return setInput(current.titleSource === "custom" ? current.title : ""), setMode("rename");

      const list = targets();
      if (ch === "s") {
        const star = !list.every((s) => stars[s.id]);
        setStarred(list.map((s) => s.id), star);
        setStars(loadMeta().stars);
        return setStatus({ text: `${star ? "Starred" : "Unstarred"} ${list.length} ${list.length === 1 ? "session" : "sessions"}` });
      }
      if (ch === "t") {
        const tags = new Set(list.map((s) => s.tag ?? ""));
        return setInput(tags.size === 1 ? [...tags][0]! : ""), setMode("tag");
      }
      if (ch === "d") return setInput(""), setMode("delete");
      if (ch === "e") {
        if (list.length === 1) return run("Exported", () => `Exported to ${exportSession(list[0]!)}`);
        return runEach("Exported", list, (s) => void exportSession(s));
      }
      if (ch === "a") {
        // In the archive view `a` restores; otherwise it archives. Sessions already in the target state are left alone.
        const movable = list.filter((s) => s.archived === showArchived);
        const leaving = new Set(movable.map((s) => s.id));
        if (showArchived) return runEach("Restored", movable, unarchiveSession, { clear: true, keepId: neighborId(leaving) });
        return runEach("Archived", movable, archiveSession, { clear: true, keepId: neighborId(leaving) });
      }
    },
    { isActive: mode === "list" || mode === "preview" || mode === "help" },
  );

  const submitInput = (value: string) => {
    setMode("list");
    if (!current) return;
    const list = targets();
    if (mode === "rename" && value.trim()) run("Renamed", () => renameSession(current, value));
    if (mode === "tag") runEach(value.trim() ? `Tagged #${value.trim()}:` : "Cleared tag on", list, (s) => tagSession(s, value));
    if (mode === "delete") {
      if (value === "delete") runEach("Deleted", list, deleteSession, { clear: true, keepId: neighborId(new Set(list.map((s) => s.id))) });
      else setStatus({ text: "Delete cancelled" });
    }
  };

  const filters = [
    cwdFilter && `project:${basename(cwdFilter)}`,
    branchFilter && `branch:${branchFilter}`,
    starredOnly && "★ only",
    showArchived && "ARCHIVE",
  ].filter(Boolean);

  if (mode === "help") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold>csm — Claude Code session manager</Text>
        <Text> </Text>
        {HELP.map(([k, v]) => (
          <Text key={k + v}>
            <Text color="cyan">{k.padEnd(12)}</Text>
            {v}
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>▶ selected · ★ starred · ● open in a running Claude Code · bold title = renamed. Press any key.</Text>
      </Box>
    );
  }

  const count = selection.length;
  const many = count > 0 ? `${count} selected ${count === 1 ? "session" : "sessions"}` : "";
  const inputPrompt = {
    search: "/",
    rename: "Rename: ",
    tag: count ? `Tag ${many} (empty clears): #` : "Tag (empty clears): #",
    delete: `Type 'delete' to permanently remove ${count ? many : "this session"}: `,
  }[mode as string];

  return (
    <Box flexDirection="column" height={rows}>
      <Box>
        <Text bold color="cyan">csm </Text>
        <Text dimColor>
          {visible.length}/{sessions.filter((s) => s.archived === showArchived).length} sessions
        </Text>
        {count > 0 && <Text color="cyan" bold> · {count} selected</Text>}
        {filters.length > 0 && <Text color="yellow"> [{filters.join(" · ")}]</Text>}
        {query && mode !== "search" && <Text color="magenta"> /{query}</Text>}
      </Box>
      <Box>
        {(split || mode !== "preview") && (
          <SessionList sessions={visible} selected={cursor} offset={listOffset} height={bodyH} width={listW} stars={stars} marked={marked} focused={mode !== "preview"} />
        )}
        {(split || mode === "preview") && current && (
          <Preview lines={previewLines} scroll={Math.min(previewScroll, maxScroll)} height={bodyH} width={previewW} focused={mode === "preview"} />
        )}
      </Box>
      <Box>
        {inputPrompt !== undefined ? (
          <>
            <Text color={mode === "delete" ? "red" : "cyan"}>{inputPrompt}</Text>
            {mode === "search" ? (
              <TextInput value={query} onChange={(v) => (setQuery(v), setCursorId(undefined))} onSubmit={() => setMode("list")} />
            ) : (
              <TextInput value={input} onChange={setInput} onSubmit={submitInput} />
            )}
          </>
        ) : status ? (
          <Text color={status.error ? "red" : "green"} wrap="truncate">
            {status.text}
          </Text>
        ) : (
          <Text dimColor wrap="truncate">
            {mode === "preview"
              ? "↑↓/PgUp/PgDn scroll · g/G top/bottom · Enter resume · ←/h back"
              : count > 0
                ? `${count} selected: s star · t tag · a ${showArchived ? "restore" : "archive"} · d delete · e export · Esc clear · Tab/S-Tab select/deselect`
                : "Enter resume · f fork · / search · Tab select · →/l preview · s star · r rename · a archive · d delete · ? help · q quit"}
          </Text>
        )}
      </Box>
    </Box>
  );
}
