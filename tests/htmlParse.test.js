const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHtml, walk, HtmlParseError } = require('../src/htmlParse.js');

function tags(node) {
  const out = [];
  for (const child of node.children) walk(child, (n) => out.push(n.tag));
  return out;
}

test('parses nested elements with attributes', () => {
  const root = parseHtml('<div class="a" id="x"><button type="submit">Go</button></div>');
  const div = root.children[0];
  assert.equal(div.tag, 'div');
  assert.deepEqual(div.attrs, { class: 'a', id: 'x' });
  const button = div.children[0];
  assert.equal(button.tag, 'button');
  assert.equal(button.attrs.type, 'submit');
  assert.equal(button.children[0].text, 'Go');
});

test('quoted, single-quoted, unquoted and boolean attributes', () => {
  const root = parseHtml('<input type="text" name=\'x\' value=hi disabled>');
  const input = root.children[0];
  assert.equal(input.attrs.type, 'text');
  assert.equal(input.attrs.name, 'x');
  assert.equal(input.attrs.value, 'hi');
  assert.equal(input.attrs.disabled, '');
});

test('void elements never open a child scope', () => {
  const root = parseHtml('<div><br><img src="a.png"><hr>text</div>');
  const div = root.children[0];
  assert.deepEqual(tags(div), ['br', 'img', 'hr']);
  assert.equal(div.children[3].text, 'text');
});

test('self-closing syntax on a non-void tag closes immediately', () => {
  const root = parseHtml('<div /><span>after</span>');
  assert.deepEqual(tags(root), ['div', 'span']);
});

test('comments are stripped, not treated as text or markup', () => {
  const root = parseHtml('<div><!-- <button>hidden</button> -->real</div>');
  const div = root.children[0];
  assert.equal(div.children.length, 1);
  assert.equal(div.children[0].text, 'real');
});

test('doctype and processing-instruction-like tags are skipped', () => {
  const root = parseHtml('<!DOCTYPE html><html><?pi data?><body>x</body></html>');
  assert.deepEqual(tags(root), ['html', 'body']);
});

test('script and style bodies are captured raw, not re-tokenized', () => {
  const root = parseHtml('<script>if (1 < 2) { var x = "<div>"; }</script>');
  const script = root.children[0];
  assert.equal(script.tag, 'script');
  assert.equal(script.children.length, 1);
  assert.equal(script.children[0].text, 'if (1 < 2) { var x = "<div>"; }');
});

test('mismatched closing tag is ignored, matching ancestor still closes correctly', () => {
  const root = parseHtml('<div><span></div></span>');
  assert.deepEqual(tags(root), ['div', 'span']);
});

test('unclosed tags at end of document do not throw', () => {
  const root = parseHtml('<div><span>text');
  assert.deepEqual(tags(root), ['div', 'span']);
  assert.equal(root.children[0].children[0].children[0].text, 'text');
});

test('line numbers track physical lines', () => {
  const root = parseHtml('<div>\n  <button>x</button>\n</div>');
  const button = root.children[0].children[1];
  assert.equal(button.tag, 'button');
  assert.equal(button.line, 2);
});

test('deeply nested tags are capped rather than recursing unbounded', () => {
  const depth = 5000;
  const html = '<div>'.repeat(depth) + 'x' + '</div>'.repeat(depth);
  assert.doesNotThrow(() => parseHtml(html));
});

test('oversized input is rejected before parsing', () => {
  const huge = '<div>'.repeat(2_000_000);
  assert.throws(() => parseHtml(huge), HtmlParseError);
});

test('non-string input is rejected', () => {
  assert.throws(() => parseHtml(null), HtmlParseError);
  assert.throws(() => parseHtml(42), HtmlParseError);
  assert.throws(() => parseHtml(undefined), HtmlParseError);
});

test('empty input parses to an empty root', () => {
  const root = parseHtml('');
  assert.deepEqual(root.children, []);
});

test('a lone "<" with no valid tag is treated as text', () => {
  const root = parseHtml('a < b');
  assert.equal(root.children.map((c) => c.text).join(''), 'a < b');
});
