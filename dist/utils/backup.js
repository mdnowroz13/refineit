import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
export async function createBackupRoot(note) {
    const repoRoot = process.cwd();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const short = crypto.randomBytes(3).toString('hex');
    const backupId = `backup-${ts}-${short}`;
    const rootDir = path.join(repoRoot, '.refineit', 'archives', backupId);
    mkdirSync(rootDir, { recursive: true });
    mkdirSync(path.join(rootDir, 'backup'), { recursive: true });
    mkdirSync(path.join(rootDir, 'diffs'), { recursive: true });
    const manifest = {
        backupId,
        createdAt: new Date().toISOString(),
        toolVersion: (await loadPackageVersion()) || '0.0.0',
        cwd: repoRoot,
        entries: [],
        note: note || null
    };
    const manifestPath = path.join(rootDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { backupId, rootDir, manifestPath, manifest };
}
async function loadPackageVersion() {
    try {
        const pkgPath = path.join(process.cwd(), 'package.json');
        if (!existsSync(pkgPath))
            return null;
        const raw = await fs.readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(raw);
        return pkg.version;
    }
    catch (e) {
        return null;
    }
}
export async function writeManifest(manifest, rootDir) {
    const manifestPath = path.join(rootDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}
export async function backupFile(originalPath, rootDir, action = 'deleted') {
    const absOriginal = path.isAbsolute(originalPath) ? originalPath : path.resolve(process.cwd(), originalPath);
    if (!existsSync(absOriginal))
        throw new Error(`original missing: ${absOriginal}`);
    const rel = path.relative(process.cwd(), absOriginal).replace(/\\/g, '/');
    const dest = path.join(rootDir, 'backup', rel);
    const destDir = path.dirname(dest);
    mkdirSync(destDir, { recursive: true });
    const content = await fs.readFile(absOriginal);
    await fs.writeFile(dest, content);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const entry = {
        originalPath: path.resolve(absOriginal),
        backupPath: path.resolve(dest),
        sha256: hash,
        size: Buffer.isBuffer(content) ? content.length : Buffer.from(String(content)).length,
        action
    };
    const manifestPath = path.join(rootDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
        const baseManifest = {
            backupId: path.basename(rootDir),
            createdAt: new Date().toISOString(),
            toolVersion: (await loadPackageVersion()) || '0.0.0',
            cwd: process.cwd(),
            entries: [],
            note: null
        };
        await fs.writeFile(manifestPath, JSON.stringify(baseManifest, null, 2), 'utf8');
    }
    const mfRaw = await fs.readFile(manifestPath, 'utf8');
    const mf = JSON.parse(mfRaw);
    mf.entries.push(entry);
    await fs.writeFile(manifestPath, JSON.stringify(mf, null, 2), 'utf8');
    return entry;
}
export async function listBackups() {
    const repoRoot = process.cwd();
    const archives = path.join(repoRoot, '.refineit', 'archives');
    if (!existsSync(archives))
        return [];
    const items = await fs.readdir(archives);
    const out = [];
    for (const name of items) {
        const p = path.join(archives, name);
        const manifestPath = path.join(p, 'manifest.json');
        if (!existsSync(manifestPath))
            continue;
        try {
            const mfRaw = await fs.readFile(manifestPath, 'utf8');
            const mf = JSON.parse(mfRaw);
            out.push({ backupId: name, createdAt: mf.createdAt, path: p, cwd: mf.cwd });
        }
        catch {
        }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function restoreBackup(backupId) {
    const repoRoot = process.cwd();
    const rootDir = path.join(repoRoot, '.refineit', 'archives', backupId);
    const manifestPath = path.join(rootDir, 'manifest.json');
    if (!existsSync(manifestPath))
        throw new Error(`manifest missing: ${manifestPath}`);
    const mfRaw = await fs.readFile(manifestPath, 'utf8');
    const mf = JSON.parse(mfRaw);
    const restored = [];
    for (const e of mf.entries) {
        const src = e.backupPath;
        const dst = e.originalPath;
        if (!existsSync(src))
            throw new Error(`backup file missing: ${src}`);
        const content = await fs.readFile(src);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        if (hash !== e.sha256)
            throw new Error(`checksum mismatch for ${src} (manifest: ${e.sha256} current: ${hash})`);
        const dstDir = path.dirname(dst);
        mkdirSync(dstDir, { recursive: true });
        await fs.copyFile(src, dst);
        restored.push(dst);
    }
    return restored;
}
//# sourceMappingURL=backup.js.map