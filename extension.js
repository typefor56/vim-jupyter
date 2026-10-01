'use strict';

// Vim in Jupyter notebooks, where VSCodeVim stops short.
//
// 1. Jumps. Neither VS Code nor VSCodeVim bring `gd` back to the exact spot
//    in a notebook: VS Code's navigation history only restores the cell, and
//    Vim's jumplist sees each cell as a separate file and loses track. So the
//    position is recorded here, before the jump, and restored with
//    `vscode.open` on the cell URI: unlike showTextDocument, which opens the
//    cell in a second tab, it reveals the cell inside its notebook with the
//    cursor on the recorded line and column.
//
// 2. Command mode. With a cell selected but no cell editor focused (a
//    rendered markdown cell, after Shift+Esc…), VS Code has no active text
//    editor at all (measured), so VSCodeVim — which only acts on the active
//    editor — never sees a key and cannot run there. So:
//    - mapping keys (`,`, `;`, `<leader>…`) run the user's VSCodeVim
//      mappings from here (through Vim itself when an editor is active);
//    - `:` (setting vimNotebook.commandLine):
//      "visibleCell" — enter a code cell already on screen (the selected one,
//      else the nearest below, else above; never the topmost visible cell,
//      whose code is likely scrolled off) and type `:` into the real Vim;
//      Enter/Escape leave it and restore the selection. With no such cell,
//      the status-bar command line below.
//      "statusBar" — always a command line imitated in the status bar, next
//      to Vim's `-- NORMAL --`: nothing on screen moves, and the Ex commands
//      in vim.js (w, q, wq, x, q!, wa, qa, wqa) run from here.
//    - `//` searches the whole notebook from the same status-bar line (`n` /
//      `N` for the next / previous match, Vim's "[x/y]" count shown), honouring vim.ignorecase and
//      vim.smartcase: the matching cell is selected and revealed, and in code
//      cells the current match is highlighted (every match with vim.hlsearch)
//      and the cursor put on its start (an empty selection, so entering the
//      cell is Vim NORMAL, not Visual), without entering the cell. `:noh`, Escape or
//      Enter clears the highlight (Enter again then enters the cell); `n` /
//      `N` bring it back, as in Vim. In a cell, `//` works too (see
//      vimNotebook.cellSlash), and Enter in Vim NORMAL clears the highlight
//      instead of moving the cursor.
//    - `u` / `Ctrl-R` undo / redo the notebook's own edits.
//
// 3. The moment before. VSCodeVim only activates once startup has finished;
//    until then `Ctrl-W` closes the notebook. This extension activates first
//    and wakes VSCodeVim, and its own `Ctrl-W` chords cover a notebook while
//    Vim is inactive.
//
// Checked in a real extension host, VS Code 1.139 and 1.131, with the real
// VSCodeVim (see test/).

const vscode = require('vscode');
const { commandMappings, compileSearch, findMatch, hostCell, matchRanges, parseEx, resolve } = require('./vim');

/** Oldest positions are dropped past this. */
const MAX_JUMPS = 100;

async function run(commands) {
  for (const entry of commands) {
    if (typeof entry === 'string') {
      await vscode.commands.executeCommand(entry);
    } else if (entry !== null && typeof entry === 'object' && typeof entry.command === 'string') {
      await (entry.args === undefined
        ? vscode.commands.executeCommand(entry.command)
        : vscode.commands.executeCommand(entry.command, entry.args));
    }
  }
}

function kindOf(notebook, index) {
  return notebook.cellAt(index).kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown';
}

/** Resolves once the active editor shows `document`, or after a second. */
async function activeEditorBecomes(document) {
  const deadline = Date.now() + 1000;
  while (vscode.window.activeTextEditor?.document !== document && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Index of the cell showing `document` in the notebook editor, or -1. */
function cellIndexOf(editor, document) {
  return document === undefined ? -1 : editor.notebook.getCells().findIndex((cell) => cell.document === document);
}

/** The symbol shown before a notebook search being typed ("§raise"). */
function searchSymbol() {
  return vscode.workspace.getConfiguration('vimNotebook').get('searchSymbol', '§');
}

/** Whether '//' (besides the search key) opens the notebook search. */
function doubleSlash() {
  return vscode.workspace.getConfiguration('vimNotebook').get('doubleSlashSearch', false);
}

function vimLoaded() {
  return vscode.extensions.getExtension('vscodevim.vim')?.isActive === true;
}

function setContext(key, value) {
  void vscode.commands.executeCommand('setContext', key, value);
}

function registerJumps(context) {
  const back = [];
  const forward = [];

  /**
   * Where the user is. In a notebook, the selected cell and its own cursor:
   * the active editor can lag behind (it follows the window's real focus
   * since VS Code 1.139), the selection does not.
   */
  function here() {
    const notebookEditor = vscode.window.activeNotebookEditor;
    const selection = notebookEditor?.selections[0];
    if (notebookEditor !== undefined && selection !== undefined && selection.end - selection.start === 1) {
      const document = notebookEditor.notebook.cellAt(selection.start).document;
      const cellEditor = vscode.window.visibleTextEditors.find((editor) => editor.document === document);
      if (cellEditor !== undefined) {
        return { uri: document.uri, position: cellEditor.selection.active };
      }
    }
    const editor = vscode.window.activeTextEditor;
    return editor === undefined
      ? undefined
      : { uri: editor.document.uri, position: editor.selection.active };
  }

  function same(a, b) {
    return a.uri.toString() === b.uri.toString() && a.position.isEqual(b.position);
  }

  /** A cell deleted since the jump has nowhere to go back to. */
  function exists(uri) {
    if (uri.scheme !== 'vscode-notebook-cell') {
      return true;
    }
    const key = uri.toString();
    return vscode.workspace.notebookDocuments.some((notebook) =>
      notebook.getCells().some((cell) => cell.document.uri.toString() === key),
    );
  }

  function push(stack, jump) {
    const top = stack[stack.length - 1];
    if (top === undefined || !same(top, jump)) {
      stack.push(jump);
      if (stack.length > MAX_JUMPS) {
        stack.shift();
      }
    }
  }

  // Keybindings use these, so Ctrl-O falls back to Vim's own jumplist once
  // there is nothing recorded here.
  function updateContext() {
    setContext('vimNotebook.canGoBack', back.length > 0);
    setContext('vimNotebook.canGoForward', forward.length > 0);
  }

  async function move(from, to) {
    const current = here();
    while (from.length > 0) {
      const jump = from.pop();
      if ((current !== undefined && same(jump, current)) || !exists(jump.uri)) {
        continue;
      }
      const range = new vscode.Range(jump.position, jump.position);
      await vscode.commands.executeCommand('vscode.open', jump.uri, { selection: range });
      if (current !== undefined) {
        push(to, current);
      }
      break;
    }
    updateContext();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('vimNotebook.goToDefinition', async () => {
      const current = here();
      if (current !== undefined) {
        push(back, current);
        forward.length = 0;
      }
      updateContext();
      await vscode.commands.executeCommand('editor.action.revealDefinition');
    }),
    vscode.commands.registerCommand('vimNotebook.back', () => move(back, forward)),
    vscode.commands.registerCommand('vimNotebook.forward', () => move(forward, back)),
  );
  updateContext();
}

/**
 * Versions 0.9–0.12 hid VSCodeVim's `-- NORMAL --` by switching
 * vim.showmodename off; VSCodeVim only redraws on a key, so it could not be
 * brought back reliably and the idea was dropped. Put back a value one of
 * them left switched off.
 */
async function restoreModeName(context) {
  const KEY = 'vimNotebook.hiddenModeName';
  const saved = context.globalState.get(KEY);
  if (saved === undefined) {
    return;
  }
  await vscode.workspace
    .getConfiguration('vim')
    .update('showmodename', saved.value, vscode.ConfigurationTarget.Global);
  await context.globalState.update(KEY, undefined);
}

function registerCommandMode(context, log) {
  /** Keys typed so far of a multi-key mapping (`<leader>` g d…). */
  let typed = [];
  /**
   * A Vim command line opened by ':' from command mode, while in progress:
   * the notebook editor, the cell document hosting it, and the selection to
   * give back when that is not the cell the user had selected.
   */
  let ex;

  function clearEx() {
    if (ex !== undefined) {
      ex = undefined;
      setContext('vimNotebook.exFromCommandMode', false);
    }
  }

  async function finishEx(typedKey) {
    const finished = ex;
    clearEx();
    if (typedKey === undefined) {
      await vscode.commands.executeCommand('extension.vim_escape');
    } else {
      await vscode.commands.executeCommand('type', typedKey);
    }
    // ':q' may have closed the notebook; only a notebook still there is left.
    if (finished === undefined || vscode.window.activeNotebookEditor !== finished.editor) {
      return;
    }
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
    if (finished.restore !== undefined && finished.restore.end <= finished.editor.notebook.cellCount) {
      finished.editor.selections = [finished.restore];
    }
  }
  let timer;
  /** In a cell: Vim's own search was just opened by a '/', still empty. */
  let cellSlash = false;
  function setCellSlash(on) {
    cellSlash = on;
    setContext('vimNotebook.cellSlash', on);
  }

  /** The status-bar line: the text typed after ':' or '/', or undefined. */
  let line;
  /** ':' for an Ex command, '//' for a search of the whole notebook. */
  let lineKind = ':';
  /** The last search, for `n` / `N` and an empty `/`. */
  let lastSearch;
  // Same alignment and priority as VSCodeVim's own `-- NORMAL --` item, so
  // the two sit side by side.
  const commandLine = vscode.window.createStatusBarItem(
    'vimNotebook.commandLine',
    vscode.StatusBarAlignment.Left,
    Number.MIN_SAFE_INTEGER,
  );
  commandLine.name = 'Vim Notebook command line';
  // Keys typed so far ('/' waiting for its second, a leader…), bottom right
  // like Vim's showcmd: same place and priority as VSCodeVim's own.
  const showcmd = vscode.window.createStatusBarItem(
    'vimNotebook.showcmd',
    vscode.StatusBarAlignment.Right,
    Number.MAX_SAFE_INTEGER,
  );
  showcmd.name = 'Vim Notebook typed keys';
  /** A message left after a command ("match 1 of 3", "E486: …"). */
  let message;
  /** Until then, selection changes come from a search moving, not the user. */
  let ownMoveUntil = 0;

  /**
   * Whether a newly active editor is the search going to its match (`n` into
   * another cell), not the user moving on: that must keep the "match x of y"
   * message and the hidden mode name.
   */
  function isSearchMove(textEditor) {
    if (Date.now() <= ownMoveUntil) {
      return true;
    }
    const notebookEditor = vscode.window.activeNotebookEditor;
    const match = highlighting ? lastSearch?.match : undefined;
    return (
      notebookEditor !== undefined &&
      match !== undefined &&
      match.cell < notebookEditor.notebook.cellCount &&
      notebookEditor.notebook.cellAt(match.cell).document === textEditor.document
    );
  }

  function setShowcmd(text) {
    if (text === undefined || text === '') {
      showcmd.hide();
    } else {
      showcmd.text = text;
      showcmd.show();
    }
  }

  /** The command line while typing, otherwise the last message. */
  function renderCommandLine() {
    if (line !== undefined) {
      commandLine.text = `${lineKind === '//' ? searchSymbol() : lineKind}${line}|`;
      commandLine.show();
    } else if (message !== undefined) {
      commandLine.text = message;
      commandLine.show();
    } else {
      commandLine.hide();
    }
  }

  function showMessage(text) {
    if (text !== undefined) {
      lastSearchStatus = text;
    }
    message = text;
    renderCommandLine();
  }

  function setLine(text, kind = lineKind) {
    line = text;
    lineKind = kind;
    // Vim's incsearch: highlight as the pattern is typed.
    const live =
      text !== undefined && kind === '//' && vscode.workspace.getConfiguration('vim').get('incsearch', true)
        ? text
        : undefined;
    if (live !== livePattern) {
      livePattern = live;
      paintHighlights();
    }
    setContext('vimNotebook.cmdline', text !== undefined);
    if (text !== undefined) {
      message = undefined; // a new command line replaces the last message
    }
    renderCommandLine();
  }

  // Search highlights, as Vim's: the current match strongly, the others
  // lightly when vim.hlsearch is on. Code cells only — a rendered markdown
  // cell has no editor to decorate.
  const currentMatchStyle = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchBackground'),
    borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
    borderStyle: 'solid',
    borderWidth: '1px',
  });
  const otherMatchStyle = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  });
  let highlighting = false;
  /** The pattern being typed after '/', highlighted live (Vim's incsearch). */
  let livePattern;
  // Rendered markdown cells have no editor: renderer.js highlights them in
  // the notebook's webview, told the pattern through renderer messaging.
  const markdown = vscode.notebooks.createRendererMessaging('vim-notebook.markdown-search');
  /** Matches renderer.js last reported, for the tests. */
  let markdownHighlights = 0;

  function setHighlighting(on) {
    highlighting = on;
    if (!on) {
      showSearchStatus(undefined);
    }
    setContext('vimNotebook.highlighting', on);
    paintHighlights();
  }

  /** The pattern on show: the one being typed, else the last search. */
  function shownPattern() {
    if (livePattern !== undefined) {
      return livePattern === '' ? undefined : livePattern;
    }
    return highlighting ? lastSearch?.pattern : undefined;
  }

  /** (Re)decorate every visible cell editor of the active notebook. */
  function paintHighlights() {
    const editor = vscode.window.activeNotebookEditor;
    const cells = editor?.notebook.getCells() ?? [];
    const vim = vscode.workspace.getConfiguration('vim');
    const pattern = shownPattern();
    // While typing, every match shows (that is the point); after Enter, only
    // the current one unless vim.hlsearch.
    const all = livePattern !== undefined || vim.get('hlsearch', false);
    const regex =
      pattern === undefined
        ? undefined
        : compileSearch(pattern, vim.get('ignorecase', true), vim.get('smartcase', true));
    if (editor !== undefined) {
      void markdown.postMessage(
        regex === undefined ? {} : { source: regex.source, flags: regex.flags },
        editor,
      );
    }
    for (const cellEditor of vscode.window.visibleTextEditors) {
      const index = cells.findIndex((cell) => cell.document === cellEditor.document);
      if (index === -1 || regex === undefined) {
        cellEditor.setDecorations(currentMatchStyle, []);
        cellEditor.setDecorations(otherMatchStyle, []);
        continue;
      }
      const document = cellEditor.document;
      const toRange = ([start, end]) => new vscode.Range(document.positionAt(start), document.positionAt(end));
      const current = livePattern === undefined ? lastSearch?.match : undefined;
      const isCurrent = ([start]) => current !== undefined && current.cell === index && current.start === start;
      const ranges = matchRanges(document.getText(), regex);
      cellEditor.setDecorations(currentMatchStyle, ranges.filter(isCurrent).map(toRange));
      cellEditor.setDecorations(otherMatchStyle, all ? ranges.filter((range) => !isCurrent(range)).map(toRange) : []);
    }
  }

  /** Select and reveal a match; in a code cell, highlight it too. */
  /**
   * Go to a match. A code cell is entered with the cursor on the word, as
   * Vim's `n` does; a markdown cell is selected and shown rendered (entering
   * it would swap its rendering for its source), highlighted by renderer.js.
   */
  async function showMatch(editor, match) {
    // The selection events this move fires arrive late; they are not the
    // user moving on and must not clear the "match x of y" message.
    ownMoveUntil = Date.now() + 500;
    const cell = editor.notebook.cellAt(match.cell);
    const document = cell.document;
    if (cell.kind === vscode.NotebookCellKind.Code) {
      const position = document.positionAt(match.start);
      await vscode.commands.executeCommand('vscode.open', document.uri, {
        selection: new vscode.Range(position, position),
      });
      paintHighlights();
      return;
    }
    if (cellIndexOf(editor, vscode.window.activeTextEditor?.document) !== -1) {
      await vscode.commands.executeCommand('notebook.cell.quitEdit');
    }
    const range = new vscode.NotebookRange(match.cell, match.cell + 1);
    editor.selections = [range];
    editor.revealRange(range, vscode.NotebookEditorRevealType.InCenterIfOutsideViewport);
    paintHighlights();
  }

  /** The search message ("match 2 of 7"), kept until the next search or :noh. */
  let lastSearchStatus;
  function showSearchStatus(text) {
    lastSearchStatus = text;
    showMessage(text);
  }

  /** Search from the selected cell (or from the last match when still on it). */
  async function search(backward) {
    const editor = vscode.window.activeNotebookEditor;
    if (editor === undefined || lastSearch === undefined) {
      return;
    }
    const vim = vscode.workspace.getConfiguration('vim');
    const regex = compileSearch(lastSearch.pattern, vim.get('ignorecase', true), vim.get('smartcase', true));
    const selected = editor.selections[0]?.start ?? 0;
    const active = vscode.window.activeTextEditor;
    const inCell = active !== undefined && cellIndexOf(editor, active.document) === selected;
    // In a cell, from the cursor, as Vim; else from the last match on this
    // cell, or from the cell's start.
    const from = inCell
      ? { cell: selected, offset: active.document.offsetAt(active.selection.active) }
      : lastSearch.match !== undefined && lastSearch.match.cell === selected
        ? { cell: selected, offset: lastSearch.match.start }
        : { cell: selected, offset: backward ? Number.MAX_SAFE_INTEGER : -1 };
    const texts = editor.notebook.getCells().map((cell) => cell.document.getText());
    const match = findMatch(texts, regex, from, backward);
    log.info(`search ${JSON.stringify(lastSearch.pattern)} -> ${match === undefined ? 'none' : `cell ${match.cell}`}`);
    if (match === undefined) {
      showSearchStatus(`E486: Pattern not found: ${lastSearch.pattern}`);
      return;
    }
    lastSearch.match = match;
    setHighlighting(true);
    // Vim's search count, spelled out; the pattern line itself is gone.
    showSearchStatus(
      `match ${match.index} of ${match.total}` +
        (match.wrapped ? (backward ? ' (continuing at BOTTOM)' : ' (continuing at TOP)') : ''),
    );
    await showMatch(editor, match);
  }

  function setTyped(keys) {
    typed = keys;
    setContext('vimNotebook.pending', keys.length > 0);
    // Like Vim's showcmd: the keys typed so far.
    setShowcmd(keys.map((key) => (key === ' ' ? '<space>' : key)).join(''));
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('vimNotebook.key', async (key) => {
      const vim = vscode.workspace.getConfiguration('vim');
      const mappings = commandMappings(
        [
          ...vim.get('normalModeKeyBindingsNonRecursive', []),
          ...vim.get('normalModeKeyBindings', []),
        ],
        vim.get('leader', '\\'),
      );
      const keys = [...typed, key];
      const result = resolve(keys, mappings);
      clearTimeout(timer);
      // Through Vim when it has an editor; only keys that belong to a mapping,
      // since any other key would run its Vim action on a cell not being
      // edited. In command mode there is no editor, so the mapping runs here.
      const vimHasEditor = vscode.window.activeTextEditor !== undefined && vimLoaded();
      if (result === 'prefix') {
        setTyped(keys);
        timer = setTimeout(() => setTyped([]), vim.get('timeout', 1000));
        if (vimHasEditor) {
          await vscode.commands.executeCommand('vim.remap', { after: [key] });
        }
        return;
      }
      setTyped([]);
      if (result === undefined) {
        return;
      }
      if (vimHasEditor) {
        await vscode.commands.executeCommand('vim.remap', { after: [key] });
      } else {
        await run(result);
      }
    }),
    vscode.commands.registerCommand('vimNotebook.cancel', () => {
      clearTimeout(timer);
      setTyped([]);
    }),
    vscode.commands.registerCommand('vimNotebook.ex', async () => {
      const editor = vscode.window.activeNotebookEditor;
      const selection = editor?.selections[0];
      if (editor === undefined || selection === undefined) {
        return;
      }
      const mode = vscode.workspace.getConfiguration('vimNotebook').get('commandLine', 'visibleCell');
      const target =
        mode === 'visibleCell' && vimLoaded()
          ? hostCell(
              editor.visibleRanges,
              (cell) => editor.notebook.cellAt(cell).kind === vscode.NotebookCellKind.Code,
              selection.start,
            )
          : undefined;
      log.info(
        `':' selected=${selection.start} (${kindOf(editor.notebook, selection.start)})` +
          ` -> ${target === undefined ? 'status bar' : `cell ${target}`}`,
      );
      if (target === undefined) {
        setLine('', ':');
        return;
      }
      ex = { editor, restore: target === selection.start ? undefined : selection };
      if (target !== selection.start) {
        editor.selections = [new vscode.NotebookRange(target, target + 1)];
      }
      await vscode.commands.executeCommand('notebook.cell.edit');
      ex.document = editor.notebook.cellAt(target).document;
      setContext('vimNotebook.exFromCommandMode', true);
      // Vim types into the *active* editor, which only appears once the cell
      // has focus; typing earlier would reach no editor at all.
      await activeEditorBecomes(ex.document);
      await vscode.commands.executeCommand('vim.remap', { after: [':'] });
    }),
    // Outside a cell a '/' opens a '/' line that takes every key: a second
    // '/' right away makes it the '//' notebook search; anything else is
    // kept off the notebook's own keys (Jupyter's `a` would insert a cell)
    // and Enter explains to use '//'.
    vscode.commands.registerCommand('vimNotebook.slash', () => setLine('', '/')),
    // A dedicated key straight to the notebook search (e.g. '§' on AZERTY),
    // from a cell or not: no '/' through Vim first, so nothing flickers.
    // The line takes the keys before the next one can reach Vim.
    vscode.commands.registerCommand('vimNotebook.search', async () => {
      await vscode.commands.executeCommand('setContext', 'vimNotebook.cmdline', true);
      setLine('', '//');
    }),
    // In a cell, '/' is Vim's own search of that cell, opened at once (a
    // delay would send the next keys to Vim as commands). A second '/'
    // right after turns it into '//': Vim's search is closed, the cell left
    // (nothing moves) and the notebook search line opened.
    // `from` is where the '/' was typed: 'normal' (always a first '/') or
    // 'search' (Vim's search line, still empty after a first '/').
    vscode.commands.registerCommand('vimNotebook.cellSlash', async (from) => {
      if (cellSlash && from !== 'normal') {
        setCellSlash(false);
        // The '//' line takes the keys at once — anything slow first would
        // let the next letters fall into Vim's own search. The cell keeps
        // the focus.
        await vscode.commands.executeCommand('setContext', 'vimNotebook.cmdline', true);
        setLine('', '//');
        await vscode.commands.executeCommand('extension.vim_escape');
        return;
      }
      // No time limit: the second '/' may come any time, as long as nothing
      // else was typed — the first other key ends it (vimNotebook.cellSlashKey).
      setCellSlash(true);
      await vscode.commands.executeCommand('vim.remap', { after: ['/'] });
    }),
    // The first key typed in Vim's search after a lone '/': it was a search
    // of the cell after all; the key goes on to Vim.
    vscode.commands.registerCommand('vimNotebook.cellSlashKey', async (key) => {
      setCellSlash(false);
      await vscode.commands.executeCommand('type', { text: key === '<CR>' ? '\n' : key });
    }),
    markdown.onDidReceiveMessage((event) => {
      if (typeof event.message?.count === 'number') {
        markdownHighlights = event.message.count;
      }
    }),
    // Cells rendered as the notebook scrolls get the highlight too.
    vscode.window.onDidChangeNotebookEditorVisibleRanges(() => {
      if (shownPattern() !== undefined) {
        paintHighlights();
      }
    }),
    // For the tests: how many matches the markdown renderer highlighted.
    vscode.commands.registerCommand('vimNotebook.test.markdownHighlights', () => markdownHighlights),
    vscode.commands.registerCommand('vimNotebook.test.searchStatus', () => lastSearchStatus),
    // For the tests: the message on screen right now (undefined when gone).
    vscode.commands.registerCommand('vimNotebook.test.message', () => message),
    // For the tests: the command line as shown, or undefined when hidden.
    vscode.commands.registerCommand('vimNotebook.test.lineText', () => (line === undefined ? undefined : commandLine.text)),
    vscode.commands.registerCommand('vimNotebook.noHighlight', () => setHighlighting(false)),
    // Cells scrolled into view, or edited, get their highlights (re)drawn.
    // Always repaint, also to clear: the notebook recycles cell editors as it
    // scrolls, and one that left the screen with a highlight would bring it
    // back on another cell, at the same place.
    vscode.window.onDidChangeVisibleTextEditors(() => paintHighlights()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!highlighting) {
        return;
      }
      paintHighlights();
    }),
    currentMatchStyle,
    otherMatchStyle,
    vscode.commands.registerCommand('vimNotebook.searchNext', () => search(false)),
    vscode.commands.registerCommand('vimNotebook.searchPrevious', () => search(true)),
    // A key typed on the status-bar command line (Vim notation for the
    // special ones).
    vscode.commands.registerCommand('vimNotebook.exKey', async (key) => {
      if (line === undefined) {
        return;
      }
      if (key === '<Esc>') {
        setLine(undefined);
      } else if (key === '<BS>') {
        // Like Vim: backspace on an empty command line leaves it.
        setLine(line === '' ? undefined : line.slice(0, -1));
      } else if (key === '<CR>') {
        const text = line;
        const kind = lineKind;
        setLine(undefined);
        if (kind === '/') {
          showMessage(`/${text}: '/' searches inside a cell only, type ${searchSymbol()} to search the whole notebook`);
          return;
        }
        if (kind === '//') {
          // Like Vim, an empty pattern repeats the last one.
          if (text !== '') {
            lastSearch = { pattern: text, match: undefined };
            setContext('vimNotebook.hasSearch', true);
          }
          await search(false);
          return;
        }
        if (text.trim() === '') {
          return;
        }
        const commands = parseEx(text);
        if (commands === undefined) {
          showMessage(`E492: Not an editor command: ${text}`);
          return;
        }
        await run(commands);
      } else if (lineKind === '/' && line === '' && key === '/' && doubleSlash()) {
        setLine('', '//'); // the second '/' of '//'
      } else {
        setLine(line + key);
      }
    }),
    // Enter / Escape on a command line opened from command mode: Vim gets
    // the key, then the cell is left as it was before ':'.
    vscode.commands.registerCommand('vimNotebook.exSubmit', () => finishEx({ text: '\n' })),
    vscode.commands.registerCommand('vimNotebook.exCancel', () => finishEx(undefined)),
    // Moving to another editor abandons the command line; entering the cell
    // that hosts it does not.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (ex?.document !== undefined && editor?.document !== ex.document) {
        clearEx();
      }
    }),
    // The message goes, and `-- NORMAL --` comes back, as soon as the user
    // moves on: into a cell or another editor, or to another cell (a search
    // selecting its own match does not count).
    vscode.window.onDidChangeActiveTextEditor((textEditor) => {
      if (textEditor !== undefined && message !== undefined && !isSearchMove(textEditor)) {
        showMessage(undefined);
      }
    }),
    vscode.window.onDidChangeNotebookEditorSelection((event) => {
      const cell = event.selections[0]?.start;
      if (message !== undefined && cell !== lastSearch?.match?.cell && Date.now() > ownMoveUntil) {
        showMessage(undefined);
      }
    }),
    // Like Vim's command line, it belongs to the editor it was opened in.
    vscode.window.onDidChangeActiveNotebookEditor(() => {
      setLine(undefined);
      setHighlighting(false);
    }),
    commandLine,
    showcmd,
  );
  setContext('vimNotebook.pending', false);
  setContext('vimNotebook.exFromCommandMode', false);
  setContext('vimNotebook.cmdline', false);
  setContext('vimNotebook.hasSearch', false);
  setContext('vimNotebook.highlighting', false);
  setContext('vimNotebook.cellSlash', false);
}

function activate(context) {
  // Wake VSCodeVim now rather than when startup finishes: until it runs,
  // Ctrl-W in a cell closes the notebook instead of moving between panes.
  void vscode.extensions.getExtension('vscodevim.vim')?.activate();
  registerJumps(context);
  // What ':' targeted, so a misbehaviour can be read back from VS Code's logs.
  const log = vscode.window.createOutputChannel('Vim Notebook', { log: true });
  context.subscriptions.push(log);
  void restoreModeName(context);
  registerCommandMode(context, log);
}

function deactivate() {}

module.exports = { activate, deactivate };
