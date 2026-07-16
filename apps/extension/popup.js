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

function startBackgroundShader() {
  const canvas = document.querySelector('#shader-background');
  const gl = canvas?.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vertex = compile(gl.VERTEX_SHADER, `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }
  `);
  const fragment = compile(gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec2 resolution;
    uniform float time;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    void main() {
      vec2 uv = gl_FragCoord.xy / resolution;
      float scan = sin((uv.y * 240.0) + time * 0.8) * 0.018;
      float beam = smoothstep(0.8, 0.0, abs(fract(uv.y * 8.0 + time * 0.025) - 0.5)) * 0.035;
      float grain = (hash(floor(gl_FragCoord.xy * 0.5) + time) - 0.5) * 0.025;
      float vignette = 1.0 - smoothstep(0.15, 0.92, length(uv - 0.5) * 1.35);
      float light = max(0.0, 0.025 + scan + beam + grain + vignette * 0.055);
      gl_FragColor = vec4(vec3(light), 0.92);
    }
  `);
  if (!vertex || !fragment) return;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.useProgram(program);
  const position = gl.getAttribLocation(program, 'position');
  const resolution = gl.getUniformLocation(program, 'resolution');
  const time = gl.getUniformLocation(program, 'time');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const draw = timestamp => {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(canvas.clientWidth * scale);
    const height = Math.round(canvas.clientHeight * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    gl.uniform2f(resolution, width, height);
    gl.uniform1f(time, timestamp * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

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
  const selections = state.selectedElements || [];
  elements.screenshot.disabled = busy || !state.bridgeConnected || !selections.length;
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
startBackgroundShader();
