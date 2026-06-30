const STATE_KEY = "blackhole-timer-state";
const ACTIVE_WINDOW_MS = 15_000;
const GROWTH_PER_SECOND = 0.012;
const DECAY_PER_SECOND = 0.006;
const ACTIVITY_BUMP = 0.006;
const SNAPSHOT_MIN_GAP_MS = 900;

const DEFAULT_STATE = {
  energy: 0.18,
  lastActivityAt: 0,
  lastUpdatedAt: Date.now(),
  startedAt: Date.now(),
};

const pendingSnapshots = new Map();
const lastSnapshotAt = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.idle.setDetectionInterval(60);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  scheduleSnapshot(tabId, "tab-activated");
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await updateState((state, now) => ({ ...state, lastActivityAt: 0, lastUpdatedAt: now }));
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id) {
    scheduleSnapshot(tab.id, "window-focus");
  }
});

chrome.idle.onStateChanged.addListener(async (idleState) => {
  if (idleState !== "active") {
    await updateState((state, now) => ({ ...state, lastActivityAt: 0, lastUpdatedAt: now }));
  }
});

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    return { ok: false, error: "Unknown message" };
  }

  if (message.type === "blackhole:hello") {
    const state = await getPublicState();
    if (sender.tab?.id) {
      scheduleSnapshot(sender.tab.id, "hello");
    }
    return { ok: true, state };
  }

  if (message.type === "blackhole:activity") {
    const state = await updateState((current, now) => {
      const evolved = evolveEnergy(current, now);
      return {
        ...evolved,
        energy: clamp01(evolved.energy + ACTIVITY_BUMP),
        lastActivityAt: now,
        lastUpdatedAt: now,
      };
    });
    if (sender.tab?.id) {
      scheduleSnapshot(sender.tab.id, message.reason || "activity");
    }
    return { ok: true, state: publicState(state) };
  }

  if (message.type === "blackhole:get-state") {
    return { ok: true, state: await getPublicState() };
  }

  if (message.type === "blackhole:request-snapshot") {
    if (sender.tab?.id) {
      scheduleSnapshot(sender.tab.id, message.reason || "request");
    }
    return { ok: true };
  }

  return { ok: false, error: `Unhandled message type: ${message.type}` };
}

async function readState() {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return { ...DEFAULT_STATE, ...(stored[STATE_KEY] || {}) };
}

async function writeState(state) {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

async function updateState(mutator) {
  const now = Date.now();
  const current = await readState();
  const next = mutator(current, now);
  await writeState(next);
  broadcastState(publicState(next));
  return next;
}

async function getPublicState() {
  const now = Date.now();
  const state = evolveEnergy(await readState(), now);
  await writeState(state);
  return publicState(state);
}

function evolveEnergy(state, now) {
  const elapsed = Math.max(0, (now - state.lastUpdatedAt) / 1000);
  const isActive = now - state.lastActivityAt <= ACTIVE_WINDOW_MS;
  const delta = elapsed * (isActive ? GROWTH_PER_SECOND : -DECAY_PER_SECOND);
  return {
    ...state,
    energy: clamp01(state.energy + delta),
    lastUpdatedAt: now,
  };
}

function publicState(state) {
  const now = Date.now();
  const age = (now - state.startedAt) / 1000;
  const reach = 0.04 + state.energy * 0.1;
  const x = clamp(0.72 + Math.sin(age * 0.19) * reach + Math.sin(age * 0.047) * reach * 0.45, 0.18, 0.82);
  const y = clamp(0.36 + Math.cos(age * 0.16) * reach * 0.72 + Math.sin(age * 0.071) * reach * 0.38, 0.18, 0.82);
  return {
    energy: state.energy,
    x,
    y,
    active: now - state.lastActivityAt <= ACTIVE_WINDOW_MS,
    lastActivityAt: state.lastActivityAt,
  };
}

async function broadcastState(state) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id && isInjectableUrl(tab.url))
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "blackhole:state", state })),
  );
}

function scheduleSnapshot(tabId, reason) {
  clearTimeout(pendingSnapshots.get(tabId));
  const now = Date.now();
  const last = lastSnapshotAt.get(tabId) || 0;
  const delay = Math.max(0, SNAPSHOT_MIN_GAP_MS - (now - last));
  const timer = setTimeout(() => {
    pendingSnapshots.delete(tabId);
    captureForTab(tabId, reason);
  }, delay);
  pendingSnapshots.set(tabId, timer);
}

async function captureForTab(tabId, reason) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.active || !isInjectableUrl(tab.url)) {
    return;
  }
  lastSnapshotAt.set(tabId, Date.now());
  try {
    await chrome.tabs.sendMessage(tabId, { type: "blackhole:prepare-capture" }).catch(() => {});
    await delay(80);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 82,
    });
    await chrome.tabs.sendMessage(tabId, {
      type: "blackhole:snapshot",
      dataUrl,
      capturedAt: Date.now(),
      reason,
    }).catch(() => {});
  } catch (error) {
    console.warn("[blackhole-timer] capture failed", error);
  } finally {
    await chrome.tabs.sendMessage(tabId, { type: "blackhole:finish-capture" }).catch(() => {});
  }
}

function isInjectableUrl(url = "") {
  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
