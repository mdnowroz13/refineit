/** jest.config.cjs */
module.exports = {
    preset: 'ts-jest/presets/js-with-ts-esm',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.ts'],
    // Order matters here! Jest looks for ts/tsx first.
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    transformIgnorePatterns: ['/node_modules/'],
    testTimeout: 20000,
    globals: {
        'ts-jest': {
            useESM: true,
            tsconfig: 'tsconfig.json',
            diagnostics: { warnOnly: true }
        }
    },
    reporters: [
        'default',
        ['jest-junit', { output: 'jest-junit.xml' }]
    ],
    moduleNameMapper: {
        // Map to $1 (no extension) so Jest finds .ts in src OR .js in node_modules
        '^(.*\\/src\\/.*)\\.js$': '$1',
        '^(.*\\/src\\/.*)\\.jsx$': '$1',
        '^(\\.{1,2}\\/.*)\\.js$': '$1',
        '^(\\.{1,2}\\/.*)\\.jsx$': '$1'
    }
};