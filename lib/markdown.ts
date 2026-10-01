export type MarkdownBlock = { code: boolean; text: string; language?: string };
export type MarkdownSpan =
  | { kind: "text" | "literal" | "strong" | "code"; text: string }
  | { kind: "link"; text: string; url: string };
export type MarkdownAlign = "left" | "center" | "right";
export type MarkdownTable = { headers: string[]; rows: string[][]; align: Array<MarkdownAlign | undefined> };
export type MarkdownTask = { checked: boolean; text: string };
export type MarkdownNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "table"; table: MarkdownTable }
  | { type: "tasks"; items: MarkdownTask[] };

// CommonMark escapes ASCII punctuation, not letters in paths such as C:\work.
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

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
export function parseInlineMarkdown(text: string, streaming = false): MarkdownSpan[] {
  // Soft line breaks can be inside inline code. Blank lines end the paragraph,
  // so its unmatched delimiters cannot consume or suppress the following one.
  const parts = text.replace(/\r\n?/g, "\n").split(/(\n(?:[ \t]*\n)+)/);
  const spans: MarkdownSpan[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part: MarkdownSpan[] = index % 2 ? [{ kind: "text", text: parts[index] }]
      : parseInlineParagraph(parts[index], streaming && index === parts.length - 1);
    for (const span of part) {
      const previous = spans.at(-1);
      if ((span.kind === "text" || span.kind === "literal") && previous?.kind === span.kind) previous.text += span.text;
      else spans.push(span);
    }
  }
  return spans;
}

function parseInlineParagraph(line: string, streaming: boolean): MarkdownSpan[] {
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
    // An escape consumes just the first tick of a run. Its remaining ticks can
    // open code, whose closing run still ignores backslash escapes entirely.
    if (run[0].length > 1) {
      const suffixEnd = nextByLength.get(run[0].length - 1);
      if (suffixEnd !== undefined) codeEnds.set(run.index + 1, suffixEnd);
    }
    nextByLength.set(run[0].length, run.index);
  }
  // Excluding nested '[' prevents repeated scans of unfinished streaming labels.
  const token = /\\[^\n]|`+|\*\*(?:\\[^\n]|[^*\\])+\*\*|\[((?:\\[^\n]|[^\[\]\\])+)\]\(https?:\/\//gi;
  const spans: MarkdownSpan[] = [];
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(line))) {
    let end = token.lastIndex;
    let span: MarkdownSpan;
    if (match[0][0] === "\\") {
      const text = unescapeMarkdown(match[0]);
      // Keep escaped punctuation separate so rendering cannot turn an escaped
      // list marker back into a bullet after the backslash has been removed.
      span = { kind: text === match[0] ? "text" : "literal", text };
    } else if (match[0][0] === "`") {
      const closing = codeEnds.get(match.index);
      if (closing === undefined) {
        // A delimiter still arriving can turn this tail into code. Keep its
        // source literal, including list markers on following soft lines.
        if (!streaming) continue;
        span = { kind: "literal", text: line.slice(match.index) };
        end = line.length;
      } else {
        let text = line.slice(end, closing).replace(/\n/g, " ");
        // Markdown removes one padding space around nonblank code, allowing
        // literal backticks at either edge without changing deliberate spacing.
        if (text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text)) text = text.slice(1, -1);
        span = { kind: "code", text };
        end = closing + match[0].length;
      }
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
      span = { kind: "link", text: unescapeMarkdown(match[1]), url: unescapeMarkdown(line.slice(urlStart, cursor)) };
    } else {
      span = { kind: "strong", text: unescapeMarkdown(match[0].slice(2, -2)) };
    }
    if (match.index > offset) spans.push({ kind: "text", text: line.slice(offset, match.index) });
    spans.push(span);
    offset = token.lastIndex = end;
  }
  if (offset < line.length || spans.length === 0) spans.push({ kind: "text", text: line.slice(offset) });
  return spans;
}

const taskLine = /^ {0,3}[-*+] \[([ xX])\](?:[ \t]+(.*))?$/;
const delimiterCell = /^:?-+:?$/;

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "\\" && value[index + 1] === "|") { current += character + "|"; index += 1; continue; }
    if (character === "|") { cells.push(current.trim()); current = ""; continue; }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function tableAlignments(line: string): Array<MarkdownAlign | undefined> | null {
  const cells = splitTableRow(line);
  if (!cells.length || !cells.every((cell) => delimiterCell.test(cell))) return null;
  return cells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return undefined;
  });
}

function tableAt(lines: string[], start: number): { table: MarkdownTable; end: number } | null {
  const header = lines[start];
  if (!header || !header.includes("|")) return null;
  const align = tableAlignments(lines[start + 1] ?? "");
  if (!align) return null;
  const headers = splitTableRow(header);
  if (headers.length === 0 || headers.length !== align.length) return null;
  const rows: string[][] = [];
  let index = start + 2;
  for (; index < lines.length && lines[index].includes("|"); index++) {
    const cells = splitTableRow(lines[index]);
    rows.push(headers.map((_, column) => cells[column] ?? ""));
  }
  return { table: { headers, rows, align }, end: index };
}

function parseTextBlock(text: string): MarkdownNode[] {
  const lines = text.split("\n");
  const nodes: MarkdownNode[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) nodes.push({ type: "text", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (let index = 0; index < lines.length;) {
    const task = taskLine.exec(lines[index]);
    if (task) {
      flush();
      const items: MarkdownTask[] = [];
      for (; index < lines.length; index++) {
        const match = taskLine.exec(lines[index]);
        if (!match) break;
        items.push({ checked: match[1].toLowerCase() === "x", text: match[2] ?? "" });
      }
      nodes.push({ type: "tasks", items });
      continue;
    }
    const table = tableAt(lines, index);
    if (table) {
      flush();
      nodes.push({ type: "table", table: table.table });
      index = table.end;
      continue;
    }
    paragraph.push(lines[index]);
    index += 1;
  }
  flush();
  return nodes;
}

export function parseMarkdown(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  for (const block of parseMarkdownBlocks(text)) {
    if (block.code) {
      nodes.push(block.language ? { type: "code", text: block.text, language: block.language } : { type: "code", text: block.text });
      continue;
    }
    nodes.push(...parseTextBlock(block.text));
  }
  return nodes;
}
