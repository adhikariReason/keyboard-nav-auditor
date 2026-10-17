'use strict';

// Behavioral verification of src/app.js's DOM wiring, using the hand-rolled
// stub in dom-stub.js in place of jsdom (unreachable: no network to install
// it) or a live browser (unreachable: this sandbox cannot bind a local port
// for `python3 -m http.server`). Both gaps are disclosed in
// access-needs.md. The prior verification of this file (node --check plus a
// static getElementById/index.html id cross-reference) only proved it
// parses and the ids line up; it never executed an input event, a button
// click, or a simulated file drop. This does.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { auditHtml } = require('../src/auditor.js');
const { StubFileReader, stubFile, createStubDocument } = require('./dom-stub.js');

const IDS = ['html-input', 'status', 'report', 'sample-btn', 'clear-btn'];
const APP_PATH = require.resolve('../src/app.js');

// Every test gets a fresh stub document and a freshly-executed app.js (its
// top-level wiring runs `renderReport(input.value)` immediately on load) --
// clearing the require cache forces a real re-execution each time instead of
// returning the same cached module instance with stale captured elements.
function loadApp() {
  const stub = createStubDocument(IDS);
  globalThis.document = stub.document;
  globalThis.auditHtml = auditHtml;
  globalThis.FileReader = StubFileReader;
  delete require.cache[APP_PATH];
  require(APP_PATH);
  return stub;
}

test('empty input shows the placeholder, not a report', () => {
  const s = loadApp();
  assert.equal(s.elements.status.textContent, 'Paste HTML, or load the example, to begin.');
  assert.equal(s.elements.report.children.length, 1);
  assert.equal(s.elements.report.children[0].textContent, 'Nothing to audit yet.');
});

test('typing a clean page reports no issues and lists the tab order', async () => {
  const s = loadApp();
  s.elements['html-input'].value = '<button>One</button><a href="#">Two</a>';
  s.elements['html-input'].dispatch('input');
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(s.elements.status.textContent, 'No issues found');
  const [summary, tabOrderSection] = s.elements.report.children;
  assert.equal(summary.textContent, 'No keyboard-navigation issues found.');
  assert.match(tabOrderSection.textContent, /Computed tab order \(2 focusable elements\)/);
});

test('typing a page with a real defect renders an issue card with its DOM/tab order', async () => {
  const s = loadApp();
  s.elements['html-input'].value = '<div onclick="go()">Click me</div><button>Reachable</button>';
  s.elements['html-input'].dispatch('input');
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(s.elements.status.textContent, '1 issue found');
  const [, issueCard] = s.elements.report.children;
  assert.match(issueCard.textContent, /UNREACHABLE-INTERACTIVE/i);
  assert.match(issueCard.textContent, /line 1/);
});

test('the Load example button fills the textarea and renders its known defects', async () => {
  const s = loadApp();
  s.elements['sample-btn'].dispatch('click');
  assert.match(s.elements['html-input'].value, /Out of DOM order/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.match(s.elements.status.textContent, /issue/);
  assert.ok(s.elements.report.children.length > 1);
});

test('the Clear button empties the textarea and returns to the placeholder', async () => {
  const s = loadApp();
  s.elements['sample-btn'].dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 200));
  s.elements['clear-btn'].dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(s.elements['html-input'].value, '');
  assert.equal(s.elements.status.textContent, 'Paste HTML, or load the example, to begin.');
});

test('dragover marks the drop target and dragleave un-marks it, without navigating away', () => {
  const s = loadApp();
  const input = s.elements['html-input'];
  const over = input.dispatch('dragover', {});
  assert.equal(over.defaultPrevented, true, 'default browser file-open navigation must be prevented');
  assert.equal(input.classList.contains('is-dragover'), true);

  input.dispatch('dragleave');
  assert.equal(input.classList.contains('is-dragover'), false);
});

test('dropping an HTML file loads its text and renders a report for it', async () => {
  const s = loadApp();
  const drop = s.dropFile(stubFile('<button tabindex="3">Out of order</button><button>Normal</button>'));
  assert.equal(drop.defaultPrevented, true);
  assert.equal(s.elements['html-input'].classList.contains('is-dragover'), false, 'drop clears the drag styling immediately');

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(s.elements['html-input'].value, /Out of order/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.match(s.elements.status.textContent, /issue/);
});

test('dropping with no file at all is a silent no-op, not a crash', () => {
  const s = loadApp();
  assert.doesNotThrow(() => s.elements['html-input'].dispatch('drop', { dataTransfer: { files: [] } }));
  assert.equal(s.elements.status.textContent, 'Paste HTML, or load the example, to begin.');
});

test('a failed file read shows a clear message instead of hanging', async () => {
  const s = loadApp();
  s.dropFile(stubFile('', { failRead: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(s.elements.status.textContent, 'Could not read the dropped file.');
});

test('rapid keystrokes are debounced into a single render, not one per keystroke', async () => {
  const s = loadApp();
  const input = s.elements['html-input'];
  for (const ch of ['<', 'b', 'u', 't', 't', 'o', 'n', '>', '>']) {
    input.value += ch;
    input.dispatch('input');
  }
  // Immediately after the burst, the debounce timer hasn't fired yet.
  assert.equal(s.elements.status.textContent, 'Paste HTML, or load the example, to begin.');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.notEqual(s.elements.status.textContent, 'Paste HTML, or load the example, to begin.');
});

test('input over the character cap is truncated with a clear message, never silently accepted whole', async () => {
  const s = loadApp();
  const MAX_CHARS = 2000000;
  s.elements['html-input'].value = 'a'.repeat(MAX_CHARS + 10);
  s.elements['html-input'].dispatch('input');
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(s.elements['html-input'].value.length, MAX_CHARS);
  assert.equal(s.elements.status.textContent, `Input truncated to ${MAX_CHARS} characters. No issues found`);
});

test('dynamic content is never built via innerHTML -- only createTextNode/textContent (matches static review)', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
});
