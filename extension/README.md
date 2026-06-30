# Black Hole Timer Extension

This is a Manifest V3 prototype for testing the local lens approach.

## Load

1. Open `edge://extensions/` or `chrome://extensions/`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this `extension/` directory.
4. Open or refresh a normal `http`, `https`, or `file` page.

The extension cannot inject into browser-owned pages such as `chrome://`,
`edge://`, the Chrome Web Store, or the Edge Add-ons store.

## Behavior

- Each allowed tab injects a fixed-position WebGL canvas.
- The background service worker keeps one cross-tab energy state.
- Mouse, keyboard, wheel, input, and scroll activity grow the energy.
- Idle time or browser focus loss decays the energy.
- The active tab is captured at a throttled cadence and used as the shader
  texture. The canvas only covers the black-hole lens area, leaving the rest of
  the live page untouched.

This keeps the visible effect close to the browser demo without replacing the
whole page with a stale screenshot.
