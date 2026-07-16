const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const contentScript = fs.readFileSync(path.join(__dirname, '..', 'apps', 'extension', 'content.js'), 'utf8');

function hierarchyPath(...nodes) {
  return nodes.map(([tagName, nthOfType = 1]) => ({ tagName, nthOfType }));
}

function createHarness(html) {
  const dom = new JSDOM(html, {
    url: 'https://example.test/journey',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const listeners = [];
  const messages = [];

  Object.defineProperty(window, 'crypto', { value: crypto.webcrypto });
  window.requestAnimationFrame = callback => setTimeout(callback, 0);
  window.Element.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const left = Number(this.getAttribute('data-left') || 0);
    const top = Number(this.getAttribute('data-top') || 0);
    const width = Number(this.getAttribute('data-width') || 120);
    const height = Number(this.getAttribute('data-height') || 32);
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) };
  };
  window.chrome = {
    runtime: {
      sendMessage: message => {
        messages.push(message);
        return Promise.resolve({ recording: false });
      },
      onMessage: { addListener: listener => listeners.push(listener) },
    },
  };
  window.eval(contentScript);

  async function replay(action) {
    const listener = listeners.find(candidate => candidate({ type: '__probe__' }, {}, () => {}) === false) || listeners[0];
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) reject(new Error('Replay response timed out'));
      }, 3000);
      listener({ type: 'REPLAY_ACTION', action }, {}, response => {
        settled = true;
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  return { window, document: window.document, messages, replay, close: () => dom.window.close() };
}

test('replay prioritizes a unique role and accessible name over a wrong hierarchy', async t => {
  const harness = createHarness('<button id="wrong">Cancel</button><button id="save">Save</button>');
  t.after(harness.close);
  let clicked = false;
  harness.document.querySelector('#save').addEventListener('click', () => { clicked = true; });

  const result = await harness.replay({
    type: 'click',
    selector: 'diagnostic-path',
    locator: {
      tagName: 'button', role: 'button', accessibleName: 'Save',
      hierarchyPath: hierarchyPath(['html'], ['body'], ['button', 1]),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolutionMethod, 'role-and-accessible-name');
  assert.equal(clicked, true);
});

test('replay uses sibling and parent context to disambiguate identical controls', async t => {
  const harness = createHarness(`
    <div><span>John Smith</span><button>Delete</button><button>Edit</button></div>
    <div><span>Jane Doe</span><button>Delete</button><button>Edit</button></div>
  `);
  t.after(harness.close);
  const deleted = [];
  harness.document.querySelectorAll('button').forEach(button => button.addEventListener('click', () => deleted.push(button.parentElement.textContent.trim())));

  const result = await harness.replay({
    type: 'click', selector: 'diagnostic-path',
    locator: {
      tagName: 'button', role: 'button', accessibleName: 'Delete', text: 'Delete',
      previousSiblingText: 'John Smith', nextSiblingText: 'Edit', parentText: 'John SmithDeleteEdit',
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.resolutionMethod, /^semantic-fingerprint:/);
  assert.deepEqual(deleted, ['John SmithDeleteEdit']);
});

test('replay falls back to the recorded HTML hierarchy', async t => {
  const harness = createHarness('<div><button>First</button><button id="target">Second</button></div>');
  t.after(harness.close);
  let clicked = false;
  harness.document.querySelector('#target').addEventListener('click', () => { clicked = true; });

  const result = await harness.replay({
    type: 'click', selector: 'diagnostic-path',
    locator: { tagName: 'button', hierarchyPath: hierarchyPath(['html'], ['body'], ['div'], ['button', 2]) },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolutionMethod, 'html-hierarchy-fallback');
  assert.equal(clicked, true);
});

test('replay falls back to XPath when semantic and hierarchy evidence fail', async t => {
  const harness = createHarness('<main><button id="target">Archive</button></main>');
  t.after(harness.close);
  let clicked = false;
  harness.document.querySelector('#target').addEventListener('click', () => { clicked = true; });

  const result = await harness.replay({
    type: 'click', selector: 'diagnostic-path',
    locator: {
      tagName: 'button', hierarchyPath: hierarchyPath(['html'], ['body'], ['button']),
      xpath: '/html[1]/body[1]/main[1]/button[1]',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolutionMethod, 'xpath-fallback');
  assert.equal(clicked, true);
});

test('replay resolves an element inside an open shadow root', async t => {
  const harness = createHarness('<checkout-widget></checkout-widget>');
  t.after(harness.close);
  const host = harness.document.querySelector('checkout-widget');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button id="target">Pay</button>';
  let clicked = false;
  shadow.querySelector('#target').addEventListener('click', () => { clicked = true; });

  const result = await harness.replay({
    type: 'click', selector: 'diagnostic-path',
    locator: {
      tagName: 'button',
      shadowPath: [
        hierarchyPath(['html'], ['body'], ['checkout-widget']),
        hierarchyPath(['button']),
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolutionMethod, 'shadow-hierarchy-fallback');
  assert.equal(clicked, true);
});

test('replay uses recorded coordinates only after every locator strategy fails', async t => {
  const harness = createHarness('<button id="target" data-left="10" data-top="10">Fallback</button>');
  t.after(harness.close);
  const target = harness.document.querySelector('#target');
  harness.document.elementFromPoint = () => target;
  let clicked = false;
  target.addEventListener('click', () => { clicked = true; });

  const result = await harness.replay({
    type: 'click', selector: 'missing', clientX: 20, clientY: 20, viewportWidth: 100, viewportHeight: 100,
    locator: { tagName: 'button', hierarchyPath: hierarchyPath(['html'], ['body'], ['button', 2]) },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolutionMethod, 'recorded-coordinates-fallback');
  assert.equal(clicked, true);
});

test('replay retries semantic resolution while a rerendered element appears', async t => {
  const harness = createHarness('<main></main>');
  t.after(harness.close);
  setTimeout(() => {
    const button = harness.document.createElement('button');
    button.textContent = 'Continue';
    button.addEventListener('click', () => { button.dataset.clicked = 'true'; });
    harness.document.querySelector('main').append(button);
  }, 160);

  const result = await harness.replay({
    type: 'click', selector: 'diagnostic-path',
    locator: { tagName: 'button', role: 'button', accessibleName: 'Continue' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolutionMethod, 'role-and-accessible-name');
  assert.equal(harness.document.querySelector('button').dataset.clicked, 'true');
});
