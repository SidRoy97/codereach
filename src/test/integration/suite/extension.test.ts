import * as assert from 'assert';
import * as vscode from 'vscode';

// I check the extension activates and registers its commands inside VS Code.
suite('CodeReach integration', () => {
  test('extension is present', () => {
    assert.ok(vscode.extensions.getExtension('SidRoy300497.codereach'));
  });

  test('activates without error', async () => {
    const ext = vscode.extensions.getExtension('SidRoy300497.codereach');
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  test('registers its core commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['codereach.analyzeFile', 'codereach.findPath', 'codereach.taintScanWorkspace', 'codereach.showBlastRadius']) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });
});
