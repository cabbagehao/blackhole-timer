# Black Hole Timer

Black Hole Timer is a visual focus timer that turns elapsed screen time into a
growing, morphing black hole. The browser demo uses a WebGL2 port of the
original Ghostty black hole shader, so the timer feels closer to a physical
lensing effect than a normal progress bar.

![Black Hole Timer browser demo preview](./docs/preview.webp)

Live demo: <https://blackhole-timer.vercel.app/>

中文说明: [README.zh-CN.md](./README.zh-CN.md)

## Use Cases

- Focus sessions where the black hole grows as work time accumulates.
- Break reminders for long screen sessions.
- Webpage dwell-time experiments for a future browser extension.
- Meeting, presentation, study, or deadline timers that need stronger visual
  pressure than a standard countdown.

## Quick Start

No build step is required for the browser demo.

```sh
git clone https://github.com/cabbagehao/blackhole-timer.git
cd blackhole-timer
python3 -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/
```

On Windows, if `python3` is not available, use Python's launcher:

```powershell
py -m http.server 4173
```

## Browser Demo

The page draws a work scene to an offscreen canvas, uploads it as `iChannel0`,
then runs the black hole shader over that texture. Timer progress drives the
original demo timeline, so the black hole grows and morphs through the same
preset family used by the reference demo.

Useful URL parameters:

```text
http://127.0.0.1:4173/?preview=0.85
http://127.0.0.1:4173/?scene=work&preview=0.85
http://127.0.0.1:4173/?autoplay=0
```

- `preview` sets the initial progress from `0` to `1`.
- `scene=work` switches from the dense code reference texture to a workspace
  mockup.
- `autoplay=0` disables the default auto-running preview.

## Controls

- Start/Pause toggles the simulated focus session.
- Reset returns the black hole to its initial size.
- Break threshold is the focus-session length, in minutes. At the threshold,
  the black hole reaches 100% intensity and the state switches to `Break`.
- Demo speed accelerates time so the growth can be previewed quickly. The UI
  includes real time plus 3x, 5x, 10x, 30x, 120x, and 600x.
- Background switches between the dense code reference texture and a product
  workspace mockup.

## Browser Extension Prototype

An unpacked Chrome/Edge extension prototype lives in `extension/`. It tests the
local lens approach: the active tab is captured at a throttled cadence, the
current shader uses that capture as `iChannel0`, and only a soft-edged lens
canvas is drawn over the page. The rest of the page remains live DOM.

Load it from `edge://extensions/` or `chrome://extensions/` with Developer mode
enabled, selecting the `extension/` directory.

## Windows Desktop Prototypes

Windows comparison builds are documented in [WINDOWS_DESKTOP.md](./WINDOWS_DESKTOP.md).
They explore Electron, WebView2, and native D3D hosts for desktop overlay
experiments.

## Implementation Notes

- No build step and no third-party packages are required for the browser demo.
- `src/blackhole-port.frag` is derived from the Ghostty black hole project and
  keeps the original geodesic-tracing shader body. The compatibility edits are
  limited to making the shader work in WebGL2 and wiring browser uniforms.
- Browser JavaScript supplies the Ghostty/Shadertoy-style uniforms:
  `iResolution`, `iTime`, `iDate`, `iChannel0`, and the cursor-color token
  channel used by the original token mode.
- The shader runs in `MODE_DEMO`; JavaScript maps timer progress to the
  shader's demo timeline so the accretion disk shape changes as the session
  advances.

## Credits

The black hole shader is derived from
[s0xDk/ghostty-blackhole](https://github.com/s0xDk/ghostty-blackhole), which is
licensed under the MIT License.

The original shader credits Eric Bruneton's
[Black Hole Shader](https://ebruneton.github.io/black_hole_shader/) work.

## License

MIT. See [LICENSE](./LICENSE).
