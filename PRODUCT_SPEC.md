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
├── src/                         Electron desktop application
├── website-analytics-extension Chrome Manifest V3 extension
├── PRODUCT_SPEC.md              This specification
└── README.md                    Setup and usage guide
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
3. Capture actionable clicks (`a`, `button`, form controls, and ARIA buttons) in order.
4. Capture individual keyboard events and post-input DOM values needed to reconstruct a journey, excluding passwords.
5. Give every recording a stable `REC-*` ID and every action a stable `ACT-*` ID.
6. Store robust selectors, visible labels, URL context, and delays.
7. Stop recording and send the recording summary to Network Watch.
8. Replay actions from the background worker so navigation between actions can be tolerated.
9. Store each replay as a separate `REPLAY-*` evidence session with new action timestamps.
10. Correlate network requests to the action time window in which they started.
11. Surface replay progress and failures in the popup.

Acceptance criteria:

- Record/stop state survives closing and reopening the popup.
- Replay uses the recorded order and waits approximately the original delay, with a practical maximum wait.
- Missing elements produce a readable error instead of stopping Chrome or the desktop app.
- Replayed journeys naturally repopulate Network Watch's request table when CDP capture is connected.

### Phase C — responsive simulation

1. Attach to the active tab with `chrome.debugger`.
2. Apply five discrete desktop viewport presets with CDP device emulation.
3. Fit-scale the emulated page to the real Chrome tab while preserving the target CSS viewport dimensions.
4. Refresh at each breakpoint so responsive boot-time logic and network requests are reproduced.
5. Provide Start, Pause/Resume, and Stop controls; automatically pause after all five breakpoints.
6. Show the live emulated resolution in the popup.
7. Clear emulation and detach the debugger when simulation stops.

Initial presets:

- 1920×1080
- 1760×990 (midpoint)
- 1600×900
- 1460×810 (midpoint)
- 1320×720

Acceptance criteria:

- The page changes exactly five times, once per listed breakpoint; it does not animate pixel by pixel.
- The complete target viewport is scaled into the available tab area instead of overflowing the browser window.
- Pause freezes the current breakpoint.
- Stop restores normal page metrics.

### Phase D — element inspection and screenshots

1. Allow element selection only while simulation is paused.
2. Draw a hover overlay similar to DevTools element selection.
3. On click, capture the CSS selector, tag, ID, class list, bounded `outerHTML`, matching accessible stylesheet rules, and relevant computed styles.
4. Read DOM layout dimensions with `Page.getLayoutMetrics` and capture the full rendered document with `Page.captureScreenshot` and `captureBeyondViewport`.
5. Bound very large output dimensions with capture scaling while retaining the breakpoint and DOM content dimensions as metadata.
6. Attach current resolution, page URL/title, timestamp, and selected element metadata.
7. POST the screenshot package to the local bridge.

Chrome constraint:

Chrome extensions cannot programmatically force-open the native DevTools window or select a node in its Elements panel. The implemented picker supplies the debugging metadata needed for the workflow without pretending that unsupported capability exists. A future DevTools-panel extension can provide a companion panel when the user manually opens DevTools.

Acceptance criteria:

- Screenshot capture works only with explicit user interaction in the popup.
- The selected element is visibly highlighted before selection.
- Cross-origin stylesheet access failures are ignored safely.
- Screenshot/metadata packages appear in desktop Inspect mode.

### Phase E — feedback and model-ready export

1. Display screenshots as cards in Inspect mode.
2. Show breakpoint, page, selector, HTML, CSS rules, and computed styles.
3. Let the user enter requested changes for each screenshot.
4. Display every recording/replay ID, action ID, and network requests that began after each action.
5. Let the user enter requested changes for individual recorded events.
6. Open an Inspect export form from the shared Export button.
7. Require at least one screenshot or event feedback entry.
8. Export a Markdown prompt organized as:

```text
Breakpoint resolution
→ Page URL
→ HTML element and selector
→ CSS rules/computed styles
→ User feedback
```

Acceptance criteria:

- Feedback remains associated with the correct screenshot while the app is open.
- Event feedback remains associated with the stable action ID and includes its correlated network evidence.
- Empty feedback entries are omitted.
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
- Full-page CDP capture is bounded to 12,000 output pixels per axis and 40 million output pixels overall to avoid Chrome renderer and memory failures on extremely large pages.
- Debugger attachment displays Chrome's standard debugging notification.
- Service-worker suspension may stop a very long simulation; a future offscreen document can own long-running jobs.
- A future analysis pass can hash response bodies and automatically flag repeated identical responses, cache candidates, and duration outliers.
- A future export bundle can include screenshot files plus the Markdown prompt in a ZIP archive.
