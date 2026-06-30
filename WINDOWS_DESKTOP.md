# Windows Desktop Builds

This repo now has three Windows-oriented desktop hosts:

- Electron host: fast iteration and easiest packaging.
- Native D3D host: Win32 + DXGI Desktop Duplication + DirectComposition +
  D3D11/HLSL. This is the current route for the desktop-level effect.
- WebView2 WinForms host: native Windows window shell with WebView2 rendering,
  useful as a middle comparison point.

The Electron and WebView2 hosts load `desktop/desktop.html`, capture the real
display through `navigator.mediaDevices.getDisplayMedia()`, upload the live
video frame as `iChannel0`, and run `src/blackhole-port.frag` over the full
overlay window.

The native D3D host does not use Chromium. It captures the primary display with
DXGI Desktop Duplication and renders a HLSL port of the browser shader over a
small moving DirectComposition window. The window follows the black hole instead
of covering the whole screen, so the taskbar and apps outside the black-hole
area remain normal Windows UI.

## Run the Electron Version

Install dependencies once:

```sh
npm install
```

Start the Windows overlay:

```sh
npm run windows:electron
```

Start without screen capture, using the built-in moving reference texture:

```sh
npm run windows:electron:demo
```

The Electron host:

- creates a full-screen always-on-top overlay;
- auto-grants the primary display to `getDisplayMedia()`;
- calls `setContentProtection(true)` so Windows excludes the overlay from
  compatible capture paths;
- supports `Ctrl+Alt+B` for click-through and `Ctrl+Alt+Q` to quit.

## Run the WebView2 Version

Install the .NET 8 SDK and the WebView2 Runtime on Windows, then run:

```sh
npm run windows:webview2:run
```

Or publish a win-x64 build:

```sh
npm run windows:webview2:publish
```

The WebView2 host:

- creates a borderless top-most WinForms overlay;
- serves repo files through WebView2 virtual host mapping at
  `https://blackhole.local/`;
- calls `SetWindowDisplayAffinity(..., WDA_EXCLUDEFROMCAPTURE)` on the form and
  child WebView windows;
- supports `Ctrl+Alt+B` for click-through.

## Run the Native D3D Version

### Download the GitHub Actions Build

The easiest way to try the native Windows build is to download the artifact from
the `Windows Native D3D` workflow on the `windows-native-d3d-actions` branch.
The artifact is named:

```text
BlackHoleTimer-Windows-NativeD3D
```

Extract it on Windows and run:

```powershell
BlackHoleRestNativeD3D.exe
```

Keep `BlackHoleOverlay.hlsl` next to the executable; the native host compiles
that shader at startup.

### Build Locally on Windows

Install Visual Studio 2022 with the C++ desktop workload and CMake, then
configure:

```powershell
npm run windows:native:configure
```

Build:

```powershell
npm run windows:native:build
```

Run:

```powershell
windows-native-d3d/build/Release/BlackHoleRestNativeD3D.exe
```

The native D3D host:

- creates a small Win32 borderless top-most DirectComposition window that
  follows the black hole, instead of a full-screen input-covering overlay;
- calls `SetWindowDisplayAffinity(..., WDA_EXCLUDEFROMCAPTURE)`;
- captures the primary display through DXGI Desktop Duplication;
- renders the local black-hole region through
  `windows-native-d3d/src/BlackHoleOverlay.hlsl` while sampling the full desktop
  texture, so it still bends the underlying Windows apps visually;
- runs as a visual-only, no-activate, click-through window;
- keeps native speed at real time by default and caps the maximum black-hole
  influence area so it cannot grow into a full-screen blocker;
- supports `Ctrl+Alt+Q` to quit.

From WSL, deploy to a Windows-local directory, then build and run on the Windows
host with Windows CMake/Visual Studio tools, not WSL Electron:

```sh
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '& "\\wsl.localhost\Ubuntu\home\yhc\Projects\tmp\blackhole-timer\scripts\deploy-windows-native.ps1"'
```

## Comparison Notes

Use the Electron and WebView2 versions to compare host behavior with the same
WebGL shader path. Use the native D3D version to compare the browser-host route
against a fully native capture/render route.

What to compare:

- capture permission flow;
- whether the overlay captures itself;
- capture latency and frame pacing;
- whether normal app and taskbar clicks continue to work outside the moving
  black-hole window;
- GPU and CPU load at normal speed and accelerated demo speed;
- how each host behaves over full-screen apps and multiple monitors.

## Important Limitations

These builds do not modify the Windows compositor. They display a
shader-processed copy of captured desktop pixels in an overlay window. That is
the practical route available to normal desktop applications.

The native D3D version intentionally limits the actual Windows window to the
moving black-hole region. This trades away a mathematically full-screen lens for
the product requirement that black-hole-free areas stay usable for normal work.
