'use strict';
const assert = require('assert');
const { commandMappings, compileSearch, findMatch, hostCell, matchRanges, parseEx, resolve } = require('../vim');

suite('Ex commands and mappings', () => {
  test('Ex commands map to save/close, with or without the colon', () => {
    assert.deepStrictEqual(parseEx(':w'), ['workbench.action.files.save']);
    assert.deepStrictEqual(parseEx('q'), ['workbench.action.closeActiveEditor']);
    assert.deepStrictEqual(parseEx(' :wq '), [
      'workbench.action.files.save',
      'workbench.action.closeActiveEditor',
    ]);
    assert.deepStrictEqual(parseEx('x'), parseEx('wq'));
    assert.strictEqual(parseEx('nonsense'), undefined);
  });

  test('command mappings resolve by prefix, leader expanded', () => {
    const mappings = commandMappings(
      [
        { before: [','], commands: ['workbench.action.previousEditor'] },
        { before: ['<leader>', 'g', 'd'], commands: ['vimNotebook.goToDefinition'] },
        { before: ['<leader>', 'c'], commands: [{ command: 'x', args: 1 }] },
        { before: ['g', 'd'], after: [] }, // Vim keys only: needs Vim itself
        'garbage',
      ],
      '<space>',
    );
    assert.deepStrictEqual(resolve([','], mappings), ['workbench.action.previousEditor']);
    assert.strictEqual(resolve([' '], mappings), 'prefix');
    assert.strictEqual(resolve([' ', 'g'], mappings), 'prefix');
    assert.deepStrictEqual(resolve([' ', 'g', 'd'], mappings), ['vimNotebook.goToDefinition']);
    assert.deepStrictEqual(resolve([' ', 'c'], mappings), [{ command: 'x', args: 1 }]);
    assert.strictEqual(resolve(['g'], mappings), undefined);
    assert.strictEqual(resolve([' ', 'z'], mappings), undefined);
  });

  test('the command line goes to a visible code cell: below first, never the topmost', () => {
    // Capture 6: cells 19..23 visible, 19 (code) cut at the top, 21 selected.
    const isCode = (cell) => [19, 23].includes(cell);
    assert.strictEqual(hostCell([{ start: 19, end: 24 }], isCode, 21), 23);
    // Capture 7: only 19 (cut at the top) is code on screen: no host.
    assert.strictEqual(hostCell([{ start: 19, end: 22 }], isCode, 21), undefined);
    // Nothing below: the nearest above (not the topmost).
    assert.strictEqual(hostCell([{ start: 10, end: 16 }], (c) => c === 12, 15), 12);
    // A selected code cell hosts it itself.
    assert.strictEqual(hostCell([{ start: 10, end: 16 }], (c) => c === 13 || c === 15, 13), 13);
    assert.strictEqual(hostCell([], isCode, 21), undefined);
  });

  test('search walks the cells like Vim: forward, wrapping, backward, smartcase', () => {
    const texts = ['# Title\nfoo', 'x = foo()\nFoo', 'nothing', 'foo bar'];
    const foo = compileSearch('foo', true, true);
    let match = findMatch(texts, foo, { cell: 1, offset: -1 }, false);
    assert.deepStrictEqual(match, { cell: 1, start: 4, end: 7, wrapped: false, index: 2, total: 4 });
    match = findMatch(texts, foo, { cell: 1, offset: 4 }, false);
    assert.deepStrictEqual(match, { cell: 1, start: 10, end: 13, wrapped: false, index: 3, total: 4 }, 'ignorecase: Foo');
    assert.strictEqual(findMatch(texts, foo, { cell: 3, offset: 0 }, false).wrapped, true);
    assert.deepStrictEqual(findMatch(texts, foo, { cell: 0, offset: 8 }, true), {
      cell: 3,
      start: 0,
      end: 3,
      wrapped: true,
      index: 4,
      total: 4,
    });
    const capital = compileSearch('Foo', true, true);
    assert.strictEqual(findMatch(texts, capital, { cell: 0, offset: -1 }, false).cell, 1, 'smartcase');
    assert.strictEqual(findMatch(['a(b'], compileSearch('(b', true, true), { cell: 0, offset: -1 }, false).start, 1);
    assert.strictEqual(findMatch(texts, compileSearch('zzz', true, true), { cell: 0, offset: -1 }, false), undefined);
  });

  test(':noh clears the search highlight; every match is found for highlighting', () => {
    assert.deepStrictEqual(parseEx(':noh'), ['vimNotebook.noHighlight']);
    assert.deepStrictEqual(parseEx('nohlsearch'), ['vimNotebook.noHighlight']);
    assert.deepStrictEqual(matchRanges('foo Foo xfoo', /foo/gi), [
      [0, 3],
      [4, 7],
      [9, 12],
    ]);
    assert.deepStrictEqual(matchRanges('aaa', /a*/g), [[0, 3]], 'no empty matches, no endless loop');
  });
});
