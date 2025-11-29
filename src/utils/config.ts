import { cosmiconfig } from 'cosmiconfig';

export interface RefineItConfig {
    ignore: string[];
    whitelist: string[]; // Files to NEVER delete
    dirs: string[];      // Directories to scan
}

const explorer = cosmiconfig('refineit');

export async function loadConfig(): Promise<RefineItConfig> {
    const result = await explorer.search();

    // Default Settings — added generated/** and **/*.generated.* to defaults
    const defaults: RefineItConfig = {
        ignore: [
            'node_modules/**',
            'dist/**',
            'build/**',
            '**/*.d.ts',
            '.git/**',
            'generated/**',           // <-- ignore generated folders by default
            'packages/**/generated/**',
            '**/*.generated.*'        // <-- ignore files like file.generated.js
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
