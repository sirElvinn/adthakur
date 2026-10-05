// adthakur.com: the story so far, as a short film drawn live with JavaScript "brush strokes".
// No images and no video: every frame is painted on a <canvas> from code.
//
// How it plays: the viewer drives it. A click, tap, swipe or the arrow keys reveal the next caption;
// after a shot's last caption the camera moves on to the next shot. All words live in the caption boxes.
// The main story is just my life; at the end, viewers choose projects, experience or the résumé.
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
// The words are in SHOT near the bottom, and the order of shots is in TRACKS. Change them there.

(function () {
  "use strict";

  var filmCanvas = document.getElementById("film");
  if (!filmCanvas || !filmCanvas.getContext) return;
  var ctx = null;   // the canvas being drawn on right now

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

    var bx = 150 + Math.min(t, 14) * 26, by = 452 + Math.sin(t * 1.6) * 2.5;
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
      var cx = 300 + Math.min(t, 10) * 30 + b * 34, cy = 120 + b * 12 + Math.sin(t * 3 + b) * 3, f = Math.sin(t * 8 + b * 2) * 3;
      brush(path([[cx - 9, cy - 2 - f], [cx, cy + 3], [cx + 9, cy - 2 - f]], 0.2), 1.8, prog(t, 2.2 + b * 0.2, 0.3), { taper: 0.3 });
    }
  }

  // ---------------------------------------------------------------- scene: the road into Budhanilkantha School
  // Drawn from photos of the campus: the flag-lined entrance road, long red-roofed brick buildings with
  // hedges, Shivapuri's forested slopes with mist drifting across, the Saraswati temple's pagoda roof
  // above the trees, big shade trees, flower pots along the road, and the BNKS sign.
  function blobPts(cx, cy, rx, ry, k1, k2, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2;
      var r = 1 + 0.09 * Math.sin(a * k1) + 0.05 * Math.sin(a * k2 + 1.3);
      pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
    }
    return pts;
  }

  function cloud(cx, cy, s, t, t0) {
    var bumps = [[-62, 4, 24], [-30, -14, 32], [10, -24, 38], [50, -10, 30], [80, 4, 22]], outline = [];
    bumps.forEach(function (bp, i) {
      var arc = arcPts(cx + bp[0] * s, cy + bp[1] * s, bp[2] * s, bp[2] * s, i === 0 ? Math.PI * 0.85 : Math.PI * 1.1, i === bumps.length - 1 ? Math.PI * 2.15 : Math.PI * 1.9, 0.5);
      outline = outline.concat(arc);
    });
    outline.push([cx + 98 * s, cy + 20 * s]);
    outline.push([cx - 82 * s, cy + 20 * s]);
    outline.push(outline[0]);
    fill(outline, INK, 1, { still: true });
    brush(outline, 2.2, prog(t, t0, 1.2), { dry: 0.35, taper: 0.03 });
    brush(arcPts(cx + 4 * s, cy - 2 * s, 20 * s, 10 * s, 3.5, 5.5, 0.4), 1.4, prog(t, t0 + 0.8, 0.4), { alpha: 0.55 });
    brush(arcPts(cx - 34 * s, cy + 6 * s, 14 * s, 7 * s, 3.6, 5.4, 0.4), 1.2, prog(t, t0 + 0.9, 0.4), { alpha: 0.45 });
  }

  function treeBlob(cx, cy, rx, ry, t, t0, leaves) {
    var outline = blobPts(cx, cy, rx, ry, 7, 13, 40);
    fill(outline, INK, 1, { still: true });
    brush(outline, 2.2, prog(t, t0, 1.2), { taper: 0.02 });
    for (var i = 0; i < leaves; i++) {
      var a = R() * Math.PI * 2, d = Math.sqrt(R()) * 0.82, x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d, s = 3 + R() * 4, a0 = R() * 6.3;
      brush(arcPts(x, y, s, s * 0.8, a0, a0 + 3.8, 0.2), 1.2, prog(t, t0 + 0.6 + R() * 0.8, 0.2), { alpha: 0.6, taper: 0.3 });
    }
  }

  function sSchool(t) {
    cloud(330, 64, 1.1, t, 0.2);
    cloud(110, 96, 0.7, t, 0.6);

    // Shivapuri: the forested mountain right behind the campus
    var ridgeKnots = [[0, 196], [70, 170], [150, 150], [230, 138], [300, 144], [370, 158], [440, 168], [520, 186], [600, 198], [700, 214], [760, 224]];
    function ridgeAt(x) {
      for (var i = 1; i < ridgeKnots.length; i++) {
        if (x <= ridgeKnots[i][0]) {
          var k0 = ridgeKnots[i - 1], k1 = ridgeKnots[i];
          return k0[1] + (k1[1] - k0[1]) * (x - k0[0]) / (k1[0] - k0[0]);
        }
      }
      return ridgeKnots[ridgeKnots.length - 1][1];
    }
    var hills = path(ridgeKnots, 0.8);
    fill(hills.concat([[760, 420], [0, 420]]), INK, 1, { still: true });
    brush(hills, 2.4, prog(t, 0.3, 1.4), {});
    for (var row = 0; row < 7; row++) {                     // rows of treetops following the slope
      for (var col = 0; col < 22; col++) {
        var fx = col * 34 + (row % 2) * 17 + (R() - 0.5) * 14, fy = ridgeAt(fx) + 14 + row * 26 + (R() - 0.5) * 10, fr = 4 + R() * 3;
        brush(arcPts(fx, fy, fr, fr * 0.85, Math.PI * 1.05, Math.PI * 1.95, 0.2), 1.1,
          fy < 380 ? prog(t, 0.7 + row * 0.12 + R() * 0.4, 0.3) : 0, { alpha: 0.5 - row * 0.03, taper: 0.3 });
      }
    }
    [[120, 160, 70, 300], [260, 146, 230, 290], [420, 166, 450, 300], [560, 192, 600, 300]].forEach(function (rv, k) {   // ravines
      brush(path([[rv[0], rv[1] + 6], [lerp(rv[0], rv[2], 0.5) + 8, lerp(rv[1], rv[3], 0.5)], [rv[2], rv[3]]], 0.6), 1.6, prog(t, 1.0 + k * 0.1, 0.6), { alpha: 0.45, dry: 0.6 });
    });
    var drift = reduceMotion ? 0 : Math.sin(t * 0.25) * 24;    // mist drifting across the slopes
    [[40, 232, 380, 11], [300, 258, 700, 10], [-20, 288, 300, 9]].forEach(function (m, k) {
      var dd = drift * (k % 2 ? -1 : 1), mid = (m[0] + m[2]) / 2;
      brush(path([[m[0] + dd, m[1] + 3], [mid - 60 + dd, m[1] - 4], [mid + 50 + dd, m[1] + 5], [m[2] + dd, m[1] - 2]], 0.8), m[3], prog(t, 1.6 + k * 0.2, 1.2), { alpha: 0.09, dry: 1, still: true, taper: 0.5 });
    });

    // a big shade tree behind the left building
    treeBlob(150, 286, 90, 50, t, 0.7, 20);

    // another long red-roofed block at the end of the road (partly behind the trees)
    var b2 = prog(t, 1.0, 0.8);
    var roof2 = closed([[552, 344], [574, 326], [692, 326], [712, 344]], 0.5);
    fill(roof2, INK, 1, { still: true });
    brush(roof2, 2.2, b2, { taper: 0.02 });
    for (var h2 = 0; h2 < 8; h2++) brush(seg(584 + h2 * 14, 329, 576 + h2 * 15, 342, 0.2), 1.2, prog(t, 1.3 + h2 * 0.04, 0.2), { alpha: 0.7 });
    brush(rectPts(560, 344, 144, 38, 0.4), 1.8, b2, { taper: 0.02 });
    for (var w2 = 0; w2 < 5; w2++) brush(rectPts(570 + w2 * 26, 354, 14, 16, 0.2), 1.2, prog(t, 1.5 + w2 * 0.05, 0.3), { taper: 0.02 });

    // the Saraswati temple's two-tiered pagoda roof, peeking over the trees
    var pg = prog(t, 1.4, 0.6), px = 462;
    function G(x, y) { return [px + x * 1.3, 252 + y * 1.3]; }
    function Gs(list) { return list.map(function (p) { return G(p[0], p[1]); }); }
    brush(Gs(seg(0, -40, 0, -26, 0.1)), 3, pg, { taper: 0.2 });
    fill(Gs(circlePts(0, -41, 2.6, 0.1)), PAPER, pg);
    fill(Gs(closed([[-16, -22], [16, -22], [27, -13], [-27, -13]], 0.2)), PAPER, pg * 0.85);
    brush(Gs(arcPts(-30, -17, 4, 4, -0.2, 1.8, 0.1)), 2, pg, {});
    brush(Gs(arcPts(30, -17, 4, 4, 1.3, 3.3, 0.1)), 2, pg, {});
    fill(Gs(rectPts(-11, -13, 22, 9, 0.1)), INK, pg);
    brush(Gs(rectPts(-11, -13, 22, 9, 0.1)), 1.6, pg, { taper: 0 });
    fill(Gs(closed([[-28, -4], [28, -4], [42, 7], [-42, 7]], 0.3)), PAPER, pg * 0.85);
    brush(Gs(arcPts(-45, 2, 5, 5, -0.2, 1.8, 0.1)), 2, pg, {});
    brush(Gs(arcPts(45, 2, 5, 5, 1.3, 3.3, 0.1)), 2, pg, {});
    brush(Gs(seg(-30, 9, 30, 9, 0.1)), 2.4, pg, { alpha: 0.8 });

    // trees in the middle distance (they hide the temple's base)
    treeBlob(400, 304, 78, 60, t, 0.6, 24);
    treeBlob(522, 302, 60, 54, t, 0.7, 20);

    // the long red-roofed brick block on the left, with a trimmed hedge in front
    var rb = prog(t, 0.9, 0.8);
    var roof1 = closed([[28, 352], [62, 326], [302, 326], [330, 352]], 0.5);
    fill(roof1, INK, 1, { still: true });
    brush(roof1, 2.4, rb, { taper: 0.02 });
    for (var hr = 0; hr < 16; hr++) brush(seg(72 + hr * 15, 330, 62 + hr * 16, 349, 0.2), 1.3, prog(t, 1.2 + hr * 0.03, 0.2), { alpha: 0.75 });
    fill(rectPts(38, 352, 282, 44, 0.4), INK, 1, { still: true });
    brush(rectPts(38, 352, 282, 44, 0.4), 2, rb, { taper: 0.02 });
    for (var wi = 0; wi < 7; wi++) {
      var wx = 52 + wi * 38;
      brush(rectPts(wx, 362, 20, 22, 0.2), 1.4, prog(t, 1.4 + wi * 0.05, 0.3), { taper: 0.02 });
      brush(seg(wx + 10, 362, wx + 10, 384, 0.05), 0.9, prog(t, 1.5 + wi * 0.05, 0.3), { taper: 0, alpha: 0.7 });
    }
    var hedge = [[30, 414]];
    for (var hg = 0; hg <= 14; hg++) hedge = hedge.concat(arcPts(40 + hg * 20, 404, 10, 8, Math.PI, Math.PI * 2, 0.3));
    hedge.push([330, 414]);
    fill(hedge, INK, 1, { still: true });
    brush(hedge, 1.8, prog(t, 1.5, 1.0), { taper: 0.03 });

    // the big trees on the right: trunks, then a full, lumpy canopy
    brush(path([[936, 480], [910, 400], [880, 330], [846, 280]], 0.8), 9, prog(t, 1.0, 0.8), { taper: 0.25 });
    brush(path([[960, 420], [946, 340], [930, 300]], 0.6), 6, prog(t, 1.1, 0.6), { taper: 0.3 });
    brush(path([[880, 330], [830, 300], [790, 290]], 0.6), 3.6, prog(t, 1.3, 0.6), { taper: 0.3 });
    treeBlob(940, 70, 300, 210, t, 0.4, 0);
    treeBlob(700, 180, 120, 96, t, 0.6, 0);
    treeBlob(830, 250, 110, 70, t, 0.7, 0);
    for (var lf = 0; lf < 140; lf++) {
      var lx = 600 + R() * 360, ly = R() * 320, ls = 3 + R() * 5, a0 = R() * 6.3;
      var inside = (Math.pow((lx - 940) / 300, 2) + Math.pow((ly - 70) / 210, 2) < 0.8) || (Math.pow((lx - 700) / 120, 2) + Math.pow((ly - 180) / 96, 2) < 0.75) || (Math.pow((lx - 830) / 110, 2) + Math.pow((ly - 250) / 70, 2) < 0.7);
      brush(arcPts(lx, ly, ls, ls * 0.8, a0, a0 + 3.8, 0.2), 1.2, inside ? prog(t, 1.0 + R() * 1.2, 0.2) : 0, { alpha: 0.55, taper: 0.3 });
    }

    // the road, with its painted edge lines
    var road = closed([[110, 540], [840, 540], [622, 384], [466, 384]], 0.8);
    fill(road, INK, 1, { still: true });
    brush(path([[124, 540], [472, 386]], 0.6), 3.2, prog(t, 0.5, 1.0), { noStartTaper: true, taper: 0.6 });
    brush(path([[824, 540], [616, 386]], 0.6), 3.2, prog(t, 0.6, 1.0), { noStartTaper: true, taper: 0.6 });
    for (var rt = 0; rt < 14; rt++) {
      var ry = 400 + R() * 135, rx = lerp(lerp(470, 140, (ry - 384) / 156), lerp(616, 810, (ry - 384) / 156), 0.15 + R() * 0.7);
      brush(seg(rx, ry, rx + 6 + R() * 14, ry, 0.2), 1, prog(t, 1.4 + R() * 0.8, 0.3), { alpha: 0.35 });
    }

    // the road edge on the left: L(u) runs from the bottom-left corner to the far end of the road
    function L(u) { return [lerp(-30, 456, u), lerp(604, 384, u)]; }
    // flagpoles on the lawn behind the railing, nearest first; flags hang from the tops
    for (var fpI = 0; fpI < 10; fpI++) {
      var u = 0.2 + Math.pow(fpI / 9, 1.4) * 0.76, b = L(u);
      var bx = b[0] - lerp(16, 4, u), by = b[1] - lerp(44, 8, u), top = by - lerp(430, 150, u);
      var pp = prog(t, 1.0 + (9 - fpI) * 0.1, 0.5);
      brush(seg(bx, by, bx, top, 0.3), lerp(1.8, 1, u), pp, { taper: 0.05, alpha: 0.75 });
      var fw = lerp(24, 6, u), fh = lerp(70, 18, u), tone = 0.35 + R() * 0.6;
      var flag = closed([[bx, top + 2], [bx - fw, top + 6], [bx - fw * 0.85, top + fh], [bx, top + fh * 0.94]], 0.4);
      fill(flag, PAPER, pp * tone);
      brush(flag, 1.2, pp, { taper: 0.02 });
    }
    // grass on the lawn
    for (var gl = 0; gl < 36; gl++) {
      var gu = R(), gb = L(gu), gx = gb[0] - 20 - R() * 120, gy = gb[1] - 30 - R() * 60;
      brush(seg(gx, gy, gx + 2, gy - 5, 0.1), 1.2, prog(t, 1.6 + R() * 0.8, 0.2), { alpha: 0.6 });
    }
    // the low stone wall and the railing along the road
    var wallTop = [], railTop = [], railMid = [];
    for (var k = 0; k <= 10; k++) {
      var uu = k / 10, q = L(uu);
      wallTop.push([q[0], q[1] - lerp(44, 8, uu)]);
      railTop.push([q[0] - lerp(10, 2, uu), q[1] - lerp(122, 22, uu)]);
      railMid.push([q[0] - lerp(6, 1, uu), q[1] - lerp(84, 15, uu)]);
    }
    fill(wallTop.concat([L(1), L(0)]), INK, 1, { still: true });
    brush(path(wallTop, 0.5), 2.4, prog(t, 1.4, 0.8), {});
    brush(path(railTop, 0.5), 2, prog(t, 1.6, 0.8), {});
    for (var pk = 0; pk < 8; pk++) {
      var pu = Math.pow(pk / 7, 1.3), pq = L(pu);
      brush(seg(pq[0] - lerp(10, 2, pu), pq[1] - lerp(122, 22, pu), pq[0], pq[1] - lerp(44, 8, pu), 0.2), lerp(3, 1, pu), prog(t, 1.8 + pk * 0.04, 0.3), { taper: 0.02 });
    }

    // the right side: a brick wall, a strip of grass, and flower pots on stands
    brush(path([[960, 446], [820, 410], [700, 380]], 0.5), 2, prog(t, 1.5, 0.8), {});
    brush(path([[960, 466], [820, 428], [700, 392]], 0.5), 1.4, prog(t, 1.6, 0.8), { alpha: 0.7 });
    for (var pot = 0; pot < 10; pot++) {
      var v = Math.pow(pot / 9, 1.4), px = lerp(930, 652, v), py = lerp(520, 386, v), ps = lerp(30, 7, v), pa = prog(t, 1.8 + (9 - pot) * 0.08, 0.4);
      brush(closed([[px - ps * 0.5, py - ps], [px + ps * 0.5, py - ps], [px + ps * 0.36, py - ps * 0.2], [px - ps * 0.36, py - ps * 0.2]], 0.2), lerp(2, 1, v), pa, { taper: 0.02 });
      brush(seg(px - ps * 0.3, py - ps * 0.2, px - ps * 0.4, py + ps * 0.3, 0.1), 1.2, pa, {});
      brush(seg(px + ps * 0.3, py - ps * 0.2, px + ps * 0.4, py + ps * 0.3, 0.1), 1.2, pa, {});
      for (var fl = 0; fl < 5; fl++) {
        fill(circlePts(px + (fl - 2) * ps * 0.2, py - ps * (1.18 + (fl % 2) * 0.18), ps * 0.13, 0.1), PAPER, prog(t, 2.0 + (9 - pot) * 0.08, 0.3));
      }
    }

    // the BNKS sign at the end of the road
    var sa = prog(t, 2.2, 0.4);
    brush(seg(604, 384, 604, 352, 0.2), 2, sa, {});
    fill(rectPts(584, 330, 42, 24, 0.3), PAPER, sa);
    hand("BNKS", 605, 348, 14, INK, "center", sa);

    // someone walking up to school (last: the legs move)
    var wa = prog(t, 1.8, 0.4), wx = 520, wy = 410, ph = reduceMotion ? 0 : Math.sin(t * 4) * 3;
    fill(circlePts(wx, wy - 30, 3.6, 0.1), PAPER, wa);
    fill(closed([[wx - 4, wy - 26], [wx + 4, wy - 26], [wx + 5, wy - 12], [wx - 5, wy - 12]], 0.1), PAPER, wa);
    brush(seg(wx - 2, wy - 12, wx - 2 + ph, wy, 0.05), 2, wa, { taper: 0 });
    brush(seg(wx + 2, wy - 12, wx + 2 - ph, wy, 0.05), 2, wa, { taper: 0 });
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

    // three framed certificates on the wall
    for (var cf = 0; cf < 3; cf++) {
      var cx0 = 556 + cf * 96, cy0 = 44, cp = prog(t, 2.6 + cf * 0.35, 0.5);
      brush(rectPts(cx0, cy0, 80, 60, 0.4), 2.4, cp, { taper: 0.03 });
      brush(seg(cx0 + 14, cy0 + 18, cx0 + 66, cy0 + 18, 0.2), 1.6, cp, { taper: 0.1 });
      brush(seg(cx0 + 20, cy0 + 30, cx0 + 60, cy0 + 30, 0.2), 1.2, cp, { taper: 0.1, alpha: 0.7 });
      brush(circlePts(cx0 + 58, cy0 + 45, 6, 0.2), 1.4, cp, { taper: 0.05 });
    }

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
    for (var ln = 0; ln < 4; ln++) {
      brush(seg(px0 + 30, py0 + 280 + ln * 22, px0 + 140 + R() * 30, py0 + 280 + ln * 22, 0.3), 2.6, prog(t, 5.0 + ln * 0.25, 0.3), {});
    }
  }

  // ---------------------------------------------------------------- scene 5: flying to Lexington
  function sLexington(t) {
    stars(60, 0, 0, W, 250, t, 0);
    var P0 = [30, 250], C = [480, -110], P1 = [930, 210];
    function bez(u) {
      var a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      return [a * P0[0] + b * C[0] + c * P1[0], a * P0[1] + b * C[1] + c * P1[1]];
    }
    var pu = easeInOut(prog(t, 0.3, 3.2));
    for (var i = 0; i < 46; i++) {
      var u0 = i / 46, A = bez(u0), B = bez(u0 + 0.011);
      brush(seg(A[0], A[1], B[0], B[1], 0.2), 1.6, u0 + 0.011 < pu ? 1 : 0, { taper: 0.2, alpha: 0.8 });
    }

    // Washington Hall, from a photo: red brick behind six giant white columns, a plain pediment,
    // the white octagonal cupola with louvered openings and "Old George" standing on top,
    // and the lower Colonnade buildings on either side with their rows of slim white columns.
    var hx0 = 330, hx1 = 630, cxh = 480, base = 444;
    [[118, 318], [642, 842]].forEach(function (wg, wi) {
      var wTop = 318, wp = prog(t, 3.5 + wi * 0.2, 0.8);
      fill(rectPts(wg[0], wTop, wg[1] - wg[0], base - wTop, 0.6), INK, 1, { still: true });
      brush(seg(wg[0] - 6, wTop, wg[1] + 6, wTop, 0.5), 3, wp, {});
      brush(seg(wg[0], wTop + 9, wg[1], wTop + 9, 0.4), 1.6, wp, { alpha: 0.8 });
      for (var ww = 0; ww < 6; ww++) {
        var wx = lerp(wg[0] + 16, wg[1] - 32, ww / 5), lit = R() < 0.45, wpp = prog(t, 4.3 + wi * 0.3 + ww * 0.05, 0.3);
        fill(rectPts(wx, wTop + 44, 16, 30, 0.2), PAPER, lit ? wpp * 0.8 : 0);
        brush(rectPts(wx, wTop + 44, 16, 30, 0.2), 1.3, wpp, { taper: 0.02 });
      }
      for (var cc = 0; cc < 9; cc++) {
        var colx = lerp(wg[0] + 6, wg[1] - 6, cc / 8);
        brush(seg(colx, wTop + 12, colx, base, 0.2), 4.4, prog(t, 3.9 + wi * 0.2 + cc * 0.04, 0.35), { taper: 0.03 });
      }
    });

    // the cupola (drawn first, so the pediment hides its base)
    var cu = prog(t, 4.6, 0.6);
    fill(rectPts(cxh - 20, 124, 40, 56, 0.3), PAPER, cu);
    for (var lv = 0; lv < 3; lv++) {
      fill(rectPts(cxh - 15 + lv * 11, 138, 7, 26, 0.1), INK, cu);
      for (var sl = 0; sl < 4; sl++) brush(seg(cxh - 15 + lv * 11, 142 + sl * 6, cxh - 8 + lv * 11, 142 + sl * 6, 0.05), 0.8, cu, { taper: 0 });
    }
    brush(seg(cxh - 20, 131, cxh + 20, 131, 0.1), 1, cu, { color: INK, taper: 0 });
    fill(rectPts(cxh - 25, 117, 50, 8, 0.2), PAPER, cu);
    fill(rectPts(cxh - 7, 108, 14, 9, 0.1), PAPER, cu);
    // "Old George"
    var og = prog(t, 5.0, 0.5);
    fill(circlePts(cxh, 82, 4.2, 0.1), PAPER, og);
    fill(closed([[cxh - 4, 87], [cxh + 4, 87], [cxh + 7, 108], [cxh - 7, 108]], 0.1), PAPER, og);
    brush(seg(cxh + 4, 90, cxh + 9, 100, 0.05), 2, og, { taper: 0.1 });

    // brick front, pediment and entablature
    fill(rectPts(hx0 + 6, 252, hx1 - hx0 - 12, base - 252, 0.6), INK, 1, { still: true });
    var ped = closed([[hx0 - 14, 228], [cxh, 172], [hx1 + 14, 228]], 0.6);
    fill(ped, INK, 1, { still: true });
    fill(ped, PAPER, prog(t, 3.6, 0.6) * 0.88);                                   // the pediment is white
    brush(ped, 2.8, prog(t, 3.3, 1.0), { taper: 0.02 });
    fill(rectPts(hx0 - 16, 229, hx1 - hx0 + 32, 24, 0.3), PAPER, prog(t, 3.6, 0.6) * 0.88);   // and so is the band below it
    brush(seg(hx0 - 16, 230, hx1 + 16, 230, 0.4), 2, prog(t, 3.4, 0.7), { color: INK });
    brush(seg(hx0 - 12, 241, hx1 + 12, 241, 0.4), 1.4, prog(t, 3.5, 0.7), { color: INK, alpha: 0.7 });
    brush(seg(hx0 - 10, 252, hx1 + 10, 252, 0.4), 2.8, prog(t, 3.6, 0.7), {});
    brush(rectPts(hx0 - 18, 222, 8, 8, 0.1), 1.4, prog(t, 3.6, 0.3), { taper: 0 });   // chimneys
    brush(rectPts(hx1 + 10, 222, 8, 8, 0.1), 1.4, prog(t, 3.6, 0.3), { taper: 0 });

    // windows on three floors in each bay, and the arched door in the middle
    var colX = [0, 1, 2, 3, 4, 5].map(function (k) { return lerp(hx0 + 14, hx1 - 14, k / 5); });
    for (var bay = 0; bay < 5; bay++) {
      var bc = (colX[bay] + colX[bay + 1]) / 2;
      for (var fl = 0; fl < 3; fl++) {
        if (bay === 2 && fl === 2) continue;   // the door is here
        var wy0 = 268 + fl * 58, litW = R() < 0.4, wpw = prog(t, 4.0 + bay * 0.06 + fl * 0.05, 0.3);
        fill(rectPts(bc - 9, wy0, 18, 32, 0.2), PAPER, litW ? wpw * 0.85 : 0);
        brush(rectPts(bc - 9, wy0, 18, 32, 0.2), 1.3, wpw, { taper: 0.02 });
        brush(seg(bc, wy0, bc, wy0 + 32, 0.05), 0.8, wpw, { taper: 0, alpha: 0.7 });
      }
    }
    brush(path([[cxh - 13, base], [cxh - 13, 404]].concat(arcPts(cxh, 404, 13, 13, Math.PI, Math.PI * 2, 0.2)).concat([[cxh + 13, 404], [cxh + 13, base]]), 0.3), 2, prog(t, 4.4, 0.5), { taper: 0.02 });

    // six giant white columns
    for (var col = 0; col < 6; col++) {
      var x = colX[col], cp = prog(t, 3.7 + col * 0.09, 0.5);
      brush(seg(x, 256, x, base - 6, 0.3), 12, cp, { taper: 0.02 });
      brush(seg(x - 11, 256, x + 11, 256, 0.1), 4, cp, { taper: 0 });
      fill(rectPts(x - 10, base - 7, 20, 7, 0.1), PAPER, cp);
    }
    // the brick path to the door
    brush(path([[cxh - 16, base + 2], [cxh - 40, 540]], 0.4), 2, prog(t, 4.8, 0.5), {});
    brush(path([[cxh + 16, base + 2], [cxh + 40, 540]], 0.4), 2, prog(t, 4.8, 0.5), {});
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
    fill(rectPts(722, 112, 168, 104, 0.8), PAPER, ta);
    brush(rectPts(716, 106, 180, 116, 0.8), 1.4, ta, { taper: 0.04 });
    hand("n = " + count, 742, 157, 36, INK, "left", ta);
    hand(Math.min(15, Math.round(sweep * 15)) + " s", 742, 198, 28, INK, "left", ta);
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

    var wu = 0.12 + 0.55 * prog(t, 1.2, 5.2), wp = pointAt(roadPts, wu);
    walker(wp[0], wp[1] + 2, 1 - wu * 0.75, prog(t, 1.0, 0.4), prog(t, 1.2, 5.2) < 1 ? t : 0);   // last: the legs swing
  }

  // ---------------------------------------------------------------- title shot
  function sTitle(t) {
    stars(90, 0, 0, W, 390, t, 0);
    fill(circlePts(800, 110, 26, 0.4), PAPER, prog(t, 0.4, 0.6));
    fill(circlePts(812, 102, 24, 0.4), INK, prog(t, 0.4, 0.6));
    brush(path([[0, 422], [120, 404], [260, 414], [380, 398], [520, 412], [640, 400], [800, 414], [960, 404]], 0.8), 2.2, prog(t, 0.3, 1.6), {});
    for (var g = 0; g < 46; g++) {
      var gx = R() * W, gy = 432 + R() * 100, gl = 4 + (gy - 430) * 0.06;
      brush(seg(gx, gy, gx + 2, gy - gl, 0.2), 1.4, prog(t, 1.2 + R() * 1.2, 0.2), { alpha: 0.6 });
    }
    // me, standing on the hill, looking up
    var fa = prog(t, 1.0, 0.6), fx = 480, fy = 408;
    fill(circlePts(fx, fy - 48, 8.5, 0.3), PAPER, fa);
    fill(closed([[fx - 9, fy - 37], [fx + 9, fy - 37], [fx + 11, fy - 14], [fx - 11, fy - 14]], 0.3), PAPER, fa);
    fill(rectPts(fx + 8, fy - 35, 8, 17, 0.2), PAPER, fa);
    brush(seg(fx - 5, fy - 14, fx - 6, fy + 2, 0.2), 3.6, fa, {});
    brush(seg(fx + 5, fy - 14, fx + 6, fy + 2, 0.2), 3.6, fa, {});
    // a shooting star every few seconds (last: it moves)
    var sp = ((t + 2) % 7) / 7, u = Math.min(1, sp / 0.18);
    var sx = lerp(560, 820, u), sy = lerp(70, 170, u);
    brush(seg(sx - 70, sy - 27, sx, sy, 0.3), 2.2, sp < 0.18 ? 1 : 0, { alpha: 0.85, taper: 0.7, still: true });
  }

  // ---------------------------------------------------------------- Nepalingo: flashcards, a quiz, merged pull requests
  function rotRect(cx, cy, w, h, a, wob) {
    var c = Math.cos(a), s = Math.sin(a);
    return closed([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(function (p) {
      return [cx + p[0] * c - p[1] * s, cy + p[0] * s + p[1] * c];
    }), wob);
  }

  function sCards(t) {
    brush(seg(40, 440, 920, 440, 0.8), 3, prog(t, 0.2, 1), { taper: 0.05 });
    var back1 = rotRect(430, 262, 270, 176, -0.16, 0.8), back2 = rotRect(530, 258, 270, 176, 0.13, 0.8);
    fill(back1, PAPER, prog(t, 0.4, 0.4) * 0.45);
    brush(back1, 2, prog(t, 0.4, 0.8), { taper: 0.03 });
    fill(back2, PAPER, prog(t, 0.6, 0.4) * 0.7);
    brush(back2, 2, prog(t, 0.6, 0.8), { taper: 0.03 });

    // the daily quiz
    var qa = prog(t, 2.4, 0.5);
    brush(rectPts(770, 120, 150, 180, 0.6), 2.2, qa, { taper: 0.03 });
    for (var q = 0; q < 3; q++) {
      brush(circlePts(798, 166 + q * 44, 9, 0.2), 1.8, prog(t, 2.6 + q * 0.15, 0.3), { taper: 0.05 });
      brush(seg(818, 166 + q * 44, 894, 166 + q * 44, 0.3), 2.2, prog(t, 2.7 + q * 0.15, 0.3), {});
    }
    brush(path([[789, 208], [797, 218], [812, 196]], 0.2), 3, prog(t, 3.4, 0.3), { taper: 0.1 });

    // eleven merged pull requests
    brush(seg(190, 492, 790, 492, 0.4), 2, prog(t, 2.8, 1.2), {});
    for (var m = 0; m < 11; m++) {
      var mx = 214 + m * 54, mp = prog(t, 3.0 + m * 0.12, 0.25);
      brush(path([[mx - 28, 468], [mx - 10, 471], [mx, 488]], 0.2), 1.6, mp, { alpha: 0.8 });
      fill(circlePts(mx, 492, 5, 0.2), PAPER, mp);
    }

    // the front card flips over (its width changes, so it comes late)
    var fp = prog(t, 3.4, 0.6), sx = Math.abs(Math.cos(fp * Math.PI)), showBack = fp > 0.5;
    var fw = 270 * Math.max(0.04, sx), ca = prog(t, 0.8, 0.4), inside = ca * (sx > 0.55 ? 1 : 0);
    var card = closed([[480 - fw / 2, 168], [480 + fw / 2, 168], [480 + fw / 2, 346], [480 - fw / 2, 346]], 0.6);
    fill(card, PAPER, ca);
    brush(card, 2.6, prog(t, 0.8, 0.8), { color: INK, taper: 0.03 });
    // front: a speaker with sound waves and a word
    fill(closed([[420, 242], [432, 242], [448, 228], [448, 284], [432, 270], [420, 270]], 0.3), INK, showBack ? 0 : inside);
    for (var k = 0; k < 3; k++) {
      var pulse = reduceMotion ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 4 - k * 0.9));
      brush(arcPts(452, 256, 14 + k * 11, 14 + k * 11, -0.7, 0.7, 0.2), 2.4, 1, { color: INK, alpha: (showBack ? 0 : inside) * pulse, taper: 0.2 });
    }
    brush(path([[506, 244], [520, 238], [534, 248], [548, 238], [562, 246]], 0.4), 3.2, 1, { color: INK, alpha: showBack ? 0 : inside });
    brush(seg(506, 272, 552, 272, 0.3), 2, 1, { color: INK, alpha: (showBack ? 0 : inside) * 0.6 });
    // back: the meaning, written out
    brush(path([[426, 236], [446, 230], [470, 240], [494, 230], [520, 238], [536, 232]], 0.4), 3, 1, { color: INK, alpha: showBack ? inside : 0 });
    brush(path([[436, 268], [470, 262], [500, 270], [526, 264]], 0.4), 2.4, 1, { color: INK, alpha: (showBack ? inside : 0) * 0.7 });

    // a streak flame (last: it flickers)
    var fla = prog(t, 2.0, 0.5), fxf = 140, fyf = 262, fk = reduceMotion ? 0 : Math.sin(t * 7) * 3;
    function F(p) { return [fxf + p[0], fyf + p[1]]; }
    fill(closed([[4 + fk, -66], [16, -40], [26, -16], [28, 6], [18, 24], [0, 30], [-18, 24], [-28, 6], [-24, -18], [-14, -34], [-12, -20], [-4, -40]].map(F), 0.5), PAPER, fla);
    fill(closed([[2 - fk * 0.4, -30], [12, -8], [10, 10], [0, 18], [-10, 10], [-10, -6], [-4, -2]].map(F), 0.3), INK, fla);
  }

  // ---------------------------------------------------------------- summer 2026: Thoreau's cabin (walden.life) and an answer sheet (SATitude)
  function sSummer(t) {
    brush(seg(40, 330, 480, 330, 0.6), 2, prog(t, 0.2, 0.8), {});
    var pond = arcPts(250, 384, 150, 34, 0, Math.PI * 2, 0.8);
    fill(pond, PAPER, prog(t, 0.5, 0.5) * 0.16);
    brush(pond, 2.2, prog(t, 0.5, 1), { taper: 0.04 });
    for (var r = 0; r < 6; r++) {
      brush(seg(162 + r * 30, 380 + (r % 2) * 10, 190 + r * 30, 380 + (r % 2) * 10, 0.3), 1.4, prog(t, 1.2 + r * 0.06, 0.3), { alpha: 0.7 });
    }
    var ca = prog(t, 0.8, 0.8);
    brush(rectPts(300, 272, 70, 58, 0.5), 2.4, ca, { taper: 0.03 });
    brush(path([[292, 274], [335, 238], [378, 274]], 0.4), 2.6, ca, {});
    brush(rectPts(328, 298, 16, 32, 0.3), 1.8, ca, { taper: 0.03 });
    brush(seg(356, 252, 356, 232, 0.2), 3, ca, {});
    [[70, 330, 80], [108, 330, 64], [146, 330, 92], [420, 330, 78], [454, 330, 60]].forEach(function (tr, k) {
      var tp = prog(t, 1.0 + k * 0.1, 0.5);
      brush(seg(tr[0], tr[1], tr[0], tr[1] - tr[2], 0.3), 2, tp, {});
      for (var b = 0; b < 4; b++) {
        var by = tr[1] - tr[2] * (0.25 + b * 0.2), bw = tr[2] * (0.32 - b * 0.06);
        brush(path([[tr[0] - bw, by + 6], [tr[0], by - 8], [tr[0] + bw, by + 6]], 0.3), 1.8, tp, {});
      }
    });
    // a timeline of daily entries
    brush(seg(60, 474, 470, 474, 0.4), 2, prog(t, 1.6, 0.8), {});
    for (var d = 0; d < 50; d++) {
      var dx = 64 + d * 8, tall = d % 10 === 0;
      brush(seg(dx, 474, dx, tall ? 455 : 465, 0.1), tall ? 2 : 1.3, prog(t, 1.8 + d * 0.03, 0.15), {});
    }

    // the answer sheet, bubbles filling in
    var sa = prog(t, 0.6, 0.5);
    fill(rectPts(560, 104, 310, 350, 0.8), PAPER, sa);
    for (var row = 0; row < 7; row++) {
      var y = 156 + row * 42, pick = Math.floor(R() * 4);
      brush(seg(584, y, 604, y, 0.1), 2.2, sa, { color: INK, taper: 0 });
      for (var c = 0; c < 4; c++) {
        var bx = 650 + c * 52, ring = circlePts(bx, y, 11, 0.2);
        brush(ring, 1.6, prog(t, 0.9 + row * 0.08, 0.3), { color: INK, taper: 0.05 });
        fill(circlePts(bx, y, 8, 0.2), INK, c === pick ? prog(t, 2.2 + row * 0.35, 0.2) : 0);
      }
    }

    // chimney smoke (last: it drifts)
    var smoke = [];
    for (var i = 0; i <= 6; i++) smoke.push([356 + Math.sin(i * 0.9 + t * 1.8) * 5 + i * 3, 228 - i * 12]);
    brush(smoke, 2, prog(t, 1.6, 0.8), { alpha: 0.7, taper: 0.4, still: true });
  }

  // ---------------------------------------------------------------- scene: the résumé on a desk
  function sResume(t) {
    brush(seg(40, 476, 920, 476, 0.8), 3, prog(t, 0.2, 1), { taper: 0.05 });
    var ang = -0.05, ca = Math.cos(ang), sa = Math.sin(ang);
    function S(x, y) { return [470 + x * ca - y * sa, 268 + x * sa + y * ca]; }
    function line(x1, y1, x2, y2, w, p, al) {
      var A = S(x1, y1), B = S(x2, y2);
      brush(seg(A[0], A[1], B[0], B[1], 0.3), w, p, { color: INK, taper: 0.1, alpha: al == null ? 1 : al });
    }
    var sheet = closed([S(-150, -196), S(150, -196), S(150, 196), S(-150, 196)], 0.8);
    fill(sheet, PAPER, prog(t, 0.4, 0.5));
    line(-84, -166, 84, -166, 7, prog(t, 0.9, 0.4));
    line(-64, -146, 64, -146, 1.8, prog(t, 1.1, 0.3), 0.7);
    var y = -118, sections = [3, 4, 3, 2];
    sections.forEach(function (n, k) {
      line(-126, y, -56, y, 3.6, prog(t, 1.3 + k * 0.45, 0.3));
      line(-126, y + 8, 126, y + 8, 1, prog(t, 1.35 + k * 0.45, 0.3), 0.5);
      for (var i = 0; i < n; i++) {
        var yy = y + 22 + i * 14, len = 140 + R() * 96, bp = prog(t, 1.45 + k * 0.45 + i * 0.07, 0.25);
        var d = S(-118, yy);
        fill(circlePts(d[0], d[1], 2, 0.1), INK, bp);
        line(-108, yy, -108 + len, yy, 1.6, bp, 0.75);
      }
      y += 34 + n * 14;
    });
    brush(path([[650, 440], [770, 336]], 0.3), 9, prog(t, 2.8, 0.5), { taper: 0.15 });   // a pen
    brush(seg(650, 440, 638, 454, 0.2), 3, prog(t, 3.2, 0.2), {});
    brush(seg(752, 352, 764, 364, 0.1), 1.6, prog(t, 3.2, 0.2), { color: INK, taper: 0 });
  }

  // ---------------------------------------------------------------- the film: shots and their words
  // The main story is just my life. At the end, viewers choose what to see next: each choice is its own
  // short film ("track") that returns to the choices when it ends.
  // "enter" is the camera move used to arrive at a shot in the main story.
  var SHOT = {
    title: { draw: sTitle, seed: 101, anchor: "tc", auto: true,
      lines: ["aditya bikram thakur.", "math + cs at washington and lee.", "click, tap or press → to begin."] },
    pokhara: { draw: sPokhara, seed: 11, anchor: "tl", enter: "wipe",
      lines: ["i grew up in pokhara, nepal.", "under machhapuchhre, the “fish tail” mountain."] },
    school: { draw: sSchool, seed: 22, anchor: "tc", enter: "pan",
      lines: ["budhanilkantha school, kathmandu.", "a levels in physics, chemistry, computer science and math. A* in all four.", "valedictorian. 1600 on the sat."] },
    lexington: { draw: sLexington, seed: 55, anchor: "tl", enter: "rise",
      lines: ["august 2026: about 12,000 km later.", "washington and lee university, lexington, virginia.", "a math + cs double major, on a full-ride scholarship."] },
    today: { draw: sEnd, seed: 77, anchor: "tl", enter: "wipe",
      lines: ["that’s my story so far.", "want to see more? pick one:"],
      choices: [
        { label: "projects →", track: "projects", aria: "Watch my projects" },
        { label: "experience →", track: "experience", aria: "Watch my experience" },
        { label: "résumé →", track: "resume", aria: "See my résumé" }
      ],
      links: [
        { label: "email", href: "mailto:thakura30@wlu.edu", aria: "Email Aditya at thakura30@wlu.edu" },
        { label: "github ↗", href: "https://github.com/sirElvinn", aria: "Aditya on GitHub", ext: true },
        { label: "linkedin ↗", href: "https://www.linkedin.com/in/aditya-thakur-a76501266/", aria: "Aditya on LinkedIn", ext: true },
        { label: "watch again ↺", restart: true, aria: "Watch the story again from the start" }
      ] },

    // projects
    diatometer: { draw: sMicro, seed: 66, anchor: "tl",
      lines: ["diatometer · sep 2026 – now.", "with william & mary’s nano & biomaterials lab: measuring tiny glass algae shells.", "136 shells measured in about 15 seconds."],
      links: [
        { label: "visit ↗", href: "https://diamometer.us", aria: "Visit DiatoMeter", ext: true },
        { label: "source ↗", href: "https://github.com/sirElvinn/diatometer", aria: "DiatoMeter source code on GitHub", ext: true }
      ] },
    "summer-builds": { draw: sSummer, seed: 99, anchor: "tl",
      lines: ["summer 2026: two projects of my own.", "walden.life: thoreau’s walden, one day at a time.", "satitude: practice for the digital sat."],
      links: [
        { label: "walden.life ↗", href: "https://walden.life", aria: "Visit walden.life", ext: true },
        { label: "satitude ↗", href: "https://satitude.xyz", aria: "Visit SATitude", ext: true }
      ] },

    // experience
    courses: { draw: sNight, seed: 33, anchor: "tl",
      lines: ["2025: learning on my own.", "the algorithms and machine learning specializations from stanford.", "and harvard’s cs50 ai: twelve projects."],
      links: [
        { label: "algorithms ↗", href: "https://coursera.org/verify/specialization/3EANS56UPKJ0", aria: "Verify the Algorithms Specialization certificate", ext: true },
        { label: "machine learning ↗", href: "https://coursera.org/verify/specialization/Q4C4SVBK51SB", aria: "Verify the Machine Learning Specialization certificate", ext: true },
        { label: "cs50 ai ↗", href: "https://cs50.harvard.edu/certificates/1f29da05-1c3e-4d82-8301-c2e1e56e03ea", aria: "Verify the CS50 AI certificate", ext: true }
      ] },
    nepalingo: { draw: sCards, seed: 88, anchor: "tl",
      lines: ["summer 2024: incubate nepal.", "frontend developer on nepalingo, an open-source app for learning nepal’s indigenous languages.", "i built the flashcards, daily quiz and activity cards. 11 merged pull requests."],
      links: [
        { label: "nepalingo ↗", href: "https://nepalingo.com", aria: "Visit Nepalingo", ext: true },
        { label: "source ↗", href: "https://github.com/nepalcodes/nepalingo", aria: "Nepalingo source code on GitHub", ext: true }
      ] },
    "lipi-ai": { draw: sStone, seed: 44, anchor: "bl",
      lines: ["summer 2023: student research council nepal.", "lipi ai: an app that reads tibetan inscriptions from a phone photo.", "i built the backend: splitting stacked letters so ocr can read them."] },

    // résumé
    resume: { draw: sResume, seed: 120, anchor: "tl",
      lines: ["the one-page version.", "education, projects, experience and skills."],
      links: [{ label: "open the pdf ↗", href: "assets/aditya-thakur-resume.pdf", aria: "Open Aditya's résumé (PDF)", ext: true }] }
  };
  Object.keys(SHOT).forEach(function (id) { SHOT[id].id = id; });

  var TRACKS = {
    main: ["title", "pokhara", "school", "lexington", "today"],
    projects: ["diatometer", "summer-builds"],
    experience: ["courses", "nepalingo", "lipi-ai"],
    resume: ["resume"]
  };
  var MENU = "today";
  var ALIASES = { contact: "today", menu: "today", projects: "diatometer", experience: "courses" };

  function locate(id) {
    id = ALIASES[id] || id;
    for (var name in TRACKS) {
      var i = TRACKS[name].indexOf(id);
      if (i >= 0) return { track: name, pos: i };
    }
    return null;
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

  // ---------------------------------------------------------------- screen layout
  var main = filmCanvas.getContext("2d");
  var grainPat = main.createPattern(grainCanvas, "repeat");
  var bufA = document.createElement("canvas"), bufB = document.createElement("canvas");
  var bctxA = bufA.getContext("2d"), bctxB = bufB.getContext("2d");
  var dpr = 1, VW = 0, VH = 0, portrait = false, capSize = 24, vignette = null;
  var film = { x: 0, y: 0, w: 0, h: 0 };

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    VW = window.innerWidth;
    VH = window.innerHeight;
    filmCanvas.width = Math.round(VW * dpr);
    filmCanvas.height = Math.round(VH * dpr);
    portrait = VW / VH < 1.05;
    var m = portrait ? 12 : Math.max(16, Math.min(VW, VH) * 0.035);
    var fw = VW - m * 2, fh = (fw * 9) / 16;
    var maxH = portrait ? VH * 0.46 : VH - m * 2 - 30;
    if (fh > maxH) { fh = maxH; fw = (fh * 16) / 9; }
    film.w = fw; film.h = fh;
    film.x = (VW - fw) / 2;
    film.y = portrait ? Math.max(20, Math.min(VH * 0.2, VH - fh - 330)) : Math.max(m, (VH - fh) / 2 - 12);
    [bufA, bufB].forEach(function (b) { b.width = Math.max(1, Math.round(fw * dpr)); b.height = Math.max(1, Math.round(fh * dpr)); });
    capSize = portrait ? Math.max(16, Math.min(21, VW * 0.048)) : Math.max(15, Math.min(28, fw * 0.022));
    vignette = main.createRadialGradient(film.x + fw / 2, film.y + fh / 2, fh * 0.42, film.x + fw / 2, film.y + fh / 2, fw * 0.66);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.5)");
  }

  function renderScene(s, t, bctx, bw) {
    ctx = bctx;
    var k = bw / W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);
    sid = 0; R = mulberry32(s.seed);
    s.draw(t);
  }

  // ---------------------------------------------------------------- state
  var track = "main", pos = 0, shot = SHOT.title, beat = 0, shotStart = 0, lineStarts = [], trans = null;
  var TYPE_CPS = 45, CAPTION_DELAY = 650;

  function typedDone(k, now) {
    return now - lineStarts[k] >= (shot.lines[k].length / TYPE_CPS) * 1000;
  }

  // full = arrive with everything already drawn and written (going back, or returning to the choices)
  function enterShot(tr, p, now, full) {
    track = tr; pos = p; shot = SHOT[TRACKS[tr][p]];
    lineStarts = [];
    if (full || reduceMotion) {
      shotStart = now - 60000;
      beat = shot.lines.length;
      for (var k = 0; k < beat; k++) lineStarts.push(now - 100000);
    } else {
      shotStart = now;
      var delay = (trans ? trans.dur : 0) + CAPTION_DELAY;
      if (shot.auto) {
        beat = shot.lines.length;
        for (var j = 0; j < beat; j++) lineStarts.push(now + delay + j * 1300);
      } else {
        beat = 1;
        lineStarts.push(now + delay);
      }
    }
    try { history.replaceState(null, "", shot.id === "title" ? location.pathname : "#" + shot.id); } catch (e) {}
    announce();
  }

  function go(tr, p, dir, type, full) {
    var now = performance.now();
    trans = reduceMotion ? null : { fromShot: shot, fromStart: shotStart, type: type || "pan", dir: dir, start: now, dur: 1050 };
    enterShot(tr, p, now, full || dir < 0);
  }

  function startTrack(name) { go(name, 0, 1, "zoom", false); }
  function backToChoices(dir) { go("main", TRACKS.main.indexOf(MENU), dir, "wipe", true); }
  function restart() { trans = null; go("main", 0, 1, "wipe", false); }

  function next() {
    var now = performance.now();
    if (trans) { trans = null; return; }
    var typing = false;
    for (var k = 0; k < beat; k++) {
      if (!typedDone(k, now)) { lineStarts[k] = now - 100000; typing = true; }
    }
    if (typing) { announce(); return; }
    if (beat < shot.lines.length) { lineStarts[beat] = now; beat++; announce(); return; }
    var list = TRACKS[track];
    if (pos < list.length - 1) {
      var nextShot = SHOT[list[pos + 1]];
      go(track, pos + 1, 1, track === "main" ? nextShot.enter : "pan", false);
      return;
    }
    if (track !== "main") backToChoices(1);
    // At the choices, the film waits: the choice boxes are the way on.
  }

  function prev() {
    if (trans) trans = null;
    if (!shot.auto && beat > 1) { beat--; announce(); return; }
    if (pos > 0) { go(track, pos - 1, -1, track === "main" ? shot.enter : "pan", true); return; }
    if (track !== "main") backToChoices(-1);
  }

  // ---------------------------------------------------------------- captions and boxes (drawn in screen space, so they stay readable)
  var HAND_FONT = function (size) { return "700 " + size + "px " + HAND; };

  function wrap(text, maxW, size) {
    main.font = HAND_FONT(size);
    var words = text.split(" "), lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (line && main.measureText(test).width > maxW) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    var w = 0;
    lines.forEach(function (l) { w = Math.max(w, main.measureText(l).width); });
    return { lines: lines, w: w };
  }

  function stack(texts, size, anchor, big) {
    var gap = size * 0.75, m = size * 0.95;
    var maxW = portrait ? VW - 32 - size * 1.5 : film.w * (anchor === "tc" ? 0.62 : 0.46);
    var boxes = texts.map(function (tx, k) {
      var sz = big && k === 0 ? size * 1.5 : size, px = sz * 0.75, py = sz * 0.5, lh = sz * 1.22;
      var r = wrap(tx, maxW, sz);
      return { lines: r.lines, w: r.w + px * 2, h: r.lines.length * lh + py * 2 - lh * 0.18, padX: px, padY: py, lineH: lh, size: sz };
    });
    var total = boxes.reduce(function (a, b) { return a + b.h; }, 0) + gap * Math.max(0, boxes.length - 1);
    var y = portrait ? film.y + film.h + 22
      : anchor.charAt(0) === "b" ? film.y + film.h - m - total : film.y + m;
    boxes.forEach(function (b) {
      if (portrait) b.x = 16;
      else if (anchor === "tc") b.x = film.x + (film.w - b.w) / 2;
      else if (anchor.charAt(1) === "r") b.x = film.x + film.w - m - b.w;
      else b.x = film.x + m;
      b.y = y;
      y += b.h + gap;
    });
    return { boxes: boxes, bottom: y - gap };
  }

  function drawBox(b, key, a, chars) {
    sid = 60000 + key * 50; R = mulberry32(1000 + key);
    fill(rectPts(b.x - 9, b.y - 9, b.w + 18, b.h + 18, 1), INK, a);   // dark mat, so the box reads on light drawings too
    fill(rectPts(b.x, b.y, b.w, b.h, 1), PAPER, a);
    brush(rectPts(b.x - 5, b.y - 5, b.w + 10, b.h + 10, 1), 1.6, Math.min(1, a * 1.4), { taper: 0.04, alpha: a });
    var left = chars == null ? 1e9 : chars;
    for (var i = 0; i < b.lines.length && left > 0; i++) {
      var str = b.lines[i].slice(0, Math.max(0, left));
      left -= b.lines[i].length + 1;
      hand(str, b.x + b.padX, b.y + b.padY + b.size * 0.86 + i * b.lineH, b.size, INK, "left", a);
    }
  }

  // A row of clickable boxes (choices or links) that wraps onto new rows when it runs out of room.
  function boxRow(items, kind, x0, y0, size, maxX, t0, now, fade, keyBase) {
    var x = x0, y = y0, rowBottom = y0;
    items.forEach(function (it, j) {
      var r = wrap(it.label, 1e4, size), padX = size * 0.7, padY = size * 0.45;
      var b = { lines: [it.label], w: r.w + padX * 2, h: size * 1.22 + padY * 2 - size * 0.22, padX: padX, padY: padY, lineH: size * 1.22, size: size };
      if (x + b.w > maxX && j > 0) { x = x0; y = rowBottom + size * 0.7; }
      b.x = x; b.y = y;
      x += b.w + size * 0.9;
      rowBottom = Math.max(rowBottom, y + b.h);
      var a = reduceMotion ? fade : clamp01((now - (t0 + j * 160)) / 260) * fade;
      if (a > 0) {
        drawBox(b, keyBase + j, a, null);
        hits.push({ key: shot.id + ":" + kind + ":" + j, kind: kind, item: it, x: b.x - 5, y: b.y - 5, w: b.w + 10, h: b.h + 10 });
      }
    });
    return rowBottom;
  }

  var hits = [];
  function drawCaptions(now, fade) {
    ctx = main;
    main.setTransform(dpr, 0, 0, dpr, 0, 0);
    var texts = shot.lines.slice(0, beat);
    var st = stack(texts, capSize, shot.anchor, shot.auto);
    st.boxes.forEach(function (b, k) {
      var since = now - lineStarts[k];
      if (since < 0) return;
      var a = clamp01(since / 260) * fade;
      var chars = reduceMotion ? null : Math.floor((since / 1000) * TYPE_CPS);
      drawBox(b, k + shot.seed * 10, a, chars);
    });
    hits = [];
    if (beat >= shot.lines.length && (shot.choices || shot.links)) {
      var lastStart = lineStarts[shot.lines.length - 1];
      var x0 = st.boxes.length ? st.boxes[0].x : film.x + 20;
      var maxX = portrait ? VW - 16 : film.x + film.w - capSize;
      var y = st.bottom + capSize * 0.9;
      // when the captions sit at the bottom of the film, put the boxes above them instead
      if (!portrait && shot.anchor.charAt(0) === "b") y = (st.boxes.length ? st.boxes[0].y : film.y + film.h) - capSize * 3.2;
      if (shot.choices) {
        y = boxRow(shot.choices, "choice", x0, y, capSize * 1.08, maxX, lastStart + 500, now, fade, 800) + capSize * 0.9;
      }
      if (shot.links) {
        boxRow(shot.links, "link", x0, y, capSize * 0.86, maxX, lastStart + (shot.choices ? 1100 : 500), now, fade, 900);
      }
    }
  }

  // ---------------------------------------------------------------- the frame around the film, progress dots, edge arrows
  function drawFilmChrome(now) {
    ctx = main;
    main.setTransform(dpr, 0, 0, dpr, 0, 0);
    main.save();
    main.globalAlpha = 0.05;
    main.translate(-((boil * 37) % 160), -((boil * 23) % 160));
    main.fillStyle = grainPat;
    main.fillRect(0, 0, VW + 160, VH + 160);
    main.restore();
    main.fillStyle = vignette;
    main.fillRect(film.x, film.y, film.w, film.h);
    sid = 70000; R = mulberry32(4242);
    brush(rectPts(film.x - 2, film.y - 2, film.w + 4, film.h + 4, 0.9), 1.6, 1, { taper: 0.02, alpha: 0.5 });

    var list = TRACKS[track], n = list.length, gapD = 14;
    var dy = portrait ? VH - 26 : film.y + film.h + 22, x0 = VW / 2 - ((n - 1) * gapD) / 2;
    for (var i = 0; i < n && n > 1; i++) {
      main.beginPath();
      main.arc(x0 + i * gapD, dy, i === pos ? 3.6 : 2.6, 0, Math.PI * 2);
      main.globalAlpha = i === pos ? 0.95 : 0.35;
      main.fillStyle = PAPER;
      main.fill();
    }
    main.globalAlpha = 1;

    var atChoices = shot.id === MENU && beat >= shot.lines.length;
    var showNext = !atChoices && ((hover === "next") || (shot.id === "title" && !reduceMotion));
    var canBack = pos > 0 || track !== "main";
    var showPrev = hover === "prev" && canBack;
    var cy = film.y + film.h / 2, sz = Math.max(12, capSize * 0.7);
    if (showNext) {
      var pulse = shot.id === "title" && hover !== "next" ? 0.35 + 0.35 * Math.sin(now / 400) : 0.75;
      var ax = film.x + film.w - sz * 1.6;
      brush(path([[ax - sz * 0.4, cy - sz], [ax + sz * 0.5, cy], [ax - sz * 0.4, cy + sz]], 0.3), 3, 1, { alpha: Math.max(0, pulse), taper: 0.3 });
    }
    if (showPrev) {
      var bx = film.x + sz * 1.6;
      brush(path([[bx + sz * 0.4, cy - sz], [bx - sz * 0.5, cy], [bx + sz * 0.4, cy + sz]], 0.3), 3, 1, { alpha: 0.75, taper: 0.3 });
    }
  }

  // ---------------------------------------------------------------- camera moves between shots
  function compose(e) {
    var tr = trans, d = tr.dir;
    main.save();
    main.beginPath();
    main.rect(film.x, film.y, film.w, film.h);
    main.clip();
    if (tr.type === "pan") {
      main.drawImage(bufB, film.x - d * e * film.w, film.y, film.w, film.h);
      main.drawImage(bufA, film.x + d * (1 - e) * film.w, film.y, film.w, film.h);
    } else if (tr.type === "rise") {
      main.drawImage(bufB, film.x, film.y + d * e * film.h, film.w, film.h);
      main.drawImage(bufA, film.x, film.y - d * (1 - e) * film.h, film.w, film.h);
    } else if (tr.type === "zoom") {
      var cx = film.x + film.w / 2, cy = film.y + film.h / 2;
      var so = d > 0 ? 1 + e * 1.4 : 1 - e * 0.3, si = d > 0 ? 0.82 + e * 0.18 : 2.4 - e * 1.4;
      main.globalAlpha = 1 - e;
      main.drawImage(bufB, cx - (film.w * so) / 2, cy - (film.h * so) / 2, film.w * so, film.h * so);
      main.globalAlpha = e;
      main.drawImage(bufA, cx - (film.w * si) / 2, cy - (film.h * si) / 2, film.w * si, film.h * si);
      main.globalAlpha = 1;
    } else {
      // wipe: a big ink brush sweeps across, then pulls away to reveal the next shot
      var covering = e < 0.5, q = covering ? e / 0.5 : 1 - (e - 0.5) / 0.5;
      main.drawImage(covering ? bufB : bufA, film.x, film.y, film.w, film.h);
      ctx = main;
      main.setTransform(dpr, 0, 0, dpr, 0, 0);
      sid = 80000; R = mulberry32(31);
      for (var k = 0; k < 5; k++) {
        var y0 = film.y + film.h * (-0.05 + k * 0.24), lean = film.h * 0.18;
        var pts = d > 0
          ? path([[film.x - 60, y0], [film.x + film.w * 0.5, y0 + lean * 0.6], [film.x + film.w + 60, y0 + lean]], 3)
          : path([[film.x + film.w + 60, y0 + lean], [film.x + film.w * 0.5, y0 + lean * 0.6], [film.x - 60, y0]], 3);
        brush(pts, film.h * 0.36, clamp01(q * 1.25 - k * 0.06), { color: INK, taper: 0.06, still: true });
      }
    }
    main.restore();
  }

  // ---------------------------------------------------------------- the loop
  var lastFrame = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastFrame < 1000 / 30) return;
    lastFrame = now;
    boil = reduceMotion ? 0 : Math.floor(now / 120) % 5;

    main.setTransform(dpr, 0, 0, dpr, 0, 0);
    main.globalAlpha = 1;
    main.fillStyle = INK;
    main.fillRect(0, 0, VW, VH);

    var tCur = reduceMotion ? 60 : (now - shotStart) / 1000;
    renderScene(shot, tCur, bctxA, bufA.width);
    var fade = 1;
    if (trans) {
      var p = clamp01((now - trans.start) / trans.dur), e = easeInOut(p);
      renderScene(trans.fromShot, (now - trans.fromStart) / 1000, bctxB, bufB.width);
      main.setTransform(dpr, 0, 0, dpr, 0, 0);
      compose(e);
      fade = e;
      if (p >= 1) trans = null;
    } else {
      main.setTransform(dpr, 0, 0, dpr, 0, 0);
      main.drawImage(bufA, film.x, film.y, film.w, film.h);
    }
    drawFilmChrome(now);
    drawCaptions(now, fade);
    placeHits();
  }

  // ---------------------------------------------------------------- real buttons and links over the drawn boxes (clickable, keyboard-reachable)
  var hitEls = {};
  function hitEl(h) {
    if (hitEls[h.key]) return hitEls[h.key];
    var el, it = h.item;
    if (h.kind === "choice" || it.restart) {
      el = document.createElement("button");
      el.type = "button";
      el.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (it.restart) restart(); else startTrack(it.track);
        filmCanvas.focus();
      });
    } else {
      el = document.createElement("a");
      el.href = it.href;
      if (it.ext) { el.target = "_blank"; el.rel = "noopener"; }
    }
    el.className = "film-link";
    el.setAttribute("aria-label", it.aria || it.label);
    document.body.appendChild(el);
    return (hitEls[h.key] = el);
  }
  function placeHits() {
    var shown = {};
    hits.forEach(function (h) {
      var el = hitEl(h);
      shown[h.key] = true;
      el.hidden = false;
      el.style.left = h.x + "px"; el.style.top = h.y + "px";
      el.style.width = h.w + "px"; el.style.height = h.h + "px";
    });
    Object.keys(hitEls).forEach(function (k) { if (!shown[k]) hitEls[k].hidden = true; });
  }

  // ---------------------------------------------------------------- screen readers: say each caption as it appears
  var live = document.getElementById("film-live");
  function announce() {
    if (!live) return;
    var extra = "";
    if (beat >= shot.lines.length) {
      if (shot.choices) extra += " Choices: " + shot.choices.map(function (c) { return c.aria; }).join(", ") + ".";
      if (shot.links) extra += " Links: " + shot.links.map(function (l) { return l.aria; }).join(", ") + ".";
    }
    live.textContent = shot.lines.slice(0, beat).join(" ") + extra;
  }

  // ---------------------------------------------------------------- input: click/tap, swipe, keys, wheel
  var hover = null, down = null, wheelLock = 0;
  filmCanvas.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") { hover = null; return; }
    hover = e.clientX < VW * 0.22 ? "prev" : "next";
  });
  filmCanvas.addEventListener("pointerleave", function () { hover = null; });
  filmCanvas.addEventListener("pointerdown", function (e) { down = { x: e.clientX, y: e.clientY }; });
  filmCanvas.addEventListener("pointerup", function (e) {
    if (!down) return;
    var dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) next(); else prev(); return; }
    if (e.clientX < VW * 0.22 && (pos > 0 || track !== "main")) prev(); else next();
  });
  document.addEventListener("keydown", function (e) {
    if (e.target && e.target.classList && e.target.classList.contains("film-link")) return;
    if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter" || e.key === "PageDown") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "Backspace") { e.preventDefault(); prev(); }
    else if (e.key === "Home") { e.preventDefault(); restart(); }
    else if (e.key === "Escape" && track !== "main") { e.preventDefault(); backToChoices(-1); }
  });
  window.addEventListener("wheel", function (e) {
    var now = performance.now();
    if (now < wheelLock || Math.abs(e.deltaY) < 24) return;
    wheelLock = now + 650;
    if (e.deltaY > 0) next(); else prev();
  }, { passive: true });
  var btnPrev = document.getElementById("film-prev"), btnNext = document.getElementById("film-next");
  if (btnPrev) btnPrev.addEventListener("click", prev);
  if (btnNext) btnNext.addEventListener("click", next);

  window.addEventListener("resize", layout);
  layout();

  // Start where the link points (adthakur.com/#diatometer, /#projects, /#contact), or at the title.
  (function () {
    var h = decodeURIComponent((location.hash || "").replace("#", ""));
    var at = h ? locate(h) : null, now = performance.now();
    if (!at) { enterShot("main", 0, now, false); return; }
    enterShot(at.track, at.pos, now, at.track === "main" && TRACKS.main[at.pos] === MENU);
  })();

  var started = false;
  function begin() { if (!started) { started = true; requestAnimationFrame(frame); } }
  if (document.fonts && document.fonts.load) {
    document.fonts.load("700 30px Caveat").then(begin, begin);
    setTimeout(begin, 1500);
  } else {
    begin();
  }

  // For checking by hand from the browser console: filmDebug.show("diatometer") jumps to a shot, fully drawn.
  window.filmDebug = {
    show: function (id) { var at = locate(id); if (at) { trans = null; enterShot(at.track, at.pos, performance.now(), true); } },
    track: startTrack, next: next, prev: prev
  };
})();
