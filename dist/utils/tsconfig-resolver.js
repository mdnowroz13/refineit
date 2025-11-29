import fs from "fs";
import path from "path";
function normalizePath(p) {
    return path.resolve(p).replace(/\\/g, "/");
}
let cachedTsConfig = null;
function readTsConfig() {
    if (cachedTsConfig)
        return cachedTsConfig;
    try {
        const cfgPath = path.resolve("tsconfig.json");
        if (!fs.existsSync(cfgPath))
            return (cachedTsConfig = {});
        const raw = fs.readFileSync(cfgPath, "utf8");
        const parsed = JSON.parse(raw);
        const compiler = parsed.compilerOptions || {};
        const baseUrl = compiler.baseUrl
            ? path.resolve(path.dirname(cfgPath), compiler.baseUrl)
            : undefined;
        const paths = compiler.paths || undefined;
        cachedTsConfig = { baseUrl, paths };
        return cachedTsConfig;
    }
    catch {
        cachedTsConfig = {};
        return cachedTsConfig;
    }
}
function tryExtensions(prefixAbs) {
    const exts = [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".json",
        ".css",
        ".scss",
        ".less",
        ".mjs",
        ".cjs"
    ];
    const candidates = [];
    candidates.push(normalizePath(prefixAbs));
    for (const e of exts)
        candidates.push(normalizePath(prefixAbs + e));
    for (const e of exts)
        candidates.push(normalizePath(path.join(prefixAbs, "index" + e)));
    return candidates;
}
function packageExportsCandidates(pkgName) {
    try {
        const pkgPath = require.resolve(path.join(pkgName, "package.json"), { paths: [process.cwd()] });
        const pkgDir = path.dirname(pkgPath);
        const raw = fs.readFileSync(pkgPath, "utf8");
        const obj = JSON.parse(raw);
        const cands = [];
        if (typeof obj.exports === "string") {
            cands.push(normalizePath(path.join(pkgDir, obj.exports)));
        }
        else if (typeof obj.exports === "object") {
            const keys = ["import", "require", "default", "."];
            for (const k of keys) {
                if (obj.exports[k]) {
                    const v = obj.exports[k];
                    if (typeof v === "string")
                        cands.push(normalizePath(path.join(pkgDir, v)));
                    else if (typeof v === "object" && v.default)
                        cands.push(normalizePath(path.join(pkgDir, v.default)));
                }
            }
            for (const key of Object.keys(obj.exports)) {
                const val = obj.exports[key];
                if (typeof val === "string")
                    cands.push(normalizePath(path.join(pkgDir, val)));
            }
        }
        if (obj.main)
            cands.push(normalizePath(path.join(pkgDir, obj.main)));
        cands.push(...tryExtensions(path.join(pkgDir, "index")));
        return Array.from(new Set(cands));
    }
    catch {
        return [];
    }
}
function monorepoPackageCandidates(pkgName) {
    const repoRoot = process.cwd();
    const pkFolder = path.join(repoRoot, "packages");
    const out = [];
    try {
        if (!fs.existsSync(pkFolder))
            return out;
        const kids = fs.readdirSync(pkFolder);
        for (const k of kids) {
            const p = path.join(pkFolder, k, "package.json");
            if (!fs.existsSync(p))
                continue;
            try {
                const raw = fs.readFileSync(p, "utf8");
                const obj = JSON.parse(raw);
                if (obj.name === pkgName) {
                    if (typeof obj.exports === "string")
                        out.push(normalizePath(path.join(pkFolder, k, obj.exports)));
                    if (obj.main)
                        out.push(normalizePath(path.join(pkFolder, k, obj.main)));
                    out.push(...tryExtensions(path.join(pkFolder, k, "src", "index")));
                    out.push(...tryExtensions(path.join(pkFolder, k, "index")));
                }
            }
            catch { }
        }
    }
    catch { }
    return Array.from(new Set(out));
}
export function getCandidatesForImport(currentFile, importPath) {
    const normalizedCurrent = normalizePath(currentFile);
    const candidates = [];
    const cfg = readTsConfig();
    const pushPrefix = (absPrefix) => {
        candidates.push(...tryExtensions(absPrefix));
    };
    if (importPath.startsWith("./") || importPath.startsWith("../") || importPath.startsWith("/")) {
        const dir = path.dirname(normalizedCurrent);
        const absPrefix = normalizePath(path.resolve(dir, importPath));
        pushPrefix(absPrefix);
        return [...new Set(candidates)];
    }
    if (importPath.startsWith("@/")) {
        const projectRoot = process.cwd();
        const rel = importPath.substring(2);
        const absPrefix = normalizePath(path.join(projectRoot, "src", rel));
        pushPrefix(absPrefix);
        return [...new Set(candidates)];
    }
    if (cfg.paths && cfg.baseUrl) {
        for (const pattern of Object.keys(cfg.paths)) {
            const replacements = cfg.paths[pattern];
            if (!pattern.includes("*")) {
                if (pattern === importPath) {
                    for (const repl of replacements) {
                        const candidate = repl.replace("*", "");
                        const abs = normalizePath(path.resolve(cfg.baseUrl, candidate));
                        pushPrefix(abs);
                    }
                }
            }
            else {
                const prefix = pattern.split("*")[0];
                if (importPath.startsWith(prefix)) {
                    const tail = importPath.substring(prefix.length);
                    for (const repl of replacements) {
                        const candidate = repl.replace("*", tail);
                        const abs = normalizePath(path.resolve(cfg.baseUrl, candidate));
                        pushPrefix(abs);
                    }
                }
            }
        }
    }
    const mono = monorepoPackageCandidates(importPath);
    for (const m of mono)
        pushPrefix(m);
    const pkgMatches = packageExportsCandidates(importPath);
    for (const p of pkgMatches)
        pushPrefix(p);
    const projectRoot = process.cwd();
    pushPrefix(normalizePath(path.join(projectRoot, importPath)));
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