const test = require('node:test');
const assert = require('node:assert/strict');
const { auditHtml } = require('../src/auditor.js');

function rulesOf(html) {
  return auditHtml(html).issues.map((i) => i.rule);
}

test('a clean page with only natively focusable controls has no issues', () => {
  const { issues, tabOrder } = auditHtml('<button>One</button><a href="#">Two</a><input type="text">');
  assert.deepEqual(issues, []);
  assert.deepEqual(tabOrder.map((t) => t.selector), ['button', 'a', 'input']);
});

test('onclick div with no tabindex is flagged unreachable', () => {
  const issues = auditHtml('<div onclick="go()">Click</div>').issues;
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'unreachable-interactive');
});

test('role=button with no tabindex is flagged unreachable', () => {
  assert.deepEqual(rulesOf('<div role="button">Click</div>'), ['unreachable-interactive']);
});

test('onclick div WITH tabindex=0 is not flagged', () => {
  assert.deepEqual(rulesOf('<div onclick="go()" tabindex="0">Click</div>'), []);
});

test('disabled interactive element is never flagged unreachable', () => {
  assert.deepEqual(rulesOf('<button disabled onclick="go()">x</button>'), []);
});

test('inert and aria-hidden=true interactive elements are not flagged unreachable', () => {
  assert.deepEqual(rulesOf('<div role="button" inert>x</div>'), []);
  assert.deepEqual(rulesOf('<div role="button" aria-hidden="true">x</div>'), []);
});

test('a non-interactive role is not flagged even without tabindex', () => {
  assert.deepEqual(rulesOf('<div role="presentation">deco</div>'), []);
});

test('tabindex=-1 on an interactive element is flagged unreachable (removed from sequential nav)', () => {
  assert.deepEqual(rulesOf('<div role="button" tabindex="-1">x</div>'), ['unreachable-interactive']);
});

test('a[href] is naturally focusable, a without href is not', () => {
  assert.deepEqual(rulesOf('<a href="#" onclick="go()">ok</a>'), []);
  assert.deepEqual(rulesOf('<a onclick="go()">bare anchor</a>'), ['unreachable-interactive']);
});

test('input type=hidden is excluded from focusability and from tab order', () => {
  const { tabOrder } = auditHtml('<input type="hidden" value="x"><button>go</button>');
  assert.deepEqual(tabOrder.map((t) => t.selector), ['button']);
});

test('positive tabindex is flagged as a fragility warning even with no actual reordering', () => {
  const issues = auditHtml('<button tabindex="1">only</button>').issues;
  assert.deepEqual(issues.map((i) => i.rule), ['positive-tabindex']);
});

test('tab order diverging from DOM order is flagged with both orderings', () => {
  const { issues } = auditHtml('<button tabindex="2">A</button><button tabindex="1">B</button>');
  const divergence = issues.find((i) => i.rule === 'tab-order-diverges');
  assert.ok(divergence);
  assert.equal(divergence.domOrder.length, 2);
  assert.equal(divergence.tabOrder.length, 2);
});

test('tabindex=0 elements keep DOM order and are not flagged as diverging', () => {
  const issues = auditHtml('<button tabindex="0">A</button><button tabindex="0">B</button>').issues;
  assert.deepEqual(issues.filter((i) => i.rule === 'tab-order-diverges'), []);
});

test('an element with an id gets an id-based selector (tag#id) in reported output', () => {
  const issues = auditHtml('<button id="submit-btn" tabindex="1">Go</button>').issues;
  assert.equal(issues[0].selector, 'button#submit-btn');
});

test('a later positive-tabindex element sorts before earlier zero/no-tabindex elements', () => {
  const { tabOrder } = auditHtml(
    '<button id="a">A</button><button id="b">B</button><button id="c" tabindex="5">C</button>'
  );
  assert.deepEqual(tabOrder.map((t) => t.selector), ['button#c', 'button#a', 'button#b']);
});

test('a malformed (non-numeric) tabindex is treated as absent, not as an error', () => {
  const { tabOrder } = auditHtml('<div role="button" tabindex="banana">x</div>');
  assert.deepEqual(tabOrder, []);
  assert.deepEqual(rulesOf('<div role="button" tabindex="banana">x</div>'), ['unreachable-interactive']);
});

test(':focus { outline: none } with no replacement is flagged', () => {
  const issues = auditHtml('<style>.btn:focus{outline:none}</style><button class="btn">x</button>').issues;
  assert.deepEqual(issues.map((i) => i.rule), ['focus-indicator-suppressed']);
});

test(':focus outline removed but box-shadow added is NOT flagged', () => {
  const issues = auditHtml('<style>.btn:focus{outline:none;box-shadow:0 0 0 2px blue}</style><button class="btn">x</button>').issues;
  assert.deepEqual(issues, []);
});

test(':focus outline removed but a matching :focus-visible rule exists is NOT flagged', () => {
  const css = '.btn:focus{outline:none} .btn:focus-visible{outline:2px solid green}';
  const issues = auditHtml(`<style>${css}</style><button class="btn">x</button>`).issues;
  assert.deepEqual(issues, []);
});

test('outline set to a real value is never flagged', () => {
  const issues = auditHtml('<style>.btn:focus{outline:2px solid blue}</style><button class="btn">x</button>').issues;
  assert.deepEqual(issues, []);
});

test('outline color set to transparent is flagged — the ring is drawn but invisible', () => {
  const issues = auditHtml('<style>.btn:focus{outline:2px solid transparent}</style><button class="btn">x</button>').issues;
  assert.deepEqual(issues.map((i) => i.rule), ['focus-indicator-suppressed']);
});

test('outline-color alone set to transparent is flagged the same way as the shorthand', () => {
  const issues = auditHtml('<style>.btn:focus{outline-style:solid;outline-color:transparent}</style><button class="btn">x</button>').issues;
  assert.deepEqual(issues.map((i) => i.rule), ['focus-indicator-suppressed']);
});

test('a "compensating" box-shadow that is itself transparent does not count as real compensation', () => {
  const issues = auditHtml('<style>.btn:focus{outline:none;box-shadow:0 0 0 2px transparent}</style><button class="btn">x</button>').issues;
  assert.deepEqual(issues.map((i) => i.rule), ['focus-indicator-suppressed']);
});

test('outline set to currentColor is not flagged — it tracks the text colour, not invisible', () => {
  const issues = auditHtml('<style>.btn:focus{outline:2px solid currentColor}</style><button class="btn">x</button>').issues;
  assert.deepEqual(issues, []);
});

test('an empty <style></style> block contributes no rules and does not crash', () => {
  const issues = auditHtml('<style></style><button class="btn">x</button>').issues;
  assert.deepEqual(issues, []);
});

test('a comma-selector list sharing a focus selector inherits the suppression', () => {
  const css = 'a:focus, .deco { outline: 0; }';
  const issues = auditHtml(`<style>${css}</style><a href="#">x</a>`).issues;
  assert.deepEqual(issues.map((i) => i.rule), ['focus-indicator-suppressed']);
});

test('focus suppression inside @media is still detected', () => {
  const css = '@media (min-width: 1px) { .btn:focus { outline: none; } }';
  const issues = auditHtml(`<style>${css}</style><button class="btn">x</button>`).issues;
  assert.deepEqual(issues.map((i) => i.rule), ['focus-indicator-suppressed']);
});

test('Tab key intercepted with preventDefault and no .focus() call is flagged', () => {
  const html = "<script>document.addEventListener('keydown', function (e) { if (e.key === 'Tab') { e.preventDefault(); } });</script>";
  assert.deepEqual(rulesOf(html), ['possible-tab-trap']);
});

test('Tab key intercepted but focus is explicitly moved is NOT flagged', () => {
  const html = "<script>el.addEventListener('keydown', function (e) { if (e.key === 'Tab') { e.preventDefault(); next.focus(); } });</script>";
  assert.deepEqual(rulesOf(html), []);
});

test('a keydown handler for an unrelated key is NOT flagged', () => {
  const html = "<script>el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });</script>";
  assert.deepEqual(rulesOf(html), []);
});

test('an external script (src=) is not fetched or scanned, no crash', () => {
  const html = '<script src="app.js"></script>';
  assert.deepEqual(rulesOf(html), []);
});

test('keyCode === 9 and 9 === which forms are both recognised', () => {
  assert.deepEqual(
    rulesOf("<script>document.onkeydown = function (e) { if (e.keyCode === 9) e.preventDefault(); };</script>"),
    ['possible-tab-trap']
  );
  assert.deepEqual(
    rulesOf("<script>document.onkeydown = function (e) { if (9 === e.which) e.preventDefault(); };</script>"),
    ['possible-tab-trap']
  );
});

test('multiple independent issues on one page are all reported', () => {
  const html = `
    <style>.btn:focus{outline:none}</style>
    <div onclick="go()">unreachable</div>
    <button class="btn">suppressed focus</button>
    <button tabindex="3">fragile order</button>
  `;
  const rules = rulesOf(html).sort();
  assert.deepEqual(rules, [
    'focus-indicator-suppressed',
    'positive-tabindex',
    'tab-order-diverges',
    'unreachable-interactive',
  ]);
});
