#!/usr/bin/env python3
"""Fast Insert-mode typing for VSCodeVim 1.32.4.

    vscodevim-fast-insert.py <vscodevim dir>                patch it in place (keeps out/extension.js.orig)
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
Not taken (normal path): multi-character text, a pending key (Ctrl-V, Ctrl-K, Ctrl-R), macro
recording, several cursors, and any insert-mode mapping configured.
"""
import mimetypes, os, shutil, sys, tempfile, zipfile

A = 'a.commands.executeCommand("default:type",{text:e.text}))):await t.handleKeyEvent(e.text))}))}))'
B = 'this.vimState.desiredColumn=t.active.character,this.updateView({drawSelection:!1,revealRange:!1})}return}'
C = ':async()=>{const e=await k();e&&await e.handleKeyEvent(`${t.key}`)};O(e,t.command'
# `m` is the mode handler in each place.
FAST = ('{const r=m.vimState.recordedState,i=r.actionsRun.at(-1),c=a.workspace.getConfiguration("vim");'
        'if(m.vimState.currentMode===f.Mode.Insert&&COND&&i&&i.addChanges&&i.keysPressed&&!r.waitingForAnotherActionKey&&!m.vimState.macro&&1===m.vimState.cursors.length'
        '&&!(c.get("insertModeKeyBindings")||[]).length&&!(c.get("insertModeKeyBindingsNonRecursive")||[]).length){'
        'KEYS;m.__fastAt=Date.now();clearTimeout(m.__fastTimer);m.__fastTimer=setTimeout((()=>m.updateView({drawSelection:!1,revealRange:!1})),300);'
        'a.commands.executeCommand(RUN);return}}')
A2 = ('a.commands.executeCommand("default:type",{text:e.text}))):await(async()=>{const m=t;'
      + FAST.replace('COND', '1===e.text.length').replace('KEYS', 'i.keysPressed.push(e.text)').replace('RUN', '"default:type",{text:e.text}')
      + 'await t.handleKeyEvent(e.text)})())}))}))')
B2 = ('this.vimState.desiredColumn=t.active.character,this.vimState.currentMode===z.Mode.Insert&&Date.now()-(this.__fastAt||0)<250'
      '||this.updateView({drawSelection:!1,revealRange:!1})}return}')
C2 = (':async()=>{const e=await k();if(!e)return;if("<BS>"===t.key){const m=e;'
      + FAST.replace('COND', '!0').replace('KEYS', '0').replace('RUN', '"deleteLeft"')
      + '}await e.handleKeyEvent(`${t.key}`)};O(e,t.command')


def patch(directory):
    path = os.path.join(directory, 'out', 'extension.js')
    source = open(path, encoding='utf-8').read()
    if '__fastAt' in source:
        print('already patched:', path)
        return
    if not all(source.count(part) == 1 for part in (A, B, C)):
        sys.exit('this is not the VSCodeVim build the patch was written for (1.32.4)')
    if not os.path.exists(path + '.orig'):
        shutil.copy(path, path + '.orig')
    open(path, 'w', encoding='utf-8').write(source.replace(A, A2).replace(B, B2).replace(C, C2))
    print('patched', path)


def vsix(directory, output):
    with tempfile.TemporaryDirectory() as temp:
        copy = os.path.join(temp, 'extension')
        shutil.copytree(directory, copy)
        original = os.path.join(copy, 'out', 'extension.js.orig')
        if os.path.exists(original):  # the installed copy was patched in place: start from its original
            os.replace(original, os.path.join(copy, 'out', 'extension.js'))
        patch(copy)
        os.remove(os.path.join(copy, 'out', 'extension.js.orig'))
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
