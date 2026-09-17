// Check every committed op entry for the stale-locals bug (a grouped leaf
// whose local caches no longer agree with its world pose — see
// compositionOps' assertGroupLocalsConsistent). Set here rather than in a
// setup module that imports the engine: a global setup file that pulled in
// compositionOps would resolve the native bridge for real and defeat the
// jest.mock() in every suite that mocks it.
process.env.ASSERT_GROUP_LOCALS = '1';
