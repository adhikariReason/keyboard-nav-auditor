'use strict';

// Dual-mode, same as htmlParse.js/cssParse.js: `require` in Node, or read
// off the globals those two files already attached when loaded first as
// plain <script> tags in the browser UI.
const { parseHtml, walk } = typeof module !== 'undefined' && module.exports
  ? require('./htmlParse.js')
  : { parseHtml: window.parseHtml, walk: window.walk };
const { parseCss } = typeof module !== 'undefined' && module.exports
  ? require('./cssParse.js')
  : { parseCss: window.parseCss };

const NATURALLY_FOCUSABLE_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'summary',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'checkbox', 'radio', 'switch', 'tab', 'option',
]);

const INTERACTIVE_EVENT_ATTRS = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown'];

const OUTLINE_SUPPRESSING = new Set(['outline', 'outline-style', 'outline-width', 'outline-color']);
const COMPENSATING_PROPS = ['box-shadow', 'border', 'border-color', 'border-width', 'border-style', 'background', 'background-color', 'filter'];

// A value is "invisible" if it's literally transparent — the ring/compensation is
// drawn but can never be seen, which is indistinguishable from not drawing it at all.
function isInvisibleValue(v) {
  return v.trim().toLowerCase().split(/\s+/).includes('transparent');
}

function isOutlineSuppressed(decl) {
  if (!OUTLINE_SUPPRESSING.has(decl.prop)) return false;
  const v = decl.value.trim();
  if (isInvisibleValue(v)) return true;
  return v === 'none' || v === '0' || v === '0px' || v.startsWith('none ') || v === '0 none' || /^0(\.0+)?(px|em|rem)?$/.test(v);
}

function hasCompensation(declarations) {
  return declarations.some((d) => COMPENSATING_PROPS.includes(d.prop) && d.value.trim() !== 'none' && d.value.trim() !== '0' && !isInvisibleValue(d.value));
}

function selectorBase(selector) {
  // Strip a trailing :focus / :focus-visible pseudo-class to compare "the same element".
  return selector.replace(/:focus(-visible)?\b/g, '').trim();
}

function isDisabledOrInert(node) {
  return 'disabled' in node.attrs || 'inert' in node.attrs || node.attrs['aria-hidden'] === 'true';
}

function tabindexValue(node) {
  if (!('tabindex' in node.attrs)) return null;
  const raw = node.attrs.tabindex.trim();
  if (!/^-?\d+$/.test(raw)) return null; // malformed tabindex: browsers ignore it, treat as absent
  return parseInt(raw, 10);
}

function isNaturallyFocusable(node) {
  if (!NATURALLY_FOCUSABLE_TAGS.has(node.tag)) return false;
  if (node.tag === 'a') return 'href' in node.attrs;
  if (node.tag === 'input' && node.attrs.type === 'hidden') return false;
  return true;
}

function isFocusable(node) {
  if (isDisabledOrInert(node)) return false;
  const ti = tabindexValue(node);
  if (ti !== null) return ti >= 0;
  return isNaturallyFocusable(node);
}

function isInteractive(node) {
  if (INTERACTIVE_EVENT_ATTRS.some((a) => a in node.attrs)) return true;
  const role = (node.attrs.role || '').toLowerCase();
  return INTERACTIVE_ROLES.has(role);
}

function nodeSelector(node) {
  if (node.attrs.id) return `${node.tag}#${node.attrs.id}`;
  if (node.attrs.class) return `${node.tag}.${node.attrs.class.trim().split(/\s+/).join('.')}`;
  return node.tag;
}

function collectNodes(root) {
  const nodes = [];
  walk(root, (n) => nodes.push(n));
  return nodes;
}

function checkUnreachableInteractive(nodes) {
  const issues = [];
  for (const node of nodes) {
    if (isDisabledOrInert(node)) continue;
    if (!isInteractive(node)) continue;
    if (isFocusable(node)) continue;
    issues.push({
      rule: 'unreachable-interactive',
      severity: 'error',
      line: node.line,
      selector: nodeSelector(node),
      message: `<${node.tag}> is interactive (${describeWhyInteractive(node)}) but has no way to receive keyboard focus — a mouse user can activate it, a keyboard user cannot reach it. Add tabindex="0" or use a naturally focusable element.`,
    });
  }
  return issues;
}

function describeWhyInteractive(node) {
  const ev = INTERACTIVE_EVENT_ATTRS.find((a) => a in node.attrs);
  if (ev) return `has ${ev}`;
  return `role="${node.attrs.role}"`;
}

function computeTabOrder(nodes) {
  const focusable = nodes.filter(isFocusable).map((node, domIndex) => ({
    node,
    domIndex,
    tabindex: tabindexValue(node) ?? 0,
  }));
  const domOrder = focusable.map((f) => f.node);
  const specOrder = [...focusable]
    .sort((a, b) => {
      if (a.tabindex > 0 && b.tabindex > 0) {
        if (a.tabindex !== b.tabindex) return a.tabindex - b.tabindex;
        return a.domIndex - b.domIndex;
      }
      if (a.tabindex > 0) return -1;
      if (b.tabindex > 0) return 1;
      return a.domIndex - b.domIndex;
    })
    .map((f) => f.node);
  return { domOrder, specOrder };
}

function checkTabOrder(nodes) {
  const issues = [];
  const { domOrder, specOrder } = computeTabOrder(nodes);

  for (const node of nodes) {
    const ti = tabindexValue(node);
    if (ti !== null && ti > 0) {
      issues.push({
        rule: 'positive-tabindex',
        severity: 'warning',
        line: node.line,
        selector: nodeSelector(node),
        message: `<${node.tag}> has tabindex="${ti}" (positive). Explicit positive tabindex values are fragile: the next markup edit nearby can silently reorder keyboard navigation. Prefer reordering the markup and tabindex="0".`,
      });
    }
  }

  const diverges = domOrder.length === specOrder.length &&
    domOrder.some((node, i) => node !== specOrder[i]);
  if (diverges) {
    issues.push({
      rule: 'tab-order-diverges',
      severity: 'error',
      line: specOrder[0] ? specOrder[0].line : 1,
      selector: null,
      message: 'Tab order does not match visual/DOM order.',
      domOrder: domOrder.map((n) => `${nodeSelector(n)} (line ${n.line})`),
      tabOrder: specOrder.map((n) => `${nodeSelector(n)} (line ${n.line})`),
    });
  }

  return issues;
}

function collectStyleBlockRules(nodes) {
  // Only <style> blocks can express :focus/:focus-visible; a style="" attribute
  // cannot contain a pseudo-class selector, so it has nothing to contribute here.
  const rules = [];
  for (const node of nodes) {
    if (node.tag !== 'style') continue;
    const text = (node.children[0] && node.children[0].text) || '';
    rules.push(...parseCss(text, node.line));
  }
  return rules;
}

function checkFocusIndicator(nodes) {
  const issues = [];
  const rules = collectStyleBlockRules(nodes);

  const focusRules = rules.filter((r) => r.selectors.some((s) => /:focus\b/.test(s) && !/:focus-visible/.test(s)));
  const focusVisibleBases = new Set(
    rules
      .filter((r) => r.selectors.some((s) => /:focus-visible/.test(s)))
      .flatMap((r) => r.selectors.map(selectorBase))
  );

  for (const rule of focusRules) {
    const suppressing = rule.declarations.filter(isOutlineSuppressed);
    if (!suppressing.length) continue;
    if (hasCompensation(rule.declarations)) continue;
    const bases = rule.selectors.filter((s) => /:focus\b/.test(s) && !/:focus-visible/.test(s)).map(selectorBase);
    if (bases.some((b) => focusVisibleBases.has(b))) continue;
    issues.push({
      rule: 'focus-indicator-suppressed',
      severity: 'error',
      line: rule.line,
      selector: rule.selectors.join(', '),
      message: `Rule for ${rule.selectors.join(', ')} removes the focus outline (${suppressing.map((d) => `${d.prop}: ${d.value}`).join(', ')}) with no replacement visual indicator (no box-shadow/border/background change) and no matching :focus-visible rule. Keyboard users lose all visual indication of focus.`,
    });
  }

  return issues;
}

const TAB_KEY_RE = /\b(?:key|keyCode|which)\b\s*===?\s*(?:['"]Tab['"]|9\b)|(?:['"]Tab['"]|9\b)\s*===?\s*(?:[A-Za-z_$][\w$]*\.)?(?:key|keyCode|which)\b/;
const PREVENT_RE = /\.(preventDefault|stopPropagation)\s*\(/;
const FOCUS_CALL_RE = /\.focus\s*\(/;
const HANDLER_KEY_RE = /\b(?:on)?key(?:down|up)\b/gi;

// A real handler's opening brace sits right after its signature; capping how
// far ahead each of these two scans may look keeps the whole function O(n)
// even when the script is adversarial (e.g. thousands of "keydown"
// substrings with no brace anywhere) rather than O(n^2) from an unbounded
// `indexOf`/`[^{}]*` scan repeated at every occurrence.
const MAX_BRACE_LOOKAHEAD = 300;
const MAX_HANDLER_BODY_SCAN = 20_000;

function indexOfWithin(str, ch, from, limit) {
  const end = Math.min(str.length, limit);
  for (let i = from; i < end; i++) {
    if (str[i] === ch) return i;
  }
  return -1;
}

function extractHandlerBodies(scriptText) {
  const bodies = [];
  let m;
  HANDLER_KEY_RE.lastIndex = 0;
  while ((m = HANDLER_KEY_RE.exec(scriptText)) !== null) {
    const searchFrom = m.index + m[0].length;
    const braceIdx = indexOfWithin(scriptText, '{', searchFrom, searchFrom + MAX_BRACE_LOOKAHEAD);
    if (braceIdx === -1) continue;

    let depth = 0;
    let i = braceIdx;
    const scanLimit = Math.min(scriptText.length, braceIdx + MAX_HANDLER_BODY_SCAN);
    while (i < scanLimit) {
      if (scriptText[i] === '{') depth++;
      else if (scriptText[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    bodies.push({ body: scriptText.slice(braceIdx, i + 1), line: m.index });
  }
  return bodies;
}

function checkTabTrap(nodes) {
  const issues = [];
  for (const node of nodes) {
    if (node.tag !== 'script') continue;
    const text = (node.children[0] && node.children[0].text) || '';
    if (node.attrs.src) continue; // external script not fetched; disclosed as a gap elsewhere
    for (const { body } of extractHandlerBodies(text)) {
      if (TAB_KEY_RE.test(body) && PREVENT_RE.test(body) && !FOCUS_CALL_RE.test(body)) {
        issues.push({
          rule: 'possible-tab-trap',
          severity: 'warning',
          line: node.line,
          selector: 'script',
          message: 'A keydown/keyup handler checks for the Tab key and calls preventDefault()/stopPropagation() with no .focus() call in the same handler. This may trap keyboard focus. Heuristic over source text, not a browser trace — verify manually.',
        });
      }
    }
  }
  return issues;
}

function auditHtml(html) {
  const root = parseHtml(html);
  const nodes = collectNodes(root);
  const { specOrder } = computeTabOrder(nodes);

  const issues = [
    ...checkUnreachableInteractive(nodes),
    ...checkTabOrder(nodes),
    ...checkFocusIndicator(nodes),
    ...checkTabTrap(nodes),
  ];

  return {
    tabOrder: specOrder.map((n) => ({ selector: nodeSelector(n), line: n.line })),
    issues,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { auditHtml, isFocusable, isInteractive, computeTabOrder };
}
