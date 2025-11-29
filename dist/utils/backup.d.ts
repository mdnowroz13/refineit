export interface BackupEntry {
    originalPath: string;
    backupPath: string;
    sha256: string;
    size: number;
    action: 'deleted' | 'modified';
}
export interface BackupManifest {
    backupId: string;
    createdAt: string;
    toolVersion: string;
    cwd: string;
    entries: BackupEntry[];
    note?: string | null;
}
export declare function createBackupRoot(note?: string): Promise<{
    backupId: string;
    rootDir: string;
    manifestPath: string;
}>;
export declare function writeManifest(manifest: BackupManifest, rootDir: string): Promise<void>;
export declare function backupFile(originalPath: string, rootDir: string, action?: 'deleted' | 'modified'): Promise<BackupEntry>;
export declare function listBackups(): Promise<{
    backupId: string;
    createdAt: string;
    path: string;
    cwd: string;
}[]>;
export declare function restoreBackup(backupId: string): Promise<string[]>;
//# sourceMappingURL=backup.d.ts.map