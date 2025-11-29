// src/utils/analyzer.ts
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Project, Node, SyntaxKind } from 'ts-morph';
import { getCandidatesForImport, resolveImportWithTsConfig } from './tsconfig-resolver.js';
import { sha1 } from './hash.js';
import { loadCache, saveCache, makeEmptyCache, getCachedEntry, updateCacheEntry, RefineItCache, FileCacheEntry } from './cache.js';

export interface UnusedImport {
    file: string;
    name: string;
    line: number;
}

function normalizePath(p: string) {
    return path.resolve(p).replace(/\\/g, '/');
}

function toWindows(p: string) {
    return p.replace(/\//g, '\\');
}

/**
 * textualUsageCheck - fast conservative check (removes import lines and comments)
 */
function textualUsageCheck(fileContent: string, identifier: string) {
    const noComments = fileContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const noImports = noComments.replace(/^\s*import[\s\S]*?;?$/gim, '');
    const re = new RegExp(`\\b${identifier}\\b`, 'm');
    return re.test(noImports);
}

/**
 * Try isolated project fallback (used only when ts-morph failed for a file)
 */
function tryFindReferencesWithIsolatedProject(allFiles: { path: string; content: string }[], filePath: string, identifierName: string): boolean {
    try {
        const isolated = new Project({ useInMemoryFileSystem: true });
        for (const f of allFiles) {
            isolated.createSourceFile(normalizePath(f.path), f.content, { overwrite: true });
        }
        const sf = isolated.getSourceFile(normalizePath(filePath));
        if (!sf) return false;
        const namedIdentifiers = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === identifierName);
        for (const id of namedIdentifiers) {
            const refs = id.findReferencesAsNodes();
            const used = refs.some(ref => {
                const top = ref.getParentWhile(p => !Node.isSourceFile(p));
                return top && !Node.isImportDeclaration(top);
            });
            if (used) return true;
        }
        return false;
    } catch {
        return false;
    }
}

export async function analyzeCodebase(files: string[], whitelist: string[] = [], options?: { noCache?: boolean }) {
    const noCache = !!options?.noCache;

    // totals and results
    let totalTodos = 0;
    let totalSecurity = 0;
    let largeFiles = 0;
    let duplicatesCount = 0;

    const deadFilesSet = new Set<string>();
    const duplicates: { duplicate: string; original: string }[] = [];
    const unusedImports: UnusedImport[] = [];
    const detailedIssues: any[] = [];
    const cycles: string[][] = [];

    // helper maps
    const contentHash = new Map<string, string>();
    const importGraph = new Map<string, Set<string>>();

    // debug instrumentation
    const unresolvedImportsDebug: { importer: string; importSpecifier: string; candidates: string[] }[] = [];
    const usageDetectionDebug: { file: string; importName: string; tsMorphUsed?: boolean; fallbackTextual?: boolean; triedIsolatedProject?: boolean; textualConfirmedUsed?: boolean }[] = [];

    // build fileLookup (normalized -> original)
    const fileLookup = new Map<string, string>();
    const fileContentsCache = new Map<string, string>(); // map normalized -> content

    for (const f of files) {
        const n = normalizePath(f);
        fileLookup.set(n, f);
        const noExt = n.replace(/\.[^/.]+$/, '');
        if (!fileLookup.has(noExt)) fileLookup.set(noExt, f);
        try {
            const c = await fs.readFile(f, 'utf8');
            fileContentsCache.set(n, c);
            fileContentsCache.set(noExt, c);
        } catch {
            // ignore read error
        }
    }

    // Load cache (unless disabled)
    let cache: RefineItCache | null = null;
    if (!noCache) {
        cache = await loadCache();
        if (!cache) cache = makeEmptyCache();
    } else {
        cache = null;
    }

    // Compute file hashes and decide which files changed
    const changedFiles = new Set<string>();
    const fileMeta: Record<string, { hash: string; mtimeMs: number; content: string | undefined }> = {};
    for (const f of files) {
        const nf = normalizePath(f);
        let content: string | undefined = fileContentsCache.get(nf);
        try {
            if (!content) content = await fs.readFile(f, 'utf8');
        } catch {
            content = undefined;
        }
        let statMtime = 0;
        try {
            const s = await fs.stat(f);
            statMtime = s.mtimeMs || 0;
        } catch { /* ignore */ }
        const h = content ? sha1(content) : '';
        fileMeta[nf] = { hash: h, mtimeMs: statMtime, content };
        const cached = cache ? getCachedEntry(cache, nf) : undefined;
        if (!cached || cached.hash !== h || cached.mtimeMs !== statMtime) {
            changedFiles.add(nf);
        }
    }

    // Precompile regexes & constants used inside loops (small perf and clarity)
    const importRe = /import[\s\S]*?from\s*['"]([^'"]+)['"]/g;
    const dynRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
    const exportRe = /export\s+[\s\S]*?from\s*['"]([^'"]+)['"]/g;
    const todoRe = /\/\/\s*(TODO|FIXME)/g;
    const largeFileLimit = 500 * 1024;

    // Fast text-based pass (for repo-wide metrics) — parse imports using regex (fast) to build importGraph
    for (const f of files) {
        const nf = normalizePath(f);
        const content = fileMeta[nf]?.content ?? (await fs.readFile(f, 'utf8'));
        // small large file check
        try {
            const s = await fs.stat(f);
            if (s.size > largeFileLimit) {
                largeFiles++;
                // report normalized path
                detailedIssues.push({ file: nf, issues: ['📦 Large File (>500KB)'] });
            }
        } catch { /* ignore */ }

        // duplicates: simple normalized whitespaceless content
        const clean = (content || '').replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '');
        const normalizedContent = clean.replace(/\s+/g, '').replace(/;/g, '');
        if (normalizedContent.length > 10) {
            if (contentHash.has(normalizedContent)) {
                // normalize both duplicate & original paths
                duplicates.push({ duplicate: normalizePath(f), original: normalizePath(contentHash.get(normalizedContent)!) });
                // don't increment duplicatesCount here — we'll recompute from array at the end to avoid drift
            } else {
                contentHash.set(normalizedContent, f);
            }
        }

        // todos & security (fast checks)
        const todos = (content || '').match(todoRe);
        if (todos) totalTodos += todos.length;
        if ((content || '').match(/password\s*=\s*['"]|eval\(|exec\(/)) {
            totalSecurity++;
            detailedIssues.push({ file: nf, issues: ['🔒 Security Risk'] });
        }

        // detect keep annotation and append with robust path handling (deduped & capped)
        if ((content || '').includes('@refineit-keep')) {
            try {
                const repoRoot = process.cwd().replace(/\\/g, '/');
                const abs = nf; // already normalized
                const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
                const variants = new Set<string>();

                // canonical absolute (forward & back)
                variants.add(abs);
                variants.add(toWindows(abs));

                // repo-relative
                variants.add(rel);
                variants.add(toWindows(rel));

                // if path contains refineit-e2e as first segment, add stripped variant
                if (rel.startsWith('refineit-e2e/')) {
                    const stripped = rel.replace(/^refineit-e2e\//, '');
                    variants.add(stripped);
                    variants.add(toWindows(stripped));
                    variants.add(normalizePath(path.join(repoRoot, stripped)));
                    variants.add(toWindows(path.join(repoRoot, stripped)));
                }

                // basename and dirname+basename
                variants.add(path.basename(abs));
                const dirPlusBase = path.join(path.dirname(rel), path.basename(abs)).replace(/\\/g, '/');
                variants.add(dirPlusBase);
                variants.add(toWindows(dirPlusBase));

                // cap number of variants we push to avoid explosion
                const MAX_VARIANTS = 8;
                const list = Array.from(variants).slice(0, MAX_VARIANTS);

                // dedupe by (file, issue)
                const seen = new Set<string>();
                for (const v of list) {
                    const key = `${v}::@refineit-keep`;
                    if (seen.has(key)) continue;
                    detailedIssues.push({ file: v, issues: ['@refineit-keep'] });
                    seen.add(key);
                }
            } catch {
                // fallback: preserve old behaviour minimally (normalized)
                detailedIssues.push({ file: nf, issues: ['@refineit-keep'] });
            }
        }

        // parse import lines quickly to build graph candidates
        const importsSet = new Set<string>();
        let m;
        // match import ... from '...'
        while ((m = importRe.exec(content || '')) !== null) {
            const mod = m[1];
            const resolved = resolveImportWithTsConfig(nf, mod, fileLookup);
            // Normalize resolved path before adding
            if (resolved) importsSet.add(normalizePath(resolved));
            else {
                const candidates = getCandidatesForImport(nf, mod);
                unresolvedImportsDebug.push({ importer: nf, importSpecifier: mod, candidates });
            }
        }
        // handle dynamic import('...') quickly
        while ((m = dynRe.exec(content || '')) !== null) {
            const mod = m[1];
            const resolved = resolveImportWithTsConfig(nf, mod, fileLookup);
            if (resolved) importsSet.add(normalizePath(resolved));
            else {
                const candidates = getCandidatesForImport(nf, mod);
                unresolvedImportsDebug.push({ importer: nf, importSpecifier: mod, candidates });
            }
        }
        // export from
        while ((m = exportRe.exec(content || '')) !== null) {
            const mod = m[1];
            const resolved = resolveImportWithTsConfig(nf, mod, fileLookup);
            if (resolved) importsSet.add(normalizePath(resolved));
            else {
                const candidates = getCandidatesForImport(nf, mod);
                unresolvedImportsDebug.push({ importer: nf, importSpecifier: mod, candidates });
            }
        }

        importGraph.set(nf, importsSet);
    }

    // Dead files (fast): if not imported anywhere, not entry, not whitelisted -> candidate dead
    const allImportedFiles = new Set<string>();
    // Normalize paths when aggregating imported files
    importGraph.forEach((imports) => imports.forEach(imp => allImportedFiles.add(normalizePath(imp))));

    for (const file of files) {
        const nf = normalizePath(file);
        const name = path.basename(file);
        const isImported = allImportedFiles.has(nf);
        const isEntry = name.match(/^(index|main|app|setup|test-|script-|.*config|.*rc|package|.*test|.*spec)\.(ts|js|jsx|tsx|json)$/i);

        // Use normalized path for whitelist check
        const isWhitelisted = whitelist.some(w => nf.includes(w));

        // Check for @refineit-keep annotation in file content
        const content = fileMeta[nf]?.content ?? '';
        const hasKeep = content.includes('@refineit-keep');

        if (!isImported && !isEntry && !isWhitelisted && !hasKeep) {
            deadFilesSet.add(nf);
        }
    }

    // cycles detection (fast) using DFS on importGraph
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    function checkCycle(node: string, pathStack: string[]) {
        visited.add(node);
        recursionStack.add(node);
        const children = importGraph.get(node);
        if (children) {
            for (const child of children) {
                if (!visited.has(child)) checkCycle(child, [...pathStack, child]);
                else if (recursionStack.has(child)) cycles.push([...pathStack, child]);
            }
        }
        recursionStack.delete(node);
    }
    for (const f of files) if (!visited.has(f)) checkCycle(normalizePath(f), [normalizePath(f)]);

    // Now: unused import detection — heavy work done only for changed files (ts-morph)
    // We'll attempt to reuse cached unusedImports for unchanged files, BUT:
    // If cache has NO unusedImports for an unchanged file, we still perform a quick textual check
    // to catch cases the cached state missed.
    let project: Project;
    try {
        if (fsSync.existsSync('tsconfig.json')) project = new Project({ tsConfigFilePath: 'tsconfig.json', skipAddingFilesFromTsConfig: true });
        else project = new Project({ useInMemoryFileSystem: true });
    } catch {
        project = new Project({ useInMemoryFileSystem: true });
    }

    // Add all files into project (ts-morph needs file nodes)
    for (const f of files) {
        const nf = normalizePath(f);
        try {
            const content = fileMeta[nf]?.content ?? (await fs.readFile(f, 'utf8'));
            project.createSourceFile(nf, content, { overwrite: true });
        } catch {
            // ignore
        }
    }

    // For files unchanged and cached, reuse cached unusedImports if present.
    // If cached entry exists but unusedImports is empty/undefined, run lightweight textual-only check to find unused identifiers.
    for (const f of files) {
        const nf = normalizePath(f);
        const cached = cache ? getCachedEntry(cache, nf) : undefined;
        if (cached && !changedFiles.has(nf)) {
            if (cached.unusedImports && cached.unusedImports.length > 0) {
                for (const ui of cached.unusedImports) {
                    unusedImports.push({ file: nf, name: ui.name, line: ui.line });
                    usageDetectionDebug.push({ file: nf, importName: ui.name, tsMorphUsed: false, triedIsolatedProject: false, fallbackTextual: false, textualConfirmedUsed: false });
                }
                continue; // we reused cached entries
            } else {
                // quick textual-only check (cheap) for import declarations
                try {
                    const content = fileMeta[nf]?.content ?? (await fs.readFile(nf, 'utf8'));
                    // find import declarations via regex to extract identifiers
                    const importLineRe = /import\s+([^'";]+)\s+from\s+['"][^'"]+['"]/g;
                    let m;
                    while ((m = importLineRe.exec(content || '')) !== null) {
                        const importClause = (m[1] || '').trim();
                        // cases: defaultImport, { a, b as c }, * as ns
                        // handle named imports inside { ... }
                        const namedMatch = importClause.match(/\{([\s\S]*?)\}/);
                        if (namedMatch) {
                            const list = namedMatch[1].split(',').map(s => s.trim()).filter(Boolean);
                            for (const item of list) {
                                const name = item.split(' as ')[0].trim();
                                // textual repo-wide check
                                let found = false;
                                if (textualUsageCheck(content || '', name)) found = true;
                                if (!found) {
                                    for (const [p, c] of fileContentsCache.entries()) {
                                        if (p === nf) continue;
                                        if (textualUsageCheck(c, name)) { found = true; break; }
                                    }
                                }
                                usageDetectionDebug.push({ file: nf, importName: name, tsMorphUsed: false, triedIsolatedProject: false, fallbackTextual: false, textualConfirmedUsed: found });
                                if (!found) {
                                    // attempt to calculate a reasonable line number (best-effort)
                                    const lines = content?.split(/\r?\n/) || [];
                                    let ln = 1;
                                    for (let i = 0; i < lines.length; i++) {
                                        if (lines[i].includes(name) && lines[i].includes('import')) { ln = i + 1; break; }
                                    }
                                    unusedImports.push({ file: nf, name, line: ln });
                                }
                            }
                        } else {
                            // default import or namespace import
                            // name could be like "foo" or "* as ns"
                            if (importClause.startsWith('* as')) {
                                const name = importClause.replace('* as', '').trim();
                                let found = false;
                                if (textualUsageCheck(content || '', name)) found = true;
                                if (!found) {
                                    for (const [p, c] of fileContentsCache.entries()) {
                                        if (p === nf) continue;
                                        if (textualUsageCheck(c, name)) { found = true; break; }
                                    }
                                }
                                usageDetectionDebug.push({ file: nf, importName: name, tsMorphUsed: false, triedIsolatedProject: false, fallbackTextual: false, textualConfirmedUsed: found });
                                if (!found) {
                                    const lines = content?.split(/\r?\n/) || [];
                                    let ln = 1;
                                    for (let i = 0; i < lines.length; i++) {
                                        if (lines[i].includes(name) && lines[i].includes('import')) { ln = i + 1; break; }
                                    }
                                    unusedImports.push({ file: nf, name, line: ln });
                                }
                            } else {
                                // default import like "React" or "z"
                                const name = importClause.split(',')[0].trim();
                                if (name) {
                                    let found = false;
                                    if (textualUsageCheck(content || '', name)) found = true;
                                    if (!found) {
                                        for (const [p, c] of fileContentsCache.entries()) {
                                            if (p === nf) continue;
                                            if (textualUsageCheck(c, name)) { found = true; break; }
                                        }
                                    }
                                    usageDetectionDebug.push({ file: nf, importName: name, tsMorphUsed: false, triedIsolatedProject: false, fallbackTextual: false, textualConfirmedUsed: found });
                                    if (!found) {
                                        const lines = content?.split(/\r?\n/) || [];
                                        let ln = 1;
                                        for (let i = 0; i < lines.length; i++) {
                                            if (lines[i].includes(name) && lines[i].includes('import')) { ln = i + 1; break; }
                                        }
                                        unusedImports.push({ file: nf, name, line: ln });
                                    }
                                }
                            }
                        }
                    }
                } catch {
                    // if anything fails, skip quick check for this file
                }
            }
        }
    }

    // For changed files (or files without cache), run ts-morph based detection (heavy)
    const allFilesEntries = Array.from(Object.entries(fileMeta)).map(([p, { content }]) => ({ path: p, content: content || '' }));
    for (const nf of Array.from(changedFiles)) {
        const sourceFile = project.getSourceFile(nf);
        if (!sourceFile) continue;

        sourceFile.getImportDeclarations().forEach(importDecl => {
            // named imports
            importDecl.getNamedImports().forEach(namedImp => {
                const name = namedImp.getName();
                let tsMorphUsed = false;
                let triedIsolated = false;
                let textualFallback = false;
                try {
                    const references = namedImp.getNameNode().findReferencesAsNodes();
                    const isUsed = references.some(ref => {
                        const topLevel = ref.getParentWhile(p => !Node.isSourceFile(p));
                        return topLevel && !Node.isImportDeclaration(topLevel);
                    });
                    if (isUsed) tsMorphUsed = true;
                    if (!isUsed) {
                        triedIsolated = tryFindReferencesWithIsolatedProject(allFilesEntries, nf, name);
                        if (triedIsolated) tsMorphUsed = true;
                    }
                } catch {
                    // ignore ts-morph errors and fallback
                }

                if (!tsMorphUsed) {
                    // textual fallback within current file & repo-wide quick check
                    const curContent = fileMeta[nf]?.content ?? '';
                    if (textualUsageCheck(curContent, name)) {
                        textualFallback = true;
                        tsMorphUsed = true;
                    } else {
                        for (const [p, c] of fileContentsCache.entries()) {
                            if (p === nf) continue;
                            if (textualUsageCheck(c, name)) {
                                textualFallback = true;
                                tsMorphUsed = true;
                                break;
                            }
                        }
                    }
                }

                usageDetectionDebug.push({
                    file: nf,
                    importName: name,
                    tsMorphUsed,
                    triedIsolatedProject: triedIsolated,
                    fallbackTextual: textualFallback
                });

                if (!tsMorphUsed) {
                    const line = importDecl.getStartLineNumber();
                    unusedImports.push({ file: nf, name, line });
                }
            });

            // default import
            const defaultImport = importDecl.getDefaultImport();
            if (defaultImport) {
                const defName = defaultImport.getText();
                let tsMorphUsed = false;
                let triedIsolated = false;
                let textualFallback = false;
                try {
                    const references = defaultImport.findReferencesAsNodes();
                    const isUsed = references.some(ref => {
                        const topLevel = ref.getParentWhile(p => !Node.isSourceFile(p));
                        return topLevel && !Node.isImportDeclaration(topLevel);
                    });
                    if (isUsed) tsMorphUsed = true;
                    if (!isUsed) {
                        triedIsolated = tryFindReferencesWithIsolatedProject(allFilesEntries, nf, defName);
                        if (triedIsolated) tsMorphUsed = true;
                    }
                } catch { /* ignore */ }

                if (!tsMorphUsed) {
                    const curContent = fileMeta[nf]?.content ?? '';
                    if (textualUsageCheck(curContent, defName)) {
                        textualFallback = true;
                        tsMorphUsed = true;
                    } else {
                        for (const [p, c] of fileContentsCache.entries()) {
                            if (p === nf) continue;
                            if (textualUsageCheck(c, defName)) {
                                textualFallback = true;
                                tsMorphUsed = true;
                                break;
                            }
                        }
                    }
                }

                usageDetectionDebug.push({
                    file: nf,
                    importName: defName,
                    tsMorphUsed,
                    triedIsolatedProject: triedIsolated,
                    fallbackTextual: textualFallback
                });

                if (!tsMorphUsed) {
                    const line = importDecl.getStartLineNumber();
                    unusedImports.push({ file: nf, name: defName, line });
                }
            }
        });

        // After analyzing this changed file, update its cache entry
        if (cache) {
            const uiForFile = unusedImports.filter(u => normalizePath(u.file) === nf).map(u => ({ name: u.name, line: u.line }));
            const ent: FileCacheEntry = {
                path: nf,
                hash: fileMeta[nf].hash,
                mtimeMs: fileMeta[nf].mtimeMs,
                unusedImports: uiForFile,
                todoCount: (fileMeta[nf].content || '').match(todoRe)?.length || 0
            };
            updateCacheEntry(cache, ent);
        }
    }

    // Persist cache if changed
    if (cache) {
        try {
            await saveCache(cache);
        } catch { /* ignore */ }
    }

    // write debug file
    try {
        const debug = {
            timestamp: new Date().toISOString(),
            unresolvedImportsDebug,
            usageDetectionDebug,
            fileCount: files.length,
            lookedUpFiles: Array.from(fileLookup.keys()).slice(0, 200)
        };
        await fs.writeFile('refineit-debug.json', JSON.stringify(debug, null, 2), 'utf8');
    } catch {
        // ignore
    }

    // finalize derived counts / arrays
    const deadFiles = Array.from(deadFilesSet);
    duplicatesCount = duplicates.length;

    return {
        totalTodos,
        totalSecurity,
        largeFiles,
        deadFiles,
        duplicates,
        duplicatesCount,
        unusedImports,
        detailedIssues,
        cycles,
        debug: { unresolvedImports: unresolvedImportsDebug.length, usageDecisions: usageDetectionDebug.length }
    };
}
