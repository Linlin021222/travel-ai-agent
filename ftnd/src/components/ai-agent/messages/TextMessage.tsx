"use client";

import Markdown from "../Markdown";

/** Plain assistant/user text — supports basic Markdown. */
export default function TextMessage({ content }: { content: string }) {
  return <Markdown content={content} />;
}
