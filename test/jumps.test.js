'use strict';
// Runs in a real extension host: see .vscode-test.mjs.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { closeEverything } = require('./helpers');

/**
 * Back on that cell, cursor on that spot. Checked on the notebook selection
 * and the cell's own editor rather than the active editor: since VS Code
 * 1.139 the active editor follows the window's real focus, which a test
 * window in the background never gets.
 */
async function landedOn(notebook, cellIndex, [line, character]) {
  const document = notebook.cellAt(cellIndex).document;
  const deadline = Date.now() + 5000;
  const ok = () => {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document === document);
    return (
      vscode.window.activeNotebookEditor?.selections[0]?.start === cellIndex &&
      editor?.selection.active.line === line &&
      editor.selection.active.character === character
    );
  };
  while (!ok() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(ok(), `cell ${cellIndex} selected with the cursor at ${line}:${character}`);
}

/** A cold host can report the active editor a moment after the open resolves. */
async function activeEditorOn(document) {
  const deadline = Date.now() + 5000;
  while (vscode.window.activeTextEditor?.document !== document && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return vscode.window.activeTextEditor;
}

suite('jumps', () => {
  suiteSetup(closeEverything);

  test('back returns to the exact word, across cells, inside the notebook', async () => {
    // A real file, as in use: untitled notebooks reuse "Untitled-1" once the
    // previous one is closed, and so reuse its cell URIs.
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vim-notebook-jumps-')), 'nb.ipynb');
    fs.writeFileSync(
      file,
      JSON.stringify({
        cells: [
          { cell_type: 'code', metadata: {}, source: ['def foo():\n', '    return 1'], outputs: [], execution_count: null },
          { cell_type: 'code', metadata: {}, source: ['x = 1\n', 'y = foo() + 2'], outputs: [], execution_count: null },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    const notebook = await vscode.workspace.openNotebookDocument(vscode.Uri.file(file));
    await vscode.window.showNotebookDocument(notebook);
    const origin = notebook.cellAt(1).document;
    await vscode.commands.executeCommand('vscode.open', origin.uri, {
      selection: new vscode.Range(1, 5, 1, 5),
    });
    // No language server here: the definition jump itself is a no-op, the
    // position is recorded all the same. Then land in the other cell.
    await activeEditorOn(origin);
    await vscode.commands.executeCommand('vimNotebook.goToDefinition');
    await vscode.commands.executeCommand('vscode.open', notebook.cellAt(0).document.uri, {
      selection: new vscode.Range(0, 4, 0, 4),
    });

    await activeEditorOn(notebook.cellAt(0).document);
    await vscode.commands.executeCommand('vimNotebook.back');
    await landedOn(notebook, 1, [1, 5]);
    assert.strictEqual(vscode.window.activeNotebookEditor?.notebook, notebook, 'stays in the notebook');
    assert.strictEqual(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length, 1, 'no extra tab');

    await vscode.commands.executeCommand('vimNotebook.forward');
    await landedOn(notebook, 0, [0, 4]);
  });
});
