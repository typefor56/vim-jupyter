// Search highlights in rendered markdown cells.
//
// A rendered markdown cell has no text editor, so the extension cannot
// decorate it. This module runs inside the notebook's webview instead: it
// extends VS Code's built-in markdown renderer (which renders each cell in an
// open shadow root) and highlights matches with the CSS Custom Highlight API,
// leaving the rendered DOM untouched. The extension sends the pattern through
// renderer messaging; each new render (a cell scrolled into view, an edit)
// re-applies it.

const NAME = 'vim-notebook-search';
const STYLE = `::highlight(${NAME}) { background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33)); }`;

/** The pattern to highlight ({ source, flags }), or undefined for none. */
let pattern;
let postCount = () => {};

function shadowRoots(root, found) {
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) {
      found.push(element.shadowRoot);
      shadowRoots(element.shadowRoot, found);
    }
  }
  return found;
}

function ensureStyle(root) {
  if (root.querySelector('style[data-vim-notebook]') === null) {
    const style = document.createElement('style');
    style.dataset.vimNotebook = '';
    style.textContent = STYLE;
    root.appendChild(style);
  }
}

function apply() {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) {
    return;
  }
  CSS.highlights.delete(NAME);
  if (pattern === undefined) {
    postCount(0);
    return;
  }
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const ranges = [];
  for (const root of shadowRoots(document, [])) {
    ensureStyle(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement !== null && ['STYLE', 'SCRIPT'].includes(node.parentElement.tagName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    let node;
    while ((node = walker.nextNode()) !== null) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(node.data)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        const range = new Range();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        ranges.push(range);
      }
    }
  }
  CSS.highlights.set(NAME, new Highlight(...ranges));
  postCount(ranges.length);
}

export async function activate(ctx) {
  if (ctx.postMessage) {
    postCount = (count) => ctx.postMessage({ count });
  }
  ctx.onDidReceiveMessage?.((message) => {
    pattern = message.source === undefined ? undefined : { source: message.source, flags: message.flags };
    apply();
  });
  const markdownRenderer = await ctx.getRenderer('vscode.markdown-it-renderer');
  // Re-apply after each render, once the cell's DOM is in place.
  markdownRenderer?.extendMarkdownIt((md) => {
    md.core.ruler.push('vim-notebook-search', () => {
      if (pattern !== undefined) {
        setTimeout(apply, 0);
      }
    });
  });
}
