const BRIDGE_URL = 'http://127.0.0.1:9231';
const MAX_ACTIONS = 500;
const BREAKPOINT_DWELL_MS = 3500;
const BREAKPOINTS = [
  { width: 1920, height: 1080, label: 'Desktop 1080p' },
  { width: 1760, height: 990, label: 'Desktop midpoint A' },
  { width: 1600, height: 900, label: 'Desktop 900p' },
  { width: 1460, height: 810, label: 'Desktop midpoint B' },
  { width: 1320, height: 720, label: 'Desktop 720p' },
];

const DEFAULT_STATE = {
  recording: false,
  replaying: false,
  recordingTabId: null,
  recordingStartedAt: null,
  recordingId: null,
  recordingStartUrl: '',
  recordingStartTitle: '',
  actions: [],
  simulation: {
    active: false,
    paused: false,
    tabId: null,
    presetIndex: 0,
    width: null,
    height: null,
  },
  selectedElement: null,
  lastError: '',
};

let runtimeState = structuredClone(DEFAULT_STATE);
let simulationRunId = 0;

chrome.storage.local.get('websiteAnalyticsState').then(({ websiteAnalyticsState }) => {
  if (websiteAnalyticsState) {
    runtimeState = {
      ...structuredClone(DEFAULT_STATE),
      ...websiteAnalyticsState,
      replaying: false,
      simulation: { ...DEFAULT_STATE.simulation, ...websiteAnalyticsState.simulation, active: false, paused: false, tabId: null },
    };
    persistState();
  }
});

function persistState() {
  return chrome.storage.local.set({ websiteAnalyticsState: runtimeState });
}

function publicState(bridgeConnected = false) {
  return {
    ...runtimeState,
    bridgeConnected,
    actionCount: runtimeState.actions.length,
    breakpoints: BREAKPOINTS,
  };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active website tab is available.');
  if (!/^https?:/i.test(tab.url || '')) throw new Error('Open an http or https website before using Website Analytics.');
  return tab;
}

async function sendToTab(tabId, message, options = {}) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, options);
  } catch (firstError) {
    await new Promise(resolve => setTimeout(resolve, 700));
    try {
      return await chrome.tabs.sendMessage(tabId, message, options);
    } catch {
      throw firstError;
    }
  }
}

async function bridgeRequest(path, options = {}) {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`Network Watch bridge returned ${response.status}.`);
  return response.json();
}

async function bridgeConnected() {
  try {
    await bridgeRequest('/health');
    return true;
  } catch {
    return false;
  }
}

async function startRecording() {
  const tab = await activeTab();
  runtimeState.recording = true;
  runtimeState.recordingTabId = tab.id;
  runtimeState.recordingStartedAt = new Date().toISOString();
  runtimeState.recordingId = `REC-${crypto.randomUUID()}`;
  runtimeState.recordingStartUrl = tab.url || '';
  runtimeState.recordingStartTitle = tab.title || '';
  runtimeState.actions = [];
  runtimeState.lastError = '';
  await persistState();
  await sendToTab(tab.id, { type: 'SET_RECORDING', recording: true });
  await chrome.action.setBadgeText({ text: 'REC' });
  await chrome.action.setBadgeBackgroundColor({ color: '#d83a52' });
  return publicState(await bridgeConnected());
}

async function stopRecording() {
  const tabId = runtimeState.recordingTabId;
  if (tabId) {
    try { await sendToTab(tabId, { type: 'SET_RECORDING', recording: false }); } catch { /* The tab may have closed. */ }
  }

  let tab = null;
  try { tab = tabId ? await chrome.tabs.get(tabId) : await activeTab(); } catch { /* Keep the captured actions. */ }
  const recording = {
    id: runtimeState.recordingId || `REC-${crypto.randomUUID()}`,
    kind: 'recording',
    url: runtimeState.recordingStartUrl || tab?.url || '',
    title: runtimeState.recordingStartTitle || tab?.title || '',
    startedAt: runtimeState.recordingStartedAt || new Date().toISOString(),
    stoppedAt: new Date().toISOString(),
    actions: runtimeState.actions,
  };

  runtimeState.recording = false;
  runtimeState.recordingTabId = null;
  runtimeState.recordingStartedAt = null;
  await persistState();
  await chrome.action.setBadgeText({ text: '' });

  if (recording.actions.length) {
    try { await bridgeRequest('/api/recordings', { method: 'POST', body: JSON.stringify(recording) }); }
    catch { runtimeState.lastError = 'Recording saved locally, but Network Watch is not connected.'; }
  }
  return publicState(await bridgeConnected());
}

function waitForTabComplete(tabId, timeoutMs = 12000) {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeout);
      resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const timeout = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function replayActions() {
  if (!runtimeState.actions.length) throw new Error('Record at least one action before replaying.');
  const tab = await activeTab();
  runtimeState.replaying = true;
  runtimeState.lastError = '';
  await persistState();

  const replayStartedAt = new Date().toISOString();
  const replayRecording = {
    id: `REPLAY-${crypto.randomUUID()}`,
    kind: 'replay',
    sourceRecordingId: runtimeState.recordingId,
    url: runtimeState.recordingStartUrl || tab.url || '',
    title: runtimeState.recordingStartTitle || tab.title || '',
    startedAt: replayStartedAt,
    stoppedAt: replayStartedAt,
    actions: [],
  };

  try {
    if (runtimeState.recordingStartUrl) {
      const tabReady = waitForTabComplete(tab.id);
      if (tab.url !== runtimeState.recordingStartUrl) await chrome.tabs.update(tab.id, { url: runtimeState.recordingStartUrl });
      else await chrome.tabs.reload(tab.id);
      await tabReady;
    }
    for (let index = 0; index < runtimeState.actions.length; index += 1) {
      const action = runtimeState.actions[index];
      await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(action.delayMs || 150, 100), 2500)));
      const replayAction = {
        ...action,
        id: `ACT-${crypto.randomUUID()}`,
        sourceActionId: action.id,
        timestamp: Date.now(),
      };
      const result = await sendToTab(tab.id, { type: 'REPLAY_ACTION', action: replayAction, index }, { frameId: action.frameId || 0 });
      if (!result?.ok) throw new Error(result?.error || `Could not replay action ${index + 1}.`);
      replayRecording.actions.push(replayAction);
    }
    replayRecording.stoppedAt = new Date().toISOString();
    try { await bridgeRequest('/api/recordings', { method: 'POST', body: JSON.stringify(replayRecording) }); }
    catch { runtimeState.lastError = 'Replay completed, but Network Watch did not receive its evidence.'; }
  } catch (error) {
    runtimeState.lastError = error.message;
    throw error;
  } finally {
    runtimeState.replaying = false;
    await persistState();
  }
  return publicState(await bridgeConnected());
}

function debuggerTarget(tabId) {
  return { tabId };
}

async function applyMetrics(tabId, width, height) {
  const tab = await chrome.tabs.get(tabId);
  const availableWidth = Math.max(320, (tab.width || width) - 32);
  const availableHeight = Math.max(320, (tab.height || height) - 96);
  const scale = Math.min(1, availableWidth / width, availableHeight / height);
  await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
    scale,
  });
  await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Emulation.setScrollbarsHidden', { hidden: false });
  runtimeState.simulation.width = width;
  runtimeState.simulation.height = height;
  runtimeState.simulation.scale = scale;
  await persistState();
}

async function runSimulation(runId) {
  while (runtimeState.simulation.active && runId === simulationRunId) {
    if (runtimeState.simulation.paused) {
      await new Promise(resolve => setTimeout(resolve, 250));
      continue;
    }

    const target = BREAKPOINTS[runtimeState.simulation.presetIndex];
    await applyMetrics(runtimeState.simulation.tabId, target.width, target.height);
    const tabReady = waitForTabComplete(runtimeState.simulation.tabId, 8000);
    await chrome.tabs.reload(runtimeState.simulation.tabId);
    await tabReady;

    runtimeState.simulation.presetIndex += 1;
    if (runtimeState.simulation.presetIndex >= BREAKPOINTS.length) {
      runtimeState.simulation.presetIndex = 0;
      runtimeState.simulation.paused = true;
    }
    await persistState();
    await new Promise(resolve => setTimeout(resolve, BREAKPOINT_DWELL_MS));
  }
}

async function startSimulation() {
  if (runtimeState.simulation.active) return publicState(await bridgeConnected());
  const tab = await activeTab();
  await chrome.debugger.attach(debuggerTarget(tab.id), '1.3');
  runtimeState.simulation = {
    active: true,
    paused: false,
    tabId: tab.id,
    presetIndex: 0,
    width: null,
    height: null,
    scale: 1,
  };
  runtimeState.selectedElement = null;
  runtimeState.lastError = '';
  simulationRunId += 1;
  runSimulation(simulationRunId).catch(async error => {
    runtimeState.lastError = error.message;
    await stopSimulation();
  });
  return publicState(await bridgeConnected());
}

async function pauseSimulation(paused) {
  if (!runtimeState.simulation.active) throw new Error('Start simulation first.');
  runtimeState.simulation.paused = paused;
  await persistState();
  return publicState(await bridgeConnected());
}

async function stopSimulation() {
  simulationRunId += 1;
  const tabId = runtimeState.simulation.tabId;
  if (tabId) {
    try { await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Emulation.clearDeviceMetricsOverride'); } catch { /* Already detached. */ }
    try { await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Emulation.setScrollbarsHidden', { hidden: false }); } catch { /* Already detached. */ }
    try { await chrome.debugger.detach(debuggerTarget(tabId)); } catch { /* Already detached. */ }
    try { await sendToTab(tabId, { type: 'STOP_PICKER' }); } catch { /* Tab unavailable. */ }
  }
  runtimeState.simulation = { ...DEFAULT_STATE.simulation };
  runtimeState.selectedElement = null;
  await persistState();
  return publicState(await bridgeConnected());
}

async function selectElement() {
  if (!runtimeState.simulation.active || !runtimeState.simulation.paused) throw new Error('Pause the simulation before selecting an element.');
  const tab = await chrome.tabs.get(runtimeState.simulation.tabId);
  await sendToTab(tab.id, { type: 'START_PICKER' });
  return { ok: true };
}

async function captureScreenshot() {
  if (!runtimeState.simulation.active || !runtimeState.simulation.paused) throw new Error('Pause the simulation before taking a screenshot.');
  const tab = await chrome.tabs.get(runtimeState.simulation.tabId);
  const metrics = await chrome.debugger.sendCommand(debuggerTarget(tab.id), 'Page.getLayoutMetrics');
  const contentSize = metrics.cssContentSize || metrics.contentSize;
  const maxImageDimension = 12000;
  const maxImagePixels = 40000000;
  const screenshotScale = Math.min(
    1,
    maxImageDimension / contentSize.width,
    maxImageDimension / contentSize.height,
    Math.sqrt(maxImagePixels / (contentSize.width * contentSize.height)),
  );
  const capture = await chrome.debugger.sendCommand(debuggerTarget(tab.id), 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: contentSize.width,
      height: contentSize.height,
      scale: screenshotScale,
    },
  });
  const dataUrl = `data:image/png;base64,${capture.data}`;
  const screenshot = {
    id: crypto.randomUUID(),
    dataUrl,
    width: runtimeState.simulation.width,
    height: runtimeState.simulation.height,
    url: tab.url || '',
    title: tab.title || '',
    capturedAt: new Date().toISOString(),
    fullPage: true,
    contentWidth: contentSize.width,
    contentHeight: contentSize.height,
    element: runtimeState.selectedElement,
  };
  await bridgeRequest('/api/screenshots', { method: 'POST', body: JSON.stringify(screenshot) });
  return { ok: true, screenshot, state: publicState(true) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RECORDED_ACTION') {
    if (runtimeState.recording && sender.tab?.id === runtimeState.recordingTabId && runtimeState.actions.length < MAX_ACTIONS) {
      const action = { ...message.action, frameId: sender.frameId || 0 };
      const previous = runtimeState.actions[runtimeState.actions.length - 1];
      const duplicateEnter = action.type === 'keypress'
        && action.key === 'Enter'
        && previous?.type === 'keypress'
        && previous.key === 'Enter'
        && Math.abs(action.timestamp - previous.timestamp) < 1000;
      if (!duplicateEnter) runtimeState.actions.push(action);
      persistState();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'ELEMENT_SELECTED') {
    runtimeState.selectedElement = message.element;
    persistState();
    return false;
  }

  if (message.type === 'CONTENT_READY') {
    sendResponse({ recording: runtimeState.recording && sender.tab?.id === runtimeState.recordingTabId });
    return false;
  }

  const handlers = {
    GET_STATE: async () => publicState(await bridgeConnected()),
    START_RECORDING: startRecording,
    STOP_RECORDING: stopRecording,
    REPLAY: replayActions,
    START_SIMULATION: startSimulation,
    PAUSE_SIMULATION: () => pauseSimulation(true),
    RESUME_SIMULATION: () => pauseSimulation(false),
    STOP_SIMULATION: stopSimulation,
    SELECT_ELEMENT: selectElement,
    CAPTURE_SCREENSHOT: captureScreenshot,
  };

  const handler = handlers[message.type];
  if (!handler) return false;
  handler()
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(async error => {
      runtimeState.lastError = error.message;
      await persistState();
      sendResponse({ ok: false, error: error.message, state: publicState(false) });
    });
  return true;
});

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId === runtimeState.simulation.tabId) {
    simulationRunId += 1;
    runtimeState.simulation = { ...DEFAULT_STATE.simulation };
    runtimeState.selectedElement = null;
    persistState();
  }
});
