'use strict';

// Pure helpers, no vscode import: Ex commands and VSCodeVim mapping lookup.

/** What each Ex command runs, in order. */
const SAVE = 'workbench.action.files.save';
const SAVE_ALL = 'workbench.action.files.saveAll';
const CLOSE = 'workbench.action.closeActiveEditor';
const CLOSE_ALL = 'workbench.action.closeAllEditors';

const EX = {
  w: [SAVE],
  write: [SAVE],
  wa: [SAVE_ALL],
  wall: [SAVE_ALL],
  q: [CLOSE],
  quit: [CLOSE],
  'q!': ['workbench.action.revertAndCloseActiveEditor'],
  wq: [SAVE, CLOSE],
  x: [SAVE, CLOSE],
  xit: [SAVE, CLOSE],
  qa: [CLOSE_ALL],
  qall: [CLOSE_ALL],
  'qa!': [CLOSE_ALL],
  wqa: [SAVE_ALL, CLOSE_ALL],
  xa: [SAVE_ALL, CLOSE_ALL],
  noh: ['vimNotebook.noHighlight'],
  nohl: ['vimNotebook.noHighlight'],
  nohlsearch: ['vimNotebook.noHighlight'],
};

/** Commands for an Ex line (":wq", "x"…), or undefined when unknown. */
function parseEx(line) {
  return EX[line.trim().replace(/^:/, '').trim()];
}

/** VSCodeVim spells the space key "<space>" and accepts " " as a leader. */
function normalizeKey(key, leader) {
  if (key === '<leader>') {
    return leader;
  }
  return key.toLowerCase() === '<space>' ? ' ' : key;
}

/**
 * Key sequences of the user's VSCodeVim normal-mode mappings that run VS Code
 * commands. Mappings to other Vim keys ("after") need Vim itself, which only
 * runs inside a cell editor, so they are left out.
 */
function commandMappings(bindings, leader) {
  const normalizedLeader = normalizeKey(leader, ' ');
  const mappings = [];
  for (const binding of bindings) {
    if (
      binding === null ||
      typeof binding !== 'object' ||
      !Array.isArray(binding.before) ||
      !Array.isArray(binding.commands) ||
      binding.commands.length === 0
    ) {
      continue;
    }
    mappings.push({
      keys: binding.before.map((key) => normalizeKey(String(key), normalizedLeader)),
      commands: binding.commands,
    });
  }
  return mappings;
}

/**
 * What the keys typed so far mean: the commands of an exact match, 'prefix'
 * while a longer mapping may still match, undefined otherwise.
 */
function resolve(typed, mappings) {
  let prefix = false;
  for (const mapping of mappings) {
    if (mapping.keys.length < typed.length) {
      continue;
    }
    if (!typed.every((key, index) => mapping.keys[index] === key)) {
      continue;
    }
    if (mapping.keys.length === typed.length) {
      return mapping.commands;
    }
    prefix = true;
  }
  return prefix ? 'prefix' : undefined;
}

/**
 * The code cell to host Vim's command line without moving the screen: one
 * already visible — the selected cell, else the nearest below, else the
 * nearest above. The topmost visible cell is left out: when it is cut by the
 * top edge, its code (at its top) is off screen and entering it scrolls.
 * `visibleRanges` are notebook ranges ({start, end}, end exclusive).
 * undefined when there is none.
 */
function hostCell(visibleRanges, isCode, index) {
  const visible = [];
  for (const range of visibleRanges) {
    for (let cell = range.start; cell < range.end; cell++) {
      visible.push(cell);
    }
  }
  if (visible.length === 0) {
    return undefined;
  }
  const top = Math.min(...visible);
  const code = visible.filter((cell) => cell !== top && isCode(cell));
  if (code.includes(index)) {
    return index;
  }
  const below = code.filter((cell) => cell > index).sort((a, b) => a - b)[0];
  return below ?? code.filter((cell) => cell < index).sort((a, b) => b - a)[0];
}

/**
 * A Vim search pattern as a JavaScript regex: case-insensitive with
 * ignorecase, unless smartcase and the pattern has a capital. A pattern that
 * is not a valid JavaScript regex is searched literally.
 */
function compileSearch(pattern, ignoreCase, smartCase) {
  const insensitive = ignoreCase && !(smartCase && /[A-Z]/.test(pattern));
  const flags = insensitive ? 'gi' : 'g';
  try {
    return new RegExp(pattern, flags);
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }
}

/** Every non-empty match of `regex` (global) in `text`, as [start, end] offsets. */
function matchRanges(text, regex) {
  const ranges = [];
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/**
 * The next match of `regex` across the cells' texts after `from` ({cell,
 * offset}; offset -1 = from the start of that cell), or the previous one
 * with `backward`, wrapping around like Vim. {cell, start, end, wrapped,
 * index, total}, or undefined when nothing matches anywhere.
 */
function findMatch(texts, regex, from, backward) {
  const all = [];
  texts.forEach((text, cell) => {
    for (const [start, end] of matchRanges(text, regex)) {
      all.push({ cell, start, end });
    }
  });
  if (all.length === 0) {
    return undefined;
  }
  // `index` (1-based) and `total` are Vim's "[index/total]".
  const at = (position, wrapped) => ({ ...all[position], wrapped, index: position + 1, total: all.length });
  if (!backward) {
    const next = all.findIndex(
      (m) => m.cell > from.cell || (m.cell === from.cell && m.start > from.offset),
    );
    return next !== -1 ? at(next, false) : at(0, true);
  }
  let previous = -1;
  all.forEach((m, position) => {
    if (m.cell < from.cell || (m.cell === from.cell && m.start < from.offset)) {
      previous = position;
    }
  });
  return previous !== -1 ? at(previous, false) : at(all.length - 1, true);
}

module.exports = {
  parseEx,
  commandMappings,
  resolve,
  normalizeKey,
  hostCell,
  compileSearch,
  findMatch,
  matchRanges,
};
