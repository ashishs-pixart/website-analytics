# Network Inspector

A production-ready Electron desktop app for inspecting browser network traffic through the Chrome DevTools Protocol.

## Features

- Attach to Chrome, Edge, Brave, or another Chromium browser launched with remote debugging.
- Live request table with method, status, type, URL, size, and duration.
- Filter by URL/method/status, resource type, and errors only.
- Inspect request headers, response headers, request body, response body, timing, raw event data, and WebSocket frames.
- Export captured traffic as HAR.
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

## Notes

- Response bodies are loaded on demand. Some bodies may not be available after cache/service-worker redirects or if the browser has discarded them.
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
