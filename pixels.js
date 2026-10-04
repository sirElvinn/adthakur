// The animated pixel background.
//
// How it works, in plain terms:
//   1. The area is cut into a grid of small cells (like graph paper).
//   2. A smooth random "noise" pattern gives every cell a brightness between 0 and 1.
//      The pattern slowly drifts, so the picture moves.
//   3. Each cell gets a tiny square only if its brightness beats a fixed threshold from
//      a 4x4 "Bayer" table. That trick (ordered dithering) is how old screens faked
//      shades of grey with only on/off pixels.
//   4. Your mouse adds a soft glow, and a click sends out a ripple ring.
//
// Mark an element with data-pixels="noise" or data-pixels="ridge" and it gets a canvas.
// "ridge" draws the mountains you can see from Pokhara, with Machhapuchhre in the middle.

(function () {
  var fields = document.querySelectorAll("[data-pixels]");
  if (!fields.length || !window.HTMLCanvasElement) return;

  var CELL = 7;           // grid spacing, in CSS pixels
  var DOT = 3;            // size of each square
  var FPS = 30;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Smooth value noise ----
  var perm = new Uint8Array(512);
  (function () {
    var p = [], i, j, t, s = 20260929;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      j = s % (i + 1);
      t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();

  function hash(x, y) { return perm[perm[x & 255] + (y & 255)] / 255; }

  function noise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function fbm(x, y) {
    return 0.62 * noise(x, y) + 0.38 * noise(x * 2.13 + 17.1, y * 2.13 + 3.7);
  }

  // 4x4 Bayer thresholds, 0..1
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(function (n) {
    return (n + 0.5) / 16;
  });

  // The Pokhara skyline as (x, y) points on a 1200 x 150 sketch. Smaller y = higher.
  var RIDGE = [
    [0, 128], [80, 118], [150, 124], [230, 100], [290, 108], [350, 84], [400, 94], [455, 70],
    [500, 80], [548, 52], [585, 64], [622, 44], [660, 58], [700, 74], [742, 40], [757, 10],
    [765, 22], [773, 6], [790, 44], [835, 70], [880, 56], [930, 66], [975, 46], [1020, 60],
    [1070, 84], [1130, 96], [1200, 92]
  ];

  function ridgeAt(x) {
    if (x <= RIDGE[0][0]) return RIDGE[0][1];
    for (var i = 1; i < RIDGE.length; i++) {
      if (x <= RIDGE[i][0]) {
        var a = RIDGE[i - 1], b = RIDGE[i];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
    }
    return RIDGE[RIDGE.length - 1][1];
  }

  // ---- Shared color, refreshed when the theme changes ----
  var color = "";
  function readColor() {
    var cs = getComputedStyle(document.documentElement);
    var rgb = cs.getPropertyValue("--dot").trim() || "128,128,128";
    var alpha = parseFloat(cs.getPropertyValue("--dot-alpha")) || 0.2;
    color = "rgba(" + rgb + "," + alpha + ")";
  }
  readColor();

  // ---- One field per element ----
  function Field(el) {
    this.el = el;
    this.mode = el.dataset.pixels;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.ripples = [];
    this.glow = { x: -9999, y: -9999, tx: -9999, ty: -9999, k: 0, tk: 0 };
    this.resize();
  }

  Field.prototype.resize = function () {
    var r = this.el.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cols = Math.ceil(this.w / CELL);
    this.rows = Math.ceil(this.h / CELL);

    if (this.mode === "ridge") {
      // For each column, the row where the mountain starts.
      // Narrow screens zoom in on the middle so Machhapuchhre stays visible.
      var span = Math.max(this.w, 900);
      var top = this.h * 0.36, depth = this.h * 0.4;
      this.ridgeRow = new Float32Array(this.cols);
      for (var i = 0; i < this.cols; i++) {
        var sx = 600 + ((i * CELL - this.w / 2) * 1200) / span;
        this.ridgeRow[i] = (top + (ridgeAt(sx) / 150) * depth) / CELL;
      }
    }
  };

  Field.prototype.contains = function (cx, cy) {
    var r = this.el.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
      ? { x: cx - r.left, y: cy - r.top } : null;
  };

  Field.prototype.draw = function (now) {
    var ctx = this.ctx, cols = this.cols, rows = this.rows;
    var t = now * 0.001;
    var dx = t * 0.12, dy = -t * 0.07;               // how fast the pattern drifts
    var ridge = this.mode === "ridge" ? this.ridgeRow : null;

    // Ease the mouse glow toward the pointer.
    var g = this.glow;
    g.x += (g.tx - g.x) * 0.15;
    g.y += (g.ty - g.y) * 0.15;
    g.k += (g.tk - g.k) * 0.08;

    // Drop finished ripples.
    this.ripples = this.ripples.filter(function (rp) { return now - rp.t0 < 1800; });
    var ripples = this.ripples;

    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = color;

    for (var j = 0; j < rows; j++) {
      var y = j * CELL;
      for (var i = 0; i < cols; i++) {
        var x = i * CELL;
        var n = fbm(i * 0.055 + dx, j * 0.055 + dy);
        var v;

        if (ridge) {
          var below = j - ridge[i];
          if (below >= 0 && below < 1.2) {
            v = 2; // the outline of the ridge: always drawn, so the peaks read clearly
          } else if (below >= 0) {
            // Mountain: snowy just under the crest, textured slopes that thin out lower down.
            v = 0.42 + (n - 0.5) * 0.7 + 0.4 * Math.exp(-below / 2.5) - below * 0.01;
          } else {
            // Sky: a little drifting mist.
            v = (n - 0.7) * 1.6;
          }
        } else {
          v = (n - 0.45) * 1.9;
        }

        if (g.k > 0.01) {
          var gx = x - g.x, gy = y - g.y;
          v += g.k * 0.55 * Math.exp(-(gx * gx + gy * gy) / 5000);
        }

        for (var r = 0; r < ripples.length; r++) {
          var rp = ripples[r];
          var age = (now - rp.t0) / 1000;
          var rx = x - rp.x, ry = y - rp.y;
          var d = Math.sqrt(rx * rx + ry * ry) - age * 320;
          v += Math.exp(-(d * d) / 500) * 0.9 * (1 - age / 1.8);
        }

        if (v > BAYER[((j & 3) << 2) | (i & 3)]) ctx.fillRect(x, y, DOT, DOT);
      }
    }
  };

  var list = Array.prototype.map.call(fields, function (el) { return new Field(el); });

  // ---- Pointer: glow on move, ripple on click ----
  if (!reduceMotion) {
    window.addEventListener("pointermove", function (e) {
      list.forEach(function (f) {
        var p = f.contains(e.clientX, e.clientY);
        if (p) {
          if (f.glow.k < 0.02) { f.glow.x = p.x; f.glow.y = p.y; }
          f.glow.tx = p.x; f.glow.ty = p.y; f.glow.tk = 1;
        } else {
          f.glow.tk = 0;
        }
      });
    }, { passive: true });

    document.addEventListener("pointerleave", function () {
      list.forEach(function (f) { f.glow.tk = 0; });
    });

    window.addEventListener("pointerdown", function (e) {
      list.forEach(function (f) {
        var p = f.contains(e.clientX, e.clientY);
        if (p) {
          f.ripples.push({ x: p.x, y: p.y, t0: performance.now() });
          if (f.ripples.length > 5) f.ripples.shift();
        }
      });
    }, { passive: true });
  }

  // ---- Loop ----
  function frameAll(now) { list.forEach(function (f) { f.draw(now); }); }

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      list.forEach(function (f) { f.resize(); });
      if (reduceMotion) frameAll(0);
    }, 120);
  });

  window.addEventListener("themechange", function () {
    readColor();
    if (reduceMotion) frameAll(0);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    readColor();
    if (reduceMotion) frameAll(0);
  });

  if (reduceMotion) {
    frameAll(0); // one still picture, no movement
    return;
  }

  var last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden || now - last < 1000 / FPS) return;
    last = now;
    frameAll(now);
  }
  frameAll(performance.now());
  requestAnimationFrame(loop);
})();
