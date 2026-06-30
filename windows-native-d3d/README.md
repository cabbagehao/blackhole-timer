# Native D3D Windows Overlay

This is the native Windows route for Black Hole Timer. It does not use Chromium
or WebView2 for capture or rendering.

Pipeline:

1. Win32 borderless top-most DirectComposition window.
2. `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` to keep the overlay out
   of compatible capture APIs.
3. DXGI Desktop Duplication captures the primary display into a D3D11 texture.
4. A D3D11 pass runs `BlackHoleOverlay.hlsl` over the captured desktop texture.

The window is intentionally local rather than full-screen. It follows the black
hole and renders only the black-hole region, so the taskbar and app UI outside
that region remain normal Windows UI. The window is visual-only and no-activate;
input should continue to go to the underlying apps.

Download the GitHub Actions artifact from the `Windows Native D3D` workflow on
the `windows-native-d3d-actions` branch:

```text
BlackHoleTimer-Windows-NativeD3D
```

Extract the artifact on Windows and run:

```powershell
BlackHoleRestNativeD3D.exe
```

Keep `BlackHoleOverlay.hlsl` next to the executable.

Build on Windows:

```powershell
cmake -S windows-native-d3d -B windows-native-d3d/build -G "Visual Studio 17 2022" -A x64
cmake --build windows-native-d3d/build --config Release
```

Run:

```powershell
windows-native-d3d/build/Release/BlackHoleRestNativeD3D.exe
```

Shortcuts:

- `Ctrl+Alt+Q`: quit.

This implementation ports the browser shader path to HLSL and runs it over real
desktop frames. The window boundary is deliberately smaller than the full
screen; that keeps the desktop usable outside the black-hole effect.
