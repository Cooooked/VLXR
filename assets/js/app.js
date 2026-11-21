/* VLXR stream bench — illustrative simulation of the real Streamer controls.
   Renders a stylized "what the encoder sees" scene plus live stats and a
   scrolling frame-pacing graph. All numbers are simulated, labelled as such. */
(function () {
  "use strict";

  var canvas = document.getElementById("viewport");
  var ctx = canvas.getContext("2d");
  var W = 960, H = 600;
  canvas.width = W; canvas.height = H;

  var CODEC_COST = { av1: 1.0, hevc: 0.92, h264: 0.78 };
  var CODEC_CAP = { av1: 1.0, hevc: 1.0, h264: 0.55 }; // H.264 res cap (~2048/eye)

  var state = { hz: 144, codec: "av1", res: 100, bitrate: 150, buffering: 1, foveated: false };
  var samples = [];   // {t: frameTime, missed: bool}
  var hist = [];      // frame time history for graph
  var t0 = performance.now();
  var MAX_HIST = 240;

  // deterministic-ish jitter so the graph looks organic but stable per settings
  function rand(seed) {
    var x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function settings() {
    var budget = 1000 / state.hz;
    var pixels = Math.pow(state.res / 100, 2);
    var codecFactor = CODEC_COST[state.codec];
    if (state.foveated) codecFactor *= 0.82;
    var encodeMs = 0.9 + pixels * codecFactor * 1.15;
    // network pressure: bitrate vs resolution headroom
    var needMbps = pixels * (state.hz / 144) * 0.9;
    var networkPressure = Math.max(0, (needMbps - state.bitrate / 100) * 0.9);
    var jitter = 0.4 + networkPressure * 0.6 + state.buffering * 0.15;
    // total pipeline estimate (illustrative): render+encode+transfer+decode
    var total = encodeMs + 3.5 + state.buffering * (1000 / state.hz) * 0.55 + jitter;
    return { budget: budget, encodeMs: encodeMs, total: total, needMbps: needMbps };
  }

  function latency() {
    var s = settings();
    // ~25-35ms ballpark consistent with published figures on the test rig
    return (s.total + 21 + state.buffering * 0.8).toFixed(1);
  }

  /* ---------- viewport scene ---------- */
  function drawScene(t, s, fps, frameMs) {
    // "headset view": stylized night circuit scene with HUD
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0A0C12"); g.addColorStop(0.55, "#101522"); g.addColorStop(1, "#0B0D14");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // horizon + circuit glow
    var hy = H * 0.62;
    ctx.fillStyle = "#141A2B"; ctx.fillRect(0, hy, W, H - hy);
    var glow = ctx.createRadialGradient(W * 0.5, hy, 10, W * 0.5, hy, W * 0.7);
    glow.addColorStop(0, "rgba(63,123,255,0.28)"); glow.addColorStop(1, "rgba(63,123,255,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // track lines racing toward horizon
    ctx.strokeStyle = "rgba(63,123,255,0.5)"; ctx.lineWidth = 2;
    for (var i = -6; i <= 6; i++) {
      var spread = Math.abs(i) * 90 + 30;
      var off = (t * 0.35 * (1 + Math.abs(i) * 0.25)) % 400;
      var y1 = hy + 10, y2 = H;
      var x1 = W / 2 + i * spread * 0.55 + off * i * 0.4;
      var x2 = W / 2 + i * spread;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.fillStyle = "rgba(236,237,241,0.55)";
      ctx.beginPath(); ctx.arc(x2, H - ((off / 400) * (H - hy)), 3 + (1 - Math.abs(i) / 7) * 3, 0, 7); ctx.fill();
    }

    // foveated peripheral dim — illustration of periphery reduction
    if (state.foveated) {
      var fg = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.75);
      fg.addColorStop(0, "rgba(0,0,0,0)"); fg.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
    }

    // letterbox/visor hint
    ctx.strokeStyle = "rgba(140,144,160,0.35)"; ctx.lineWidth = 1;
    ctx.strokeRect(W * 0.06, H * 0.12, W * 0.88, H * 0.76);

    // ---- stats overlay (like the in-headset performance panel) ----
    var panelX = 26, panelY = H - 148;
    ctx.fillStyle = "rgba(14,15,19,0.78)";
    ctx.fillRect(panelX, panelY, 250, 132);
    ctx.strokeStyle = "#262933"; ctx.strokeRect(panelX, panelY, 250, 132);
    ctx.font = "600 12px Consolas, monospace"; ctx.fillStyle = "#3F7BFF";
    ctx.fillText("VLXR — PERF PANEL", panelX + 12, panelY + 20);
    ctx.font = "13px Consolas, monospace";
    function row(label, val, color) {
      ctx.fillStyle = "#8C90A0"; ctx.fillText(label, panelX + 12, panelY + 40 + row.i * 22);
      ctx.fillStyle = color || "#ECEDF1"; ctx.textAlign = "right";
      ctx.fillText(val, panelX + 238, panelY + 40 + row.i * 22);
      ctx.textAlign = "left"; row.i++;
    }
    row.i = 0;
    row("FPS", fps.toFixed(0), "#3DD68C");
    row("LATENCY", latency() + " ms", "#ECEDF1");
    row("ENCODE", s.encodeMs.toFixed(1) + " ms", "#ECEDF1");
    row("FRAME", frameMs.toFixed(1) + " ms", frameMs <= s.budget ? "#3DD68C" : "#FF5C5C");
    row("BUDGET", s.budget.toFixed(2) + " ms", "#8C90A0");
    row("BITRATE", state.bitrate + " Mbps", "#ECEDF1");

    // top-right mini readouts
    ctx.font = "12px Consolas, monospace"; ctx.textAlign = "right";
    ctx.fillStyle = "#8C90A0";
    ctx.fillText(state.hz + " Hz · " + state.codec.toUpperCase() + " · " + state.res + "%", W - 22, 30);
    ctx.fillStyle = frameMs <= s.budget ? "#3DD68C" : "#FF5C5C";
    ctx.fillText(frameMs <= s.budget ? "WITHIN BUDGET" : "OVER BUDGET", W - 22, 50);
    ctx.textAlign = "left";
  }

  /* ---------- pacing graph ---------- */
  function drawGraph(s, now) {
    var gx = 30, gy = H - 110, gw = W - 60, gh = 84;
    ctx.fillStyle = "rgba(14,15,19,0.7)";
    ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeStyle = "#262933"; ctx.strokeRect(gx, gy, gw, gh);
    ctx.font = "600 11px Consolas, monospace"; ctx.fillStyle = "#8C90A0";
    ctx.fillText("FRAME PACING — last " + (hist.length) + " frames (ms)", gx + 10, gy + 14);

    var maxV = Math.max(s.budget * 1.9, ...hist.map(function (h) { return h.t; }), 1);
    function y(v) { return gy + gh - 8 - (v / maxV) * (gh - 26); }

    // budget line
    ctx.setLineDash([5, 4]); ctx.strokeStyle = "#3F7BFF"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(gx, y(s.budget)); ctx.lineTo(gx + gw, y(s.budget)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#3F7BFF"; ctx.font = "10px Consolas, monospace";
    ctx.fillText("budget " + s.budget.toFixed(1), gx + gw - 86, y(s.budget) - 4);

    // over-budget zone tint
    ctx.fillStyle = "rgba(255,92,92,0.05)";
    ctx.fillRect(gx, gy + 8, gw, Math.max(0, y(s.budget) - (gy + 8)));

    if (hist.length > 1) {
      ctx.beginPath();
      hist.forEach(function (p, i) {
        var x = gx + 10 + (i / (MAX_HIST - 1)) * (gw - 20);
        var yy = y(p.t);
        if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      });
      ctx.strokeStyle = "#3DD68C"; ctx.lineWidth = 1.6; ctx.stroke();
      // missed markers
      hist.forEach(function (p, i) {
        if (p.miss) {
          var x = gx + 10 + (i / (MAX_HIST - 1)) * (gw - 20);
          ctx.fillStyle = "#FF5C5C";
          ctx.fillRect(x - 1.5, gy + gh - 10, 3, 10);
        }
      });
    }
    ctx.fillStyle = "#5D6272"; ctx.font = "10px Consolas, monospace";
    ctx.fillText("0", gx + 2, gy + gh - 2);
    ctx.fillText(maxV.toFixed(0) + "ms", gx + 2, gy + 12);
  }

  /* ---------- controls ---------- */
  function bind() {
    var hzRow = document.getElementById("hzRow");
    hzRow.addEventListener("click", function (e) {
      var b = e.target.closest(".hz-btn"); if (!b) return;
      state.hz = +b.dataset.hz;
      Array.prototype.forEach.call(hzRow.children, function (c) { c.classList.remove("is-active"); });
      b.classList.add("is-active");
      document.getElementById("budgetNote").textContent =
        "Frame budget " + (1000 / state.hz).toFixed(2) + " ms";
    });
    document.getElementById("codec").addEventListener("change", function (e) { state.codec = e.target.value; });
    var res = document.getElementById("resolution");
    res.addEventListener("input", function () {
      state.res = +res.value;
      document.getElementById("resOut").textContent = res.value + "%";
    });
    var br = document.getElementById("bitrate");
    br.addEventListener("input", function () {
      state.bitrate = +br.value;
      document.getElementById("brOut").textContent = br.value + " Mbps";
    });
    var buf = document.getElementById("buffering");
    buf.addEventListener("input", function () {
      state.buffering = +buf.value;
      document.getElementById("bufOut").textContent =
        buf.value === "0" ? "0 (lowest latency)" : buf.value + (buf.value === "1" ? " frame" : " frames");
    });
    document.getElementById("foveated").addEventListener("change", function (e) { state.foveated = e.target.checked; });
  }

  /* ---------- main loop ---------- */
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var last = performance.now();

  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    var t = (now - t0) / 1000;
    var s = settings();

    // simulated frame time with jitter, drifting around pipeline estimate
    var seed = Math.floor(now / (1000 / state.hz));
    var jitter = (rand(seed) - 0.5) * 2 * (s.budget * 0.16 + state.buffering * 0.4);
    var ft = s.total + jitter + (state.foveated ? -0.5 : 0);
    var miss = ft > s.budget;
    hist.push({ t: ft, miss: miss });
    if (hist.length > MAX_HIST) hist.shift();

    // draw
    ctx.clearRect(0, 0, W, H);
    var displayFps = state.hz; // headset-side rate
    drawScene(t, s, displayFps, ft);
    drawGraph(s, now);

    if (!reduced) requestAnimationFrame(frame);
  }

  bind();
  requestAnimationFrame(frame);
})();
