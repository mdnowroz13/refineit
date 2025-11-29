/** jest.config.cjs */
module.exports = {
    // Use the standard preset (not the ESM one) to avoid experimental flags
    preset: 'ts-jest',
    testEnvironment: 'node',

    // Keep your timeout and matchers
    testTimeout: 20000,
    testMatch: ['**/__tests__/**/*.test.ts'],

    // Clean up extensions
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                // CRITICAL: We force CJS for tests to stop the "import" error
                // regardless of what your package.json says.
                tsconfig: {
                    module: 'commonjs',
                    moduleResolution: 'node',
                    allowSyntheticDefaultImports: true,
                    esModuleInterop: true
                },
                diagnostics: { warnOnly: true }
            }
        ]
    },

    // Keep your node_modules ignore rules
    transformIgnorePatterns: ['/node_modules/'],

    // Keep your reporters
    reporters: [
        'default',
        ['jest-junit', { outputName: 'jest-junit.xml' }]
    ],

    // This mapper is still needed to strip .js extensions from your imports
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    }
};