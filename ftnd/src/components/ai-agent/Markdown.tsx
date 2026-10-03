"use client";

import Box from "@mui/material/Box";
import { Fragment, type ReactNode } from "react";

/**
 * Minimal Markdown renderer covering the syntax the assistant actually emits:
 * headings, ordered/unordered lists, bold, inline code and fenced code blocks.
 *
 * Everything is rendered as React elements (never `dangerouslySetInnerHTML`),
 * so untrusted model output cannot inject markup.
 */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || undefined;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    // heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    // list (ordered or unordered), consume consecutive items
    const isOrdered = /^\s*\d+[.)]\s+/.test(line);
    const isUnordered = /^\s*[-*+]\s+/.test(line);
    if (isOrdered || isUnordered) {
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        const orderedMatch = /^\s*\d+[.)]\s+(.*)$/.exec(current);
        const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(current);
        if (isOrdered && orderedMatch) items.push(orderedMatch[1]);
        else if (isUnordered && bulletMatch) items.push(bulletMatch[1]);
        else break;
        i += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    // blank line
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // paragraph: consume until blank line or another block starter
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i];
      if (
        !current.trim() ||
        /^\s*```/.test(current) ||
        /^#{1,4}\s+/.test(current) ||
        /^\s*\d+[.)]\s+/.test(current) ||
        /^\s*[-*+]\s+/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

/** Inline formatting: `code` and **bold** (bold may wrap inline code). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={`${keyPrefix}-t${index}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <Box
          key={`${keyPrefix}-c${index}`}
          component="code"
          sx={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.875em",
            bgcolor: "rgba(15,23,42,0.06)",
            color: "#b91c1c",
            px: 0.6,
            py: 0.1,
            borderRadius: 0.5,
          }}
        >
          {token.slice(1, -1)}
        </Box>,
      );
    } else {
      nodes.push(
        <Box key={`${keyPrefix}-b${index}`} component="strong" sx={{ fontWeight: 700 }}>
          {token.slice(2, -2)}
        </Box>,
      );
    }
    lastIndex = match.index + token.length;
    index += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-t${index}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

export default function Markdown({ content }: { content: string }) {
  const blocks = parseBlocks(content ?? "");

  return (
    <Box
      sx={{
        "& > *:first-of-type": { mt: 0 },
        "& > *:last-child": { mb: 0 },
      }}
    >
      {blocks.map((block, blockIndex) => {
        const key = `b${blockIndex}`;
        switch (block.kind) {
          case "heading": {
            const sizes = { 1: "1.15rem", 2: "1.05rem", 3: "0.98rem", 4: "0.95rem" };
            return (
              <Box
                key={key}
                component={block.level <= 2 ? "h4" : "h5"}
                sx={{
                  fontSize: sizes[block.level as 1 | 2 | 3 | 4] ?? "0.95rem",
                  fontWeight: 700,
                  mt: 1.6,
                  mb: 0.6,
                  lineHeight: 1.35,
                }}
              >
                {renderInline(block.text, key)}
              </Box>
            );
          }
          case "code":
            return (
              <Box
                key={key}
                component="pre"
                sx={{
                  my: 1,
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: "#0f172a",
                  color: "#e2e8f0",
                  overflowX: "auto",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                <code>{block.text}</code>
              </Box>
            );
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <Box
                key={key}
                component={ListTag}
                sx={{ my: 0.8, pl: 2.6, "& li": { mb: 0.35, lineHeight: 1.7 } }}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-i${itemIndex}`}>{renderInline(item, `${key}-i${itemIndex}`)}</li>
                ))}
              </Box>
            );
          }
          default:
            return (
              <Box key={key} component="p" sx={{ my: 0.8, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
                {renderInline(block.text, key)}
              </Box>
            );
        }
      })}
    </Box>
  );
}
