import * as path from 'path';
import { runTests } from '@vscode/test-electron';

// I launch a real VS Code, load this extension, and run the integration suite.
async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch {
    console.error('Failed to run integration tests');
    process.exit(1);
  }
}

main();
