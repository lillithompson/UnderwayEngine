// The HOST-TOOL registry: how an app puts a tool of its own on the shared
// toolbar. The standard tools (toolIds.ts) and everything the bar knows
// about them (components/toolbarMeta.ts) live in this package; an app
// registers the tools that are its own — Sol's Plant, DrawBot's Inklings
// and Instructions, CozyJournal's Figure, Word, Pattern tile and Symmetry
// — as a list of these records, and hands the list to every toolbar
// function that has to know about them (`hostTools` parameters). The
// package never names an app's tool: what it knows about one is what the
// record says.
//
// A leaf (no imports), so a format config can list its tools against it.

/** What the bar shows for a tool: its word, and its MaterialCommunityIcons
 *  glyph name — the shape of every `TOOL_META` row. */
export interface ToolMeta {
  label: string;
  icon: string;
}

/**
 * One tool of an app's own, as the toolbar needs to know it. `T` is the
 * app's own tool-id type, so a registry typed `HostTool<SolToolId>[]` is
 * checked against the app's union — a tool in the union with no record
 * here fails `toolMetaFor`'s `Record<ToolId, …>`, exactly as a standard
 * tool without a `TOOL_META` row does.
 */
export interface HostTool<T extends string = string> extends ToolMeta {
  id: T;
  /** The MaterialCommunityIcons glyph name the button wears, as every
   *  standard tool's `TOOL_META` row carries one. A shape the font lacks
   *  is drawn by the shell, the way it already hands the top bar an
   *  `<svg>` for the line, arc and polygon buttons (ToolIcons.tsx). */
  icon: string;
  /** What arming it does — the one thing about a host tool the bar's lit
   *  state and hold rules need to know:
   *   · 'tool' (the default): the press arms it and it stays in hand, the
   *     button lights while it is, and the canvas is keyed by its id
   *     (Sol's plant: a tap plants a seed; DrawBot's bots: a tap places
   *     one; CozyJournal's rig: a tap plants a figure).
   *   · 'setting': the press toggles a setting of the canvas and arms
   *     nothing — the button never lights as the active tool and never
   *     disarms what is (CozyJournal's and DrawBot's Symmetry, which
   *     cycles Off → H → H+V → V and wears the active mode's glyph). */
  kind?: 'tool' | 'setting';
  /** The tool rides the unified content group's pushdown as a mode under
   *  its own id, after Image and Text, in the registry's order — a thing
   *  you PLACE: arming it puts nothing on the page, the tap does
   *  (CozyJournal's Figure, Word and Pattern tile). `gate` names the
   *  format flag (an `EditorConfig` field — `rigTool`, `wordTool`,
   *  `tileTool`) that offers the mode; without one it is offered wherever
   *  the group is. The row's word and glyph are the tool's own. */
  contentMode?: { gate?: string };
  /** Armed, the tool holds a MODE CAPSULE under the toolbar (the shell's
   *  under-toolbar slot — Sol's Plant tool holds its strain chips there),
   *  so a HOLD on the lit button recalls the capsule rather than doing the
   *  button's other long press (`holdRecallsModeCapsule`), as the standard
   *  groups' buttons do. */
  modeCapsule?: boolean;
}

/** A registry: the host's tools, in the order they ride the content row.
 *  `NO_HOST_TOOLS` is the empty one, for a bar with nothing of its own. */
export type HostTools = readonly HostTool[];
export const NO_HOST_TOOLS: HostTools = [];

/** The registered tool with this id, or undefined for a standard tool, a
 *  button that is not a tool ('lines', 'content' …) or nothing armed. */
export function hostTool(tools: HostTools, id: string | null | undefined): HostTool | undefined {
  if (!id) return undefined;
  return tools.find((t) => t.id === id);
}

/** The registry's rows as a `TOOL_META`-shaped table over the app's own
 *  ids — what `toolMetaFor` lays over the standard table. */
export function hostToolMeta<T extends string>(tools: readonly HostTool<T>[]): Record<T, ToolMeta> {
  const meta = {} as Record<T, ToolMeta>;
  for (const t of tools) meta[t.id] = { label: t.label, icon: t.icon };
  return meta;
}
