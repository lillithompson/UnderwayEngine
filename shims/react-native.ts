// Test shim: the engine references react-native's View type only (no runtime
// import). Mirrors the one method the engine calls on a View ref.
export type View = {
  measureInWindow(
    callback: (x: number, y: number, width: number, height: number) => void,
  ): void;
};
