import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import TextInput from "ink-text-input";
import { basename } from "node:path";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { archiveSession, deleteSession, exportSession, renameSession, tagSession, unarchiveSession } from "../core/actions.ts";
import { loadSessions, type SessionRecord } from "../core/index.ts";
import type { LaunchRequest } from "../core/launch.ts";
import { addToGroup, dissolveGroup, groupsBySession, loadMeta, removeFromGroup, renameGroup, setStarred, toggleCollapsed } from "../core/meta.ts";
import { parseTranscript, type TranscriptItem } from "../core/parse.ts";
import { filterSessions } from "../core/search.ts";
import { cleanText } from "../core/paths.ts";
import { fit } from "./format.ts";
import { buildGroupLines, buildPreviewLines, Preview } from "./Preview.tsx";
import { buildRows, groupLabel, UNGROUPED } from "./rows.ts";
import { Modal, modalHeight } from "./Modal.tsx";
import { SessionList } from "./SessionList.tsx";

type Mode = "list" | "preview" | "search" | "rename" | "tag" | "delete" | "addGroup" | "renameGroup" | "dissolve" | "help";

export interface AppProps {
  initialCwd?: string;
  initialQuery?: string;
  onLaunch: (req: LaunchRequest) => void;
}

const HELP: [string, string][] = [
  ["↑↓ / j k", "move            PgUp/PgDn  page    g/G  top/bottom"],
  ["→ l / ← h", "focus the preview pane (↑↓ PgUp/PgDn scroll) / back to the list"],
  ["/", "fuzzy search (title, prompts, project, branch, tag, group)"],
  ["Enter / f", "resume / fork the session in its original directory"],
  ["Tab / S-Tab", "select and move down / deselect and move up"],
  ["Ctrl+A", "select all visible (again to deselect them)"],
  ["p / b", "filter to this project / this project+branch"],
  ["* / A", "starred only / show archived"],
  ["s", "star          t  tag           r  rename"],
  ["a", "archive (or restore in archive view)"],
  ["d", "delete permanently (asks y/N)"],
  ["e", "export transcript to markdown in the current dir"],
  ["v", "toggle grouped / flat view"],
  ["+ / -", "add to a group (new name creates it) / remove from this group"],
  ["on a group", "Enter/Space collapse · Tab select all · r rename · d dissolve (keeps sessions)"],
  ["R / q", "reload / quit"],
  ["", "s t a d e + - act on the selection, or on a whole group from its header"],
];

const plural = (n: number, word = "session") => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Row keys are "<group>\0<id>" when grouped and "<id>" when flat; the id is the part after the last \0. */
const idOfKey = (key: string | undefined) => key?.split("\0").pop() ?? "";

export function App({ initialCwd, initialQuery = "", onLaunch }: AppProps) {
  const { exit } = useApp();
  const { columns, rows: termRows } = useWindowSize();
  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions());
  const [meta, setMeta] = useState(loadMeta);
  const [grouped, setGrouped] = useState(() => Object.keys(meta.groups).length > 0);
  const [mode, setMode] = useState<Mode>("list");
  const [query, setQuery] = useState(initialQuery);
  const [cwdFilter, setCwdFilter] = useState<string | undefined>(initialCwd);
  const [branchFilter, setBranchFilter] = useState<string | undefined>();
  const [starredOnly, setStarredOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [cursorKey, setCursorKey] = useState<string | undefined>();
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const [previewScroll, setPreviewScroll] = useState(0);
  const [input, setInput] = useState("");
  const [pick, setPick] = useState(0);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | undefined>();
  const [transcript, setTranscript] = useState<{ key: string; items: TranscriptItem[] }>();
  const transcriptCache = useRef(new Map<string, TranscriptItem[]>());

  const { stars, groups, collapsed } = meta;
  const groupsOf = useMemo(() => groupsBySession(groups), [groups]);
  const groupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  const visible = useMemo(
    () => filterSessions(sessions, { query, cwd: cwdFilter, branch: branchFilter, starredOnly, showArchived, stars, groupsOf }),
    [sessions, query, cwdFilter, branchFilter, starredOnly, showArchived, stars, groupsOf],
  );
  const rows = useMemo(() => buildRows(visible, { grouped, groups, collapsed, expandAll: !!query }), [visible, grouped, groups, collapsed, query]);

  // Keep the cursor on the same row; if that row vanished (e.g. view toggled), on the same session.
  let cursor = rows.findIndex((r) => r.key === cursorKey);
  if (cursor < 0) cursor = rows.findIndex((r) => r.kind === "session" && r.session.id === idOfKey(cursorKey));
  if (cursor < 0) cursor = 0;
  const row = rows[cursor];
  const current = row?.kind === "session" ? row.session : undefined;
  const header = row?.kind === "header" ? row : undefined;
  // The selection survives filter changes, so bulk actions use every selected session, visible or not.
  const selection = useMemo(() => sessions.filter((s) => marked.has(s.id)), [sessions, marked]);

  // Layout: header + two bordered panes + footer. Narrow terminals show one pane at a time.
  const bodyH = Math.max(3, termRows - 4);
  const split = columns >= 90;
  const listW = split ? Math.floor(columns * 0.45) - 2 : columns - 2;
  const previewW = split ? columns - listW - 4 : columns - 2;
  const listOffset = Math.min(Math.max(0, cursor - Math.floor(bodyH / 2)), Math.max(0, rows.length - bodyH));

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

  const previewLines = useMemo(() => {
    if (header) return buildGroupLines(groupLabel(header.group), visible.filter((s) => header.ids.includes(s.id)), previewW);
    if (!current) return [];
    return buildPreviewLines(current, transcript?.key === transcriptKey ? transcript.items : undefined, previewW, groupsOf.get(current.id));
  }, [current, header, visible, transcript, transcriptKey, previewW, groupsOf]);
  const maxScroll = Math.max(0, previewLines.length - bodyH);

  const moveTo = (index: number) => {
    const r = rows[Math.min(Math.max(0, index), rows.length - 1)];
    if (r && r.key !== row?.key) {
      setCursorKey(r.key);
      setPreviewScroll(0);
    }
  };

  const mark = (ids: string[], on: boolean) =>
    setMarked((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });

  const reload = (keepKey = row?.key) => {
    const fresh = loadSessions();
    setSessions(fresh);
    setMeta(loadMeta());
    setCursorKey(keepKey);
    const ids = new Set(fresh.map((s) => s.id));
    setMarked((prev) => new Set([...prev].filter((id) => ids.has(id))));
  };

  const run = (label: string, fn: () => string | void, keepKey = row?.key) => {
    try {
      const msg = fn();
      setStatus({ text: msg || label });
    } catch (err) {
      setStatus({ text: (err as Error).message, error: true });
    }
    reload(keepKey);
  };

  /** Applies fn to each target, skipping (and counting) sessions it refuses, e.g. running ones. */
  const runEach = (verb: string, targets: SessionRecord[], fn: (s: SessionRecord) => void, { clear = false, keepKey = row?.key } = {}) => {
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
    const skipped = errors.length ? ` · skipped ${errors.length}: ${errors[0]}` : "";
    setStatus({ text: `${verb} ${plural(done)}${skipped}`, error: done === 0 && errors.length > 0 });
    if (clear) setMarked(new Set());
    reload(keepKey);
  };

  /** The selection if there is one, else the whole group under a header, else the session under the cursor. */
  const targets = (): SessionRecord[] => {
    if (selection.length) return selection;
    if (header) return visible.filter((s) => header.ids.includes(s.id));
    return current ? [current] : [];
  };

  /** Where the cursor should land when the given sessions disappear from the list. */
  const neighborKey = (leaving: Set<string>) => {
    const stays = (i: number) => rows[i]?.kind === "header" || !leaving.has(idOfKey(rows[i]?.key));
    for (let i = cursor; i < rows.length; i++) if (stays(i)) return rows[i]!.key;
    for (let i = cursor - 1; i >= 0; i--) if (stays(i)) return rows[i]!.key;
  };

  const launch = (fork: boolean) => {
    if (!current) return;
    onLaunch({ session: current, fork });
    exit();
  };

  const toggleHeader = () => {
    if (!header) return;
    if (query) return setStatus({ text: "Groups stay expanded while searching; clear the search (Esc) to collapse." });
    toggleCollapsed(header.group);
    setMeta(loadMeta());
  };

  // The group picker: existing groups matching the typed name (most recently active first), plus a
  // "create" option first when the name is new.
  const groupOptions = useMemo(() => {
    if (mode !== "addGroup") return [];
    const typed = cleanText(input);
    const needle = typed.toLowerCase();
    const updated = new Map(sessions.map((s) => [s.id, s.updated]));
    const latest = (name: string) => Math.max(0, ...groups[name]!.map((id) => updated.get(id) ?? 0));
    const matches = groupNames.filter((n) => n.toLowerCase().includes(needle)).sort((a, b) => +(b.toLowerCase() === needle) - +(a.toLowerCase() === needle) || latest(b) - latest(a));
    const create = typed && !groups[typed] ? [{ name: typed, create: true }] : [];
    return [...create, ...matches.map((name) => ({ name, create: false }))];
  }, [mode, input, groups, sessions]);

  useInput(
    (ch, key) => {
      const last = groupOptions.length - 1;
      if (key.downArrow || (key.ctrl && ch === "n")) setPick((p) => (p >= last ? 0 : p + 1));
      if (key.upArrow || (key.ctrl && ch === "p")) setPick((p) => (p <= 0 ? last : p - 1));
      // Tab completes the input to the highlighted group's name.
      if (key.tab && groupOptions[pick]) setInput(groupOptions[pick].name), setPick(0);
    },
    { isActive: mode === "addGroup" },
  );

  const textModes: Mode[] =["search", "rename", "tag", "addGroup", "renameGroup"];

  // Esc backs out of any text-entry mode.
  useInput(
    (_, key) => {
      if (key.escape) {
        if (mode === "search") setQuery("");
        setMode("list");
      }
    },
    { isActive: textModes.includes(mode) },
  );

  // y/N confirmation for deleting sessions and dissolving a group; other keys are ignored.
  useInput(
    (ch, key) => {
      const c = ch.toLowerCase();
      if (c === "y") {
        setMode("list");
        if (mode === "dissolve" && header) run(`Dissolved "${header.group}" (sessions kept)`, () => dissolveGroup(header.group));
        if (mode === "delete") {
          const list = targets();
          runEach("Deleted", list, deleteSession, { clear: true, keepKey: neighborKey(new Set(list.map((s) => s.id))) });
        }
      } else if (c === "n" || c === "q" || key.escape || key.return) {
        setMode("list");
        setStatus({ text: mode === "delete" ? "Delete cancelled" : "Kept the group" });
      }
    },
    { isActive: mode === "delete" || mode === "dissolve" },
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
      if (ch === "G" || key.end) return moveTo(rows.length - 1);
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
      if (key.rightArrow || ch === "l") return row && setMode("preview");
      if (ch === "*") return setStarredOnly((v) => !v);
      if (ch === "A") return setShowArchived((v) => !v);
      if (ch === "R") return reload(), setStatus({ text: "Reloaded" });
      if (ch === "v") {
        if (!grouped && groupNames.length === 0) return setStatus({ text: "No groups yet: select sessions with Tab, then press + to create one." });
        setGrouped((g) => !g);
        return setStatus({ text: grouped ? "Flat view" : "Grouped view" });
      }
      if (key.ctrl && ch === "a") {
        const allMarked = visible.length > 0 && visible.every((s) => marked.has(s.id));
        return mark(visible.map((s) => s.id), !allMarked);
      }
      if (!row) return;
      if (key.tab) {
        mark(header ? header.ids : [current!.id], !key.shift);
        return moveTo(cursor + (key.shift ? -1 : 1));
      }
      if (header && (key.return || ch === " ")) return toggleHeader();
      if (header && ch === "r") {
        if (header.group === UNGROUPED) return setStatus({ text: "Ungrouped isn't a real group; press + to create one." });
        return setInput(header.group), setMode("renameGroup");
      }
      if (header && ch === "d") {
        if (header.group === UNGROUPED) return setStatus({ text: "Ungrouped can't be dissolved." });
        return setMode("dissolve");
      }
      if (current) {
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
        if (ch === "d") return setMode("delete");
      }

      const list = targets();
      if (!list.length) return;
      if (ch === "s") {
        const star = !list.every((s) => stars[s.id]);
        setStarred(list.map((s) => s.id), star);
        setMeta(loadMeta());
        return setStatus({ text: `${star ? "Starred" : "Unstarred"} ${plural(list.length)}` });
      }
      if (ch === "t") {
        const tags = new Set(list.map((s) => s.tag ?? ""));
        return setInput(tags.size === 1 ? [...tags][0]! : ""), setMode("tag");
      }
      if (ch === "+") return setInput(""), setPick(0), setMode("addGroup");
      if (ch === "-") {
        // Remove from the group this row sits under; in the flat view or Ungrouped, from every group.
        const group = row.group || undefined;
        const ids = list.map((s) => s.id);
        const leaving = new Set(ids);
        return run(group ? `Removed ${plural(ids.length)} from "${group}"` : `Removed ${plural(ids.length)} from all groups`, () => {
          removeFromGroup(group, ids);
          setMarked(new Set());
        }, grouped ? neighborKey(leaving) : row.key);
      }
      if (ch === "e") {
        if (list.length === 1) return run("Exported", () => `Exported to ${exportSession(list[0]!)}`);
        return runEach("Exported", list, (s) => void exportSession(s));
      }
      if (ch === "a") {
        // In the archive view `a` restores; otherwise it archives. Sessions already in the target state are left alone.
        const movable = list.filter((s) => s.archived === showArchived);
        const leaving = new Set(movable.map((s) => s.id));
        if (showArchived) return runEach("Restored", movable, unarchiveSession, { clear: true, keepKey: neighborKey(leaving) });
        return runEach("Archived", movable, archiveSession, { clear: true, keepKey: neighborKey(leaving) });
      }
    },
    { isActive: mode === "list" || mode === "preview" || mode === "help" },
  );

  const submitInput = (value: string) => {
    setMode("list");
    const text = cleanText(value);
    const list = targets();
    if (mode === "rename" && current && text) run("Renamed", () => renameSession(current, text));
    if (mode === "tag") runEach(text ? `Tagged #${text}:` : "Cleared tag on", list, (s) => tagSession(s, text));
    if (mode === "addGroup") {
      const name = groupOptions[pick]?.name;
      if (!name) return setStatus({ text: "Cancelled" });
      const ids = list.map((s) => s.id);
      run("Grouped", () => {
        addToGroup(name, ids);
        setMarked(new Set());
        setGrouped(true);
        return `Added ${plural(ids.length)} to "${name}"`;
      });
    }
    if (mode === "renameGroup" && header && text && text !== header.group) {
      run("Renamed group", () => {
        renameGroup(header.group, text);
        return `Renamed group to "${text}"`;
      }, `${text}\0`);
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

  let hint: string;
  if (mode === "preview") hint = "↑↓/PgUp/PgDn scroll · g/G top/bottom · Enter resume · ←/h back";
  else if (count > 0)
    hint = `${count} selected: + group · - ungroup · s star · t tag · a ${showArchived ? "restore" : "archive"} · d delete · e export · Esc clear`;
  else if (header)
    hint = "Enter/Space collapse · Tab select group · + add to another group · r rename · d dissolve · s t a e act on the group";
  else hint = "Enter resume · f fork · / search · Tab select · + group · v view · →/l preview · s star · r rename · a archive · d delete · ? help";

  const dialog = buildDialog();
  const dialogW = Math.min(columns - 2, 64);
  const dialogH = dialog ? modalHeight(dialog.rows.length) : 0;

  /** The floating window for action dialogs (rename, tag, group, confirmations). Search stays in the footer. */
  function buildDialog(): { title: string; color?: string; rows: ReactNode[] } | undefined {
    const inner = Math.min(columns - 2, 64) - 4;
    const list = targets();
    const what = count ? plural(count) : header ? `group "${groupLabel(header.group)}"` : `"${fit(current?.title ?? "", inner - 20).trimEnd()}"`;
    const hintRow = (text: string) => <Text dimColor>{text}</Text>;
    const inputRow = (prefix: string, onChange: (v: string) => void = setInput) => (
      <Box>
        <Text color="cyan">{prefix}</Text>
        <TextInput value={input} onChange={onChange} onSubmit={submitInput} />
      </Box>
    );
    const yesNo = (verb: string, color: string) => (
      <Text>
        <Text color={color} bold>y</Text>
        <Text dimColor> {verb} · </Text>
        <Text bold>n</Text>
        <Text dimColor>/Esc cancel</Text>
      </Text>
    );

    if (mode === "rename" && current)
      return { title: "Rename session", rows: [inputRow("› "), <Text> </Text>, hintRow("Enter save · Esc cancel")] };
    if (mode === "tag")
      return { title: `Tag ${what}`, rows: [inputRow("#"), <Text> </Text>, hintRow("Enter save · empty clears the tag · Esc cancel")] };
    if (mode === "renameGroup" && header)
      return { title: `Rename group "${header.group}"`, rows: [inputRow("› "), <Text> </Text>, hintRow("Enter save · an existing name merges · Esc cancel")] };
    if (mode === "delete") {
      const shown = list.slice(0, 5);
      return {
        title: "Delete",
        color: "red",
        rows: [
          <Text>Permanently delete {count ? plural(count) : "this session"}?</Text>,
          ...shown.map((s) => <Text dimColor>  • {fit(s.title, inner - 4).trimEnd()}</Text>),
          ...(list.length > shown.length ? [<Text dimColor>  … and {list.length - shown.length} more</Text>] : []),
          <Text> </Text>,
          yesNo("delete", "red"),
        ],
      };
    }
    if (mode === "dissolve" && header) {
      return {
        title: "Dissolve group",
        color: "yellow",
        rows: [
          <Text>Dissolve "{header.group}"?</Text>,
          <Text dimColor>Only the group is removed; its {plural(header.ids.length)} are kept.</Text>,
          <Text> </Text>,
          yesNo("dissolve", "yellow"),
        ],
      };
    }
    if (mode === "addGroup") {
      const ids = list.map((s) => s.id);
      // Keep the highlighted option in view when the list is longer than the window.
      const room = Math.max(1, Math.min(8, bodyH - 5));
      const start = Math.min(Math.max(0, pick - room + 1), Math.max(0, groupOptions.length - room));
      const options = groupOptions.slice(start, start + room).map((o, i) => {
        const on = start + i === pick;
        const members = groups[o.name] ?? [];
        const already = members.length > 0 && ids.every((id) => members.includes(id));
        return (
          <Text>
            <Text color="cyan">{on ? "› " : "  "}</Text>
            {o.create ? (
              <Text color={on ? "green" : undefined} bold={on}>+ create "{fit(o.name, inner - 14).trimEnd()}"</Text>
            ) : (
              <>
                <Text color={on ? "cyan" : undefined} bold={on}>{fit(o.name, inner - 20).trimEnd()}</Text>
                <Text dimColor> {members.length}</Text>
                {already && <Text dimColor> ✓ already in</Text>}
              </>
            )}
          </Text>
        );
      });
      return {
        title: `Add ${what} to group`,
        rows: [
          inputRow("› ", (v) => (setInput(v), setPick(0))),
          <Text dimColor>{"─".repeat(inner)}</Text>,
          ...(options.length ? options : [<Text dimColor>No groups yet. Type a name to create one.</Text>]),
          <Text> </Text>,
          hintRow("↑↓ pick · Tab complete · Enter add · Esc cancel"),
        ],
      };
    }
  }

  return (
    <Box flexDirection="column" height={termRows}>
      <Box>
        <Text bold color="cyan">csm </Text>
        <Text dimColor>
          {visible.length}/{sessions.filter((s) => s.archived === showArchived).length} sessions
          {grouped ? ` · ${plural(groupNames.length, "group")}` : ""}
        </Text>
        {count > 0 && <Text color="cyan" bold> · {count} selected</Text>}
        {filters.length > 0 && <Text color="yellow"> [{filters.join(" · ")}]</Text>}
        {query && mode !== "search" && <Text color="magenta"> /{query}</Text>}
      </Box>
      <Box>
        {(split || mode !== "preview") && (
          <SessionList rows={rows} cursor={cursor} offset={listOffset} height={bodyH} width={listW} stars={stars} marked={marked} focused={mode !== "preview" && !dialog} grouped={grouped} />
        )}
        {(split || mode === "preview") && row && (
          <Preview lines={previewLines} scroll={Math.min(previewScroll, maxScroll)} height={bodyH} width={previewW} focused={mode === "preview"} />
        )}
        {dialog && (
          <Modal
            title={dialog.title}
            color={dialog.color}
            rows={dialog.rows}
            width={dialogW}
            top={Math.max(0, Math.floor((bodyH + 2 - dialogH) / 2))}
            left={Math.max(0, Math.floor((columns - dialogW) / 2))}
          />
        )}
      </Box>
      <Box>
        {mode === "search" ? (
          <>
            <Text color="cyan">/</Text>
            <TextInput value={query} onChange={(v) => (setQuery(v), setCursorKey(undefined))} onSubmit={() => setMode("list")} />
          </>
        ) : status ? (
          <Text color={status.error ? "red" : "green"} wrap="truncate">
            {status.text}
          </Text>
        ) : (
          <Text dimColor wrap="truncate">
            {dialog ? "" : hint}
          </Text>
        )}
      </Box>
    </Box>
  );
}
