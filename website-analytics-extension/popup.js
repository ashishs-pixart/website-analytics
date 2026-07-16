const elements = {
  bridge: document.querySelector('#bridge-status'),
  actionCount: document.querySelector('#action-count'),
  record: document.querySelector('#record'),
  replay: document.querySelector('#replay'),
  simulate: document.querySelector('#simulate'),
  pause: document.querySelector('#pause'),
  stop: document.querySelector('#stop'),
  resolution: document.querySelector('#resolution'),
  selectElement: document.querySelector('#select-element'),
  screenshot: document.querySelector('#screenshot'),
  selectedElement: document.querySelector('#selected-element'),
  message: document.querySelector('#message'),
};

let state = null;
let busy = false;

function showMessage(message, kind = '') {
  elements.message.textContent = message || '';
  elements.message.className = kind;
}

function render(nextState) {
  if (!nextState) return;
  state = nextState;
  const simulation = state.simulation || {};
  elements.bridge.textContent = state.bridgeConnected ? 'Network Watch connected' : 'Network Watch offline';
  elements.bridge.classList.toggle('online', state.bridgeConnected);
  elements.actionCount.textContent = String(state.actionCount || 0);
  elements.record.textContent = state.recording ? 'Stop recording' : 'Record';
  elements.record.classList.toggle('recording', state.recording);
  elements.replay.disabled = busy || state.recording || state.replaying || !state.actionCount;
  elements.replay.textContent = state.replaying ? 'Replaying...' : 'Replay';
  elements.simulate.disabled = busy || simulation.active;
  elements.pause.disabled = busy || !simulation.active;
  elements.stop.disabled = busy || !simulation.active;
  elements.pause.textContent = simulation.paused ? 'Resume' : 'Pause';
  const currentBreakpoint = state.breakpoints?.find((breakpoint) => breakpoint.width === simulation.width && breakpoint.height === simulation.height);
  elements.resolution.textContent = simulation.active
    ? `${simulation.width} × ${simulation.height}${currentBreakpoint ? ` · ${currentBreakpoint.label}` : ''}`
    : 'Not simulating';
  elements.selectElement.disabled = busy || !simulation.active || !simulation.paused;
  elements.screenshot.disabled = busy || !simulation.active || !simulation.paused || !state.bridgeConnected;
  elements.selectedElement.textContent = state.selectedElement?.selector || 'No element selected';
  elements.selectedElement.title = state.selectedElement?.selector || '';
}

async function request(type) {
  busy = true;
  if (state) render(state);
  showMessage('Working...');
  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.ok) throw new Error(response?.error || 'The extension could not complete this action.');
    if (response.state) render(response.state);
    else if (response.simulation || response.actionCount !== undefined) render(response);
    showMessage(type === 'CAPTURE_SCREENSHOT' ? 'Screenshot sent to Network Watch.' : '', type === 'CAPTURE_SCREENSHOT' ? 'success' : '');
    return response;
  } catch (error) {
    showMessage(error.message, 'error');
    if (error.state) render(error.state);
    return null;
  } finally {
    busy = false;
    if (state) render(state);
  }
}

async function refresh() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (response?.ok) render(response.state || response);
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

elements.record.addEventListener('click', () => request(state?.recording ? 'STOP_RECORDING' : 'START_RECORDING'));
elements.replay.addEventListener('click', () => request('REPLAY'));
elements.simulate.addEventListener('click', () => request('START_SIMULATION'));
elements.pause.addEventListener('click', () => request(state?.simulation?.paused ? 'RESUME_SIMULATION' : 'PAUSE_SIMULATION'));
elements.stop.addEventListener('click', () => request('STOP_SIMULATION'));
elements.selectElement.addEventListener('click', async () => {
  const response = await request('SELECT_ELEMENT');
  if (response) showMessage('Click an element on the page. Press Escape to cancel.');
  window.close();
});
elements.screenshot.addEventListener('click', () => request('CAPTURE_SCREENSHOT'));

refresh();
setInterval(refresh, 900);
