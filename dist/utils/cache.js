import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
const CACHE_DIR = '.refineit';
const CACHE_FILE = 'cache.json';
function repoCachePath() {
    return path.join(process.cwd(), CACHE_DIR, CACHE_FILE);
}
function ensureCacheDir() {
    const p = path.join(process.cwd(), CACHE_DIR);
    if (!existsSync(p))
        mkdirSync(p, { recursive: true });
}
export async function loadCache() {
    try {
        const p = repoCachePath();
        if (!existsSync(p))
            return null;
        const raw = await fs.readFile(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.entries)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export async function saveCache(cache) {
    try {
        ensureCacheDir();
        const p = repoCachePath();
        await fs.writeFile(p, JSON.stringify(cache, null, 2), 'utf8');
    }
    catch (e) {
    }
}
export function makeEmptyCache() {
    return { version: 1, updatedAt: new Date().toISOString(), entries: {} };
}
export function getCachedEntry(cache, normalizedPath) {
    if (!cache)
        return undefined;
    return cache.entries[normalizedPath];
}
export function updateCacheEntry(cache, entry) {
    cache.entries[entry.path] = entry;
    cache.updatedAt = new Date().toISOString();
}
//# sourceMappingURL=cache.js.map