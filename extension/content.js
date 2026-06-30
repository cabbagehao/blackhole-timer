(() => {
  if (window.top !== window || document.documentElement.dataset.blackholeRestInjected === "1") {
    return;
  }
  document.documentElement.dataset.blackholeRestInjected = "1";

  const ACTIVITY_THROTTLE_MS = 650;
  const STATE_POLL_MS = 1_000;
  const SNAPSHOT_REQUEST_THROTTLE_MS = 750;
  const MAX_DPR = 1.6;

  const runtime = chrome.runtime;
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  const canvas = document.createElement("canvas");
  const style = document.createElement("style");

  let gl;
  let program;
  let sceneCanvas;
  let sceneCtx;
  let sceneTexture;
  let buffer;
  let locations;
  let latestSnapshotImage = null;
  let latestState = { energy: 0.18, x: 0.72, y: 0.36, active: false };
  let lastActivitySentAt = 0;
  let lastSnapshotRequestedAt = 0;
  let lastRealStateAt = performance.now();
  let visualEnergy = latestState.energy;
  let running = false;

  style.textContent = `
    :host {
      all: initial;
      pointer-events: none;
    }
    canvas {
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      contain: strict;
      opacity: 0;
      transition: opacity 180ms ease-out;
      mix-blend-mode: normal;
      -webkit-mask-image: radial-gradient(circle, #000 0%, #000 56%, rgba(0, 0, 0, 0.72) 70%, transparent 100%);
      mask-image: radial-gradient(circle, #000 0%, #000 56%, rgba(0, 0, 0, 0.72) 70%, transparent 100%);
    }
  `;
  shadow.append(style, canvas);
  document.documentElement.append(host);

  init().catch((error) => {
    console.warn("[blackhole-timer] failed to start", error);
    host.remove();
  });

  async function init() {
    gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
    });
    if (!gl) {
      throw new Error("WebGL2 is unavailable");
    }

    sceneCanvas = document.createElement("canvas");
    sceneCtx = sceneCanvas.getContext("2d", { alpha: false });

    const shaderSource = await loadShader();
    program = createProgram(vertexShaderSource(), shaderSource);
    locations = {
      position: gl.getAttribLocation(program, "a_position"),
      channel0: gl.getUniformLocation(program, "iChannel0"),
      resolution: gl.getUniformLocation(program, "iResolution"),
      time: gl.getUniformLocation(program, "iTime"),
      date: gl.getUniformLocation(program, "iDate"),
      timeCursorChange: gl.getUniformLocation(program, "iTimeCursorChange"),
      currentCursorColor: gl.getUniformLocation(program, "iCurrentCursorColor"),
      previousCursorColor: gl.getUniformLocation(program, "iPreviousCursorColor"),
      blackholeCenter: gl.getUniformLocation(program, "iBlackholeCenter"),
    };

    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    sceneTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    installListeners();
    const hello = await sendMessage({ type: "blackhole:hello" });
    if (hello?.state) {
      latestState = hello.state;
      visualEnergy = hello.state.energy;
    }
    running = true;
    requestAnimationFrame(render);
  }

  function installListeners() {
    const activityEvents = ["pointermove", "pointerdown", "keydown", "wheel", "input", "scroll"];
    activityEvents.forEach((eventName) => {
      window.addEventListener(
        eventName,
        () => {
          sendActivity(eventName);
          if (eventName === "scroll" || eventName === "wheel" || eventName === "input") {
            requestSnapshot(eventName);
          }
        },
        { capture: true, passive: true },
      );
    });
    window.addEventListener("resize", () => requestSnapshot("resize"), { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        sendActivity("visibility");
        requestSnapshot("visibility");
      }
    });
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "blackhole:prepare-capture") {
        canvas.style.visibility = "hidden";
        requestAnimationFrame(() => {
          sendResponse({ ok: true });
        });
        return true;
      }
      if (message?.type === "blackhole:finish-capture") {
        canvas.style.visibility = "";
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === "blackhole:state" && message.state) {
        latestState = message.state;
        lastRealStateAt = performance.now();
      }
      if (message?.type === "blackhole:snapshot" && message.dataUrl) {
        loadSnapshot(message.dataUrl);
      }
      return false;
    });
    setInterval(async () => {
      const response = await sendMessage({ type: "blackhole:get-state" });
      if (response?.state) {
        latestState = response.state;
        lastRealStateAt = performance.now();
      }
    }, STATE_POLL_MS);
  }

  function sendActivity(reason) {
    const now = Date.now();
    if (now - lastActivitySentAt < ACTIVITY_THROTTLE_MS) {
      return;
    }
    lastActivitySentAt = now;
    sendMessage({ type: "blackhole:activity", reason }).then((response) => {
      if (response?.state) {
        latestState = response.state;
        lastRealStateAt = performance.now();
      }
    });
  }

  function requestSnapshot(reason) {
    const now = Date.now();
    if (now - lastSnapshotRequestedAt < SNAPSHOT_REQUEST_THROTTLE_MS) {
      return;
    }
    lastSnapshotRequestedAt = now;
    sendMessage({ type: "blackhole:request-snapshot", reason });
  }

  function loadSnapshot(dataUrl) {
    const image = new Image();
    image.onload = () => {
      latestSnapshotImage = image;
    };
    image.src = dataUrl;
  }

  function render(now) {
    if (!running) {
      return;
    }
    const dt = Math.min((now - lastRealStateAt) / 1000, 0.2);
    lastRealStateAt = now;
    visualEnergy += (latestState.energy - visualEnergy) * Math.min(1, dt * 5.5);

    const metrics = updateCanvasBox();
    canvas.style.opacity = latestSnapshotImage && visualEnergy > 0.025 ? String(0.46 + visualEnergy * 0.44) : "0";
    if (latestSnapshotImage) {
      drawSnapshotCrop(metrics);
      drawBlackhole(now, metrics);
    }
    requestAnimationFrame(render);
  }

  function updateCanvasBox() {
    const viewportW = Math.max(1, window.innerWidth);
    const viewportH = Math.max(1, window.innerHeight);
    const maxSize = Math.max(180, Math.min(760, Math.min(viewportW, viewportH) * 0.92));
    const minSize = Math.min(260, maxSize);
    const cssSize = Math.round(minSize + visualEnergy * (maxSize - minSize));
    const half = cssSize / 2;
    const minX = Math.min(half + 8, viewportW / 2);
    const maxX = Math.max(viewportW - half - 8, viewportW / 2);
    const minY = Math.min(half + 8, viewportH / 2);
    const maxY = Math.max(viewportH - half - 8, viewportH / 2);
    const cx = clamp(latestState.x * viewportW, minX, maxX);
    const cy = clamp(latestState.y * viewportH, minY, maxY);
    const left = Math.round(cx - half);
    const top = Math.round(cy - half);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const pixelSize = Math.max(1, Math.round(cssSize * dpr));

    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
      canvas.width = pixelSize;
      canvas.height = pixelSize;
      sceneCanvas.width = pixelSize;
      sceneCanvas.height = pixelSize;
      gl.viewport(0, 0, pixelSize, pixelSize);
    }

    return { cssSize, pixelSize, left, top, dpr };
  }

  function drawSnapshotCrop({ cssSize, pixelSize, left, top }) {
    const image = latestSnapshotImage;
    const scaleX = image.width / Math.max(1, window.innerWidth);
    const scaleY = image.height / Math.max(1, window.innerHeight);
    const sx = left * scaleX;
    const sy = top * scaleY;
    const sw = cssSize * scaleX;
    const sh = cssSize * scaleY;

    sceneCtx.clearRect(0, 0, pixelSize, pixelSize);
    sceneCtx.drawImage(image, sx, sy, sw, sh, 0, 0, pixelSize, pixelSize);
  }

  function drawBlackhole(now, { pixelSize }) {
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);

    const tokenColor = encodeTokenColor(visualEnergy);
    const date = new Date();
    const secondsToday = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.uniform1i(locations.channel0, 0);
    gl.uniform3f(locations.resolution, pixelSize, pixelSize, 1);
    gl.uniform1f(locations.time, now / 1000);
    gl.uniform4f(locations.date, date.getFullYear(), date.getMonth() + 1, date.getDate(), secondsToday);
    gl.uniform1f(locations.timeCursorChange, now / 1000);
    gl.uniform4fv(locations.currentCursorColor, tokenColor);
    gl.uniform4fv(locations.previousCursorColor, tokenColor);
    gl.uniform2f(locations.blackholeCenter, 0.5, 0.5);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  async function loadShader() {
    const response = await fetch(runtime.getURL("blackhole-port.frag"));
    if (!response.ok) {
      throw new Error(`Failed to load shader: ${response.status}`);
    }
    let original = await response.text();
    original = original
      .replace("#define SIZE_MODE MODE_DEMO", "#define SIZE_MODE MODE_TOKENS")
      .replace("const float TOKEN_AREA_MIN = 0.0100;", "const float TOKEN_AREA_MIN = 0.0060;")
      .replace("const float TOKEN_AREA_MAX = 0.5000;", "const float TOKEN_AREA_MAX = 0.1100;")
      .replace(
        "float shield = vis * smoothstep(WORK_AREA, WORK_AREA + 0.18, yUp);",
        "float shield = vis;",
      )
      .replace(
        "center = (lo + hi) * 0.5 + wander * ampEff\n               + wobAmp * vec2(cos(t * 0.8), sin(t * 1.0));",
        "center = iBlackholeCenter;",
      );

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
uniform vec2 iBlackholeCenter;

out vec4 outColor;

${original}

void main() {
  mainImage(outColor, gl_FragCoord.xy);
}
`;
  }

  function vertexShaderSource() {
    return `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
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
    return [(0xf0 | (hi ^ lo ^ 0x5)) / 255, (0xb0 | hi) / 255, lo / 255, 1];
  }

  function sendMessage(message) {
    return runtime.sendMessage(message).catch(() => null);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
