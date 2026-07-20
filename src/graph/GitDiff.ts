import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);
const SOURCE = /\.(js|jsx|ts|tsx|py|java)$/;

// I ask git which source files changed versus a ref, relative to the repo root.
export class GitDiff {
  // I return changed source file paths, excluding deletions.
  async changedFiles(root: string, ref: string): Promise<string[]> {
    const { stdout } = await run('git', ['diff', '--name-only', '--diff-filter=d', ref], { cwd: root });
    return stdout.split('\n').map(line => line.trim()).filter(line => SOURCE.test(line));
  }
}
