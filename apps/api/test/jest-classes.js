/**
 * Test classification by file name (see docs/TESTING_STRATEGY.md):
 *   unit         *.spec.ts              pure logic: no database, no network
 *   integration  *.integration.spec.ts  and everything under database/__tests__ (in-memory PGlite, real migrations)
 *   security     *.security.spec.ts     secrets, injection and access checks
 *   performance  *.perf.spec.ts         time and memory budgets on hot paths
 *   regression   *.regression.spec.ts   one test per fixed bug (also run by `test:regression`)
 * End-to-end API tests (test/*.e2e-spec.ts) use jest-e2e.json.
 */
const NON_UNIT = '(\.(integration|perf|security|regression)\.spec\.ts$|/database/__tests__/)';
const IGNORE = ['/node_modules/', '/dist/'];

const CLASSES = {
  unit: { testRegex: '\.spec\.ts$', testPathIgnorePatterns: [...IGNORE, NON_UNIT] },
  integration: { testRegex: '(\.integration\.spec\.ts$|/database/__tests__/.*\.spec\.ts$)', testPathIgnorePatterns: IGNORE },
  security: { testRegex: '\.security\.spec\.ts$', testPathIgnorePatterns: IGNORE },
  performance: { testRegex: '\.perf\.spec\.ts$', testPathIgnorePatterns: IGNORE, testTimeout: 60000 },
  regression: { testRegex: '\.regression\.spec\.ts$', testPathIgnorePatterns: IGNORE },
};

exports.CLASSES = CLASSES;
exports.classConfig = (name) => ({
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  roots: ['<rootDir>/src'],
  transform: { '^.+\.(t|j)s$': ['ts-jest', { isolatedModules: true }] },
  testEnvironment: 'node',
  passWithNoTests: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@orion/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  ...CLASSES[name],
});
