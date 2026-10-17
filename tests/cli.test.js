const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { main } = require('../bin/kbnav.js');

const BIN = path.join(__dirname, '..', 'bin', 'kbnav.js');

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
}

// Calls main() in-process (bypassing require.main === module, same as any
// programmatic caller of the exported `main`) so stdout/stderr can be
// captured without the cost of spawning a child process for every case.
function runInProcess(args) {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk) => { stdout += chunk; return true; };
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    const status = main(['node', 'kbnav.js', ...args]);
    return { status, stdout, stderr };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

function withTempFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbnav-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, content);
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('clean page: exit 0, reports no issues', () => {
  withTempFile('<button>One</button>', (file) => {
    const r = run([file]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no keyboard-navigation issues found/);
  });
});

test('page with issues: exit 1, prints each issue', () => {
  withTempFile('<div onclick="go()">x</div>', (file) => {
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /unreachable-interactive/);
  });
});

test('--json emits valid, parseable JSON with tabOrder and issues', () => {
  withTempFile('<div onclick="go()">x</div>', (file) => {
    const r = run([file, '--json']);
    assert.equal(r.status, 1);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.issues));
    assert.ok(Array.isArray(parsed.tabOrder));
  });
});

test('missing file: exit 2, clear message, no stack trace', () => {
  const r = run(['/nonexistent/path/does-not-exist.html']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /could not read/);
  assert.doesNotMatch(r.stderr, /at Object\.<anonymous>/);
});

test('no arguments: exit 2, prints usage', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /Usage:/);
});

test('--help: exit 0, prints usage', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});

test('a directory given instead of a file: exit 2, no stack trace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbnav-dir-'));
  try {
    const r = run([dir]);
    assert.equal(r.status, 2);
    assert.doesNotMatch(r.stderr, /at Object\.<anonymous>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flags given but no file argument: exit 2, "no input file given"', () => {
  const r = runInProcess(['--json']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no input file given/);
  assert.match(r.stderr, /Usage:/);
});

test('oversized input: auditHtml throws, caught and reported as exit 2', () => {
  withTempFile('<div>'.repeat(2_000_000), (file) => {
    const r = runInProcess([file]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /could not analyze/);
    assert.doesNotMatch(r.stderr, /at Object\.<anonymous>/);
  });
});

test('diverging tab order (non-JSON): prints DOM order and Tab order lines', () => {
  withTempFile('<button tabindex="2">A</button><a href="#" tabindex="1">B</a>', (file) => {
    const r = runInProcess([file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /tab-order-diverges/);
    assert.match(r.stdout, /DOM order:/);
    assert.match(r.stdout, /Tab order:/);
  });
});

test('piping to a closed stdout (e.g. `| head`) does not crash with EPIPE', () => {
  withTempFile('<button>One</button><a href="#">Two</a>'.repeat(5000), (file) => {
    const r = spawnSync('/bin/sh', ['-c', `${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} ${JSON.stringify(file)} --json | head -c 10`], { encoding: 'utf8' });
    assert.equal(r.status, 0);
  });
});
