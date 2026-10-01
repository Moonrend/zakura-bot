import type { Agent } from "./types";

export interface BotGroups { sections: { id: string; name: string }[]; assignments: Record<string, string>; pinned: string[] }
export type GroupAction =
  | { type: "create"; id: string; name: string }
  | { type: "rename"; id: string; name: string }
  | { type: "move"; id: string; direction: -1 | 1 }
  | { type: "delete"; id: string }
  | { type: "assign"; botKey: string; sectionId: string | null }
  | { type: "pin"; botKey: string }
  | { type: "unpin"; botKey: string };

export const emptyGroups = (): BotGroups => ({ sections: [], assignments: {}, pinned: [] });
export const botGroupKey = (agent: Agent) => agent.bindingId ?? agent.id;
const safeId = (id: unknown): id is string => typeof id === "string" && !!id && !Object.hasOwn(Object.prototype, id) && id !== "prototype";
export function parseGroups(value: unknown): BotGroups {
  if (!value || typeof value !== "object") return emptyGroups();
  const candidate = value as Partial<BotGroups>;
  const seen = new Set<string>();
  const sections = Array.isArray(candidate.sections) ? candidate.sections.filter((row) => {
    if (!row || !safeId(row.id) || typeof row.name !== "string" || !row.name.trim() || seen.has(row.id)) return false;
    seen.add(row.id); return true;
  }).map((row) => ({ id: row.id, name: row.name.trim().slice(0, 64) })) : [];
  const assignments = Object.fromEntries(Object.entries(candidate.assignments ?? {}).filter(([id, section]) => safeId(id) && seen.has(section)));
  const pinned: string[] = [];
  if (Array.isArray(candidate.pinned)) for (const botKey of candidate.pinned) {
    if (safeId(botKey) && !pinned.includes(botKey)) pinned.push(botKey);
  }
  return { sections, assignments, pinned };
}
export function reduceGroups(state: BotGroups, action: GroupAction): BotGroups {
  if (action.type === "assign") {
    if (!safeId(action.botKey)) throw new Error("Invalid bot.");
    if (action.sectionId && !state.sections.some((row) => row.id === action.sectionId)) throw new Error("This group no longer exists.");
    const assignments = { ...state.assignments };
    if (action.sectionId) assignments[action.botKey] = action.sectionId;
    else delete assignments[action.botKey];
    return { ...state, assignments };
  }
  if (action.type === "create" || action.type === "rename") {
    const name = action.name.trim();
    if (!name || name.length > 64) throw new Error("Use a group name of 1–64 characters.");
    if (state.sections.some((row) => row.id !== action.id && row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A group with this name already exists.");
    if (action.type === "create") {
      if (!safeId(action.id) || state.sections.some((row) => row.id === action.id)) throw new Error("Invalid group.");
      return { ...state, sections: [...state.sections, { id: action.id, name }] };
    }
    return { ...state, sections: state.sections.map((row) => row.id === action.id ? { ...row, name } : row) };
  }
  if (action.type === "delete") return { ...state, sections: state.sections.filter((row) => row.id !== action.id),
    assignments: Object.fromEntries(Object.entries(state.assignments).filter(([, value]) => value !== action.id)) };
  if (action.type === "pin" || action.type === "unpin") {
    if (!safeId(action.botKey)) throw new Error("Invalid bot.");
    const pinned = action.type === "pin"
      ? (state.pinned.includes(action.botKey) ? state.pinned : [...state.pinned, action.botKey])
      : state.pinned.filter((botKey) => botKey !== action.botKey);
    return { ...state, pinned };
  }
  const sections = [...state.sections], index = sections.findIndex((row) => row.id === action.id), next = index + action.direction;
  if (index >= 0 && next >= 0 && next < sections.length) [sections[index], sections[next]] = [sections[next]!, sections[index]!];
  return { ...state, sections };
}
export function groupedAgents(agents: Agent[], groups: BotGroups) {
  const pinnedKeys = new Set(groups.pinned);
  const pinned = agents.filter((agent) => pinnedKeys.has(botGroupKey(agent)));
  const rest = agents.filter((agent) => !pinnedKeys.has(botGroupKey(agent)));
  const sections = groups.sections.map((section) => ({ ...section, agents: rest.filter((agent) => groups.assignments[botGroupKey(agent)] === section.id) }));
  return [
    ...(pinned.length ? [{ id: "pinned", name: "Pinned", agents: pinned }] : []),
    ...sections,
    { id: "ungrouped", name: "Ungrouped", agents: rest.filter((agent) => !groups.sections.some((section) => section.id === groups.assignments[botGroupKey(agent)])) },
  ];
}
