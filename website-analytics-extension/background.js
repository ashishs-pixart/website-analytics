const BRIDGE_URL = 'http://127.0.0.1:9231';
const MAX_ACTIONS = 500;
const MAX_RECORDINGS = 10;
const BREAKPOINT_DWELL_MS = 6000;
const BREAKPOINTS = [
  { width: 1920, height: 1080, label: 'Desktop 1080p' },
  { width: 1760, height: 990, label: 'Desktop midpoint A' },
  { width: 1600, height: 900, label: 'Desktop 900p' },
  { width: 1460, height: 810, label: 'Desktop midpoint B' },
  { width: 1320, height: 720, label: 'Desktop 720p' },
  { width: 1024, height: 768, label: 'Tablet landscape' },
  { width: 768, height: 1024, label: 'Tablet portrait' },
  { width: 430, height: 932, label: 'Large mobile' },
  { width: 390, height: 844, label: 'Standard mobile' },
  { width: 375, height: 812, label: 'Compact iPhone' },
  { width: 360, height: 800, label: 'Compact Android' },
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
  recordings: [],
  simulation: {
    active: false,
    paused: false,
    tabId: null,
    presetIndex: 0,
    width: null,
    height: null,
    currentIndex: null,
  },
  selectedElements: [],
  selectingElements: false,
  selectionTabId: null,
  capturedBreakpoints: [],
  lastError: '',
};

let runtimeState = structuredClone(DEFAULT_STATE);
let simulationRunId = 0;

const stateReady = chrome.storage.local.get('websiteAnalyticsState').then(async ({ websiteAnalyticsState }) => {
  if (websiteAnalyticsState) {
    const staleSelectionTabId = websiteAnalyticsState.selectionTabId;
    runtimeState = {
      ...structuredClone(DEFAULT_STATE),
      ...websiteAnalyticsState,
      replaying: false,
      selectingElements: false,
      selectionTabId: null,
      simulation: { ...DEFAULT_STATE.simulation, ...websiteAnalyticsState.simulation, active: false, paused: false, tabId: null },
    };
    await persistState();
    if (staleSelectionTabId) sendToTab(staleSelectionTabId, { type: 'STOP_PICKER' }).catch(() => {});
  }
}).catch(error => {
  runtimeState.lastError = `Could not restore extension state: ${error.message}`;
});

function persistState() {
  return chrome.storage.local.set({ websiteAnalyticsState: runtimeState });
}

function publicState(bridgeConnected = false) {
  return {
    ...runtimeState,
    recordings: availableRecordings(),
    bridgeConnected,
    actionCount: runtimeState.actions.length,
    breakpoints: BREAKPOINTS,
  };
}

function availableRecordings() {
  if (runtimeState.recordings?.length) return runtimeState.recordings;
  if (!runtimeState.actions.length) return [];
  return [{
    id: runtimeState.recordingId || 'LATEST-RECORDING',
    kind: 'recording',
    url: runtimeState.recordingStartUrl || '',
    title: runtimeState.recordingStartTitle || '',
    startedAt: runtimeState.recordingStartedAt || new Date().toISOString(),
    stoppedAt: new Date().toISOString(),
    actions: runtimeState.actions,
  }];
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
  if (!response.ok) {
    let message = `Network Watch bridge returned ${response.status}.`;
    try {
      const details = await response.json();
      if (details?.error) message = details.error;
    } catch { /* Keep the status-based message if the response is not JSON. */ }
    throw new Error(message);
  }
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
  if (recording.actions.length) {
    runtimeState.recordings = [recording, ...(runtimeState.recordings || []).filter(item => item.id !== recording.id)].slice(0, MAX_RECORDINGS);
  }
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

async function currentTabUrl(tabId) {
  try { return (await chrome.tabs.get(tabId)).url || ''; }
  catch { return ''; }
}

async function waitIfTabLoading(tabId) {
  try {
    if ((await chrome.tabs.get(tabId)).status === 'loading') await waitForTabComplete(tabId, 10000);
  } catch { /* The next action will report a useful tab or content-script error. */ }
}

async function restoreActionUrl(tabId, expectedUrl) {
  const fromUrl = await currentTabUrl(tabId);
  if (!expectedUrl || fromUrl === expectedUrl) return null;
  try {
    const ready = waitForTabComplete(tabId, 10000);
    await chrome.tabs.update(tabId, { url: expectedUrl });
    await ready;
    const resultUrl = await currentTabUrl(tabId);
    if (resultUrl !== expectedUrl) throw new Error(`Expected ${expectedUrl}, reached ${resultUrl || 'an unknown page'}.`);
    return { fromUrl, toUrl: expectedUrl, succeeded: true };
  } catch (error) {
    return { fromUrl, toUrl: expectedUrl, succeeded: false, error: error.message };
  }
}

async function resultUrlAfterAction(tabId, beforeUrl, timeoutMs = 1400) {
  return new Promise(resolve => {
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeout);
      resolve(await currentTabUrl(tabId));
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') finish();
    };
    const timeout = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function dispatchTrustedClick(tabId, action, frameId, debuggerState) {
  if (frameId) throw new Error('Trusted browser clicks are limited to the main document; using the DOM fallback for this frame.');
  const target = await sendToTab(tabId, { type: 'RESOLVE_REPLAY_TARGET', action }, { frameId: 0 });
  if (!target?.ok) throw new Error(target?.error || 'Could not resolve the click target.');
  if (debuggerState.attachError) throw new Error(debuggerState.attachError);
  if (!debuggerState.available) {
    try {
      if (!(runtimeState.simulation.active && runtimeState.simulation.tabId === tabId)) {
        await chrome.debugger.attach(debuggerTarget(tabId), '1.3');
        debuggerState.attachedByReplay = true;
      }
      debuggerState.available = true;
    } catch (error) {
      debuggerState.attachError = error.message;
      throw error;
    }
  }
  const coordinates = { x: target.x, y: target.y };
  await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...coordinates });
  await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Input.dispatchMouseEvent', { type: 'mousePressed', ...coordinates, button: 'left', clickCount: 1 });
  await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...coordinates, button: 'left', clickCount: 1 });
  return target;
}

function replayActionLabel(action) {
  const target = action.key ? `Key ${action.key}` : action.text || action.selector || action.type;
  return `${action.type} · ${String(target).slice(0, 140)}`;
}

async function sendReplayProgress(tabId, replayRecording, entries, phase, successfulActions, failedActions, currentIndex = null, message = '') {
  try {
    await sendToTab(tabId, {
      type: 'SHOW_REPLAY_PROGRESS',
      replayId: replayRecording.id,
      sourceRecordingId: replayRecording.sourceRecordingId,
      phase,
      totalActions: replayRecording.expectedActionCount,
      successfulActions,
      failedActions,
      currentIndex,
      message,
      entries: entries.slice(-8),
    }, { frameId: 0 });
  } catch { /* Navigation can temporarily replace the content script; the next update recreates the panel. */ }
}

async function replayActions(recordingId) {
  const recordings = availableRecordings();
  const sourceRecording = recordings.find(recording => recording.id === recordingId) || recordings[0];
  if (!sourceRecording?.actions.length) throw new Error('Record at least one action before replaying.');
  const sourceActions = sourceRecording.actions;
  const tab = await activeTab();
  runtimeState.replaying = true;
  runtimeState.lastError = '';
  await persistState();

  const replayStartedAt = new Date().toISOString();
  const replayRecording = {
    id: `REPLAY-${crypto.randomUUID()}`,
    kind: 'replay',
    sourceRecordingId: sourceRecording.id,
    url: sourceRecording.url || tab.url || '',
    title: sourceRecording.title || tab.title || '',
    startedAt: replayStartedAt,
    stoppedAt: replayStartedAt,
    expectedActionCount: sourceActions.length,
    actions: [],
  };
  let successfulActions = 0;
  let failedActions = 0;
  const progressEntries = [];
  const replayDebugger = { available: runtimeState.simulation.active && runtimeState.simulation.tabId === tab.id, attachedByReplay: false, attachError: '' };

  try {
    if (sourceRecording.url) {
      const tabReady = waitForTabComplete(tab.id);
      if (tab.url !== sourceRecording.url) await chrome.tabs.update(tab.id, { url: sourceRecording.url });
      else await chrome.tabs.reload(tab.id);
      await tabReady;
    }
    await sendReplayProgress(tab.id, replayRecording, progressEntries, 'running', successfulActions, failedActions, null, 'Preparing replay...');
    for (let index = 0; index < sourceActions.length; index += 1) {
      const action = sourceActions[index];
      await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(action.delayMs || 150, 100), 2500)));
      const replayAction = {
        ...action,
        id: `ACT-${crypto.randomUUID()}`,
        sourceActionId: action.id,
        timestamp: Date.now(),
      };
      const progressEntry = {
        index,
        actionId: action.id,
        label: replayActionLabel(action),
        status: 'running',
      };
      progressEntries.push(progressEntry);
      await sendReplayProgress(tab.id, replayRecording, progressEntries, 'running', successfulActions, failedActions, index, `Performing action ${index + 1} of ${sourceActions.length}`);
      try {
        await waitIfTabLoading(tab.id);
        replayAction.expectedUrl = action.startUrl || action.pageUrl || replayRecording.url;
        const nextAction = sourceActions[index + 1];
        replayAction.expectedResultUrl = nextAction?.startUrl || nextAction?.pageUrl || null;
        replayAction.urlCorrection = await restoreActionUrl(tab.id, replayAction.expectedUrl);
        if (replayAction.urlCorrection && !replayAction.urlCorrection.succeeded) {
          throw new Error(`Could not restore the recorded URL: ${replayAction.urlCorrection.error}`);
        }
        if (replayAction.urlCorrection) {
          progressEntry.detail = `Restored URL: ${replayAction.urlCorrection.toUrl}`;
          await sendReplayProgress(tab.id, replayRecording, progressEntries, 'running', successfulActions, failedActions, index, `Restored the recorded page for action ${index + 1}`);
        }
        const urlBeforeAction = await currentTabUrl(tab.id);
        let result;
        if (replayAction.type === 'click') {
          try {
            const target = await dispatchTrustedClick(tab.id, replayAction, action.frameId || 0, replayDebugger);
            result = { ok: true, resolutionMethod: target.resolutionMethod };
            replayAction.executionMethod = 'cdp-trusted-click';
          } catch (trustedClickError) {
            result = await sendToTab(tab.id, { type: 'REPLAY_ACTION', action: replayAction, index }, { frameId: action.frameId || 0 });
            replayAction.executionMethod = 'dom-click-fallback';
            replayAction.executionWarning = `Trusted click unavailable: ${trustedClickError.message}`;
          }
        } else {
          result = await sendToTab(tab.id, { type: 'REPLAY_ACTION', action: replayAction, index }, { frameId: action.frameId || 0 });
          replayAction.executionMethod = replayAction.type === 'scroll' ? 'scroll' : replayAction.type === 'input' || replayAction.type === 'change' ? 'input-value' : 'dom-key-event';
        }
        if (!result?.ok) throw new Error(result?.error || `Could not replay action ${index + 1}.`);
        replayAction.resolutionMethod = result.resolutionMethod;
        const couldNavigate = replayAction.type === 'click' || (replayAction.type === 'keypress' && replayAction.key === 'Enter');
        replayAction.resultUrl = couldNavigate ? await resultUrlAfterAction(tab.id, urlBeforeAction) : await currentTabUrl(tab.id);
        replayAction.urlChanged = Boolean(replayAction.resultUrl && replayAction.resultUrl !== urlBeforeAction);
        if (couldNavigate && replayAction.expectedResultUrl && replayAction.resultUrl !== replayAction.expectedResultUrl) {
          throw new Error(`Action did not reach the page recorded for the next step. Expected ${replayAction.expectedResultUrl}, reached ${replayAction.resultUrl || 'an unknown page'}.`);
        }
        replayAction.outcome = 'success';
        successfulActions += 1;
        progressEntry.status = 'success';
        progressEntry.detail = replayAction.executionMethod || 'completed';
        await sendReplayProgress(tab.id, replayRecording, progressEntries, 'running', successfulActions, failedActions, index, `Action ${index + 1} succeeded`);
      } catch (error) {
        replayAction.outcome = 'failed';
        replayAction.replayError = error.message;
        replayAction.resultUrl = await currentTabUrl(tab.id);
        replayAction.urlChanged = Boolean(replayAction.resultUrl && replayAction.expectedUrl && replayAction.resultUrl !== replayAction.expectedUrl);
        failedActions += 1;
        progressEntry.status = 'failed';
        progressEntry.detail = error.message;
        runtimeState.lastError = `${replayAction.sourceActionId || replayAction.id} failed: ${error.message}`;
        await sendReplayProgress(tab.id, replayRecording, progressEntries, 'running', successfulActions, failedActions, index, `Action ${index + 1} failed`);
      }
      replayRecording.actions.push(replayAction);
    }
    replayRecording.stoppedAt = new Date().toISOString();
    replayRecording.summary = { successfulActions, failedActions, totalActions: replayRecording.actions.length };
    try { await bridgeRequest('/api/recordings', { method: 'POST', body: JSON.stringify(replayRecording) }); }
    catch { runtimeState.lastError = 'Replay completed, but Network Watch did not receive its evidence.'; }
    await waitIfTabLoading(tab.id);
    await sendReplayProgress(tab.id, replayRecording, progressEntries, 'complete', successfulActions, failedActions, null, `Replay finished: ${successfulActions} succeeded, ${failedActions} failed.`);
  } catch (error) {
    runtimeState.lastError = error.message;
    await sendReplayProgress(tab.id, replayRecording, progressEntries, 'failed', successfulActions, failedActions, null, `Replay stopped: ${error.message}`);
    throw error;
  } finally {
    if (replayDebugger.attachedByReplay) {
      try { await chrome.debugger.detach(debuggerTarget(tab.id)); } catch { /* Already detached. */ }
    }
    runtimeState.replaying = false;
    await persistState();
  }
  return {
    state: publicState(await bridgeConnected()),
    replaySummary: { successfulActions, failedActions, totalActions: replayRecording.actions.length, replayId: replayRecording.id },
  };
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
    mobile: width <= 768,
    screenWidth: width,
    screenHeight: height,
    scale,
    screenOrientation: {
      type: height >= width ? 'portraitPrimary' : 'landscapePrimary',
      angle: height >= width ? 0 : 90,
    },
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
    await sendToTab(runtimeState.simulation.tabId, {
      type: 'SET_SIMULATION_FRAME',
      visible: true,
      width: target.width,
      height: target.height,
      label: target.label,
    }, { frameId: 0 });
    if (runtimeState.selectingElements && runtimeState.selectionTabId === runtimeState.simulation.tabId) {
      await sendToTab(runtimeState.simulation.tabId, { type: 'START_PICKER' });
    }

    runtimeState.simulation.currentIndex = runtimeState.simulation.presetIndex;
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

async function setBreakpoint(index) {
  if (!runtimeState.simulation.active || !runtimeState.simulation.paused) throw new Error('Pause the simulation before choosing a breakpoint.');
  const targetIndex = Math.max(0, Math.min(BREAKPOINTS.length - 1, Number(index)));
  const target = BREAKPOINTS[targetIndex];
  await applyMetrics(runtimeState.simulation.tabId, target.width, target.height);
  const tabReady = waitForTabComplete(runtimeState.simulation.tabId, 8000);
  await chrome.tabs.reload(runtimeState.simulation.tabId);
  await tabReady;
  await sendToTab(runtimeState.simulation.tabId, {
    type: 'SET_SIMULATION_FRAME', visible: true, width: target.width, height: target.height, label: target.label,
  }, { frameId: 0 });
  if (runtimeState.selectingElements && runtimeState.selectionTabId === runtimeState.simulation.tabId) {
    await sendToTab(runtimeState.simulation.tabId, { type: 'START_PICKER' });
  }
  runtimeState.simulation.currentIndex = targetIndex;
  runtimeState.simulation.presetIndex = (targetIndex + 1) % BREAKPOINTS.length;
  await persistState();
  return publicState(await bridgeConnected());
}

async function stopSimulation() {
  simulationRunId += 1;
  const tabId = runtimeState.simulation.tabId;
  if (tabId) {
    try { await sendToTab(tabId, { type: 'CLEAR_SIMULATION_FRAME' }, { frameId: 0 }); } catch { /* Tab unavailable. */ }
    try { await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Emulation.clearDeviceMetricsOverride'); } catch { /* Already detached. */ }
    try { await chrome.debugger.sendCommand(debuggerTarget(tabId), 'Emulation.setScrollbarsHidden', { hidden: false }); } catch { /* Already detached. */ }
    try { await chrome.debugger.detach(debuggerTarget(tabId)); } catch { /* Already detached. */ }
  }
  runtimeState.simulation = { ...DEFAULT_STATE.simulation };
  await persistState();
  return publicState(await bridgeConnected());
}

async function selectElement() {
  const tab = await activeTab();
  await sendToTab(tab.id, { type: 'START_PICKER' });
  runtimeState.selectingElements = true;
  runtimeState.selectionTabId = tab.id;
  await persistState();
  return { state: publicState(await bridgeConnected()) };
}

async function stopSelectingElements() {
  if (runtimeState.selectionTabId) {
    try { await sendToTab(runtimeState.selectionTabId, { type: 'STOP_PICKER' }); } catch { /* Tab unavailable. */ }
  }
  runtimeState.selectingElements = false;
  runtimeState.selectionTabId = null;
  await persistState();
  return publicState(await bridgeConnected());
}

async function resetExtension() {
  simulationRunId += 1;
  const tabIds = new Set([
    runtimeState.simulation.tabId,
    runtimeState.recordingTabId,
    runtimeState.selectionTabId,
  ].filter(Boolean));

  for (const tabId of tabIds) {
    try { await sendToTab(tabId, { type: 'SET_RECORDING', recording: false }); } catch { /* Tab unavailable. */ }
    try { await sendToTab(tabId, { type: 'STOP_PICKER' }); } catch { /* Tab unavailable. */ }
    try { await sendToTab(tabId, { type: 'CLEAR_SIMULATION_FRAME' }, { frameId: 0 }); } catch { /* Tab unavailable. */ }
  }

  const simulationTabId = runtimeState.simulation.tabId;
  if (simulationTabId) {
    try { await chrome.debugger.sendCommand(debuggerTarget(simulationTabId), 'Emulation.clearDeviceMetricsOverride'); } catch { /* Already detached. */ }
    try { await chrome.debugger.sendCommand(debuggerTarget(simulationTabId), 'Emulation.setScrollbarsHidden', { hidden: false }); } catch { /* Already detached. */ }
    try { await chrome.debugger.detach(debuggerTarget(simulationTabId)); } catch { /* Already detached. */ }
  }

  runtimeState = structuredClone(DEFAULT_STATE);
  await persistState();
  await chrome.action.setBadgeText({ text: '' });
  if (simulationTabId) {
    try { await chrome.tabs.reload(simulationTabId); } catch { /* Tab unavailable. */ }
  }
  return publicState(await bridgeConnected());
}

async function captureScreenshot() {
  if (!runtimeState.simulation.active) throw new Error('Start the simulation before taking a screenshot.');
  const tab = await chrome.tabs.get(runtimeState.simulation.tabId);
  const currentBreakpoint = BREAKPOINTS.find((breakpoint) => breakpoint.width === runtimeState.simulation.width && breakpoint.height === runtimeState.simulation.height);
  if (runtimeState.selectingElements && runtimeState.selectionTabId === tab.id) {
    try { await sendToTab(tab.id, { type: 'STOP_PICKER' }); } catch { /* Capture without picker cleanup if the page is unavailable. */ }
  }
  try { await sendToTab(tab.id, { type: 'SET_SIMULATION_FRAME', visible: false }, { frameId: 0 }); } catch { /* Capture without hiding the frame if the page is unavailable. */ }
  try {
    let selectedElements = runtimeState.selectedElements;
    try {
      const refreshed = await sendToTab(tab.id, {
        type: 'REFRESH_SELECTED_ELEMENTS',
        selectors: runtimeState.selectedElements.map(element => element.selector),
      }, { frameId: 0 });
      if (refreshed?.elements?.length) selectedElements = refreshed.elements;
    } catch { /* Keep the selection-time metadata if an element no longer resolves. */ }
    const metrics = await chrome.debugger.sendCommand(debuggerTarget(tab.id), 'Page.getLayoutMetrics');
    const viewport = metrics.cssVisualViewport || metrics.visualViewport || {
      clientWidth: runtimeState.simulation.width,
      clientHeight: runtimeState.simulation.height,
    };
    const capture = await chrome.debugger.sendCommand(debuggerTarget(tab.id), 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 82,
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const mimeType = 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${capture.data}`;
    const screenshot = {
      id: crypto.randomUUID(),
      dataUrl,
      mimeType,
      byteSize: Math.floor(capture.data.length * 0.75),
      width: runtimeState.simulation.width,
      height: runtimeState.simulation.height,
      url: tab.url || '',
      title: tab.title || '',
      capturedAt: new Date().toISOString(),
      fullPage: false,
      contentWidth: viewport.clientWidth || runtimeState.simulation.width,
      contentHeight: viewport.clientHeight || runtimeState.simulation.height,
      elements: selectedElements,
      element: selectedElements[0] || null,
    };
    await bridgeRequest('/api/screenshots', { method: 'POST', body: JSON.stringify(screenshot) });
    runtimeState.capturedBreakpoints.push({ id: screenshot.id, width: screenshot.width, height: screenshot.height, capturedAt: screenshot.capturedAt });
    await persistState();
    return { ok: true, screenshot, state: publicState(true) };
  } finally {
    try {
      await sendToTab(tab.id, {
        type: 'SET_SIMULATION_FRAME',
        visible: true,
        width: runtimeState.simulation.width,
        height: runtimeState.simulation.height,
        label: currentBreakpoint?.label || 'Responsive preview',
      }, { frameId: 0 });
      if (runtimeState.selectingElements && runtimeState.selectionTabId === tab.id) {
        await sendToTab(tab.id, { type: 'START_PICKER' });
      }
    } catch { /* The page may have navigated during capture. */ }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RECORDED_ACTION') {
    stateReady.then(async () => {
      if (runtimeState.recording && sender.tab?.id === runtimeState.recordingTabId && runtimeState.actions.length < MAX_ACTIONS) {
        const frameId = sender.frameId || 0;
        const action = {
          ...message.action,
          startUrl: frameId ? sender.tab?.url || message.action.startUrl : message.action.startUrl || sender.tab?.url,
          pageUrl: frameId ? sender.tab?.url || message.action.pageUrl : message.action.pageUrl || sender.tab?.url,
          frameUrl: message.action.frameUrl || message.action.startUrl,
          frameId,
        };
        const previous = runtimeState.actions[runtimeState.actions.length - 1];
        const duplicateEnter = action.type === 'keypress'
          && action.key === 'Enter'
          && previous?.type === 'keypress'
          && previous.key === 'Enter'
          && Math.abs(action.timestamp - previous.timestamp) < 1000;
        if (!duplicateEnter) runtimeState.actions.push(action);
        await persistState();
      }
      sendResponse({ ok: true });
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'ELEMENT_SELECTED') {
    stateReady.then(async () => {
      const exists = runtimeState.selectedElements.some(element => element.selector === message.element.selector);
      if (!exists) runtimeState.selectedElements.push(message.element);
      await persistState();
      sendResponse({ ok: true });
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'CONTENT_READY') {
    stateReady.then(() => sendResponse({ recording: runtimeState.recording && sender.tab?.id === runtimeState.recordingTabId }));
    return true;
  }

  const handlers = {
    GET_STATE: async () => publicState(await bridgeConnected()),
    START_RECORDING: startRecording,
    STOP_RECORDING: stopRecording,
    REPLAY: () => replayActions(message.recordingId),
    START_SIMULATION: startSimulation,
    PAUSE_SIMULATION: () => pauseSimulation(true),
    RESUME_SIMULATION: () => pauseSimulation(false),
    STOP_SIMULATION: stopSimulation,
    SELECT_ELEMENT: selectElement,
    STOP_SELECTING_ELEMENTS: stopSelectingElements,
    RESET_EXTENSION: resetExtension,
    SET_BREAKPOINT: () => setBreakpoint(message.index),
    CAPTURE_SCREENSHOT: captureScreenshot,
  };

  const handler = handlers[message.type];
  if (!handler) return false;
  stateReady.then(handler)
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
    persistState();
  }
});
