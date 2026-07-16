let recording = false;
let lastActionAt = Date.now();
let lastEnterAt = 0;
let pickerCleanup = null;
const pendingInputs = new Map();

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

function elementLocator(element) {
  return {
    selector: uniqueSelector(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    testId: element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy') || undefined,
    name: element.getAttribute('name') || undefined,
    role: element.getAttribute('role') || undefined,
    ariaLabel: element.getAttribute('aria-label') || undefined,
    href: element instanceof HTMLAnchorElement ? element.href : undefined,
    text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300),
  };
}

function sendRecordedAction(type, element, extra = {}) {
  if (!recording || !element) return Promise.resolve({ ok: false });
  const now = Date.now();
  const action = {
    id: `ACT-${crypto.randomUUID()}`,
    type,
    selector: uniqueSelector(element),
    locator: elementLocator(element),
    timestamp: now,
    delayMs: now - lastActionAt,
    tagName: element.tagName.toLowerCase(),
    text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().slice(0, 300),
    href: element.href || undefined,
    startUrl: location.href,
    frameUrl: location.href,
    pageUrl: location.href,
    ...extra,
  };
  lastActionAt = now;
  return chrome.runtime.sendMessage({ type: 'RECORDED_ACTION', action }).catch(() => ({ ok: false }));
}

function isTextEntry(element) {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'color', 'date', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type);
}

function flushPendingInput(element) {
  const pending = pendingInputs.get(element);
  if (!pending) return Promise.resolve();
  clearTimeout(pending.timer);
  pendingInputs.delete(element);
  return sendRecordedAction('input', element, {
    value: element.value.slice(0, 2000),
    inputType: pending.inputType,
    startUrl: pending.startUrl,
    frameUrl: pending.frameUrl,
    pageUrl: pending.startUrl,
    source: 'debounced-final-value',
  });
}

function flushAllPendingInputs() {
  return Promise.all(Array.from(pendingInputs.keys()).map(flushPendingInput));
}

function scheduleInput(element, inputType = '') {
  const existing = pendingInputs.get(element);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => flushPendingInput(element), 650);
  pendingInputs.set(element, {
    timer,
    inputType,
    startUrl: existing?.startUrl || location.href,
    frameUrl: existing?.frameUrl || location.href,
  });
}

document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  const element = actionableTarget(target) || target;
  if (element) sendRecordedAction('click', element, {
    clientX: event.clientX,
    clientY: event.clientY,
    pageX: event.pageX,
    pageY: event.pageY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
}, true);

let scrollTimer = null;
window.addEventListener('scroll', () => {
  if (!recording) return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const element = document.scrollingElement || document.documentElement;
    sendRecordedAction('scroll', element, { scrollX: window.scrollX, scrollY: window.scrollY });
  }, 180);
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
  if (isTextEntry(element)) {
    if (element instanceof HTMLTextAreaElement || event.key !== 'Enter') return;
    lastEnterAt = Date.now();
    flushPendingInput(element);
    sendRecordedAction('keypress', element, {
      key: 'Enter', code: event.code.slice(0, 80),
      altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
    });
    return;
  }
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
  if (!isTextEntry(element)) return;
  scheduleInput(element, event.inputType || '');
}, true);

document.addEventListener('blur', event => {
  if (isTextEntry(event.target)) flushPendingInput(event.target);
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
  const rect = element.getBoundingClientRect();
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
    rect: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      pageX: rect.left + window.scrollX,
      pageY: rect.top + window.scrollY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight,
    },
  };
}

function setSimulationFrame({ visible = true, width, height, label } = {}) {
  let frame = document.getElementById('nw-simulation-frame');
  if (!frame) {
    frame = document.createElement('div');
    frame.id = 'nw-simulation-frame';
    frame.setAttribute('aria-hidden', 'true');
    const frameLabel = document.createElement('div');
    frameLabel.id = 'nw-simulation-label';
    frame.appendChild(frameLabel);
    document.documentElement.appendChild(frame);
  }
  frame.hidden = !visible;
  const frameLabel = frame.querySelector('#nw-simulation-label');
  if (frameLabel && width && height) frameLabel.textContent = `${width} × ${height} · ${label || 'Responsive preview'}`;
}

function clearSimulationFrame() {
  document.getElementById('nw-simulation-frame')?.remove();
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
  document.documentElement.classList.add('nw-element-picker-active');
  let hovered = null;

  const move = event => {
    const candidate = event.target instanceof Element ? event.target : null;
    if (!candidate || candidate === overlay || candidate.closest('#nw-simulation-frame')) return;
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
    overlay.style.display = 'none';
  };

  const cancel = event => {
    if (event.key === 'Escape') pickerCleanup();
  };

  pickerCleanup = () => {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', select, true);
    document.removeEventListener('keydown', cancel, true);
    overlay.remove();
    document.documentElement.classList.remove('nw-element-picker-active');
    pickerCleanup = null;
  };
  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', select, true);
  document.addEventListener('keydown', cancel, true);
}

async function applyInputAction(element, action) {
  element.focus();
  if (typeof action.checked === 'boolean' && 'checked' in element) element.checked = action.checked;
  const prototype = element instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLSelectElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  const previousValue = element.value;
  const nextValue = action.value || '';
  if (valueSetter) valueSetter.call(element, nextValue);
  else element.value = nextValue;
  if (element._valueTracker) element._valueTracker.setValue(previousValue);
  const inputEvent = typeof InputEvent === 'function'
    ? new InputEvent('input', { bubbles: true, composed: true, inputType: action.inputType || 'insertText', data: null })
    : new Event('input', { bubbles: true, composed: true });
  element.dispatchEvent(inputEvent);
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (element.value !== nextValue) {
    if (valueSetter) valueSetter.call(element, nextValue);
    else element.value = nextValue;
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  if (element.value !== nextValue) return { ok: false, error: `Input value was rejected by the page for ${action.selector}.` };
  return { ok: true, appliedValue: nextValue };
}

function findReplayElement(action) {
  try {
    const selected = document.querySelector(action.selector);
    if (selected) return { element: selected, method: 'css-selector' };
  } catch { /* Try the recorded locator bundle. */ }

  const locator = action.locator || {};
  const candidates = Array.from(document.querySelectorAll(locator.tagName || action.tagName || '*'));
  const exactMatches = [
    ['id', locator.id],
    ['data-testid', locator.testId],
    ['data-test', locator.testId],
    ['data-cy', locator.testId],
    ['name', locator.name],
    ['aria-label', locator.ariaLabel],
    ['role', locator.role],
  ];
  for (const [attribute, value] of exactMatches) {
    if (!value) continue;
    const match = candidates.find(candidate => candidate.getAttribute(attribute) === value);
    if (match) return { element: match, method: `attribute:${attribute}` };
  }
  if (locator.href) {
    const match = candidates.find(candidate => candidate instanceof HTMLAnchorElement && candidate.href === locator.href);
    if (match) return { element: match, method: 'href' };
  }
  const expectedText = (locator.text || action.text || '').trim().replace(/\s+/g, ' ');
  if (expectedText) {
    const match = candidates.find(candidate => (candidate.innerText || candidate.textContent || '').trim().replace(/\s+/g, ' ') === expectedText);
    if (match) return { element: match, method: 'exact-text' };
  }
  return { element: null, method: '' };
}

async function resolveReplayTarget(action) {
  let { element, method } = findReplayElement(action);
  let x;
  let y;
  if (!element && Number.isFinite(action.clientX) && Number.isFinite(action.clientY)) {
    x = action.viewportWidth ? action.clientX * window.innerWidth / action.viewportWidth : action.clientX;
    y = action.viewportHeight ? action.clientY * window.innerHeight / action.viewportHeight : action.clientY;
    element = document.elementFromPoint(x, y);
    method = 'recorded-coordinates';
  }
  if (!element) return { ok: false, error: `Element not found and no coordinate fallback was available: ${action.selector}` };
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  await new Promise(resolve => requestAnimationFrame(resolve));
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: `The replay target is not visible: ${action.selector}` };
  return { ok: true, x, y, selector: uniqueSelector(element), resolutionMethod: method };
}

function replayAction(action) {
  let { element, method: resolutionMethod } = findReplayElement(action);
  if (action.type === 'scroll') {
    window.scrollTo({ left: action.scrollX || 0, top: action.scrollY || 0, behavior: 'instant' });
    return { ok: true, fallback: 'coordinates' };
  }
  if (!element && Number.isFinite(action.clientX) && Number.isFinite(action.clientY)) {
    const x = action.viewportWidth ? action.clientX * window.innerWidth / action.viewportWidth : action.clientX;
    const y = action.viewportHeight ? action.clientY * window.innerHeight / action.viewportHeight : action.clientY;
    element = document.elementFromPoint(x, y);
  }
  if (!element) return { ok: false, error: `Element not found and no coordinate fallback was available: ${action.selector}` };
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
    return applyInputAction(element, action);
  }
  return { ok: true, resolutionMethod };
}

function showReplayProgress(progress) {
  const currentEntry = progress.entries.find(entry => entry.index === progress.currentIndex);
  if (currentEntry?.status === 'failed') console.warn(`[Website Analytics] Replay action ${currentEntry.index + 1} failed: ${currentEntry.detail || currentEntry.label}`);
  else if (currentEntry?.status === 'success') console.info(`[Website Analytics] Replay action ${currentEntry.index + 1} succeeded: ${currentEntry.label}`);
  let host = document.getElementById('nw-replay-progress-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'nw-replay-progress-host';
    Object.assign(host.style, {
      all: 'initial', position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
      width: 'min(440px, calc(100vw - 36px))', pointerEvents: 'auto', colorScheme: 'dark',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; }
      .panel { overflow: hidden; border: 1px solid #34415a; border-radius: 12px; background: #111722; color: #f4f7ff; box-shadow: 0 18px 55px rgba(0,0,0,.55); font: 13px/1.4 system-ui, sans-serif; }
      .heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 13px 9px; }
      .heading strong { display: block; font-size: 14px; }
      .heading small, .summary { color: #9aa9c0; }
      .close { border: 0; padding: 0 3px; background: transparent; color: #9aa9c0; cursor: pointer; font: 22px/1 system-ui, sans-serif; }
      .status { padding: 0 13px 10px; color: #dce8fb; font-weight: 650; }
      .bar { height: 4px; background: #263147; }
      .bar > span { display: block; height: 100%; background: #5aa7ff; transition: width .2s ease; }
      .summary { display: flex; gap: 12px; padding: 9px 13px; border-bottom: 1px solid #28334a; font-size: 11px; }
      .summary .good { color: #42d392; } .summary .bad { color: #ff738d; }
      .actions { display: grid; gap: 1px; max-height: 280px; overflow: auto; background: #202a3c; }
      .action { display: grid; grid-template-columns: 22px minmax(0,1fr); gap: 8px; padding: 8px 11px; background: #111722; }
      .action.current { background: #172238; }
      .icon { font-weight: 900; text-align: center; }
      .running .icon { color: #5aa7ff; } .success .icon { color: #42d392; } .failed .icon { color: #ff738d; }
      .label { overflow: hidden; color: #e8eef9; text-overflow: ellipsis; white-space: nowrap; }
      .detail { margin-top: 2px; color: #9aa9c0; font-size: 11px; overflow-wrap: anywhere; }
      .failed .detail { color: #ff9caf; }
      .complete .bar > span { background: #42d392; } .has-failures .bar > span, .failed-phase .bar > span { background: #e6a23c; }
    `;
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = '<div class="heading"><div><strong>Website replay</strong><small class="ids"></small></div><button class="close" type="button" aria-label="Close replay progress">×</button></div><div class="status"></div><div class="bar"><span></span></div><div class="summary"></div><div class="actions"></div>';
    panel.querySelector('.close').addEventListener('click', () => host.remove());
    shadow.append(style, panel);
    document.documentElement.appendChild(host);
  }

  const panel = host.shadowRoot.querySelector('.panel');
  const completed = progress.successfulActions + progress.failedActions;
  const percent = progress.totalActions ? Math.min(100, completed / progress.totalActions * 100) : 0;
  panel.className = `panel ${progress.phase === 'complete' ? 'complete' : ''} ${progress.failedActions ? 'has-failures' : ''} ${progress.phase === 'failed' ? 'failed-phase' : ''}`;
  panel.querySelector('.ids').textContent = `${progress.replayId} · source ${progress.sourceRecordingId}`;
  panel.querySelector('.status').textContent = progress.message || 'Replay in progress';
  panel.querySelector('.bar > span').style.width = `${percent}%`;
  panel.querySelector('.summary').innerHTML = `<span>${completed}/${progress.totalActions} completed</span><span class="good">${progress.successfulActions} succeeded</span><span class="bad">${progress.failedActions} failed</span>`;
  const actions = panel.querySelector('.actions');
  actions.replaceChildren(...progress.entries.map(entry => {
    const row = document.createElement('div');
    row.className = `action ${entry.status} ${entry.index === progress.currentIndex ? 'current' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = entry.status === 'success' ? '✓' : entry.status === 'failed' ? '!' : '●';
    const copy = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = `${entry.index + 1}. ${entry.label}`;
    copy.appendChild(label);
    if (entry.detail) {
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = entry.detail;
      copy.appendChild(detail);
    }
    row.append(icon, copy);
    return row;
  }));
  if (actions.lastElementChild) actions.lastElementChild.scrollIntoView({ block: 'nearest' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SET_RECORDING') {
    const nextRecording = Boolean(message.recording);
    if (recording && !nextRecording) {
      flushAllPendingInputs().finally(() => {
        recording = false;
        lastActionAt = Date.now();
        sendResponse({ ok: true });
      });
      return true;
    }
    recording = nextRecording;
    if (recording) pendingInputs.clear();
    lastActionAt = Date.now();
    sendResponse({ ok: true });
  } else if (message.type === 'REPLAY_ACTION') {
    Promise.resolve(replayAction(message.action)).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  } else if (message.type === 'RESOLVE_REPLAY_TARGET') {
    resolveReplayTarget(message.action).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  } else if (message.type === 'REFRESH_SELECTED_ELEMENTS') {
    const elements = (message.selectors || []).map(selector => {
      try {
        const element = document.querySelector(selector);
        return element ? elementMetadata(element) : null;
      } catch { return null; }
    }).filter(Boolean);
    sendResponse({ ok: true, elements });
  } else if (message.type === 'SHOW_REPLAY_PROGRESS') {
    showReplayProgress(message);
    sendResponse({ ok: true });
  } else if (message.type === 'START_PICKER') {
    startPicker();
    sendResponse({ ok: true });
  } else if (message.type === 'STOP_PICKER') {
    if (pickerCleanup) pickerCleanup();
    sendResponse({ ok: true });
  } else if (message.type === 'SET_SIMULATION_FRAME') {
    setSimulationFrame(message);
    sendResponse({ ok: true });
  } else if (message.type === 'CLEAR_SIMULATION_FRAME') {
    clearSimulationFrame();
    sendResponse({ ok: true });
  }
  return false;
});

chrome.runtime.sendMessage({ type: 'CONTENT_READY' })
  .then(response => { recording = Boolean(response?.recording); lastActionAt = Date.now(); })
  .catch(() => {});
