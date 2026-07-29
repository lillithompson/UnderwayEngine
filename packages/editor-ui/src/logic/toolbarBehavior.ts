// Facet toolbar toggle semantics, project-agnostic (string tool ids):
// pressing an inactive tool selects it; pressing the active tool drops back
// to the format's default (first) tool; pressing the default while active is
// a no-op. The shared TopBar applies this before calling model.onSelectTool
// so apps receive the already-resolved tool.

export function nextToolOnPress(tools: readonly string[], activeTool: string, pressed: string): string {
  if (pressed !== activeTool) return pressed;
  return tools[0] ?? pressed;
}
