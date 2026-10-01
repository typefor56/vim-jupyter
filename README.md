# Vim Notebook

Vim in Jupyter notebooks, where [VSCodeVim](https://github.com/VSCodeVim/Vim)
stops short.

## 1. `gd` then `Ctrl-O`, across cells

Go to definition, then `Ctrl-O` back to the exact word you left — even when
the definition lives in another cell. VS Code's navigation history only
brings you back to the cell, and VSCodeVim's jumplist treats each cell as a
separate file and loses track. This extension records the cursor (cell +
line + column) before jumping and restores it inside the notebook. It works
in plain files too.

## 2. Vim keys on a selected cell

With a cell selected but not being edited (a rendered markdown cell, after
`Shift+Esc`…), no text editor has focus, so VSCodeVim never sees a key. This
extension hands them back to Vim itself — you still choose when to enter a
cell (Enter):

- **Your mappings** (`,` `;` `<leader>…`) run as in Vim, without entering a
  cell: the leader waits for the next key (`vim.timeout`), `Escape` cancels.
- **`:`** — in command mode VS Code has no active text editor at all, and
  VSCodeVim only works in one, so Vim's real command line needs a cell with
  focus. Setting `vimNotebook.commandLine`:

  | Value | `:` does |
  | --- | --- |
  | `visibleCell` (default in 0.2.0) | Enters a code cell **already on screen** — the selected one, else the nearest below, else above; never the topmost visible cell, whose code is likely scrolled off — and types `:` into the real Vim. Enter / Escape leave it and select your cell again. With no such cell on screen, the status-bar line below. |
  | `statusBar` (default in 0.3.0) | Always a command line imitated in the status bar, next to Vim's `-- NORMAL --`. Nothing on screen moves, no cell is entered. It understands `w` `q` `wq` `x` `q!` `wa` `qa` `wqa` `noh`; Backspace, Escape and Enter work as in Vim. |

  VSCodeVim binds `g` `h` `j` `k` `l` `o` `G` for list navigation in command
  mode. To type them on the status-bar line, add to `keybindings.json`
  (user keybindings win over extensions):

  ```json
  { "key": "g", "command": "vimNotebook.exKey", "args": "g", "when": "notebookEditorFocused && !inputFocus && vimNotebook.cmdline" }
  ```

  and the same for `h` `j` `k` `l` `o`, and `shift+g` with `"args": "G"`.

- **`//`** searches the **whole notebook** from the same status-bar line
  (`//pattern`, Enter), then `n` / `N` for the next / previous match; the
  line then gives way to the count alone, `match 2 of 7`. Outside a cell a
  single `/` opens a `/` line that holds every key back from the notebook
  (Jupyter's `a` would insert a cell): a second `/` makes it `//`, anything
  else ends with "'/' searches inside a cell only, type // to search the
  whole notebook". Inside a code cell `/` stays Vim's own search of that
  cell, opened at once; a second `/` right after turns it into `//`, the cell
  keeping the focus. The line and its count sit next to VSCodeVim's
  `-- NORMAL --`: VSCodeVim only redraws its status bar on a key, so it
  cannot be made to give way to them and come back reliably. In a cell, Enter in Vim NORMAL clears the
  highlight and leaves the cursor where it is. It
  honours `vim.ignorecase` and `vim.smartcase`, wraps around like Vim ("search
  hit BOTTOM, continuing at TOP"), and an empty `/` repeats the last search.
  The matching cell is selected and revealed, without entering it. In code
  cells the current match is highlighted in your theme's find colour and the
  cursor is put on it (Enter then lands on the word); with `vim.hlsearch` the
  other matches are highlighted too. While you type the pattern, every match
  is highlighted live (`vim.incsearch`). Rendered markdown cells are
  highlighted as well: the extension extends VS Code's markdown renderer and
  marks the matches in the rendered text. `:noh` (`:nohl`, `:nohlsearch`), Escape
  or Enter clears the highlight (with a highlight on, the first Enter clears
  it and the next enters the cell), and `n` / `N` bring it back, as in Vim. Patterns are JavaScript regexes (an invalid one is
  searched literally).
- After `//pattern` + Enter (from a cell or not), a match in a **code cell**
  is entered with the cursor on the word; `n` / `N` (also inside cells while
  the search is on) go to the next / previous match, cell after cell; Enter
  ends the search and leaves you in the cell, on the word. A match in a
  markdown cell is selected and shown rendered, highlighted.
- A **dedicated key** can open the notebook search directly, without the
  first `/` going through Vim's own search (which makes the status bar
  flicker in a cell): bind it to `vimNotebook.search`. On AZERTY with
  `keyboard.dispatch: keyCode`, `§` (Shift+!) is read as `shift+oem_8`:

  ```json
  { "key": "shift+oem_8", "command": "vimNotebook.search", "when": "notebookEditorFocused && !inputFocus && !vimNotebook.pending && !vimNotebook.cmdline" },
  { "key": "shift+oem_8", "command": "vimNotebook.search", "when": "editorTextFocus && notebookEditorFocused && vim.active && vim.mode == 'Normal' && !vimNotebook.cmdline" }
  ```

- **`u`** / **`Ctrl-R`** undo / redo the notebook's edits (cells added,
  deleted, moved…), like `Ctrl+Z` outside a cell.

On QWERTY, VSCodeVim also binds `/` on lists; if `/` toggles list filtering
instead of searching, add to `keybindings.json`:
`{ "key": "/", "command": "vimNotebook.slash", "when": "notebookEditorFocused && !inputFocus && !vimNotebook.pending && !vimNotebook.cmdline" }`.
On AZERTY with `keyboard.dispatch: keyCode`, `/` is read as `shift+/`: bind
that instead.

Mapping keys run your VSCodeVim mappings from the extension (there is no
editor for Vim to act on in command mode).

### Other keyboard layouts

The bundled keys (`,` `;` `space` `\` and `shift+;` for `:`) are what VS
Code reads on a QWERTY keyboard. With another layout and
`"keyboard.dispatch": "keyCode"`, VS Code may read a key as something else.
On a French AZERTY keyboard, for instance, it reads the `;` key as `.` and
the `:` key as `/`. Run *Developer: Toggle Keyboard Shortcuts
Troubleshooting*, press the key on a selected cell, and look at the
`Resolving …` line in the output. Then bind what it shows in
`keybindings.json`. For AZERTY (the `escape` entry makes sure Escape on the
`:` command line wins over VSCodeVim's own):

```json
{
  "key": ".",
  "command": "vimNotebook.key",
  "args": ";",
  "when": "notebookEditorFocused && !inputFocus && !vimNotebook.cmdline"
},
{
  "key": "/",
  "command": "vimNotebook.ex",
  "when": "notebookEditorFocused && !inputFocus && !vimNotebook.pending && !vimNotebook.cmdline"
},
{
  "key": "escape",
  "command": "vimNotebook.exCancel",
  "when": "editorTextFocus && vimNotebook.exFromCommandMode && vim.mode == 'CommandlineInProgress'"
}
```

### Typing on the `:` and `//` lines with an AZERTY keyboard

With `"keyboard.dispatch": "keyCode"`, VS Code reads an AZERTY key as its
shifted character: `_` arrives as `8`, `(` as `5`, `;` as `.`. Set
`"vimNotebook.keyboardLayout": "azerty"` and the status-bar lines translate
the digit row (`& é " ' ( - è _ ç à`, Shift for the digits) and `, ? ; . : /`.

## Wiring the jumps to Vim keys

In `settings.json`:

```json
"vim.normalModeKeyBindingsNonRecursive": [
    { "before": ["g", "d"], "commands": ["vimNotebook.goToDefinition"] },
    { "before": ["<leader>", "g", "d"], "commands": ["vimNotebook.goToDefinition"] }
]
```

In `keybindings.json` (user keybindings win over VSCodeVim's own `Ctrl-O`;
when nothing is recorded, the key falls through to Vim's jumplist):

```json
{
  "key": "ctrl+o",
  "command": "vimNotebook.back",
  "when": "editorTextFocus && vim.active && vim.mode == 'Normal' && vimNotebook.canGoBack"
},
{
  "key": "ctrl+i",
  "command": "vimNotebook.forward",
  "when": "editorTextFocus && vim.active && vim.mode == 'Normal' && vimNotebook.canGoForward"
}
```

## Install

No runtime dependencies, no build step:

```sh
npm install        # dev tools only: vsce and the test runner
npm run package
code --install-extension vim-notebook-0.1.0.vsix
```

## Test

`npm test` runs in a real VS Code extension host (1.139.1 by default,
`VSCODE_VERSION` to change it) with your local VSCodeVim copied in: mapping
lookup, a `gd`/back/forward round trip across cells (same line and column,
inside the notebook, no extra tab), a mapping resolved by Vim from a selected
cell, `:` in both modes (a visible code cell, or the status bar with
nothing moving), `//` search with `n` / `N` and its `[x/y]` count (and its live highlight in rendered markdown), and
`u` / `Ctrl-R` (run only
when the test window has the keyboard focus, which `undo` follows).
