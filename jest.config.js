module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: [
    '<rootDir>/packages/engine/src',
    '<rootDir>/packages/shell/src',
    '<rootDir>/packages/editor-ui/src',
  ],
  testPathIgnorePatterns: ['/node_modules/', 'test-utils\\.ts$', 'facet-pipeline\\.ts$'],
  moduleNameMapper: {
    '^@/engine/(.*)$': '<rootDir>/packages/engine/src/$1',
    '^@/native-shell/(.*)$': '<rootDir>/packages/shell/src/$1',
    '^@/editor-ui/(.*)$': '<rootDir>/packages/editor-ui/src/$1',
    '^expo-constants$': '<rootDir>/shims/expo-constants',
    '^react-native$': '<rootDir>/shims/react-native',
    '^expo-file-system$': '<rootDir>/shims/expo-file-system',
    '^expo-sharing$': '<rootDir>/shims/expo-sharing',
    '\\./loadTile$': '<rootDir>/packages/engine/src/__mocks__/loadTile',
  },
  workerIdleMemoryLimit: '1GB',
};
