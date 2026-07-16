# Network Inspector

A production-ready Electron desktop app for inspecting browser network traffic through the Chrome DevTools Protocol.

## Features

- Attach to Chrome, Edge, Brave, or another Chromium browser launched with remote debugging.
- Live request table with method, status, type, URL, size, and duration.
- Filter by URL/method/status, resource type, and errors only.
- Inspect request headers, response headers, request body, response body, timing, raw event data, and WebSocket frames.
- Export the currently filtered traffic as an importable Postman JSON collection or a readable Markdown (`.md`) file with selected request, response, header, payload, and timing fields.
- Use the companion Chrome extension to record/replay journeys and regenerate their network traffic.
- Simulate eleven fitted desktop, tablet, and mobile breakpoints, capture visible-viewport screenshots with selected-element HTML/CSS metadata, correlate requests to recorded actions, and export an LLM-ready improvement prompt.
- Secure Electron setup with `contextIsolation: true` and no renderer Node integration.

## Install

```bash
npm install
npm start
```

## Launch a browser with remote debugging

Chrome / Brave on Linux:

```bash
google-chrome --remote-debugging-port=9222
brave-browser --remote-debugging-port=9222
```

Edge:

```bash
msedge --remote-debugging-port=9222
```

Windows Chrome:

```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

macOS Chrome:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

## Usage

1. Start a browser with `--remote-debugging-port=9222`.
2. Start this app with `npm start`.
3. Click **Scan**.
4. Select a tab.
5. Click **Connect**.
6. Browse normally in the attached tab and inspect requests as they stream in.

## Website Analytics extension

The unpacked Manifest V3 extension is in [`website-analytics-extension`](website-analytics-extension). See its README for installation steps.

1. Start Network Watch; it creates a local-only extension bridge at `127.0.0.1:9231`.
2. Load the extension from `chrome://extensions` with Developer mode enabled.
3. Record and replay a website journey while Network Watch is capturing the same tab.
4. Start responsive simulation and pause at a resolution you want to review.
5. Optionally select an element, then capture a screenshot.
6. Switch Network Watch to **Inspect**, enter requested changes, and choose **Export** to create a Markdown prompt.

See [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) for architecture, phased implementation steps, security constraints, acceptance criteria, and known limitations.

## Notes

- Response bodies are loaded on demand. Some bodies may not be available after cache/service-worker redirects or if the browser has discarded them.
- The extension bridge listens only on `127.0.0.1`; captured extension data is kept in memory and is cleared when Network Watch exits.
- Chrome extensions cannot force-open the native DevTools Elements panel. The extension provides an in-page element picker and captures equivalent selector, HTML, stylesheet-rule, and computed-style metadata.
- For security, expose remote debugging only on trusted local machines.
- Firefox CDP support is limited compared with Chromium. Chromium browsers are recommended.

## Project layout

```text
src/main.js       Electron main process and CDP bridge
src/preload.js    Safe IPC API exposed to the renderer
src/renderer      React + TypeScript renderer app
src/style.css     Shared dark developer-tool UI styles
dist/renderer     Generated renderer build loaded by Electron
```
