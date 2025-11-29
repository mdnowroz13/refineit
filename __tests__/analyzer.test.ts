// __tests__/analyzer.test.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { analyzeCodebase } from '../src/utils/analyzer.js';

function tmpDir() {
    return path.join(os.tmpdir(), 'refineit-analyzer-' + Math.random().toString(36).slice(2, 9));
}

describe('analyzer (basic)', () => {
    let root: string;
    beforeAll(async () => {
        root = tmpDir();
        await fs.mkdir(root, { recursive: true });

        // create files:
        // helper.ts (exported and used)
        await fs.writeFile(path.join(root, 'helper.ts'), 'export const a = 1;', 'utf8');
        // main.ts imports helper (used)
        await fs.writeFile(path.join(root, 'main.ts'), `import { a } from './helper'; console.log(a);`, 'utf8');
        // ghost.ts not imported
        await fs.writeFile(path.join(root, 'ghost.ts'), `export const ghost = 1;`, 'utf8');
        // file with TODO and FIXME
        await fs.writeFile(path.join(root, 'todo.ts'), `// TODO: test\n// FIXME: later\n`, 'utf8');
        // file with duplicate content (same as helper)
        await fs.writeFile(path.join(root, 'dup.ts'), 'export const a = 1;', 'utf8');
    });

    test('detects dead files, todos and duplicates', async () => {
        const files = [
            path.join(root, 'helper.ts'),
            path.join(root, 'main.ts'),
            path.join(root, 'ghost.ts'),
            path.join(root, 'todo.ts'),
            path.join(root, 'dup.ts'),
        ];
        const report = await analyzeCodebase(files, []);
        expect(report.totalTodos).toBeGreaterThanOrEqual(2);
        // ghost.ts should be detected as dead
        expect(report.deadFiles.some(f => f.endsWith('ghost.ts'))).toBe(true);
        // duplicates should detect dup.ts as duplicate
        expect(report.duplicatesCount).toBeGreaterThanOrEqual(1);
    });
});
