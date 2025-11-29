// src/utils/tsconfig-resolver.ts
import fs from 'fs';
import path from 'path';

type FileLookup = Map<string, string>;

function normalizePath(p: string) {
    return path.resolve(p).replace(/\\/g, '/');
}

let cachedTsConfig: { baseUrl?: string; paths?: Record<string, string[]> } | null = null;

function readTsConfig() {
    if (cachedTsConfig) return cachedTsConfig;
    try {
        const cfgPath = path.resolve('tsconfig.json');
        if (!fs.existsSync(cfgPath)) return (cachedTsConfig = {});
        const raw = fs.readFileSync(cfgPath, 'utf8');
        const parsed = JSON.parse(raw);
        const compiler = parsed.compilerOptions || {};
        const baseUrl = compiler.baseUrl ? path.resolve(path.dirname(cfgPath), compiler.baseUrl) : undefined;
        const paths = compiler.paths || undefined;
        cachedTsConfig = { baseUrl, paths };
        return cachedTsConfig;
    } catch {
        cachedTsConfig = {};
        return cachedTsConfig;
    }
}

function applyTsConfigPathCandidates(importSpecifier: string) {
    const cfg = readTsConfig();
    if (!cfg.paths || !cfg.baseUrl) return [];
    const results: string[] = [];

    for (const pattern of Object.keys(cfg.paths)) {
        const replacements = cfg.paths[pattern];
        if (pattern.indexOf('*') === -1) {
            if (pattern === importSpecifier) {
                for (const repl of replacements) {
                    const candidate = repl.replace(/\*/g, '');
                    results.push(path.resolve(cfg.baseUrl, candidate));
                }
            }
        } else {
            const prefix = pattern.split('*')[0];
            if (importSpecifier.startsWith(prefix)) {
                const tail = importSpecifier.substring(prefix.length);
                for (const repl of replacements) {
                    const candidate = repl.replace('*', tail);
                    results.push(path.resolve(cfg.baseUrl!, candidate));
                }
            }
        }
    }

    return results.map(normalizePath);
}

function tryExtensions(prefixAbs: string) {
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss', '.less'];
    const candidates: string[] = [];

    // direct file with each ext
    for (const e of exts) candidates.push(normalizePath(prefixAbs + e));

    // index files inside folder
    for (const e of exts) candidates.push(normalizePath(path.join(prefixAbs, 'index' + e)));

    // also include raw directory path (no ext)
    candidates.unshift(normalizePath(prefixAbs));

    return candidates;
}

/**
 * getCandidatesForImport - returns a list of absolute normalized candidate paths the resolver will try
 */
export function getCandidatesForImport(currentFile: string, importPath: string): string[] {
    const normalizedCurrent = normalizePath(currentFile);
    const candidates: string[] = [];

    // 1) Relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../') || importPath.startsWith('/')) {
        const dir = path.dirname(normalizedCurrent);
        const absPrefix = normalizePath(path.resolve(dir, importPath));
        candidates.push(...tryExtensions(absPrefix));
        return [...new Set(candidates)];
    }

    // 2) "@/..." style
    if (importPath.startsWith('@/')) {
        const projectRoot = process.cwd();
        const rel = importPath.substring(2);
        const absPrefix = normalizePath(path.join(projectRoot, 'src', rel));
        candidates.push(...tryExtensions(absPrefix));
        return [...new Set(candidates)];
    }

    // 3) tsconfig paths
    const mapped = applyTsConfigPathCandidates(importPath);
    for (const mp of mapped) candidates.push(...tryExtensions(mp));

    // 4) package-like / monorepo local packages (project root join)
    try {
        const projectRoot = process.cwd();
        const absPrefix = normalizePath(path.join(projectRoot, importPath));
        candidates.push(...tryExtensions(absPrefix));
    } catch {
        // ignore
    }

    // 5) fallback: node_modules / external - we still return a guess (projectRoot/importPath)
    try {
        const projectRoot = process.cwd();
        const absPrefix = normalizePath(path.join(projectRoot, importPath));
        candidates.push(...tryExtensions(absPrefix));
    } catch { }

    // unique and return
    return [...new Set(candidates)];
}

/**
 * resolveImportWithTsConfig - returns mapped fileLookup value if found, otherwise undefined
 */
export function resolveImportWithTsConfig(currentFile: string, importPath: string, fileLookup: FileLookup): string | undefined {
    const candidates = getCandidatesForImport(currentFile, importPath);
    for (const cand of candidates) {
        if (fileLookup.has(cand)) return fileLookup.get(cand);
    }
    return undefined;
}
