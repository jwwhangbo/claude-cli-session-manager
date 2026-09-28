import { Box, Text } from "ink";
import { basename } from "node:path";
import { fit, relTime } from "./format.ts";
import { groupLabel, type Row } from "./rows.ts";

interface Props {
  rows: Row[];
  cursor: number;
  offset: number;
  height: number;
  width: number;
  stars: Record<string, true>;
  marked: Set<string>;
  focused: boolean;
  /** Indent session rows under group headers. */
  grouped: boolean;
}

export function SessionList({ rows, cursor, offset, height, width, stars, marked, focused, grouped }: Props) {
  const indent = grouped ? "  " : "";
  const projW = Math.min(18, Math.max(8, Math.floor(width * 0.22)));
  const timeW = 4;
  const titleW = Math.max(10, width - projW - timeW - 6 - indent.length);
  const shown = rows.slice(offset, offset + height);
  return (
    <Box flexDirection="column" width={width + 2} height={height + 2} borderStyle="round" borderColor={focused ? "cyan" : "gray"}>
      {shown.length === 0 && <Text dimColor>No sessions match.</Text>}
      {shown.map((row, i) => {
        const active = offset + i === cursor;
        if (row.kind === "header") {
          const allMarked = row.ids.length > 0 && row.ids.every((id) => marked.has(id));
          const someMarked = !allMarked && row.ids.some((id) => marked.has(id));
          return (
            <Text key={row.key} inverse={active} wrap="truncate">
              <Text color="cyan" bold>{allMarked ? "▶" : someMarked ? "▹" : " "}</Text>
              <Text color="magenta" bold>
                {row.collapsed ? "▸ " : "▾ "}
                {fit(`${groupLabel(row.group)} (${row.ids.length})`, width - 3)}
              </Text>
            </Text>
          );
        }
        const s = row.session;
        const mark = stars[s.id] ? "★" : s.running ? "●" : " ";
        const title = s.tag ? `#${s.tag} ${s.title}` : s.title;
        return (
          <Text key={row.key} inverse={active} wrap="truncate">
            <Text color="cyan" bold>{marked.has(s.id) ? "▶" : " "}</Text>
            {indent}
            <Text color={stars[s.id] ? "yellow" : "green"}>{mark}</Text>{" "}
            <Text bold={s.titleSource === "custom"} color={marked.has(s.id) ? "cyan" : undefined}>{fit(title, titleW)}</Text>{" "}
            <Text color="blue">{fit(basename(s.cwd) || s.cwd, projW)}</Text>{" "}
            <Text dimColor={!active}>{relTime(s.updated).padStart(timeW)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
