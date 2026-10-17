'use strict';

const MAX_INPUT_LENGTH = 2_000_000;
const MAX_AT_RULE_DEPTH = 50;

// Indices are always queried in non-decreasing order as parseCss scans
// forward, so one forward-moving cursor per invocation makes this O(n)
// total instead of an O(index) rescan per rule (O(n^2) on a stylesheet
// with many rules).
function makeLineTracker(src, baseLine) {
  let cursor = 0;
  let line = baseLine;
  return function lineAt(index) {
    while (cursor < index && cursor < src.length) {
      if (src[cursor] === '\n') line++;
      cursor++;
    }
    return line;
  };
}

function findStringEnd(src, start, quote) {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i;
    i++;
  }
  return src.length;
}

function findMatchingBrace(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = findStringEnd(src, i, c) + 1;
      continue;
    }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

function splitTopLevel(s, separator, openers, closers) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (openers.includes(c)) depth++;
    else if (closers.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === separator && depth === 0) {
      parts.push(s.slice(last, k));
      last = k + 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}

function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const end = findStringEnd(src, i, c);
      out += src.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function parseDeclarations(body) {
  const decls = [];
  for (const stmt of splitTopLevel(stripComments(body), ';', '(', ')')) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = trimmed.slice(0, colonIdx).trim().toLowerCase();
    let value = trimmed.slice(colonIdx + 1).trim();
    value = value.replace(/!\s*important\s*$/i, '').trim();
    if (prop) decls.push({ prop, value: value.toLowerCase() });
  }
  return decls;
}

/**
 * Minimal CSS rule extractor: selectors + declarations for the subset
 * needed to find :focus/:focus-visible outline suppression. Not a full
 * CSS parser — @keyframes/@font-face/@import bodies are skipped entirely;
 * @media/@supports bodies are recursed into (their condition is ignored).
 */
function parseCss(src, startLine = 1, atRuleDepth = 0) {
  if (typeof src !== 'string') throw new TypeError('css input must be a string');
  if (atRuleDepth === 0 && src.length > MAX_INPUT_LENGTH) {
    throw new RangeError(`css input exceeds ${MAX_INPUT_LENGTH} characters`);
  }

  const rules = [];
  const lineAt = makeLineTracker(src, startLine);
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === ';' || c === '}') { i++; continue; }

    let j = i;
    let selEnd = -1;
    while (j < n) {
      const cj = src[j];
      if (cj === '"' || cj === "'") { j = findStringEnd(src, j, cj) + 1; continue; }
      if (cj === '{' || cj === ';') { selEnd = j; break; }
      j++;
    }
    if (selEnd === -1) break;

    const selectorText = src.slice(i, selEnd).trim();
    if (src[selEnd] === ';') { i = selEnd + 1; continue; }

    const closeIdx = findMatchingBrace(src, selEnd);
    const bodyStart = selEnd + 1;
    const bodyEnd = closeIdx === -1 ? n : closeIdx;
    const body = src.slice(bodyStart, bodyEnd);
    const line = lineAt(i);

    if (selectorText.startsWith('@')) {
      const atName = (selectorText.match(/^@[a-zA-Z-]+/) || [''])[0].toLowerCase();
      if ((atName === '@media' || atName === '@supports') && atRuleDepth < MAX_AT_RULE_DEPTH) {
        const nestedStartLine = lineAt(bodyStart);
        rules.push(...parseCss(body, nestedStartLine, atRuleDepth + 1));
      }
    } else if (selectorText) {
      const selectors = splitTopLevel(selectorText, ',', '([', ')]')
        .map((s) => s.trim())
        .filter(Boolean);
      if (selectors.length) {
        rules.push({ selectors, declarations: parseDeclarations(body), line });
      }
    }

    i = closeIdx === -1 ? n : closeIdx + 1;
  }

  return rules;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCss, parseDeclarations, splitTopLevel };
}
