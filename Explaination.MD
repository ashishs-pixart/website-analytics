# Network Watch — complete workflow explanation

Network Watch is an Electron desktop application, a Chrome extension, and an MCP service that work together. It can inspect a Chromium tab's network traffic, capture responsive screenshots and selected-element metadata, record browser journeys, replay them, compare replay traffic to the original traffic, and make the resulting evidence available to people and coding agents.

## 1. Components and their responsibilities

| Component | Responsibility |
| --- | --- |
| Electron main process (`src/main.js`) | Opens the desktop window, connects to the Chrome DevTools Protocol (CDP), receives extension data over a localhost bridge, persists recordings, and starts Copilot CLI. |
| React renderer (`src/renderer/src`) | Displays Network and Inspect modes, filters/exports requests, reviews screenshots and recordings, and hosts the Copilot sidebar. |
| Preload bridge (`src/preload.js`) | Exposes a small, typed IPC API to the renderer while keeping Node.js disabled in the UI. |
| Chrome extension background worker | Owns extension state, controls recording, replay, responsive emulation, screenshots, and polling for MCP replay work. |
| Chrome extension content script | Observes browser interactions, collects element metadata, displays overlays, resolves replay targets, and carries out DOM-level replay fallbacks. |
| Durable store (`src/network-watch-store.js`) | Saves original recordings, replay runs, replay jobs, redacted request evidence, comparisons, and agent-facing exports. |
| MCP server (`mcp/`) | Exposes recordings, replay, comparison, and exports as MCP tools through stdio or Streamable HTTP. |

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

### 3.3 Network exports

The Network export dialog supports these outcomes:

- HAR export: creates a standard HAR file from captured traffic.
- Selected-field export: writes the selected request fields as Markdown.
- Postman export: writes a JSON Postman collection.
- MCP network export: returns the current redacted network snapshot as JSON or Markdown directly to an MCP client.

Electron opens the native save-file picker before a desktop file is written. HAR files can be opened in browser DevTools, many API tools, or any JSON viewer because HAR is JSON.

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
| Click | `document.addEventListener('click', ..., true)` | Records the nearest actionable target, selector/locator, text, link, coordinates, viewport, URL, and time since the prior action. |
| Text entry | `input` plus `blur` events | Debounces input for 650 ms and records the final value. Password fields are excluded. |
| Select, checkbox, radio, date, range, color | `change` event | Records final value and checked state where applicable. |
| Enter and other non-text keys | `keydown` and `submit` events | Records key/code/modifiers. A submit fallback prevents an Enter submission from being missed. |
| Scroll | `window.addEventListener('scroll', ..., true)` | Debounces for 180 ms and records scroll coordinates. |

Each captured action receives `ACT-<UUID>`. The action includes a generated CSS selector and a locator bundle: tag name, id, test IDs, name, role, aria label, href, and short visible text. The selector prefers an element id, then stable test/name attributes, then a bounded structural selector. The content script sends the action to the background worker with `chrome.runtime.sendMessage({ type: 'RECORDED_ACTION', action })`.

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

- Clicks: the extension first resolves the target using recorded selector, test/id/name/role/label/text, and coordinates. For main-frame clicks it tries the Chrome Debugger API (`chrome.debugger.attach` plus CDP `Input.dispatchMouseEvent`) to produce trusted browser mouse input. If that cannot be used, it asks the content script to perform the DOM fallback.
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
3. The local workspace declaration is `.vscode/mcp.json`; it runs `node mcp/stdio.mjs` and supplies `NETWORK_WATCH_URL=http://127.0.0.1:9231`.
4. Run **MCP: List Servers**, start `network-watch`, approve trust, then use Copilot Chat in Agent mode.

### GitHub Copilot CLI

1. Install Copilot CLI and authenticate with `copilot login`.
2. `.mcp.json` provides the same local stdio server declaration for this repository.
3. Start `copilot`, use `/mcp` to confirm `network-watch`, then ask it to list recordings, replay one, or call an export tool.

## 13. Security boundaries and data handling

- The extension bridge is loopback-only (`127.0.0.1`) and accepts extension origins only.
- The UI is isolated from Node.js; only explicit preload IPC methods are exposed.
- Sensitive URL parameters, common secret headers, and matching request-body fields are redacted before durable storage and MCP/network export.
- Password entry is intentionally excluded from recording.
- Replay is side-effecting: it can click, type, navigate, and regenerate requests in the active tab. Use disposable or safe test environments.
- The remote MCP endpoint must not expose the extension bridge. For remote use, deploy/tunnel the separate MCP endpoint with HTTPS and appropriate authentication.

## 14. Reset and cleanup behavior

**Reset extension and website** stops recording and the picker, clears simulation overlays/device metrics, detaches the extension debugger, resets extension state, removes the recording badge, and reloads affected tabs when possible. In the desktop Inspect view, **Clear extension data** clears screenshots plus durable recordings/replay jobs from Network Watch's store.

