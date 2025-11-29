export interface FileCacheEntry {
    hash: string;
    mtimeMs?: number;
    size?: number;
    recordedAt: string;
}
export interface CacheDB {
    version: number;
    updatedAt: string;
    files: Record<string, FileCacheEntry>;
    lastReport?: any | null;
}
export declare function loadCache(): Promise<CacheDB>;
export declare function saveCache(db: CacheDB): Promise<void>;
export declare function diffAgainstCache(fileHashes: Record<string, string>): Promise<{
    changed: string[];
    unchanged: string[];
    db: CacheDB;
}>;
export declare function updateCacheWithHashes(fileHashes: Record<string, string>): Promise<void>;
export declare function saveLastReport(report: any): Promise<void>;
export declare function loadLastReport(): Promise<any | null>;
export declare function clearCache(): Promise<void>;
//# sourceMappingURL=cache.d.ts.map