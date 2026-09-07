# Network Watch — complete workflow explanation

Network Watch is an Electron desktop application, a Chrome extension, and an MCP service that work together. It can inspect a Chromium tab's network traffic, capture responsive screenshots and selected-element metadata, record browser journeys, replay them, compare replay traffic to the original traffic, and make the resulting evidence available to people and coding agents.

## 1. Components and their responsibilities

| Component | Responsibility |
| --- | --- |
| Electron main process (`apps/desktop/src/main.js`) | Opens the desktop window, connects to the Chrome DevTools Protocol (CDP), receives extension data over a localhost bridge, persists recordings, and starts Copilot CLI. |
| React renderer (`apps/desktop/src/renderer/src`) | Displays Network and Inspect modes, filters/exports requests, reviews screenshots and recordings, and hosts the Copilot sidebar. |
| Preload bridge (`apps/desktop/src/preload.js`) | Exposes a small, typed IPC API to the renderer while keeping Node.js disabled in the UI. |
| Chrome extension background worker | Owns extension state, controls recording, replay, responsive emulation, screenshots, and polling for MCP replay work. |
| Chrome extension content script | Observes browser interactions, collects element metadata, displays overlays, resolves replay targets, and carries out DOM-level replay fallbacks. |
| Durable store (`packages/store/src/network-watch-store.js`) | Saves original recordings, replay runs, replay jobs, redacted request evidence, comparisons, and agent-facing exports. |
| MCP server (`services/mcp/`) | Exposes recordings, replay, comparison, and exports as MCP tools through stdio or Streamable HTTP. |

The Electron package includes `apps/extension` as an external runtime resource. **Start Browser** opens `chrome://extensions` in a persistent dedicated debug profile. The user loads the revealed extension folder once, and that profile retains it for later launches.

## 2. Desktop application startup and local bridge

1. `pnpm start` builds the React renderer with Vite, then launches Electron.
2. Electron creates a BrowserWindow with `contextIsolation: true` and `nodeIntegration: false`.
3. Electron starts an HTTP bridge on `127.0.0.1:9231`. It deliberately rejects non-`chrome-extension://` origins.
4. The bridge provides health, extension-state, recording, replay-job, screenshot, and export routes. The extension uses this bridge; the renderer never reaches it directly.
5. The durable `NetworkWatchStore` loads the prior saved recordings and replay jobs from Electron's user-data directory. Interrupted `running` jobs are returned to `queued` on startup.
6. The React renderer calls the preload IPC methods for browser/CDP operations, file saving, extension data, and Copilot process events.

## 3. Network mode: connecting to a browser and collecting traffic

### 3.1 Browser connection

1. The user may start a supported Chromium browser from the toolbar, or start one manually with `--remote-debugging-port=9222`.
2. The desktop app queries the Chrome remote-debugging endpoint, lists page targets, and lets the user choose one.
3. Electron connects to the selected target with `chrome-remote-interface`, which speaks the Chrome DevTools Protocol.
4. It enables the CDP Network domain and listens for request, extra-request-header, response, extra-response-header, loading-finished, loading-failed, and WebSocket events.

### 3.2 Request model and display

1. Each CDP event updates the request record identified by CDP `requestId`.
2. The renderer keeps the live request map and ordered IDs in its capture reducer.
3. Network mode displays a request table, status/type/search filters, error-only filtering, request details, headers, payload, timing, and WebSocket frames.
4. Response bodies are not downloaded automatically. When the user requests one, the renderer asks Electron to call `Network.getResponseBody` through CDP and caches the result locally.
5. Detaching a target closes the CDP connection and updates the UI status.

### 3.3 Passive response security analysis

The Network table computes a local security rating for each response. Document and API responses use different applicable checks. The analyzer reviews encrypted transport, browser security headers, CORS, cookie attributes, caching of sensitive responses, server disclosure, and error details. After a response body is loaded, it also inspects JSON key names for possible secret or personal-data exposure without displaying the corresponding values. The rating is evidence-based triage rather than proof that an endpoint is secure or vulnerable.

### 3.4 Network exports

The top-right **Export** button is mode-aware. In Network mode it opens the request export dialog; in Inspect mode it opens the improvement-prompt dialog. The application menu shortcut `Cmd/Ctrl+E` calls the same mode-aware function.

The current Network export dialog supports these outcomes:

- Selected-field export: writes the selected request fields as Markdown.
- Postman export: writes a JSON Postman collection.
- MCP network export: returns the current redacted network snapshot as JSON or Markdown directly to an MCP client.

Selected-field export can include duration, payload, headers, request metadata, and response metadata/body. If response is selected and a completed request body has not been loaded, the app attempts `Network.getResponseBody` before generating the file. Postman export includes method, URL, request headers, and a raw request body when available.

Electron opens the native save-file picker before a desktop file is written. `apps/desktop/src/renderer/src/utils/har.ts` contains a HAR 1.2 builder, but no current button or menu action calls it; therefore HAR is an available implementation utility, not a user-visible export format. The HAR concept is defined by the [W3C HAR 1.2 draft](https://w3c.github.io/web-performance/specs/HAR/Overview.html).

## 4. Extension lifecycle and state

### 4.1 State persistence

The extension background worker has a `runtimeState` containing recording state, actions, up to ten local recordings, simulation state, selected elements, screenshot captures, replay state, and errors.

1. At worker startup it calls `chrome.storage.local.get('websiteAnalyticsState')`.
2. It restores the saved state, but resets transient state such as active replay, active picker, and active emulation because a service worker cannot safely resume those browser operations after restart.
3. It writes all relevant state changes through `chrome.storage.local.set`.
4. The popup asks the background worker for state via `chrome.runtime.sendMessage({ type: 'GET_STATE' })` when it opens, and refreshes approximately every 900 ms while open.

### 4.2 Checking whether Network Watch is available

The extension calls `GET http://127.0.0.1:9231/health` from the background worker. A successful response marks the popup as connected. If the desktop app is unavailable, extension recording can still be stored locally, but the recording will not have Network Watch's request evidence or MCP visibility until it is submitted successfully.

## 5. Journey recording

### 5.1 Starting a recording

1. The user clicks **Record** in the extension popup.
2. The background worker calls `chrome.tabs.query({ active: true, currentWindow: true })` and requires an `http` or `https` tab.
3. It creates a stable recording ID in the form `REC-<UUID>`, captures the tab URL/title and start timestamp, clears any old in-progress actions, persists state, and applies the `REC` badge using `chrome.action`.
4. It sends `{ type: 'SET_RECORDING', recording: true }` to the content script using `chrome.tabs.sendMessage`.

### 5.2 How user actions are detected

The content script registers capturing-phase DOM listeners. Capturing phase lets it see interactions before page handlers can stop bubbling.

| User behavior | Browser API/event used | Recorded behavior |
| --- | --- | --- |
| Click | `document.addEventListener('click', ..., true)` | Records the composed-path actionable target, semantic fingerprint, surrounding context, hierarchy/shadow/XPath fallbacks, coordinates, viewport, URL, and time since the prior action. |
| Text entry | `input` plus `blur` events | Debounces input for 650 ms and records the final value. Password fields are excluded. |
| Select, checkbox, radio, date, range, color | `change` event | Records final value and checked state where applicable. |
| Enter and other non-text keys | `keydown` and `submit` events | Records key/code/modifiers. A submit fallback prevents an Enter submission from being missed. |
| Scroll | `window.addEventListener('scroll', ..., true)` | Debounces for 180 ms and records scroll coordinates. |

Each captured action receives `ACT-<UUID>`. Its locator bundle includes role/accessibility data, test and stable IDs, labels, placeholder, text, sibling/parent context, visible-role index, nearest heading/landmark/form, visual fingerprint, DOM and open-shadow paths, XPath, frame context, and coordinates. The content script sends the action to the background worker with `chrome.runtime.sendMessage({ type: 'RECORDED_ACTION', action })`.

### 5.3 Saving a recording

1. The user clicks **Stop recording**.
2. The background worker tells the content script to stop and flushes the current recording into a recording object containing its `REC-*` ID, URL/title, start/stop timestamps, and actions.
3. If it contains actions, the extension saves it locally in `chrome.storage.local` and keeps the newest ten recordings for extension-only replay.
4. It then sends `POST /api/recordings` to the Electron bridge with the recording JSON.
5. Electron passes the recording to `NetworkWatchStore.addRecording`.
6. The store adds a stable 1-based `sequence` and human-readable description to every action, extracts the original network requests that occurred in each action's evidence window, and writes the recording durably to Electron's user-data directory.
7. If the desktop app is unavailable, the extension tells the user that the recording is saved locally but not connected to Network Watch.

### 5.4 Original request evidence windows

For each action, the desktop store finds captured CDP requests whose wall-clock time falls from 100 ms before that action to the next action (or recording end). The resulting requests are saved under `recording.requestEvidence[action.id]`.

Each saved request is a redacted snapshot. Sensitive URL query parameters, authorization/cookie/API-key headers, and matching JSON/form payload keys are replaced with `[REDACTED]`. Request URLs are also normalized for comparison by dropping volatile cache-busting and analytics query parameters.

## 6. Replay

### 6.1 Manual replay from the extension

1. The user selects a completed `REC-*` recording in the extension popup and clicks **Replay**.
2. The background worker selects that recording, obtains the active website tab, and creates a `REPLAY-<UUID>` replay record.
3. It navigates to the original recording URL or reloads the tab, waiting for completion with `chrome.tabs.onUpdated`.
4. Before each action, it waits for the recorded delay (bounded between 100 and 2500 ms), restores the action's expected URL if navigation drifted, and shows progress in an in-page panel.
5. The content script refreshes the panel after navigations so replay progress remains visible.

### 6.2 How actions are replayed

- Target resolution: the extension prioritizes unique Playwright-style semantic matches, then scores visible candidates using accessibility, labels, text, sibling/parent context, headings, landmarks, forms, class/ancestor overlap, visible-role position, and visual fingerprint. DOM hierarchy, open-shadow hierarchy, XPath, active focus, and coordinates are later fallbacks. Frame URLs are used to rediscover iframe IDs after reloads.
- Clicks: for main-frame clicks it uses the Chrome Debugger API (`chrome.debugger.attach` plus CDP `Input.dispatchMouseEvent`) to produce trusted browser mouse input. If that cannot be used, it asks the content script to perform the DOM fallback.
- Input/change: the content script resolves the target, sets the saved value or checked state, then dispatches the relevant DOM events.
- Keypress: the content script creates and dispatches the saved keyboard event.
- Scroll: the content script scrolls to the saved coordinates.

Every replay action gets a new `ACT-*` ID and a `sourceActionId` that points to the original action. It records execution method, locator method, expected/result URLs, navigation correction, success/failure, and any replay error. A failed action does not terminate the entire sequence; the replay records the failure and continues.

### 6.3 Saving and comparing replay

1. At the end, the extension submits the replay recording through `POST /api/recordings`.
2. The durable store captures replay request evidence using the same action windows.
3. It joins replay actions to original actions using `sourceActionId`, verifies the same ordered sequence, and confirms that every replay action succeeded.
4. It compares each action's baseline and replay requests by fingerprint: uppercase method, normalized URL, and resource type.
5. The comparison reports matched, missing, unexpected, reordered, and status-changed requests. It also carries baseline/replay duration and delta for matched requests.
6. `requestsMatch` is true only if there are no missing, unexpected, reordered, or status-changed requests. A timing regression is reported but does not by itself make requests non-equivalent.

## 7. MCP-triggered replay and extension polling

MCP cannot directly control the browser tab. Instead it creates a durable job that the extension claims.

1. An MCP client invokes `replay_recording` with a `REC-*` ID.
2. The MCP server requests `POST /api/replay-jobs` from the Electron bridge. The store creates a `REPLAY-*` job with `queued` status and optional idempotency key.
3. The extension registers `chrome.alarms.create('network-watch-mcp-replay', { periodInMinutes: 0.5 })`; Chrome calls it every 30 seconds at most, and it also performs an immediate claim when the worker starts.
4. On each alarm, the extension calls `GET /api/replay-jobs/next`.
5. Electron atomically changes the first queued job to `running` and returns both job and source recording.
6. The extension calls the same replay engine described above, passing the supplied source recording and requested run ID.
7. The replay result is submitted as a replay recording. The durable store completes the job and attaches the comparison. If extension replay fails before submission, the extension calls `POST /api/replay-jobs/<runId>/fail`.
8. The MCP client polls `GET /api/replay-jobs/<runId>` until the job is completed, failed, or reaches its timeout.

For this workflow, Network Watch, the extension, and the target browser tab must remain open. The alarm schedule means a newly queued replay can wait up to roughly 30 seconds before it begins.

## 8. Responsive simulation, selected elements, and screenshots

### 8.1 Responsive simulation

1. The user starts simulation in the popup.
2. The extension attaches the Chrome Debugger API to the active tab.
3. It cycles through eleven desktop, tablet, and mobile presets. For each preset it uses CDP `Emulation.setDeviceMetricsOverride`, reloads the page, shows an in-page simulation frame, waits six seconds, then advances.
4. It can be paused, resumed, stopped, or moved directly to a selected breakpoint. Stopping clears CDP device metrics and detaches the debugger.

### 8.2 Element picker and metadata

1. **Select elements** sends `START_PICKER` to the content script.
2. The content script displays a hover/selection overlay and returns metadata through `ELEMENT_SELECTED` messages.
3. Metadata includes selector, outer HTML, matching accessible CSS rules (bounded), computed styles, text/tag/class data, and viewport/page rectangle.
4. The extension stores multiple selections so one screenshot may carry multiple focused elements.

### 8.3 Breakpoint screenshots

1. During responsive simulation, **Add breakpoint capture** refreshes selected-element coordinates immediately before capture.
2. The background worker uses CDP `Page.getLayoutMetrics` and `Page.captureScreenshot`.
3. It packages the image data URL, dimensions, page metadata, selected elements, and capture time.
4. It sends `POST /api/screenshots` to the Electron bridge.
5. Electron keeps up to 30 screenshot records in its current extension state. Screenshots are session data, rather than durable recording-store data.

## 9. Inspect mode and human improvement prompts

Inspect mode is the review workspace for extension data.

- The summary identifies whether the extension bridge is connected and shows screenshot/recording counts.
- Responsive screenshots are grouped in a blue section. Users can preview captures, inspect selected-element metadata, and add screenshot or element-specific feedback.
- Recordings and replays are grouped in a purple section. Users can inspect stable action IDs, execution results, replay errors, URL evidence, related network requests, and per-event change notes.
- The **Create improvement prompt** dialog lets the user choose breakpoint evidence, recorded events/replays, and meaningful request analysis. It produces a Markdown coding prompt containing only the selected evidence and feedback.
- **Export prompt** writes that Markdown prompt via the native save dialog.

The prompt modal validates its scope. Breakpoint export requires at least one screenshot-level or element-level change note; event export requires at least one recorded action, while event-specific notes remain optional. The meaningful-request option identifies failed/error responses, responses taking at least one second, and repeated equivalent request/response signatures.

## 10. Copilot sidebar

The Inspect tab can open **Setup Copilot**. After a directory is chosen, the button becomes **Show Copilot** and the compact directory button lets the user change it.

1. The user chooses a local code directory using Electron's native folder picker.
2. **Generate Prompt** opens the same evidence-selection dialog used for export. **Add to Chat** generates the selected prompt and inserts it into the sidebar chat field; it does not start Copilot yet.
3. The user reviews/edits that text and clicks **Send**. **Run all evidence** is a shortcut that immediately runs a prompt built from all available Inspect evidence.
4. Electron starts GitHub Copilot CLI in the selected directory using programmatic prompt mode, bounded autopilot, no colour output, and a maximum of ten autonomous continuations. It asks for native confirmation because this mode grants Copilot file and command permissions.
5. Standard output and error chunks are sent over Electron IPC to the React sidebar and appended live to the terminal panel.
6. Follow-up chat messages start Copilot with `--continue`, so they continue the latest CLI session in that directory.
7. **Stop** terminates the complete Copilot process tree: on macOS/Linux it signals the detached process group, escalates to `SIGKILL` after three seconds if necessary, and on Windows uses `taskkill /t /f`.
8. The chat field supports normal editing keyboard shortcuts and a native context menu: select all, cut, copy, paste, undo, and redo.

### Export versus Generate Prompt

These two paths deliberately reuse the same evidence builder but have different destinations:

| Entry point | Modal action | Result |
| --- | --- | --- |
| Inspect toolbar **Export** | **Export prompt** | Saves the generated Markdown to a file. |
| Copilot sidebar **Generate Prompt** | **Add to Chat** | Places the generated Markdown in the chat textarea for review; it does not run Copilot. |
| Copilot sidebar **Run all evidence** | No modal | Immediately starts Copilot with all eligible screenshot feedback and all events. |
| Copilot chat **Send** | No evidence modal | Starts a new prompt, or uses `--continue` for a follow-up message. |

The same `makeInspectPrompt` function produces the text, which prevents the file export and chat draft from drifting into different formats.

## 11. MCP server and tools

### 11.1 Transports

- `pnpm run mcp:stdio` starts the MCP server on standard input/output. VS Code and Copilot CLI normally start this themselves.
- `pnpm run mcp:http` starts a Streamable HTTP MCP endpoint, defaulting to `127.0.0.1:9232/mcp`. A bearer token is required when binding beyond localhost.
- Both transports use `NetworkWatchClient`, which calls the Electron bridge at `http://127.0.0.1:9231`.

### 11.2 Tools available to an LLM

| Tool | Effect |
| --- | --- |
| `list_recordings` | Read-only paginated list of original recordings, count, stable action IDs, sequence, descriptions, and request counts. |
| `get_recording` | Read-only complete `REC-*` recording with baseline request evidence. |
| `replay_recording` | Side-effecting replay job creation and completion/polling result, including action and request comparison. |
| `get_replay_result` | Read-only lookup of a `REPLAY-*` job. |
| `export_recording_analysis` | Read-only Markdown or JSON export of one recording, optional replay, and comparison. |
| `export_network_capture` | Read-only Markdown or JSON export of the current redacted CDP network capture. |

Each tool declares input/output schemas, structured MCP content, a text fallback, and annotations that distinguish read-only tools from replay's side effect.

## 12. VS Code and Copilot CLI MCP setup

### VS Code

1. Keep Network Watch running.
2. Open this repository or add an absolute-path server configuration to another workspace/user MCP configuration.
3. The local workspace declaration is `.vscode/mcp.json`; it runs `node services/mcp/stdio.mjs` and supplies `NETWORK_WATCH_URL=http://127.0.0.1:9231`.
4. Run **MCP: List Servers**, start `network-watch`, approve trust, then use Copilot Chat in Agent mode.

### GitHub Copilot CLI

1. Install Copilot CLI and authenticate with `copilot login`.
2. `.mcp.json` provides the same local stdio server declaration for this repository.
3. Start `copilot`, use `/mcp` to confirm `network-watch`, then ask it to list recordings, replay one, or call an export tool.

## 13. Security boundaries and data handling

- The extension bridge is loopback-only (`127.0.0.1`). Browser-originated requests are accepted only from `chrome-extension://` origins; local server clients such as the MCP process send no browser `Origin` header.
- The UI is isolated from Node.js; only explicit preload IPC methods are exposed.
- Sensitive URL parameters, common secret headers, and matching request-body fields are redacted before durable storage and MCP/network export.
- Password entry is intentionally excluded from recording.
- Replay is side-effecting: it can click, type, navigate, and regenerate requests in the active tab. Use disposable or safe test environments.
- The remote MCP endpoint must not expose the extension bridge. For remote use, deploy/tunnel the separate MCP endpoint with HTTPS and appropriate authentication.

## 14. Reset and cleanup behavior

**Reset extension and website** stops recording and the picker, clears simulation overlays/device metrics, detaches the extension debugger, resets extension state, removes the recording badge, and reloads affected tabs when possible. In the desktop Inspect view, **Clear extension data** clears screenshots plus durable recordings/replay jobs from Network Watch's store.

## 15. Complete feature audit

This section lists every meaningful user-visible feature found in the current implementation and connects it to the workflow above.

### Desktop toolbar and application menu

- Host and port fields choose the remote-debugging endpoint; they lock while connected.
- **Start Browser** discovers Chrome/Chromium, Brave, or Edge, asks which one to use, creates a dedicated debug profile, and starts it with a loopback-only remote-debugging port.
- **Scan** lists page targets and automatically selects the first result.
- The tab selector shows a truncated title and URL while retaining the full value as a tooltip.
- **Connect** attaches CDP and changes status to Live; **Disconnect** closes the active CDP client.
- **Clear** resets the renderer's captured request map but does not erase extension recordings.
- **Export** opens Network request export or Inspect prompt export according to the selected mode.
- The File menu exposes the same Export action as `Cmd/Ctrl+E` and supports Quit.
- The View menu supports reload, DevTools, zoom, and fullscreen.
- The Help menu opens remote-debugging instructions and the external CDP reference.
- Editable controls receive native undo/redo/cut/copy/paste/select-all menu roles and a right-click context menu.

### Network workspace

- Free-text filtering searches URL, method, status, resource type, and MIME type.
- Resource buttons filter Document, Fetch, XHR, Script, Stylesheet, Image, Font, WebSocket, and Other captured CDP types.
- **Errors only** includes failed requests and HTTP status codes of 400 or greater.
- The request counter reflects the filtered list; the status bar shows total captured count, transferred bytes, and active target.
- Selecting a row opens resizable details. Pointer capture drives the divider while enforcing a 340-pixel minimum and 70%-window maximum.
- Details include general metadata, merged request/response headers, request body, response body/WebSocket frames, timing phases, and raw JSON.
- Response bodies load on demand; JSON is pretty-printed and base64 content is labelled.
- WebSocket creation and sent/received frames are retained on the same request record.
- Target disconnection is detected and reported through the preload event bridge.

### Inspect workspace

- The desktop polls extension state every second and displays bridge online/offline state.
- **Refresh** performs an immediate state read; **Clear extension data** clears screenshots, durable recordings/jobs, and all unsaved feedback fields.
- Blue screenshot and purple recording sections visually separate static visual evidence from event evidence.
- Screenshot cards show preview, dimensions, image type/size, viewport/full-page label, URL, capture time, and selected elements.
- The full screenshot modal includes a scrollable image and selected-element evidence.
- Screenshot-wide, element-specific, and action-specific change notes are maintained separately.
- Recording accordions show stable IDs, action order, replay outcome, execution method, URL correction, expected/result URLs, and failures.
- **Show requests** correlates captured requests to an action window and labels meaningful requests.
- **Setup Copilot** becomes **Show Copilot** after a directory is configured.

### Extension popup and page overlays

- Connection status indicates whether the localhost desktop bridge responds.
- The popup refreshes background state every 900 ms and preserves the selected recording when its ID remains available.
- **Record/Stop recording**, recording selector, and **Replay** cover manual journey operation.
- Replay displays an in-page progress panel with run/source IDs, current action, rolling history, success/failure totals, and final state.
- **Start simulation**, **Pause/Resume**, **Stop**, and the paused breakpoint slider control eleven viewport presets.
- **Select elements/Stop selecting elements** controls the in-page picker and permits multiple unique selectors.
- **Add breakpoint capture** is enabled only while simulation and the desktop bridge are active.
- **Reset extension and website** clears transient UI, local extension state, device emulation, and affected page overlays.
- Content scripts run at `document_start`, in all frames, and report their frame ID so recorded actions can retain frame context.
- Recordings are capped at 500 actions; the extension keeps ten local recordings, the desktop keeps 100 durable recordings, and the desktop caps live request storage at 10,000 records.

### Agent-facing features

- Six MCP tools provide list/get/replay/result/recording-export/network-export behavior.
- Tool results include both `structuredContent` and text content for client compatibility.
- The stdio entry point keeps protocol data on stdout and writes diagnostics to stderr.
- Streamable HTTP exposes `/health` and `/mcp`, with bearer-token enforcement when it is not localhost-only.
- Replay accepts an idempotency key so a caller can avoid duplicate jobs after retrying.
- Copilot directory selection, generated chat drafts, all-evidence execution, follow-up continuation, streamed stdout/stderr, and process-tree Stop are all implemented in the Inspect sidebar.

## 16. Key implementation concepts with annotated code

The snippets below are intentionally small. Each comment explains the responsibility of the adjacent line rather than repeating syntax. Long inline callbacks are occasionally represented by a descriptive helper name, but the control flow matches the implementation.

### 16.1 Safe Electron renderer-to-main communication

The renderer has no direct Node.js access. The preload script exposes only named operations, while `ipcMain.handle` owns privileged work.

```js
contextBridge.exposeInMainWorld('cdp', { // Publish a deliberately narrow API into the isolated renderer.
  getResponseBody: opts => ipcRenderer.invoke('get-response-body', opts), // Request one privileged CDP operation.
  saveFile: opts => ipcRenderer.invoke('save-file', opts), // Route file writes through Electron's native dialog handler.
  onCopilotEvent: callback => { // Convert main-process streaming events into a renderer subscription.
    const listener = (_event, data) => callback(data); // Hide Electron's event object from application code.
    ipcRenderer.on('copilot-event', listener); // Listen for stdout, stderr, error, and exit messages.
    return () => ipcRenderer.removeListener('copilot-event', listener); // Give React an exact cleanup function.
  },
});
```

This follows Electron's recommendation to expose individual wrappers instead of the entire `ipcRenderer`. See [Electron IPC tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc), [`contextBridge`](https://www.electronjs.org/docs/latest/api/context-bridge), and [`ipcMain.handle`](https://www.electronjs.org/docs/latest/api/ipc-main).

### 16.2 Attaching to CDP network events

```js
const client = await CDP({ host, port: Number(port), target: targetId }); // Attach to the selected Chromium page target.
const { Network, Page } = client; // Use only the protocol domains needed by this connection.
await Network.enable({ maxPostDataSize: 65536 }); // Begin request/response event delivery with bounded POST data.
await Page.enable(); // Enable page lifecycle operations for the target.
Network.requestWillBeSent(params => { // Observe the request at its protocol start event.
  emitNetworkEvent({ type: 'request', requestId: params.requestId, url: params.request.url }); // Normalize it for both UI and durable evidence.
});
Network.loadingFinished(params => { // Observe successful transfer completion.
  emitNetworkEvent({ type: 'finished', requestId: params.requestId, encodedDataLength: params.encodedDataLength }); // Close timing and byte accounting.
});
```

CDP organizes instrumentation into domains and correlates events with request IDs. See the [CDP overview](https://chromedevtools.github.io/devtools-protocol/), [Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/), and [Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/).

### 16.3 Recording DOM actions

```js
document.addEventListener('click', event => { // Capture clicks before page code can stop event bubbling.
  const target = event.target instanceof Element ? event.target : null; // Ignore non-element event targets safely.
  const element = actionableTarget(target) || target; // Prefer the nearest button, link, input, or other actionable ancestor.
  if (element) sendRecordedAction('click', element, { clientX: event.clientX, clientY: event.clientY }); // Save target identity and replay coordinates.
}, true); // The true flag enables capture-phase observation.

document.addEventListener('input', event => { // Observe text as the user edits it.
  const element = event.target; // Retain the exact control that produced the value.
  if (!isTextEntry(element) || element.type === 'password') return; // Exclude unsupported and secret fields.
  scheduleInput(element, event.inputType || ''); // Debounce and store the final useful value instead of every keystroke.
}, true);
```

The content script and service worker exchange JSON-serializable messages with `runtime.sendMessage` and `tabs.sendMessage`; see [Chrome extension message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) and [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

### 16.4 Stable recording IDs, action IDs, and persistence

```js
runtimeState.recordingId = `REC-${crypto.randomUUID()}`; // Give the journey an addressable identity before actions arrive.
runtimeState.actions = []; // Start the new recording with a clean ordered action list.
await persistState(); // Save service-worker state in chrome.storage.local before messaging the page.
await sendToTab(tab.id, { type: 'SET_RECORDING', recording: true }); // Tell the content script to activate its existing listeners.
```

```js
const action = {
  id: `ACT-${crypto.randomUUID()}`, // Give this event a stable identity that replay can reference.
  type, // Preserve the semantic action kind used by replay.
  selector: locator.selector, // Retain a readable structural description for diagnostics.
  locator, // Store semantic, contextual, structural, shadow, frame, visual, and coordinate evidence.
  delayMs: now - lastActionAt, // Preserve user pacing within bounded replay delays.
};
```

The extension uses asynchronous, extension-scoped persistence described by [`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage).

### 16.5 Polling durable MCP replay jobs

```js
chrome.alarms.create(MCP_REPLAY_ALARM, { periodInMinutes: 0.5 }); // Ask Chrome to wake the service worker roughly every 30 seconds.
chrome.alarms.onAlarm.addListener(alarm => { // Receive scheduled wakeups even when the popup is closed.
  if (alarm.name === MCP_REPLAY_ALARM) stateReady.then(claimMcpReplayJob); // Claim work only after persisted state is restored.
});

async function claimMcpReplayJob() {
  if (runtimeState.recording || runtimeState.replaying) return; // Prevent a queued agent replay from colliding with active browser work.
  const claimed = (await bridgeRequest('/api/replay-jobs/next')).claimed; // Atomically claim the next durable job.
  if (claimed?.job) await replayActions(claimed.recording.id, claimed.recording, claimed.job.runId); // Execute the exact recording selected by the model.
}
```

Chrome alarms are designed to schedule service-worker work; see [`chrome.alarms`](https://developer.chrome.com/docs/extensions/reference/api/alarms).

### 16.6 Trusted replay clicks and responsive emulation

```js
await chrome.debugger.attach({ tabId }, '1.3'); // Attach the extension's CDP transport to the chosen tab.
await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left' }); // Produce browser-level mouse input.
await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left' }); // Complete the trusted click sequence.
```

```js
await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', { // Override layout and screen metrics for a preset.
  width, height, deviceScaleFactor: 1, mobile: width <= 768, // Match the selected desktop/tablet/mobile dimensions.
});
const capture = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', { // Capture the currently emulated viewport.
  format: 'jpeg', quality: 82, captureBeyondViewport: false, // Produce a bounded visible-viewport JPEG.
});
```

See [`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger), CDP [Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/), [Emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/), and [Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/) documentation.

### 16.7 Request evidence and equivalence

```js
function requestFingerprint(request) {
  return [
    String(request.method || 'GET').toUpperCase(), // Treat method as part of request identity.
    normalizedRequestUrl(request.url), // Remove volatile query values and redact sensitive ones.
    request.resourceType || 'Other', // Distinguish otherwise identical document, XHR, image, or other loads.
  ].join(' ');
}
```

```js
const actualIndex = replay.findIndex((candidate, index) => // Search replay evidence for the first unused equivalent request.
  !usedReplay.has(index) && candidate.fingerprint === expected.fingerprint,
);
if (actualIndex < 0) missing.push(expected); // Report baseline traffic that replay did not reproduce.
else if (actualIndex !== expectedIndex) reordered.push(pair); // Report ordering drift independently from existence.
if (expected.status !== actual.status) statusChanged.push(pair); // Treat changed HTTP outcomes as non-equivalent.
```

### 16.8 Network Export button

```ts
const exportRequests = useCallback(async (format, fields) => { // Run after the user confirms the Network export modal.
  let exportableRequests = filteredRequests; // Export only the requests visible under current filters.
  if (format === 'selected' && fields.has('response')) { // Response selection may require deferred body loading.
    exportableRequests = await Promise.all(filteredRequests.map(loadBodyIfNeeded)); // Ask CDP for each body that is finished, available, and not cached yet.
  }
  const isPostman = format === 'postman'; // Select the implemented JSON or Markdown serializer.
  const content = isPostman ? JSON.stringify(makePostmanCollection(exportableRequests), null, 2) : makeSelectedFieldsExport(exportableRequests, fields); // Generate the file entirely in memory.
  await window.cdp.saveFile({ defaultPath: isPostman ? 'network-postman.json' : 'network-export.md', content }); // Delegate the native save dialog and write to Electron.
}, [filteredRequests]);
```

The Postman collection declares the [Postman Collection v2.1 schema](https://schema.getpostman.com/json/collection/v2.1.0/collection.json). The separate HAR helper targets [HAR 1.2](https://w3c.github.io/web-performance/specs/HAR/Overview.html) but remains unwired as noted above.

### 16.9 Generate Prompt, Add to Chat, and file export

```ts
const makeScopedInspectPrompt = scope => { // Centralize prompt construction for every destination.
  const reviewed = scope.breakpoints ? screenshotsWithFeedback() : []; // Include only breakpoint evidence that carries a requested change.
  const eventCount = scope.events ? countRecordedActions() : 0; // Validate that event scope contains useful evidence.
  if (!reviewed.length && !eventCount) return ''; // Prevent empty prompts from being exported or sent.
  return makeInspectPrompt(reviewed, feedback, recordings, actionFeedback, requests, includeMeaningfulRequests, elementFeedback, scope); // Build one deterministic Markdown document.
};

const addScopedPromptToChat = scope => { // Handle Generate Prompt → Add to Chat.
  const prompt = makeScopedInspectPrompt(scope); // Reuse the same evidence selection as file export.
  setCopilotChatDraft(prompt); // Make the complete prompt visible and editable before execution.
  setShowInspectExport(false); // Close the evidence modal after accepting its selection.
  setShowCopilot(true); // Return focus to the sidebar containing the populated draft.
};
```

```ts
const result = await window.cdp.saveFile({ // Handle Inspect Export → Export prompt.
  defaultPath: `website-improvements-${timestamp}.md`, // Give every export a sortable unique name.
  content: makeInspectPrompt(/* selected evidence */), // Save the same Markdown structure used by Add to Chat.
});
```

### 16.10 Copilot streaming and Stop

```js
const child = spawn(executablePath, args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }); // Start Copilot in the selected repository and isolate its process group.
child.stdout.on('data', chunk => send('output', { stream: 'stdout', text: chunk.toString() })); // Stream normal CLI output without waiting for process completion.
child.stderr.on('data', chunk => send('output', { stream: 'stderr', text: chunk.toString() })); // Stream diagnostics into the same terminal timeline.
child.on('close', (code, signal) => send('exit', { code, signal })); // Let the sidebar leave Running only after the real process exits.
```

```js
process.kill(-child.pid, 'SIGTERM'); // Stop the complete detached Copilot process group on macOS/Linux.
setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 3000); // Force cleanup if graceful termination does not finish promptly.
```

Copilot is invoked with programmatic `-p`, bounded `--autopilot`, `--allow-all`, `--max-autopilot-continues 10`, and `--continue` for follow-ups. See the [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) and [autopilot guidance](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/autopilot).

### 16.11 MCP tool registration and transport

```js
server.registerTool('replay_recording', { // Publish an LLM-visible tool with an explicit stable name.
  inputSchema: { recordingId: z.string().startsWith('REC-') }, // Reject ambiguous or malformed recording identifiers.
  annotations: { readOnlyHint: false, destructiveHint: true }, // Tell clients that replay has browser side effects.
}, async input => {
  const job = await client.replayRecording(input); // Queue the job and wait/poll through the localhost service client.
  return result({ runId: job.runId, status: job.status, summary: job.comparison?.summary }); // Return structured and text-compatible evidence.
});
```

```js
const transport = new StdioServerTransport(); // Let the host launch the MCP server as a local child process.
await server.connect(transport); // Exchange newline-delimited JSON-RPC over stdin/stdout.
```

MCP defines tools and standard transports independently. See the MCP [tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) and [transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

## 17. External documentation index

### Electron and Node process integration

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron context bridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Electron IPC tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron dialog API](https://www.electronjs.org/docs/latest/api/dialog)
- [Node.js child processes](https://nodejs.org/api/child_process.html)

### Renderer architecture

- [React state](https://react.dev/learn/state-a-components-memory)
- [React effects](https://react.dev/learn/synchronizing-with-effects)
- [React reducers](https://react.dev/learn/extracting-state-logic-into-a-reducer)
- [Vite build guide](https://vite.dev/guide/build)

### Chrome extensions and browser control

- [Chrome extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Extension message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [`chrome.alarms`](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [`chrome.tabs`](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger)

### Chrome DevTools Protocol

- [Protocol overview](https://chromedevtools.github.io/devtools-protocol/)
- [Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/)
- [Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/)
- [Input domain](https://chromedevtools.github.io/devtools-protocol/tot/Input/)
- [Emulation domain](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/)

### Export formats and agent integrations

- [Postman Collection v2.1 schema](https://schema.getpostman.com/json/collection/v2.1.0/collection.json)
- [W3C HAR 1.2 draft](https://w3c.github.io/web-performance/specs/HAR/Overview.html)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
- [GitHub Copilot CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [GitHub Copilot CLI autopilot](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/autopilot)

## 18. Current implementation boundaries

- HAR serialization exists but is not connected to the Export dialog.
- Screenshot image data is session-only in Electron; recording/replay evidence is durable.
- Response bodies depend on CDP still retaining the resource and may be unavailable after redirects, cache/service-worker behavior, or target disposal.
- Extension replay supports click, input, change, keypress, and scroll; it intentionally does not record passwords or replay file uploads.
- Trusted clicks are limited to the main document. Framed actions use the content-script DOM replay path.
- The extension bridge has no per-install token in the current local implementation; its controls are loopback binding plus browser-Origin filtering. It must not be exposed remotely.
- Streamable HTTP is suitable only with authentication and a secure deployment/tunnel; ChatGPT cannot directly connect to a localhost endpoint.
