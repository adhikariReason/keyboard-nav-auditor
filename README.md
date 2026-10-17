# keyboard-nav-auditor

A static analyzer for one page of HTML that reports concrete
keyboard-accessibility defects: controls a mouse user can reach but a
keyboard user cannot, a tab order that doesn't match the markup, focus rings
suppressed with no replacement, and script patterns that look like they trap
the Tab key.

Built from [vscode#1136](https://github.com/microsoft/vscode/issues/1136) and
[whatwg/html#7033](https://github.com/whatwg/html/issues/7033), validated
against 462 similar open issues across the ecosystem — these four failure
modes recur constantly and are exactly the ones a static tool can catch
without running a real browser.

## What it checks

1. **Keyboard-unreachable interactive controls** (WCAG 2.1.1). An element
   with `onclick`/`onmousedown`/`onmouseup`/`onkeydown`, or an interactive
   `role` (`button`, `link`, `checkbox`, `tab`, …), that has no way to
   receive keyboard focus — not a naturally focusable tag, and no
   `tabindex="0"` (or a positive tabindex).
2. **Tab order diverging from DOM order** (WCAG 2.4.3). Computes the real
   browser tab sequence (`tabindex > 0` ascending, then DOM order for
   everything else) and flags any inversion against plain markup order. A
   bare positive `tabindex` is also flagged on its own as a fragility
   warning, even if it doesn't invert anything yet.
3. **Focus indicator suppressed with no replacement** (WCAG 2.4.7). A
   `:focus` CSS rule that sets `outline: none`/`0`/a `transparent` colour
   (shorthand or `outline-color` alone — both draw a ring nobody can see) with
   no compensating `box-shadow`/`border`/`background`/`filter` in the same
   rule, and no sibling `:focus-visible` rule providing one. A "compensating"
   property that is itself `transparent` doesn't count as a real replacement.
4. **A possible Tab-key trap** (heuristic). An inline-script keydown/keyup
   handler that checks for the Tab key and calls
   `preventDefault()`/`stopPropagation()` with no `.focus()` call anywhere
   in the same handler body.

Every check runs on parsed markup and CSS/script **text** — nothing is
executed, nothing is rendered, and nothing leaves your machine.

## What's explicitly out of scope, and why

| Excluded | Why |
| --- | --- |
| Executing script, rendering layout, or confirming a flagged defect is actually experienced by a real user tabbing through the page | No browser automation here — this tool reports where the markup/CSS/script *looks* wrong, not a recording of real keystrokes. See "Known gaps" below. |
| Fetching or reading an external `<link>`/`<script src>` | No network fetch at runtime, ever — keyless by design. External scripts are unconditionally skipped for Check 4 (tab-trap detection looks only at inline `<script>` bodies), whether the input is a file path or a raw HTML string. |
| Shadow DOM, `<iframe>` contents, `<canvas>`-drawn UI, ARIA roles beyond the interactive set above, colour contrast, screen-reader label quality | A full WCAG audit is a different, much larger problem. This stays keyboard-navigation-only, as named. |
| Check 4 confirming an actual trap, rather than a suspicious pattern | Heuristic over source text, not an AST or execution trace. False positives are possible on unusual but harmless code; the report says so in the message itself. |

## Install

No dependencies — pure Node (`fs`, `path`) for the CLI; the engine itself
uses nothing beyond the language.

```bash
cd solution
npm install   # no-op; here for convention
```

## Use the CLI

```bash
node bin/kbnav.js page.html              # human-readable report
node bin/kbnav.js page.html --json       # machine-readable report
node bin/kbnav.js --help
```

Exit codes: `0` no issues, `1` one or more issues found (useful in CI), `2`
usage or read error.

## Use as a library

```js
const { auditHtml } = require('./src/auditor');

const { tabOrder, issues } = auditHtml(htmlString);
// tabOrder: [{ selector: 'button.submit', line: 42 }, ...]
// issues:   [{ rule, severity, line, selector, message, ... }, ...]
```

## Use the browser UI

Open `index.html` directly — double-click it, or `file://` it from any
browser. No build step, no server: the engine files (`src/htmlParse.js`,
`src/cssParse.js`, `src/auditor.js`) are loaded as plain `<script>` tags
before `src/app.js`, and detect at load time whether they're running under
Node (`require`/`module.exports`) or in a browser (plain globals), so the
exact same code backs the CLI, the library and the UI. Paste or drop an
`.html` file; the report updates as you type.

## How it was tested

`npm test` (= `node --test`) runs 107 cases across five files:

- `tests/htmlParse.test.js` (15) — the tolerant HTML tokenizer: attributes
  (quoted/unquoted/boolean), void elements, self-closing syntax, comments,
  `<script>`/`<style>` raw-text capture, mismatched/unclosed tags, line
  numbers, and size/depth caps.
- `tests/cssParse.test.js` (20) — selector-list splitting, `!important`
  stripping, comment handling (including *inside* a declaration block —
  a real bug this test found before it was fixed), `@media`/`@supports`
  recursion with line numbers preserved, `@keyframes`/`@font-face`/`@import`
  correctly skipped rather than misread as selectors, and malformed input.
- `tests/auditor.test.js` (33) — all four checks against both the
  flag-this and don't-flag-this side of every rule: disabled/inert/
  `aria-hidden` elements, malformed tabindex values, the `:focus-visible`
  escape hatch, `@media`-nested focus rules, external (`src=`) scripts
  correctly left unscanned, both the `keyCode === 9` and `9 === which`
  spellings of the Tab-trap heuristic, and a `transparent` outline colour or
  compensating property (shorthand or longhand) correctly treated as
  invisible rather than as a real focus indicator.
- `tests/cli.test.js` (11) — the CLI as a real subprocess: exit codes,
  `--json`, a missing file, no arguments, `--help`, a directory given
  instead of a file, and that piping into `head` doesn't crash with EPIPE.
- `tests/hostile.test.js` (28) — the full adversarial battery (empty/huge
  input, type confusion, unicode/homoglyphs/null bytes, script/SQL/template/
  path-traversal injection shapes as inert data) plus explicit performance
  checks that **found two real bugs**, not hypothetical ones:
  - A quadratic (`O(n^2)`) blowup in both `htmlParse.js` and `cssParse.js`:
    each parsed node/rule recomputed its line number by rescanning from
    character 0 of the whole document every time, and the tag matcher
    re-sliced a fresh copy of "everything after this position" per tag. A
    ~950KB/50,000-tag document went from **~13s to ~0.2s** after switching
    to a single forward-moving line cursor and sticky (`y`) regexes.
  - A denial-of-service-shaped bug in the Tab-trap heuristic: a script
    containing many thousands of `keydown`-looking substrings with no
    actual handler brace anywhere took **81.7 seconds** before the fix
    (an unbounded scan for "the next `{`" repeated at every occurrence).
    Fixed by bounding both that search and the brace-depth body scan to
    small constants; the same adversarial input now finishes in well under
    a second.

All 107 tests run in about 1 second total, with no network access, no
external binary, and no manual setup.

## Known gaps

- **No live-browser verification of the UI this weekend.** `python3 -m
  http.server` fails with a sandbox `PermissionError` on binding a port in
  the build environment used for this project (confirmed, not assumed —
  same wall hit by two other projects built the same weekend). Verified
  instead: `node --check` on every JS file, every `getElementById` id in
  `src/app.js` cross-checked against `index.html` (5/5 match), every CSS
  class referenced in `app.js` cross-checked against `styles.css`, and
  contrast ratios for every text/background colour pair computed
  programmatically (all ≥ 4.59:1 in both light and dark).
- **Check 4 (Tab-trap) is a heuristic, not a guarantee.** It can miss a trap
  built from an external script file loaded over a path this tool wasn't
  given, or one assembled dynamically at runtime (e.g. `addEventListener`
  called through a variable rather than written literally). It can also,
  rarely, flag a handler that happens to match the pattern but is actually
  harmless. The report message says this explicitly every time the rule
  fires.
- **No real browser ever runs the input.** A page that looks clean to every
  check here can still behave badly at runtime in ways only a live browser
  would show (for example, JavaScript that adds a problematic `tabindex` or
  CSS rule after the page loads). This tool audits the markup as written,
  not the DOM as it might end up.
