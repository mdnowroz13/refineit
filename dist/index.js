#!/usr/bin/env node
import { intro, outro, spinner, select, note, confirm } from '@clack/prompts';
import color from 'picocolors';
import Table from 'cli-table3';
import fs from 'fs/promises';
import { getFiles } from './utils/scanner.js';
import { analyzeCodebase } from './utils/analyzer.js';
import { fixImports } from './utils/fixer.js';
import { showBanner, typeWriter, sleep } from './utils/art.js';
import { isGitClean } from './utils/git.js';
import { loadConfig } from './utils/config.js';
import { createBackupRoot, backupFile, listBackups, restoreBackup } from './utils/backup.js';
function parseArgs() {
    const argv = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--apply' || a === 'apply')
            out.apply = true;
        else if (a === '--yes' || a === '-y')
            out.yes = true;
        else if (a === '--dry-run')
            out.dryRun = true;
        else if (a === '--ci')
            out.ci = true;
        else if (a === '--export-report' && argv[i + 1]) {
            out.exportReport = argv[++i];
        }
        else if (a === '--format' && argv[i + 1])
            out.format = argv[++i];
        else if (a === 'list-backups')
            out.listBackups = true;
        else if (a === 'undo' && argv[i + 1])
            out.undo = argv[++i];
        else if (a === '--fail-on' && argv[i + 1])
            out.failOn = argv[++i];
        else if (a === '--help' || a === '-h')
            out.help = true;
    }
    return out;
}
function printHelp() {
    console.log(`
RefineIt - CLI
Usage:
  refineit [--dry-run] [--apply] [--yes] [--ci] [--export-report path] [--format json|text]
  refineit list-backups
  refineit undo <backupId>

Important flags:
  --dry-run            : analyze only, do not modify files
  --apply              : apply fixes (non-interactive requires --yes)
  --yes, -y            : confirm non-interactive actions
  --ci                 : CI mode (exit codes and JSON output)
  --export-report PATH : write report JSON to path
  --format json|text   : output format
  list-backups         : list available backups
  undo <backupId>      : restore a backup
`);
}
async function main() {
    const args = parseArgs();
    if (args.help) {
        printHelp();
        process.exit(0);
    }
    if (args.listBackups) {
        const items = await listBackups();
        if (items.length === 0) {
            console.log('No backups found.');
            process.exit(0);
        }
        console.log('Backups:');
        for (const it of items) {
            console.log(` - ${it.backupId}  (${it.createdAt})  cwd:${it.cwd}`);
        }
        process.exit(0);
    }
    if (args.undo) {
        const id = args.undo;
        try {
            console.log(`Restoring backup: ${id}`);
            const restored = await restoreBackup(id);
            console.log(color.green(`Restored ${restored.length} files.`));
            process.exit(0);
        }
        catch (e) {
            console.error(color.red('Restore failed:'), e.message || e);
            process.exit(2);
        }
    }
    showBanner();
    await typeWriter('>> Initializing Neural Engine...', 5);
    await sleep(120);
    const config = await loadConfig();
    const gitClean = await isGitClean();
    if (!gitClean) {
        console.log(color.yellow('⚠️  Warning: Git working tree is dirty. Auto-fix will be disabled for safety.'));
        await sleep(200);
    }
    intro(color.bgCyan(color.black(' ✨ RefineIt ')));
    const s = spinner();
    s.start('Scanning repository...');
    const files = await getFiles(config.dirs, config.ignore);
    const data = await analyzeCodebase(files, config.whitelist);
    s.stop('Analysis Complete.');
    let score = 100;
    score -= (data.totalTodos * 1);
    score -= (data.deadFiles.length * 2);
    score -= (data.duplicatesCount * 5);
    score -= (data.cycles.length * 5);
    score -= (data.totalSecurity * 10);
    score -= (data.unusedImports.length * 2);
    if (score < 0)
        score = 0;
    let grade = 'A';
    if (score < 90)
        grade = 'B';
    if (score < 70)
        grade = 'C';
    if (score < 50)
        grade = 'D';
    if (score < 30)
        grade = 'F';
    const table = new Table({ head: [color.cyan('Metric'), color.cyan('Count')], colWidths: [30, 10] });
    table.push(['🔴 Unused Imports', data.unusedImports.length], ['💀 Dead Files', data.deadFiles.length], ['👯 Duplicates', data.duplicatesCount], ['🔄 Circular Deps', data.cycles.length], ['📦 Large Files', data.largeFiles], ['📝 TODO Items', data.totalTodos], ['🔒 Security Risks', data.totalSecurity]);
    console.log('\n' + table.toString());
    note(`Score: ${score}/100 (Grade: ${grade})`, '📊 REPO HEALTH');
    if (args.exportReport) {
        await fs.writeFile(args.exportReport, JSON.stringify(data, null, 2), 'utf8');
        console.log(color.green('✅ Saved to ' + args.exportReport));
    }
    if (args.ci && (args.format === 'json' || args.exportReport)) {
        const json = JSON.stringify({ data, score }, null, 2);
        if (args.format === 'json') {
            console.log(json);
        }
        if (args.exportReport) {
            await fs.writeFile(args.exportReport, json, 'utf8');
        }
        if (args.failOn === 'dead' && data.deadFiles.length > 0)
            process.exit(2);
        if (args.failOn === 'security' && data.totalSecurity > 0)
            process.exit(2);
        if (data.deadFiles.length > 0 || data.totalSecurity > 0)
            process.exit(1);
        process.exit(0);
    }
    if (args.apply || args.yes) {
        if (!gitClean) {
            console.log(color.bgRed(color.white(' 🛑 SAFETY LOCK ENGAGED ')));
            console.log(color.red('You have uncommitted changes in Git.'));
            console.log(color.yellow('Please commit or stash your changes before letting RefineIt delete files.'));
            process.exit(3);
        }
        if (!args.yes) {
            const want = await confirm({ message: 'Are you sure you want to apply these changes?' });
            if (!want) {
                console.log('Aborted.');
                process.exit(0);
            }
        }
        if (data.deadFiles.length === 0 && data.unusedImports.length === 0) {
            console.log(color.green('✨ Nothing to clean!'));
            process.exit(0);
        }
        const { backupId, rootDir } = await createBackupRoot('auto-apply');
        console.log('Backing up files to', rootDir);
        for (const f of data.deadFiles) {
            try {
                await backupFile(f, rootDir, 'deleted');
            }
            catch (e) {
                console.error('Backup failed for', f, e.message || e);
                console.error(color.red('Aborting apply to avoid partial deletes.'));
                process.exit(2);
            }
        }
        const filesToEdit = [...new Set(data.unusedImports.map(u => u.file))];
        for (const f of filesToEdit) {
            try {
                if (f)
                    await backupFile(f, rootDir, 'modified');
            }
            catch (e) {
                console.error('Backup failed for', f, e.message || e);
                console.error(color.red('Aborting apply to avoid data loss.'));
                process.exit(2);
            }
        }
        for (const f of data.deadFiles) {
            try {
                await fs.unlink(f);
            }
            catch (e) { }
        }
        if (data.unusedImports.length > 0) {
            try {
                await fixImports(data.unusedImports);
            }
            catch (e) {
                console.error('Failed to fix imports:', e.message || e);
                console.error(color.red('Aborting. Please restore from backup using `refineit undo <id>`'));
                process.exit(2);
            }
        }
        console.log(color.green('✅ Applied fixes. Backup ID:'), backupId);
        console.log('You can restore using: refineit undo', backupId);
        process.exit(0);
    }
    while (true) {
        const action = await select({
            message: 'Select an action:',
            options: [
                { value: 'fix', label: '🔧 Auto-fix / Clean up' },
                { value: 'inspect', label: '👀 Inspect details' },
                { value: 'report', label: '📄 Export JSON Report' },
                { value: 'backups', label: '🗄️ List Backups' },
                { value: 'exit', label: '🚪 Exit' },
            ],
        });
        if (action === 'exit') {
            outro('Happy Coding!');
            break;
        }
        if (action === 'report') {
            await fs.writeFile('refineit-report.json', JSON.stringify(data, null, 2));
            console.log(color.green('✅ Saved to refineit-report.json'));
        }
        if (action === 'inspect') {
            if (data.deadFiles.length > 0) {
                console.log(color.red('\n💀 Dead Files:'));
                data.deadFiles.forEach(f => console.log(` - ${f}`));
            }
            if (data.unusedImports.length > 0) {
                console.log(color.magenta('\n🔴 Unused Imports:'));
                data.unusedImports.forEach(i => console.log(` - ${i.name} in ${i.file} (Line ${i.line})`));
            }
            if (data.duplicates.length > 0) {
                console.log(color.yellow('\n👯 Duplicates:'));
                data.duplicates.forEach(d => console.log(` - ${d.duplicate} (Clone of ${d.original})`));
            }
            if (data.cycles.length > 0) {
                console.log(color.blue('\n🔄 Circular Dependencies:'));
                data.cycles.forEach(c => console.log(` - ${c.join(' -> ')}`));
            }
        }
        if (action === 'backups') {
            const items = await listBackups();
            if (items.length === 0) {
                console.log('No backups found.');
            }
            else {
                console.log('Backups:');
                for (const it of items) {
                    console.log(` - ${it.backupId}  (${it.createdAt})  cwd:${it.cwd}`);
                }
            }
        }
        if (action === 'fix') {
            if (!gitClean) {
                console.log(color.bgRed(color.white(' 🛑 SAFETY LOCK ENGAGED ')));
                console.log(color.red('You have uncommitted changes in Git.'));
                console.log(color.yellow('Please commit or stash your changes before letting RefineIt delete files.'));
                continue;
            }
            const confirmed = await confirm({ message: 'Are you sure you want to apply these changes?' });
            if (!confirmed)
                continue;
            const { backupId, rootDir } = await createBackupRoot('interactive-apply');
            for (const f of data.deadFiles) {
                try {
                    await backupFile(f, rootDir, 'deleted');
                }
                catch (e) {
                    console.error('backup failed', f, e);
                }
            }
            const editFiles = [...new Set(data.unusedImports.map(u => u.file))];
            for (const f of editFiles) {
                try {
                    await backupFile(f, rootDir, 'modified');
                }
                catch (e) {
                    console.error('backup failed', f, e);
                }
            }
            for (const f of data.deadFiles) {
                try {
                    await fs.unlink(f);
                }
                catch (e) { }
            }
            if (data.unusedImports.length > 0)
                await fixImports(data.unusedImports);
            console.log(color.green('Done! Backup ID:'), backupId);
        }
    }
}
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
});
//# sourceMappingURL=index.js.map