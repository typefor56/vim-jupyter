'use strict';
// Runs in a real extension host with the real VSCodeVim (see .vscode-test.mjs).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { closeEverything, probeCalls, until } = require('./helpers');

const editing = (document) =>
  vscode.window.visibleTextEditors.some((editor) => editor.document === document);

suite('native Vim from command mode', () => {
  const calls = probeCalls();
  let notebook;

  suiteTeardown(() =>
    vscode.workspace.getConfiguration('vimNotebook').update('commandLine', undefined, vscode.ConfigurationTarget.Global),
  );

  suiteSetup(async function () {
    await vscode.workspace
      .getConfiguration('vimNotebook')
      .update('commandLine', 'visibleCell', vscode.ConfigurationTarget.Global);
    const vim = vscode.extensions.getExtension('vscodevim.vim');
    if (vim === undefined) {
      this.skip(); // VSCodeVim not installed locally
    }
    await until(() => vim.isActive, 'VSCodeVim active');
    await closeEverything();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vim-notebook-nb-')), 'nb.ipynb');
    fs.writeFileSync(
      file,
      JSON.stringify({
        cells: [
          { cell_type: 'markdown', metadata: {}, source: ['# title'] },
          { cell_type: 'code', metadata: {}, source: ['x = 1'], outputs: [], execution_count: null },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    notebook = await vscode.workspace.openNotebookDocument(vscode.Uri.file(file));
    await vscode.window.showNotebookDocument(notebook);
    // Edit the code cell once (so Vim has an editor), then leave: command mode.
    await vscode.commands.executeCommand('notebook.focusBottom');
    await vscode.commands.executeCommand('notebook.cell.edit');
    await until(() => vscode.window.activeTextEditor?.document === notebook.cellAt(1).document, 'code cell editor');
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
  });

  test('a mapping key is resolved by Vim itself, without entering the cell', async () => {
    calls.length = 0;
    await vscode.commands.executeCommand('vimNotebook.key', ';');
    await until(() => calls.includes('semicolon'), "Vim running the ';' mapping");
  });

  test("':' on a markdown cell uses the nearest code cell; :w saves, selection comes back", async () => {
    const edit = new vscode.WorkspaceEdit();
    const code = notebook.cellAt(1).document;
    edit.insert(code.uri, new vscode.Position(0, 0), '# dirty\n');
    await vscode.workspace.applyEdit(edit);
    assert.ok(notebook.isDirty);

    const markdown = notebook.cellAt(0).document;
    const editor = vscode.window.activeNotebookEditor;
    await vscode.commands.executeCommand('notebook.focusTop'); // markdown selected, command mode
    await until(() => editor.selections[0]?.start === 0, 'the markdown cell selected');
    await vscode.commands.executeCommand('vimNotebook.ex');
    await until(() => editor.selections[0]?.start === 1, 'the code cell hosting the command line');
    assert.strictEqual(editing(markdown), false, 'the markdown cell stays rendered');
    await vscode.commands.executeCommand('type', { text: 'w' });
    await vscode.commands.executeCommand('vimNotebook.exSubmit'); // what Enter runs
    await until(() => !notebook.isDirty, ':w saving the notebook');
    await until(() => editor.selections[0]?.start === 0, 'the markdown cell selected again');
    assert.strictEqual(editing(markdown), false, 'the markdown cell was never edited');
  });
});

suite('native Vim: the command line stays where you are', () => {
  test("':' far down a notebook does not scroll back to the last cell edited", async function () {
    const vim = vscode.extensions.getExtension('vscodevim.vim');
    if (vim === undefined) {
      this.skip();
    }
    await until(() => vim.isActive, 'VSCodeVim active');
    await closeEverything();
    const markdown = (text) => ({ cell_type: 'markdown', metadata: {}, source: [text] });
    const code = (text) => ({ cell_type: 'code', metadata: {}, source: [text], outputs: [], execution_count: null });
    const cells = [code('top = 1')];
    for (let i = 1; i <= 50; i++) {
      cells.push(markdown(`## section ${i}\n\ntext`));
    }
    cells.push(code('near = 2'), markdown('# selected'));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vim-notebook-long-')), 'long.ipynb');
    fs.writeFileSync(file, JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 5 }));
    const notebook = await vscode.workspace.openNotebookDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showNotebookDocument(notebook);

    // Last cell edited: the very first one, at the top.
    await vscode.commands.executeCommand('notebook.focusTop');
    await vscode.commands.executeCommand('notebook.cell.edit');
    await until(() => vscode.window.activeTextEditor?.document === notebook.cellAt(0).document, 'top cell editor');
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
    // Command mode on the last markdown cell, far down.
    await vscode.commands.executeCommand('notebook.focusBottom');
    await until(() => editor.selections[0]?.start === 52, 'the bottom markdown cell selected');

    await vscode.commands.executeCommand('vimNotebook.ex');
    await new Promise((resolve) => setTimeout(resolve, 800));
    const visible = editor.visibleRanges.some((range) => range.start <= 51 && 51 < range.end);
    const top = editor.visibleRanges.some((range) => range.start === 0);
    await vscode.commands.executeCommand('vimNotebook.exCancel');
    assert.ok(visible && !top, `view stays on the nearest code cell (visible: ${JSON.stringify(editor.visibleRanges)})`);
  });
});

suite('status-bar command line: nothing moves', () => {
  let notebook;
  let editor;
  let markdownDocs;

  suiteSetup(async () => {
    await vscode.workspace
      .getConfiguration('vimNotebook')
      .update('commandLine', 'statusBar', vscode.ConfigurationTarget.Global);
    await closeEverything();
    const markdown = (text) => ({ cell_type: 'markdown', metadata: {}, source: [text] });
    const code = (text) => ({ cell_type: 'code', metadata: {}, source: [text], outputs: [], execution_count: null });
    const cells = [code('top = 1')];
    for (let i = 1; i <= 40; i++) {
      cells.push(markdown(`## section ${i}\n\ntext`));
    }
    cells.push(code('near = 2'), markdown('# selected'));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vim-notebook-bar-')), 'bar.ipynb');
    fs.writeFileSync(file, JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 5 }));
    notebook = await vscode.workspace.openNotebookDocument(vscode.Uri.file(file));
    editor = await vscode.window.showNotebookDocument(notebook);
    markdownDocs = notebook
      .getCells()
      .filter((cell) => cell.kind === vscode.NotebookCellKind.Markup)
      .map((cell) => cell.document);
    await vscode.commands.executeCommand('notebook.focusBottom');
    await until(() => editor.selections[0]?.start === 42, 'the bottom markdown cell selected');
  });

  suiteTeardown(() =>
    vscode.workspace
      .getConfiguration('vimNotebook')
      .update('commandLine', undefined, vscode.ConfigurationTarget.Global),
  );

  async function dirty() {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(notebook.cellAt(0).document.uri, new vscode.Position(0, 0), '# dirty\n');
    await vscode.workspace.applyEdit(edit);
    assert.ok(notebook.isDirty);
  }

  const screen = () => JSON.stringify(editor.visibleRanges.map((range) => [range.start, range.end]));
  /** The visible ranges once the view stopped moving (it settles after a jump). */
  async function settledScreen() {
    let previous = screen();
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const current = screen();
      if (current === previous) {
        return current;
      }
      previous = current;
    }
    return previous;
  }
  const anyMarkdownEdited = () =>
    vscode.window.visibleTextEditors.some((candidate) => markdownDocs.includes(candidate.document));

  test(':w Enter saves; no cell entered, selection and scroll untouched', async () => {
    await dirty();
    const before = await settledScreen();
    await vscode.commands.executeCommand('vimNotebook.ex');
    for (const key of ['w', '<CR>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await until(() => !notebook.isDirty, ':w saving the notebook');
    assert.strictEqual(editor.selections[0]?.start, 42, 'selection untouched');
    assert.strictEqual(anyMarkdownEdited(), false, 'no markdown cell entered');
    assert.strictEqual(screen(), before, 'nothing scrolled');
  });

  test('Escape, Backspace and unknown commands change nothing', async () => {
    await dirty();
    await vscode.commands.executeCommand('vimNotebook.ex');
    for (const key of ['w', '<Esc>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await vscode.commands.executeCommand('vimNotebook.ex');
    for (const key of ['z', 'z', '<CR>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    // Backspace on an empty line leaves it: the 'w' after is not typed.
    await vscode.commands.executeCommand('vimNotebook.ex');
    for (const key of ['<BS>', 'w', '<CR>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(notebook.isDirty, 'nothing saved');
    await vscode.commands.executeCommand('workbench.action.files.save');
  });
});

suite('search and undo from command mode', () => {
  let notebook;
  let editor;

  suiteSetup(async () => {
    await closeEverything();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vim-notebook-search-')), 'search.ipynb');
    fs.writeFileSync(
      file,
      JSON.stringify({
        cells: [
          { cell_type: 'markdown', metadata: {}, source: ['# intro'] },
          { cell_type: 'code', metadata: {}, source: ['a = 1'], outputs: [], execution_count: null },
          { cell_type: 'markdown', metadata: {}, source: ['## the foo section'] },
          { cell_type: 'code', metadata: {}, source: ['x = foo()'], outputs: [], execution_count: null },
          { cell_type: 'markdown', metadata: {}, source: ['end'] },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    notebook = await vscode.workspace.openNotebookDocument(vscode.Uri.file(file));
    editor = await vscode.window.showNotebookDocument(notebook);
    await vscode.commands.executeCommand('notebook.focusTop');
    await until(() => editor.selections[0]?.start === 0, 'first cell selected');
  });

  const selected = () => editor.selections[0]?.start;

  test('/foo Enter, n, N: cells selected in turn; the match highlighted in a code cell', async () => {
    await vscode.commands.executeCommand('vimNotebook.search');
    for (const key of ['f', 'o', 'o', '<CR>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await until(() => selected() === 2, 'the markdown cell with foo');
    assert.strictEqual(
      await vscode.commands.executeCommand('vimNotebook.test.searchStatus'),
      'match 1 of 2',
      "Vim's search count",
    );
    await vscode.commands.executeCommand('vimNotebook.searchNext');
    await until(() => selected() === 3, 'the code cell with foo');
    const code = notebook.cellAt(3).document;
    await until(() => {
      const cellEditor = vscode.window.visibleTextEditors.find((candidate) => candidate.document === code);
      return (
        cellEditor !== undefined &&
        cellEditor.selection.isEmpty &&
        cellEditor.selection.active.character === 4
      );
    }, 'the cursor on foo, nothing selected (NORMAL, not Visual)');
    await vscode.commands.executeCommand('vimNotebook.searchNext');
    await until(() => selected() === 2, 'wrapping back to the first match');
    await vscode.commands.executeCommand('vimNotebook.searchPrevious');
    await until(() => selected() === 3, 'N going back (wrapping)');
    // :noh typed on the status-bar line, then n searches (and highlights) again.
    await vscode.commands.executeCommand('vimNotebook.ex');
    for (const key of ['n', 'o', 'h', '<CR>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await vscode.commands.executeCommand('vimNotebook.searchNext');
    await until(() => selected() === 2, 'n after :noh');
  });

  test("outside a cell, '/' + another key is held back with an error; '//' opens the notebook search", async () => {
    const count = () => vscode.commands.executeCommand('vimNotebook.test.markdownHighlights');
    const status = () => vscode.commands.executeCommand('vimNotebook.test.searchStatus');
    await vscode.commands.executeCommand('vimNotebook.noHighlight');
    await until(async () => (await count()) === 0, 'no highlight to start with');
    const cells = notebook.cellCount;
    // '/ra' Enter: no search, no notebook key (Jupyter's `a` would add a cell).
    await vscode.commands.executeCommand('vimNotebook.slash');
    for (const key of ['r', 'a', '<CR>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(notebook.cellCount, cells, 'no cell added');
    assert.strictEqual(await count(), 0, 'nothing searched');
    assert.ok(String(await status()).startsWith("/ra: '/' searches inside a cell only"), 'the hint to use //');
    // '//' then 'foo': the notebook search, highlighting live.
    await vscode.commands.executeCommand('vimNotebook.slash');
    for (const key of ['/', 'f', 'o', 'o']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await until(async () => (await count()) >= 1, "'//foo' highlighting live");
    await vscode.commands.executeCommand('vimNotebook.exKey', '<Esc>');
  });

  test("a single '/' inside a code cell is Vim's own search of that cell", async function () {
    // Needs the active editor to follow into the cell: since 1.139 that only
    // happens reliably in a window that has the keyboard focus.
    const since139 = vscode.version.localeCompare('1.139.0', undefined, { numeric: true }) >= 0;
    if (since139 && !vscode.window.state.focused) {
      this.skip();
    }
    const code = notebook.cellAt(3).document; // 'x = foo()'
    editor.selections = [new vscode.NotebookRange(3, 4)];
    await vscode.commands.executeCommand('notebook.cell.edit');
    await until(() => vscode.window.activeTextEditor?.document === code, 'in the code cell');
    vscode.window.activeTextEditor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand('vimNotebook.cellSlash', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    // The first key after '/' (taken by the extension's keybinding), then Vim.
    await vscode.commands.executeCommand('vimNotebook.cellSlashKey', 'f');
    for (const text of ['o', 'o', '\n']) {
      await vscode.commands.executeCommand('type', { text });
    }
    await until(
      () => vscode.window.activeTextEditor?.selection.active.character === 4,
      "Vim's search moving the cursor onto foo in this cell",
    );
    assert.strictEqual(vscode.window.activeTextEditor.document, code, 'still in the same cell');
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
  });

  test("'//' typed inside a code cell opens the notebook search; Escape goes back into the cell", async function () {
    const count = () => vscode.commands.executeCommand('vimNotebook.test.markdownHighlights');
    await vscode.commands.executeCommand('vimNotebook.noHighlight');
    await until(async () => (await count()) === 0, 'no highlight to start with');
    const code = notebook.cellAt(1).document;
    editor.selections = [new vscode.NotebookRange(1, 2)];
    await vscode.commands.executeCommand('notebook.cell.edit');
    await until(() => vscode.window.activeTextEditor?.document === code, 'in the code cell');
    await vscode.commands.executeCommand('vimNotebook.cellSlash'); // Vim's own search opens
    await vscode.commands.executeCommand('vimNotebook.cellSlash'); // second '/': notebook search
    for (const key of ['f', 'o', 'o']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await until(async () => (await count()) >= 1, "'//foo' from a cell highlighting live");
    await vscode.commands.executeCommand('vimNotebook.exKey', '<Esc>');
    await until(async () => (await count()) === 0, 'Escape clearing it');
    await until(() => vscode.window.activeTextEditor?.document === code, 'back in the code cell');
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
  });

  test("'//foo' Enter from a cell goes into the code cell with the cursor on foo; n goes on; Enter ends", async () => {
    await vscode.commands.executeCommand('vimNotebook.noHighlight');
    const status = () => vscode.commands.executeCommand('vimNotebook.test.searchStatus');
    const codeEditorAt = (index) =>
      vscode.window.visibleTextEditors.find((candidate) => candidate.document === notebook.cellAt(index).document);
    editor.selections = [new vscode.NotebookRange(1, 2)];
    await vscode.commands.executeCommand('notebook.cell.edit');
    await until(() => vscode.window.activeTextEditor?.document === notebook.cellAt(1).document, 'in cell 1');
    await vscode.commands.executeCommand('vimNotebook.cellSlash');
    await vscode.commands.executeCommand('vimNotebook.cellSlash');
    for (const key of ['f', 'o', 'o', '<CR>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    // First match after cell 1: the markdown cell 2, selected (rendered).
    await until(() => editor.selections[0]?.start === 2, 'the markdown match');
    await until(async () => (await status()) === 'match 1 of 2', 'match 1 of 2');
    // n: the code cell 3, entered with the cursor on foo.
    await vscode.commands.executeCommand('vimNotebook.searchNext');
    await until(
      () => editor.selections[0]?.start === 3 && codeEditorAt(3)?.selection.active.character === 4,
      'cell 3 with the cursor on foo',
    );
    await until(async () => (await status()) === 'match 2 of 2', 'match 2 of 2');
    // Still on screen once in the other cell (moving there is not leaving).
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.strictEqual(
      await vscode.commands.executeCommand('vimNotebook.test.message'),
      'match 2 of 2',
      'the count stays after n moved into another cell',
    );
    // Enter (what it runs in a cell): the search ends, the cursor stays.
    await vscode.commands.executeCommand('vimNotebook.noHighlight');
    assert.strictEqual(editor.selections[0]?.start, 3);
    assert.strictEqual(codeEditorAt(3)?.selection.active.character, 4);
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
  });

  test("a second '/' long after the first, in a cell, still opens the notebook search", async () => {
    const count = () => vscode.commands.executeCommand('vimNotebook.test.markdownHighlights');
    await vscode.commands.executeCommand('vimNotebook.noHighlight');
    await until(async () => (await count()) === 0, 'no highlight to start with');
    const code = notebook.cellAt(1).document;
    editor.selections = [new vscode.NotebookRange(1, 2)];
    await vscode.commands.executeCommand('notebook.cell.edit');
    await until(() => vscode.window.activeTextEditor?.document === code, 'in the code cell');
    await vscode.commands.executeCommand('vimNotebook.cellSlash', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 1500)); // past vim.timeout
    await vscode.commands.executeCommand('vimNotebook.cellSlash', 'search');
    for (const key of ['f', 'o', 'o']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await until(async () => (await count()) >= 1, "'//foo' highlighting the notebook");
    await vscode.commands.executeCommand('vimNotebook.exKey', '<Esc>');
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
  });

  test("'//foo' Enter from inside a code cell leaves only 'match x of y'", async () => {
    const code = notebook.cellAt(1).document;
    editor.selections = [new vscode.NotebookRange(1, 2)];
    await vscode.commands.executeCommand('notebook.cell.edit');
    await until(() => vscode.window.activeTextEditor?.document === code, 'in the code cell');
    await vscode.commands.executeCommand('vimNotebook.cellSlash');
    await vscode.commands.executeCommand('vimNotebook.cellSlash');
    for (const key of ['f', 'o', 'o', '<CR>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await until(
      async () => /^match \d+ of 2/.test(String(await vscode.commands.executeCommand('vimNotebook.test.searchStatus'))),
      "only 'match x of 2' left in the status bar",
    );
    await vscode.commands.executeCommand('vimNotebook.noHighlight');
  });

  test('rendered markdown is highlighted live while typing /foo, and after Enter until :noh', async () => {
    const count = () => vscode.commands.executeCommand('vimNotebook.test.markdownHighlights');
    // Start without a highlight: Escape on '/' goes back to the previous state.
    await vscode.commands.executeCommand('vimNotebook.noHighlight');
    await until(async () => (await count()) === 0, 'no highlight to start with');
    await vscode.commands.executeCommand('notebook.focusTop');
    await vscode.commands.executeCommand('vimNotebook.search');
    for (const key of ['f', 'o', 'o']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await until(async () => (await count()) >= 1, 'foo highlighted in the markdown cell before Enter');
    await vscode.commands.executeCommand('vimNotebook.exKey', '<Esc>');
    await until(async () => (await count()) === 0, 'Escape clearing the live highlight');
    await vscode.commands.executeCommand('vimNotebook.search');
    for (const key of ['f', 'o', 'o', '<CR>']) {
      await vscode.commands.executeCommand('vimNotebook.exKey', key);
    }
    await until(async () => (await count()) >= 1, 'still highlighted after Enter');
    await vscode.commands.executeCommand('vimNotebook.noHighlight');
    await until(async () => (await count()) === 0, ':noh clearing it');
  });

  test('u undoes and Ctrl-R redoes a notebook edit', async function () {
    // `undo` acts on whatever has the keyboard focus, which a test window in
    // the background does not reliably get: the result there means nothing.
    // Since 1.139 it is flaky even when the window reports focus. Confirmed
    // working by hand (1.139.1).
    const since139 = vscode.version.localeCompare('1.139.0', undefined, { numeric: true }) >= 0;
    if (!vscode.window.state.focused || since139) {
      this.skip();
    }
    const before = notebook.cellCount;
    await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
    await until(() => notebook.cellCount === before + 1, 'a cell inserted');
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
    await vscode.commands.executeCommand('undo'); // what u runs
    await until(() => notebook.cellCount === before, 'u removing the inserted cell');
    await vscode.commands.executeCommand('redo'); // what Ctrl-R runs
    await until(() => notebook.cellCount === before + 1, 'Ctrl-R restoring it');
  });
});
