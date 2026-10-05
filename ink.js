// The ink drawings in each chapter, drawn live with JavaScript "brush strokes".
// No images and no video: every frame is painted on a <canvas> from code.
// Any <canvas class="ink" data-scene="..."> on the page gets the matching scene; it draws itself
// the first time you scroll to it, then keeps gently "boiling" while it's on screen.
//
// How the ink look works, in plain terms:
//   1. Every line starts as a list of points with a little random wobble, like a shaky hand.
//   2. brush() turns that line into a filled shape that is thick in the middle and thin at the
//      ends, the way a real brush stroke tapers.
//   3. Strokes "draw themselves" over time: each one has a start time and only shows the part
//      of the line it has reached so far.
//   4. About eight times a second every point is nudged slightly. That shimmer ("line boil") is
//      what makes hand-drawn animation feel alive.
//
// The handwritten label on each drawing is in SCENES near the bottom. Change it there.

(function () {
  "use strict";

  var canvases = document.querySelectorAll("canvas.ink[data-scene]");
  if (!canvases.length || !canvases[0].getContext) return;
  var ctx = null;   // the canvas being drawn right now (each drawing has its own)

  var W = 960, H = 540;          // drawing coordinates; the canvas is scaled to fit the page
  var INK = "#0e0d0c";
  var PAPER = "#ede5d1";
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---------------------------------------------------------------- randomness
  // Seeded random numbers, so a scene looks the same every frame (and every visit).
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash3(a, b, c) {
    var h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul((c + 0x3c6ef372) | 0, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  var R = Math.random;   // replaced with a seeded generator at the start of every frame
  var sid = 0;           // stroke counter, so each stroke boils differently
  var boil = 0;          // which "boil" frame we are on (changes ~8 times a second)

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function prog(t, t0, dur) { return clamp01((t - t0) / dur); }
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
  function easeInOut(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function lerp(a, b, u) { return a + (b - a) * u; }

  // ---------------------------------------------------------------- shapes as point lists
  function seg(x1, y1, x2, y2, wob) {
    wob = wob == null ? 1.2 : wob;
    var len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.ceil(len / 10));
    var nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
    var bow = (R() - 0.5) * Math.min(len * 0.04, 6);
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var u = i / n, b = Math.sin(u * Math.PI) * bow + (R() - 0.5) * wob;
      pts.push([x1 + (x2 - x1) * u + nx * b, y1 + (y2 - y1) * u + ny * b]);
    }
    return pts;
  }
  function path(points, wob) {
    var out = [];
    for (var i = 0; i < points.length - 1; i++) {
      var s = seg(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], wob);
      if (i > 0) s.shift();
      out = out.concat(s);
    }
    return out;
  }
  function closed(points, wob) { return path(points.concat([points[0]]), wob); }
  function arcPts(cx, cy, rx, ry, a0, a1, wob) {
    var n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) / 7));
    var jit = wob == null ? 1 : wob, k0 = 1 + (R() - 0.5) * 0.04, pts = [];
    for (var i = 0; i <= n; i++) {
      var a = a0 + (a1 - a0) * i / n, k = k0 + ((R() - 0.5) * jit) / Math.max(rx, 1);
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts;
  }
  function circlePts(cx, cy, r, wob) { return arcPts(cx, cy, r, r, 0, Math.PI * 2, wob); }
  function rectPts(x, y, w, h, wob) { return closed([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], wob); }
  function roundRectPts(x, y, w, h, r) {
    return [].concat(
      seg(x + r, y, x + w - r, y, 0.5), arcPts(x + w - r, y + r, r, r, -Math.PI / 2, 0, 0.3),
      seg(x + w, y + r, x + w, y + h - r, 0.5), arcPts(x + w - r, y + h - r, r, r, 0, Math.PI / 2, 0.3),
      seg(x + w - r, y + h, x + r, y + h, 0.5), arcPts(x + r, y + h - r, r, r, Math.PI / 2, Math.PI, 0.3),
      seg(x, y + h - r, x, y + r, 0.5), arcPts(x + r, y + r, r, r, Math.PI, Math.PI * 1.5, 0.3)
    );
  }
  function pointAt(pts, u) {
    var L = [0], i;
    for (i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    var target = L[L.length - 1] * u;
    for (i = 1; i < pts.length; i++) {
      if (L[i] >= target) {
        var f = (target - L[i - 1]) / ((L[i] - L[i - 1]) || 1);
        return [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)];
      }
    }
    return pts[pts.length - 1];
  }

  // ---------------------------------------------------------------- the brush
  var BOIL_AMP = 1.1;

  // Paint a line of points as a tapered brush stroke. p (0..1) is how much of it is drawn so far.
  function brush(pts, w, p, opt) {
    opt = opt || {};
    var id = ++sid, n = pts.length, i;
    var press = new Array(n);
    for (i = 0; i < n; i++) press[i] = 0.78 + R() * 0.44;   // always use the same amount of randomness
    if (p <= 0 || n < 2) return;

    var amp = reduceMotion || opt.still ? 0 : BOIL_AMP * (opt.boil == null ? 1 : opt.boil);
    var P = new Array(n), L = new Array(n);
    for (i = 0; i < n; i++) {
      P[i] = [
        pts[i][0] + (amp ? (hash3(id, i, boil) - 0.5) * 2 * amp : 0),
        pts[i][1] + (amp ? (hash3(id, i + 991, boil) - 0.5) * 2 * amp : 0)
      ];
      L[i] = i ? L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) : 0;
    }

    var total = L[n - 1] || 1, cut = total * Math.min(1, p);
    var Q = [P[0]], U = [0];
    for (i = 1; i < n; i++) {
      if (L[i] <= cut) { Q.push(P[i]); U.push(L[i] / total); continue; }
      var f = (cut - L[i - 1]) / ((L[i] - L[i - 1]) || 1);
      Q.push([lerp(P[i - 1][0], P[i][0], f), lerp(P[i - 1][1], P[i][1], f)]);
      U.push(cut / total);
      break;
    }
    var m = Q.length;
    if (m < 2) return;

    var tp = opt.taper == null ? 0.2 : opt.taper;
    var left = [], right = [], norms = [];
    for (i = 0; i < m; i++) {
      var a = Q[Math.max(0, i - 1)], b = Q[Math.min(m - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      var nx = -dy / d, ny = dx / d, u = U[i], s = 1;
      if (tp > 0) {
        var head = opt.noStartTaper ? 1 : (u + 0.04) / tp;
        var tail = opt.noEndTaper ? 1 : (1.04 - u) / tp;
        s = Math.pow(Math.max(0.05, Math.min(1, head, tail)), 0.55);
      }
      var hw = (w * s * press[Math.min(n - 1, Math.round(u * (n - 1)))]) / 2;
      norms.push([nx, ny, hw]);
      left.push([Q[i][0] + nx * hw, Q[i][1] + ny * hw]);
      right.push([Q[i][0] - nx * hw, Q[i][1] - ny * hw]);
    }

    ctx.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
    ctx.fillStyle = opt.color || PAPER;
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (i = 1; i < m; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (i = m - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();

    // Dry brush: thin broken streaks of background colour through the tail of the stroke.
    if (opt.dry && w > 2.5) {
      ctx.strokeStyle = opt.color === INK ? PAPER : INK;
      ctx.lineCap = "butt";
      ctx.lineWidth = Math.max(0.6, w * 0.11 * opt.dry);
      for (var k = 0; k < 3; k++) {
        var off = (k - 1) * 0.42 + (hash3(id, k, 7) - 0.5) * 0.15;
        var startI = Math.floor(m * (0.3 + hash3(id, k, 11) * 0.35)), drawing = false;
        ctx.beginPath();
        for (i = startI; i < m; i++) {
          if (hash3(id, i * 3 + k, 13) < 0.35) { drawing = false; continue; }
          var px = Q[i][0] + norms[i][0] * norms[i][2] * off * 2;
          var py = Q[i][1] + norms[i][1] * norms[i][2] * off * 2;
          if (!drawing) { ctx.moveTo(px, py); drawing = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Fill a wobbly shape (silhouettes, the floor, a sail...).
  function fill(poly, color, a, opt) {
    var id = ++sid;
    if (a <= 0 || poly.length < 3) return;
    var amp = reduceMotion || (opt && opt.still) ? 0 : 0.8;
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < poly.length; i++) {
      var x = poly[i][0] + (amp ? (hash3(id, i, boil) - 0.5) * 2 * amp : 0);
      var y = poly[i][1] + (amp ? (hash3(id, i + 991, boil) - 0.5) * 2 * amp : 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  var HAND = "Caveat, 'Segoe Print', 'Comic Sans MS', cursive";
  function hand(str, x, y, size, color, align, alpha) {
    if (alpha === 0) return;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.font = "700 " + size + "px " + HAND;
    ctx.fillStyle = color;
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- small reusable drawings
  function stars(n, x0, y0, x1, y1, t, t0) {
    for (var i = 0; i < n; i++) {
      var x = lerp(x0, x1, R()), y = lerp(y0, y1, R()), s = 1.2 + R() * 2.6, d = R();
      var on = reduceMotion || hash3(i, 5, boil) > 0.12;
      var a = prog(t, t0 + d * 1.2, 0.3) * (on ? 1 : 0.3);
      brush(seg(x - s, y, x + s, y, 0.2), 1.3, 1, { alpha: a, taper: 0.4 });
      brush(seg(x, y - s, x, y + s, 0.2), 1.3, 1, { alpha: a, taper: 0.4 });
    }
  }

  // The ridge you see from Pokhara; the twin peak is Machhapuchhre. (Same sketch as the site's pixel mountains.)
  var RIDGE = [
    [0, 128], [80, 118], [150, 124], [230, 100], [290, 108], [350, 84], [400, 94], [455, 70],
    [500, 80], [548, 52], [585, 64], [622, 44], [660, 58], [700, 74], [742, 40], [757, 10],
    [765, 22], [773, 6], [790, 44], [835, 70], [880, 56], [930, 66], [975, 46], [1020, 60],
    [1070, 84], [1130, 96], [1200, 92]
  ];

  function snow(ridge, t, t0, k, maxY) {
    var j = 0;
    for (var i = 1; i < ridge.length - 1; i++) {
      if (ridge[i][1] < ridge[i - 1][1] && ridge[i][1] < ridge[i + 1][1] && ridge[i][1] < maxY) {
        var pk = ridge[i], offs = [-12, -4, 6];
        for (var q = 0; q < 3; q++) {
          var o = offs[q] * k;
          brush(seg(pk[0] + o * 0.4, pk[1] + 7 * k, pk[0] + o * 1.7, pk[1] + (24 + Math.abs(offs[q])) * k, 0.5),
            2 * k + 0.4, prog(t, t0 + j * 0.1 + q * 0.05, 0.3), { dry: 0.5 });
        }
        j++;
      }
    }
  }

  // An abstract carved letter that hangs from a short top bar, in one of three body shapes, sometimes with
  // a stacked mark below and a small dot after it (the dot that separates syllables in Tibetan).
  // These suggest the look of the script; they are not real Tibetan letters.
  function glyph(x, y, s, color, p) {
    var r1 = R(), r2 = R(), r3 = R(), r4 = R(), v = Math.floor(R() * 3);
    brush(seg(x - 12 * s, y - 20 * s, x + 12 * s, y - 20 * s, 0.4), 4.2 * s, p, { color: color, taper: 0.1 });
    var body = v === 0
      ? [[x + 2 * s, y - 20 * s], [x + (r1 - 0.5) * 6 * s, y + 4 * s], [x - 8 * s, y + 12 * s]]
      : v === 1
        ? [[x - 10 * s, y - 20 * s], [x - 10 * s, y + 6 * s], [x + 10 * s, y + 6 * s], [x + 10 * s, y - 8 * s]]
        : [[x + 10 * s, y - 20 * s], [x - 6 * s, y - 6 * s], [x + 8 * s, y + 4 * s], [x - 4 * s, y + 14 * s]];
    brush(path(body, 0.4), 4 * s, p, { color: color, taper: 0.15 });
    brush(path([[x + 6 * s, y - 6 * s], [x + 12 * s, y + (r2 * 8 - 2) * s]], 0.3), 3.2 * s, v === 0 ? p : 0, { color: color });
    brush(arcPts(x, y + 22 * s, 7 * s, 4 * s, 0.2, Math.PI - 0.2, 0.3), 3 * s, r3 < 0.5 ? p : 0, { color: color });
    fill(circlePts(x + 21 * s, y - 19 * s, 2.4 * s, 0.1), color, r4 < 0.45 ? p : 0);
  }

  function plane(x, y, ang, a) {
    var c = Math.cos(ang), s = Math.sin(ang);
    function S(x1, y1, x2, y2, w) {
      brush(seg(x + x1 * c - y1 * s, y + x1 * s + y1 * c, x + x2 * c - y2 * s, y + x2 * s + y2 * c, 0.1), w, 1, { alpha: a, taper: 0.15 });
    }
    S(-16, 0, 17, 0, 4.5);
    S(3, 0, -6, -15, 3.4); S(3, 0, -6, 15, 3.4);
    S(-13, 0, -18, -6, 2.4); S(-13, 0, -18, 6, 2.4);
  }

  function walker(x, y, s, a, t) {
    var ph = Math.sin(t * 5) * 5 * s;
    fill(circlePts(x, y - 36 * s, 6 * s, 0.2), INK, a);
    brush(seg(x, y - 30 * s, x, y - 13 * s, 0.1), 4.5 * s, 1, { color: INK, alpha: a, taper: 0.1 });
    fill(rectPts(x + 1 * s, y - 30 * s, 6 * s, 11 * s, 0.1), INK, a);
    brush(seg(x, y - 13 * s, x + ph, y, 0.1), 3.2 * s, 1, { color: INK, alpha: a, taper: 0.1 });
    brush(seg(x, y - 13 * s, x - ph, y, 0.1), 3.2 * s, 1, { color: INK, alpha: a, taper: 0.1 });
  }

  // ---------------------------------------------------------------- scene 1: Pokhara
  function sPokhara(t) {
    stars(30, 0, 0, W, 150, t, 0);
    var sunY = 262 - 82 * easeOut(prog(t, 0.3, 5.5));
    fill(circlePts(790, sunY, 34, 0.5), PAPER, prog(t, 0.2, 0.8));
    for (var r = 0; r < 8; r++) {
      var a = -Math.PI + r * Math.PI / 7;
      brush(seg(790 + Math.cos(a) * 46, sunY + Math.sin(a) * 46, 790 + Math.cos(a) * 70, sunY + Math.sin(a) * 70, 0.5),
        2.4, prog(t, 1 + r * 0.08, 0.4), { dry: 0.6 });
    }

    var ridge = [[0, 300]].concat(RIDGE.map(function (p) { return [40 + p[0] * 0.733, 172 + p[1] * 1.15]; })).concat([[W, 282]]);
    fill(path(ridge, 1).concat([[W, 334], [0, 334]]), INK, 1, { still: true });
    brush(path(ridge, 1), 3, prog(t, 0.1, 2.2), {});
    snow(ridge, t, 1.4, 1, 286);
    brush(seg(0, 334, W, 334, 0.6), 2, prog(t, 0.4, 1.2), {});

    for (var row = 0; row < 11; row++) {
      var y = 348 + row * 17 + row * row * 0.55, nd = 3 + row;
      for (var d = 0; d < nd; d++) {
        var x0 = R() * W, len = 18 + R() * 50 + row * 5;
        brush(seg(x0, y, x0 + len, y + (R() - 0.5) * 2, 0.4), 1.2 + row * 0.25, prog(t, 0.9 + row * 0.1 + d * 0.02, 0.35), {});
      }
    }
    for (var k = 0; k < 9; k++) {
      var yy = 342 + k * 14, ww = 60 - k * 5;
      brush(seg(790 - ww / 2 + (R() - 0.5) * 8, yy, 790 + ww / 2 + (R() - 0.5) * 8, yy, 0.4), 2.2, prog(t, 2 + k * 0.08, 0.3), {});
    }

    var bx = 150 + t * 26, by = 452 + Math.sin(t * 1.6) * 2.5;
    brush(path([[bx - 50, by - 8], [bx - 30, by + 9], [bx + 30, by + 9], [bx + 52, by - 10]], 0.6), 4, prog(t, 1.6, 0.6), {});
    brush(seg(bx - 50, by - 8, bx + 52, by - 10, 0.5), 2, prog(t, 1.8, 0.5), {});
    brush(seg(bx + 4, by - 9, bx + 4, by - 78, 0.4), 2.4, prog(t, 2.0, 0.5), {});
    fill(closed([[bx + 8, by - 74], [bx + 8, by - 16], [bx + 46, by - 18]], 0.6), PAPER, prog(t, 2.3, 0.5));
    fill(circlePts(bx - 22, by - 24, 5, 0.3), PAPER, prog(t, 2.4, 0.4));
    brush(seg(bx - 22, by - 19, bx - 24, by - 8, 0.3), 3, prog(t, 2.4, 0.4), {});
    brush(seg(bx - 34, by - 18, bx - 64, by + 16, 0.4), 1.8, prog(t, 2.6, 0.4), {});
    for (var q = 0; q < 3; q++) {
      brush(seg(bx - 40 + q * 30, by + 18 + q * 3, bx - 10 + q * 30, by + 18 + q * 3, 0.4), 1.4, prog(t, 2.8, 0.4), { alpha: 0.7 });
    }

    for (var b = 0; b < 3; b++) {   // birds last: their wings change length as they flap
      var cx = 300 + t * 30 + b * 34, cy = 120 + b * 12 + Math.sin(t * 3 + b) * 3, f = Math.sin(t * 8 + b * 2) * 3;
      brush(path([[cx - 9, cy - 2 - f], [cx, cy + 3], [cx + 9, cy - 2 - f]], 0.2), 1.8, prog(t, 2.2 + b * 0.2, 0.3), { taper: 0.3 });
    }
  }

  // ---------------------------------------------------------------- scene 2: the library
  var FX0 = 448, FX1 = 512, FY = 302, TOP = 214;

  function shelfWall(t, side) {
    function X(x) { return side > 0 ? x : W - x; }
    var near = [-10, 70, 150, 230, 310, 390, 470, 560];
    function farY(y) { return TOP + (y / 540) * (FY - TOP); }
    function yAt(y, x) { return lerp(y, farY(y), x / FX0); }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(0), -10); ctx.lineTo(X(FX0), TOP - 1); ctx.lineTo(X(FX0), FY); ctx.lineTo(X(56), 540); ctx.lineTo(X(0), 540);
    ctx.closePath();
    ctx.clip();

    for (var s = 0; s < near.length; s++) {
      brush(seg(X(0), near[s], X(FX0 - 2), farY(near[s]), 0.6), 2.2, prog(t, 0.3 + s * 0.05, 0.9), {});
    }
    for (s = 0; s < near.length - 1; s++) {
      for (var x = 6; x < FX0 - 6;) {
        var depth = 1 - x / FX0, step = 3 + 15 * Math.pow(depth, 1.4);
        var r1 = R(), r2 = R(), r3 = R(), r4 = R();
        if (r1 > 0.1) {
          var top = yAt(near[s], x), bot = yAt(near[s + 1], x), band = bot - top;
          var y0 = top + band * (0.12 + r2 * 0.22), y1 = bot - band * 0.06;
          var tilt = r3 < 0.07 ? (r4 - 0.5) * band * 0.4 : 0;
          var bw = (1 + 6.5 * Math.pow(depth, 1.2)) * (0.6 + r4 * 0.6);
          brush(seg(X(x + tilt), y0, X(x), y1, 0.3), bw, prog(t, 0.5 + depth * 2.4 + s * 0.04, 0.3), { taper: 0.08 });
        }
        x += step * (0.7 + r2 * 0.6);
      }
    }
    ctx.restore();
  }

  function sLibrary(t) {
    fill(rectPts(FX0 + 2, TOP, FX1 - FX0 - 4, FY - TOP, 0.8), PAPER, prog(t, 0.1, 0.6));
    fill(closed([[56, 540], [904, 540], [FX1, FY], [FX0, FY]], 1.2), PAPER, prog(t, 0.25, 0.6));
    shelfWall(t, 1);
    shelfWall(t, -1);

    for (var i = 0; i < 7; i++) {
      brush(seg(56 + i * 141, 540, FX0 + i * (FX1 - FX0) / 6, FY, 0.7), 2.4, prog(t, 0.7 + i * 0.06, 0.6), { color: INK });
    }
    [0.12, 0.28, 0.5, 0.78].forEach(function (k, j) {
      var y = FY + (540 - FY) * k, xl = lerp(FX0, 56, k), xr = lerp(FX1, 904, k);
      brush(seg(xl + 6, y, xr - 6, y, 0.8), 1.4 + k * 2, prog(t, 1.1 + j * 0.08, 0.5), { color: INK });
    });

    brush(seg(480, 0, 480, 104, 0.3), 1.6, prog(t, 0.2, 0.5), {});
    fill(closed([[460, 104], [500, 104], [514, 126], [446, 126]], 0.5), PAPER, prog(t, 0.5, 0.4));
    [-1, -0.35, 0.35, 1].forEach(function (k, j) {
      brush(seg(480 + k * 24, 132, 480 + k * 70, 200, 0.6), 3, prog(t, 0.8 + j * 0.06, 0.4), { dry: 0.8, alpha: 0.85 });
    });

    // someone reading at the end of the aisle
    var fa = prog(t, 1.2, 0.5);
    fill(circlePts(474, 236, 7.5, 0.3), INK, fa);
    fill(closed([[466, 246], [483, 246], [487, 300], [462, 300]], 0.4), INK, fa);
    fill(rectPts(484, 255, 13, 10, 0.3), PAPER, fa);
    brush(rectPts(484, 255, 13, 10, 0.3), 1, fa, { color: INK, taper: 0 });
    var flip = (t * 0.8) % 1;
    brush(seg(486 + flip * 9, 256, 486 + flip * 9, 264, 0.1), 1, fa, { color: INK, taper: 0 });

    // the library cat (tail last: it moves)
    var ca = prog(t, 2.2, 0.5), cx = 560, cy = 470;
    fill(arcPts(cx, cy, 22, 15, 0, Math.PI * 2, 0.5), INK, ca);
    fill(circlePts(cx - 20, cy - 16, 10, 0.4), INK, ca);
    fill(closed([[cx - 28, cy - 22], [cx - 26, cy - 34], [cx - 20, cy - 25]], 0.2), INK, ca);
    fill(closed([[cx - 18, cy - 25], [cx - 12, cy - 34], [cx - 10, cy - 22]], 0.2), INK, ca);
    var sw = Math.sin(t * 2.2) * 8;
    brush(path([[cx + 20, cy + 4], [cx + 34, cy - 8], [cx + 38 + sw * 0.3, cy - 24], [cx + 32 + sw, cy - 34]], 0.3), 4, ca, { color: INK, taper: 0.5 });
  }

  // ---------------------------------------------------------------- scene 3: night, writing code
  function sNight(t) {
    var wx = 80, wy = 56, ww = 240, wh = 220;
    stars(16, wx + 12, wy + 12, wx + ww - 12, wy + wh - 12, t, 0.3);
    fill(circlePts(wx + 168, wy + 62, 22, 0.4), PAPER, prog(t, 0.6, 0.5));
    fill(circlePts(wx + 178, wy + 55, 20, 0.4), INK, prog(t, 0.6, 0.5));
    brush(rectPts(wx, wy, ww, wh, 0.8), 3.4, prog(t, 0.1, 1.2), { taper: 0.03 });
    brush(seg(wx + ww / 2, wy, wx + ww / 2, wy + wh, 0.6), 2.4, prog(t, 0.8, 0.5), {});
    brush(seg(wx, wy + wh / 2, wx + ww, wy + wh / 2, 0.6), 2.4, prog(t, 0.9, 0.5), {});

    var ccx = 420, ccy = 112;
    brush(circlePts(ccx, ccy, 30, 0.5), 2.6, prog(t, 0.5, 0.8), { taper: 0.05 });
    var hA = ((2 + 7 / 60) / 12) * Math.PI * 2 - Math.PI / 2, mA = (7 / 60) * Math.PI * 2 - Math.PI / 2;
    brush(seg(ccx, ccy, ccx + Math.cos(hA) * 15, ccy + Math.sin(hA) * 15, 0.2), 3, prog(t, 1.1, 0.3), {});
    brush(seg(ccx, ccy, ccx + Math.cos(mA) * 23, ccy + Math.sin(mA) * 23, 0.2), 2, prog(t, 1.2, 0.3), {});
    for (var h = 0; h < 12; h++) {
      var a = (h / 12) * Math.PI * 2;
      brush(seg(ccx + Math.cos(a) * 24, ccy + Math.sin(a) * 24, ccx + Math.cos(a) * 27, ccy + Math.sin(a) * 27, 0.1), 1.6, prog(t, 0.9, 0.3), { taper: 0 });
    }

    brush(seg(30, 392, 930, 392, 0.8), 3.6, prog(t, 0.2, 1), { taper: 0.05 });
    brush(seg(70, 392, 70, 540, 0.6), 3, prog(t, 0.6, 0.5), {});
    brush(seg(890, 392, 890, 540, 0.6), 3, prog(t, 0.6, 0.5), {});

    var lx = 520, ly = 190, lw = 320, lh = 186;
    fill(rectPts(lx + 3, ly + 3, lw - 6, lh - 6, 0.5), PAPER, prog(t, 0.6, 0.6) * 0.92);
    brush(rectPts(lx, ly, lw, lh, 0.7), 3.2, prog(t, 0.4, 1), { taper: 0.03 });
    brush(seg(lx - 18, 386, lx + lw + 18, 386, 0.5), 3, prog(t, 0.9, 0.5), {});
    var indents = [0, 1, 2, 2, 3, 2, 1, 2, 2, 1, 0];
    for (var k = 0; k < indents.length; k++) {
      var y = ly + 22 + k * 15, x = lx + 18 + indents[k] * 18, parts = 1 + Math.floor(R() * 3);
      for (var q = 0; q < 3; q++) {
        var len = 18 + R() * 70;
        if (q < parts && x + len < lx + lw - 14) {
          brush(seg(x, y, x + len, y, 0.3), 3, prog(t, 1.0 + k * 0.32 + q * 0.09, 0.12), { color: INK, taper: 0.05 });
        }
        x += len + 10;
      }
    }
    var lastK = Math.max(0, Math.min(indents.length - 1, Math.floor((t - 1.0) / 0.32)));
    var blink = t > 1 && Math.floor(t * 2.2) % 2 === 0 ? 1 : 0;
    fill(rectPts(lx + 18 + indents[lastK] * 18, ly + 15 + lastK * 15, 8, 12, 0.2), INK, blink);

    // looking over my shoulder: a silhouette against the bright screen
    var pa = prog(t, 0.3, 0.8);
    fill(closed([[430, 540], [468, 486], [560, 452], [720, 452], [812, 486], [850, 540]], 1), INK, pa);
    fill(circlePts(640, 386, 58, 0.8), INK, pa);
    fill(closed([[612, 430], [668, 430], [674, 462], [606, 462]], 0.4), INK, pa);
    brush(path([[440, 532], [470, 486], [560, 454], [604, 450]], 0.6), 2.6, prog(t, 1.1, 0.6), {});
    brush(path([[676, 450], [720, 454], [810, 486], [840, 532]], 0.6), 2.6, prog(t, 1.2, 0.6), {});

    // mug, with steam last (it moves)
    var mx = 200;
    brush(closed([[mx - 24, 344], [mx + 24, 344], [mx + 21, 391], [mx - 21, 391]], 0.5), 2.8, prog(t, 0.7, 0.6), { taper: 0.03 });
    brush(arcPts(mx + 28, 366, 11, 13, -1.4, 1.4, 0.3), 2.6, prog(t, 0.9, 0.4), {});
    for (var st = 0; st < 3; st++) {
      var pts = [];
      for (var yy = 0; yy <= 6; yy++) pts.push([mx - 10 + st * 10 + Math.sin(yy * 0.9 + t * 2.4 + st) * 5, 336 - yy * 12]);
      brush(pts, 2.2, prog(t, 1.3 + st * 0.15, 0.6), { alpha: 0.75, taper: 0.4, still: true });
    }
  }

  // ---------------------------------------------------------------- scene 4: reading stone (Lipi AI)
  function sStone(t) {
    var sx0 = 120, sy0 = 100, sx1 = 500, sy1 = 450;
    fill(closed([[sx0 + 30, sy0], [sx1 - 40, sy0 + 8], [sx1, sy0 + 50], [sx1 - 8, sy1 - 30], [sx1 - 50, sy1],
      [sx0 + 26, sy1 - 6], [sx0, sy1 - 60], [sx0 + 6, sy0 + 46]], 2.2), PAPER, prog(t, 0.1, 0.5));
    for (var sp = 0; sp < 40; sp++) {
      var px = lerp(sx0 + 30, sx1 - 30, R()), py = lerp(sy0 + 30, sy1 - 30, R());
      brush(seg(px, py, px + 3 + R() * 6, py + (R() - 0.5) * 3, 0.2), 1, prog(t, 0.4, 0.4), { color: INK, alpha: 0.35 });
    }
    var idx = 0;
    for (var row = 0; row < 4; row++) {
      for (var c = 0; c < 6; c++) {
        glyph(180 + c * 52 + (R() - 0.5) * 6, 170 + row * 72, 1, INK, prog(t, 0.6 + idx * 0.06, 0.25));
        idx++;
      }
    }
    var scan = prog(t, 2.2, 2.0);
    if (scan > 0 && scan < 1) {
      var ys = lerp(sy0 + 12, sy1 - 12, scan);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = INK;
      for (var dx = sx0 + 14; dx < sx1 - 14; dx += 14) ctx.fillRect(dx, ys, 8, 2);
      ctx.globalAlpha = 1;
    }

    var ox = 280 * (1 - easeOut(prog(t, 1.4, 1.0)));
    var px0 = 600 + ox, py0 = 70, pw = 210, ph = 410;
    brush(roundRectPts(px0, py0, pw, ph, 28), 3.6, prog(t, 1.4, 0.8), { taper: 0.02 });
    brush(seg(px0 + 80, py0 + 18, px0 + 130, py0 + 18, 0.2), 3, prog(t, 1.8, 0.3), {});
    fill(closed([[px0 + 28, py0 + 60], [px0 + 182, py0 + 66], [px0 + 186, py0 + 200], [px0 + 24, py0 + 206]], 1), PAPER, prog(t, 2.0, 0.4));
    var mi = 0;
    for (var r2 = 0; r2 < 3; r2++) {
      for (var c2 = 0; c2 < 4; c2++) {
        var gx = px0 + 52 + c2 * 36, gy = py0 + 98 + r2 * 40;
        glyph(gx, gy, 0.42, INK, prog(t, 2.2 + mi * 0.03, 0.2));
        brush(rectPts(gx - 14, gy - 16, 28, 30, 0.3), 1.4, prog(t, 3.0 + mi * 0.14, 0.25), { color: INK, taper: 0.02 });
        mi++;
      }
    }
    hand("→ english", px0 + 30, py0 + 252, 26, PAPER, "left", prog(t, 4.8, 0.4));
    for (var ln = 0; ln < 4; ln++) {
      brush(seg(px0 + 30, py0 + 280 + ln * 22, px0 + 140 + R() * 30, py0 + 280 + ln * 22, 0.3), 2.6, prog(t, 5.0 + ln * 0.25, 0.3), {});
    }
  }

  // ---------------------------------------------------------------- scene 5: flying to Lexington
  function sLexington(t) {
    stars(60, 0, 0, W, 250, t, 0);
    var P0 = [40, 300], C = [470, 20], P1 = [920, 230];
    function bez(u) {
      var a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      return [a * P0[0] + b * C[0] + c * P1[0], a * P0[1] + b * C[1] + c * P1[1]];
    }
    var pu = easeInOut(prog(t, 0.3, 3.2));
    for (var i = 0; i < 46; i++) {
      var u0 = i / 46, A = bez(u0), B = bez(u0 + 0.011);
      brush(seg(A[0], A[1], B[0], B[1], 0.2), 1.6, u0 + 0.011 < pu ? 1 : 0, { taper: 0.2, alpha: 0.8 });
    }

    var bx0 = 170, bx1 = 790, top = 262, base = 440;
    fill(rectPts(bx0, top, bx1 - bx0, base - top, 0.8), INK, 1, { still: true });
    brush(rectPts(bx0, top, bx1 - bx0, base - top, 0.8), 2.6, prog(t, 3.2, 1.2), { taper: 0.02 });
    brush(seg(bx0 - 10, top, bx1 + 10, top, 0.5), 4, prog(t, 3.4, 0.8), {});
    brush(seg(bx0 - 4, top + 12, bx1 + 4, top + 12, 0.5), 2, prog(t, 3.5, 0.8), {});
    var pX0 = 380, pX1 = 580;
    fill(rectPts(pX0 + 8, 318, pX1 - pX0 - 16, 122, 0.5), PAPER, prog(t, 4.2, 0.6) * 0.3);
    brush(seg(pX0 - 6, 300, pX1 + 6, 300, 0.4), 3.4, prog(t, 3.8, 0.5), {});
    brush(seg(pX0 - 2, 314, pX1 + 2, 314, 0.4), 2.4, prog(t, 3.9, 0.5), {});
    for (var col = 0; col < 6; col++) {
      var cx = pX0 + 12 + col * ((pX1 - pX0 - 24) / 5);
      brush(seg(cx, 316, cx, 440, 0.3), 6, prog(t, 4.0 + col * 0.08, 0.4), { taper: 0.04 });
    }
    [[bx0 + 20, pX0 - 20], [pX1 + 20, bx1 - 20]].forEach(function (wing, wi) {
      for (var rr = 0; rr < 2; rr++) {
        for (var cc = 0; cc < 4; cc++) {
          var wx = lerp(wing[0], wing[1] - 24, cc / 3), wy = 286 + rr * 74;
          var lit = R() < 0.4, wp = prog(t, 4.4 + (wi * 8 + rr * 4 + cc) * 0.05, 0.3);
          if (lit) fill(rectPts(wx, wy, 24, 34, 0.3), PAPER, wp * 0.9);
          brush(rectPts(wx, wy, 24, 34, 0.3), 1.6, wp, { taper: 0.02 });
        }
      }
    });

    brush(seg(0, 446, W, 440, 0.8), 2.4, prog(t, 3.3, 0.8), {});
    for (var g = 0; g < 70; g++) {
      var gx = R() * W, gy = 455 + R() * 80, gl = 5 + R() * 8 + (gy - 455) * 0.08;
      brush(seg(gx, gy, gx + 2 + R() * 3, gy - gl, 0.2), 1.6, prog(t, 4.8 + R() * 1.2, 0.2), { alpha: 0.75 });
    }
    brush(seg(870, 470, 870, 340, 0.4), 3.4, prog(t, 4.6, 0.5), {});
    fill(circlePts(870, 334, 8, 0.3), PAPER, prog(t, 5.0, 0.3));
    for (var lr = 0; lr < 6; lr++) {
      var la = (lr / 6) * Math.PI * 2;
      brush(seg(870 + Math.cos(la) * 14, 334 + Math.sin(la) * 14, 870 + Math.cos(la) * 26, 334 + Math.sin(la) * 26, 0.2), 1.6, prog(t, 5.2, 0.3), { alpha: 0.7 });
    }

    // me on the lawn, taking a selfie
    var ya = prog(t, 5.4, 0.5), yx = 700, yy = 492;
    fill(circlePts(yx, yy - 30, 6, 0.3), PAPER, ya);
    brush(seg(yx, yy - 24, yx, yy, 0.2), 3, ya, {});
    brush(path([[yx, yy - 18], [yx + 10, yy - 26], [yx + 14, yy - 38]], 0.2), 2, ya, {});
    fill(rectPts(yx + 11, yy - 46, 6, 9, 0.1), PAPER, ya);
    brush(seg(yx, yy, yx - 5, yy + 14, 0.2), 2.4, ya, {});
    brush(seg(yx, yy, yx + 5, yy + 14, 0.2), 2.4, ya, {});

    var pp = bez(Math.max(0.001, pu)), pq = bez(Math.min(1, pu + 0.01));
    plane(pp[0], pp[1], Math.atan2(pq[1] - pp[1], pq[0] - pp[0]), pu > 0 && pu < 1 ? 1 : 0);
  }

  // ---------------------------------------------------------------- scene 6: DiatoMeter
  var SHELLS = null;
  function shells() {
    if (SHELLS) return SHELLS;
    var r = mulberry32(136), out = [], tries = 0;
    while (out.length < 136 && tries < 40000) {
      tries++;
      var rad = 6 + r() * 5, a = r() * Math.PI * 2, d = Math.sqrt(r()) * (196 - rad);
      var x = 480 + Math.cos(a) * d, y = 285 + Math.sin(a) * d, ok = true;
      for (var i = 0; i < out.length; i++) {
        if (Math.hypot(out[i].x - x, out[i].y - y) < out[i].r + rad + 2.5) { ok = false; break; }
      }
      if (ok) out.push({ x: x, y: y, r: rad });
    }
    out.sort(function (p, q) { return p.x - q.x; });   // measured left to right, like a scan
    return (SHELLS = out);
  }

  function sMicro(t) {
    var cx = 480, cy = 285, S = shells(), i;
    fill(circlePts(cx, cy, 212, 0.6), "#1c1b19", prog(t, 0.05, 0.4), { still: true });
    brush(circlePts(cx, cy, 214, 0.8), 7, prog(t, 0.1, 1.0), { taper: 0.02 });
    brush(circlePts(cx, cy, 228, 0.8), 2.2, prog(t, 0.3, 1.0), { taper: 0.02 });

    for (i = 0; i < S.length; i++) {
      var s = S[i], ap = prog(t, 0.4 + (i / S.length) * 1.8, 0.25);
      brush(circlePts(s.x, s.y, s.r, 0.4), 1.6, ap, { taper: 0.05 });
      for (var k = 0; k < 4; k++) {
        var a = (k * Math.PI) / 4 + (i % 3) * 0.3;
        brush(seg(s.x - Math.cos(a) * s.r * 0.65, s.y - Math.sin(a) * s.r * 0.65, s.x + Math.cos(a) * s.r * 0.65, s.y + Math.sin(a) * s.r * 0.65, 0.1),
          0.9, ap, { alpha: 0.6, taper: 0.2 });
      }
    }

    var m0 = 2.6, mDur = 3.2, count = 0;
    for (i = 0; i < S.length; i++) {
      var mp = prog(t, m0 + (i / S.length) * mDur, 0.15);
      if (mp >= 1) count++;
      fill(circlePts(S[i].x, S[i].y, S[i].r - 0.5, 0.2), PAPER, mp * 0.9);
      brush(seg(S[i].x - S[i].r + 2, S[i].y, S[i].x + S[i].r - 2, S[i].y, 0.1), 1.2, mp, { color: INK, taper: 0 });
    }
    var sweep = prog(t, m0, mDur);
    if (sweep > 0 && sweep < 1) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, 210, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = 0.5; ctx.fillStyle = PAPER;
      ctx.fillRect(lerp(cx - 210, cx + 210, sweep), cy - 210, 2, 420);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    var ta = prog(t, 2.4, 0.4);
    hand("n = " + count, 742, 150, 40, PAPER, "left", ta);
    hand(Math.min(15, Math.round(sweep * 15)) + " s", 742, 196, 30, PAPER, "left", ta);
    brush(seg(60, 500, 120, 500, 0.2), 3, prog(t, 1.2, 0.4), { taper: 0.05 });
    hand("10 µm", 60, 526, 20, PAPER, "left", prog(t, 1.4, 0.4));
  }

  // ---------------------------------------------------------------- scene 7: the road on
  function sEnd(t) {
    stars(50, 0, 0, W, 230, t, 0);
    var ridge = RIDGE.map(function (p) { return [200 + p[0] * 0.47, 190 + p[1] * 0.55]; });
    fill(path(ridge, 0.6).concat([[764, 292], [200, 292]]), INK, 1, { still: true });
    brush(path(ridge, 0.6), 2.4, prog(t, 0.2, 1.8), {});
    snow(ridge, t, 1.2, 0.6, 236);
    brush(seg(0, 292, W, 292, 0.6), 1.6, prog(t, 0.3, 1.2), { alpha: 0.8 });

    var roadPts = path([[470, 560], [430, 500], [520, 440], [455, 380], [505, 330], [478, 292]], 1.2);
    brush(roadPts, 30, prog(t, 0.6, 2.4), { noStartTaper: true, taper: 0.9 });
    for (var g = 0; g < 40; g++) {
      var gx = R() * W, gy = 320 + R() * 220, gl = 4 + (gy - 300) * 0.05;
      brush(seg(gx, gy, gx + 2, gy - gl, 0.2), 1.4, prog(t, 1.4 + R() * 1.4, 0.2), { alpha: 0.6 });
    }
    hand("— aditya", 900, 506, 42, PAPER, "right", prog(t, 4.2, 0.8));

    var wu = 0.12 + 0.55 * prog(t, 1.2, 5.2), wp = pointAt(roadPts, wu);
    walker(wp[0], wp[1] + 2, 1 - wu * 0.75, prog(t, 1.0, 0.4), t);   // last: the legs swing
  }

  // ---------------------------------------------------------------- the scenes and their labels
  var SCENES = {
    pokhara:   { cap: "pokhara, nepal.",                  dur: 7.5, seed: 11, draw: sPokhara },
    library:   { cap: "budhanilkantha school.",           dur: 8,   seed: 22, draw: sLibrary },
    stone:     { cap: "teaching a phone to read stone.",  dur: 8,   seed: 44, draw: sStone },
    night:     { cap: "learning to build.",               dur: 7.5, seed: 33, draw: sNight },
    lexington: { cap: "lexington, virginia.",             dur: 8,   seed: 55, draw: sLexington },
    micro:     { cap: "136 shells. 15 seconds.",          dur: 8.5, seed: 66, draw: sMicro },
    road:      { cap: "still building.",                  dur: 7.5, seed: 77, draw: sEnd }
  };

  function caption(str, t) {
    var chars = reduceMotion ? str.length : Math.max(0, Math.min(str.length, Math.floor((t - 0.35) * 17)));
    ctx.font = "700 30px " + HAND;
    var tw = ctx.measureText(str).width, x = 24, y = 20, bw = Math.ceil(tw) + 36, bh = 48;
    var box = rectPts(x, y, bw, bh, 0.9), frame = rectPts(x - 6, y - 6, bw + 12, bh + 12, 0.9);
    fill(box, PAPER, prog(t, 0.05, 0.3));
    brush(frame, 1.6, prog(t, 0.15, 0.6), { taper: 0.04 });
    if (chars > 0) hand(str.slice(0, chars), x + 18, y + 34, 30, INK);
  }

  // ---------------------------------------------------------------- film grain
  var grainCanvas = document.createElement("canvas");
  grainCanvas.width = grainCanvas.height = 160;
  (function () {
    var g = grainCanvas.getContext("2d"), img = g.createImageData(160, 160), gr = mulberry32(5);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = gr() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  })();

  // ---------------------------------------------------------------- one "view" per drawing on the page
  var views = [];
  Array.prototype.forEach.call(canvases, function (cv) {
    var scene = SCENES[cv.getAttribute("data-scene")];
    if (!scene) return;
    var c2 = cv.getContext("2d");
    var vig = c2.createRadialGradient(W / 2, H / 2, 220, W / 2, H / 2, 620);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.5)");
    views.push({ canvas: cv, ctx: c2, scene: scene, start: null, visible: false, scale: 1,
                 grain: c2.createPattern(grainCanvas, "repeat"), vignette: vig, drawnStill: false });
  });

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    views.forEach(function (v) {
      var r = v.canvas.getBoundingClientRect();
      v.canvas.width = Math.max(1, Math.round(r.width * dpr));
      v.canvas.height = Math.max(1, Math.round(((r.width * 9) / 16) * dpr));
      v.scale = v.canvas.width / W;
      v.drawnStill = false;
    });
  }

  function render(v, t) {
    ctx = v.ctx;
    ctx.setTransform(v.scale, 0, 0, v.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);

    sid = 0; R = mulberry32(v.scene.seed);
    v.scene.draw(t);
    sid = 50000; R = mulberry32(777);
    caption(v.scene.cap, t);

    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.translate(-((boil * 37) % 160), -((boil * 23) % 160));
    ctx.fillStyle = v.grain;
    ctx.fillRect(0, 0, W + 160, H + 160);
    ctx.restore();
    ctx.fillStyle = v.vignette;
    ctx.fillRect(0, 0, W, H);
  }

  var last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - last < 1000 / 30) return;   // 30 frames a second is plenty for ink
    last = now;
    boil = reduceMotion ? 0 : Math.floor(now / 120) % 5;
    views.forEach(function (v) {
      if (!v.visible) return;
      if (reduceMotion) {
        if (!v.drawnStill) { render(v, v.scene.dur); v.drawnStill = true; }
        return;
      }
      if (v.start == null) v.start = now;
      render(v, Math.min(v.scene.dur, Math.max(0, (now - v.start) / 1000)));
    });
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = views.filter(function (x) { return x.canvas === e.target; })[0];
        if (v) v.visible = e.isIntersecting;
      });
    }, { threshold: 0.15 });
    views.forEach(function (v) { io.observe(v.canvas); });
  } else {
    views.forEach(function (v) { v.visible = true; });
  }

  window.addEventListener("resize", resize);
  resize();

  // Wait (briefly) for the handwriting font so labels aren't drawn in a fallback font first.
  var started = false;
  function begin() { if (!started) { started = true; requestAnimationFrame(frame); } }
  if (document.fonts && document.fonts.load) {
    document.fonts.load("700 30px Caveat").then(begin, begin);
    setTimeout(begin, 1500);
  } else {
    begin();
  }

  // For checking a drawing by hand from the browser console: inkDebug.seek("micro", 8)
  window.inkDebug = {
    seek: function (name, t) {
      views.forEach(function (v) { if (v.canvas.getAttribute("data-scene") === name) v.start = performance.now() - t * 1000; });
    }
  };
})();
