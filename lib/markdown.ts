export type MarkdownBlock = { code: boolean; text: string; language?: string };
export type MarkdownSpan =
  | { kind: "text" | "strong" | "code"; text: string }
  | { kind: "link"; text: string; url: string };

/** Line-delimited fences keep backticks inside code verbatim while streaming. */
export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let start = 0;
  let index = 0;
  // A fence without a following newline stays literal, including an opening
  // fence whose info string has not finished arriving yet.
  while (index < lines.length - 1) {
    const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[index]);
    if (!opening || (opening[2][0] === "`" && opening[3].includes("`"))) { index += 1; continue; }
    if (index > start) blocks.push({ code: false, text: lines.slice(start, index).join("\n") });
    const body: string[] = [];
    const indent = opening[1].length;
    index += 1;
    for (; index < lines.length; index++) {
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(lines[index]);
      if (closing && closing[1][0] === opening[2][0] && closing[1].length >= opening[2].length) break;
      const spaces = /^ */.exec(lines[index])![0].length;
      body.push(lines[index].slice(Math.min(indent, spaces)));
    }
    blocks.push({ code: true, text: body.join("\n"), language: opening[3].trim() || undefined });
    index += 1;
    start = index;
  }
  const rest = lines.slice(start).join("\n");
  if (rest || blocks.length === 0) blocks.push({ code: false, text: rest });
  return blocks;
}

/** The supported inline subset never interprets HTML or unfinished delimiters. */
export function parseInlineMarkdown(line: string, streaming = false): MarkdownSpan[] {
  // Code delimiters are whole runs, so a single backtick inside double
  // backticks cannot expose a link. Index matching runs once rather than
  // repeatedly scanning a long, unfinished stream for each possible closer.
  const backticks = [...line.matchAll(/`+/g)];
  const nextByLength = new Map<number, number>();
  const codeEnds = new Map<number, number>();
  for (let index = backticks.length - 1; index >= 0; index--) {
    const run = backticks[index];
    const next = nextByLength.get(run[0].length);
    if (next !== undefined) codeEnds.set(run.index, next);
    nextByLength.set(run[0].length, run.index);
  }
  // Excluding nested '[' prevents repeated scans of unfinished streaming labels.
  const token = /`+|\*\*[^*]+\*\*|\[([^\[\]]+)\]\(https?:\/\//gi;
  const spans: MarkdownSpan[] = [];
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(line))) {
    let end = token.lastIndex;
    let span: MarkdownSpan;
    if (match[0][0] === "`") {
      const closing = codeEnds.get(match.index);
      if (closing === undefined) {
        // A delimiter still arriving can turn this tail into code. Keep its
        // source visible without temporarily activating links inside it.
        if (streaming) break;
        continue;
      }
      let text = line.slice(end, closing);
      // Markdown removes one padding space around nonblank code, allowing
      // literal backticks at either edge without changing deliberate spacing.
      if (text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text)) text = text.slice(1, -1);
      span = { kind: "code", text };
      end = closing + match[0].length;
    } else if (match[1] !== undefined) {
      let depth = 1;
      let cursor = end;
      for (; cursor < line.length; cursor++) {
        const character = line[cursor];
        if (/\s/.test(character)) break;
        if (character === "\\" && /[\\()]/.test(line[cursor + 1] ?? "")) { cursor += 1; continue; }
        if (character === "(") depth += 1;
        if (character === ")" && --depth === 0) break;
      }
      // Do not rescan the rest of an unfinished destination for more links.
      token.lastIndex = cursor;
      if (depth !== 0) continue;
      end = cursor + 1;
      const urlStart = match.index + match[1].length + 3;
      span = { kind: "link", text: match[1], url: line.slice(urlStart, cursor).replace(/\\([\\()])/g, "$1") };
    } else {
      span = { kind: "strong", text: match[0].slice(2, -2) };
    }
    if (match.index > offset) spans.push({ kind: "text", text: line.slice(offset, match.index) });
    spans.push(span);
    offset = token.lastIndex = end;
  }
  if (offset < line.length || spans.length === 0) spans.push({ kind: "text", text: line.slice(offset) });
  return spans;
}
