import { Project } from 'ts-morph';
export async function fixImports(unusedImports) {
    const filesToFix = new Map();
    for (const item of unusedImports) {
        if (!filesToFix.has(item.file))
            filesToFix.set(item.file, []);
        filesToFix.get(item.file).push(item.name);
    }
    const project = new Project({ useInMemoryFileSystem: false });
    const results = [];
    for (const [filePath, importsToRemove] of filesToFix) {
        const result = {
            file: filePath,
            removedNamedImports: [],
            removedDefaultImport: null,
            success: false,
            error: null,
        };
        try {
            const sourceFile = project.addSourceFileAtPath(filePath);
            if (!sourceFile) {
                result.error = 'Source file could not be loaded by ts-morph';
                results.push(result);
                continue;
            }
            const importDecls = sourceFile.getImportDeclarations();
            for (const decl of importDecls) {
                const namedImports = decl.getNamedImports();
                for (const named of [...namedImports]) {
                    const name = named.getName();
                    if (importsToRemove.includes(name)) {
                        result.removedNamedImports.push(name);
                        named.remove();
                    }
                }
                const def = decl.getDefaultImport();
                if (def) {
                    const defName = def.getText();
                    if (importsToRemove.includes(defName)) {
                        result.removedDefaultImport = defName;
                        try {
                            decl.removeDefaultImport();
                        }
                        catch {
                            if (decl.getNamedImports().length === 0)
                                decl.remove();
                        }
                    }
                }
                const stillHasNamed = decl.getNamedImports().length > 0;
                const stillHasDefault = !!decl.getDefaultImport();
                if (!stillHasNamed && !stillHasDefault) {
                    const mod = decl.getModuleSpecifierValue();
                    if (!mod.match(/\.(css|scss|less|sass|styl)$/i)) {
                        decl.remove();
                    }
                }
            }
            if (sourceFile.isSaved() === false || sourceFile.getFullText().length > 0) {
                await sourceFile.save();
            }
            result.success = true;
        }
        catch (err) {
            result.success = false;
            result.error = err?.message || String(err);
        }
        finally {
            results.push(result);
        }
    }
    return results;
}
export default fixImports;
//# sourceMappingURL=fixer.js.map