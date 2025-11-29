// src/utils/analyzer.ts
import fs from 'fs/promises';
import path from 'path';
import { Project, Node, SyntaxKind } from 'ts-morph';
import { getCandidatesForImport, resolveImportWithTsConfig } from './tsconfig-resolver.js';

export interface UnusedImport {
    file: string;
    name: string;
    line: number;
}

function normalizePath(p: string) {
    return path.resolve(p).replace(/\\/g, '/');
}

/** Remove comments and import lines then search whole word */
function textualUsageCheck(fileContent: string, identifier: string) {
    const noComments = fileContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const noImports = noComments.replace(/^\s*import[\s\S]*?;?$/gim, '');
    const re = new RegExp(`\\b${identifier}\\b`, 'm');
    return re.test(noImports);
}

/** Confirm textual presence across repo (excluding importer optionally) */
function repoWideTextualConfirm(allFiles: Map<string, string>, identifier: string, excludePath?: string) {
    for (const [p, content] of allFiles.entries()) {
        if (excludePath && normalizePath(p) === normalizePath(excludePath)) continue;
        if (textualUsageCheck(content, identifier)) return true;
    }
    return false;
}

/** Isolated ts-morph project fallback */
function tryFindReferencesWithIsolatedProject(allFiles: { path: string; content: string }[], filePath: string, identifierName: string): boolean {
    try {
        const isolated = new Project({ useInMemoryFileSystem: true });
        const seen = new Set<string>();
        for (const f of allFiles) {
            const p = normalizePath(f.path);
            if (seen.has(p)) continue;
            seen.add(p);
            isolated.createSourceFile(p, f.content, { overwrite: true });
        }
        const sf = isolated.getSourceFile(normalizePath(filePath));
        if (!sf) return false;
        const ids = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === identifierName);
        for (const id of ids) {
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

export async function analyzeCodebase(files: string[], whitelist: string[] = []) {
    // Counters
    let totalTodos = 0;
    let totalSecurity = 0;
    let largeFiles = 0;
    let duplicatesCount = 0;

    // Results
    const deadFiles: string[] = [];
    const duplicates: { duplicate: string; original: string }[] = [];
    const unusedImports: UnusedImport[] = [];
    const detailedIssues: any[] = [];
    const cycles: string[][] = [];

    const contentHash = new Map<string, string>();
    const importGraph = new Map<string, Set<string>>();

    // Debug instrumentation
    const unresolvedImportsDebug: { importer: string; importSpecifier: string; candidates: string[] }[] = [];
    const usageDetectionDebug: {
        importer: string;
        importName: string;
        tsMorphUsed: boolean;
        triedIsolated: boolean;
        textualFallback: boolean;
        textualConfirmedUsed: boolean;
    }[] = [];

    // File lookup + contents
    const fileLookup = new Map<string, string>(); // normalized -> normalized
    const fileContentsMap = new Map<string, string>(); // normalized -> content
    for (const f of files) {
        const n = normalizePath(f);
        if (!fileLookup.has(n)) fileLookup.set(n, n);
        try {
            // ensure utf8 string
            const c = await fs.readFile(n, 'utf8');
            fileContentsMap.set(n, c);
            // also map no-ext to allow resolution lookups
            const noExt = n.replace(/\.[^/.]+$/, '');
            if (!fileLookup.has(noExt)) fileLookup.set(noExt, n);
        } catch {
            // ignore unreadable file
        }
    }

    // Initialize ts-morph project
    const tsConfigPath = 'tsconfig.json';
    let project: Project;
    try {
        await fs.access(tsConfigPath);
        project = new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: true });
    } catch {
        project = new Project({ useInMemoryFileSystem: true });
    }

    // Preload source files
    for (const [n, content] of fileContentsMap.entries()) {
        try { project.createSourceFile(n, content, { overwrite: true }); } catch { /* ignore */ }
    }

    // MAIN LOOP
    for (const f of files) {
        const nf = normalizePath(f);

        // file size
        try {
            const st = await fs.stat(nf);
            if (st.size > 500 * 1024) {
                largeFiles++;
                detailedIssues.push({ file: nf, issues: ['📦 Large File (>500KB)'] });
            }
        } catch { /* ignore */ }

        const content = fileContentsMap.get(nf) ?? (await fs.readFile(nf, 'utf8').catch(() => ''));

        // If file contains @refineit-keep, add detailedIssues and treat it as whitelisted
        if (typeof content === 'string' && content.includes('@refineit-keep')) {
            detailedIssues.push({ file: nf, issues: ['🔒 @refineit-keep present'] });
            // ensure whitelist has this file so it's never considered dead
            if (!whitelist.some(w => nf.includes(w))) {
                whitelist.push(nf);
            }
        }

        // duplicate detection
        const noComments = content.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '');
        const normalizedContent = noComments.replace(/\s+/g, '').replace(/;/g, '');
        if (normalizedContent.length > 10) {
            if (contentHash.has(normalizedContent)) {
                duplicates.push({ duplicate: nf, original: path.basename(contentHash.get(normalizedContent)!) });
                duplicatesCount++;
            } else {
                contentHash.set(normalizedContent, nf);
            }
        }

        // todos & security
        const todos = content.match(/\/\/\s*(TODO|FIXME)/g);
        if (todos) totalTodos += todos.length;
        if (content.match(/password\s*=\s*['"]|eval\(|exec\(/)) {
            totalSecurity++;
            detailedIssues.push({ file: nf, issues: ['🔒 Security Risk'] });
        }

        const sourceFile = project.getSourceFile(nf);
        if (!sourceFile) continue;

        const imports = new Set<string>();
        const addImp = (mod: string) => {
            const resolved = resolveImportWithTsConfig(nf, mod, fileLookup);
            if (resolved) imports.add(resolved);
            else unresolvedImportsDebug.push({ importer: nf, importSpecifier: mod, candidates: getCandidatesForImport(nf, mod) });
        };

        // analyze import declarations
        sourceFile.getImportDeclarations().forEach(importDecl => {
            // named imports
            importDecl.getNamedImports().forEach(namedImp => {
                const nameNode = namedImp.getNameNode();
                if (!nameNode) return;

                let tsMorphUsed = false;
                let triedIsolated = false;
                let textualFallback = false;
                let textualConfirmedUsed = false;

                // ts-morph references
                try {
                    const refs = nameNode.findReferencesAsNodes();
                    const usedByRefs = refs.some(ref => {
                        const top = ref.getParentWhile(p => !Node.isSourceFile(p));
                        return top && !Node.isImportDeclaration(top);
                    });
                    if (usedByRefs) tsMorphUsed = true;
                } catch { /* ignore */ }

                // isolated fallback
                if (!tsMorphUsed) {
                    const arr = Array.from(fileContentsMap.entries()).map(([p, c]) => ({ path: p, content: c }));
                    triedIsolated = tryFindReferencesWithIsolatedProject(arr, nf, namedImp.getName());
                    if (triedIsolated) tsMorphUsed = true;
                }

                // textual fallback scan (current file + others)
                if (!tsMorphUsed) {
                    const cur = fileContentsMap.get(nf) ?? '';
                    if (textualUsageCheck(cur, namedImp.getName())) {
                        textualFallback = true; tsMorphUsed = true;
                    } else {
                        for (const [p, c] of fileContentsMap.entries()) {
                            if (p === nf) continue;
                            if (textualUsageCheck(c, namedImp.getName())) {
                                textualFallback = true; tsMorphUsed = true; break;
                            }
                        }
                    }
                }

                // decisive textual confirmation: if ts-morph claims used, but no textual appearance anywhere, overrule
                if (tsMorphUsed) {
                    const textualFound = repoWideTextualConfirm(fileContentsMap, namedImp.getName(), nf) || textualUsageCheck(content, namedImp.getName());
                    textualConfirmedUsed = textualFound;
                    if (!textualFound) {
                        // Overrule ts-morph as "not used" (helps deterministic tests)
                        tsMorphUsed = false;
                    }
                }

                usageDetectionDebug.push({
                    importer: nf,
                    importName: namedImp.getName(),
                    tsMorphUsed,
                    triedIsolated,
                    textualFallback,
                    textualConfirmedUsed
                });

                if (!tsMorphUsed) {
                    unusedImports.push({ file: nf, name: namedImp.getName(), line: importDecl.getStartLineNumber() });
                }
            });

            // default import
            const def = importDecl.getDefaultImport();
            if (def) {
                let tsMorphUsed = false;
                let triedIsolated = false;
                let textualFallback = false;
                let textualConfirmedUsed = false;

                try {
                    const refs = def.findReferencesAsNodes();
                    const usedByRefs = refs.some(ref => {
                        const top = ref.getParentWhile(p => !Node.isSourceFile(p));
                        return top && !Node.isImportDeclaration(top);
                    });
                    if (usedByRefs) tsMorphUsed = true;
                } catch { /* ignore */ }

                if (!tsMorphUsed) {
                    const arr = Array.from(fileContentsMap.entries()).map(([p, c]) => ({ path: p, content: c }));
                    triedIsolated = tryFindReferencesWithIsolatedProject(arr, nf, def.getText());
                    if (triedIsolated) tsMorphUsed = true;
                }

                if (!tsMorphUsed) {
                    const cur = fileContentsMap.get(nf) ?? '';
                    if (textualUsageCheck(cur, def.getText())) {
                        textualFallback = true; tsMorphUsed = true;
                    } else {
                        for (const [p, c] of fileContentsMap.entries()) {
                            if (p === nf) continue;
                            if (textualUsageCheck(c, def.getText())) {
                                textualFallback = true; tsMorphUsed = true; break;
                            }
                        }
                    }
                }

                if (tsMorphUsed) {
                    const textualFound = repoWideTextualConfirm(fileContentsMap, def.getText(), nf) || textualUsageCheck(content, def.getText());
                    textualConfirmedUsed = textualFound;
                    if (!textualFound) tsMorphUsed = false;
                }

                usageDetectionDebug.push({
                    importer: nf,
                    importName: def ? def.getText() : '<none>',
                    tsMorphUsed,
                    triedIsolated,
                    textualFallback,
                    textualConfirmedUsed
                });

                if (!tsMorphUsed) {
                    unusedImports.push({ file: nf, name: def.getText(), line: importDecl.getStartLineNumber() });
                }
            }

            // build graph
            addImp(importDecl.getModuleSpecifierValue());
        });

        // dynamic import expressions
        sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
            try {
                if (call.getExpression().getText() === 'import') {
                    const args = call.getArguments();
                    if (args.length > 0 && Node.isStringLiteral(args[0])) addImp((args[0] as any).getLiteralValue());
                }
            } catch { /* ignore */ }
        });

        // export-from declarations
        sourceFile.getExportDeclarations().forEach(e => {
            const mod = e.getModuleSpecifierValue();
            if (mod) addImp(mod);
        });

        importGraph.set(nf, imports);
    } // end main loop

    // DEAD FILES: compute all imported files set
    const allImported = new Set<string>();
    importGraph.forEach(s => s.forEach(i => allImported.add(i)));

    for (const f of Array.from(fileLookup.values())) {
        const isImported = allImported.has(f);
        const name = path.basename(f);
        const isEntry = !!name.match(/^(index|main|app|setup|test-|script-|.*config|.*rc|package|.*test|.*spec)\.(ts|js|jsx|tsx|json)$/i);
        const isWhitelisted = whitelist.some(w => f.includes(w));
        if (!isImported && !isEntry && !isWhitelisted) deadFiles.push(f);
    }

    // CYCLES detection (DFS)
    const visited = new Set<string>();
    const stack = new Set<string>();
    function dfs(node: string, pathStack: string[]) {
        visited.add(node);
        stack.add(node);
        const children = importGraph.get(node);
        if (children) {
            for (const c of children) {
                if (!visited.has(c)) dfs(c, [...pathStack, c]);
                else if (stack.has(c)) cycles.push([...pathStack, c]);
            }
        }
        stack.delete(node);
    }
    for (const f of Array.from(fileLookup.values())) if (!visited.has(f)) dfs(f, [f]);

    // write debug file (usage decisions + unresolved imports)
    try {
        const debug = {
            timestamp: new Date().toISOString(),
            unresolvedImportsDebug,
            usageDetectionDebug,
            fileCount: files.length,
            lookedUpFiles: Array.from(fileLookup.keys()).slice(0, 500)
        };
        await fs.writeFile('refineit-debug.json', JSON.stringify(debug, null, 2), 'utf8');
    } catch {
        // ignore
    }

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
