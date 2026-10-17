const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCss, parseDeclarations, splitTopLevel } = require('../src/cssParse.js');

test('basic rule: selector and declarations', () => {
  const rules = parseCss('.btn { color: red; outline: none; }');
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, ['.btn']);
  assert.deepEqual(rules[0].declarations, [
    { prop: 'color', value: 'red' },
    { prop: 'outline', value: 'none' },
  ]);
});

test('comma-separated selector list splits at the top level only', () => {
  const rules = parseCss('a:focus, .x:not(.y, .z), .w { outline: 0; }');
  assert.deepEqual(rules[0].selectors, ['a:focus', '.x:not(.y, .z)', '.w']);
});

test('!important is stripped from the value', () => {
  const rules = parseCss('.a { outline: none !important; }');
  assert.equal(rules[0].declarations[0].value, 'none');
});

test('values are lower-cased, property names are lower-cased', () => {
  const rules = parseCss('.A { OUTLINE: NONE; }');
  assert.equal(rules[0].declarations[0].prop, 'outline');
  assert.equal(rules[0].declarations[0].value, 'none');
});

test('comments are ignored anywhere, including inside a rule', () => {
  const rules = parseCss('/* top */ .a { /* mid */ outline: none; /* end */ }');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].declarations[0].prop, 'outline');
});

test('@media bodies are recursed into with the condition ignored', () => {
  const rules = parseCss('@media (max-width: 600px) { .a:focus { outline: none; } }');
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, ['.a:focus']);
});

test('@supports bodies are recursed into', () => {
  const rules = parseCss('@supports (display: grid) { .a { outline: none; } }');
  assert.equal(rules.length, 1);
});

test('@keyframes and other at-rules are skipped entirely, not misread as selectors', () => {
  const rules = parseCss('@keyframes spin { from { outline: none; } 50% { color: red; } to {} } .a { outline: none; }');
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, ['.a']);
});

test('@font-face and @import are skipped', () => {
  const rules = parseCss("@import url('x.css'); @font-face { font-family: X; src: url(x.woff); } .a { color: red; }");
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, ['.a']);
});

test('braces and semicolons inside string values do not confuse the parser', () => {
  const rules = parseCss('.a { content: "a { b; c }"; outline: none; }');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].declarations.length, 2);
  assert.equal(rules[0].declarations[1].prop, 'outline');
});

test('line numbers track physical lines, including inside @media', () => {
  const css = '.a { color: red; }\n@media (min-width: 1px) {\n  .b:focus { outline: none; }\n}';
  const rules = parseCss(css);
  assert.equal(rules[0].line, 1);
  assert.equal(rules[1].line, 3);
});

test('declaration with no colon is ignored rather than throwing', () => {
  const rules = parseCss('.a { this-is-garbage; color: red; }');
  assert.deepEqual(rules[0].declarations, [{ prop: 'color', value: 'red' }]);
});

test('unterminated rule does not throw, takes the rest of input as its body', () => {
  assert.doesNotThrow(() => parseCss('.a { outline: none;'));
});

test('empty input parses to no rules', () => {
  assert.deepEqual(parseCss(''), []);
});

test('deeply nested @media is capped rather than recursing unbounded', () => {
  const depth = 500;
  let css = '.a { outline: none; }';
  for (let i = 0; i < depth; i++) css = `@media (min-width: ${i}px) { ${css} }`;
  assert.doesNotThrow(() => parseCss(css));
});

test('oversized input is rejected before parsing', () => {
  const huge = '.a{}'.repeat(600_000);
  assert.throws(() => parseCss(huge), RangeError);
});

test('non-string input is rejected', () => {
  assert.throws(() => parseCss(null), TypeError);
});

test('splitTopLevel respects nested parens/brackets', () => {
  assert.deepEqual(splitTopLevel('a(1,2), b[x,y], c', ',', '([', ')]'), ['a(1,2)', ' b[x,y]', ' c']);
});

test('parseDeclarations ignores a trailing empty statement', () => {
  assert.deepEqual(parseDeclarations('color: red;;'), [{ prop: 'color', value: 'red' }]);
});
