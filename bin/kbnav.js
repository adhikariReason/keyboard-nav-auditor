#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { auditHtml } = require('../src/auditor.js');

const HELP = `kbnav — static keyboard-navigation auditor

Usage:
  kbnav <file.html> [--json]
  kbnav --help

Checks performed (all static, no browser, no network):
  - keyboard-unreachable interactive controls
  - tab order diverging from DOM order, and fragile positive tabindex
  - focus indicator suppressed with no replacement
  - a heuristic for Tab-key-trapping script handlers

Exit codes:
  0  no issues found
  1  one or more issues found
  2  usage or read error
`;

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    process.stdout.write(HELP);
    return args.length === 0 ? 2 : 0;
  }

  const asJson = args.includes('--json');
  const file = args.find((a) => !a.startsWith('-'));
  if (!file) {
    process.stderr.write('kbnav: no input file given\n\n' + HELP);
    return 2;
  }

  let html;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch (err) {
    process.stderr.write(`kbnav: could not read ${file}: ${err.code || err.message}\n`);
    return 2;
  }

  let result;
  try {
    result = auditHtml(html);
  } catch (err) {
    process.stderr.write(`kbnav: could not analyze ${file}: ${err.message}\n`);
    return 2;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.issues.length ? 1 : 0;
  }

  const base = path.basename(file);
  if (result.issues.length === 0) {
    process.stdout.write(`${base}: no keyboard-navigation issues found (${result.tabOrder.length} focusable elements).\n`);
    return 0;
  }

  process.stdout.write(`${base}: ${result.issues.length} issue(s) found\n\n`);
  for (const issue of result.issues) {
    process.stdout.write(`[${issue.severity.toUpperCase()}] ${issue.rule} (line ${issue.line})\n`);
    process.stdout.write(`  ${issue.message}\n`);
    if (issue.domOrder) {
      process.stdout.write(`  DOM order:  ${issue.domOrder.join(' -> ')}\n`);
      process.stdout.write(`  Tab order:  ${issue.tabOrder.join(' -> ')}\n`);
    }
    process.stdout.write('\n');
  }
  return 1;
}

if (require.main === module) {
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
  process.exit(main(process.argv));
}

module.exports = { main };
