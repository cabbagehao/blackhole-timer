const canvas = document.querySelector("#blackhole");
const elapsedEl = document.querySelector("#elapsed");
const intensityEl = document.querySelector("#intensity");
const stateEl = document.querySelector("#state");
const meterFill = document.querySelector("#meterFill");
const toggleButton = document.querySelector("#toggle");
const resetButton = document.querySelector("#reset");
const thresholdInput = document.querySelector("#threshold");
const thresholdLabel = document.querySelector("#thresholdLabel");
const speedInput = document.querySelector("#speed");
const sceneInput = document.querySelector("#scene");
const panelToggle = document.querySelector("#panelToggle");

window.addEventListener("error", (event) => {
  showRuntimeError(event.error || event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  showRuntimeError(event.reason);
});

function showRuntimeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  stateEl.textContent = "Error";
  const panel = document.querySelector(".control-panel");
  let output = document.querySelector("#runtimeError");
  if (!output) {
    output = document.createElement("pre");
    output.id = "runtimeError";
    output.style.whiteSpace = "pre-wrap";
    output.style.color = "#ffb4a8";
    output.style.fontSize = "12px";
    output.style.lineHeight = "1.4";
    output.style.marginTop = "12px";
    panel.append(output);
  }
  output.textContent = message;
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const gl = canvas.getContext("webgl2", {
  alpha: false,
  antialias: false,
  preserveDrawingBuffer: false,
});

if (!gl) {
  document.body.innerHTML =
    '<main class="control-panel"><h1>WebGL2 unavailable</h1><p class="summary">This port keeps the original shader algorithm and needs WebGL2 integer operations.</p></main>';
  throw new Error("WebGL2 is not available");
}

const vertexShaderSource = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const sceneCanvas = document.createElement("canvas");
const sceneCtx = sceneCanvas.getContext("2d");
const state = {
  running: true,
  elapsed: 0,
  lastRealTime: performance.now(),
  thresholdMinutes: Number(thresholdInput.value),
  speed: Number(speedInput.value),
};
const mobilePanelQuery = window.matchMedia("(max-width: 720px)");
let panelManuallyChanged = false;

const params = new URLSearchParams(window.location.search);
let sceneMode = params.get("scene") === "work" ? "work" : "reference";
document.body.dataset.scene = sceneMode;
sceneInput.value = sceneMode;
const preview = Number(params.get("preview"));
if (Number.isFinite(preview)) {
  state.elapsed = Math.min(Math.max(preview, 0), 1) * state.thresholdMinutes * 60;
}
if (params.get("autoplay") === "0") {
  state.running = false;
}
syncPanelDefault();

const shaderSource = await loadGhosttyShader();
const program = createProgram(vertexShaderSource, shaderSource);
const locations = {
  position: gl.getAttribLocation(program, "a_position"),
  channel0: gl.getUniformLocation(program, "iChannel0"),
  resolution: gl.getUniformLocation(program, "iResolution"),
  time: gl.getUniformLocation(program, "iTime"),
  date: gl.getUniformLocation(program, "iDate"),
  timeCursorChange: gl.getUniformLocation(program, "iTimeCursorChange"),
  currentCursorColor: gl.getUniformLocation(program, "iCurrentCursorColor"),
  previousCursorColor: gl.getUniformLocation(program, "iPreviousCursorColor"),
};

const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
  gl.STATIC_DRAW,
);

const sceneTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

async function loadGhosttyShader() {
  const response = await fetch("./src/blackhole-port.frag", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load original shader: ${response.status}`);
  }
  const original = await response.text();
  return `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D iChannel0;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iDate;
uniform float iTimeCursorChange;
uniform vec4 iCurrentCursorColor;
uniform vec4 iPreviousCursorColor;

out vec4 outColor;

${original}

void main() {
  mainImage(outColor, gl_FragCoord.xy);
}
`;
}

function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || "Shader compile failed");
  }
  return shader;
}

function createProgram(vertexSource, fragmentSource) {
  const vertex = createShader(gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl.FRAGMENT_SHADER, fragmentSource);
  const linkedProgram = gl.createProgram();
  gl.attachShader(linkedProgram, vertex);
  gl.attachShader(linkedProgram, fragment);
  gl.linkProgram(linkedProgram);
  if (!gl.getProgramParameter(linkedProgram, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(linkedProgram);
    gl.deleteProgram(linkedProgram);
    throw new Error(message || "Program link failed");
  }
  return linkedProgram;
}

function encodeTokenColor(level) {
  const fill = Math.max(0, Math.min(250, Math.round(level * 250)));
  const hi = fill >> 4;
  const lo = fill & 0xf;
  return [
    (0xf0 | (hi ^ lo ^ 0x5)) / 255,
    (0xb0 | hi) / 255,
    (0x00 | lo) / 255,
    1,
  ];
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    sceneCanvas.width = width;
    sceneCanvas.height = height;
    gl.viewport(0, 0, width, height);
  }
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawScene(time, progress) {
  if (sceneMode === "reference") {
    drawReferenceTerminalScene(time, progress);
    return;
  }

  const w = sceneCanvas.width;
  const h = sceneCanvas.height;
  const ctx = sceneCtx;
  ctx.clearRect(0, 0, w, h);

  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, "#0d1110");
  grd.addColorStop(0.48, "#111614");
  grd.addColorStop(1, "#16100d");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(225, 236, 225, 0.045)";
  ctx.lineWidth = 1;
  const grid = Math.max(28, Math.floor(w / 36));
  for (let x = 0; x < w; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  drawBrowserWindow(ctx, w * 0.28, h * 0.12, w * 0.55, h * 0.46, progress, time);
  drawDocument(ctx, w * 0.08, h * 0.20, w * 0.28, h * 0.58, progress);
  drawTaskRail(ctx, w * 0.66, h * 0.58, w * 0.24, h * 0.29, progress);
  drawBottomDock(ctx, w, h, progress);
}

function drawReferenceTerminalScene(time, progress) {
  const w = sceneCanvas.width;
  const h = sceneCanvas.height;
  const ctx = sceneCtx;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#101312";
  ctx.fillRect(0, 0, w, h);

  const cssWidth = canvas.clientWidth || w;
  const dpr = Math.max(1, w / Math.max(cssWidth, 1));
  const isMobileCanvas = cssWidth <= 720;
  const fontSize = isMobileCanvas ? Math.round(13 * dpr) : Math.max(8, Math.floor(w / 125));
  const lineHeight = Math.floor(fontSize * (isMobileCanvas ? 1.95 : 1.55));
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";

  const snippets = [
    "10 + blackhole.glsl: growth is selected by #define SIZE_MODE (MODE_POMODORO, MODE_TOKENS, MODE_DEMO)",
    "12 + // Bruneton black hole shader; live geodesic lensing and a thin accretion disk",
    "19 + const float HOLE_RADIUS = 0.0200;  const float LENS_DEPTH = 13.0;",
    "31 + custom-shader = /path/to/blackhole.glsl",
    "44 + DISK_GAIN, DISK_OPACITY, DISK_TEMP, DOPPLER_MIX, DISK_BEAM",
    "58 + TOKEN_AREA_MIN / TOKEN_AREA_MAX drive context-fill growth",
    "77 + #define MODE_DEMO 2  // self-running showcase loop",
    "140 + tokenDecode(iCurrentCursorColor.rgb);",
    "288 + void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
    "435 + float b = length(pr); // impact parameter",
    "477 + // near field: trace the geodesic",
    "499 + vec3 a = -1.5 * h2 * x / (r2 * r2 * r);",
    "541 + // relativistic Doppler + gravitational shift",
    "584 + bg += texture(iChannel0, suv).rgb * toward;",
  ];

  const colors = ["#b8ffc1", "#d7ded8", "#98d7ff", "#ff6464", "#ffe27a", "#8ee6a2"];
  const charWidth = Math.max(1, ctx.measureText("M").width);
  const charsPerLine = Math.max(40, Math.floor((w - 20) / charWidth));
  for (let y = 10, row = 0; y < h - 42; y += lineHeight, row += 1) {
    let line = "";
    let cursor = row * 3;
    while (line.length < charsPerLine + 20) {
      line += `${snippets[cursor % snippets.length]}   `;
      cursor += 1;
    }
    ctx.fillStyle = colors[row % colors.length];
    ctx.fillText(line.slice(0, charsPerLine), 10, y);
  }

  ctx.fillStyle = "rgba(0,0,0,0.76)";
  ctx.fillRect(0, h - 42, w, 42);
  ctx.fillStyle = "#ffcf70";
  ctx.fillText("█", 18, h - 29);
  ctx.fillStyle = "#d7ded8";
  ctx.fillText(`auto mode · ${Math.round(progress * 100)}% focus · blackhole timer`, 42, h - 29);
}

function drawBrowserWindow(ctx, x, y, w, h, progress, time) {
  roundedRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = "rgba(230, 236, 227, 0.95)";
  ctx.fill();
  ctx.fillStyle = "#d8e2d9";
  ctx.fillRect(x, y + 44, w, 1);
  ctx.fillStyle = "#24302a";
  ctx.font = `${Math.max(13, w * 0.018)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText("research-board.local/session", x + 68, y + 29);
  ["#ff735c", "#ffd06f", "#61d394"].forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 22 + index * 22, y + 23, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#17201b";
  ctx.font = `700 ${Math.max(18, w * 0.035)}px Inter, system-ui, sans-serif`;
  ctx.fillText("Quarterly planning notes", x + 30, y + 86);
  ctx.fillStyle = "#526259";
  ctx.font = `${Math.max(12, w * 0.018)}px Inter, system-ui, sans-serif`;
  ctx.fillText("Active browser session - black hole grows with time on task", x + 30, y + 116);

  for (let i = 0; i < 11; i += 1) {
    const lineW = w * (0.48 + 0.32 * Math.abs(Math.sin(i * 1.7)));
    ctx.fillStyle = i % 3 === 0 ? "#b4c5b8" : "#d2ddd5";
    roundedRect(ctx, x + 30, y + 148 + i * 21, lineW, 8, 4);
    ctx.fill();
  }

  const cursorX = x + 30 + (Math.sin(time * 2) > 0 ? 180 : 0);
  ctx.fillStyle = progress > 0.85 ? "#ff7b54" : "#62d69f";
  ctx.fillRect(cursorX, y + 348, 9, 22);
}

function drawDocument(ctx, x, y, w, h, progress) {
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = "rgba(24, 33, 29, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();
  ctx.fillStyle = "#f3f7f1";
  ctx.font = `700 ${Math.max(16, w * 0.09)}px Inter, system-ui, sans-serif`;
  ctx.fillText("Work log", x + 24, y + 42);
  ctx.fillStyle = "#9cc7b5";
  ctx.font = `${Math.max(12, w * 0.05)}px ui-monospace, monospace`;
  ctx.fillText(`session load: ${Math.round(progress * 100)}%`, x + 24, y + 76);
  for (let i = 0; i < 12; i += 1) {
    const done = i / 12 < progress;
    ctx.fillStyle = done ? "#ffcf70" : "rgba(255,255,255,0.20)";
    ctx.fillRect(x + 24, y + 112 + i * 25, w - 48 - i * 4, 7);
  }
}

function drawTaskRail(ctx, x, y, w, h, progress) {
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.stroke();
  const labels = ["Write", "Review", "Ship"];
  labels.forEach((label, index) => {
    const rowY = y + 38 + index * 58;
    ctx.fillStyle = index / labels.length < progress ? "#ffcf70" : "#dce5dc";
    ctx.beginPath();
    ctx.arc(x + 30, rowY - 5, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#eef3ed";
    ctx.font = `700 ${Math.max(13, w * 0.07)}px Inter, system-ui, sans-serif`;
    ctx.fillText(label, x + 50, rowY);
  });
}

function drawBottomDock(ctx, w, h, progress) {
  const dockW = Math.min(w * 0.52, 760);
  const x = (w - dockW) / 2;
  const y = h - 86;
  roundedRect(ctx, x, y, dockW, 48, 12);
  ctx.fillStyle = "rgba(7, 9, 8, 0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();
  ctx.fillStyle = "#dce5dc";
  ctx.font = `700 ${Math.max(14, dockW * 0.023)}px Inter, system-ui, sans-serif`;
  const copy =
    progress >= 1
      ? "Break now - the workspace is collapsing"
      : "Focus session active - visual pressure rises over time";
  ctx.fillText(copy, x + 22, y + 30);
}

function render(now) {
  resize();
  const dt = Math.min((now - state.lastRealTime) / 1000, 0.2);
  state.lastRealTime = now;
  if (state.running) {
    state.elapsed += dt * state.speed;
  }

  const thresholdSeconds = state.thresholdMinutes * 60;
  const progress = Math.min(state.elapsed / thresholdSeconds, 1);
  drawScene(now / 1000, progress);

  gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);

  const tokenColor = encodeTokenColor(progress);
  const shaderTime = progress * 40;
  const secondsToday = new Date().getHours() * 3600 + new Date().getMinutes() * 60 + new Date().getSeconds();

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
  gl.uniform1i(locations.channel0, 0);
  gl.uniform3f(locations.resolution, canvas.width, canvas.height, 1);
  gl.uniform1f(locations.time, shaderTime);
  gl.uniform4f(locations.date, 2026, 6, 28, secondsToday);
  gl.uniform1f(locations.timeCursorChange, prefersReducedMotion ? 0 : now / 1000);
  gl.uniform4fv(locations.currentCursorColor, tokenColor);
  gl.uniform4fv(locations.previousCursorColor, tokenColor);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  updateReadout(progress);
  requestAnimationFrame(render);
}

function updateReadout(progress) {
  elapsedEl.textContent = formatTime(state.elapsed);
  intensityEl.textContent = `${Math.round(progress * 100)}%`;
  stateEl.textContent = progress >= 1 ? "Break" : state.running ? "Working" : "Paused";
  meterFill.style.width = `${progress * 100}%`;
  toggleButton.textContent = state.running ? "Pause" : "Start";
}

function setPanelCollapsed(collapsed) {
  document.body.dataset.panel = collapsed ? "collapsed" : "expanded";
  panelToggle.setAttribute("aria-label", collapsed ? "Expand controls" : "Collapse controls");
  panelToggle.title = collapsed ? "Expand controls" : "Collapse controls";
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
}

function syncPanelDefault() {
  if (!panelManuallyChanged) {
    setPanelCollapsed(mobilePanelQuery.matches && state.running);
  }
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

toggleButton.addEventListener("click", () => {
  state.running = !state.running;
  state.lastRealTime = performance.now();
  syncPanelDefault();
});

resetButton.addEventListener("click", () => {
  state.elapsed = 0;
  state.running = false;
  state.lastRealTime = performance.now();
  syncPanelDefault();
});

thresholdInput.addEventListener("input", () => {
  state.thresholdMinutes = Number(thresholdInput.value);
  thresholdLabel.textContent = `${state.thresholdMinutes} min`;
});

speedInput.addEventListener("change", () => {
  state.speed = Number(speedInput.value);
});

sceneInput.addEventListener("change", () => {
  sceneMode = sceneInput.value;
  document.body.dataset.scene = sceneMode;
  const nextUrl = new URL(window.location.href);
  if (sceneMode === "reference") {
    nextUrl.searchParams.delete("scene");
  } else {
    nextUrl.searchParams.set("scene", sceneMode);
  }
  window.history.replaceState({}, "", nextUrl);
});

panelToggle.addEventListener("click", () => {
  panelManuallyChanged = true;
  setPanelCollapsed(document.body.dataset.panel !== "collapsed");
});

mobilePanelQuery.addEventListener("change", () => {
  if (!mobilePanelQuery.matches) {
    panelManuallyChanged = false;
    setPanelCollapsed(false);
    return;
  }
  syncPanelDefault();
});

window.addEventListener("resize", resize);
thresholdLabel.textContent = `${state.thresholdMinutes} min`;
requestAnimationFrame(render);
