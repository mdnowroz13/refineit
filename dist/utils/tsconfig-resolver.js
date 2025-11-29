import fs from 'fs';
import path from 'path';
function normalizePath(p) {
    return path.resolve(p).replace(/\\/g, '/');
}
let cachedTsConfig = null;
function readTsConfig() {
    if (cachedTsConfig)
        return cachedTsConfig;
    try {
        const cfgPath = path.resolve('tsconfig.json');
        if (!fs.existsSync(cfgPath))
            return (cachedTsConfig = {});
        const raw = fs.readFileSync(cfgPath, 'utf8');
        const parsed = JSON.parse(raw);
        const compiler = parsed.compilerOptions || {};
        const baseUrl = compiler.baseUrl ? path.resolve(path.dirname(cfgPath), compiler.baseUrl) : undefined;
        const paths = compiler.paths || undefined;
        cachedTsConfig = { baseUrl, paths };
        return cachedTsConfig;
    }
    catch {
        cachedTsConfig = {};
        return cachedTsConfig;
    }
}
function applyTsConfigPathCandidates(importSpecifier) {
    const cfg = readTsConfig();
    if (!cfg.paths || !cfg.baseUrl)
        return [];
    const results = [];
    for (const pattern of Object.keys(cfg.paths)) {
        const replacements = cfg.paths[pattern];
        if (pattern.indexOf('*') === -1) {
            if (pattern === importSpecifier) {
                for (const repl of replacements) {
                    const candidate = repl.replace(/\*/g, '');
                    results.push(path.resolve(cfg.baseUrl, candidate));
                }
            }
        }
        else {
            const prefix = pattern.split('*')[0];
            if (importSpecifier.startsWith(prefix)) {
                const tail = importSpecifier.substring(prefix.length);
                for (const repl of replacements) {
                    const candidate = repl.replace('*', tail);
                    results.push(path.resolve(cfg.baseUrl, candidate));
                }
            }
        }
    }
    return results.map(normalizePath);
}
function tryExtensions(prefixAbs) {
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss', '.less'];
    const candidates = [];
    for (const e of exts)
        candidates.push(normalizePath(prefixAbs + e));
    for (const e of exts)
        candidates.push(normalizePath(path.join(prefixAbs, 'index' + e)));
    candidates.unshift(normalizePath(prefixAbs));
    return candidates;
}
export function getCandidatesForImport(currentFile, importPath) {
    const normalizedCurrent = normalizePath(currentFile);
    const candidates = [];
    if (importPath.startsWith('./') || importPath.startsWith('../') || importPath.startsWith('/')) {
        const dir = path.dirname(normalizedCurrent);
        const absPrefix = normalizePath(path.resolve(dir, importPath));
        candidates.push(...tryExtensions(absPrefix));
        return [...new Set(candidates)];
    }
    if (importPath.startsWith('@/')) {
        const projectRoot = process.cwd();
        const rel = importPath.substring(2);
        const absPrefix = normalizePath(path.join(projectRoot, 'src', rel));
        candidates.push(...tryExtensions(absPrefix));
        return [...new Set(candidates)];
    }
    const mapped = applyTsConfigPathCandidates(importPath);
    for (const mp of mapped)
        candidates.push(...tryExtensions(mp));
    try {
        const projectRoot = process.cwd();
        const absPrefix = normalizePath(path.join(projectRoot, importPath));
        candidates.push(...tryExtensions(absPrefix));
    }
    catch {
    }
    try {
        const projectRoot = process.cwd();
        const absPrefix = normalizePath(path.join(projectRoot, importPath));
        candidates.push(...tryExtensions(absPrefix));
    }
    catch { }
    return [...new Set(candidates)];
}
export function resolveImportWithTsConfig(currentFile, importPath, fileLookup) {
    const candidates = getCandidatesForImport(currentFile, importPath);
    for (const cand of candidates) {
        if (fileLookup.has(cand))
            return fileLookup.get(cand);
    }
    return undefined;
}
//# sourceMappingURL=tsconfig-resolver.js.map