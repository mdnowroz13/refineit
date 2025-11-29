import { cosmiconfig } from 'cosmiconfig';
const explorer = cosmiconfig('refineit');
export async function loadConfig() {
    const result = await explorer.search();
    const defaults = {
        ignore: [
            'node_modules/**',
            'dist/**',
            'build/**',
            '**/*.d.ts',
            '.git/**',
            'generated/**',
            'packages/**/generated/**',
            '**/*.generated.*'
        ],
        whitelist: [],
        dirs: ['**/*.{js,ts,jsx,tsx,css}']
    };
    if (result && result.config) {
        return {
            ignore: [...defaults.ignore, ...(result.config.ignore || [])],
            whitelist: [...defaults.whitelist, ...(result.config.whitelist || [])],
            dirs: result.config.dirs || defaults.dirs
        };
    }
    return defaults;
}
//# sourceMappingURL=config.js.map