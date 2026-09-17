import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInlineMarkdown, parseMarkdownBlocks } from "../lib/markdown";

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
