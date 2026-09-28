import { Box, Text } from "ink";
import type { ReactNode } from "react";
import stringWidth from "string-width";

export interface ModalProps {
  title: string;
  width: number;
  top: number;
  left: number;
  color?: string;
  /** One element per row. Rows are padded to the full width so nothing underneath shows through. */
  rows: ReactNode[];
}

/** Rows plus the top and bottom border. */
export const modalHeight = (rows: number) => rows + 2;

/** A floating, bordered window drawn over whatever is behind it, with its title set into the top border. */
export function Modal({ title, width, top, left, color = "cyan", rows }: ModalProps) {
  const inner = Math.max(1, width - 4);
  const label = ` ${title} `;
  const rule = "─".repeat(Math.max(0, width - 3 - stringWidth(label)));
  return (
    <Box position="absolute" top={top} left={left} width={width} flexDirection="column">
      <Text color={color}>
        ╭─<Text bold>{label}</Text>
        {rule}╮
      </Text>
      {rows.map((row, i) => (
        <Box key={i} width={width}>
          <Text color={color}>│ </Text>
          <Box width={inner} overflowX="hidden">
            <Box flexShrink={0}>{row}</Box>
            {/* Clipped by overflowX; it only blanks the cells the row itself didn't draw. */}
            <Box flexShrink={0}>
              <Text>{" ".repeat(inner)}</Text>
            </Box>
          </Box>
          <Text color={color}> │</Text>
        </Box>
      ))}
      <Text color={color}>╰{"─".repeat(Math.max(0, width - 2))}╯</Text>
    </Box>
  );
}
