let recording = false;
let lastActionAt = Date.now();
let lastEnterAt = 0;
let pickerCleanup = null;

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);
}

function uniqueSelector(element) {
  if (!(element instanceof Element)) return '';
  if (element.id) return `#${cssEscape(element.id)}`;

  for (const attribute of ['data-testid', 'data-test', 'data-cy', 'name']) {
    const value = element.getAttribute(attribute);
    if (value) {
      const candidate = `${element.tagName.toLowerCase()}[${attribute}="${cssEscape(value)}"]`;
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch { /* Try a structural selector. */ }
    }
  }

  const parts = [];
  let current = element;
  while (current && current !== document.documentElement && parts.length < 7) {
    let part = current.tagName.toLowerCase();
    const classes = Array.from(current.classList).filter(Boolean).slice(0, 2);
    if (classes.length) part += classes.map(className => `.${cssEscape(className)}`).join('');
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(child => child.tagName === current.tagName) : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    const candidate = parts.join(' > ');
    try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch { /* Keep walking. */ }
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function actionableTarget(target) {
  return target instanceof Element
    ? target.closest('a, button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]')
    : null;
}

function sendRecordedAction(type, element, extra = {}) {
  if (!recording || !element) return Promise.resolve({ ok: false });
  const now = Date.now();
  const action = {
    id: `ACT-${crypto.randomUUID()}`,
    type,
    selector: uniqueSelector(element),
    timestamp: now,
    delayMs: now - lastActionAt,
    tagName: element.tagName.toLowerCase(),
    text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().slice(0, 300),
    href: element.href || undefined,
    pageUrl: location.href,
    ...extra,
  };
  lastActionAt = now;
  return chrome.runtime.sendMessage({ type: 'RECORDED_ACTION', action }).catch(() => ({ ok: false }));
}

document.addEventListener('click', event => {
  const element = actionableTarget(event.target);
  if (element) sendRecordedAction('click', element);
}, true);

document.addEventListener('change', event => {
  const element = event.target;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return;
  if (element instanceof HTMLInputElement && element.type === 'password') return;
  if (element instanceof HTMLInputElement && !['checkbox', 'radio', 'color', 'date', 'range'].includes(element.type)) return;
  if (element instanceof HTMLTextAreaElement) return;
  sendRecordedAction('change', element, { value: element.value.slice(0, 2000), checked: 'checked' in element ? element.checked : undefined });
}, true);

document.addEventListener('keydown', event => {
  const element = actionableTarget(event.target);
  if (!element || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  if (element instanceof HTMLInputElement && element.type === 'password') return;
  if (event.key === 'Enter') lastEnterAt = Date.now();
  sendRecordedAction('keypress', element, {
    key: event.key.slice(0, 80),
    code: event.code.slice(0, 80),
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  });
}, true);

document.addEventListener('submit', event => {
  if (!recording || Date.now() - lastEnterAt > 1000) return;
  const element = event.submitter instanceof Element
    ? event.submitter
    : document.activeElement instanceof Element
      ? document.activeElement
      : event.target;
  if (!(element instanceof Element)) return;
  sendRecordedAction('keypress', element, {
    key: 'Enter',
    code: 'Enter',
    source: 'form-submit-fallback',
  });
}, true);

document.addEventListener('input', event => {
  const element = event.target;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
  if (element instanceof HTMLInputElement && element.type === 'password') return;
  sendRecordedAction('input', element, {
    value: element.value.slice(0, 2000),
    inputType: event.inputType || '',
    data: typeof event.data === 'string' ? event.data.slice(0, 100) : null,
  });
}, true);

function matchingCssRules(element) {
  const matches = [];
  const visit = rules => {
    for (const rule of Array.from(rules || [])) {
      if (matches.length >= 40) return;
      if (rule instanceof CSSStyleRule) {
        try {
          if (element.matches(rule.selectorText)) matches.push(rule.cssText.slice(0, 4000));
        } catch { /* Ignore unsupported selectors. */ }
      } else if (rule.cssRules) {
        visit(rule.cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { visit(sheet.cssRules); } catch { /* Cross-origin stylesheet. */ }
    if (matches.length >= 40) break;
  }
  return matches;
}

function elementMetadata(element) {
  const computed = getComputedStyle(element);
  const styleNames = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    'margin', 'padding', 'gap', 'flex', 'flex-direction', 'align-items', 'justify-content',
    'grid-template-columns', 'overflow', 'font-size', 'line-height', 'color',
    'background-color', 'border', 'border-radius', 'opacity', 'visibility', 'transform',
  ];
  return {
    selector: uniqueSelector(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classList: Array.from(element.classList).slice(0, 30),
    text: (element.innerText || '').trim().slice(0, 1000),
    html: element.outerHTML.slice(0, 12000),
    cssRules: matchingCssRules(element),
    computedStyles: Object.fromEntries(styleNames.map(name => [name, computed.getPropertyValue(name)]).filter(([, value]) => value)),
  };
}

function startPicker() {
  if (pickerCleanup) pickerCleanup();
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    border: '2px solid #5aa7ff', background: 'rgba(90, 167, 255, .18)',
    boxSizing: 'border-box', display: 'none',
  });
  document.documentElement.appendChild(overlay);
  let hovered = null;

  const move = event => {
    const candidate = event.target instanceof Element ? event.target : null;
    if (!candidate || candidate === overlay) return;
    hovered = candidate;
    const rect = candidate.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  };

  const select = event => {
    if (!hovered) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', element: elementMetadata(hovered) }).catch(() => {});
    pickerCleanup();
  };

  const cancel = event => {
    if (event.key === 'Escape') pickerCleanup();
  };

  pickerCleanup = () => {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', select, true);
    document.removeEventListener('keydown', cancel, true);
    overlay.remove();
    pickerCleanup = null;
  };
  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', select, true);
  document.addEventListener('keydown', cancel, true);
}

function replayAction(action) {
  let element;
  try { element = document.querySelector(action.selector); } catch { return { ok: false, error: `Invalid selector: ${action.selector}` }; }
  if (!element) return { ok: false, error: `Element not found: ${action.selector}` };
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  if (action.type === 'click') {
    element.click();
  } else if (action.type === 'keypress') {
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key: action.key || '', code: action.code || '', bubbles: true,
      altKey: action.altKey, ctrlKey: action.ctrlKey, metaKey: action.metaKey, shiftKey: action.shiftKey,
    }));
    element.dispatchEvent(new KeyboardEvent('keyup', {
      key: action.key || '', code: action.code || '', bubbles: true,
      altKey: action.altKey, ctrlKey: action.ctrlKey, metaKey: action.metaKey, shiftKey: action.shiftKey,
    }));
    if (action.key === 'Enter' && element.form) element.form.requestSubmit();
  } else if ('value' in element) {
    if (typeof action.checked === 'boolean' && 'checked' in element) element.checked = action.checked;
    const prototype = element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (valueSetter) valueSetter.call(element, action.value || '');
    else element.value = action.value || '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SET_RECORDING') {
    recording = Boolean(message.recording);
    lastActionAt = Date.now();
    sendResponse({ ok: true });
  } else if (message.type === 'REPLAY_ACTION') {
    sendResponse(replayAction(message.action));
  } else if (message.type === 'START_PICKER') {
    startPicker();
    sendResponse({ ok: true });
  } else if (message.type === 'STOP_PICKER') {
    if (pickerCleanup) pickerCleanup();
    sendResponse({ ok: true });
  }
  return false;
});

chrome.runtime.sendMessage({ type: 'CONTENT_READY' })
  .then(response => { recording = Boolean(response?.recording); lastActionAt = Date.now(); })
  .catch(() => {});
