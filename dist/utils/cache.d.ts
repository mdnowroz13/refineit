export interface FileCacheEntry {
    path: string;
    hash: string;
    mtimeMs: number;
    unusedImports?: {
        name: string;
        line: number;
    }[];
    todoCount?: number;
}
export interface RefineItCache {
    version: number;
    updatedAt: string;
    entries: Record<string, FileCacheEntry>;
}
export declare function loadCache(): Promise<RefineItCache | null>;
export declare function saveCache(cache: RefineItCache): Promise<void>;
export declare function makeEmptyCache(): RefineItCache;
export declare function getCachedEntry(cache: RefineItCache | null, normalizedPath: string): FileCacheEntry | undefined;
export declare function updateCacheEntry(cache: RefineItCache, entry: FileCacheEntry): void;
//# sourceMappingURL=cache.d.ts.map