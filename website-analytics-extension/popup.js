const elements = {
  bridge: document.querySelector('#bridge-status'),
  actionCount: document.querySelector('#action-count'),
  record: document.querySelector('#record'),
  replay: document.querySelector('#replay'),
  replayRecording: document.querySelector('#replay-recording'),
  simulate: document.querySelector('#simulate'),
  pause: document.querySelector('#pause'),
  stop: document.querySelector('#stop'),
  resolution: document.querySelector('#resolution'),
  breakpointControl: document.querySelector('#breakpoint-control'),
  breakpointSlider: document.querySelector('#breakpoint-slider'),
  breakpointSliderLabel: document.querySelector('#breakpoint-slider-label'),
  selectElement: document.querySelector('#select-element'),
  screenshot: document.querySelector('#screenshot'),
  selectedElement: document.querySelector('#selected-element'),
  captureCount: document.querySelector('#capture-count'),
  reset: document.querySelector('#reset'),
  message: document.querySelector('#message'),
};

let state = null;
let busy = false;
let selectedRecordingId = '';

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
  const recordings = state.recordings || [];
  if (!recordings.some(recording => recording.id === selectedRecordingId)) selectedRecordingId = recordings[0]?.id || '';
  const selectedRecording = recordings.find(recording => recording.id === selectedRecordingId);
  const recordingSignature = recordings.length
    ? recordings.map(recording => `${recording.id}:${recording.actions.length}:${recording.stoppedAt || ''}`).join('|')
    : state.recording ? `recording:${state.actionCount || 0}` : 'empty';
  if (elements.replayRecording.dataset.signature !== recordingSignature) {
    const options = recordings.map((recording, index) => {
      const option = document.createElement('option');
      option.value = recording.id;
      const date = recording.stoppedAt || recording.startedAt;
      const when = date ? new Date(date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : `Recording ${index + 1}`;
      option.textContent = `${index === 0 ? 'Latest · ' : ''}${when} · ${recording.actions.length} actions · ${recording.title || recording.url || recording.id}`;
      return option;
    });
    if (!options.length) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = state.recording
        ? `Recording in progress · ${state.actionCount || 0} actions`
        : 'No completed recordings yet';
      options.push(placeholder);
    }
    elements.replayRecording.replaceChildren(...options);
    elements.replayRecording.dataset.signature = recordingSignature;
  }
  elements.replayRecording.value = selectedRecordingId;
  elements.replayRecording.disabled = busy || state.recording || state.replaying || !recordings.length;
  elements.actionCount.textContent = String(state.recording ? state.actionCount || 0 : selectedRecording?.actions.length || 0);
  elements.record.textContent = state.recording ? 'Stop recording' : 'Record';
  elements.record.classList.toggle('recording', state.recording);
  elements.replay.disabled = busy || state.recording || state.replaying || !selectedRecording?.actions.length;
  elements.replay.textContent = state.replaying ? 'Replaying...' : 'Replay';
  elements.simulate.disabled = busy || simulation.active;
  elements.pause.disabled = busy || !simulation.active;
  elements.stop.disabled = busy || !simulation.active;
  elements.pause.textContent = simulation.paused ? 'Resume' : 'Pause';
  const currentBreakpoint = state.breakpoints?.find((breakpoint) => breakpoint.width === simulation.width && breakpoint.height === simulation.height);
  elements.resolution.textContent = simulation.active
    ? `${simulation.width} × ${simulation.height}${currentBreakpoint ? ` · ${currentBreakpoint.label}` : ''}`
    : 'Not simulating';
  const selectedIndex = simulation.currentIndex ?? Math.max(0, (simulation.presetIndex || 1) - 1);
  elements.breakpointControl.hidden = !simulation.active || !simulation.paused;
  elements.breakpointSlider.max = String(Math.max(0, (state.breakpoints?.length || 1) - 1));
  elements.breakpointSlider.value = String(selectedIndex);
  const sliderBreakpoint = state.breakpoints?.[selectedIndex];
  elements.breakpointSliderLabel.textContent = sliderBreakpoint ? `${sliderBreakpoint.width} × ${sliderBreakpoint.height}` : '';
  elements.selectElement.disabled = busy;
  elements.selectElement.textContent = state.selectingElements ? 'Stop selecting elements' : 'Select elements';
  elements.screenshot.disabled = busy || !simulation.active || !state.bridgeConnected;
  const selections = state.selectedElements || [];
  elements.selectedElement.textContent = selections.length ? `${selections.length} selected · ${selections.map(element => element.selector).join(', ')}` : 'No elements selected';
  elements.selectedElement.title = selections.map(element => element.selector).join('\n');
  const captureCount = state.capturedBreakpoints?.length || 0;
  elements.captureCount.textContent = `${captureCount} breakpoint capture${captureCount === 1 ? '' : 's'} added`;
  elements.reset.disabled = busy;
}

async function request(type, data = {}) {
  busy = true;
  if (state) render(state);
  showMessage('Working...');
  try {
    const response = await chrome.runtime.sendMessage({ type, ...data });
    if (!response?.ok) throw new Error(response?.error || 'The extension could not complete this action.');
    if (response.state) render(response.state);
    else if (response.simulation || response.actionCount !== undefined) render(response);
    if (type === 'CAPTURE_SCREENSHOT') showMessage('Breakpoint capture added to Network Watch.', 'success');
    else if (type === 'START_RECORDING') showMessage('Recording started. Perform actions on the website, then stop recording.', 'success');
    else if (type === 'STOP_RECORDING') {
      const savedRecording = (response.recordings || response.state?.recordings || []).find(recording => recording.id === (response.recordingId || response.state?.recordingId));
      showMessage(savedRecording?.actions?.length
        ? `Recording saved with ${savedRecording.actions.length} action${savedRecording.actions.length === 1 ? '' : 's'}.`
        : 'No actions were captured, so there is nothing to replay. Reload the website tab and record again.', savedRecording?.actions?.length ? 'success' : 'error');
    }
    else if (type === 'REPLAY' && response.replaySummary) {
      const { successfulActions, failedActions } = response.replaySummary;
      showMessage(`Replay finished: ${successfulActions} succeeded, ${failedActions} failed.`, failedActions ? 'error' : 'success');
    } else showMessage('');
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
elements.replay.addEventListener('click', () => request('REPLAY', { recordingId: selectedRecordingId }));
elements.replayRecording.addEventListener('change', (event) => {
  selectedRecordingId = event.target.value;
  if (state) render(state);
});
elements.simulate.addEventListener('click', () => request('START_SIMULATION'));
elements.pause.addEventListener('click', () => request(state?.simulation?.paused ? 'RESUME_SIMULATION' : 'PAUSE_SIMULATION'));
elements.stop.addEventListener('click', () => request('STOP_SIMULATION'));
elements.selectElement.addEventListener('click', async () => {
  if (state?.selectingElements) {
    await request('STOP_SELECTING_ELEMENTS');
    return;
  }
  const response = await request('SELECT_ELEMENT');
  if (response) {
    showMessage('Picker active. Select as many elements as needed, then reopen this popup to stop.');
    window.close();
  }
});
elements.screenshot.addEventListener('click', () => request('CAPTURE_SCREENSHOT'));
elements.reset.addEventListener('click', () => request('RESET_EXTENSION'));
elements.breakpointSlider.addEventListener('input', event => {
  const breakpoint = state?.breakpoints?.[Number(event.target.value)];
  elements.breakpointSliderLabel.textContent = breakpoint ? `${breakpoint.width} × ${breakpoint.height}` : '';
});
elements.breakpointSlider.addEventListener('change', event => request('SET_BREAKPOINT', { index: Number(event.target.value) }));

refresh();
setInterval(refresh, 900);
