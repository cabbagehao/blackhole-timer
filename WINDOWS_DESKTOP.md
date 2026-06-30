# Windows Desktop Comparison Builds

This repo now has three Windows-oriented desktop hosts:

- Electron host: fast iteration and easiest packaging.
- Native D3D host: Win32 + DXGI Desktop Duplication + D3D11/HLSL.
- WebView2 WinForms host: native Windows window shell with WebView2 rendering,
  useful as a middle comparison point.

The Electron and WebView2 hosts load `desktop/desktop.html`, capture the real
display through `navigator.mediaDevices.getDisplayMedia()`, upload the live
video frame as `iChannel0`, and run `src/blackhole-port.frag` over the full
overlay window.

The native D3D host does not use Chromium. It captures the primary display with
DXGI Desktop Duplication and renders a HLSL port of the visual effect.

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

Install Visual Studio 2022 with C++ desktop workload and CMake, then configure:

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

- creates a Win32 borderless top-most overlay;
- calls `SetWindowDisplayAffinity(..., WDA_EXCLUDEFROMCAPTURE)`;
- captures the primary display through DXGI Desktop Duplication;
- renders through D3D11 and `windows-native-d3d/src/BlackHoleOverlay.hlsl`;
- supports `Ctrl+Alt+B` for click-through and `Ctrl+Alt+Q` to quit.

## Comparison Notes

Use the Electron and WebView2 versions to compare host behavior with the same
WebGL shader path. Use the native D3D version to compare the browser-host route
against a fully native capture/render route.

What to compare:

- capture permission flow;
- whether the overlay captures itself;
- capture latency and frame pacing;
- click-through behavior while the overlay is visible;
- GPU and CPU load at normal speed and accelerated demo speed;
- how each host behaves over full-screen apps and multiple monitors.

## Important Limitations

These builds do not modify the Windows compositor. They create a full-screen
overlay that displays a shader-processed copy of the screen. That is the
practical route available to normal desktop applications.

The native D3D version uses an HLSL visual port, not a line-by-line port of the
large WebGL/Ghostty shader. That keeps the native path practical and comparable
at the system level: real desktop frames, native capture, native rendering, and
native overlay behavior.
