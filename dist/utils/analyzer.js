import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Project, Node, SyntaxKind } from 'ts-morph';
import { getCandidatesForImport, resolveImportWithTsConfig } from './tsconfig-resolver.js';
import { sha1 } from './hash.js';
import { loadCache, saveCache, makeEmptyCache, getCachedEntry, updateCacheEntry } from './cache.js';
function normalizePath(p) {
    return path.resolve(p).replace(/\\/g, '/');
}
function toWindows(p) {
    return p.replace(/\//g, '\\');
}
function textualUsageCheck(fileContent, identifier) {
    const noComments = fileContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const noImports = noComments.replace(/^\s*import[\s\S]*?;?$/gim, '');
    const re = new RegExp(`\\b${identifier}\\b`, 'm');
    return re.test(noImports);
}
function tryFindReferencesWithIsolatedProject(allFiles, filePath, identifierName) {
    try {
        const isolated = new Project({ useInMemoryFileSystem: true });
        for (const f of allFiles) {
            isolated.createSourceFile(normalizePath(f.path), f.content, { overwrite: true });
        }
        const sf = isolated.getSourceFile(normalizePath(filePath));
        if (!sf)
            return false;
        const namedIdentifiers = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === identifierName);
        for (const id of namedIdentifiers) {
            const refs = id.findReferencesAsNodes();
            const used = refs.some(ref => {
                const top = ref.getParentWhile(p => !Node.isSourceFile(p));
                return top && !Node.isImportDeclaration(top);
            });
            if (used)
                return true;
        }
        return false;
    }
    catch {
        return false;
    }
}
export async function analyzeCodebase(files, whitelist = [], options) {
    const noCache = !!options?.noCache;
    let totalTodos = 0;
    let totalSecurity = 0;
    let largeFiles = 0;
    let duplicatesCount = 0;
    const deadFilesSet = new Set();
    const duplicates = [];
    const unusedImports = [];
    const detailedIssues = [];
    const cycles = [];
    const contentHash = new Map();
    const importGraph = new Map();
    const unresolvedImportsDebug = [];
    const usageDetectionDebug = [];
    const fileLookup = new Map();
    const fileContentsCache = new Map();
    for (const f of files) {
        const n = normalizePath(f);
        fileLookup.set(n, f);
        const noExt = n.replace(/\.[^/.]+$/, '');
        if (!fileLookup.has(noExt))
            fileLookup.set(noExt, f);
        try {
            const c = await fs.readFile(f, 'utf8');
            fileContentsCache.set(n, c);
            fileContentsCache.set(noExt, c);
        }
        catch {
        }
    }
    let cache = null;
    if (!noCache) {
        cache = await loadCache();
        if (!cache)
            cache = makeEmptyCache();
    }
    else {
        cache = null;
    }
    const changedFiles = new Set();
    const fileMeta = {};
    for (const f of files) {
        const nf = normalizePath(f);
        let content = fileContentsCache.get(nf);
        try {
            if (!content)
                content = await fs.readFile(f, 'utf8');
        }
        catch {
            content = undefined;
        }
        let statMtime = 0;
        try {
            const s = await fs.stat(f);
            statMtime = s.mtimeMs || 0;
        }
        catch { }
        const h = content ? sha1(content) : '';
        fileMeta[nf] = { hash: h, mtimeMs: statMtime, content };
        const cached = cache ? getCachedEntry(cache, nf) : undefined;
        if (!cached || cached.hash !== h || cached.mtimeMs !== statMtime) {
            changedFiles.add(nf);
        }
    }
    const importRe = /import[\s\S]*?from\s*['"]([^'"]+)['"]/g;
    const dynRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
    const exportRe = /export\s+[\s\S]*?from\s*['"]([^'"]+)['"]/g;
    const todoRe = /\/\/\s*(TODO|FIXME)/g;
    const largeFileLimit = 500 * 1024;
    for (const f of files) {
        const nf = normalizePath(f);
        const content = fileMeta[nf]?.content ?? (await fs.readFile(f, 'utf8'));
        try {
            const s = await fs.stat(f);
            if (s.size > largeFileLimit) {
                largeFiles++;
                detailedIssues.push({ file: nf, issues: ['📦 Large File (>500KB)'] });
            }
        }
        catch { }
        const clean = (content || '').replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '');
        const normalizedContent = clean.replace(/\s+/g, '').replace(/;/g, '');
        if (normalizedContent.length > 10) {
            if (contentHash.has(normalizedContent)) {
                duplicates.push({ duplicate: normalizePath(f), original: normalizePath(contentHash.get(normalizedContent)) });
            }
            else {
                contentHash.set(normalizedContent, f);
            }
        }
        const todos = (content || '').match(todoRe);
        if (todos)
            totalTodos += todos.length;
        if ((content || '').match(/password\s*=\s*['"]|eval\(|exec\(/)) {
            totalSecurity++;
            detailedIssues.push({ file: nf, issues: ['🔒 Security Risk'] });
        }
        if ((content || '').includes('@refineit-keep')) {
            try {
                const repoRoot = process.cwd().replace(/\\/g, '/');
                const abs = nf;
                const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
                const variants = new Set();
                variants.add(abs);
                variants.add(toWindows(abs));
                variants.add(rel);
                variants.add(toWindows(rel));
                if (rel.startsWith('refineit-e2e/')) {
                    const stripped = rel.replace(/^refineit-e2e\//, '');
                    variants.add(stripped);
                    variants.add(toWindows(stripped));
                    variants.add(normalizePath(path.join(repoRoot, stripped)));
                    variants.add(toWindows(path.join(repoRoot, stripped)));
                }
                variants.add(path.basename(abs));
                const dirPlusBase = path.join(path.dirname(rel), path.basename(abs)).replace(/\\/g, '/');
                variants.add(dirPlusBase);
                variants.add(toWindows(dirPlusBase));
                const MAX_VARIANTS = 8;
                const list = Array.from(variants).slice(0, MAX_VARIANTS);
                const seen = new Set();
                for (const v of list) {
                    const key = `${v}::@refineit-keep`;
                    if (seen.has(key))
                        continue;
                    detailedIssues.push({ file: v, issues: ['@refineit-keep'] });
                    seen.add(key);
                }
            }
            catch {
                detailedIssues.push({ file: nf, issues: ['@refineit-keep'] });
            }
        }
        const importsSet = new Set();
        let m;
        while ((m = importRe.exec(content || '')) !== null) {
            const mod = m[1];
            const resolved = resolveImportWithTsConfig(nf, mod, fileLookup);
            if (resolved)
                importsSet.add(normalizePath(resolved));
            else {
                const candidates = getCandidatesForImport(nf, mod);
                unresolvedImportsDebug.push({ importer: nf, importSpecifier: mod, candidates });
            }
        }
        while ((m = dynRe.exec(content || '')) !== null) {
            const mod = m[1];
            const resolved = resolveImportWithTsConfig(nf, mod, fileLookup);
            if (resolved)
                importsSet.add(normalizePath(resolved));
            else {
                const candidates = getCandidatesForImport(nf, mod);
                unresolvedImportsDebug.push({ importer: nf, importSpecifier: mod, candidates });
            }
        }
        while ((m = exportRe.exec(content || '')) !== null) {
            const mod = m[1];
            const resolved = resolveImportWithTsConfig(nf, mod, fileLookup);
            if (resolved)
                importsSet.add(normalizePath(resolved));
            else {
                const candidates = getCandidatesForImport(nf, mod);
                unresolvedImportsDebug.push({ importer: nf, importSpecifier: mod, candidates });
            }
        }
        importGraph.set(nf, importsSet);
    }
    const allImportedFiles = new Set();
    importGraph.forEach((imports) => imports.forEach(imp => allImportedFiles.add(normalizePath(imp))));
    for (const file of files) {
        const nf = normalizePath(file);
        const name = path.basename(file);
        const isImported = allImportedFiles.has(nf);
        const isEntry = name.match(/^(index|main|app|setup|test-|script-|.*config|.*rc|package|.*test|.*spec)\.(ts|js|jsx|tsx|json)$/i);
        const isWhitelisted = whitelist.some(w => nf.includes(w));
        const content = fileMeta[nf]?.content ?? '';
        const hasKeep = content.includes('@refineit-keep');
        if (!isImported && !isEntry && !isWhitelisted && !hasKeep) {
            deadFilesSet.add(nf);
        }
    }
    const visited = new Set();
    const recursionStack = new Set();
    function checkCycle(node, pathStack) {
        visited.add(node);
        recursionStack.add(node);
        const children = importGraph.get(node);
        if (children) {
            for (const child of children) {
                if (!visited.has(child))
                    checkCycle(child, [...pathStack, child]);
                else if (recursionStack.has(child))
                    cycles.push([...pathStack, child]);
            }
        }
        recursionStack.delete(node);
    }
    for (const f of files)
        if (!visited.has(f))
            checkCycle(normalizePath(f), [normalizePath(f)]);
    let project;
    try {
        if (fsSync.existsSync('tsconfig.json'))
            project = new Project({ tsConfigFilePath: 'tsconfig.json', skipAddingFilesFromTsConfig: true });
        else
            project = new Project({ useInMemoryFileSystem: true });
    }
    catch {
        project = new Project({ useInMemoryFileSystem: true });
    }
    for (const f of files) {
        const nf = normalizePath(f);
        try {
            const content = fileMeta[nf]?.content ?? (await fs.readFile(f, 'utf8'));
            project.createSourceFile(nf, content, { overwrite: true });
        }
        catch {
        }
    }
    for (const f of files) {
        const nf = normalizePath(f);
        const cached = cache ? getCachedEntry(cache, nf) : undefined;
        if (cached && !changedFiles.has(nf)) {
            if (cached.unusedImports && cached.unusedImports.length > 0) {
                for (const ui of cached.unusedImports) {
                    unusedImports.push({ file: nf, name: ui.name, line: ui.line });
                    usageDetectionDebug.push({ file: nf, importName: ui.name, tsMorphUsed: false, triedIsolatedProject: false, fallbackTextual: false, textualConfirmedUsed: false });
                }
                continue;
            }
            else {
                try {
                    const content = fileMeta[nf]?.content ?? (await fs.readFile(nf, 'utf8'));
                    const importLineRe = /import\s+([^'";]+)\s+from\s+['"][^'"]+['"]/g;
                    let m;
                    while ((m = importLineRe.exec(content || '')) !== null) {
                        const importClause = (m[1] || '').trim();
                        const namedMatch = importClause.match(/\{([\s\S]*?)\}/);
                        if (namedMatch) {
                            const list = namedMatch[1].split(',').map(s => s.trim()).filter(Boolean);
                            for (const item of list) {
                                const name = item.split(' as ')[0].trim();
                                let found = false;
                                if (textualUsageCheck(content || '', name))
                                    found = true;
                                if (!found) {
                                    for (const [p, c] of fileContentsCache.entries()) {
                                        if (p === nf)
                                            continue;
                                        if (textualUsageCheck(c, name)) {
                                            found = true;
                                            break;
                                        }
                                    }
                                }
                                usageDetectionDebug.push({ file: nf, importName: name, tsMorphUsed: false, triedIsolatedProject: false, fallbackTextual: false, textualConfirmedUsed: found });
                                if (!found) {
                                    const lines = content?.split(/\r?\n/) || [];
                                    let ln = 1;
                                    for (let i = 0; i < lines.length; i++) {
                                        if (lines[i].includes(name) && lines[i].includes('import')) {
                                            ln = i + 1;
                                            break;
                                        }
                                    }
                                    unusedImports.push({ file: nf, name, line: ln });
                                }
                            }
                        }
                        else {
                            if (importClause.startsWith('* as')) {
                                const name = importClause.replace('* as', '').trim();
                                let found = false;
                                if (textualUsageCheck(content || '', name))
                                    found = true;
                                if (!found) {
                                    for (const [p, c] of fileContentsCache.entries()) {
                                        if (p === nf)
                                            continue;
                                        if (textualUsageCheck(c, name)) {
                                            found = true;
                                            break;
                                        }
                                    }
                                }
                                usageDetectionDebug.push({ file: nf, importName: name, tsMorphUsed: false, triedIsolatedProject: false, fallbackTextual: false, textualConfirmedUsed: found });
                                if (!found) {
                                    const lines = content?.split(/\r?\n/) || [];
                                    let ln = 1;
                                    for (let i = 0; i < lines.length; i++) {
                                        if (lines[i].includes(name) && lines[i].includes('import')) {
                                            ln = i + 1;
                                            break;
                                        }
                                    }
                                    unusedImports.push({ file: nf, name, line: ln });
                                }
                            }
                            else {
                                const name = importClause.split(',')[0].trim();
                                if (name) {
                                    let found = false;
                                    if (textualUsageCheck(content || '', name))
                                        found = true;
                                    if (!found) {
                                        for (const [p, c] of fileContentsCache.entries()) {
                                            if (p === nf)
                                                continue;
                                            if (textualUsageCheck(c, name)) {
                                                found = true;
                                                break;
                                            }
                                        }
                                    }
                                    usageDetectionDebug.push({ file: nf, importName: name, tsMorphUsed: false, triedIsolatedProject: false, fallbackTextual: false, textualConfirmedUsed: found });
                                    if (!found) {
                                        const lines = content?.split(/\r?\n/) || [];
                                        let ln = 1;
                                        for (let i = 0; i < lines.length; i++) {
                                            if (lines[i].includes(name) && lines[i].includes('import')) {
                                                ln = i + 1;
                                                break;
                                            }
                                        }
                                        unusedImports.push({ file: nf, name, line: ln });
                                    }
                                }
                            }
                        }
                    }
                }
                catch {
                }
            }
        }
    }
    const allFilesEntries = Array.from(Object.entries(fileMeta)).map(([p, { content }]) => ({ path: p, content: content || '' }));
    for (const nf of Array.from(changedFiles)) {
        const sourceFile = project.getSourceFile(nf);
        if (!sourceFile)
            continue;
        sourceFile.getImportDeclarations().forEach(importDecl => {
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
                    if (isUsed)
                        tsMorphUsed = true;
                    if (!isUsed) {
                        triedIsolated = tryFindReferencesWithIsolatedProject(allFilesEntries, nf, name);
                        if (triedIsolated)
                            tsMorphUsed = true;
                    }
                }
                catch {
                }
                if (!tsMorphUsed) {
                    const curContent = fileMeta[nf]?.content ?? '';
                    if (textualUsageCheck(curContent, name)) {
                        textualFallback = true;
                        tsMorphUsed = true;
                    }
                    else {
                        for (const [p, c] of fileContentsCache.entries()) {
                            if (p === nf)
                                continue;
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
                    if (isUsed)
                        tsMorphUsed = true;
                    if (!isUsed) {
                        triedIsolated = tryFindReferencesWithIsolatedProject(allFilesEntries, nf, defName);
                        if (triedIsolated)
                            tsMorphUsed = true;
                    }
                }
                catch { }
                if (!tsMorphUsed) {
                    const curContent = fileMeta[nf]?.content ?? '';
                    if (textualUsageCheck(curContent, defName)) {
                        textualFallback = true;
                        tsMorphUsed = true;
                    }
                    else {
                        for (const [p, c] of fileContentsCache.entries()) {
                            if (p === nf)
                                continue;
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
        if (cache) {
            const uiForFile = unusedImports.filter(u => normalizePath(u.file) === nf).map(u => ({ name: u.name, line: u.line }));
            const ent = {
                path: nf,
                hash: fileMeta[nf].hash,
                mtimeMs: fileMeta[nf].mtimeMs,
                unusedImports: uiForFile,
                todoCount: (fileMeta[nf].content || '').match(todoRe)?.length || 0
            };
            updateCacheEntry(cache, ent);
        }
    }
    if (cache) {
        try {
            await saveCache(cache);
        }
        catch { }
    }
    try {
        const debug = {
            timestamp: new Date().toISOString(),
            unresolvedImportsDebug,
            usageDetectionDebug,
            fileCount: files.length,
            lookedUpFiles: Array.from(fileLookup.keys()).slice(0, 200)
        };
        await fs.writeFile('refineit-debug.json', JSON.stringify(debug, null, 2), 'utf8');
    }
    catch {
    }
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
//# sourceMappingURL=analyzer.js.map