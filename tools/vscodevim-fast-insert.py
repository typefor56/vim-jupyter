#!/usr/bin/env python3
"""Fast Insert-mode typing for VSCodeVim 1.32.4.

    vscodevim-fast-insert.py <vscodevim dir>                patch it in place
    vscodevim-fast-insert.py <vscodevim dir> --vsix <file>  leave it alone, write a patched .vsix instead

<vscodevim dir> is the installed extension, e.g. ~/.vscode/extensions/vscodevim.vim-1.32.4.
An extension installed from a .vsix is not auto-updated, so the patch stays.

VSCodeVim sends every typed character through its whole action pipeline: several round trips
between the window and the extension host per key. A key held down at 50 repeats a second then
keeps writing for one or two seconds after it is released. The patch:


1. `type` in Insert mode: once VSCodeVim has opened the record of the insertion (its own first
   typed character), a single character goes straight to `default:type` from VSCodeVim's own task
   queue, without the per-key action pipeline. Order is kept (same queue), and the text is still
   recorded from the document changes, so `u` and `.` work.
2. Backspace in Insert mode takes the same shortcut, as the editor's own `deleteLeft`.
3. The selection change each such character causes still updates VSCodeVim's cursor, but skips
   the full view update (cursor style, decorations, status bar: nothing of that changes while
   typing); one is done 300 ms after the last character.
4. Before any key VSCodeVim handles itself (Escape, arrows, a pending command…), it waits for
   the characters sent ahead and takes the cursor from the editor; selection events that arrive
   late are dropped. Without this, Escape right after typing left the cursor a few characters
   back.
Running it on a copy that already has an older version of the patch replaces it.
Not taken (normal path): multi-character text, a pending key (Ctrl-V, Ctrl-K, Ctrl-R), macro
recording, several cursors, and any insert-mode mapping configured.
"""
import mimetypes, os, shutil, sys, tempfile, zipfile

A = 'a.commands.executeCommand("default:type",{text:e.text}))):await t.handleKeyEvent(e.text))}))}))'
B = 'this.vimState.desiredColumn=t.active.character,this.updateView({drawSelection:!1,revealRange:!1})}return}'
C = ':async()=>{const e=await k();e&&await e.handleKeyEvent(`${t.key}`)};O(e,t.command'
D = 'async handleSelectionChange(e){if(void 0===u.window.activeTextEditor||e.textEditor.document!==u.window.activeTextEditor.document)return;'
E = '["<Esc>","<C-c>"].includes(t.key)?async()=>{const e=await k();e&&!await L(e)&&await e.handleKeyEvent(`${t.key}`)}:'
# `m` is the mode handler in each place.
FAST = ('{const r=m.vimState.recordedState,i=r.actionsRun.at(-1),c=a.workspace.getConfiguration("vim");'
        'if(m.vimState.currentMode===f.Mode.Insert&&COND&&i&&i.addChanges&&i.keysPressed&&!r.waitingForAnotherActionKey&&!m.vimState.macro&&1===m.vimState.cursors.length'
        '&&!(c.get("insertModeKeyBindings")||[]).length&&!(c.get("insertModeKeyBindingsNonRecursive")||[]).length){'
        'KEYS;m.__fastAt=Date.now();clearTimeout(m.__fastTimer);m.__fastTimer=setTimeout((()=>m.updateView({drawSelection:!1,revealRange:!1})),300);'
        'm.__fastPending=a.commands.executeCommand(RUN);return}}')
# Before any key VSCodeVim handles itself: wait for the characters sent ahead to be in the
# document, then take the cursor from the editor. Their selection events are still queued
# behind this key, so without this VSCodeVim acts from where the cursor was a few keys ago.
SYNC = 'if(m.__fastPending){const p=m.__fastPending;m.__fastPending=void 0;try{await p}catch(e){}clearTimeout(m.__fastTimer);m.syncCursors()}'
A2 = ('a.commands.executeCommand("default:type",{text:e.text}))):await(async()=>{const m=t;'
      + FAST.replace('COND', '1===e.text.length').replace('KEYS', 'i.keysPressed.push(e.text)').replace('RUN', '"default:type",{text:e.text}')
      + SYNC + 'await t.handleKeyEvent(e.text)})())}))}))')
B2 = ('this.vimState.desiredColumn=t.active.character,this.vimState.currentMode===z.Mode.Insert&&Date.now()-(this.__fastAt||0)<250'
      '||this.updateView({drawSelection:!1,revealRange:!1})}return}')
C2 = (':async()=>{const e=await k();if(!e)return;const m=e;if("<BS>"===t.key)'
      + FAST.replace('COND', '!0').replace('KEYS', '0').replace('RUN', '"deleteLeft"')
      + SYNC + 'await e.handleKeyEvent(`${t.key}`)};O(e,t.command')
# A selection event that no longer matches the editor is one of those late ones: applying it
# would put VSCodeVim's cursor back where it was while typing.
D2 = D + 'if(this.__fastAt&&Date.now()-this.__fastAt<5e3&&e.selections[0]&&!e.selections[0].isEqual(this.vimState.editor.selection))return;'
E2 = ('["<Esc>","<C-c>"].includes(t.key)?async()=>{const e=await k();if(!e)return;const m=e;' + SYNC
      + '!await L(e)&&await e.handleKeyEvent(`${t.key}`)}:')
PARTS = ((A, A2), (B, B2), (C, C2), (D, D2), (E, E2))
# The first version of this patch (Vim Jupyter 0.15.3), to be able to take it out again.
V1 = [('a.commands.executeCommand("default:type",{text:e.text}))):await(async()=>{const m=t;{const r=m.vimState.recordedState,i=r.actionsRun.at(-1),c=a.workspace.getConfiguration("vim");if(m.vimState.currentMode===f.Mode.Insert&&1===e.text.length&&i&&i.addChanges&&i.keysPressed&&!r.waitingForAnotherActionKey&&!m.vimState.macro&&1===m.vimState.cursors.length&&!(c.get("insertModeKeyBindings")||[]).length&&!(c.get("insertModeKeyBindingsNonRecursive")||[]).length){i.keysPressed.push(e.text);m.__fastAt=Date.now();clearTimeout(m.__fastTimer);m.__fastTimer=setTimeout((()=>m.updateView({drawSelection:!1,revealRange:!1})),300);a.commands.executeCommand("default:type",{text:e.text});return}}await t.handleKeyEvent(e.text)})())}))}))', 'a.commands.executeCommand("default:type",{text:e.text}))):await t.handleKeyEvent(e.text))}))}))'), ('this.vimState.desiredColumn=t.active.character,this.vimState.currentMode===z.Mode.Insert&&Date.now()-(this.__fastAt||0)<250||this.updateView({drawSelection:!1,revealRange:!1})}return}', 'this.vimState.desiredColumn=t.active.character,this.updateView({drawSelection:!1,revealRange:!1})}return}'), (':async()=>{const e=await k();if(!e)return;if("<BS>"===t.key){const m=e;{const r=m.vimState.recordedState,i=r.actionsRun.at(-1),c=a.workspace.getConfiguration("vim");if(m.vimState.currentMode===f.Mode.Insert&&!0&&i&&i.addChanges&&i.keysPressed&&!r.waitingForAnotherActionKey&&!m.vimState.macro&&1===m.vimState.cursors.length&&!(c.get("insertModeKeyBindings")||[]).length&&!(c.get("insertModeKeyBindingsNonRecursive")||[]).length){0;m.__fastAt=Date.now();clearTimeout(m.__fastTimer);m.__fastTimer=setTimeout((()=>m.updateView({drawSelection:!1,revealRange:!1})),300);a.commands.executeCommand("deleteLeft");return}}}await e.handleKeyEvent(`${t.key}`)};O(e,t.command', ':async()=>{const e=await k();e&&await e.handleKeyEvent(`${t.key}`)};O(e,t.command')]

def original(source):
    """The unpatched bundle, from a bundle patched by this version or by the first one."""
    for pairs in ([(new, old) for old, new in PARTS], V1):
        if all(source.count(new) == 1 for new, _ in pairs):
            for new, old in pairs:
                source = source.replace(new, old)
    return source


def patch(directory):
    path = os.path.join(directory, 'out', 'extension.js')
    source = original(open(path, encoding='utf-8').read())
    if '__fast' in source or not all(source.count(old) == 1 for old, _ in PARTS):
        sys.exit('this is not the VSCodeVim build the patch was written for (1.32.4)')
    for old, new in PARTS:
        source = source.replace(old, new)
    open(path, 'w', encoding='utf-8').write(source)
    print('patched', path)


def vsix(directory, output):
    with tempfile.TemporaryDirectory() as temp:
        copy = os.path.join(temp, 'extension')
        shutil.copytree(directory, copy)
        patch(copy)
        manifest = os.path.join(copy, '.vsixmanifest')
        extensions = {'.vsixmanifest': 'text/xml'}
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.write(manifest, 'extension.vsixmanifest')
            for root, _, files in os.walk(copy):
                for name in files:
                    full = os.path.join(root, name)
                    if full == manifest:
                        continue
                    archive.write(full, os.path.join('extension', os.path.relpath(full, copy)))
                    suffix = os.path.splitext(name)[1].lower()
                    if suffix:
                        extensions[suffix] = mimetypes.guess_type(name)[0] or 'application/octet-stream'
            types = ''.join(f'<Default Extension="{suffix}" ContentType="{kind}"/>' for suffix, kind in sorted(extensions.items()))
            archive.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="utf-8"?>\n'
                             f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">{types}</Types>\n')
    print('wrote', output)


if __name__ == '__main__':
    arguments = sys.argv[1:]
    if len(arguments) == 3 and arguments[1] == '--vsix':
        vsix(arguments[0].rstrip('/'), arguments[2])
    elif len(arguments) == 1:
        patch(arguments[0].rstrip('/'))
    else:
        sys.exit(__doc__)
