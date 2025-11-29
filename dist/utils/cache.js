import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
const CACHE_DIR = path.join(process.cwd(), '.refineit', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'db.json');
async function ensureCacheDir() {
    if (!existsSync(CACHE_DIR))
        mkdirSync(CACHE_DIR, { recursive: true });
}
export async function loadCache() {
    try {
        if (!existsSync(CACHE_FILE)) {
            await ensureCacheDir();
            const base = { version: 1, updatedAt: new Date().toISOString(), files: {}, lastReport: null };
            await fs.writeFile(CACHE_FILE, JSON.stringify(base, null, 2), 'utf8');
            return base;
        }
        const raw = await fs.readFile(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.files)
            parsed.files = {};
        if (!('lastReport' in parsed))
            parsed.lastReport = null;
        return parsed;
    }
    catch (e) {
        return { version: 1, updatedAt: new Date().toISOString(), files: {}, lastReport: null };
    }
}
export async function saveCache(db) {
    await ensureCacheDir();
    db.updatedAt = new Date().toISOString();
    await fs.writeFile(CACHE_FILE, JSON.stringify(db, null, 2), 'utf8');
}
export async function diffAgainstCache(fileHashes) {
    const db = await loadCache();
    const changed = [];
    const unchanged = [];
    for (const [file, hash] of Object.entries(fileHashes)) {
        const prev = db.files[file];
        if (!prev || prev.hash !== hash)
            changed.push(file);
        else
            unchanged.push(file);
    }
    return { changed, unchanged, db };
}
export async function updateCacheWithHashes(fileHashes) {
    const db = await loadCache();
    for (const [file, hash] of Object.entries(fileHashes)) {
        db.files[file] = {
            hash,
            recordedAt: new Date().toISOString()
        };
    }
    await saveCache(db);
}
export async function saveLastReport(report) {
    const db = await loadCache();
    db.lastReport = report;
    await saveCache(db);
}
export async function loadLastReport() {
    const db = await loadCache();
    return db.lastReport || null;
}
export async function clearCache() {
    try {
        if (existsSync(CACHE_FILE))
            await fs.unlink(CACHE_FILE);
    }
    catch {
    }
}
//# sourceMappingURL=cache.js.map