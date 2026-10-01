# Vim Jupyter

Vim where [VSCodeVim](https://github.com/VSCodeVim/Vim) stops short in Jupyter
notebooks. Requires VSCodeVim. (Formerly published as Vim Notebook.)

## What it adds

**Jumps across cells.** `gd` then `Ctrl-O` / `Ctrl-I` return to the exact
word, even when the definition is in another cell. VS Code's history only
restores the cell; VSCodeVim's jumplist loses track between cells.

**Vim keys on a selected cell** (cell selected, not being edited, where
VSCodeVim sees no key):

| Keys | Does |
| --- | --- |
| `:` | Command line in the status bar: `w` `q` `wq` `x` `q!` `wa` `qa` `wqa` `noh` |
| `§` | Search the whole notebook (see below) |
| `u` / `Ctrl-R` | Undo / redo notebook edits |
| `Ctrl-W` `h` `j` `k` `l` / `w` `W` / `s` `v` / `q` `o` | Move between panes, split, close, instead of closing the notebook |
| Your VSCodeVim mappings | `,` `;` `<leader>…` mappings that run commands |

A lone `/` outside a cell is held back (Jupyter's `a` would insert a cell);
inside a cell `/` stays Vim's own search of that cell.

**Notebook search with `§`**, from a cell or not: matches highlighted live as
you type (code and rendered markdown), Vim's `match 2 of 7` after Enter,
`n` / `N` across cells (a code cell is entered with the cursor on the word),
Enter or `:noh` to end (Escape too, outside a cell).

**Fast start.** It activates first and wakes VSCodeVim, so Vim keys work as
soon as the window is up, and `Ctrl-W` never closes the notebook before Vim
runs.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `vimNotebook.searchSymbol` | `§` | Symbol shown on the search line |
| `vimNotebook.doubleSlashSearch` | `false` | Also search the notebook with `//` |
| `vimNotebook.commandLine` | `statusBar` | `visibleCell`: run `:` in a code cell already on screen, with Vim's real command line |
| `vimNotebook.keyboardLayout` | `qwerty` | `azerty` translates the digit row and punctuation on the `:` / `§` lines |

To use another key than `§`: *Keyboard Shortcuts* → "Vim Jupyter: Search the
Notebook". With `"keyboard.dispatch": "keyCode"`, `§` on AZERTY is read as
`shift+oem_8`.

## Wiring the jumps

`settings.json`:

```json
"vim.normalModeKeyBindingsNonRecursive": [
    { "before": ["g", "d"], "commands": ["vimNotebook.goToDefinition"] }
]
```

`keybindings.json`:

```json
{ "key": "ctrl+o", "command": "vimNotebook.back", "when": "editorTextFocus && vim.active && vim.mode == 'Normal' && vimNotebook.canGoBack" },
{ "key": "ctrl+i", "command": "vimNotebook.forward", "when": "editorTextFocus && vim.active && vim.mode == 'Normal' && vimNotebook.canGoForward" }
```

## Known limits

- VSCodeVim only redraws its status bar on a key: the `:` / `§` line sits next
  to `-- NORMAL --` instead of replacing it.
- VSCodeVim binds `g h j k l o G` on lists; to type them on the `:` / `§` line,
  bind them to `vimNotebook.exKey` in `keybindings.json` (user bindings win),
  e.g. `{ "key": "j", "command": "vimNotebook.exKey", "args": "j", "when": "notebookEditorFocused && !inputFocus && vimNotebook.cmdline" }`.
- On other layouts with `keyCode` dispatch, find how a key is read with
  *Developer: Toggle Keyboard Shortcuts Troubleshooting*.

## Build and test

```sh
npm install
npm run package                     # vim-jupyter-<version>.vsix
code --install-extension vim-jupyter-*.vsix
npm test                            # real VS Code + your VSCodeVim (VSCODE_VERSION to pick one)
```

MIT licence.
