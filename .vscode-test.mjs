import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// A throwaway profile ships the VSCodeVim settings the tests rely on (they
// read fine even before VSCodeVim registers them).
const userData = mkdtempSync(join(tmpdir(), 'vim-notebook-test-'));
mkdirSync(join(userData, 'User'));
writeFileSync(
  join(userData, 'User', 'settings.json'),
  JSON.stringify({
    'vim.leader': '<space>',
    // The '//' tests; the default (off) is tested by switching it in the test.
    'vimNotebook.doubleSlashSearch': true,
    'vim.normalModeKeyBindingsNonRecursive': [
      { before: [','], commands: ['test.probe'] },
      { before: [';'], commands: [{ command: 'test.probe', args: 'semicolon' }] },
      { before: ['<leader>', 'c'], commands: [{ command: 'test.probe', args: 'leader-c' }] },
    ],
  }),
);

// The real VSCodeVim, copied from the local VS Code install (no download):
// the native path — keys handed to Vim itself — is what needs testing.
const extensions = mkdtempSync(join(tmpdir(), 'vim-notebook-ext-'));
const installed = join(homedir(), '.vscode', 'extensions');
const vim = existsSync(installed)
  ? readdirSync(installed).find((name) => name.startsWith('vscodevim.vim-'))
  : undefined;
if (vim !== undefined) {
  cpSync(join(installed, vim), join(extensions, vim), { recursive: true });
}

export default defineConfig({
  files: 'test/**/*.test.js',
  version: process.env.VSCODE_VERSION ?? '1.139.1',
  launchArgs: ['--disable-gpu', `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`],
  mocha: { ui: 'tdd', timeout: 30000 },
});
