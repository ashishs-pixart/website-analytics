let recording = false;
let lastActionAt = Date.now();
let lastEnterAt = 0;
let pickerCleanup = null;
const pendingInputs = new Map();

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);
}

function isStableId(value) {
  if (!value || /(?:undefined|null)/i.test(value)) return false;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value)) return false;
  if (value.length > 96 || /(?:^|[-_])[0-9a-f]{16,}(?:$|[-_])/i.test(value)) return false;
  return true;
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function canonicalText(value) {
  return normalizedText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function generatedIdTextHint(value) {
  const raw = String(value || '').replace(/^#/, '').replace(/\\/g, '');
  if (!raw || isStableId(raw)) return '';
  const withoutRuntimeParts = raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ' ')
    .replace(/(?:^|[-_])(undefined|null)(?=$|[-_])/gi, ' ')
    .replace(/(?:^|[-_])[0-9a-f]{16,}(?=$|[-_])/gi, ' ');
  const hint = canonicalText(withoutRuntimeParts);
  return hint.length >= 12 ? hint : '';
}

function candidateSemanticText(element) {
  return [
    element.getAttribute('placeholder'),
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('name'),
    elementLabel(element),
    accessibleName(element),
    element.innerText || element.textContent,
  ].map(canonicalText).filter(Boolean);
}

function elementLabel(element) {
  if (element.getAttribute('aria-labelledby')) {
    const text = element.getAttribute('aria-labelledby').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    if (normalizedText(text)) return normalizedText(text).slice(0, 300);
  }
  if ('labels' in element && element.labels?.length) {
    return normalizedText(Array.from(element.labels).map(label => label.textContent || '').join(' ')).slice(0, 300);
  }
  return normalizedText(element.closest('label')?.textContent).slice(0, 300);
}

function elementRole(element) {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === 'a' && element.hasAttribute('href')) return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'img') return 'img';
  if (tag === 'tr') return 'row';
  if (tag === 'td') return 'cell';
  if (tag === 'th') return 'columnheader';
  if (tag === 'input') {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'number') return 'spinbutton';
    if (type === 'search') return 'searchbox';
    if (!['hidden', 'color', 'date', 'file'].includes(type)) return 'textbox';
  }
  return '';
}

function eventElement(event) {
  return event.composedPath?.().find(node => node instanceof Element)
    || (event.target instanceof Element ? event.target : null);
}

function openRoots() {
  const roots = [document];
  for (let index = 0; index < roots.length; index += 1) {
    for (const element of roots[index].querySelectorAll('*')) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return roots;
}

function queryAllOpenRoots(selector = '*') {
  const matches = [];
  for (const root of openRoots()) {
    try { matches.push(...root.querySelectorAll(selector)); } catch { /* Ignore an invalid fallback selector. */ }
  }
  return matches;
}

function isVisibleElement(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function accessibleName(element) {
  const ariaLabel = normalizedText(element.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel.slice(0, 300);
  const label = elementLabel(element);
  if (label) return label;
  const alt = normalizedText(element.getAttribute('alt'));
  if (alt) return alt.slice(0, 300);
  if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type) && element.value) {
    return normalizedText(element.value).slice(0, 300);
  }
  return normalizedText(element.innerText || element.textContent).slice(0, 300);
}

function nearbyText(element) {
  return {
    previousSiblingText: normalizedText(element.previousElementSibling?.innerText || element.previousElementSibling?.textContent).slice(0, 300),
    nextSiblingText: normalizedText(element.nextElementSibling?.innerText || element.nextElementSibling?.textContent).slice(0, 300),
    parentText: normalizedText(element.parentElement?.innerText || element.parentElement?.textContent).slice(0, 500),
  };
}

function nearestLandmark(element) {
  const landmark = element.closest('main, nav, aside, header, footer, form, [role="main"], [role="navigation"], [role="complementary"], [role="banner"], [role="contentinfo"], [role="form"], [role="dialog"], [role="alertdialog"], [role="region"]');
  if (!landmark) return null;
  return {
    tagName: landmark.tagName.toLowerCase(),
    role: elementRole(landmark) || landmark.tagName.toLowerCase(),
    accessibleName: accessibleName(landmark),
  };
}

function nearestHeading(element) {
  const root = element.getRootNode();
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'));
  const preceding = headings.filter(heading => heading === element || Boolean(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
  const heading = preceding[preceding.length - 1] || null;
  return heading ? {
    text: normalizedText(heading.innerText || heading.textContent).slice(0, 300),
    level: Number(heading.getAttribute('aria-level')) || Number(heading.tagName.slice(1)) || null,
  } : null;
}

function formContext(element) {
  const form = 'form' in element && element.form ? element.form : element.closest('form');
  if (!form) return null;
  return {
    action: form.action || '',
    method: (form.method || 'get').toLowerCase(),
    name: form.getAttribute('name') || '',
    id: isStableId(form.id) ? form.id : '',
    accessibleName: accessibleName(form),
  };
}

function visualFingerprint(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    fontSize: style.fontSize,
    color: style.color,
    backgroundColor: style.backgroundColor,
    display: style.display,
  };
}

function roleIndex(element) {
  const role = elementRole(element);
  if (!role) return null;
  const peers = queryAllOpenRoots('*').filter(candidate => elementRole(candidate) === role && isVisibleElement(candidate));
  const index = peers.indexOf(element);
  return index >= 0 ? { role, index: index + 1, total: peers.length } : null;
}

function xpathForElement(element) {
  const parts = [];
  let current = element;
  while (current && current instanceof Element) {
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(child => child.tagName === current.tagName)
      : [current];
    parts.unshift(`${current.tagName.toLowerCase()}[${siblings.indexOf(current) + 1}]`);
    const root = current.getRootNode();
    if (!current.parentElement && root instanceof ShadowRoot) return '';
    if (current === document.documentElement) break;
    current = current.parentElement;
  }
  return `/${parts.join('/')}`;
}

function elementFromXPath(xpath) {
  if (!xpath) return null;
  try {
    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch {
    return null;
  }
}

function frameContext() {
  const chain = [{ url: location.href, isTop: window === window.top }];
  let currentWindow = window;
  try {
    while (currentWindow !== currentWindow.top && chain.length < 12) {
      const frame = currentWindow.frameElement;
      chain.unshift({
        url: currentWindow.parent.location.href,
        isTop: currentWindow.parent === currentWindow.top,
        frameName: frame?.getAttribute('name') || '',
        frameTitle: frame?.getAttribute('title') || '',
        hierarchyPath: frame ? hierarchyPath(frame) : [],
      });
      currentWindow = currentWindow.parent;
    }
  } catch { /* Cross-origin ancestors remain represented by the recorded frame URL and frameId. */ }
  return chain;
}

function ancestorSignature(element) {
  const parts = [];
  let current = element.parentElement;
  while (current && current !== document.documentElement && parts.length < 4) {
    const stableId = isStableId(current.id) ? `#${current.id}` : '';
    const testId = current.getAttribute('data-testid') || current.getAttribute('data-test') || current.getAttribute('data-cy');
    const classes = Array.from(current.classList).filter(Boolean).slice(0, 2).join('.');
    parts.push(`${current.tagName.toLowerCase()}${stableId}${testId ? `[test=${testId}]` : ''}${classes ? `.${classes}` : ''}`);
    current = current.parentElement;
  }
  return parts.join(' < ');
}

function domHierarchy(element) {
  const hierarchy = [];
  let current = element;
  while (current && current instanceof Element && hierarchy.length < 16) {
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(child => child.tagName === current.tagName)
      : [];
    hierarchy.push({
      tagName: current.tagName.toLowerCase(),
      id: isStableId(current.id) ? current.id : undefined,
      originalId: current.id || undefined,
      testId: current.getAttribute('data-testid') || current.getAttribute('data-test') || current.getAttribute('data-cy') || undefined,
      name: current.getAttribute('name') || undefined,
      role: elementRole(current) || undefined,
      ariaLabel: current.getAttribute('aria-label') || undefined,
      classList: Array.from(current.classList).filter(Boolean).slice(0, 8),
      nthOfType: siblings.length > 1 ? siblings.indexOf(current) + 1 : 1,
    });
    current = current.parentElement;
  }
  return hierarchy;
}

function hierarchyPath(element) {
  const path = [];
  let current = element;
  while (current && current instanceof Element) {
    const sameTagSiblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(child => child.tagName === current.tagName)
      : [current];
    path.unshift({ tagName: current.tagName.toLowerCase(), nthOfType: sameTagSiblings.indexOf(current) + 1 });
    if (current === document.documentElement) break;
    current = current.parentElement;
  }
  return path;
}

function hierarchyPathText(path) {
  return (path || []).map(node => `${node.tagName}:nth-of-type(${node.nthOfType})`).join(' > ');
}

function elementFromHierarchyPath(path) {
  if (!Array.isArray(path) || !path.length) return null;
  const [root, ...descendants] = path;
  let current = document.documentElement;
  if (!current || root.tagName !== current.tagName.toLowerCase() || root.nthOfType !== 1) return null;
  for (const node of descendants) {
    const matches = Array.from(current.children).filter(child => child.tagName.toLowerCase() === node.tagName);
    current = matches[node.nthOfType - 1];
    if (!current) return null;
  }
  return current;
}

function rootRelativePath(element, root) {
  const path = [];
  let current = element;
  while (current && current instanceof Element) {
    const parent = current.parentNode;
    const siblings = parent?.children
      ? Array.from(parent.children).filter(child => child.tagName === current.tagName)
      : [current];
    path.unshift({ tagName: current.tagName.toLowerCase(), nthOfType: siblings.indexOf(current) + 1 });
    if (parent === root) break;
    current = current.parentElement;
  }
  return path;
}

function shadowPathSegments(element) {
  const segments = [];
  let current = element;
  while (current) {
    const root = current.getRootNode();
    segments.unshift(rootRelativePath(current, root));
    if (!(root instanceof ShadowRoot)) break;
    current = root.host;
  }
  return segments;
}

function elementFromShadowPath(segments) {
  if (!Array.isArray(segments) || !segments.length) return null;
  let root = document;
  let resolved = null;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    for (const node of segments[segmentIndex]) {
      const matches = Array.from(root.children || []).filter(child => child.tagName.toLowerCase() === node.tagName);
      resolved = matches[node.nthOfType - 1];
      if (!resolved) return null;
      root = resolved;
    }
    if (segmentIndex < segments.length - 1) {
      if (!resolved?.shadowRoot) return null;
      root = resolved.shadowRoot;
    }
  }
  return resolved;
}

function uniqueSelector(element) {
  if (!(element instanceof Element)) return '';
  if (isStableId(element.id)) return `#${cssEscape(element.id)}`;

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
  const path = hierarchyPath(element);
  const siblingContext = nearbyText(element);
  const landmark = nearestLandmark(element);
  const heading = nearestHeading(element);
  const form = formContext(element);
  return {
    selector: hierarchyPathText(path),
    hierarchyPath: path,
    shadowPath: shadowPathSegments(element),
    tagName: element.tagName.toLowerCase(),
    id: isStableId(element.id) ? element.id : undefined,
    originalId: element.id || undefined,
    testId: element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy') || undefined,
    name: element.getAttribute('name') || undefined,
    role: elementRole(element) || undefined,
    accessibleName: accessibleName(element) || undefined,
    ariaLabel: element.getAttribute('aria-label') || undefined,
    placeholder: element.getAttribute('placeholder') || undefined,
    alt: element.getAttribute('alt') || undefined,
    title: element.getAttribute('title') || undefined,
    inputType: element.getAttribute('type') || undefined,
    autocomplete: element.getAttribute('autocomplete') || undefined,
    label: elementLabel(element) || undefined,
    classList: Array.from(element.classList).filter(Boolean).slice(0, 12),
    ancestorSignature: ancestorSignature(element),
    domHierarchy: domHierarchy(element),
    previousSiblingText: siblingContext.previousSiblingText,
    nextSiblingText: siblingContext.nextSiblingText,
    parentText: siblingContext.parentText,
    roleIndex: roleIndex(element),
    landmark,
    heading,
    form,
    visualFingerprint: visualFingerprint(element),
    xpath: xpathForElement(element),
    frameChain: frameContext(),
    semanticFingerprint: {
      role: elementRole(element) || undefined,
      name: accessibleName(element) || undefined,
      heading: heading?.text || undefined,
      form: form?.name || form?.accessibleName || form?.action || undefined,
      parent: siblingContext.parentText || undefined,
      landmark: landmark?.role || undefined,
    },
    href: element instanceof HTMLAnchorElement ? element.href : undefined,
    text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300),
  };
}

function sendRecordedAction(type, element, extra = {}) {
  if (!recording || !element) return Promise.resolve({ ok: false });
  const now = Date.now();
  const rect = element.getBoundingClientRect();
  const position = rect.width > 0 && rect.height > 0 ? {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  } : {};
  const locator = elementLocator(element);
  const action = {
    id: `ACT-${crypto.randomUUID()}`,
    type,
    selector: locator.selector,
    locator,
    timestamp: now,
    delayMs: now - lastActionAt,
    tagName: element.tagName.toLowerCase(),
    text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().slice(0, 300),
    href: element.href || undefined,
    startUrl: location.href,
    frameUrl: location.href,
    pageUrl: location.href,
    ...position,
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
  const target = eventElement(event);
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
  const element = eventElement(event);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return;
  if (element instanceof HTMLInputElement && element.type === 'password') return;
  if (element instanceof HTMLInputElement && !['checkbox', 'radio', 'color', 'date', 'range'].includes(element.type)) return;
  if (element instanceof HTMLTextAreaElement) return;
  sendRecordedAction('change', element, { value: element.value.slice(0, 2000), checked: 'checked' in element ? element.checked : undefined });
}, true);

document.addEventListener('keydown', event => {
  const element = actionableTarget(eventElement(event));
  if (!element || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  if (element instanceof HTMLInputElement && element.type === 'password') return;
  if (isTextEntry(element)) {
    if (element instanceof HTMLTextAreaElement || event.key !== 'Enter') return;
    lastEnterAt = Date.now();
    flushPendingInput(element);
    sendRecordedAction('keypress', element, {
      key: 'Enter', code: event.code.slice(0, 80),
      location: event.location, repeat: event.repeat, isComposing: event.isComposing,
      altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
      form: element.form ? { action: element.form.action, method: element.form.method } : undefined,
    });
    return;
  }
  if (event.key === 'Enter') lastEnterAt = Date.now();
  sendRecordedAction('keypress', element, {
    key: event.key.slice(0, 80),
    code: event.code.slice(0, 80),
    location: event.location,
    repeat: event.repeat,
    isComposing: event.isComposing,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    form: 'form' in element && element.form ? { action: element.form.action, method: element.form.method } : undefined,
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
  const element = eventElement(event);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
  if (element instanceof HTMLInputElement && element.type === 'password') return;
  if (!isTextEntry(element)) return;
  scheduleInput(element, event.inputType || '');
}, true);

document.addEventListener('blur', event => {
  const element = eventElement(event);
  if (isTextEntry(element)) flushPendingInput(element);
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
  const locator = action.locator || {};
  const expectedTag = locator.tagName || action.tagName || '*';
  const candidates = queryAllOpenRoots(expectedTag).filter(isVisibleElement);
  const uniqueMatch = predicate => {
    const matches = candidates.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  };

  // Follow Playwright's resilient locator order: user-facing semantics, then explicit test contracts.
  if (locator.role && locator.accessibleName) {
    const match = uniqueMatch(candidate => elementRole(candidate) === locator.role && accessibleName(candidate) === locator.accessibleName);
    if (match) return { element: match, method: 'role-and-accessible-name' };
  }
  if (locator.ariaLabel) {
    const match = uniqueMatch(candidate => candidate.getAttribute('aria-label') === locator.ariaLabel);
    if (match) return { element: match, method: 'aria-label' };
  }
  if (locator.label) {
    const match = uniqueMatch(candidate => elementLabel(candidate) === locator.label);
    if (match) return { element: match, method: 'label' };
  }
  if (locator.placeholder) {
    const expected = canonicalText(locator.placeholder);
    const match = uniqueMatch(candidate => canonicalText(candidate.getAttribute('placeholder')) === expected);
    if (match) return { element: match, method: 'placeholder' };
  }
  if (locator.alt) {
    const match = uniqueMatch(candidate => candidate.getAttribute('alt') === locator.alt);
    if (match) return { element: match, method: 'alt-text' };
  }
  if (locator.title) {
    const match = uniqueMatch(candidate => candidate.getAttribute('title') === locator.title);
    if (match) return { element: match, method: 'title' };
  }
  if (locator.testId) {
    const match = uniqueMatch(candidate => ['data-testid', 'data-test', 'data-cy'].some(attribute => candidate.getAttribute(attribute) === locator.testId));
    if (match) return { element: match, method: 'test-id' };
  }
  if (isStableId(locator.id)) {
    const match = uniqueMatch(candidate => candidate.id === locator.id);
    if (match) return { element: match, method: 'stable-id' };
  }
  if (locator.name) {
    const match = uniqueMatch(candidate => candidate.getAttribute('name') === locator.name);
    if (match) return { element: match, method: 'name' };
  }
  if (locator.href) {
    const match = uniqueMatch(candidate => candidate instanceof HTMLAnchorElement && candidate.href === locator.href);
    if (match) return { element: match, method: 'href' };
  }
  const expectedText = normalizedText(locator.text || action.text);
  if (expectedText) {
    const match = uniqueMatch(candidate => normalizedText(candidate.innerText || candidate.textContent) === expectedText);
    if (match) return { element: match, method: 'exact-text' };
  }

  const generatedIdHint = generatedIdTextHint(locator.originalId || locator.id || action.selector);
  if (generatedIdHint) {
    const match = uniqueMatch(candidate => candidateSemanticText(candidate).includes(generatedIdHint));
    if (match) return { element: match, method: 'generated-id-text-hint' };
  }
  const canonicalExpectedText = canonicalText(expectedText);
  if (canonicalExpectedText.length >= 3) {
    const match = uniqueMatch(candidate => canonicalText(candidate.innerText || candidate.textContent) === canonicalExpectedText);
    if (match) return { element: match, method: 'normalized-text' };
  }

  // CSS is deliberately below user-facing locators because DOM structure and generated IDs are brittle.
  try {
    const matches = queryAllOpenRoots(action.selector).filter(isVisibleElement);
    if (matches.length === 1) return { element: matches[0], method: 'css-selector' };
  } catch { /* Continue with similarity and coordinate fallbacks. */ }

  const expectedClasses = new Set(locator.classList || []);
  const rolePeers = locator.roleIndex?.role
    ? queryAllOpenRoots('*').filter(candidate => elementRole(candidate) === locator.roleIndex.role && isVisibleElement(candidate))
    : [];
  const scored = candidates.map((candidate, index) => {
    let score = 0;
    if (locator.role && elementRole(candidate) === locator.role) score += 40;
    if (locator.accessibleName && accessibleName(candidate) === locator.accessibleName) score += 100;
    if (locator.ariaLabel && candidate.getAttribute('aria-label') === locator.ariaLabel) score += 80;
    if (locator.placeholder && canonicalText(candidate.getAttribute('placeholder')) === canonicalText(locator.placeholder)) score += 50;
    if (locator.title && candidate.getAttribute('title') === locator.title) score += 25;
    if (locator.inputType && candidate.getAttribute('type') === locator.inputType) score += 10;
    if (locator.autocomplete && candidate.getAttribute('autocomplete') === locator.autocomplete) score += 8;
    if (locator.label && elementLabel(candidate) === locator.label) score += 70;
    if (expectedText && normalizedText(candidate.innerText || candidate.textContent) === expectedText) score += 40;
    const context = nearbyText(candidate);
    if (locator.previousSiblingText && context.previousSiblingText === locator.previousSiblingText) score += 20;
    if (locator.nextSiblingText && context.nextSiblingText === locator.nextSiblingText) score += 20;
    if (locator.parentText && context.parentText === locator.parentText) score += 30;
    const landmark = nearestLandmark(candidate);
    if (locator.landmark?.role && landmark?.role === locator.landmark.role) score += 20;
    if (locator.landmark?.accessibleName && landmark?.accessibleName === locator.landmark.accessibleName) score += 25;
    const heading = nearestHeading(candidate);
    if (locator.heading?.text && heading?.text === locator.heading.text) score += 35;
    const form = formContext(candidate);
    if (locator.form?.action && form?.action === locator.form.action) score += 25;
    if (locator.form?.name && form?.name === locator.form.name) score += 25;
    const classMatches = Array.from(expectedClasses).filter(className => candidate.classList.contains(className)).length;
    score += Math.min(15, classMatches * 3);
    if (locator.ancestorSignature && ancestorSignature(candidate) === locator.ancestorSignature) score += 25;
    if (locator.roleIndex?.index && rolePeers.indexOf(candidate) + 1 === locator.roleIndex.index) score += 10;
    if (locator.visualFingerprint) {
      const visual = visualFingerprint(candidate);
      const expectedVisual = locator.visualFingerprint;
      if (Math.abs(visual.width - expectedVisual.width) <= 4) score += 5;
      if (Math.abs(visual.height - expectedVisual.height) <= 4) score += 5;
      if (visual.fontSize === expectedVisual.fontSize) score += 4;
      if (visual.color === expectedVisual.color) score += 3;
      if (visual.backgroundColor === expectedVisual.backgroundColor) score += 3;
    }
    if (locator.domHierarchy?.length) {
      const candidateHierarchy = domHierarchy(candidate);
      let hierarchyScore = 0;
      for (let depth = 0; depth < Math.min(locator.domHierarchy.length, candidateHierarchy.length); depth += 1) {
        const expected = locator.domHierarchy[depth];
        const actual = candidateHierarchy[depth];
        if (expected.tagName !== actual.tagName) break;
        hierarchyScore += 5;
        if (expected.id && expected.id === actual.id) hierarchyScore += 16;
        if (expected.testId && expected.testId === actual.testId) hierarchyScore += 16;
        if (expected.role && expected.role === actual.role) hierarchyScore += 4;
        if (expected.nthOfType === actual.nthOfType) hierarchyScore += 3;
        const expectedNodeClasses = new Set(expected.classList || []);
        hierarchyScore += Math.min(6, actual.classList.filter(className => expectedNodeClasses.has(className)).length * 2);
      }
      score += Math.min(70, hierarchyScore);
    }
    return { candidate, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  if (scored[0]?.score >= 40 && scored[0].score >= (scored[1]?.score || 0) + 10) {
    return { element: scored[0].candidate, method: `semantic-fingerprint:${scored[0].score}` };
  }
  const hierarchyElement = elementFromHierarchyPath(locator.hierarchyPath);
  if (hierarchyElement && isVisibleElement(hierarchyElement)) return { element: hierarchyElement, method: 'html-hierarchy-fallback' };
  const shadowElement = elementFromShadowPath(locator.shadowPath);
  if (shadowElement && isVisibleElement(shadowElement)) return { element: shadowElement, method: 'shadow-hierarchy-fallback' };
  const xpathElement = elementFromXPath(locator.xpath);
  if (xpathElement instanceof Element && isVisibleElement(xpathElement)) return { element: xpathElement, method: 'xpath-fallback' };
  return { element: null, method: '' };
}

async function findReplayElementWithRetry(action, timeoutMs = 1800) {
  const deadline = Date.now() + timeoutMs;
  let result = findReplayElement(action);
  while (!result.element && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 120));
    result = findReplayElement(action);
  }
  return result;
}

function recordedCoordinateTarget(action) {
  if (!Number.isFinite(action.clientX) || !Number.isFinite(action.clientY)) return null;
  const x = action.viewportWidth ? action.clientX * window.innerWidth / action.viewportWidth : action.clientX;
  const y = action.viewportHeight ? action.clientY * window.innerHeight / action.viewportHeight : action.clientY;
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) element = element.shadowRoot.elementFromPoint(x, y) || element;
  const expectedTag = action.locator?.tagName || action.tagName;
  if (element && expectedTag && element.tagName.toLowerCase() !== expectedTag) element = element.closest(expectedTag);
  return element ? { element, x, y } : null;
}

async function focusReplayTarget(action) {
  let { element, method } = await findReplayElementWithRetry(action);
  const activeElement = document.activeElement;
  const expectedTag = action.locator?.tagName || action.tagName;
  if (!element && activeElement instanceof Element && activeElement !== document.body
      && (!expectedTag || activeElement.tagName.toLowerCase() === expectedTag)) {
    element = activeElement;
    method = 'active-element-fallback';
  }
  if (!element) {
    element = recordedCoordinateTarget(action)?.element;
    if (element) method = 'recorded-coordinates-fallback';
  }
  if (!element) return { ok: false, error: `Could not resolve the recorded keyboard target: ${action.selector}` };
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  element.focus({ preventScroll: true });
  if (document.activeElement !== element && !element.contains(document.activeElement)) {
    return { ok: false, error: `Element could not receive keyboard focus: ${action.selector}` };
  }
  return { ok: true, selector: action.selector, resolutionMethod: method };
}

async function resolveReplayTarget(action) {
  let { element, method } = await findReplayElementWithRetry(action);
  let x;
  let y;
  if (!element) {
    const coordinateTarget = recordedCoordinateTarget(action);
    element = coordinateTarget?.element;
    x = coordinateTarget?.x;
    y = coordinateTarget?.y;
    if (element) method = 'recorded-coordinates-fallback';
  }
  if (!element) return { ok: false, error: `Could not resolve the recorded target: ${action.selector}` };
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  await new Promise(resolve => requestAnimationFrame(resolve));
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: `The replay target is not visible: ${action.selector}` };
  return { ok: true, x, y, selector: action.selector, resolutionMethod: method };
}

async function replayAction(action) {
  if (action.type === 'scroll') {
    window.scrollTo({ left: action.scrollX || 0, top: action.scrollY || 0, behavior: 'instant' });
    return { ok: true, fallback: 'coordinates' };
  }
  let { element, method: resolutionMethod } = await findReplayElementWithRetry(action);
  const activeElement = document.activeElement;
  const expectedTag = action.locator?.tagName || action.tagName;
  if (!element && action.type !== 'click' && activeElement instanceof Element && activeElement !== document.body
      && (!expectedTag || activeElement.tagName.toLowerCase() === expectedTag)) {
    element = activeElement;
    resolutionMethod = 'active-element-fallback';
  }
  if (!element) {
    element = recordedCoordinateTarget(action)?.element;
    if (element) resolutionMethod = 'recorded-coordinates-fallback';
  }
  if (!element) return { ok: false, error: `Could not resolve the recorded target: ${action.selector}` };
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
    const inputResult = await applyInputAction(element, action);
    return { ...inputResult, resolutionMethod };
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
  } else if (message.type === 'FOCUS_REPLAY_TARGET') {
    focusReplayTarget(message.action).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
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
