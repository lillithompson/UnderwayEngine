// Toolbar toggle semantics, project-agnostic (string tool ids): pressing an
// inactive tool selects it; pressing the ACTIVE tool untoggles it, leaving no
// tool active (null). The shared TopBar applies this before calling
// model.onSelectTool so apps receive the already-resolved tool.
//
// Every tool untoggles, including the first — there is no privileged default
// that can't be switched off, and no tool list is needed to resolve a press.
// With nothing active an app is expected to fall back to view-only gestures
// (pan / zoom), which is the point of the state: a way to move around the
// canvas with no risk of grabbing, selecting, or placing anything.

export function nextToolOnPress(activeTool: string | null, pressed: string): string | null {
  return pressed === activeTool ? null : pressed;
}
