export declare function getFiles(patterns: string[], ignore?: string[]): Promise<string[]>;
export declare function getFilesWithHashes(patterns: string[], ignore?: string[], concurrency?: number): Promise<{
    files: string[];
    hashes: Record<string, string>;
}>;
//# sourceMappingURL=scanner.d.ts.map