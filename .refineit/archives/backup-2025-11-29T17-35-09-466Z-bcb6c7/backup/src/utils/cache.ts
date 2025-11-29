// src/utils/cache.ts
import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

export interface FileCacheEntry {
    path: string;          // absolute normalized path
    hash: string;          // sha1 hash of file content
    mtimeMs: number;       // last modified milliseconds
    // minimal cached analysis for the file (we'll store unusedImports for re-use)
    unusedImports?: { name: string; line: number }[];
    // other lightweight per-file metadata we may want later
    todoCount?: number;
}

export interface RefineItCache {
    version: number;
    updatedAt: string;
    entries: Record<string, FileCacheEntry>; // key = normalized absolute path
}

const CACHE_DIR = '.refineit';
const CACHE_FILE = 'cache.json';

function repoCachePath() {
    return path.join(process.cwd(), CACHE_DIR, CACHE_FILE);
}

function ensureCacheDir() {
    const p = path.join(process.cwd(), CACHE_DIR);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export async function loadCache(): Promise<RefineItCache | null> {
    try {
        const p = repoCachePath();
        if (!existsSync(p)) return null;
        const raw = await fs.readFile(p, 'utf8');
        const parsed = JSON.parse(raw) as RefineItCache;
        if (!parsed || !parsed.entries) return null;
        return parsed;
    } catch {
        return null;
    }
}

export async function saveCache(cache: RefineItCache) {
    try {
        ensureCacheDir();
        const p = repoCachePath();
        await fs.writeFile(p, JSON.stringify(cache, null, 2), 'utf8');
    } catch (e) {
        // ignore write errors
    }
}

export function makeEmptyCache(): RefineItCache {
    return { version: 1, updatedAt: new Date().toISOString(), entries: {} };
}

/**
 * Helpers to get/update per-file entries
 */
export function getCachedEntry(cache: RefineItCache | null, normalizedPath: string): FileCacheEntry | undefined {
    if (!cache) return undefined;
    return cache.entries[normalizedPath];
}

export function updateCacheEntry(cache: RefineItCache, entry: FileCacheEntry) {
    cache.entries[entry.path] = entry;
    cache.updatedAt = new Date().toISOString();
}
