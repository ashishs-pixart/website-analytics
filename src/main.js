const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const CDP = require('chrome-remote-interface');
const { NetworkWatchStore } = require('./network-watch-store');

let mainWindow;
let activeClient = null;
let activeTarget = null;
let extensionBridge = null;
let networkWatchStore = null;
let copilotProcess = null;
const EXTENSION_BRIDGE_PORT = 9231;
const EXTENSION_BRIDGE_HOST = process.env.NETWORK_WATCH_BRIDGE_HOST || '127.0.0.1';
const extensionState = {
  screenshots: [],
  recordings: [],
  lastExtensionActivity: null,
};

function extensionStateSnapshot() {
  return {
    ...extensionState,
    recordings: networkWatchStore
      ? networkWatchStore.recordings.map(({ requestEvidence, ...recording }) => recording)
      : extensionState.recordings,
    connected: extensionState.lastExtensionActivity
      ? Date.now() - new Date(extensionState.lastExtensionActivity).getTime() < 15000
      : false,
    bridgePort: EXTENSION_BRIDGE_PORT,
  };
}

function readJsonBody(request, sendJson, callback) {
  let body = '';
  let tooLarge = false;
  request.setEncoding('utf8');
  request.on('data', chunk => {
    if (tooLarge) return;
    body += chunk;
    if (body.length > 32 * 1024 * 1024) {
      tooLarge = true;
      sendJson(413, { ok: false, error: 'Payload too large' });
      request.destroy();
    }
  });
  request.on('end', () => {
    if (tooLarge) return;
    try {
      const value = body ? JSON.parse(body) : {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
      callback(value);
    } catch (error) {
      sendJson(400, { ok: false, error: `Invalid JSON: ${error.message}` });
    }
  });
}

function startExtensionBridge() {
  if (extensionBridge) return;

  extensionBridge = http.createServer((request, response) => {
    const origin = request.headers.origin;
    const requestUrl = new URL(request.url, `http://127.0.0.1:${EXTENSION_BRIDGE_PORT}`);
    if (origin && !origin.startsWith('chrome-extension://')) {
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: false, error: 'Only Chrome extensions may use this bridge.' }));
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin || '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    response.setHeader('Cache-Control', 'no-store');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const sendJson = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      extensionState.lastExtensionActivity = new Date().toISOString();
      sendJson(200, { ok: true, app: 'Network Watch', port: EXTENSION_BRIDGE_PORT });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/state') {
      sendJson(200, { ok: true, state: extensionStateSnapshot() });
      return;
    }

    if (request.method === 'DELETE' && requestUrl.pathname === '/api/state') {
      extensionState.screenshots = [];
      networkWatchStore.clearRecordings();
      sendJson(200, { ok: true, state: extensionStateSnapshot() });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/recordings') {
      const result = networkWatchStore.listRecordings({ limit: requestUrl.searchParams.get('limit'), cursor: requestUrl.searchParams.get('cursor') });
      sendJson(200, { ok: true, ...result });
      return;
    }

    const recordingMatch = requestUrl.pathname.match(/^\/api\/recordings\/(REC-[^/]+)$/);
    if (request.method === 'GET' && recordingMatch) {
      const recording = networkWatchStore.getRecording(decodeURIComponent(recordingMatch[1]));
      sendJson(recording ? 200 : 404, recording ? { ok: true, recording } : { ok: false, error: 'Recording not found' });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/replay-jobs') {
      readJsonBody(request, sendJson, value => {
        try {
          const job = networkWatchStore.createReplayJob(value.recordingId, value.idempotencyKey || null);
          sendJson(202, { ok: true, job });
        } catch (error) {
          sendJson(404, { ok: false, error: error.message });
        }
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/replay-jobs/next') {
      const claimed = networkWatchStore.claimReplayJob();
      sendJson(200, { ok: true, claimed });
      return;
    }

    const replayJobMatch = requestUrl.pathname.match(/^\/api\/replay-jobs\/(REPLAY-[^/]+)$/);
    if (request.method === 'GET' && replayJobMatch) {
      const job = networkWatchStore.getReplayJob(decodeURIComponent(replayJobMatch[1]));
      sendJson(job ? 200 : 404, job ? { ok: true, job } : { ok: false, error: 'Replay run not found' });
      return;
    }

    const replayFailureMatch = requestUrl.pathname.match(/^\/api\/replay-jobs\/(REPLAY-[^/]+)\/fail$/);
    if (request.method === 'POST' && replayFailureMatch) {
      readJsonBody(request, sendJson, value => {
        const job = networkWatchStore.failReplayJob(decodeURIComponent(replayFailureMatch[1]), value.error);
        sendJson(job ? 200 : 404, job ? { ok: true, job } : { ok: false, error: 'Replay run not found' });
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/export/recording') {
      try {
        const result = networkWatchStore.exportRecording({
          recordingId: requestUrl.searchParams.get('recordingId'),
          runId: requestUrl.searchParams.get('runId'),
          format: requestUrl.searchParams.get('format') === 'json' ? 'json' : 'markdown',
        });
        sendJson(200, { ok: true, ...result });
      } catch (error) {
        sendJson(404, { ok: false, error: error.message });
      }
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/export/network') {
      const result = networkWatchStore.exportNetwork(requestUrl.searchParams.get('format') === 'markdown' ? 'markdown' : 'json');
      sendJson(200, { ok: true, ...result });
      return;
    }

    const collection = requestUrl.pathname === '/api/screenshots'
      ? extensionState.screenshots
      : requestUrl.pathname === '/api/recordings'
        ? extensionState.recordings
        : null;
    const collectionLimit = requestUrl.pathname === '/api/screenshots' ? 30 : 100;

    if (request.method !== 'POST' || !collection) {
      sendJson(404, { ok: false, error: 'Not found' });
      return;
    }

    readJsonBody(request, sendJson, value => {
      try {
        extensionState.lastExtensionActivity = new Date().toISOString();
        if (requestUrl.pathname === '/api/recordings') {
          const recording = networkWatchStore.addRecording(value);
          sendJson(201, { ok: true, recording });
        } else {
          collection.unshift(value);
          if (collection.length > collectionLimit) collection.length = collectionLimit;
          sendJson(201, { ok: true });
        }
      } catch (error) {
        sendJson(400, { ok: false, error: `Invalid JSON: ${error.message}` });
      }
    });
  });

  extensionBridge.on('error', error => {
    console.error(`Extension bridge failed on ${EXTENSION_BRIDGE_HOST}:${EXTENSION_BRIDGE_PORT}:`, error.message);
  });
  extensionBridge.listen(EXTENSION_BRIDGE_PORT, EXTENSION_BRIDGE_HOST);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));

  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll' },
    ]).popup({ window: mainWindow });
  });

  mainWindow.on('closed', () => {
    disconnectCDP();
    mainWindow = null;
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Export Requests...', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('export-requests') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'How to enable remote debugging',
          click: () => mainWindow?.webContents.send('show-help'),
        },
        {
          label: 'DevTools Protocol Reference',
          click: () => shell.openExternal('https://chromedevtools.github.io/devtools-protocol/'),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function emitNetworkEvent(event) {
  networkWatchStore?.addNetworkEvent(event);
  mainWindow?.webContents.send('network-event', event);
}

app.whenReady().then(() => {
  networkWatchStore = new NetworkWatchStore(path.join(app.getPath('userData'), 'network-watch-store.json'));
  startExtensionBridge();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

async function disconnectCDP() {
  if (activeClient) {
    try { await activeClient.close(); } catch (_) {}
    activeClient = null;
    activeTarget = null;
  }
}

function fileExists(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

function findExecutableOnPath(names) {
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];

  for (const dir of pathDirs) {
    for (const name of names) {
      for (const ext of extensions) {
        const candidate = path.join(dir, name.endsWith(ext.toLowerCase()) || name.endsWith(ext) ? name : `${name}${ext}`);
        if (fileExists(candidate)) return candidate;
      }
    }
  }

  return null;
}

function findInstalledBrowsers() {
  const browsers = [];
  const add = (id, name, executablePath) => {
    if (fileExists(executablePath) && !browsers.some(browser => browser.executablePath === executablePath)) {
      browsers.push({ id, name, executablePath });
    }
  };

  if (process.platform === 'win32') {
    const roots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);

    for (const root of roots) {
      add('chrome', 'Google Chrome', path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      add('brave', 'Brave', path.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
      add('edge', 'Microsoft Edge', path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    add('chrome', 'Google Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    add('brave', 'Brave', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
    add('edge', 'Microsoft Edge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    add('chrome', 'Google Chrome / Chromium', findExecutableOnPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']));
    add('brave', 'Brave', findExecutableOnPath(['brave-browser', 'brave']));
    add('edge', 'Microsoft Edge', findExecutableOnPath(['microsoft-edge', 'microsoft-edge-stable', 'msedge']));
  }

  return browsers;
}

ipcMain.handle('start-browser-debug', async (_event, { port = 9222 } = {}) => {
  const browsers = findInstalledBrowsers();

  if (!browsers.length) {
    return { ok: false, error: 'Could not find Chrome, Brave, or Edge on this system.' };
  }

  const buttons = [...browsers.map(browser => browser.name), 'Cancel'];
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Start Browser',
    message: 'Select a browser to start in debug mode.',
    detail: browsers.map(browser => `${browser.name}: ${browser.executablePath}`).join('\n'),
    buttons,
    cancelId: buttons.length - 1,
  });

  if (result.response === buttons.length - 1) return { ok: false, canceled: true };

  const browser = browsers[result.response];
  const debugPort = Number(port) || 9222;
  const profileDir = path.join(app.getPath('userData'), 'debug-profiles', browser.id);
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    args.unshift('--disable-dev-shm-usage', '--no-sandbox');
  }

  try {
    const child = spawn(browser.executablePath, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return {
      ok: true,
      browser: browser.name,
      executablePath: browser.executablePath,
      host: 'localhost',
      port: debugPort,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('list-targets', async (_event, { host = 'localhost', port = 9222 }) => {
  try {
    const targets = await CDP.List({ host, port: Number(port) });
    return {
      ok: true,
      targets: targets
        .filter(t => t.type === 'page')
        .map(t => ({
          id: t.id,
          title: t.title || '(untitled)',
          url: t.url,
          type: t.type,
          webSocketDebuggerUrl: t.webSocketDebuggerUrl,
        })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('attach-target', async (_event, { host = 'localhost', port = 9222, targetId }) => {
  await disconnectCDP();

  try {
    const client = await CDP({ host, port: Number(port), target: targetId });
    const { Network, Page } = client;

    activeClient = client;
    activeTarget = targetId;

    await Network.enable({ maxPostDataSize: 65536, maxResourceBufferSize: 10485760 });
    await Page.enable();

    Network.requestWillBeSent(params => {
      emitNetworkEvent({
        type: 'request',
        requestId: params.requestId,
        loaderId: params.loaderId,
        timestamp: params.timestamp,
        wallTime: params.wallTime,
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData || null,
        hasPostData: params.request.hasPostData || false,
        resourceType: params.type,
        initiator: params.initiator,
        redirectResponse: params.redirectResponse || null,
      });
    });

    Network.requestWillBeSentExtraInfo?.(params => {
      emitNetworkEvent({
        type: 'request-extra',
        requestId: params.requestId,
        headers: params.headers,
        associatedCookies: params.associatedCookies,
      });
    });

    Network.responseReceived(params => {
      emitNetworkEvent({
        type: 'response',
        requestId: params.requestId,
        timestamp: params.timestamp,
        url: params.response.url,
        status: params.response.status,
        statusText: params.response.statusText,
        headers: params.response.headers,
        mimeType: params.response.mimeType,
        remoteIPAddress: params.response.remoteIPAddress,
        remotePort: params.response.remotePort,
        fromCache: Boolean(params.response.fromCache || params.response.fromDiskCache || params.response.fromPrefetchCache),
        protocol: params.response.protocol,
        timing: params.response.timing,
        securityDetails: params.response.securityDetails,
        resourceType: params.type,
      });
    });

    Network.responseReceivedExtraInfo?.(params => {
      emitNetworkEvent({
        type: 'response-extra',
        requestId: params.requestId,
        headers: params.headers,
        blockedCookies: params.blockedCookies,
        statusCode: params.statusCode,
        headersText: params.headersText,
      });
    });

    Network.loadingFinished(params => {
      emitNetworkEvent({
        type: 'finished',
        requestId: params.requestId,
        timestamp: params.timestamp,
        encodedDataLength: params.encodedDataLength,
      });
    });

    Network.loadingFailed(params => {
      emitNetworkEvent({
        type: 'failed',
        requestId: params.requestId,
        timestamp: params.timestamp,
        errorText: params.errorText,
        canceled: params.canceled,
        blockedReason: params.blockedReason,
        corsErrorStatus: params.corsErrorStatus,
      });
    });

    Network.webSocketCreated(params => {
      emitNetworkEvent({
        type: 'ws-created',
        requestId: params.requestId,
        url: params.url,
        initiator: params.initiator,
      });
    });

    Network.webSocketFrameSent(params => {
      emitNetworkEvent({
        type: 'ws-sent',
        requestId: params.requestId,
        timestamp: params.timestamp,
        payload: params.response.payloadData,
        opcode: params.response.opcode,
      });
    });

    Network.webSocketFrameReceived(params => {
      emitNetworkEvent({
        type: 'ws-received',
        requestId: params.requestId,
        timestamp: params.timestamp,
        payload: params.response.payloadData,
        opcode: params.response.opcode,
      });
    });

    client.on('disconnect', () => {
      mainWindow?.webContents.send('target-disconnected', { targetId: activeTarget });
      activeClient = null;
      activeTarget = null;
    });

    return { ok: true };
  } catch (err) {
    await disconnectCDP();
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-response-body', async (_event, { requestId }) => {
  if (!activeClient) return { ok: false, error: 'Not connected' };
  try {
    const result = await activeClient.Network.getResponseBody({ requestId });
    return { ok: true, body: result.body, base64Encoded: result.base64Encoded };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('save-file', async (_event, { defaultPath, content }) => {
  if (!mainWindow) return { ok: false, error: 'No window available' };
  const extension = path.extname(defaultPath).toLowerCase();
  const preferredFilter = extension === '.md'
    ? { name: 'Markdown files', extensions: ['md'] }
    : extension === '.json'
      ? { name: 'JSON files', extensions: ['json'] }
      : { name: 'HAR files', extensions: ['har'] };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: [preferredFilter, { name: 'All files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('select-copilot-directory', async () => {
  if (!mainWindow) return { ok: false, error: 'No window available' };
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: 'Select the code directory for Copilot',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
  return { ok: true, directory: selected.filePaths[0] };
});

ipcMain.handle('start-copilot', async (_event, { prompt, directory, continueSession = false }) => {
  if (!mainWindow) return { ok: false, error: 'No window available' };
  if (copilotProcess) return { ok: false, error: 'A Copilot task is already running.' };
  if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, error: 'The prompt is empty.' };
  let validDirectory = false;
  try { validDirectory = typeof directory === 'string' && fs.statSync(directory).isDirectory(); } catch (_) {}
  if (!validDirectory) {
    return { ok: false, error: 'Select a valid code directory.' };
  }

  const executablePath = findExecutableOnPath(['copilot']);
  if (!executablePath) {
    return { ok: false, error: 'GitHub Copilot CLI was not found on PATH. Install it and sign in, then restart Network Watch.' };
  }

  const approval = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Send to Copilot', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Allow Copilot to work on this directory?',
    message: 'Copilot will be allowed to edit files and run commands.',
    detail: `Directory: ${directory}\n\nReview the generated prompt before continuing. Copilot will run in bounded autopilot mode (up to 10 continuations).`,
  });
  if (approval.response !== 0) return { ok: false, canceled: true };

  try {
    const args = [
      '--autopilot',
      '--allow-all',
      '--max-autopilot-continues', '10',
      '--no-color',
    ];
    if (continueSession) args.push('--continue');
    args.push('-p', prompt);
    const child = spawn(executablePath, args, {
      cwd: directory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    copilotProcess = child;
    const send = (kind, data = {}) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('copilot-event', { kind, ...data });
    };
    child.stdout.on('data', chunk => send('output', { stream: 'stdout', text: chunk.toString() }));
    child.stderr.on('data', chunk => send('output', { stream: 'stderr', text: chunk.toString() }));
    child.on('error', error => {
      send('error', { error: error.message });
      if (copilotProcess === child) copilotProcess = null;
    });
    child.on('close', (code, signal) => {
      send('exit', { code, signal });
      if (copilotProcess === child) copilotProcess = null;
    });
    return { ok: true, directory };
  } catch (error) {
    copilotProcess = null;
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('stop-copilot', async () => {
  if (!copilotProcess) return { ok: true };
  const child = copilotProcess;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      killer.on('error', () => child.kill());
    } else if (child.pid) {
      process.kill(-child.pid, 'SIGTERM');
      const forceKill = setTimeout(() => {
        if (copilotProcess === child && child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
        }
      }, 3000);
      forceKill.unref();
    } else {
      child.kill('SIGTERM');
    }
    return { ok: true };
  } catch (error) {
    if (error.code === 'ESRCH') return { ok: true };
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('get-extension-data', async () => ({ ok: true, state: extensionStateSnapshot() }));

ipcMain.handle('clear-extension-data', async () => {
  extensionState.screenshots = [];
  networkWatchStore.clearRecordings();
  return { ok: true, state: extensionStateSnapshot() };
});

ipcMain.handle('detach', async () => {
  await disconnectCDP();
  return { ok: true };
});
