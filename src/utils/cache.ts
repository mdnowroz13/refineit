// src/utils/cache.ts
import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

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
    // store last analysis payload so we can return it for incremental runs
    lastReport?: any | null;
}

const CACHE_DIR = path.join(process.cwd(), '.refineit', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'db.json');

async function ensureCacheDir() {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Load cache from disk. If not found, returns an empty DB.
 */
export async function loadCache(): Promise<CacheDB> {
    try {
        if (!existsSync(CACHE_FILE)) {
            await ensureCacheDir();
            const base: CacheDB = { version: 1, updatedAt: new Date().toISOString(), files: {}, lastReport: null };
            await fs.writeFile(CACHE_FILE, JSON.stringify(base, null, 2), 'utf8');
            return base;
        }
        const raw = await fs.readFile(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw) as CacheDB;
        if (!parsed.files) parsed.files = {};
        if (!('lastReport' in parsed)) parsed.lastReport = null;
        return parsed;
    } catch (e) {
        // If anything fails, return empty DB (do not crash analysis)
        return { version: 1, updatedAt: new Date().toISOString(), files: {}, lastReport: null };
    }
}

/**
 * Save a cache DB to disk.
 */
export async function saveCache(db: CacheDB) {
    await ensureCacheDir();
    db.updatedAt = new Date().toISOString();
    await fs.writeFile(CACHE_FILE, JSON.stringify(db, null, 2), 'utf8');
}

/**
 * Given a map of file->hash, returns:
 *  - changed: files that are new or have different hash than cache
 *  - unchanged: files present and identical
 */
export async function diffAgainstCache(fileHashes: Record<string, string>): Promise<{ changed: string[]; unchanged: string[]; db: CacheDB }> {
    const db = await loadCache();
    const changed: string[] = [];
    const unchanged: string[] = [];

    for (const [file, hash] of Object.entries(fileHashes)) {
        const prev = db.files[file];
        if (!prev || prev.hash !== hash) changed.push(file);
        else unchanged.push(file);
    }

    return { changed, unchanged, db };
}

/**
 * Update cache entries for the given file->hash map and persist.
 */
export async function updateCacheWithHashes(fileHashes: Record<string, string>) {
    const db = await loadCache();
    for (const [file, hash] of Object.entries(fileHashes)) {
        db.files[file] = {
            hash,
            recordedAt: new Date().toISOString()
        };
    }
    await saveCache(db);
}

/**
 * Save last analysis report payload to cache (so incremental run can return it).
 */
export async function saveLastReport(report: any) {
    const db = await loadCache();
    db.lastReport = report;
    await saveCache(db);
}

/**
 * Retrieve lastReport from cache (may be null).
 */
export async function loadLastReport(): Promise<any | null> {
    const db = await loadCache();
    return db.lastReport || null;
}

/**
 * Helper to clear cache (useful in tests / debugging).
 */
export async function clearCache() {
    try {
        if (existsSync(CACHE_FILE)) await fs.unlink(CACHE_FILE);
    } catch {
        // ignore
    }
}
