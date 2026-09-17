# Zakura Bot UX — mirror Grok Bot

User reference screenshots: `docs/ux-grokbot-reference/*.jpg` (2026-09-17).

## Principles
1. **Near-wordless chrome.** Sidebar = avatar + name + one-line preview. Settings = sparse cards. No walls of helper text.
2. **Chat = bubbles.** Assistant/user text only. No process dumps in the transcript.
3. **Tools are invisible.** Never show tool name, args, stdout, or expandable detail. At most a tiny pill while running: `Searching…` / `Running code…` (generic verbs). When done, the pill disappears; only the final answer remains.
4. **Approvals stay quiet.** Needed approvals are short cards (title + approve/deny), not essays. Prefer the same sparse Grok Bot feel.
5. **Capability without clutter.** Desktop, files, bots, groups exist via icons/menus, not banners.

## Anti-patterns (remove)
- `ActivityChip` showing `tool.name`, status words like Done/Failed, chevron-expand `tool.detail`
- Verbose connection banners, long empty-state essays
- Dumping tool_activity payloads into message text
