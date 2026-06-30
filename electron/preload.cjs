const { contextBridge, ipcRenderer } = require("electron");

const passthroughListeners = new Set();

ipcRenderer.on("blackhole:passthrough", (_event, enabled) => {
  for (const listener of passthroughListeners) {
    listener(Boolean(enabled));
  }
});

contextBridge.exposeInMainWorld("blackholeHost", {
  host: "electron",
  setPassthrough: (enabled) => ipcRenderer.invoke("blackhole:set-passthrough", Boolean(enabled)),
  getPassthrough: () => ipcRenderer.invoke("blackhole:get-passthrough"),
  quit: () => ipcRenderer.invoke("blackhole:quit"),
  onPassthroughChanged: (listener) => {
    passthroughListeners.add(listener);
    return () => passthroughListeners.delete(listener);
  },
});
