import { Box, Text } from "ink";
import { basename } from "node:path";
import type { SessionRecord } from "../core/index.ts";
import { fit, relTime } from "./format.ts";

interface Props {
  sessions: SessionRecord[];
  selected: number;
  offset: number;
  height: number;
  width: number;
  stars: Record<string, true>;
  marked: Set<string>;
  focused: boolean;
}

export function SessionList({ sessions, selected, offset, height, width, stars, marked, focused }: Props) {
  const projW = Math.min(18, Math.max(8, Math.floor(width * 0.22)));
  const timeW = 4;
  const titleW = Math.max(10, width - projW - timeW - 6);
  const rows = sessions.slice(offset, offset + height);
  return (
    <Box flexDirection="column" width={width + 2} height={height + 2} borderStyle="round" borderColor={focused ? "cyan" : "gray"}>
      {rows.length === 0 && <Text dimColor>No sessions match.</Text>}
      {rows.map((s, i) => {
        const active = offset + i === selected;
        const mark = stars[s.id] ? "★" : s.running ? "●" : " ";
        const title = s.tag ? `#${s.tag} ${s.title}` : s.title;
        return (
          <Text key={s.id} inverse={active} wrap="truncate">
            <Text color="cyan" bold>{marked.has(s.id) ? "▶" : " "}</Text>
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
