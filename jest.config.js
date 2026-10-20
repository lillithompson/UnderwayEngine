module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: [
    '<rootDir>/packages/engine/src',
    '<rootDir>/packages/shell/src',
    '<rootDir>/packages/editor-ui/src',
    '<rootDir>/packages/editor/src',
    '<rootDir>/tooling',
  ],
  testPathIgnorePatterns: ['/node_modules/', 'test-utils\\.ts$', 'facet-pipeline\\.ts$'],
  moduleNameMapper: {
    '^@/engine/(.*)$': '<rootDir>/packages/engine/src/$1',
    '^@/native-shell/(.*)$': '<rootDir>/packages/shell/src/$1',
    '^@/editor-ui$': '<rootDir>/packages/editor-ui/src/index.ts',
    '^@/editor-ui/(.*)$': '<rootDir>/packages/editor-ui/src/$1',
    '^@/editor/(.*)$': '<rootDir>/packages/editor/src/$1',
    '^expo-constants$': '<rootDir>/shims/expo-constants',
    '^react-native$': '<rootDir>/shims/react-native',
    '^expo-file-system$': '<rootDir>/shims/expo-file-system',
    '^expo-sharing$': '<rootDir>/shims/expo-sharing',
    // Real idb-keyval needs IndexedDB; tests run in node, so the engine's
    // storage reads and writes an in-memory map (a test that mocks the
    // module itself still wins).
    '^idb-keyval$': '<rootDir>/shims/idb-keyval',
    '\\./loadTile$': '<rootDir>/packages/engine/src/__mocks__/loadTile',
  },
  workerIdleMemoryLimit: '1GB',
};
