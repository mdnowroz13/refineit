import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
export async function isGitClean() {
    try {
        const { stdout } = await execAsync('git status --porcelain');
        return stdout.trim() === '';
    }
    catch (error) {
        return false;
    }
}
//# sourceMappingURL=git.js.map