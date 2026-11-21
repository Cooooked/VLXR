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

  var state = { hz: 144, codec: "av1", res: 100, renderPct: 150, bitrate: 150, buffering: 1, foveated: false, brMode: "target", encQuality: "balanced", sharpening: 0 };
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
    var pixels = Math.pow(state.res / 100, 2) * (state.renderPct / 100);
    var codecFactor = CODEC_COST[state.codec];
    var qMul = { speed: 0.82, balanced: 1.0, quality: 1.18 }[state.encQuality] || 1;
    if (state.foveated) codecFactor *= 0.82;
    codecFactor *= qMul;
    var encodeMs = 0.9 + pixels * codecFactor * 1.15;
    // network pressure: bitrate vs resolution headroom
    var needMbps = pixels * (state.hz / 144) * 0.9;
    var brCap = state.brMode === "ceiling" ? state.bitrate * 1.6 : state.bitrate;
    var networkPressure = Math.max(0, (needMbps - brCap / 100) * 0.9);
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
      Array.prototype.forEach.call(hzRow.children, function (c) {
        c.classList.remove("is-active");
        c.setAttribute("aria-pressed", "false");
      });
      b.classList.add("is-active");
      b.setAttribute("aria-pressed", "true");
      document.getElementById("budgetNote").textContent =
        "Frame budget " + (1000 / state.hz).toFixed(2) + " ms";
      document.getElementById("statusText").textContent =
        "Active · Quest connected · " + state.hz + " Hz";
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
    document.getElementById("brMode").addEventListener("change", function (e) { state.brMode = e.target.value; });
    document.getElementById("encQuality").addEventListener("change", function (e) { state.encQuality = e.target.value; });
    document.getElementById("sharpening").addEventListener("input", function (e) { state.sharpening = +e.target.value; document.getElementById("sharpOut").textContent = e.target.value + "%"; });

    /* quick-setup scenarios — set the whole console at once */
    var SETUPS = {
      race:    { hz: 207, codec: "av1", res: 100, renderPct: 150, bitrate: 150, buffering: 1, foveated: true,  brMode: "target",  encQuality: "balanced", sharpening: 10,
                 note: "Tuned for sim racing — max rate, low latency." },
      desktop: { hz: 72,  codec: "hevc", res: 80,  renderPct: 100, bitrate: 100, buffering: 2, foveated: false, brMode: "ceiling", encQuality: "speed",     sharpening: 0,
                 note: "Efficient desktop streaming — cooler GPU, easy to read." },
      media:   { hz: 90,  codec: "hevc", res: 120, renderPct: 100, bitrate: 200, buffering: 3, foveated: false, brMode: "fixed",   encQuality: "quality",   sharpening: 15,
                 note: "Quality-first for movies and desktop work." }
    };
    function syncControls() {
      document.getElementById("codec").value = state.codec;
      document.getElementById("brMode").value = state.brMode;
      document.getElementById("encQuality").value = state.encQuality;
      document.getElementById("foveated").checked = state.foveated;
      var setRange = function (id, outId, val, fmt) {
        var el = document.getElementById(id); el.value = val;
        document.getElementById(outId).textContent = fmt(val);
      };
      setRange("bitrate", "brOut", state.bitrate, function (v) { return v + " Mbps"; });
      setRange("resolution", "resOut", state.res, function (v) { return v + "%"; });
      setRange("sharpening", "sharpOut", state.sharpening, function (v) { return v + "%"; });
      setRange("buffering", "bufOut", state.buffering, function (v) {
        return v === 0 ? "0 (lowest latency)" : v + (v === 1 ? " frame" : " frames");
      });
      Array.prototype.forEach.call(document.getElementById("hzRow").children, function (c) {
        var on = +c.dataset.hz === state.hz;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
      Array.prototype.forEach.call(document.getElementById("renderRow").children, function (c) {
        var on = +c.dataset.render === state.renderPct;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
      document.getElementById("budgetNote").textContent = "Frame budget " + (1000 / state.hz).toFixed(2) + " ms";
      document.getElementById("statusText").textContent = "Active · Quest connected · " + state.hz + " Hz";
    }
    document.getElementById("setupRow").addEventListener("click", function (e) {
      var b = e.target.closest(".preset"); if (!b) return;
      var p = SETUPS[b.dataset.setup];
      Object.assign(state, { hz: p.hz, codec: p.codec, res: p.res, renderPct: p.renderPct,
        bitrate: p.bitrate, buffering: p.buffering, foveated: p.foveated,
        brMode: p.brMode, encQuality: p.encQuality, sharpening: p.sharpening });
      Array.prototype.forEach.call(document.getElementById("setupRow").children, function (c) {
        var on = c === b;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
      document.getElementById("setupNote").textContent = p.note;
      syncControls();
    });
    // keep race preset highlighted by default (state already matches it)

    var renderRow = document.getElementById("renderRow");
    renderRow.addEventListener("click", function (e) {
      var b = e.target.closest(".preset"); if (!b) return;
      state.renderPct = +b.dataset.render;
      Array.prototype.forEach.call(renderRow.children, function (c) {
        var on = c === b;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
      document.getElementById("renderNote").textContent =
        "Render resolution " + state.renderPct + "% — what the game draws before the stream encodes it.";
    });

    // initialise console to the Race quick-setup so controls match the active chip
    var raceBtn = document.querySelector('#setupRow .preset[data-setup="race"]');
    if (raceBtn) raceBtn.click();
  }

  /* ---------- metric strip (Streamer-style sparkline cards) ---------- */
  var METRICS = [
    { id: "fps", tip: "Frames the headset decoded this second — the number that matters in-headset.", name: "Decoded FPS", color: "#3DD68C", fmt: function (v) { return v.toFixed(0); } },
    { id: "stale", tip: "Frames that arrived too late and were skipped — lower is better.", name: "Late displays", color: "#FFA629", fmt: function (v) { return v.toFixed(1); } },
    { id: "lat", tip: "Glass-to-glass latency estimate — game frame to photons.", name: "Total latency", color: "#ECEDF1", unit: " ms", fmt: function (v) { return v.toFixed(1); } },
    { id: "br", tip: "Measured stream bitrate — compare against your bitrate setting.", name: "Actual bitrate", color: "#9DBBFF", unit: " Mbps", fmt: function (v) { return v.toFixed(0); } },
    { id: "enc", tip: "Time spent queueing frames for the encoder.", name: "Encode", color: "#ECEDF1", unit: " ms", fmt: function (v) { return v.toFixed(1); } },
    { id: "net", tip: "Estimated network transit including buffering.", name: "Network", color: "#ECEDF1", unit: " ms", fmt: function (v) { return v.toFixed(1); } },
    { id: "dec", tip: "Headset-side decode time.", name: "Decode", color: "#ECEDF1", unit: " ms", fmt: function (v) { return v.toFixed(1); } },
    { id: "p99", tip: "Worst-case PC frame pacing — the stutter metric.", name: "PC pacing p99", color: "#3F7BFF", unit: " ms", fmt: function (v) { return v.toFixed(2); } },
    { id: "px", tip: "Resolution actually sent to the encoder per eye.", name: "Encoded / eye", color: "#8C90A0", fmt: function (v) { return v.toFixed(0) + " px"; } },
    { id: "crop", tip: "What the game renders per eye — the crop ViewLab-style tuning exploits.", name: "Game crop / eye", color: "#8C90A0", fmt: function (v) { return v.toFixed(0) + " px"; } },
    { id: "worst", tip: "Slowest PC frame this window — spikes show here first.", name: "Worst PC frame", color: "#FFA629", unit: " ms", fmt: function (v) { return v.toFixed(1); } },
    { id: "dq", tip: "Headset decoder queue depth — backlog shows as latency.", name: "Decoder queue", color: "#8C90A0", unit: " ms", fmt: function (v) { return v.toFixed(1); } },
    { id: "vq", tip: "Display queue — frames waiting for scanout.", name: "Display queue", color: "#8C90A0", unit: " ms", fmt: function (v) { return v.toFixed(1); } },
    { id: "target", tip: "The refresh rate you asked for.", name: "Target", color: "#5D6272", unit: " Hz", fmt: function (v) { return v.toFixed(0); } }
  ];
  var metricCards = [];

  function buildMetricStrip() {
    var strip = document.getElementById("metricStrip");
    if (!strip) return;
    METRICS.forEach(function (m) {
      var card = document.createElement("div");
      card.className = "metric-card";
      card.title = m.tip || "";
      var cv = document.createElement("canvas");
      cv.width = 160; cv.height = 30;
      var name = document.createElement("div"); name.className = "metric-name"; name.textContent = m.name;
      var val = document.createElement("div"); val.className = "metric-val"; val.textContent = "—";
      card.appendChild(name); card.appendChild(cv); card.appendChild(val);
      strip.appendChild(card);
      metricCards.push({ m: m, cv: cv, ctx: cv.getContext("2d"), val: val, hist: [] });
    });
  }

  function metricValues(s, ft) {
    var pixels = Math.pow(state.res / 100, 2) * (state.renderPct / 100);
    return {
      fps: state.hz * (0.98 + rand(Math.floor(performance.now() / 900)) * 0.04),
      stale: ft > s.budget ? (ft - s.budget) * 8 : rand(performance.now() / 700) * 0.4,
      lat: parseFloat(latency()),
      br: state.bitrate * (0.92 + rand(performance.now() / 1100) * 0.16),
      enc: s.encodeMs,
      net: 2 + state.buffering * 0.7 + rand(performance.now() / 500) * 0.8,
      dec: 2.6 + pixels * 1.4 + rand(performance.now() / 600) * 0.7,
      p99: ft,
      px: 2048 * Math.sqrt(pixels),
      crop: 3712 * Math.sqrt(pixels) * 0.62,
      worst: ft + rand(performance.now() / 300) * 0.6,
      dq: 0.4 + state.buffering * 0.5,
      vq: 0.3 + rand(performance.now() / 800) * 0.4,
      target: state.hz
    };
  }

  function drawMetricCard(mc, v) {
    mc.hist.push(v);
    if (mc.hist.length > 60) mc.hist.shift();
    mc.val.textContent = mc.m.fmt(v) + (mc.m.unit || "");
    var c = mc.ctx, w = mc.cv.width, h = mc.cv.height;
    c.clearRect(0, 0, w, h);
    var max = Math.max.apply(null, mc.hist.concat([0.001]));
    var min = Math.min.apply(null, mc.hist.concat([0]));
    var span = Math.max(1e-6, max - min * 0.5);
    c.strokeStyle = "rgba(60,64,80,.6)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, h - 0.5); c.lineTo(w, h - 0.5); c.stroke();
    c.strokeStyle = mc.m.color; c.lineWidth = 1.4; c.beginPath();
    mc.hist.forEach(function (p, i) {
      var x = (i / 59) * w;
      var y = h - 2 - ((p - min * 0.5) / span) * (h - 5);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.stroke();
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
    var mv = metricValues(s, ft);
    metricCards.forEach(function (mc) { drawMetricCard(mc, mv[mc.m.id]); });

    if (!reduced) requestAnimationFrame(frame);
  }

  bind();
  buildMetricStrip();

  /* scroll reveal */
  var revealEls = document.querySelectorAll(".section-head, .ledger-row, .bench-grid, .soon-card");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { el.classList.add("reveal"); io.observe(el); });
  }

  requestAnimationFrame(frame);
})();

/* Console footer — Screenshot downloads the simulated headset view as PNG. */
(function () {
  var btn = document.getElementById("shotBtn");
  var canvas = document.getElementById("viewport");
  if (!btn || !canvas) return;
  btn.addEventListener("click", function () {
    try {
      var a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "vlxr-screenshot.png";
      document.body.appendChild(a); a.click();
      setTimeout(function () { a.remove(); }, 100);
      btn.classList.add("is-done");
      btn.textContent = "Saved";
      setTimeout(function () { btn.classList.remove("is-done"); btn.textContent = "Screenshot"; }, 1600);
    } catch (e) { /* canvas tainted or unsupported — leave button as-is */ }
  });
})();

/* VLXR hero — PC -> headset stream illustration.
   Independent browser animation; no application code or internals. */
(function () {
  "use strict";
  var cv = document.getElementById("heroStream");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var w = 0, h = 0, raf = 0, t = 0;
  var packets = [];
  for (var i = 0; i < 26; i++) packets.push({ p: Math.random(), sp: 0.004 + Math.random() * 0.008, lane: (Math.random() - 0.5) * 0.7 });

  function size() {
    var r = cv.parentElement.getBoundingClientRect();
    w = cv.width = Math.min(r.width, 1600);
    h = cv.height = Math.min(r.height, 800);
  }
  size();
  window.addEventListener("resize", size);

  function node(x, y, kind) {
    ctx.save();
    ctx.translate(x, y);
    if (kind === "pc") {
      ctx.strokeStyle = "rgba(140,144,160,0.8)"; ctx.lineWidth = 2;
      ctx.strokeRect(-22, -14, 44, 30);
      ctx.beginPath(); ctx.moveTo(-10, 16); ctx.lineTo(10, 16); ctx.stroke();
      ctx.fillStyle = "rgba(63,123,255,0.9)";
      ctx.fillRect(-14, -8, 28, 4);
    } else {
      ctx.strokeStyle = "rgba(140,144,160,0.8)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-34, -8); ctx.lineTo(-24, -4); ctx.moveTo(34, -8); ctx.lineTo(24, -4); ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    var y = h * 0.42;
    var x0 = w * 0.30, x1 = w * 0.70;
    // link path (gentle arc)
    ctx.strokeStyle = "rgba(63,123,255,0.16)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo((x0 + x1) / 2, y - h * 0.10, x1, y);
    ctx.stroke();
    node(x0, y, "pc"); node(x1, y, "hmd");
    // packets
    packets.forEach(function (p) {
      p.p += p.sp;
      if (p.p > 1) p.p = 0;
      var px = x0 + (x1 - x0) * p.p;
      var py = y - Math.sin(p.p * Math.PI) * h * 0.10 + p.lane * 26 * Math.sin(p.p * Math.PI);
      var a = Math.sin(p.p * Math.PI);
      ctx.fillStyle = "rgba(155,187,255," + (0.15 + a * 0.75) + ")";
      ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
    });
    // Hz readout drifting 144->207
    var hz = 144 + Math.round(Math.sin(t * 0.4) * 30 + 15);
    ctx.font = "600 13px Consolas, monospace";
    ctx.fillStyle = "rgba(155,187,255,0.85)";
    ctx.textAlign = "center";
    ctx.fillText(hz + " Hz", (x0 + x1) / 2, y + h * 0.10);
    ctx.textAlign = "left";
    t += 0.01;
    if (!reduced) raf = requestAnimationFrame(draw);
  }
  draw();
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (e.isIntersecting && !reduced) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
        else cancelAnimationFrame(raf);
      });
    }).observe(cv);
  }
})();

/* Diagnostics window — functional tabs (illustrative content). */
(function () {
  "use strict";
  var tabs = document.querySelectorAll(".diag-tab");
  var panels = document.querySelectorAll(".diag-panel");
  // live bars: gently re-jitter chart heights while the Charts tab is visible
  var barsTimer = null;
  var chartsPanel = document.querySelector('.diag-panel[data-panel="charts"]');
  function barsTick() {
    if (!chartsPanel || !chartsPanel.classList.contains("is-active") || document.hidden) return;
    chartsPanel.querySelectorAll(".bars i").forEach(function (bar) {
      var base = parseFloat(bar.dataset.base || bar.style.height) || 50;
      if (!bar.dataset.base) bar.dataset.base = base;
      var j = (Math.random() * 2 - 1) * 6;
      bar.style.height = Math.max(15, Math.min(100, base + j)) + "%";
    });
  }
  function syncBars() {
    var on = chartsPanel && chartsPanel.classList.contains("is-active") && !document.hidden;
    if (on && !barsTimer) barsTimer = setInterval(barsTick, 900);
    if (!on && barsTimer) { clearInterval(barsTimer); barsTimer = null; }
  }
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      panels.forEach(function (p) {
        p.classList.toggle("is-active", p.dataset.panel === tab.dataset.tab);
      });
      syncBars();
    });
    tab.addEventListener("keydown", function (e) {
      var dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      var i = Array.prototype.indexOf.call(tabs, tab);
      var next = tabs[(i + dir + tabs.length) % tabs.length];
      next.focus(); next.click();
    });
  });
  document.addEventListener("visibilitychange", syncBars);

  // stats readout jitters gently while the All stats tab is visible
  var statsTimer = null;
  var statsPanel = document.querySelector('.diag-panel[data-panel="stats"]');
  var statVals = statsPanel ? Array.prototype.slice.call(statsPanel.querySelectorAll(".stats-row b")) : [];
  var statBase = statVals.map(function (b) { return b.textContent; });
  function statsTick() {
    statVals.forEach(function (b, i) {
      var base = statBase[i];
      var m = base.match(/^([\d.]+)(.*)$/);
      if (!m) return;
      var v = parseFloat(m[1]);
      var jit = (Math.random() * 2 - 1) * Math.max(0.05, v * 0.004);
      b.textContent = (v + jit).toFixed(m[1].indexOf(".") >= 0 ? m[1].split(".")[1].length : 0) + m[2];
    });
  }
  function syncStats() {
    var on = statsPanel && statsPanel.classList.contains("is-active") && !document.hidden;
    if (on && !statsTimer) statsTimer = setInterval(statsTick, 1100);
    if (!on && statsTimer) { clearInterval(statsTimer); statsTimer = null; }
  }
  tabs.forEach(function (t) { t.addEventListener("click", syncStats); });
  document.addEventListener("visibilitychange", syncStats);
})();

/* Mobile nav toggle */
(function () {
  var burger = document.getElementById("navBurger");
  var navLinks = document.getElementById("navLinks");
  if (!burger || !navLinks) return;
  burger.addEventListener("click", function () {
    var open = navLinks.classList.toggle("open");
    burger.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  navLinks.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      navLinks.classList.remove("open");
      burger.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
    }
  });
})();

/* Void diagram — per-panel hide/show (illustrates the Streamer's panel toggles). */
document.querySelectorAll(".panel-chip").forEach(function (chip) {
  chip.addEventListener("click", function () {
    var on = chip.getAttribute("aria-pressed") === "true";
    chip.setAttribute("aria-pressed", on ? "false" : "true");
  });
});

/* In-headset menu mock — click rows to cycle values (illustrates live apply). */
(function () {
  var rows = document.querySelectorAll(".menu-row[data-opt]");
  rows.forEach(function (row) {
    row.addEventListener("click", function () {
      var opts = row.dataset.opt.split("|");
      var idx = (parseInt(row.dataset.idx, 10) + 1) % opts.length;
      row.dataset.idx = idx;
      var val = opts[idx];
      var labels = row.dataset.labels ? row.dataset.labels.split("|") : null;
      row.querySelector("b").textContent = labels ? labels[idx] : val + (row.dataset.unit || "");
      row.classList.add("flash");
      setTimeout(function () { row.classList.remove("flash"); }, 350);
      // move selection like a stick would
      rows.forEach(function (r) { r.classList.remove("is-sel"); });
      row.classList.add("is-sel");
    });
  });
  var exit = document.querySelector(".menu-row.exit");
  var hint = document.querySelector(".menu-mock .menu-hint");
  if (exit && hint) {
    var baseHint = hint.textContent;
    exit.addEventListener("click", function () {
      hint.textContent = "menu closed — double-tap the menu button to reopen";
      exit.classList.add("flash");
      setTimeout(function () { exit.classList.remove("flash"); hint.textContent = baseHint; }, 2200);
    });
  }
})();

/* Telemetry — generate + download a sample stats.csv client-side. */
(function () {
  var btn = document.getElementById("csvDl");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var lines = ["# t,fps,frame_ms,pacing_p99_ms,latency_ms,bitrate_mbps,codec,res_x,res_y"];
    var codec = "AV1", rx = 3552, ry = 2112;
    var base = new Date(); base.setHours(14, 2, 0, 0);
    for (var i = 0; i < 60; i++) {
      var d = new Date(base.getTime() + i * 1000);
      var hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0"), ss = String(d.getSeconds()).padStart(2, "0");
      var fps = 206 + (Math.random() * 2 - 1);
      var fms = 1000 / 207 + (Math.random() - 0.5) * 0.15;
      var p99 = 4.8 + Math.random() * 0.4;
      var lat = 26.5 + Math.random() * 2.5;
      var br = 147 + Math.random() * 3;
      lines.push([hh + ":" + mm + ":" + ss, fps.toFixed(1), fms.toFixed(2), p99.toFixed(2), lat.toFixed(1), br.toFixed(1), codec, rx, ry].join(","));
    }
    var blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stats-sample.csv";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  });
})();

/* FAQ expand/collapse all */
(function () {
  var items = document.querySelectorAll(".faq-item");
  var all = document.getElementById("faqAll"), none = document.getElementById("faqNone");
  if (all) all.addEventListener("click", function () { items.forEach(function (d) { d.open = true; }); });
  if (none) none.addEventListener("click", function () { items.forEach(function (d) { d.open = false; }); });
})();

/* Scroll-spy: highlight the nav link for the section in view. */
(function () {
  var sections = Array.prototype.slice.call(document.querySelectorAll("main section[id]"));
  var links = {};
  document.querySelectorAll(".nav-links a").forEach(function (a) {
    var id = (a.getAttribute("href") || "").replace("#", "");
    if (id && document.getElementById(id)) links[id] = a;
  });
  if (!sections.length || !("IntersectionObserver" in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting && links[en.target.id]) {
        Object.keys(links).forEach(function (k) { links[k].classList.remove("is-active"); });
        links[en.target.id].classList.add("is-active");
      }
    });
  }, { rootMargin: "-30% 0px -60% 0px" });
  sections.forEach(function (s) { io.observe(s); });
})();

/* Console footer — Copy config exports current settings as plain text. */
(function () {
  var btn = document.getElementById("cfgBtn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var s = state;
    var bufLabels = ["Off", "1 frame", "2 frames", "3 frames", "4 frames"];
    var lines = [
      "VLXR — stream config (simulation)",
      "refresh_rate_hz: " + s.hz,
      "codec: " + s.codec.toUpperCase(),
      "stream_resolution_pct: " + s.res,
      "render_density_pct: " + s.renderPct,
      "bitrate_mbps: " + s.bitrate,
      "bitrate_mode: " + s.brMode,
      "encoder_quality: " + s.encQuality,
      "video_buffering: " + (bufLabels[s.buffering] || s.buffering),
      "foveated_encode: " + (s.foveated ? "on" : "off"),
      "sharpening_pct: " + s.sharpening,
      "",
      "cooooked.github.io/VLXR"
    ];
    var text = lines.join("\n");
    function done() {
      btn.classList.add("is-done");
      btn.textContent = "Copied";
      setTimeout(function () { btn.classList.remove("is-done"); btn.textContent = "Copy config"; }, 1600);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  });
})();

/* Console footer — Theater mode widens the simulated headset view. */
(function () {
  var btn = document.getElementById("theaterBtn");
  var win = btn && btn.closest(".app-window");
  if (!btn || !win) return;
  btn.addEventListener("click", function () {
    var on = win.classList.toggle("is-theater");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.classList.toggle("is-done", on);
    btn.textContent = on ? "Theater on" : "Theater";
  });
})();

/* Connection mock — runtime switch runs the ordered steps, then reports ready. */
(function () {
  var btn = document.getElementById("connSwitch");
  var rt = document.getElementById("connRuntime");
  var steps = document.getElementById("connSteps");
  if (!btn || !rt || !steps) return;
  var busy = false;
  function line(text, cls) {
    var li = document.createElement("li");
    li.textContent = text;
    if (cls) li.className = cls;
    steps.appendChild(li);
    while (steps.children.length > 5) steps.removeChild(steps.firstChild);
    return li;
  }
  btn.addEventListener("click", function () {
    if (busy) return;
    busy = true; btn.disabled = true;
    var other = rt.textContent === "VLXR" ? "Other runtime" : "VLXR";
    var seq = [
      "ordered shutdown — streamer stops cleanly",
      "runtime flip — " + other + " registered",
      "headset cold-launch — VLXR app restarts",
      "link verified — headset ready, streaming on " + other
    ];
    var i = 0;
    var cur = line(seq[0], "is-run");
    var timer = setInterval(function () {
      cur.className = "is-ok";
      i++;
      if (i >= seq.length) {
        clearInterval(timer);
        rt.textContent = other;
        line("switch complete — tray green", "is-ok");
        busy = false; btn.disabled = false;
        return;
      }
      cur = line(seq[i], "is-run");
    }, 650);
  });
})();

/* Console keyboard shortcuts: 1-3 select quick setups, T toggles theater. */
(function () {
  "use strict";
  var setups = { "1": "race", "2": "desktop", "3": "media" };
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (setups[e.key]) {
      var b = document.querySelector('#setupRow .preset[data-setup="' + setups[e.key] + '"]');
      if (b) { b.click(); e.preventDefault(); }
    } else if (e.key === "t" || e.key === "T") {
      var tb = document.getElementById("theaterBtn");
      if (tb) { tb.click(); e.preventDefault(); }
    } else if (e.key === "s" || e.key === "S") {
      var sb = document.getElementById("shotBtn");
      if (sb) { sb.click(); e.preventDefault(); }
    } else if (e.key === "Escape") {
      var win = document.querySelector(".app-window.is-theater");
      if (win) {
        var tb = document.getElementById("theaterBtn");
        if (tb) { tb.click(); e.preventDefault(); }
      }
    }
  });
})();
