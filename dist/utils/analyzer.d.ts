export interface UnusedImport {
    file: string;
    name: string;
    line: number;
}
export declare function analyzeCodebase(files: string[], whitelist?: string[], options?: {
    noCache?: boolean;
}): Promise<{
    totalTodos: number;
    totalSecurity: number;
    largeFiles: number;
    deadFiles: string[];
    duplicates: {
        duplicate: string;
        original: string;
    }[];
    duplicatesCount: number;
    unusedImports: UnusedImport[];
    detailedIssues: any[];
    cycles: string[][];
    debug: {
        unresolvedImports: number;
        usageDecisions: number;
    };
}>;
//# sourceMappingURL=analyzer.d.ts.map