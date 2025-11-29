import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function isGitClean(): Promise<boolean> {
    try {
        // Checks if there are any uncommitted changes
        const { stdout } = await execAsync('git status --porcelain');
        return stdout.trim() === '';
    } catch (error) {
        // If not a git repo, we assume it's unsafe to automate
        return false;
    }
}