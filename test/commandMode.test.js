'use strict';
// Runs in a real extension host: a selected markdown cell in a notebook
// never edited, so there is no text editor for Vim to act on and the
// mappings run from the extension (the fallback path).
const assert = require('assert');
const vscode = require('vscode');
const { closeEverything, probeCalls, until } = require('./helpers');

suite('command mode', () => {
  const calls = probeCalls();

  suiteSetup(async () => {
    await closeEverything();
    // The mappings come from the test profile (see .vscode-test.mjs).
    const notebook = await vscode.workspace.openNotebookDocument(
      'jupyter-notebook',
      new vscode.NotebookData([
        new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, '# title', 'markdown'),
      ]),
    );
    await vscode.window.showNotebookDocument(notebook);
  });

  test("the user's single-key and leader mappings run their commands", async () => {
    calls.length = 0;
    await vscode.commands.executeCommand('vimNotebook.key', ',');
    await until(() => calls.length === 1, 'the "," mapping');
    await vscode.commands.executeCommand('vimNotebook.key', ' ');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepStrictEqual(calls, ['called'], 'leader alone waits for the next key');
    await vscode.commands.executeCommand('vimNotebook.key', 'c');
    await until(() => calls.length === 2, 'the leader mapping');
    assert.deepStrictEqual(calls, ['called', 'leader-c']);
  });

  test('a key that matches nothing drops the pending sequence', async () => {
    calls.length = 0;
    await vscode.commands.executeCommand('vimNotebook.key', ' ');
    await vscode.commands.executeCommand('vimNotebook.key', 'z');
    await vscode.commands.executeCommand('vimNotebook.key', 'c');
    await new Promise((resolve) => setTimeout(resolve, 1500)); // past vim.timeout
    assert.deepStrictEqual(calls, [], '"c" alone is not a mapping');
  });
});
