type FileLookup = Map<string, string>;
export declare function getCandidatesForImport(currentFile: string, importPath: string): string[];
export declare function resolveImportWithTsConfig(currentFile: string, importPath: string, fileLookup: FileLookup): string | undefined;
export {};
//# sourceMappingURL=tsconfig-resolver.d.ts.map