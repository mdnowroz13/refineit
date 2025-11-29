// __tests__/fixer.test.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fixImports } from '../src/utils/fixer.js';
function tmpDir() {
    return path.join(os.tmpdir(), 'refineit-fixer-' + Math.random().toString(36).slice(2, 9));
}
describe('fixer - import cleanup', () => {
    let root;
    beforeAll(async () => {
        root = tmpDir();
        await fs.mkdir(root, { recursive: true });
        // create helper and consumer with unused imports
        await fs.writeFile(path.join(root, 'helper.ts'), `export const a = 1; export const b = 2;`, 'utf8');
        await fs.writeFile(path.join(root, 'consumer.ts'), `import { a, b } from './helper'; console.log(a);`, 'utf8');
    });
    test('removes unused named imports and preserves used ones', async () => {
        const consumer = path.join(root, 'consumer.ts');
        // simulate unused import 'b'
        const results = await fixImports([{ file: consumer, name: 'b', line: 1 }]);
        expect(Array.isArray(results)).toBe(true);
        const out = await fs.readFile(consumer, 'utf8');
        expect(out.includes('b')).toBe(false);
        expect(out.includes('a')).toBe(true);
    });
});
