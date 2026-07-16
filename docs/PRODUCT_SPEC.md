# Network Watch + Website Analytics Extension

## 1. Product goal

Create a local website-debugging toolkit with two cooperating products:

- **Network Watch desktop app** captures browser network activity and exports request data.
- **Website Analytics Chrome extension** records user journeys, replays them, simulates responsive breakpoints, captures screenshots, and associates selected DOM/CSS metadata with each screenshot.

The combined output is designed to be understandable by both developers and language models. It should answer questions such as:

- Which requests are repeated during the same user journey?
- Which slow requests return identical content and may be cache candidates?
- Which element is visually incorrect at a specific breakpoint?
- What HTML and CSS produced the issue, and what change did the reviewer request?

## 2. Repository layout

```text
network-watch/
├── apps/desktop/                Electron main, preload, renderer, and assets
├── apps/extension/              Chrome Manifest V3 extension
├── services/mcp/                MCP stdio and Streamable HTTP adapters
├── packages/store/              Durable recording and replay evidence store
├── packages/bridge-client/      Local service client used by MCP
├── infra/docker/                Container image and entrypoint
├── docs/                        Specifications and setup guidance
└── test/                        Contract and integration tests
```

The existing repository already represents `network-watch`, so it remains at the repository root. The extension is isolated in its own folder and can be loaded unpacked in Chrome.

## 3. Architecture

```text
Website under test
  ├─ Chrome DevTools Protocol ─────────> Network Watch network capture
  └─ Extension content script
       ├─ records/replays DOM actions
       ├─ selects and describes elements
       └─ asks background worker to capture screenshots
                                      │
                                      ▼
                            localhost bridge :9231
                                      │
                                      ▼
                         Network Watch Inspect mode
                            ├─ screenshot gallery
                            ├─ DOM/CSS metadata
                            ├─ per-screenshot feedback
                            └─ LLM-ready prompt export
```

### Local bridge contract

The Electron main process owns an HTTP server bound only to `127.0.0.1:9231`.

- `GET /health`: extension connection check.
- `GET /api/state`: latest recordings and screenshots.
- `POST /api/recordings`: store a completed action recording.
- `POST /api/screenshots`: store a screenshot and element metadata.
- `DELETE /api/state`: clear extension data.

The server enables CORS for Chrome extensions, rejects unsupported methods, limits request size, validates JSON, and never listens on a public interface. No captured data is uploaded by this feature.

## 4. Delivery steps

### Phase A — desktop foundation

1. Add the localhost bridge to the Electron main process.
2. Expose read/clear bridge operations through the existing isolated preload API.
3. Add **Network** and **Inspect** modes to the desktop UI.
4. Poll bridge state while the app is open and show extension connection state.
5. Preserve the current network capture, filtering, details, and request export behavior.

Acceptance criteria:

- The bridge responds only on localhost.
- The app continues to build and network mode behaves as before.
- Inspect mode updates without restarting the app.

### Phase B — action recording and replay

1. Install a content script on ordinary web pages.
2. Start recording from the extension popup.
3. Capture clicks on actionable controls and other DOM targets in order, including viewport/page coordinates as replay fallback evidence.
4. Debounce text input and textarea edits into one final-value action; retain only behaviorally meaningful non-text key events such as Enter, excluding passwords.
5. Give every recording a stable `REC-*` ID and every action a stable `ACT-*` ID.
6. Store a locator bundle (CSS selector, stable test/name/ARIA attributes, role, link target, exact text, and coordinates), the top-level URL at the start of every action, frame URL, delays, and debounced scroll positions.
7. Stop recording and send the recording summary to Network Watch.
8. Replay actions from the background worker using trusted CDP mouse input when available, with DOM clicks as a reported fallback.
9. Before every replayed action, compare the live URL to that action's recorded start URL. Restore a mismatched URL, wait for the page, and continue even when the preceding action failed.
10. Compare the result of a click or Enter action to the next action's recorded start URL. Log unexpected or missing navigation as an action failure, then resume from the next saved URL.
11. Store each replay as a separate `REPLAY-*` evidence session with new action timestamps, execution methods, URL corrections, resulting URLs, and outcomes.
12. Correlate network requests to the action time window in which they started.
13. Surface replay progress in the popup and in a persistent in-page panel that updates before and after every action, shows success/failure totals and recent action results, recreates itself after navigation, and remains dismissible after completion.
14. Retain the ten most recent original recordings in the extension and provide a replay dropdown, with the newest recording selected by default.

Acceptance criteria:

- Record/stop state survives closing and reopening the popup.
- Replay uses the recorded order and waits approximately the original delay, with a practical maximum wait.
- Replay resolves elements through the locator bundle, prefers trusted CDP mouse input for clicks, falls back to DOM clicks when necessary, and replays recorded scroll positions directly.
- Missing elements with no safe coordinate fallback produce a readable error instead of stopping Chrome or the desktop app.
- Replayed journeys naturally repopulate Network Watch's request table when CDP capture is connected.
- A failed replay action shows an in-page notification and console warning, is stored with its error, and does not prevent later actions from running.
- Each action stores its expected/start URL and result URL. URL drift is logged and corrected before the next action.
- Every replay stores successful, failed, and total action counts.
- A user can replay any retained recording without replacing the newest-recording default.

### Phase C — responsive simulation

1. Attach to the active tab with `chrome.debugger`.
2. Apply eleven discrete desktop, tablet, and mobile viewport presets with CDP device emulation.
3. Fit-scale the emulated page to the real Chrome tab while preserving the target CSS viewport dimensions.
4. Refresh at each breakpoint so responsive boot-time logic and network requests are reproduced.
5. Hold each breakpoint for six seconds and provide Start, Pause/Resume, and Stop controls; automatically pause after all eleven breakpoints.
6. Draw a high-contrast viewport border and resolution label over the scaled page so the website is clearly separated from Chrome's emulation canvas.
7. Show the live emulated resolution in the popup.
8. When paused, show a slider that jumps directly to any configured breakpoint.
9. Clear emulation and detach the debugger when simulation stops.

Initial presets:

- 1920×1080
- 1760×990 (midpoint)
- 1600×900
- 1460×810 (midpoint)
- 1320×720
- 1024×768 (tablet landscape)
- 768×1024 (tablet portrait)
- 430×932 (large mobile)
- 390×844 (standard mobile)
- 375×812 (compact iPhone)
- 360×800 (compact Android)

Acceptance criteria:

- The page changes exactly eleven times, once per listed breakpoint; it does not animate pixel by pixel.
- Each size remains active for six seconds after the refreshed page is ready.
- The complete target viewport is scaled into the available tab area instead of overflowing the browser window.
- Pause freezes the current breakpoint.
- The paused breakpoint slider refreshes and renders the selected preset.
- Stop restores normal page metrics.

### Phase D — element inspection and screenshots

1. Allow element selection on any ordinary website tab, independently of responsive simulation state.
2. Draw a hover overlay similar to DevTools element selection.
3. Keep the picker active across multiple clicks until the user explicitly chooses **Stop selecting elements**; capture each element's CSS selector, tag, ID, class list, bounded `outerHTML`, matching accessible stylesheet rules, and relevant computed styles.
4. Read visible viewport dimensions with `Page.getLayoutMetrics` and capture only the currently visible emulated viewport with `Page.captureScreenshot`.
5. Retain the breakpoint and visible viewport dimensions as screenshot metadata.
6. Attach current resolution, page URL/title, timestamp, and all selected element metadata.
7. POST the screenshot package to the local bridge.

Chrome constraint:

Chrome extensions cannot programmatically force-open the native DevTools window or select a node in its Elements panel. The implemented picker supplies the debugging metadata needed for the workflow without pretending that unsupported capability exists. A future DevTools-panel extension can provide a companion panel when the user manually opens DevTools.

Acceptance criteria:

- Screenshot capture works only with explicit user interaction in the popup.
- Screenshot capture is enabled at every active simulation breakpoint and does not require pausing.
- The selected element is visibly highlighted before selection.
- The viewport frame is hidden before screenshot capture and restored afterward, so it is a debugging aid rather than screenshot content.
- Cross-origin stylesheet access failures are ignored safely.
- Screenshot/metadata packages appear in desktop Inspect mode.
- Repeated captures are accumulated instead of replaced, allowing multiple desktop, tablet, and mobile breakpoints to be reviewed and exported together.
- Every selected element appears in its own accordion entry with a non-exported screenshot crop, refreshed element coordinates, HTML/CSS evidence, and an element-specific change request field.
- Reset stops active extension modes, clears local extension state, removes emulation and injected overlays, restores original page metrics, and reloads the affected tab.

### Phase E — feedback and model-ready export

1. Display screenshots as cards in Inspect mode.
2. Show breakpoint, page, selector, HTML, CSS rules, and computed styles.
3. Let the user enter requested changes for each screenshot.
4. Display every recording/replay ID and action ID, with a **Show requests** modal for network requests that began after each action.
5. Let the user enter requested changes for individual recorded events.
6. Open an Inspect export form from the shared Export button.
7. Provide independent accordion checkboxes for breakpoint evidence (enabled by default) and event/replay evidence, allowing breakpoint-only, event-only, or combined prompts.
8. Pre-process failed, slow, and repeated equivalent request/response evidence and ask whether that meaningful request analysis should be included.
9. Require feedback for breakpoint export, but allow complete event/replay evidence to be exported with optional per-action change notes.
10. Export a Markdown prompt organized as:

```text
Breakpoint resolution
→ Page URL
→ HTML element and selector
→ CSS rules/computed styles
→ User feedback

Recording/replay session
→ Session and source recording IDs
→ Replay success/failure summary
→ Every event, locator, URL transition, and replay result
→ Meaningful correlated requests (optional)
→ User change note (optional)
```

Acceptance criteria:

- Feedback remains associated with the correct screenshot while the app is open.
- Event feedback remains associated with the stable action ID and includes its correlated network evidence.
- Events without feedback remain in event/replay exports and are marked as having no event-specific change request.
- Export produces a readable `.md` prompt and does not embed base64 image data.

## 5. Security and privacy

- Bind the bridge to `127.0.0.1`, never `0.0.0.0`.
- Keep Electron `contextIsolation: true` and `nodeIntegration: false`.
- Restrict extension permissions to the capabilities required for recording and simulation.
- Never capture password input values.
- Bound HTML, CSS, recording, and screenshot payload sizes.
- Treat captured page text and HTML as untrusted data when sending it to a model.
- Clearly tell the user that screenshot images remain local unless they independently upload them.

## 6. Known limitations and follow-up work

- Replay cannot reproduce every application state, authentication challenge, drag gesture, canvas interaction, file upload, or cross-origin iframe action.
- Screenshot capture records only the visible emulated viewport; full-page evidence is outside the MVP scope.
- Debugger attachment displays Chrome's standard debugging notification.
- Service-worker suspension may stop a very long simulation; a future offscreen document can own long-running jobs.
- Meaningful request analysis currently uses request/response equivalence, failures, and duration thresholds; a future pass can add configurable hashing and cache-policy heuristics.
- A future export bundle can include screenshot files plus the Markdown prompt in a ZIP archive.
