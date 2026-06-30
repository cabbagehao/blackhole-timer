# Native D3D Windows Overlay

This is the native comparison path for Black Hole Timer. It does
not use Chromium or WebView2 for capture or rendering.

Pipeline:

1. Win32 borderless top-most overlay window.
2. `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` to keep the overlay out
   of compatible capture APIs.
3. DXGI Desktop Duplication captures the primary display into a D3D11 texture.
4. A full-screen D3D11 pass runs `BlackHoleOverlay.hlsl` over that texture.

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

- `Ctrl+Alt+B`: toggle mouse click-through.
- `Ctrl+Alt+Q`: quit.

This implementation intentionally ports the visual idea to HLSL instead of
trying to compile the large WebGL/Ghostty fragment shader as-is. It is the right
host-level comparison against Electron because capture, overlay, and rendering
are native D3D all the way down.
