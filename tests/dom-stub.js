'use strict';

// Minimal hand-rolled DOM/BOM stub for exercising app.js's event wiring in
// Node, without jsdom (blocked: no network to fetch it) and without a live
// browser (blocked: this sandbox cannot bind a local port). Only the handful
// of Element/Document/FileReader APIs app.js actually calls are implemented.
// Modelled on voice-calculator's/gfm-previewer's tests/dom-stub.js, narrowed
// to this app's smaller surface: a textarea, two buttons, a status span, a
// report container built from createElement/createTextNode/appendChild, and
// drag-and-drop file loading via FileReader.

class StubTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.nodeValue = String(text);
    this.parentElement = null;
  }

  get textContent() {
    return this.nodeValue;
  }
}

class StubElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.id = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.parentElement = null;
    this.children = [];
    this._text = '';
    this._classes = new Set();
    this._listeners = {};
  }

  get classList() {
    const classes = this._classes;
    return {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (name) => classes.has(name),
    };
  }

  // Real Element.textContent reads as the concatenation of every descendant
  // text node, and a plain assignment (`status.textContent = '...'`, used
  // throughout app.js) replaces all children with a single text value --
  // both behaviours matter here, since app.js also builds nested content via
  // createTextNode/appendChild rather than ever setting textContent directly
  // on a node with children.
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(value) {
    this.children = [];
    this._text = String(value);
  }

  get firstChild() {
    return this.children[0] || null;
  }

  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  removeChild(node) {
    this.children = this.children.filter((c) => c !== node);
    node.parentElement = null;
    return node;
  }

  addEventListener(type, handler) {
    (this._listeners[type] ??= []).push(handler);
  }

  removeEventListener(type, handler) {
    this._listeners[type] = (this._listeners[type] || []).filter((h) => h !== handler);
  }

  // Not a real dispatchEvent (no capture/bubble) -- just invokes whatever
  // app.js registered directly on this element, which is all this app's
  // same-element, non-bubbling listener wiring actually needs.
  dispatch(type, extra = {}) {
    const event = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const handler of this._listeners[type] || []) handler(event);
    return event;
  }
}

/** A fake FileReader good enough to drive app.js's drop handler: readAsText
 *  resolves synchronously via a microtask, calling onload with `.result` set
 *  (or onerror, when the test asks for a failing read), the same contract a
 *  real FileReader's async callback fulfils. */
class StubFileReader {
  constructor() {
    this.result = null;
    this.onload = null;
    this.onerror = null;
  }

  readAsText(file) {
    queueMicrotask(() => {
      if (file && file._failRead) {
        this.onerror?.();
      } else {
        this.result = file ? String(file._content ?? '') : '';
        this.onload?.();
      }
    });
  }
}

/** A plain object good enough to stand in for a dropped File -- app.js never
 *  reads anything off it except via FileReader, so no real Blob/File API is
 *  needed. */
function stubFile(content, { failRead = false } = {}) {
  return { _content: content, _failRead: failRead };
}

/**
 * `ids` lists every id-addressed element app.js looks up via
 * `document.getElementById`. Returns the stub document plus the element map
 * and a couple of convenience helpers for driving drag-and-drop.
 */
function createStubDocument(ids) {
  const elements = {};
  for (const id of ids) {
    const el = new StubElement();
    el.id = id;
    elements[id] = el;
  }

  const document = {
    getElementById: (id) => {
      if (!(id in elements)) throw new Error(`stub document has no element #${id}`);
      return elements[id];
    },
    createElement: (tag) => new StubElement(tag),
    createTextNode: (text) => new StubTextNode(text),
  };

  return {
    document,
    elements,
    // Fires the drop handler with a real-shaped DataTransfer carrying one
    // file, exactly as app.js reads it: `e.dataTransfer.files[0]`.
    dropFile: (file) => elements['html-input'].dispatch('drop', { dataTransfer: { files: [file] } }),
  };
}

module.exports = { StubElement, StubTextNode, StubFileReader, stubFile, createStubDocument };
