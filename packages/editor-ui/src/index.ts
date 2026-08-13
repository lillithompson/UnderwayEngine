// Public surface of @underway/editor-ui.
//
// Adapter types + theme + logic are pure (no react-native) and safe to
// import from anywhere; they are unit-tested in a node environment.
// Components are React Native (react-native-web on the web target) and are
// added per phase — import them only from UI code.

export * from './adapter';
export * from './theme';
export * from './logic/outlineTree';
export * from './logic/dragReorder';
export * from './logic/rename';
export * from './logic/toolbarBehavior';
export * from './logic/hsv';
export * from './logic/eyedropper';
export * from './logic/imageEdit';
export * from './logic/svgEdit';
export * from './logic/layout';
export * from './logic/multiOptions';
export * from './logic/tint';

// Components (React Native).
export { SceneOutlinePanel } from './components/SceneOutlinePanel';
export { RenameModal } from './components/RenameModal';
export { CapsuleButton } from './components/CapsuleButton';
export { TopBar } from './components/TopBar';
export { UndoRedoPanel } from './components/UndoRedoPanel';
export { BrushControlsPanel } from './components/BrushControlsPanel';
export { GridQuickActionPanel } from './components/GridQuickActionPanel';
export { ObjectPropertiesPanel } from './components/ObjectPropertiesPanel';
export { ColorPickerModal } from './components/ColorPickerModal';
// Exported so a host painting its own preview of a picked color (a canvas
// overlay, a custom swatch) shows opacity the same way the package does.
export { CheckerboardFill, ColorSwatchFill } from './components/ColorSwatch';
export { EyedropperOverlay } from './components/EyedropperOverlay';
export { EndpointsBar } from './components/EndpointsBar';
export { LayoutBar } from './components/LayoutBar';
