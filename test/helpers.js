'use strict';
const assert = require('assert');
const vscode = require('vscode');

/** Arguments test.probe was called with; the command is registered once. */
const calls = [];
let registered = false;
function probeCalls() {
  if (!registered) {
    registered = true;
    vscode.commands.registerCommand('test.probe', (arg) => calls.push(arg ?? 'called'));
  }
  return calls;
}

async function until(condition, what) {
  const deadline = Date.now() + 8000;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Every suite starts with no editor open, so none inherits another's state. */
async function closeEverything() {
  for (let i = 0; i < 50 && vscode.window.tabGroups.all.some((group) => group.tabs.length > 0); i++) {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
}

module.exports = { probeCalls, until, closeEverything };
