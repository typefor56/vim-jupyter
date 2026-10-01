# Changelog

## 0.14.1

- Ready for the Marketplace: repository links, VSCodeVim declared as a
  dependency, categories and keywords.

## 0.14.0

- `§` searches the whole notebook, from a cell or not, with no flicker: the
  key is a keyboard shortcut ("Vim Notebook: Search the Notebook"),
  `vimNotebook.searchSymbol` sets the symbol shown, `vimNotebook.doubleSlashSearch`
  brings `//` back as an option. Inside a cell `/` is Vim's own search again.

## 0.13.2

- A dedicated key can open the notebook search directly.

## 0.13.1

- The second `/` of `//` may come any time inside a cell; a slow one no longer
  turns into an empty Vim search that highlights the whole cell.

## 0.13.0

- VSCodeVim's `-- NORMAL --` is no longer hidden around the search (it could
  not be brought back reliably); the search line sits next to it.

## 0.12.2

First release.

- `gd` / `Ctrl-O` / `Ctrl-I` across cells, back to the exact word.
- On a selected cell: your VSCodeVim command mappings, a `:` command line in
  the status bar, `Ctrl-W` pane moves, `u` / `Ctrl-R`.
- Whole-notebook search with live highlight (code and rendered markdown),
  `match x of y`, `n` / `N` across cells.
- Activates first and wakes VSCodeVim.
