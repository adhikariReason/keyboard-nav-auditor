'use strict';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style']);

const MAX_INPUT_LENGTH = 5_000_000;
const MAX_DEPTH = 200;

class HtmlParseError extends Error {}

// Positions are always queried in non-decreasing order as the parse loop
// scans left to right, so a single forward-moving cursor makes this O(n)
// total instead of an O(index) rescan per call (which was O(n^2) overall
// on documents with many tags).
function makeLineTracker(src) {
  let cursor = 0;
  let line = 1;
  return function lineAt(index) {
    while (cursor < index && cursor < src.length) {
      if (src[cursor] === '\n') line++;
      cursor++;
    }
    return line;
  };
}

function parseAttributes(raw) {
  const attrs = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2]
      : m[3] !== undefined ? m[3]
      : m[4] !== undefined ? m[4]
      : '';
    attrs[name] = value;
  }
  return attrs;
}

// Sticky (`y`) regexes match only at `lastIndex`, so scanning a tag costs
// time proportional to the tag itself, not to a fresh `src.slice(lt)` copy
// of everything after it — the latter made parsing an O(n^2) on documents
// with many tags.
const CLOSE_TAG_RE = /<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/y;
const OPEN_TAG_RE = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*)?)\s*(\/)?>/y;

/**
 * Tolerant HTML tokenizer/tree builder. Not a spec-compliant parser:
 * no implied-tag-closing table, no encoding sniffing. Enough structure
 * (tag, attrs, children, parent, line) for static keyboard-nav analysis.
 */
function parseHtml(src) {
  if (typeof src !== 'string') {
    throw new HtmlParseError('input must be a string');
  }
  if (src.length > MAX_INPUT_LENGTH) {
    throw new HtmlParseError(`input exceeds ${MAX_INPUT_LENGTH} characters`);
  }

  const lineAt = makeLineTracker(src);
  const root = { tag: '#root', attrs: {}, children: [], parent: null, line: 1 };
  let current = root;
  let depth = 0;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      const text = src.slice(i);
      if (text.length) current.children.push({ tag: '#text', text, parent: current, line: lineAt(i) });
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      current.children.push({ tag: '#text', text, parent: current, line: lineAt(i) });
    }

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    CLOSE_TAG_RE.lastIndex = lt;
    const closeMatch = CLOSE_TAG_RE.exec(src);
    if (closeMatch) {
      const tagName = closeMatch[1].toLowerCase();
      let node = current;
      while (node && node.tag !== tagName && node.tag !== '#root') node = node.parent;
      if (node && node.tag === tagName) {
        current = node.parent;
        depth = Math.max(0, depth - 1);
      }
      i = lt + closeMatch[0].length;
      continue;
    }

    OPEN_TAG_RE.lastIndex = lt;
    const openMatch = OPEN_TAG_RE.exec(src);
    if (!openMatch) {
      current.children.push({ tag: '#text', text: '<', parent: current, line: lineAt(lt) });
      i = lt + 1;
      continue;
    }

    const tagName = openMatch[1].toLowerCase();
    const attrsRaw = openMatch[2] || '';
    const selfClosed = Boolean(openMatch[3]);
    const tagLine = lineAt(lt);
    const consumed = lt + openMatch[0].length;

    const node = {
      tag: tagName,
      attrs: parseAttributes(attrsRaw),
      children: [],
      parent: current,
      line: tagLine,
    };
    current.children.push(node);

    if (RAW_TEXT_TAGS.has(tagName) && !selfClosed) {
      const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
      closeRe.lastIndex = consumed;
      const closeM = closeRe.exec(src);
      const rawText = closeM ? src.slice(consumed, closeM.index) : src.slice(consumed);
      node.children.push({ tag: '#text', text: rawText, parent: node, line: tagLine });
      i = closeM ? closeM.index + closeM[0].length : n;
      continue;
    }

    if (VOID_TAGS.has(tagName) || selfClosed) {
      i = consumed;
      continue;
    }

    if (depth < MAX_DEPTH) {
      current = node;
      depth++;
    }
    i = consumed;
  }

  return root;
}

function walk(node, visit) {
  if (node.tag !== '#text') visit(node);
  if (node.children) {
    for (const child of node.children) walk(child, visit);
  }
}

// Dual-mode: `require`-able in Node (tests, CLI) and a plain global-scope
// <script> in the browser UI (loaded before app.js) — no bundler, no server,
// works straight from file://. `typeof module` never throws, so this is a
// no-op in the browser rather than a ReferenceError.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseHtml, walk, HtmlParseError, VOID_TAGS };
}
