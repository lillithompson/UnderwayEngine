// Test shim: see expo-asset shim. Mirrors the two GLView statics loadTile calls.
export type ExpoWebGLRenderingContext = WebGL2RenderingContext & { endFrameEXP?: () => void };
export const GLView: {
  createContextAsync(): Promise<ExpoWebGLRenderingContext>;
  destroyContextAsync(ctx: unknown): Promise<void>;
} = {
  createContextAsync: async () => {
    throw new Error('expo-gl shim: not available outside the Expo app');
  },
  destroyContextAsync: async () => {},
};
