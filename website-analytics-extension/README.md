# Website Analytics Chrome extension

## Load the extension

1. Start Network Watch so its local bridge is available on `127.0.0.1:9231`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this `website-analytics-extension` folder.

## Workflow

1. Connect Network Watch to the same website tab if network capture is required.
2. Use **Record**, perform the user journey, and choose **Stop recording**.
3. Choose a saved recording from the replay dropdown and press **Replay** to repeat its clicks and keystrokes and regenerate network requests. The newest recording is selected by default, and the extension retains the ten most recent recordings. A persistent in-page panel shows the current action, progress, success/failure totals, and a rolling action log; it survives page changes by being recreated with the latest replay state and remains available after completion until closed. Replay uses trusted browser-level mouse input when available, with stable attributes, text, and recorded coordinates as locator fallbacks. Every action records its starting and resulting URL. If an earlier action fails or navigates to the wrong page, replay restores the URL saved for the next action and continues. Failed actions are shown with their error and stored with the replay evidence.
4. Choose **Simulate** to render five desktop, two tablet, and four mobile sizes. Each fitted breakpoint remains visible for six seconds, the page refreshes between sizes, and simulation pauses after the eleventh. While paused, use the slider to jump directly to any breakpoint.
5. Choose **Select elements** at any time, with or without responsive simulation. Click as many elements as needed, then reopen the popup and choose **Stop selecting elements**.
6. Choose **Add breakpoint capture** at every breakpoint you need. Captures accumulate across desktop, tablet, and mobile resolutions and can be exported together. The extension refreshes each selected selector's coordinates immediately before capture so Network Watch can show an accurate zoomed crop and element-specific feedback field.
7. Choose **Reset extension and website** to stop recording and selection, clear extension state, remove emulation and overlays, restore the original viewport, and reload the affected website tab.
8. Open **Inspect** mode in Network Watch to review recording/action IDs, per-action network requests, screenshots, and change-request forms before exporting the improvement prompt.

Element selection starts disabled whenever the extension background state is initialized. It becomes active only after **Select elements** is pressed.

The replay dropdown lists completed recordings. While the first recording is active it shows **Recording in progress**; after **Stop recording**, that session becomes the newest replay choice. Extension commands wait for saved state restoration before changing recording data, preventing worker startup from clearing a new session.

The extension works on normal `http` and `https` pages. Chrome internal pages and the Chrome Web Store do not allow content scripts.

## Viewport frame CSS

The cyan border and resolution label that separate the scaled webpage from Chrome's black emulation canvas are defined in [`simulation.css`](simulation.css). The main selectors are:

```css
#nw-simulation-frame {
  border: 5px solid #35a7ff !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.92),
              inset 0 0 28px rgba(53, 167, 255, 0.18) !important;
}

#nw-simulation-label {
  background: rgba(7, 17, 31, 0.92) !important;
  color: #ffffff !important;
}
```

Modify these declarations to change the viewport border color, width, glow, or label appearance. The extension hides this frame before taking a screenshot.
