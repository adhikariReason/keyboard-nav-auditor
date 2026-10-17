(function () {
  'use strict';

  var input = document.getElementById('html-input');
  var status = document.getElementById('status');
  var report = document.getElementById('report');
  var sampleBtn = document.getElementById('sample-btn');
  var clearBtn = document.getElementById('clear-btn');

  var MAX_CHARS = 2000000;
  var DEBOUNCE_MS = 150;

  var SAMPLE = [
    '<style>',
    '  .card:focus { outline: none; }',
    '</style>',
    '<div onclick="doStuff()">Click me (a mouse-only control)</div>',
    '<button tabindex="3">Out of DOM order</button>',
    '<button class="card" tabindex="0">Focus ring suppressed here</button>',
    '<button>Normal, reachable control</button>',
  ].join('\n');

  // Every dynamic value below goes in through textContent/createTextNode,
  // never innerHTML — a selector built from attacker-controlled markup
  // (e.g. class="x<img onerror=...>") must render as inert text, not HTML.
  function el(tag, className, textParts) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    (textParts || []).forEach(function (part) {
      node.appendChild(document.createTextNode(part));
    });
    return node;
  }

  function renderIssue(issue) {
    var card = el('div', 'issue issue--' + issue.severity);
    var meta = el('div', 'issue__meta-row');
    meta.appendChild(el('span', 'issue__badge', [issue.severity.toUpperCase()]));
    meta.appendChild(el('span', 'issue__meta', [issue.rule + ' · line ' + issue.line]));
    card.appendChild(meta);
    card.appendChild(el('p', 'issue__message', [issue.message]));
    if (issue.domOrder && issue.tabOrder) {
      card.appendChild(el('pre', 'issue__orders', [
        'DOM order:  ' + issue.domOrder.join(' -> ') + '\n' +
        'Tab order:  ' + issue.tabOrder.join(' -> '),
      ]));
    }
    return card;
  }

  function renderTabOrder(tabOrder) {
    var section = el('div', 'tab-order');
    section.appendChild(el('h3', 'tab-order__title', [
      'Computed tab order (' + tabOrder.length + ' focusable element' + (tabOrder.length === 1 ? '' : 's') + ')',
    ]));
    var list = el('ol', 'tab-order__list');
    var shown = tabOrder.slice(0, 200);
    shown.forEach(function (t) {
      list.appendChild(el('li', null, [t.selector + ' (line ' + t.line + ')']));
    });
    section.appendChild(list);
    if (tabOrder.length > shown.length) {
      section.appendChild(el('p', 'hint', ['(showing the first ' + shown.length + ' of ' + tabOrder.length + ')']));
    }
    return section;
  }

  function clearReport() {
    while (report.firstChild) report.removeChild(report.firstChild);
  }

  function renderReport(html) {
    clearReport();

    if (!html.trim()) {
      status.textContent = 'Paste HTML, or load the example, to begin.';
      report.appendChild(el('p', 'report__empty', ['Nothing to audit yet.']));
      return;
    }

    var result;
    try {
      result = auditHtml(html);
    } catch (err) {
      status.textContent = 'Could not analyze this input.';
      report.appendChild(el('p', 'report__empty', [String(err && err.message || err)]));
      return;
    }

    var issueCount = result.issues.length;
    status.textContent = issueCount
      ? issueCount + ' issue' + (issueCount === 1 ? '' : 's') + ' found'
      : 'No issues found';

    report.appendChild(el(
      'p',
      'report__summary' + (issueCount ? '' : ' report__summary--clean'),
      [issueCount ? issueCount + ' issue(s) found:' : 'No keyboard-navigation issues found.']
    ));

    result.issues.forEach(function (issue) {
      report.appendChild(renderIssue(issue));
    });

    report.appendChild(renderTabOrder(result.tabOrder));
  }

  var debounceTimer = null;
  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var html = input.value;
      if (html.length > MAX_CHARS) {
        html = html.slice(0, MAX_CHARS);
        input.value = html;
        status.textContent = 'Input truncated to ' + MAX_CHARS + ' characters.';
      }
      renderReport(html);
    }, DEBOUNCE_MS);
  }

  input.addEventListener('input', scheduleRender);

  sampleBtn.addEventListener('click', function () {
    input.value = SAMPLE;
    scheduleRender();
  });

  clearBtn.addEventListener('click', function () {
    input.value = '';
    scheduleRender();
  });

  input.addEventListener('dragover', function (e) {
    e.preventDefault();
    input.classList.add('is-dragover');
  });
  input.addEventListener('dragleave', function () {
    input.classList.remove('is-dragover');
  });
  input.addEventListener('drop', function (e) {
    e.preventDefault();
    input.classList.remove('is-dragover');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      input.value = String(reader.result || '');
      scheduleRender();
    };
    reader.onerror = function () {
      status.textContent = 'Could not read the dropped file.';
    };
    reader.readAsText(file);
  });

  renderReport(input.value);
})();
