// Test shim: engine code reads Constants.expoConfig?.extra for optional config.
const Constants: { expoConfig?: { extra?: Record<string, unknown> } } = {};
export default Constants;
