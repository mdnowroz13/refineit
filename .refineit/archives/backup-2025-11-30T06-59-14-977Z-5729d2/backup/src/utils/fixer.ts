// src/utils/fixer.ts
import { Project } from 'ts-morph';
import { UnusedImport } from './analyzer.js';

export interface FixResult {
    file: string;
    removedNamedImports: string[];
    removedDefaultImport?: string | null;
    success: boolean;
    error?: string | null;
}

/**
 * fixImports
 * Removes unused named imports and default imports from files using ts-morph.
 * Returns an array of FixResult describing what changed in each file.
 *
 * Note: Backup of files should be created by caller before invoking this.
 */
export async function fixImports(unusedImports: UnusedImport[]): Promise<FixResult[]> {
    const filesToFix = new Map<string, string[]>();
    for (const item of unusedImports) {
        if (!filesToFix.has(item.file)) filesToFix.set(item.file, []);
        filesToFix.get(item.file)!.push(item.name);
    }

    const project = new Project({ useInMemoryFileSystem: false });
    const results: FixResult[] = [];

    for (const [filePath, importsToRemove] of filesToFix) {
        const result: FixResult = {
            file: filePath,
            removedNamedImports: [],
            removedDefaultImport: null,
            success: false,
            error: null,
        };

        try {
            // Add or get source file at path
            const sourceFile = project.addSourceFileAtPath(filePath);
            if (!sourceFile) {
                result.error = 'Source file could not be loaded by ts-morph';
                results.push(result);
                continue;
            }

            // iterate import declarations
            const importDecls = sourceFile.getImportDeclarations();
            for (const decl of importDecls) {
                // named imports
                const namedImports = decl.getNamedImports();
                for (const named of [...namedImports]) {
                    const name = named.getName();
                    if (importsToRemove.includes(name)) {
                        result.removedNamedImports.push(name);
                        named.remove();
                    }
                }

                // default import
                const def = decl.getDefaultImport();
                if (def) {
                    const defName = def.getText();
                    if (importsToRemove.includes(defName)) {
                        result.removedDefaultImport = defName;
                        // remove default import (but keep entire declaration if there are named imports left)
                        // ts-morph has removeDefaultImport() on ImportDeclaration
                        try {
                            decl.removeDefaultImport();
                        } catch {
                            // fallback: remove the whole declaration if default remove failed and no named imports remain
                            if (decl.getNamedImports().length === 0) decl.remove();
                        }
                    }
                }

                // If there are no named or default imports left, and module has no side-effect, remove the whole declaration
                const stillHasNamed = decl.getNamedImports().length > 0;
                const stillHasDefault = !!decl.getDefaultImport();
                if (!stillHasNamed && !stillHasDefault) {
                    // But be conservative: if import has module specifier that looks like a CSS or side-effect, keep it.
                    const mod = decl.getModuleSpecifierValue();
                    if (!mod.match(/\.(css|scss|less|sass|styl)$/i)) {
                        decl.remove();
                    }
                }
            }

            // Save the source file if changed
            if (sourceFile.isSaved() === false || sourceFile.getFullText().length > 0) {
                await sourceFile.save();
            }

            result.success = true;
        } catch (err: any) {
            result.success = false;
            result.error = err?.message || String(err);
        } finally {
            results.push(result);
        }
    }

    return results;
}

export default fixImports;
