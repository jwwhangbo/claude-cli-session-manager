import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import TextInput from "ink-text-input";
import { basename } from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { archiveSession, deleteSession, exportSession, renameSession, tagSession, unarchiveSession } from "../core/actions.ts";
import { loadSessions, type SessionRecord } from "../core/index.ts";
import type { LaunchRequest } from "../core/launch.ts";
import { loadMeta, toggleStar } from "../core/meta.ts";
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

const HELP = [
  ["↑↓ / j k", "move            PgUp/PgDn  page    g/G  top/bottom"],
  ["/", "fuzzy search (title, prompts, project, branch, tag)"],
  ["Enter / f", "resume / fork the session in its original directory"],
  ["Tab", "focus the preview pane (↑↓ PgUp/PgDn scroll)"],
  ["p / b", "filter to this project / this project+branch"],
  ["* / A", "starred only / show archived"],
  ["s", "star          t  tag           r  rename"],
  ["a", "archive (or restore in archive view)"],
  ["d", "delete permanently (type 'delete' to confirm)"],
  ["e", "export transcript to markdown in the current dir"],
  ["R / q", "reload / quit"],
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
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [previewScroll, setPreviewScroll] = useState(0);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | undefined>();
  const [transcript, setTranscript] = useState<{ key: string; items: TranscriptItem[] }>();
  const transcriptCache = useRef(new Map<string, TranscriptItem[]>());

  const visible = useMemo(
    () => filterSessions(sessions, { query, cwd: cwdFilter, branch: branchFilter, starredOnly, showArchived, stars }),
    [sessions, query, cwdFilter, branchFilter, starredOnly, showArchived, stars],
  );
  const selected = Math.max(0, visible.findIndex((s) => s.id === selectedId));
  const current = visible[selected];

  // Layout: header + two bordered panes + footer. Narrow terminals show one pane at a time.
  const bodyH = Math.max(3, rows - 4);
  const split = columns >= 90;
  const listW = split ? Math.floor(columns * 0.45) - 2 : columns - 2;
  const previewW = split ? columns - listW - 4 : columns - 2;
  const listOffset = Math.min(Math.max(0, selected - Math.floor(bodyH / 2)), Math.max(0, visible.length - bodyH));

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

  const select = (index: number) => {
    const s = visible[Math.min(Math.max(0, index), visible.length - 1)];
    if (s && s.id !== current?.id) {
      setSelectedId(s.id);
      setPreviewScroll(0);
    }
  };

  const reload = (keepId = current?.id) => {
    setSessions(loadSessions());
    setStars(loadMeta().stars);
    setSelectedId(keepId);
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

  const neighborId = () => (visible[selected + 1] ?? visible[selected - 1])?.id;

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
        if (key.tab || key.escape || ch === "q") return setMode("list");
        if (key.downArrow || ch === "j") return setPreviewScroll((s) => Math.min(maxScroll, s + 1));
        if (key.upArrow || ch === "k") return setPreviewScroll((s) => Math.max(0, s - 1));
        if (key.pageDown || ch === " ") return setPreviewScroll((s) => Math.min(maxScroll, s + bodyH - 2));
        if (key.pageUp) return setPreviewScroll((s) => Math.max(0, s - bodyH + 2));
        if (ch === "g") return setPreviewScroll(0);
        if (ch === "G") return setPreviewScroll(maxScroll);
        if (key.return) return launch(false);
        return;
      }

      if (key.downArrow || ch === "j") return select(selected + 1);
      if (key.upArrow || ch === "k") return select(selected - 1);
      if (key.pageDown) return select(selected + bodyH);
      if (key.pageUp) return select(selected - bodyH);
      if (ch === "g" || key.home) return select(0);
      if (ch === "G" || key.end) return select(visible.length - 1);
      if (ch === "q") return exit();
      if (key.escape) {
        if (query) setQuery("");
        else if (cwdFilter || branchFilter || starredOnly) {
          setCwdFilter(undefined);
          setBranchFilter(undefined);
          setStarredOnly(false);
        } else exit();
        return;
      }
      if (ch === "/") return setMode("search");
      if (ch === "?") return setMode("help");
      if (key.tab) return current && setMode("preview");
      if (ch === "*") return setStarredOnly((v) => !v);
      if (ch === "A") return setShowArchived((v) => !v);
      if (ch === "R") return reload(), setStatus({ text: "Reloaded" });
      if (!current) return;
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
      if (ch === "s") {
        const starred = toggleStar(current.id);
        setStars(loadMeta().stars);
        return setStatus({ text: starred ? "Starred" : "Unstarred" });
      }
      if (ch === "r") return setInput(current.titleSource === "custom" ? current.title : ""), setMode("rename");
      if (ch === "t") return setInput(current.tag ?? ""), setMode("tag");
      if (ch === "d") return setInput(""), setMode("delete");
      if (ch === "e") return run("Exported", () => `Exported to ${exportSession(current)}`);
      if (ch === "a") {
        if (current.archived) return run("Restored", () => unarchiveSession(current), neighborId());
        return run("Archived (press A to view archive)", () => archiveSession(current), neighborId());
      }
    },
    { isActive: mode === "list" || mode === "preview" || mode === "help" },
  );

  const submitInput = (value: string) => {
    if (!current) return setMode("list");
    if (mode === "rename" && value.trim()) run("Renamed", () => renameSession(current, value));
    if (mode === "tag") run(value.trim() ? `Tagged #${value.trim()}` : "Tag cleared", () => tagSession(current, value));
    if (mode === "delete") {
      if (value === "delete") run("Deleted", () => deleteSession(current), neighborId());
      else setStatus({ text: "Delete cancelled" });
    }
    setMode("list");
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
          <Text key={k}>
            <Text color="cyan">{k!.padEnd(12)}</Text>
            {v}
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>★ starred · ● open in a running Claude Code · bold title = renamed. Press any key.</Text>
      </Box>
    );
  }

  const inputPrompt = { search: "/", rename: "Rename: ", tag: "Tag (empty clears): #", delete: "Type 'delete' to permanently remove: " }[mode as string];

  return (
    <Box flexDirection="column" height={rows}>
      <Box>
        <Text bold color="cyan">csm </Text>
        <Text dimColor>
          {visible.length}/{sessions.filter((s) => s.archived === showArchived).length} sessions
        </Text>
        {filters.length > 0 && <Text color="yellow"> [{filters.join(" · ")}]</Text>}
        {query && mode !== "search" && <Text color="magenta"> /{query}</Text>}
      </Box>
      <Box>
        {(split || mode !== "preview") && (
          <SessionList sessions={visible} selected={selected} offset={listOffset} height={bodyH} width={listW} stars={stars} focused={mode !== "preview"} />
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
              <TextInput value={query} onChange={(v) => (setQuery(v), setSelectedId(undefined))} onSubmit={() => setMode("list")} />
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
              ? "↑↓/PgUp/PgDn scroll · g/G top/bottom · Enter resume · Tab back"
              : "Enter resume · f fork · / search · Tab preview · p project · s star · r rename · a archive · d delete · ? help · q quit"}
          </Text>
        )}
      </Box>
    </Box>
  );
}
