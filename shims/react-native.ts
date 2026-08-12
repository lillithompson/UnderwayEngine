// Test shim: the engine references react-native's View type only (no runtime
// import). Mirrors the one method the engine calls on a View ref.
export type View = {
  measureInWindow(
    callback: (x: number, y: number, width: number, height: number) => void,
  ): void;
};

// The bridge's native-only helpers (shareImage.ts) DO import at runtime, so
// these carry a value as well as a type. Tests that exercise them replace the
// module with a jest.mock factory; this is only what stands in when they
// don't, and what typechecking reads.
export const Platform: { OS: string } = { OS: 'ios' };

export interface ShareContent {
  message?: string;
  url?: string;
  title?: string;
}

export const Share: {
  share(content: ShareContent): Promise<{ action: string }>;
  sharedAction: string;
  dismissedAction: string;
} = {
  share: async () => ({ action: 'sharedAction' }),
  sharedAction: 'sharedAction',
  dismissedAction: 'dismissedAction',
};
