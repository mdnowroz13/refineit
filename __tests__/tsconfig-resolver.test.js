// __tests__/tsconfig-resolver.test.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getCandidatesForImport, resolveImportWithTsConfig } from '../src/utils/tsconfig-resolver.js';
function tmpDir() {
    return path.join(os.tmpdir(), 'refineit-test-' + Math.random().toString(36).slice(2, 9));
}
describe('tsconfig-resolver', () => {
    let root;
    beforeAll(async () => {
        root = tmpDir();
        await fs.mkdir(root, { recursive: true });
        // minimal tsconfig with baseUrl and paths
        const cfg = {
            compilerOptions: {
                baseUrl: './',
                paths: {
                    "@app/*": ["src/app/*"],
                    "@lib": ["src/lib/index.ts"]
                }
            }
        };
        await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify(cfg, null, 2), 'utf8');
        // create candidate files
        await fs.mkdir(path.join(root, 'src', 'app'), { recursive: true });
        await fs.writeFile(path.join(root, 'src', 'app', 'foo.ts'), 'export const foo = 1', 'utf8');
        await fs.mkdir(path.join(root, 'src', 'lib'), { recursive: true });
        await fs.writeFile(path.join(root, 'src', 'lib', 'index.ts'), 'export const lib = true', 'utf8');
        process.chdir(root); // run resolver relative to this root
    });
    afterAll(async () => {
        // best-effort cleanup
        try {
            process.chdir(path.resolve(__dirname, '..'));
        }
        catch { }
    });
    test('getCandidatesForImport returns candidates for tsconfig paths and relative paths', async () => {
        const c1 = getCandidatesForImport(path.join(root, 'src', 'app', 'foo.ts'), '@/missing'); // fallback
        expect(Array.isArray(c1)).toBe(true);
        const c2 = getCandidatesForImport(path.join(root, 'src', 'app', 'foo.ts'), '@app/foo');
        expect(c2.some(p => p.includes('src/app/foo'))).toBe(true);
        const c3 = getCandidatesForImport(path.join(root, 'src', 'app', 'foo.ts'), '@lib');
        expect(c3.some(p => p.endsWith('src/lib/index.ts') || p.includes('src/lib/index'))).toBe(true);
    });
    test('resolveImportWithTsConfig resolves when fileLookup includes candidate', () => {
        const fileLookup = new Map();
        const candidate = path.resolve(root, 'src', 'app', 'foo.ts').replace(/\\/g, '/');
        fileLookup.set(candidate, candidate);
        const resolved = resolveImportWithTsConfig(path.join(root, 'src', 'app', 'foo.ts').replace(/\\/g, '/'), '@app/foo', fileLookup);
        expect(resolved).toBe(candidate);
    });
});
