// __tests__/backup.test.ts
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { createBackupRoot, backupFile, restoreBackup, listBackups } from '../src/utils/backup.js';

function tmpDir() {
    return path.join(os.tmpdir(), 'refineit-backup-test-' + Math.random().toString(36).slice(2, 9));
}

describe('backup util', () => {
    test('create backup and restore files', async () => {
        const td = tmpDir();
        await fs.mkdir(td, { recursive: true });

        // create a dummy repo root structure in temp dir
        const repoFile = path.join(td, 'foo.txt');
        await fs.writeFile(repoFile, 'hello world', 'utf8');

        // run within temp repo: change cwd
        const origCwd = process.cwd();
        process.chdir(td);

        try {
            const { backupId, rootDir } = await createBackupRoot('test-note');
            // backup the file
            const entry = await backupFile(repoFile, rootDir, 'deleted');
            // delete original
            await fs.unlink(repoFile);
            // ensure deleted
            let exists = true;
            try { await fs.stat(repoFile); } catch { exists = false; }
            expect(exists).toBe(false);

            // restore
            const restored = await restoreBackup(backupId);
            expect(restored).toContain(path.resolve(repoFile));
            // file exists again
            const content = await fs.readFile(repoFile, 'utf8');
            expect(content).toBe('hello world');

            // list backups includes our backup
            const list = await listBackups();
            const found = list.find(l => l.backupId === backupId);
            expect(found).toBeDefined();
        } finally {
            process.chdir(origCwd);
            // cleanup temp dir - best effort
            try { await fs.rm(td, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }, 20000);
});
