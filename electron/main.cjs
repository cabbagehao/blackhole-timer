const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, session } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const demoMode = process.argv.includes("--demo");
let mainWindow = null;
let staticServer = null;
let passthrough = false;

app.whenReady().then(async () => {
  const port = await startStaticServer();
  installDisplayMediaHandler();
  createWindow(port);
  registerShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  staticServer?.close();
  globalShortcut.unregisterAll();
});

function createWindow(port) {
  const display = screen.getPrimaryDisplay();
  mainWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    fullscreen: true,
    resizable: false,
    movable: false,
    minimizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: "#050605",
    title: "Black Hole Desktop Overlay - Electron",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setFullScreenable(false);
  mainWindow.setContentProtection(true);

  const url = new URL(`http://127.0.0.1:${port}/desktop/desktop.html`);
  url.searchParams.set("host", "electron");
  if (demoMode) {
    url.searchParams.set("demo", "1");
  } else {
    url.searchParams.set("autostart", "1");
  }
  mainWindow.loadURL(url.toString());
}

function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      });
      const source =
        sources.find((candidate) => candidate.display_id === String(primaryDisplay.id)) ||
        sources.find((candidate) => /screen|entire/i.test(candidate.name)) ||
        sources[0];

      if (!source) {
        callback({});
        return;
      }
      callback({ video: source });
    } catch (error) {
      console.error("[blackhole-timer] display media request failed", error);
      callback({});
    }
  });
}

function registerShortcuts() {
  globalShortcut.register("CommandOrControl+Alt+B", () => {
    setPassthrough(!passthrough);
  });
  globalShortcut.register("CommandOrControl+Alt+Q", () => {
    app.quit();
  });
}

function setPassthrough(enabled) {
  passthrough = Boolean(enabled);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.setIgnoreMouseEvents(passthrough, { forward: true });
  mainWindow.webContents.send("blackhole:passthrough", passthrough);
}

ipcMain.handle("blackhole:set-passthrough", (_event, enabled) => {
  setPassthrough(Boolean(enabled));
  return passthrough;
});

ipcMain.handle("blackhole:get-passthrough", () => passthrough);

ipcMain.handle("blackhole:quit", () => {
  app.quit();
});

async function startStaticServer() {
  staticServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const decodedPath = decodeURIComponent(requestUrl.pathname);
    const normalized = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(rootDir, normalized === "/" ? "desktop/desktop.html" : normalized);

    if (!filePath.startsWith(rootDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500);
        response.end(error.code === "ENOENT" ? "Not Found" : "Server Error");
        return;
      }

      response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
      response.end(data);
    });
  });

  await new Promise((resolve) => {
    staticServer.listen(0, "127.0.0.1", resolve);
  });
  return staticServer.address().port;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".frag") return "text/plain; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}
