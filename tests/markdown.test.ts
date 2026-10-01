import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInlineMarkdown, parseMarkdown, parseMarkdownBlocks } from "../lib/markdown";

test("escaped Markdown punctuation stays literal while code retains its original backslashes", () => {
  const literalLink = String.raw`\[Literal](https://example.com)`;
  for (const streaming of [false, true]) {
    const spans = parseInlineMarkdown(literalLink + " then [Docs](https://example.com)", streaming);
    assert.equal(spans.filter((span) => span.kind === "link").length, 1);
    assert.equal(spans.map((span) => span.text).join(""), "[Literal](https://example.com) then Docs");
    assert.deepEqual(parseInlineMarkdown(String.raw`**a\*b** and [A\]B](https://example.com)`, streaming), [
      { kind: "strong", text: "a*b" }, { kind: "text", text: " and " },
      { kind: "link", text: "A]B", url: "https://example.com" },
    ]);
  }
  const source = "`" + String.raw`\[Literal](https://example.com) \*` + "`";
  assert.deepEqual(parseInlineMarkdown(source), [{ kind: "code", text: String.raw`\[Literal](https://example.com) \*` }]);
  assert.deepEqual(parseInlineMarkdown(String.raw`C:\work\notes`), [{ kind: "text", text: String.raw`C:\work\notes` }]);
  assert.deepEqual(parseInlineMarkdown(String.raw`\[`.repeat(20_000), true), [{ kind: "literal", text: "[".repeat(20_000) }],
    "a long run of escaped punctuation must not create thousands of rendered text nodes");
});

test("escaped backticks cannot open a streaming code span or hide the remaining backtick run", () => {
  const escaped = "\\` then [Docs](https://example.com)";
  const spans = parseInlineMarkdown(escaped, true);
  assert.equal(spans.map((span) => span.text).join(""), "` then Docs");
  assert.equal(spans.filter((span) => span.kind === "link").length, 1);
  // Only the first tick is escaped; the second opens code. Inside code a
  // backslash is ordinary text, so it cannot escape the closing delimiter.
  const code = parseInlineMarkdown("\\``[Literal](https://example.com)\\`", true);
  assert.equal(code.map((span) => span.text).join(""), "`[Literal](https://example.com)\\");
  assert.equal(code.filter((span) => span.kind === "link").length, 0);
  assert.equal(code.at(-1)?.kind, "code");
});

test("fenced code ends only on a matching line and retains shorter fences as source", () => {
  assert.deepEqual(parseMarkdownBlocks("Before\n````md\n```js\nconst marker = '```';\n```\n~~~\n````\nAfter"), [
    { code: false, text: "Before" },
    { code: true, language: "md", text: "```js\nconst marker = '```';\n```\n~~~" },
    { code: false, text: "After" },
  ]);
  assert.deepEqual(parseMarkdownBlocks("  ~~~sh\r\n  echo ready\r\n  ~~~~\r\nDone"), [
    { code: true, language: "sh", text: "echo ready" },
    { code: false, text: "Done" },
  ]);
});

test("unfinished streaming fences keep their code and inline fence markers stay literal", () => {
  const start = "```js\nconst marker = '```';\n";
  assert.deepEqual(parseMarkdownBlocks(start), [{ code: true, language: "js", text: "const marker = '```';\n" }]);
  assert.deepEqual(parseMarkdownBlocks(start + "```\nDone"), [
    { code: true, language: "js", text: "const marker = '```';" },
    { code: false, text: "Done" },
  ]);
  for (const text of ["````", "```js", "Use ```js\nverbatim\n```", "```bad`info\nverbatim"]) {
    assert.deepEqual(parseMarkdownBlocks(text), [{ code: false, text }]);
  }
});

test("Markdown links preserve nested and escaped URL parentheses without formatting code", () => {
  const url = "https://example.com/guide_(one_(two))?q=(three)#section";
  assert.deepEqual(parseInlineMarkdown("[Guide](" + url + ")!"), [
    { kind: "link", text: "Guide", url }, { kind: "text", text: "!" },
  ]);
  assert.deepEqual(parseInlineMarkdown("[Escaped](https://example.com/a\\)b)"), [
    { kind: "link", text: "Escaped", url: "https://example.com/a)b" },
  ]);
  assert.deepEqual(parseInlineMarkdown("**Bold** and `[literal](https://example.com)` with [Docs](HTTPS://example.com)"), [
    { kind: "strong", text: "Bold" }, { kind: "text", text: " and " },
    { kind: "code", text: "[literal](https://example.com)" }, { kind: "text", text: " with " },
    { kind: "link", text: "Docs", url: "HTTPS://example.com" },
  ]);
});

test("Markdown destinations unescape punctuation without decoding signed query values", () => {
  const source = String.raw`[Download](https://files.example.com/a\_b.pdf?key\=a\+b\&sig\=q%2Br%2F\#page\=2)`;
  for (const streaming of [false, true]) {
    assert.deepEqual(parseInlineMarkdown(source, streaming), [{ kind: "link", text: "Download",
      url: "https://files.example.com/a_b.pdf?key=a+b&sig=q%2Br%2F#page=2" }]);
    assert.deepEqual(parseInlineMarkdown(source.slice(0, -1), streaming), [{ kind: "text", text: source.slice(0, -1) }],
      "an incomplete destination stays verbatim until its final delimiter arrives");
  }
  assert.deepEqual(parseInlineMarkdown("`" + source + "`"), [{ kind: "code", text: source }]);
});

test("inline code matches whole backtick runs and keeps embedded Markdown literal", () => {
  assert.deepEqual(parseInlineMarkdown("Use `` `[Literal](https://example.com)` `` then [Docs](https://example.com)."), [
    { kind: "text", text: "Use " },
    { kind: "code", text: "`[Literal](https://example.com)`" },
    { kind: "text", text: " then " },
    { kind: "link", text: "Docs", url: "https://example.com" },
    { kind: "text", text: "." },
  ]);
  assert.deepEqual(parseInlineMarkdown("``one`two```three``"), [{ kind: "code", text: "one`two```three" }]);
  assert.deepEqual(parseInlineMarkdown("`  padded  ` and `   `"), [
    { kind: "code", text: " padded " }, { kind: "text", text: " and " }, { kind: "code", text: "   " },
  ]);
  assert.deepEqual(parseInlineMarkdown("``pending`tail"), [{ kind: "text", text: "``pending`tail" }]);
});

test("unfinished inline code keeps links literal while its closing delimiter is still streaming", () => {
  const partial = "Use `` [Literal](https://example.com) `tick`";
  assert.deepEqual(parseInlineMarkdown(partial, true), [
    { kind: "text", text: "Use " }, { kind: "literal", text: partial.slice(4) },
  ]);
  assert.deepEqual(parseInlineMarkdown(partial + " `` then [Docs](https://example.com)", true), [
    { kind: "text", text: "Use " }, { kind: "code", text: "[Literal](https://example.com) `tick`" },
    { kind: "text", text: " then " }, { kind: "link", text: "Docs", url: "https://example.com" },
  ]);
  const single = "Use `[Literal](https://example.com)";
  assert.deepEqual(parseInlineMarkdown(single, true), [
    { kind: "text", text: "Use " }, { kind: "literal", text: single.slice(4) },
  ]);
  assert.deepEqual(parseInlineMarkdown(single + "`", true), [
    { kind: "text", text: "Use " }, { kind: "code", text: "[Literal](https://example.com)" },
  ]);
  assert.deepEqual(parseInlineMarkdown(single), [
    { kind: "text", text: "Use `" }, { kind: "link", text: "Literal", url: "https://example.com" },
  ], "a completed message with an unmatched delimiter keeps ordinary Markdown semantics");
});

test("inline code spans soft line breaks without activating links", () => {
  const partial = "Use `` [Literal](https://example.com)\nwith `tick`";
  assert.deepEqual(parseInlineMarkdown(partial + "\n", true), [
    { kind: "text", text: "Use " }, { kind: "literal", text: partial.slice(4) + "\n" },
  ]);
  assert.deepEqual(parseInlineMarkdown(partial + " ``\n- [Docs](https://example.com)", true), [
    { kind: "text", text: "Use " }, { kind: "code", text: "[Literal](https://example.com) with `tick`" },
    { kind: "text", text: "\n- " }, { kind: "link", text: "Docs", url: "https://example.com" },
  ]);
  assert.deepEqual(parseInlineMarkdown("`first\r\nsecond\rthird`"), [{ kind: "code", text: "first second third" }]);
});

test("unfinished streaming code shields list markers while surrounding lists still render", () => {
  const prefix = "- Actual list\nSource ";
  const code = "`line\n- [Literal](https://example.com)\n* source";
  assert.deepEqual(parseInlineMarkdown(prefix + code, true), [
    { kind: "text", text: prefix }, { kind: "literal", text: code },
  ]);
  assert.deepEqual(parseInlineMarkdown(prefix + code + "`\n- Next item", true), [
    { kind: "text", text: prefix }, { kind: "code", text: "line - [Literal](https://example.com) * source" },
    { kind: "text", text: "\n- Next item" },
  ]);
  assert.equal(parseInlineMarkdown(code).some((span) => span.kind === "link"), true,
    "a final message without a closing delimiter resumes normal Markdown semantics");
});

test("inline delimiters cannot consume a following paragraph", () => {
  const text = "Use `[Docs](https://example.com)\n \nThe next paragraph`";
  assert.deepEqual(parseInlineMarkdown(text, true), [
    { kind: "text", text: "Use `" }, { kind: "link", text: "Docs", url: "https://example.com" },
    { kind: "text", text: "\n \nThe next paragraph" }, { kind: "literal", text: "`" },
  ]);
});

test("unmatched inline delimiters and incomplete link destinations remain visible", () => {
  const partial = "[Guide](https://example.com/guide_(one)";
  for (const text of ["**", "****", "`", "``", "````", "**not *bold**", partial,
    "[Unsafe](javascript:alert(1))", "[".repeat(20_000), "[Link](https://example.com/".repeat(2000)]) {
    assert.deepEqual(parseInlineMarkdown(text), [{ kind: "text", text }]);
  }
  assert.deepEqual(parseInlineMarkdown(partial + ")"), [{ kind: "link", text: "Guide", url: "https://example.com/guide_(one)" }]);
  assert.deepEqual(parseInlineMarkdown("[unfinished](https://example.com/ then **bold**"), [
    { kind: "text", text: "[unfinished](https://example.com/ then " }, { kind: "strong", text: "bold" },
  ]);
});

test("GFM pipe tables parse headers, rows and delimiter alignment", () => {
  assert.deepEqual(parseMarkdown("| Name | Qty |\n| :--- | ---: |\n| Apple | 3 |\n| Pear | 12 |"), [
    { type: "table", table: { headers: ["Name", "Qty"], rows: [["Apple", "3"], ["Pear", "12"]], align: ["left", "right"] } },
  ]);
  assert.deepEqual(parseMarkdown("Name | Qty\n:---: | ---\nApple | 3"), [
    { type: "table", table: { headers: ["Name", "Qty"], rows: [["Apple", "3"]], align: ["center", undefined] } },
  ]);
  assert.deepEqual(parseMarkdown("Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\nOutro"), [
    { type: "text", text: "Intro\n" },
    { type: "table", table: { headers: ["a", "b"], rows: [["1", "2"]], align: [undefined, undefined] } },
    { type: "text", text: "Outro" },
  ]);
});

test("tables without a valid delimiter row stay plain text", () => {
  const incomplete = "| Name | Qty |\n| Apple | 3 |";
  assert.deepEqual(parseMarkdown(incomplete), [{ type: "text", text: incomplete }]);
  const mismatched = "| a | b |\n| --- |\n| 1 | 2 |";
  assert.deepEqual(parseMarkdown(mismatched), [{ type: "text", text: mismatched }]);
  assert.deepEqual(parseMarkdown("---"), [{ type: "text", text: "---" }]);
});

test("task lists parse checked state and stay separate from surrounding text", () => {
  assert.deepEqual(parseMarkdown("- [ ] Write docs\n- [x] Ship it"), [
    { type: "tasks", items: [{ checked: false, text: "Write docs" }, { checked: true, text: "Ship it" }] },
  ]);
  assert.deepEqual(parseMarkdown("Intro\n- [ ] one\n* [X] two\nOutro"), [
    { type: "text", text: "Intro" },
    { type: "tasks", items: [{ checked: false, text: "one" }, { checked: true, text: "two" }] },
    { type: "text", text: "Outro" },
  ]);
  assert.deepEqual(parseMarkdown("- plain bullet"), [{ type: "text", text: "- plain bullet" }]);
});

test("fenced code keeps table and task syntax verbatim", () => {
  assert.deepEqual(parseMarkdown("```js\n- [ ] todo\n| a | b |\n| --- | --- |\n```"), [
    { type: "code", language: "js", text: "- [ ] todo\n| a | b |\n| --- | --- |" },
  ]);
  assert.deepEqual(parseMarkdown("Before\n```\ncode\n```\nAfter"), [
    { type: "text", text: "Before" },
    { type: "code", text: "code" },
    { type: "text", text: "After" },
  ]);
});
