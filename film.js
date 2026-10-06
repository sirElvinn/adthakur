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
  // Drawn from photos of Phewa Lake: the snowy Annapurna range behind forested, terraced foothills, with
  // Machhapuchhre's sharp pyramid standing in front; Sarangkot's ridge and its paragliders on the left;
  // the two-tiered Tal Barahi temple on its island; long wooden doongas moored and rowed on the water.
  var ANNAPURNA = [[0, 284], [50, 252], [110, 234], [170, 216], [220, 200], [262, 176], [296, 190], [330, 170], [362, 152],
    [402, 166], [446, 184], [490, 194], [540, 190], [600, 184], [660, 192], [720, 180], [770, 172], [800, 158], [826, 140],
    [856, 152], [888, 168], [914, 158], [940, 172], [960, 178]];
  // Machhapuchhre as seen from Pokhara: a narrow spire with a slightly hooked tip and a step on its east ridge,
  // standing on a broad massif whose ridges run out on both sides in jagged teeth.
  var MACHHA = [[470, 266], [472, 248], [486, 240], [500, 232], [512, 226], [524, 222], [536, 214], [548, 208], [558, 198],
    [568, 188], [578, 172], [592, 146], [606, 118], [620, 92], [632, 70], [640, 54], [645, 44], [650, 52], [656, 72],
    [663, 94], [668, 100], [674, 114], [686, 138], [698, 156], [710, 166], [722, 172], [734, 170], [746, 180], [758, 180],
    [770, 190], [784, 190], [798, 200], [814, 206], [832, 222], [852, 266]];
  var MACHHA_TOP = 16;
  function treeTops(line, step, p, alpha) {
    var L = 0, i;
    for (i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    var n = Math.floor(L / step);
    for (i = 0; i < n; i++) {
      var q = pointAt(line, (i + 0.5) / n), r = step * 0.55;
      brush(arcPts(q[0], q[1] + r * 0.5, r, r * 0.8, Math.PI, Math.PI * 2, 0.3), 1.2, p, { alpha: alpha, taper: 0.2 });
    }
  }
  function doonga(x, y, s, a, rower, t) {
    var hull = [[x - 44 * s, y - 9 * s], [x - 36 * s, y + 2 * s], [x + 36 * s, y + 2 * s], [x + 46 * s, y - 10 * s]];
    fill(path(hull.concat([[x, y - 5 * s]]), 0.3), INK, a);
    brush(path(hull, 0.3), 3 * s, a, { taper: 0.1 });
    brush(seg(x - 42 * s, y - 7 * s, x + 44 * s, y - 8 * s, 0.2), 1.6 * s, a, { alpha: 0.8 });
    brush(seg(x - 34 * s, y - 3 * s, x + 34 * s, y - 3 * s, 0.2), 1.2 * s, a, { alpha: 0.5 });   // its painted stripe
    if (!rower) return;
    var stroke = reduceMotion ? 0 : Math.sin(t * 1.6) * 4 * s;
    fill(circlePts(x + 24 * s, y - 27 * s, 4.6 * s, 0.2), PAPER, a);
    fill(closed([[x + 18 * s, y - 21 * s], [x + 30 * s, y - 21 * s], [x + 31 * s, y - 7 * s], [x + 17 * s, y - 7 * s]], 0.2), PAPER, a);
    brush(seg(x + 10 * s + stroke, y - 32 * s, x - 6 * s - stroke, y + 14 * s, 0.2), 2 * s, a, {});   // the paddle
  }
  function paraglider(x, y, s, a) {
    brush(arcPts(x, y + 8 * s, 18 * s, 9 * s, Math.PI * 1.08, Math.PI * 1.92, 0.2), 4.5 * s, a, { taper: 0.25 });
    brush(seg(x - 15 * s, y + 4 * s, x, y + 20 * s, 0.05), 0.8, a, { alpha: 0.7, taper: 0 });
    brush(seg(x + 15 * s, y + 4 * s, x, y + 20 * s, 0.05), 0.8, a, { alpha: 0.7, taper: 0 });
    fill(circlePts(x, y + 22 * s, 2.4 * s, 0.05), PAPER, a);
  }

  function sPokhara(t) {
    var i;
    stars(26, 0, 0, W, 110, t, 0);

    // the Annapurna range: snow, with shadowed west faces and couloirs
    var ra = prog(t, 0.2, 1.4);
    fill(ANNAPURNA.concat([[960, 300], [0, 300]]), PAPER, ra * 0.62, { still: true });
    brush(path(ANNAPURNA, 0.8), 2.2, ra, {});
    [[[262, 176], [222, 214], [254, 230]], [[362, 152], [318, 196], [352, 214]], [[826, 140], [780, 184], [816, 204]], [[914, 158], [884, 186], [906, 200]]].forEach(function (f, k) {
      fill(closed(f, 0.5), INK, prog(t, 0.8 + k * 0.1, 0.6) * 0.3);
    });
    [[262, 180, 250, 230], [366, 156, 380, 214], [358, 160, 334, 220], [828, 146, 846, 206], [822, 146, 800, 210], [700, 186, 690, 230], [470, 192, 456, 236]].forEach(function (c, k) {
      brush(seg(c[0], c[1], c[2], c[3], 1), 1.4, prog(t, 1.0 + k * 0.06, 0.5), { color: INK, alpha: 0.5, taper: 0.3 });
    });

    // Machhapuchhre, nearer and taller: lit west face, shadowed east face, both fluted with snow ribs
    var ma = prog(t, 0.5, 1.2);
    fill(MACHHA, PAPER, ma * 0.96, { still: true });
    var rib = [[645, 44], [647, 90], [651, 160], [658, 266]];      // the central rib, where light meets shadow
    fill(MACHHA.slice(MACHHA_TOP + 1).concat(rib.slice().reverse().slice(0, 3)), INK, ma * 0.36, { still: true });
    brush(path(MACHHA, 0.5), 2.4, ma, { taper: 0.04 });
    brush(path(rib, 0.4), 1.6, prog(t, 1.1, 0.6), { color: INK, alpha: 0.6, taper: 0.2 });
    for (i = 0; i < 10; i++) {                                     // flutings on the lit face, running down to the rib
      var u = (i + 0.5) / 10, sx = lerp(640, 578, u), sy = lerp(54, 172, u);
      brush(seg(sx + 2, sy + 4, lerp(sx, 650, 0.45), sy + 50 + 40 * (1 - u), 0.6), 1.2, prog(t, 1.2 + i * 0.04, 0.4), { color: INK, alpha: 0.4, taper: 0.3 });
    }
    for (i = 0; i < 9; i++) {                                      // snow ribs catching light on the shadowed face
      var v = (i + 0.5) / 9, ex = lerp(650, 710, v), ey = lerp(52, 166, v);
      brush(seg(ex - 2, ey + 4, lerp(ex, 654, 0.4), ey + 44 + 30 * (1 - v), 0.6), 1.2, prog(t, 1.3 + i * 0.04, 0.4), { alpha: 0.45, taper: 0.3 });
    }
    [[512, 226], [536, 214], [558, 198], [734, 170], [758, 180], [784, 190], [814, 206]].forEach(function (j, k) {   // gullies under the teeth
      brush(seg(j[0], j[1] + 3, j[0] + (k < 3 ? 4 : -4), j[1] + 26, 0.4), 1.2, prog(t, 1.4 + k * 0.04, 0.3), { color: INK, alpha: 0.45, taper: 0.3 });
    });

    // forested foothills with terraced slopes
    var HILLS = [[0, 262], [70, 248], [140, 256], [220, 238], [300, 252], [380, 242], [450, 258], [520, 262], [600, 250], [680, 266], [760, 252], [840, 262], [900, 248], [960, 256]];
    var ha = prog(t, 0.9, 1.0);
    fill(HILLS.concat([[960, 350], [0, 350]]), "#1b1a18", 1, { still: true });
    brush(path(HILLS, 0.8), 2, ha, {});
    treeTops(HILLS, 15, ha, 0.55);
    for (i = 0; i < 7; i++) {   // terraced fields stepping down the slopes
      var tx = i < 4 ? 600 + i * 22 : 420 + (i - 4) * 20, ty = (i < 4 ? 290 : 286) + (i % 4) * 12;
      brush(path([[tx, ty], [tx + 18, ty - 3], [tx + 36, ty]], 0.3), 1.1, prog(t, 1.3 + i * 0.05, 0.4), { alpha: 0.35, taper: 0.3 });
    }

    // Sarangkot's ridge on the left, with houses on its slope; the near shore on the right
    var SARANGKOT = [[0, 214], [50, 204], [110, 210], [170, 226], [240, 256], [300, 290], [350, 322], [384, 350]];
    var sa = prog(t, 1.1, 1.0);
    fill(SARANGKOT.concat([[0, 350]]), INK, 1, { still: true });
    brush(path(SARANGKOT, 0.8), 2.4, sa, {});
    treeTops(SARANGKOT.slice(2), 14, sa, 0.6);
    [[70, 252], [120, 270], [176, 288], [96, 300], [210, 312]].forEach(function (h, k) {
      var hp = prog(t, 1.5 + k * 0.08, 0.3);
      fill(rectPts(h[0], h[1], 14, 9, 0.2), PAPER, hp * 0.75);
      brush(path([[h[0] - 3, h[1] + 1], [h[0] + 7, h[1] - 6], [h[0] + 17, h[1] + 1]], 0.2), 1.6, hp, {});
    });
    var SHORE = [[700, 350], [760, 326], [840, 310], [900, 304], [960, 300]];
    fill(SHORE.concat([[960, 350]]), INK, 1, { still: true });
    brush(path(SHORE, 0.6), 2, prog(t, 1.2, 0.8), {});
    treeTops(SHORE, 13, prog(t, 1.3, 0.8), 0.6);

    // Phewa Lake: Machhapuchhre's reflection, broken by ripples
    brush(seg(0, 350, W, 350, 0.6), 2, prog(t, 0.6, 1.2), {});
    var refl = MACHHA.map(function (p) { return [p[0], 350 + (350 - p[1]) * 0.42]; });
    fill(refl, PAPER, prog(t, 1.6, 0.8) * 0.2, { still: true });
    for (i = 0; i < 7; i++) {
      var ry = 366 + i * 12;
      brush(seg(560 + (i % 3) * 14, ry, 720 - (i % 2) * 20, ry, 0.4), 1.6, prog(t, 1.8 + i * 0.05, 0.4), { color: INK, alpha: 0.55 });
    }
    for (var row = 0; row < 9; row++) {
      var y = 372 + row * 18 + row * row * 0.5, nd = 3 + row;
      for (var d = 0; d < nd; d++) {
        var x0 = R() * W, len = 16 + R() * 44 + row * 5;
        brush(seg(x0, y, x0 + len, y + (R() - 0.5) * 2, 0.4), 1 + row * 0.2, prog(t, 1.0 + row * 0.1 + d * 0.02, 0.35), { alpha: 0.75 });
      }
    }

    // Tal Barahi: the two-tiered temple on its little island
    var ta = prog(t, 1.9, 0.6), cx = 430, cy = 392;
    function T(px, py) { return [cx + px * 1.5, cy + py * 1.5]; }
    fill(arcPts(cx, cy + 3, 52, 10, 0, Math.PI * 2, 0.6), INK, 1, { still: true });
    brush(arcPts(cx, cy + 3, 52, 10, Math.PI, Math.PI * 2, 0.6), 1.8, ta, {});
    treeTops([[cx - 46, cy], [cx - 22, cy - 8]], 9, ta, 0.7);
    treeTops([[cx + 20, cy - 8], [cx + 46, cy]], 9, ta, 0.7);
    fill(closed([T(-8, -2), T(8, -2), T(8, -14), T(-8, -14)], 0.2), PAPER, ta);
    fill(closed([T(-15, -13), T(15, -13), T(8, -22), T(-8, -22)], 0.2), INK, ta);
    brush(closed([T(-15, -13), T(15, -13), T(8, -22), T(-8, -22)], 0.2), 1.6, ta, { taper: 0.05 });
    fill(closed([T(-5, -22), T(5, -22), T(5, -28), T(-5, -28)], 0.2), PAPER, ta);
    fill(closed([T(-10, -27), T(10, -27), T(5, -34), T(-5, -34)], 0.2), INK, ta);
    brush(closed([T(-10, -27), T(10, -27), T(5, -34), T(-5, -34)], 0.2), 1.6, ta, { taper: 0.05 });
    brush(seg(cx, cy - 51, cx, cy - 63, 0.1), 1.8, ta, {});
    fill(closed([T(-6, 4), T(6, 4), T(6, 12), T(-6, 12)], 0.2), PAPER, ta * 0.12);

    // doongas moored by the shore, one far out, and one being rowed across (it drifts)
    doonga(70, 372, 0.55, prog(t, 2.0, 0.4), false, t);
    doonga(126, 380, 0.6, prog(t, 2.1, 0.4), false, t);
    doonga(188, 388, 0.62, prog(t, 2.2, 0.4), false, t);
    doonga(820, 398, 0.5, prog(t, 2.2, 0.4), true, t);
    var bx = 560 + Math.min(t, 16) * 7, by = 462 + Math.sin(t * 1.4) * 2;
    brush(seg(bx - 110, by + 6, bx - 60, by + 6, 0.3), 1.4, prog(t, 2.4, 0.4), { alpha: 0.6 });
    brush(seg(bx - 90, by + 13, bx - 54, by + 13, 0.3), 1.2, prog(t, 2.4, 0.4), { alpha: 0.5 });
    doonga(bx, by, 1.1, prog(t, 1.8, 0.6), true, t);

    // paragliders off Sarangkot (last: they drift)
    [[96, 150, 0.9], [210, 132, 1], [300, 176, 0.75]].forEach(function (g, k) {
      var dx = reduceMotion ? 0 : Math.sin(t * 0.35 + k * 2) * 10, dy = reduceMotion ? 0 : Math.cos(t * 0.5 + k) * 4;
      paraglider(g[0] + dx, g[1] + dy, g[2], prog(t, 2.4 + k * 0.2, 0.5));
    });
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

  // a tree's canopy in ink: a scalloped outline, filled dark, with a few leaf clusters inside
  function canopy(cx, cy, rx, ry, t, t0, clusters) {
    var pts = [], n = Math.max(12, Math.round((rx + ry) / 6));
    for (var i = 0; i < n; i++) {
      var th = ((i + 0.5) / n) * Math.PI * 2, step = (Math.PI * 2) / n;
      var bx = cx + Math.cos(th) * rx, by = cy + Math.sin(th) * ry;
      var br = Math.hypot(Math.cos(th + step / 2) * rx - Math.cos(th - step / 2) * rx, Math.sin(th + step / 2) * ry - Math.sin(th - step / 2) * ry) * (0.5 + R() * 0.35);
      var jr = 1 + (R() - 0.5) * 0.12;
      pts = pts.concat(arcPts(cx + (bx - cx) * jr, cy + (by - cy) * jr, br, br, th - Math.PI / 2 - 0.25, th + Math.PI / 2 + 0.25, 0.3));
    }
    pts.push(pts[0]);
    fill(pts, INK, 1, { still: true });
    brush(pts, 2, prog(t, t0, 1.2), { taper: 0.02 });
    for (var k = 0; k < clusters; k++) {
      var a = R() * Math.PI * 2, d = Math.sqrt(R()) * 0.7, x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d, r = 5 + R() * 6;
      brush(arcPts(x, y, r, r * 0.75, Math.PI * 1.1, Math.PI * 1.9, 0.2), 1.2, prog(t, t0 + 0.6 + R() * 0.6, 0.3), { alpha: 0.45, taper: 0.3 });
    }
  }

  function sSchool(t) {
    // Shivapuri: the forested mountain right behind the campus, with low cloud on its shoulder
    var ridgeKnots = [[0, 196], [70, 170], [150, 150], [230, 138], [300, 144], [370, 158], [440, 168], [520, 186], [600, 196], [700, 200], [780, 186], [860, 170], [960, 160]];
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
    fill(hills.concat([[960, 420], [0, 420]]), INK, 1, { still: true });
    brush(hills, 2.4, prog(t, 0.3, 1.4), {});
    treeTops(ridgeKnots, 13, prog(t, 0.5, 1.2), 0.55);
    for (var row = 0; row < 7; row++) {                     // rows of treetops following the slope
      for (var col = 0; col < 29; col++) {
        var fx = col * 34 + (row % 2) * 17 + (R() - 0.5) * 14, fy = ridgeAt(fx) + 18 + row * 26 + (R() - 0.5) * 10, fr = 4 + R() * 3;
        brush(arcPts(fx, fy, fr, fr * 0.85, Math.PI * 1.05, Math.PI * 1.95, 0.2), 1.1,
          fy < 380 ? prog(t, 0.7 + row * 0.12 + R() * 0.4, 0.3) : 0, { alpha: 0.45 - row * 0.03, taper: 0.3 });
      }
    }
    [[120, 160, 70, 300], [260, 146, 230, 290], [420, 166, 450, 300], [760, 190, 730, 300], [880, 172, 900, 300]].forEach(function (rv, k) {   // ravines
      brush(path([[rv[0], rv[1] + 6], [lerp(rv[0], rv[2], 0.5) + 8, lerp(rv[1], rv[3], 0.5)], [rv[2], rv[3]]], 0.6), 1.6, prog(t, 1.0 + k * 0.1, 0.6), { alpha: 0.4, dry: 0.6 });
    });
    var drift = reduceMotion ? 0 : Math.sin(t * 0.25) * 24;    // mist and low cloud drifting across the slopes
    [[560, 176, 960, 16], [-20, 150, 300, 14], [40, 232, 380, 11], [300, 258, 700, 10], [600, 236, 960, 11], [-20, 288, 300, 9]].forEach(function (m, k) {
      var dd = drift * (k % 2 ? -1 : 1), mid = (m[0] + m[2]) / 2;
      brush(path([[m[0] + dd, m[1] + 3], [mid - 60 + dd, m[1] - 4], [mid + 50 + dd, m[1] + 5], [m[2] + dd, m[1] - 2]], 0.8), m[3], prog(t, 1.6 + k * 0.2, 1.2), { alpha: k < 2 ? 0.14 : 0.09, dry: 1, still: true, taper: 0.5 });
    });

    // a big shade tree behind the left building
    brush(path([[150, 360], [146, 320], [150, 300]], 0.4), 7, prog(t, 0.6, 0.5), { taper: 0.2 });
    canopy(150, 272, 104, 52, t, 0.7, 8);

    // the Saraswati temple among tall pines: a stepped brick plinth, then a two-tiered roof with a fringe
    pine(392, 352, 170, t, 0.6);
    pine(420, 354, 128, t, 0.7);
    pine(560, 352, 150, t, 0.8);
    var pg = prog(t, 1.2, 0.7), gx = 486, gy = 352, gs = 1.15;
    function G(x, y) { return [gx + x * gs, gy + y * gs]; }
    function Gl(list) { return list.map(function (p) { return G(p[0], p[1]); }); }
    [[-44, -8, 88, 8], [-36, -16, 72, 8], [-28, -22, 56, 6]].forEach(function (pl) {
      var r = Gl([[pl[0], pl[1]], [pl[0] + pl[2], pl[1]], [pl[0] + pl[2], pl[1] + pl[3]], [pl[0], pl[1] + pl[3]], [pl[0], pl[1]]]);
      fill(r, INK, 1, { still: true });
      brush(r, 1.6, pg, { taper: 0.02 });
    });
    for (var st = 0; st < 4; st++) brush(Gl([[-7, -20 + st * 5.5], [7, -20 + st * 5.5]]), 1.2, pg, { alpha: 0.8, taper: 0 });
    fill(Gl([[-16, -50], [16, -50], [16, -22], [-16, -22]]), PAPER, pg * 0.22);
    brush(Gl([[-16, -22], [-16, -50], [16, -50], [16, -22]]), 1.6, pg, { taper: 0.02 });
    brush(Gl([[-6, -22], [-6, -42], [6, -42], [6, -22]]), 1.3, pg, { taper: 0.02 });
    [[-36, -50, 36, -50, 20, -62], [-24, -72, 24, -72, 11, -83]].forEach(function (rf) {
      var poly = Gl([[rf[0], rf[1]], [rf[2], rf[3]], [rf[4], rf[5]], [-rf[4], rf[5]], [rf[0], rf[1]]]);
      fill(poly, PAPER, pg * 0.85);
      brush(poly, 1.6, pg, { taper: 0.02 });
      for (var fr = rf[0] + 3; fr < rf[2] - 1; fr += 4) brush(Gl([[fr, rf[1] + 0.5], [fr, rf[1] + 5]]), 1.1, pg, { alpha: 0.8, taper: 0.1 });   // the fringe
    });
    fill(Gl([[-11, -72], [11, -72], [11, -62], [-11, -62]]), INK, pg);
    brush(Gl([[-11, -62], [-11, -72], [11, -72], [11, -62]]), 1.4, pg, { taper: 0.02 });
    brush(Gl([[0, -83], [0, -96]]), 2.2, pg, { taper: 0.2 });
    fill(circlePts(G(0, -97)[0], G(0, -97)[1], 2.6, 0.1), PAPER, pg);

    // another long red-roofed block at the end of the road (partly behind the trees)
    var b2 = prog(t, 1.0, 0.8);
    var roof2 = closed([[552, 344], [574, 326], [692, 326], [712, 344]], 0.5);
    fill(roof2, INK, 1, { still: true });
    brush(roof2, 2.2, b2, { taper: 0.02 });
    for (var h2 = 0; h2 < 8; h2++) brush(seg(584 + h2 * 14, 329, 576 + h2 * 15, 342, 0.2), 1.2, prog(t, 1.3 + h2 * 0.04, 0.2), { alpha: 0.7 });
    fill(rectPts(560, 344, 144, 38, 0.4), INK, 1, { still: true });
    brush(rectPts(560, 344, 144, 38, 0.4), 1.8, b2, { taper: 0.02 });
    brush(seg(560, 347, 704, 347, 0.2), 1.8, prog(t, 1.3, 0.5), { alpha: 0.9 });
    for (var w2 = 0; w2 < 5; w2++) brush(rectPts(570 + w2 * 26, 354, 14, 16, 0.2), 1.2, prog(t, 1.5 + w2 * 0.05, 0.3), { taper: 0.02 });

    // the long red-roofed brick block on the left, with a trimmed hedge in front
    var rb = prog(t, 0.9, 0.8);
    var roof1 = closed([[28, 352], [62, 326], [302, 326], [330, 352]], 0.5);
    fill(roof1, INK, 1, { still: true });
    brush(roof1, 2.4, rb, { taper: 0.02 });
    for (var hr = 0; hr < 16; hr++) brush(seg(72 + hr * 15, 330, 62 + hr * 16, 349, 0.2), 1.3, prog(t, 1.2 + hr * 0.03, 0.2), { alpha: 0.75 });
    fill(rectPts(38, 352, 282, 44, 0.4), INK, 1, { still: true });
    brush(rectPts(38, 352, 282, 44, 0.4), 2, rb, { taper: 0.02 });
    brush(seg(38, 355, 320, 355, 0.3), 2.2, prog(t, 1.2, 0.6), { alpha: 0.9 });             // white trim under the eaves
    for (var bc = 0; bc < 12; bc++) {                                                         // brick coursing
      var bcx = 44 + R() * 260, bcy = 364 + R() * 26;
      brush(seg(bcx, bcy, bcx + 10 + R() * 12, bcy, 0.1), 1, prog(t, 1.5 + R() * 0.5, 0.3), { alpha: 0.3, taper: 0.2 });
    }
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

    // a big shade tree on the right of the road
    brush(path([[930, 490], [918, 420], [904, 350], [890, 290]], 0.8), 11, prog(t, 1.0, 0.8), { taper: 0.25 });
    brush(path([[906, 340], [860, 300], [830, 286]], 0.6), 4, prog(t, 1.2, 0.6), { taper: 0.3 });
    brush(path([[912, 380], [950, 330], [960, 318]], 0.6), 4, prog(t, 1.2, 0.6), { taper: 0.3 });
    canopy(812, 270, 74, 48, t, 0.8, 6);
    canopy(946, 300, 60, 52, t, 0.85, 5);
    canopy(880, 226, 108, 72, t, 0.7, 10);

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
    var wx = 104, wy = 248, ww = 220, wh = 132;
    stars(16, wx + 12, wy + 12, wx + ww - 12, wy + wh - 12, t, 0.3);
    fill(circlePts(wx + 160, wy + 40, 18, 0.4), PAPER, prog(t, 0.6, 0.5));
    fill(circlePts(wx + 168, wy + 34, 16, 0.4), INK, prog(t, 0.6, 0.5));
    brush(rectPts(wx, wy, ww, wh, 0.8), 3.4, prog(t, 0.1, 1.2), { taper: 0.03 });
    brush(seg(wx + ww / 2, wy, wx + ww / 2, wy + wh, 0.6), 2.4, prog(t, 0.8, 0.5), {});
    brush(seg(wx, wy + wh / 2, wx + ww, wy + wh / 2, 0.6), 2.4, prog(t, 0.9, 0.5), {});

    var ccx = 892, ccy = 150;
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

  // ---------------------------------------------------------------- a monitor's stand, and the desk it sits on
  function monitorDesk(cx, winBottom, deskY, t, x0, x1) {
    var a = prog(t, 0.1, 0.8);
    fill(rectPts(cx - 16, winBottom, 32, deskY - winBottom - 5, 0.2), INK, 1, { still: true });
    brush(rectPts(cx - 16, winBottom, 32, deskY - winBottom - 5, 0.2), 1.6, a, { taper: 0.03 });
    brush(path([[cx - 62, deskY], [cx - 50, deskY - 6], [cx + 50, deskY - 6], [cx + 62, deskY]], 0.3), 2, a, { taper: 0.05 });
    brush(seg(x0, deskY, x1, deskY, 0.6), 2.4, prog(t, 0.1, 1), { taper: 0.03 });
  }

  // ---------------------------------------------------------------- scene 6: DiatoMeter
  // Drawn after the app's results screen: an SEM image of Didymo frustules (club-shaped glass shells) on a mat
  // of debris. A scan sweeps across, and the app traces each shell in colour: green intact, amber cracked,
  // red fragmented, grey cut by the image edge. A side panel counts them and fills the stacked bar.
  var MX = 494, MY = 86, MS = 330;                                    // the micrograph square
  var D_GREEN = "#6dbb73", D_AMBER = "#e4a93c", D_RED = "#e05a45", D_GREY = "#9a968c";
  // half-width along the shell, foot (-1) to head (1): a broad body, a pinched neck, then a round head
  var CLUB = [[-1, 0.06], [-0.7, 0.095], [-0.25, 0.13], [0.15, 0.12], [0.42, 0.07], [0.7, 0.125], [1, 0.09]];
  function clubPts(f, grow) {
    var A = [], B = [], n = 22, uEnd = f.cut || 1;
    for (var i = 0; i <= n; i++) {
      var u = -Math.cos((Math.PI * i) / n), w = 0;
      if (u > uEnd) break;
      for (var k = 0; k < CLUB.length - 1; k++) {
        if (u <= CLUB[k + 1][0]) { w = lerp(CLUB[k][1], CLUB[k + 1][1], (u - CLUB[k][0]) / (CLUB[k + 1][0] - CLUB[k][0])); break; }
      }
      w *= Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 6))) * f.L * grow;
      var al = (u * f.L * grow) / 2 * (f.flip ? -1 : 1);
      A.push([al, w]); B.push([al, -w]);
    }
    var poly = A;
    if (f.cut) {                                                       // a broken shell: a jagged end
      var e = A[A.length - 1][0], h = A[A.length - 1][1], d = f.flip ? -1 : 1;
      poly = poly.concat([[e + 4 * d, h * 0.4], [e - 2 * d, 0], [e + 3 * d, -h * 0.5]]);
    }
    poly = poly.concat(B.reverse());
    var ca = Math.cos(f.a), sa = Math.sin(f.a);
    return poly.map(function (p) { return [f.x + p[0] * ca - p[1] * sa, f.y + p[0] * sa + p[1] * ca]; });
  }
  var FRUST = null;
  function frustules() {
    if (FRUST) return FRUST;
    var r = mulberry32(2026), shells = [], bits = [], dust = [], tries = 0, i;
    while (shells.length < 44 && tries++ < 6000) {
      var L = 52 + r() * 34, x = MX - 8 + r() * (MS + 16), y = MY - 8 + r() * (MS + 16);
      var ok = shells.every(function (f) { return Math.hypot(f.x - x, f.y - y) > (f.L + L) * 0.29; });
      if (ok) shells.push({ x: x, y: y, L: L, a: r() * Math.PI, flip: r() < 0.5 });
    }
    shells.forEach(function (f, k) {
      var kind = k % 10;
      f.status = kind === 0 || kind === 6 ? "intact" : kind === 3 || kind === 8 || kind === 5 ? "cracked" : "fragmented";
      if (f.status === "fragmented") f.cut = 0.15 + r() * 0.5;
      f.poly = clubPts(f, 1);
      f.trace = clubPts(f, 1.12);
      if (f.poly.some(function (p) { return p[0] < MX || p[0] > MX + MS || p[1] < MY || p[1] > MY + MS; })) f.status = "edge";
      f.crack = [];
      if (f.status === "cracked") {                                    // a zigzag crack across the shell
        var ca = Math.cos(f.a), sa = Math.sin(f.a), at = (r() - 0.5) * f.L * 0.5;
        for (var c = -2; c <= 2; c++) {
          var al = at + (c % 2 ? 3 : -3), ac = c * f.L * 0.03;
          f.crack.push([f.x + al * ca - ac * sa, f.y + al * sa + ac * ca]);
        }
      }
    });
    for (i = 0; i < 18; i++) {                                         // loose fragments
      var bx = MX + 10 + r() * (MS - 20), by = MY + 10 + r() * (MS - 20), br = 4 + r() * 6, pts = [];
      for (var j = 0; j < 6; j++) { var ang = (j / 6) * Math.PI * 2 + r() * 0.5, rr = br * (0.6 + r() * 0.5); pts.push([bx + Math.cos(ang) * rr, by + Math.sin(ang) * rr]); }
      bits.push({ x: bx, poly: pts, status: "fragmented" });
    }
    for (i = 0; i < 170; i++) dust.push([MX + r() * MS, MY + r() * MS, r() * Math.PI, 2 + r() * 6]);
    var all = shells.concat(bits).sort(function (p, q) { return p.x - q.x; });   // traced left to right, like the scan
    return (FRUST = { shells: shells, bits: bits, dust: dust, all: all });
  }
  function statusColor(s) { return s === "intact" ? D_GREEN : s === "cracked" ? D_AMBER : s === "edge" ? D_GREY : D_RED; }

  function sMicro(t) {
    var F = frustules(), i, m0 = 2.4, mDur = 3.4;
    // a desktop electron microscope on the bench, cabled to the laptop
    var sa = prog(t, 0.2, 0.9);
    brush(seg(30, 500, 940, 500, 0.6), 2, prog(t, 0.1, 1), { alpha: 0.8 });
    fill(rectPts(110, 420, 214, 80, 0.6), INK, 1, { still: true });
    brush(rectPts(110, 420, 214, 80, 0.6), 2.2, sa, { taper: 0.02 });                   // the vacuum chamber
    fill(rectPts(190, 330, 52, 90, 0.4), INK, 1, { still: true });
    brush(rectPts(190, 330, 52, 90, 0.4), 2.2, prog(t, 0.4, 0.7), { taper: 0.02 });    // the electron column
    brush(seg(190, 356, 242, 356, 0.2), 1.4, prog(t, 0.6, 0.4), { alpha: 0.8 });
    brush(seg(190, 386, 242, 386, 0.2), 1.4, prog(t, 0.65, 0.4), { alpha: 0.8 });
    brush(rectPts(182, 316, 68, 16, 0.3), 2, prog(t, 0.7, 0.4), { taper: 0.03 });     // its cap
    brush(rectPts(140, 440, 92, 48, 0.4), 1.6, prog(t, 0.6, 0.5), { taper: 0.03 });   // the sample door
    brush(seg(222, 456, 222, 474, 0.1), 3, prog(t, 0.8, 0.3), {});
    fill(circlePts(296, 440, 5, 0.1), PAPER, prog(t, 0.8, 0.3) * 0.8);                 // power light
    brush(path([[324, 474], [400, 490], [450, 474], [482, 440]], 0.6), 2, prog(t, 0.9, 0.7), { alpha: 0.8 });   // the cable
    // the app window
    var wa = prog(t, 0.1, 0.8);
    fill(rectPts(480, 40, 456, 406, 0.6), "#171614", wa, { still: true });
    brush(rectPts(480, 40, 456, 406, 0.8), 2, wa, { taper: 0.02 });
    brush(seg(480, 66, 936, 66, 0.4), 1.4, wa, { alpha: 0.7 });
    for (i = 0; i < 3; i++) fill(circlePts(496 + i * 13, 53, 3.6, 0.1), PAPER, wa * 0.7);

    // the micrograph: a grainy mat of debris with the shells on top
    var ma = prog(t, 0.4, 0.6);
    fill(rectPts(MX, MY, MS, MS, 0.3), "#3a3833", ma, { still: true });
    ctx.save();
    ctx.beginPath(); ctx.rect(MX, MY, MS, MS); ctx.clip();
    F.dust.forEach(function (d) {
      brush(seg(d[0], d[1], d[0] + Math.cos(d[2]) * d[3], d[1] + Math.sin(d[2]) * d[3], 0.2), 1.3, ma, { alpha: 0.3, taper: 0.3 });
    });
    F.shells.forEach(function (f, k) {
      var fa = prog(t, 0.6 + (k / F.shells.length) * 1.2, 0.4);
      fill(f.poly, "#b9b3a6", fa * 0.85);
      brush(f.poly.concat([f.poly[0]]), 1.3, fa, { alpha: 0.9, taper: 0.02 });
      // the raphe: the slit running down the middle of the shell
      var ca = Math.cos(f.a), sa = Math.sin(f.a), d = (f.flip ? -1 : 1) * f.L / 2, u0 = -0.8, u1 = f.cut ? f.cut - 0.12 : 0.8;
      brush(seg(f.x + ca * u0 * d, f.y + sa * u0 * d, f.x + ca * u1 * d, f.y + sa * u1 * d, 0.2), 1, fa, { color: INK, alpha: 0.45, taper: 0.2 });
      if (f.crack.length) brush(f.crack, 1.4, fa, { color: INK, alpha: 0.8, taper: 0.1 });
    });
    F.bits.forEach(function (b, k) { fill(b.poly, "#a39d91", prog(t, 1.2 + k * 0.05, 0.3) * 0.8); });

    // the scan, and the coloured traces it leaves behind
    var counted = { intact: 0, cracked: 0, fragmented: 0, edge: 0 }, done = 0;
    F.all.forEach(function (f) {
      var poly = f.trace || f.poly, at = m0 + clamp01((f.x - MX) / MS) * mDur, tp = prog(t, at, 0.35);
      brush(poly.concat([poly[0]]), 2, tp, { color: statusColor(f.status), taper: 0.02, boil: 0.5 });
      if (tp >= 1) { counted[f.status]++; done++; }
    });
    var sweep = prog(t, m0, mDur);
    if (sweep > 0 && sweep < 1) {
      ctx.globalAlpha = 0.55; ctx.fillStyle = PAPER;
      ctx.fillRect(lerp(MX, MX + MS, sweep), MY, 2, MS);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    brush(rectPts(MX, MY, MS, MS, 0.4), 1.4, ma, { taper: 0.02, alpha: 0.8 });

    // the side panel: how many, and what state they're in
    var pa = prog(t, 1.6, 0.5), total = F.all.length, px = 840, pw = 84;
    hand("frustules", px, 106, 17, PAPER, "left", pa * 0.75);
    hand(String(Math.round((136 * done) / total)), px, 150, 42, PAPER, "left", pa);
    brush(seg(px, 186, px + pw, 186, 0.1), 9, pa, { alpha: 0.18, taper: 0, still: true });
    var bx = px;
    ctx.globalAlpha = pa;
    ["intact", "cracked", "fragmented", "edge"].forEach(function (s) {
      var bw = (pw * counted[s]) / total;
      ctx.fillStyle = statusColor(s);
      ctx.fillRect(bx, 182, bw, 8);
      bx += bw;
    });
    ctx.globalAlpha = 1;
    [["intact", "intact"], ["cracked", "cracked"], ["fragmented", "fragmented"], ["edge", "cut by edge"]].forEach(function (s, k) {
      var ly = 216 + k * 22;
      fill(circlePts(px + 5, ly - 5, 4.5, 0.1), statusColor(s[0]), pa);
      hand(s[1], px + 16, ly, 15, PAPER, "left", pa * 0.85);
    });
    hand("sample", px, 340, 14, PAPER, "left", pa * 0.6);
    hand("didymo", px, 362, 22, PAPER, "left", pa * prog(t, m0 + mDur * 0.5, 0.4));
    hand(Math.min(15, Math.round(sweep * 15)) + " s", px, 410, 22, PAPER, "left", pa * 0.8);
  }

  // ---------------------------------------------------------------- scene 7: the road on
  function sEnd(t) {
    stars(50, 0, 0, W, 230, t, 0);
    var ridge = RIDGE.map(function (p) { return [350 + p[0] * 0.47, 190 + p[1] * 0.55]; });
    fill(path(ridge, 0.6).concat([[914, 292], [350, 292]]), INK, 1, { still: true });
    brush(path(ridge, 0.6), 2.4, prog(t, 0.2, 1.8), {});
    snow(ridge, t, 1.2, 0.6, 236);
    brush(seg(0, 292, W, 292, 0.6), 1.6, prog(t, 0.3, 1.2), { alpha: 0.8 });

    var roadPts = path([[620, 560], [580, 500], [670, 440], [605, 380], [655, 330], [628, 292]], 1.2);
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

  // Drawn after the Nepalingo app: a dark screen with the "Nepal·ingo" logo, a greeting and a streak badge,
  // an indigo flashcard that flips to its meaning, a multiple-choice quiz, the floral activity cards on the
  // home page, and the crimson bird mascot. Eleven merged pull requests run along the bottom.
  var N_RED = "#d8364a", N_BLUE = "#4a42d4", N_GREEN = "#6dbb73";
  var N_FLOWERS = ["#c8743a", "#2f8f8a", "#b8443c", "#d9a441"];
  function rectLine(x, y, w, h, n) {   // a rectangle as a fixed number of points (no randomness), for shapes that change size
    var pts = [], c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    for (var e = 0; e < 4; e++) for (var i = 0; i < n; i++) pts.push([lerp(c[e][0], c[e + 1][0], i / n), lerp(c[e][1], c[e + 1][1], i / n)]);
    pts.push([x, y]);
    return pts;
  }

  function sCards(t) {
    var i;
    // the mascot: Nepalingo's bird, drawn after the app's own artwork (coordinates are in that image's pixels)
    var ba = prog(t, 0.3, 0.8), ms = 0.18, mox = 330, moy = 486;
    function M(x, y) { return [mox + (x - 790) * ms, moy + (y - 1273) * ms]; }
    function Mc(x, y, r) { var c = M(x, y); return circlePts(c[0], c[1], r * ms, 0.1); }
    function capsule(x1, y1, x2, y2, w) {   // a rounded bar, in image pixels
      var a = Math.atan2(y2 - y1, x2 - x1), r = w / 2, pts = [], k;
      for (k = 0; k <= 10; k++) { var q = a - Math.PI / 2 - (Math.PI * k) / 10; pts.push(M(x1 + Math.cos(q) * r, y1 + Math.sin(q) * r)); }
      for (k = 0; k <= 10; k++) { var q2 = a + Math.PI / 2 - (Math.PI * k) / 10; pts.push(M(x2 + Math.cos(q2) * r, y2 + Math.sin(q2) * r)); }
      return pts;
    }
    function halfDisc(cx, cy, r) {          // the half of a disc below a chord tilted like the bird's back
      var a0 = Math.atan2(-252, 556), pts = [];
      for (var k = 0; k <= 30; k++) { var q = a0 + (Math.PI * k) / 30; pts.push(M(cx + Math.cos(q) * r, cy + Math.sin(q) * r)); }
      return pts;
    }
    var BLOB = [[890, 232], [1120, 290], [1290, 470], [1362, 720], [1300, 960], [1060, 1170], [760, 1310], [470, 1270], [280, 1120], [212, 910], [290, 690], [500, 500], [700, 320]], blob = [];
    for (i = 0; i < BLOB.length; i++) {      // a smooth closed curve through the blob's points
      var p0 = BLOB[(i - 1 + BLOB.length) % BLOB.length], p1 = BLOB[i], p2 = BLOB[(i + 1) % BLOB.length], p3 = BLOB[(i + 2) % BLOB.length];
      for (var sgi = 0; sgi < 8; sgi++) {
        var uu = sgi / 8, u2 = uu * uu, u3 = u2 * uu;
        blob.push(M(0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * uu + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
                    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * uu + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)));
      }
    }
    var CRIMSON = "#b33640", BLACK = "#1b1b1b";
    fill(blob, "#f7d7e5", ba);
    fill(capsule(752, 1030, 757, 1190, 64), CRIMSON, ba);              // legs
    fill(capsule(882, 980, 886, 1132, 64), CRIMSON, ba);
    fill(capsule(744, 1254, 838, 1254, 40), BLACK, ba);               // feet
    fill(capsule(882, 1197, 978, 1197, 40), BLACK, ba);
    fill(halfDisc(718, 684, 365), CRIMSON, ba);                        // the body
    fill([M(944, 300), M(1066, 300), M(1066, 600), M(944, 600)], CRIMSON, ba);   // the neck
    fill(halfDisc(655, 649, 305), BLACK, ba);                          // the wing
    fill(Mc(1015, 312, 76), CRIMSON, ba);                              // the head
    fill([M(1060, 296), M(1112, 300), M(1148, 322), M(1074, 334)], BLACK, ba);   // the beak
    fill(Mc(1074, 315, 20), BLACK, ba);
    fill(Mc(990, 284, 45), "#ffffff", ba);                             // the big eye
    fill(Mc(996, 326, 28), CRIMSON, ba);                               // its lower lid
    var look = reduceMotion ? 0 : Math.sin(t * 0.9) * 5;
    fill(Mc(992 + look, 286, 22), BLACK, ba);
    fill(Mc(982 + look, 276, 8), "#ffffff", ba);
    brush([M(936, 278), M(940, 258), M(958, 238)], 1.4, ba, { color: BLACK, taper: 0.2 });   // an eyelash
    brush([M(1022, 346), M(1036, 354), M(1050, 346)], 1.4, ba, { color: BLACK, taper: 0.2 }); // a smile
    [[1050, 245, 927, 128], [1046, 246, 896, 159], [1040, 248, 875, 189]].forEach(function (c) {   // the crest
      var pts = [];
      for (var k = 0; k <= 8; k++) { var w = k / 8; pts.push(M(lerp(c[0], c[2], w) + Math.sin(w * Math.PI) * 30, lerp(c[1], c[3], w) - Math.sin(w * Math.PI) * 26)); }
      brush(pts, 1.2, ba, { color: CRIMSON, taper: 0.1 });
    });

    // the app window, on a monitor stand on the desk
    monitorDesk(708, 440, 486, t, 60, 940);
    var wa = prog(t, 0.1, 0.8);
    fill(rectPts(480, 36, 456, 404, 0.6), "#171614", wa, { still: true });
    brush(rectPts(480, 36, 456, 404, 0.8), 2, wa, { taper: 0.02 });
    brush(seg(480, 76, 936, 76, 0.4), 1.4, wa, { alpha: 0.6 });
    ctx.font = "700 22px " + HAND;
    hand("Nepal", 498, 64, 22, PAPER, "left", wa);
    hand("ingo", 498 + ctx.measureText("Nepal").width, 64, 22, N_RED, "left", wa);
    brush(rectPts(852, 48, 66, 20, 0.3), 1.2, wa, { taper: 0.03, alpha: 0.7 });
    hand("newari ▾", 860, 63, 13, PAPER, "left", wa * 0.85);

    // greeting and the streak badge
    var ga = prog(t, 0.6, 0.4);
    hand("good evening!", 500, 104, 17, PAPER, "left", ga);
    fill(rectPts(794, 88, 124, 24, 0.3), N_RED, ga);
    hand("keep going!", 806, 105, 14, PAPER, "left", ga);

    // the quiz
    var qa = prog(t, 1.4, 0.5);
    brush(rectPts(676, 122, 244, 200, 0.5), 1.4, qa, { taper: 0.03, alpha: 0.5 });
    hand("section · introductions", 798, 144, 14, N_RED, "center", qa);
    hand("progress: 1 of 24", 798, 162, 12, N_GREEN, "center", qa);
    hand("what is this word in english?", 798, 194, 15, PAPER, "center", qa);
    hand("नमस्कार", 798, 226, 24, N_RED, "center", qa);
    var picked = prog(t, 4.6, 0.3);
    [["a. hello", 690, 240], ["b. bye", 802, 240], ["c. no", 690, 278], ["d. today", 802, 278]].forEach(function (o, k) {
      var oa = prog(t, 1.8 + k * 0.12, 0.3);
      fill(rectPts(o[1], o[2], 104, 30, 0.3), N_GREEN, k === 0 ? picked * 0.35 : 0);
      brush(rectPts(o[1], o[2], 104, 30, 0.3), 1.3, oa, { color: k === 0 && picked > 0 ? N_GREEN : PAPER, taper: 0.03, alpha: 0.8 });
      hand(o[0], o[1] + 52, o[2] + 20, 14, PAPER, "center", oa);
    });

    // the activity cards on the home page, with their floral pattern
    [["flash cards", 500], ["dictionary", 640], ["test yourself", 780]].forEach(function (c, k) {
      var aa = prog(t, 2.2 + k * 0.15, 0.4), cx0 = c[1];
      fill(rectPts(cx0, 362, 132, 64, 0.3), "#24221f", aa);
      for (var f = 0; f < 4; f++) {
        var fx = cx0 + 18 + f * 32 + (f % 2) * 6, fy = 378 + (f % 2) * 18, col = N_FLOWERS[(f + k) % 4];
        for (var pe = 0; pe < 5; pe++) {
          var ang = (pe / 5) * Math.PI * 2;
          fill(circlePts(fx + Math.cos(ang) * 6, fy + Math.sin(ang) * 6, 4.5, 0.1), col, aa * 0.55);
        }
        fill(circlePts(fx, fy, 3, 0.1), "#e8d9a0", aa * 0.6);
      }
      brush(rectPts(cx0, 362, 132, 64, 0.3), 1.2, aa, { taper: 0.03, alpha: 0.7 });
      hand(c[0], cx0 + 8, 418, 13, PAPER, "left", aa);
      fill(rectPts(cx0 + 92, 404, 32, 16, 0.2), N_RED, aa);
    });

    // eleven merged pull requests
    brush(seg(500, 526, 920, 526, 0.4), 2, prog(t, 2.8, 1.2), {});
    for (var m = 0; m < 11; m++) {
      var mx = 516 + m * 38, mp = prog(t, 3.0 + m * 0.12, 0.25);
      brush(path([[mx - 20, 507], [mx - 7, 510], [mx, 522]], 0.2), 1.6, mp, { alpha: 0.8 });
      fill(circlePts(mx, 526, 4.5, 0.2), PAPER, mp);
    }

    // the flashcard's buttons: don't know / show / know it
    var ua = prog(t, 1.2, 0.4);
    [[552, N_RED, -1], [580, D_GREY, 0], [608, N_GREEN, 1]].forEach(function (b) {
      fill(circlePts(b[0], 344, 11, 0.1), PAPER, ua);
      if (b[2]) brush(path([[b[0] - 5, 344 + 3 * b[2]], [b[0], 344 - 3 * b[2]], [b[0] + 5, 344 + 3 * b[2]]], 0.1), 2.4, ua, { color: b[1], taper: 0.1 });
      else { brush(arcPts(b[0], 344, 6, 3.5, 0, Math.PI * 2, 0.05), 1.4, ua, { color: b[1], taper: 0 }); fill(circlePts(b[0], 344, 1.8, 0.05), b[1], ua); }
    });

    // the streak flame flickers (its shape moves, so it comes late and uses no randomness)
    var fk = reduceMotion ? 0 : Math.sin(t * 7) * 1.5;
    fill([[908 + fk, 91], [914, 98], [915, 105], [908, 110], [901, 105], [903, 97]], "#ffd27a", ga);

    // the flashcard flips over (its width changes, so it comes last and uses no randomness)
    var fp = prog(t, 3.2, 0.6), sx = Math.abs(Math.cos(fp * Math.PI)), showBack = fp > 0.5;
    var fw = 140 * Math.max(0.04, sx), ca = prog(t, 0.8, 0.4), inside = ca * (sx > 0.55 ? 1 : 0);
    var card = rectLine(580 - fw / 2, 122, fw, 196, 8);
    if (!showBack) {
      fill(card, N_BLUE, ca);
      hand("do", 580, 232, 40, PAPER, "center", inside);
    } else {
      fill(card, PAPER, ca);
      fill(rectLine(580 - fw / 2, 122, fw, 64, 8), N_BLUE, ca);
      hand("do", 580, 156, 26, PAPER, "center", inside);
      hand("याये", 580, 178, 15, PAPER, "center", inside);
      hand("newari: याये", 580, 236, 15, INK, "center", inside);
      hand("english: do", 580, 258, 15, INK, "center", inside);
    }
    brush(card, 1.6, prog(t, 0.8, 0.6), { taper: 0.02, alpha: 0.6 });
  }

  // ---------------------------------------------------------------- walden.life, drawn after the site
  // A day's page on the screen, turning one day at a time, and the site's map of Walden Pond pinned on the wall
  // beside it: the pond's coves, the woods around it, the railroad, and Thoreau's cabin site.
  var W_OLIVE = "#5f6e40", W_GREY = "#8a857b";
  var WALDEN_DAYS = [
    ["day 1", "Friday, July 4, 1845", ["thoreau moves into his unfinished cabin", "at walden pond on independence day."]],
    ["day 2", "Saturday, July 5, 1845", ["first full day at the pond."]],
    ["day 3", "Sunday, July 6, 1845", ["first morning waking at walden."]]
  ];
  var POND = [[42, 120], [50, 96], [72, 84], [95, 88], [110, 96], [104, 74], [112, 60], [130, 52], [150, 44], [172, 52], [190, 62],
    [206, 58], [226, 56], [244, 66], [254, 82], [258, 100], [270, 104], [284, 112], [286, 128], [276, 140], [262, 138], [256, 146],
    [260, 162], [252, 176], [236, 180], [222, 172], [212, 160], [196, 152], [176, 148], [156, 140], [136, 130], [116, 124], [100, 136],
    [84, 148], [64, 150], [48, 140]].map(function (p) { return [p[0] * 0.86 + 12, p[1] * 0.86 + 12]; });
  function inPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i][1] > y) !== (poly[j][1] > y) && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
    }
    return inside;
  }
  function serif(str, x, y, size, color, alpha, italic, align) {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.font = (italic ? "italic " : "") + size + "px Georgia, 'Times New Roman', serif";
    ctx.fillStyle = color;
    ctx.textAlign = align || "left";
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  function sWaldenLife(t) {
    var i;
    // the map, pinned on the wall
    var mpa = prog(t, 0.3, 0.6), MX0 = 148, MY0 = 272, MSc = 0.86, MR = -0.03;
    function Mp(x, y) { var px = x * MSc, py = y * MSc; return [MX0 + px * Math.cos(MR) - py * Math.sin(MR), MY0 + px * Math.sin(MR) + py * Math.cos(MR)]; }
    function Ml(list) { return list.map(function (p) { return Mp(p[0], p[1]); }); }
    fill(Ml([[0, 0], [300, 0], [300, 200], [0, 200]]), "#efe6cf", mpa);
    brush(Ml([[0, 0], [300, 0], [300, 200], [0, 200], [0, 0]]), 1.6, mpa, { taper: 0.02 });
    for (i = 0; i < 90; i++) {                                     // the woods, as little tree marks
      var tx = 8 + R() * 284, ty = 8 + R() * 184, tr = 3 + R() * 2.5;
      if (inPoly(tx, ty, POND) || inPoly(tx, ty + 6, POND)) continue;
      var tc = Mp(tx, ty);
      brush(arcPts(tc[0], tc[1], tr * MSc, tr * MSc * 0.85, Math.PI * 0.9, Math.PI * 2.1, 0.2), 1.1, prog(t, 0.8 + i * 0.008, 0.3), { color: "#6f7d52", alpha: 0.8, taper: 0.2 });
    }
    brush(path(Ml([[0, 58], [60, 38], [140, 24], [220, 28], [300, 48]]), 0.4), 1.2, prog(t, 0.7, 0.6), { color: "#7a6a52", alpha: 0.8 });   // the road to Concord
    var rail = Ml([[268, 200], [300, 92]]);
    brush(seg(rail[0][0] - 3, rail[0][1], rail[1][0] - 3, rail[1][1], 0.2), 1, prog(t, 0.9, 0.5), { color: INK, alpha: 0.8, taper: 0 });
    brush(seg(rail[0][0] + 3, rail[0][1], rail[1][0] + 3, rail[1][1], 0.2), 1, prog(t, 0.9, 0.5), { color: INK, alpha: 0.8, taper: 0 });
    for (i = 0; i < 12; i++) {                                     // the railroad's ties
      var rp = [lerp(rail[0][0], rail[1][0], (i + 0.5) / 12), lerp(rail[0][1], rail[1][1], (i + 0.5) / 12)];
      brush(seg(rp[0] - 5, rp[1] - 1, rp[0] + 5, rp[1] + 1, 0.1), 1, prog(t, 1.0 + i * 0.02, 0.2), { color: INK, alpha: 0.7, taper: 0 });
    }
    var pond = Ml(POND);
    fill(pond, "#b9d3d6", prog(t, 0.6, 0.5));
    brush(pond.concat([pond[0]]), 1.4, prog(t, 0.6, 0.9), { color: "#4f6d73", taper: 0.02 });
    var cab = Mp(232, 44);                                          // Thoreau's cabin site
    fill(rectPts(cab[0] - 4, cab[1] - 2, 8, 6, 0.1), "#8a4b32", prog(t, 1.3, 0.3));
    fill(closed([[cab[0] - 6, cab[1] - 2], [cab[0], cab[1] - 7], [cab[0] + 6, cab[1] - 2]], 0.1), "#8a4b32", prog(t, 1.3, 0.3));
    hand("cabin", cab[0] + 9, cab[1] + 3, 10, INK, "left", prog(t, 1.4, 0.3));
    var pl = Mp(148, 108);
    hand("walden pond", pl[0], pl[1], 15, INK, "center", prog(t, 1.2, 0.4));
    var pin = Mp(150, 4);
    fill(circlePts(pin[0], pin[1], 5, 0.1), "#c0392b", mpa);

    // the screen: a day's page, turning one day at a time
    monitorDesk(708, 430, 462, t, 60, 940);
    var wa = prog(t, 0.1, 0.8);
    fill(rectPts(480, 36, 456, 394, 0.6), "#171614", wa, { still: true });
    fill(rectPts(484, 62, 448, 364, 0.3), "#f7f4ec", wa, { still: true });
    brush(rectPts(480, 36, 456, 394, 0.8), 2, wa, { taper: 0.02 });
    for (i = 0; i < 3; i++) fill(circlePts(496 + i * 13, 49, 3.6, 0.1), PAPER, wa * 0.7);
    var dayLen = 2.6, start = 2.4, d = 0, ca = prog(t, 1.0, 0.5);
    if (!reduceMotion && t > start) {
      d = Math.min(2, Math.floor((t - start) / dayLen));
      var dt = t - start - d * dayLen;
      ca = d === 0 ? 1 : clamp01(dt / 0.4);
      if (d < 2) ca *= clamp01((dayLen - dt) / 0.3);
    }
    var D = WALDEN_DAYS[d];
    hand("← all days", 506, 86, 13, W_GREY, "left", wa);
    hand(D[0], 910, 86, 13, W_GREY, "right", ca);
    fill(rectPts(506, 100, 70, 20, 0.2), "#e4e8d6", wa);
    hand("☀ summer", 514, 115, 12, W_OLIVE, "left", wa);
    serif("Economy", 588, 115, 12, W_GREY, wa, true);
    serif(D[1], 506, 152, 24, INK, ca);
    if (d === 0) serif("clear, warm summer day", 506, 172, 12, W_GREY, ca, true);
    D[2].forEach(function (line, k) { hand(line, 506, 200 + k * 20, 15, "#3b3934", "left", ca); });
    brush(seg(506, 240, 910, 240, 0.2), 1, wa, { color: "#d8d3c6", taper: 0 });
    var qa = prog(t, 1.4, 0.5);
    brush(seg(507, 254, 507, 318, 0.1), 3, qa, { color: W_OLIVE, taper: 0 });       // the quote, with its olive rule
    [[520, 266, 900], [520, 284, 880], [520, 302, 760]].forEach(function (q, k) {
      brush(seg(q[0], q[1], q[2], q[1], 0.4), 3, prog(t, 1.5 + k * 0.1, 0.4), { color: "#5a564d", alpha: 0.45, taper: 0.05 });
    });
    [["activities", 506, 3], ["food & drink", 716, 2]].forEach(function (c, k) {   // the day's two cards
      var aa = prog(t, 1.8 + k * 0.15, 0.4);
      fill(rectPts(c[1], 334, 194, 82, 0.3), "#ffffff", aa);
      brush(rectPts(c[1], 334, 194, 82, 0.3), 1, aa, { color: "#d8d3c6", taper: 0.02 });
      hand(c[0], c[1] + 14, 354, 11, W_GREY, "left", aa);
      for (var b = 0; b < c[2]; b++) {
        fill(circlePts(c[1] + 18, 368 + b * 15, 1.5, 0.05), W_GREY, aa);
        brush(seg(c[1] + 26, 368 + b * 15, c[1] + 26 + 60 + ((b * 37) % 50), 368 + b * 15, 0.2), 2.4, aa, { color: "#5a564d", alpha: 0.4, taper: 0.05 });
      }
    });
  }

  // ---------------------------------------------------------------- SATitude, drawn after the site
  // The mint landing page with its headline and the Danphe mascot in a dhaka topi; an answer sheet on a
  // clipboard on the desk, its bubbles filling in.
  var S_TEAL = "#16806f", S_DARK = "#0b2f2b", S_ORANGE = "#f08a1c";
  function feather(cx, cy, len, w, ang, color, a) {
    var pts = [], ca = Math.cos(ang), sa = Math.sin(ang);
    for (var k = 0; k <= 16; k++) {
      var q = (k / 16) * Math.PI * 2, x = Math.cos(q) * len / 2 + len / 2, y = Math.sin(q) * w / 2;
      pts.push([cx + x * ca - y * sa, cy + x * sa + y * ca]);
    }
    fill(pts, color, a);
  }

  function sSatitude(t) {
    var i;
    // the clipboard, propped on the desk, its answer bubbles filling in
    var cb = prog(t, 0.3, 0.6);
    fill(rectPts(170, 290, 160, 172, 0.4), "#3a2e24", cb, { still: true });
    brush(rectPts(170, 290, 160, 172, 0.4), 2, cb, { taper: 0.02 });
    fill(rectPts(180, 304, 140, 150, 0.3), PAPER, cb);
    fill(rectPts(226, 282, 48, 18, 0.2), "#9a968c", cb);
    for (var row = 0; row < 6; row++) {
      var y = 326 + row * 21, pick = Math.floor(R() * 4);
      brush(seg(190, y, 200, y, 0.1), 2, cb, { color: INK, taper: 0 });
      for (var c = 0; c < 4; c++) {
        var bx = 222 + c * 24;
        brush(circlePts(bx, y, 7, 0.2), 1.3, prog(t, 0.7 + row * 0.06, 0.3), { color: INK, taper: 0.05 });
        fill(circlePts(bx, y, 5, 0.2), INK, c === pick ? prog(t, 2.2 + row * 0.35, 0.2) : 0);
      }
    }
    brush(path([[344, 462], [372, 336]], 0.2), 6, prog(t, 0.9, 0.4), { taper: 0.1 });   // a pencil leaning on it
    brush(seg(344, 462, 342, 470, 0.1), 2, prog(t, 1.1, 0.2), {});

    // the screen: SATitude's landing page
    monitorDesk(708, 430, 462, t, 60, 940);
    var wa = prog(t, 0.1, 0.8);
    fill(rectPts(480, 36, 456, 394, 0.6), "#171614", wa, { still: true });
    fill(rectPts(484, 62, 448, 364, 0.3), "#dcf4ef", wa, { still: true });
    ctx.save();
    ctx.beginPath(); ctx.rect(484, 62, 448, 364); ctx.clip();          // the page's soft glows stay inside the screen
    fill(circlePts(600, 210, 130, 0.5), "#f1fbf9", wa * 0.7, { still: true });
    fill(circlePts(838, 262, 104, 0.5), "#bdeee5", wa * 0.6, { still: true });
    ctx.restore();
    brush(rectPts(480, 36, 456, 394, 0.8), 2, wa, { taper: 0.02 });
    for (i = 0; i < 3; i++) fill(circlePts(496 + i * 13, 49, 3.6, 0.1), PAPER, wa * 0.7);
    // the nav pill
    var na = prog(t, 0.6, 0.4);
    fill(rectPts(494, 70, 428, 24, 0.2), "#fbfefd", na);
    fill(circlePts(510, 82, 6, 0.1), "#2f5fd0", na);
    hand("practice tests   question bank   ai tutor   pricing", 704, 87, 11, "#0f5c55", "center", na);
    fill(rectPts(856, 74, 60, 16, 0.2), S_ORANGE, na);
    hand("start for free", 886, 86, 10, S_DARK, "center", na);
    // the tag, the headline, the buttons
    var ha = prog(t, 0.9, 0.5);
    fill(rectPts(496, 112, 196, 16, 0.2), "#fbfefd", ha);
    hand("digital sat · bluebook-style practice", 504, 124, 10, S_TEAL, "left", ha);
    ctx.font = "800 25px 'Avenir Next', 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.globalAlpha = ha;
    var x0 = 496, w1 = ctx.measureText("Make your ").width, w2 = ctx.measureText("SAT").width;
    ctx.fillStyle = S_DARK; ctx.fillText("Make your ", x0, 162);
    ctx.fillStyle = S_TEAL; ctx.fillText("Digital", x0 + w1, 162);
    ctx.fillStyle = S_TEAL; ctx.fillText("SAT", x0, 192);
    ctx.fillStyle = S_DARK; ctx.fillText(" prep feel", x0 + w2, 192);
    ctx.fillText("brilliantly clear.", x0, 222);
    ctx.globalAlpha = 1;
    brush(seg(496, 246, 760, 246, 0.3), 2.4, prog(t, 1.2, 0.4), { color: "#4f7f78", alpha: 0.45, taper: 0.05 });
    brush(seg(496, 262, 700, 262, 0.3), 2.4, prog(t, 1.3, 0.4), { color: "#4f7f78", alpha: 0.45, taper: 0.05 });
    var ba = prog(t, 1.4, 0.4);
    fill(rectPts(496, 280, 150, 26, 0.2), S_ORANGE, ba);
    hand("start practicing free →", 571, 298, 13, S_DARK, "center", ba);
    fill(rectPts(656, 280, 112, 26, 0.2), "#fbfefd", ba);
    hand("see how it works", 712, 298, 13, S_DARK, "center", ba);

    // the Danphe in its dhaka topi, facing the headline
    var da = prog(t, 1.0, 0.6);
    [[-0.95, 0], [-0.7, 1], [-0.45, 0], [-0.2, 1], [0.05, 0], [0.3, 1], [0.55, 0]].forEach(function (f) {   // the copper tail fan
      feather(858, 262, 92, 20, f[0], f[1] ? "#e9a96b" : "#d9894f", da);
    });
    brush(seg(828, 290, 824, 316, 0.1), 2, da, { color: "#e8c9a8", taper: 0 });       // legs
    brush(seg(842, 290, 846, 316, 0.1), 2, da, { color: "#e8c9a8", taper: 0 });
    brush(seg(816, 316, 832, 316, 0.1), 1.6, da, { color: "#e8c9a8", taper: 0 });
    brush(seg(838, 316, 854, 316, 0.1), 1.6, da, { color: "#e8c9a8", taper: 0 });
    fill(blobPts(834, 254, 30, 40, 2, 3, 24), "#2f5fd0", da);                         // the body, in its blue jacket
    fill(closed([[812, 226], [826, 230], [818, 268]], 0.2), "#f3f3f3", da);           // the white collar
    fill(blobPts(848, 258, 18, 26, 2, 3, 20), "#5a6fe0", da);                         // the wing
    for (i = 0; i < 4; i++) brush(arcPts(846, 248 + i * 9, 8, 4, 0.2, Math.PI - 0.2, 0.1), 1, da, { color: "#9fb4ff", alpha: 0.8, taper: 0.2 });
    fill(circlePts(808, 198, 18, 0.2), "#45b7d9", da);                               // the head
    fill(blobPts(812, 216, 10, 9, 2, 3, 16), "#e2603a", da);                         // its orange throat
    fill(circlePts(802, 194, 6, 0.1), "#ffffff", da);
    fill(circlePts(801, 194, 3, 0.05), INK, da);
    fill(closed([[792, 199], [776, 205], [792, 208]], 0.1), "#e9b3a4", da);           // the beak
    fill(closed([[795, 184], [822, 182], [824, 164], [797, 166]], 0.2), "#5b2a2f", da);   // the dhaka topi
    [["#c94f3d", 801, 172], ["#2f8f8a", 809, 176], ["#e2b34a", 817, 171], ["#2f8f8a", 803, 179], ["#c94f3d", 815, 178]].forEach(function (dt) {
      fill(circlePts(dt[1], dt[2], 1.8, 0.05), dt[0], da);
    });
    [[822, 168, 846, 150], [822, 170, 852, 160], [822, 172, 846, 172]].forEach(function (p) {   // the green plume
      brush(path([[p[0], p[1]], [lerp(p[0], p[2], 0.5), p[1] - 8], [p[2], p[3]]], 0.2), 3, da, { color: "#2fa37a", taper: 0.3 });
    });
  }

  // ---------------------------------------------------------------- scene: the résumé on a desk
  function sResume(t) {
    brush(seg(40, 476, 920, 476, 0.8), 3, prog(t, 0.2, 1), { taper: 0.05 });
    var ang = -0.05, ca = Math.cos(ang), sa = Math.sin(ang);
    function S(x, y) { return [600 + x * ca - y * sa, 268 + x * sa + y * ca]; }
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
    brush(path([[780, 440], [900, 336]], 0.3), 9, prog(t, 2.8, 0.5), { taper: 0.15 });   // a pen
    brush(seg(780, 440, 768, 454, 0.2), 3, prog(t, 3.2, 0.2), {});
    brush(seg(882, 352, 894, 364, 0.1), 1.6, prog(t, 3.2, 0.2), { color: INK, taper: 0 });
  }

  // ---------------------------------------------------------------- scene: the woods at Walden Pond
  // a fir: tiers of dark triangles with drooping edges, drawn bottom-up so each tier overlaps the one below
  function pine(x, baseY, h, t, t0) {
    brush(seg(x, baseY, x, baseY - h * 0.2, 0.3), 3, prog(t, t0, 0.4), { taper: 0.1 });
    for (var b = 0; b < 5; b++) {
      var u = b / 5, bot = baseY - h * (0.12 + u * 0.74), top = bot - h * 0.3, bw = h * (0.2 - u * 0.13);
      var tier = closed([[x, top], [x + bw, bot], [x + bw * 0.5, bot - 5], [x, bot + 1], [x - bw * 0.5, bot - 5], [x - bw, bot]], 0.6);
      var tp = prog(t, t0 + 0.15 + b * 0.08, 0.4);
      fill(tier, INK, tp > 0 ? 1 : 0);
      brush(tier, 1.8, tp, { taper: 0.03 });
    }
  }

  function sWoods(t) {
    stars(40, 0, 0, W, 220, t, 0);
    fill(circlePts(600, 92, 22, 0.4), PAPER, prog(t, 0.4, 0.6));
    fill(circlePts(610, 86, 20, 0.4), INK, prog(t, 0.4, 0.6));

    // the far shore, then the pond
    brush(path([[0, 352], [120, 344], [260, 350], [400, 340], [560, 348], [720, 338], [860, 346], [960, 340]], 0.8), 2, prog(t, 0.2, 1.2), { alpha: 0.85 });
    var pond = arcPts(470, 420, 330, 54, 0, Math.PI * 2, 0.8);
    fill(pond, PAPER, prog(t, 0.6, 0.6) * 0.1);
    brush(pond, 2.2, prog(t, 0.6, 1.2), { taper: 0.03 });
    for (var r = 0; r < 9; r++) {
      var ry = 396 + r * 6, rx = 260 + R() * 360;
      brush(seg(rx, ry, rx + 30 + R() * 50, ry, 0.3), 1.3, prog(t, 1.4 + r * 0.06, 0.3), { alpha: 0.6 });
    }

    // tall pines framing the pond
    [[40, 352, 300], [96, 356, 250], [150, 350, 330], [210, 354, 220], [790, 348, 240], [846, 352, 310], [904, 350, 270], [948, 356, 330]].forEach(function (p, k) {
      pine(p[0], p[1], p[2], t, 0.4 + k * 0.12);
    });

    // Thoreau's cabin on the far bank, and its reflection in the water
    var ca = prog(t, 1.2, 0.8);
    brush(rectPts(656, 304, 64, 46, 0.4), 2.2, ca, { taper: 0.03 });
    brush(path([[648, 306], [688, 274], [728, 306]], 0.4), 2.4, ca, {});
    brush(rectPts(680, 322, 14, 28, 0.2), 1.6, ca, { taper: 0.02 });
    brush(rectPts(662, 314, 12, 11, 0.2), 1.3, ca, { taper: 0.02 });
    brush(seg(712, 290, 712, 272, 0.2), 3, ca, {});
    for (var rf = 0; rf < 5; rf++) {
      brush(seg(658 + rf * 14, 372 + rf * 3, 668 + rf * 14, 372 + rf * 3, 0.2), 1.2, prog(t, 1.8 + rf * 0.05, 0.3), { alpha: 0.5 });
    }

    // someone sitting quietly on the near bank, looking out at the pond
    brush(path([[280, 522], [400, 510], [560, 512], [700, 524]], 0.6), 1.8, prog(t, 1.2, 0.8), { alpha: 0.8 });
    var sa = prog(t, 1.6, 0.6), sx = 470, sy = 512;
    fill(circlePts(sx, sy - 40, 7, 0.2), PAPER, sa);
    fill(closed([[sx - 9, sy - 31], [sx + 9, sy - 31], [sx + 14, sy - 18], [sx + 17, sy], [sx - 17, sy], [sx - 14, sy - 18]], 0.3), PAPER, sa);

    // mist on the water (drifts)
    var drift = reduceMotion ? 0 : Math.sin(t * 0.3) * 30;
    [[200, 384, 520, 10], [420, 410, 760, 9]].forEach(function (m, k) {
      var dd = drift * (k ? -1 : 1);
      brush(path([[m[0] + dd, m[1]], [m[0] + 120 + dd, m[1] - 5], [m[2] - 100 + dd, m[1] + 4], [m[2] + dd, m[1] - 2]], 0.6), m[3], prog(t, 2 + k * 0.3, 1.2), { alpha: 0.1, dry: 1, still: true, taper: 0.5 });
    });
    // chimney smoke (last: it drifts)
    var smoke = [];
    for (var i = 0; i <= 6; i++) smoke.push([712 + Math.sin(i * 0.9 + t * 1.8) * 5 + i * 4, 268 - i * 12]);
    brush(smoke, 2, prog(t, 1.8, 0.8), { alpha: 0.7, taper: 0.4, still: true });
  }

  // ---------------------------------------------------------------- scene: penguins on the ice, one of them trying to fly
  function penguin(x, y, s, t, a, flap, hop) {
    function P(px, py) { return [x + px * s, y - hop + py * s]; }
    function Ps(list) { return list.map(function (p) { return P(p[0], p[1]); }); }
    var body = Ps(blobPts(0, -34, 17, 34, 2, 3, 22));
    fill(body, INK, a);
    brush(body, 2.2 * s, a, { taper: 0.02 });
    fill(Ps(blobPts(3, -28, 10, 25, 2, 3, 18)), PAPER, a);                       // white belly
    fill(Ps(circlePts(0, -70, 12, 0.2)), INK, a);                                 // head
    brush(Ps(arcPts(0, -70, 12, 12, Math.PI * 0.9, Math.PI * 2.1, 0.2)), 2 * s, a, {});
    fill(Ps(circlePts(4, -73, 2.4, 0.05)), PAPER, a);                             // eye
    fill(Ps(closed([[10, -71], [20, -67], [10, -64]], 0.05)), PAPER, a);           // beak
    var up = flap ? -0.5 - 0.7 * flap : 0.45;                                    // flippers: down at rest, up when flapping
    brush(Ps(path([[-14, -48], [-14 - 20 * Math.cos(up), -48 + 20 * Math.sin(up)]], 0.1)), 4.5 * s, a, { taper: 0.4 });
    brush(Ps(path([[14, -48], [14 + 20 * Math.cos(up), -48 + 20 * Math.sin(up)]], 0.1)), 4.5 * s, a, { taper: 0.4 });
    fill(Ps(arcPts(-6, 1, 7, 3, 0, Math.PI * 2, 0.05)), PAPER, a);                // feet
    fill(Ps(arcPts(8, 1, 7, 3, 0, Math.PI * 2, 0.05)), PAPER, a);
  }

  function sPenguins(t) {
    stars(70, 0, 0, W, 300, t, 0);
    fill(circlePts(820, 96, 26, 0.4), PAPER, prog(t, 0.4, 0.6));
    brush(seg(0, 330, W, 330, 0.6), 2, prog(t, 0.2, 1.2), {});
    for (var w = 0; w < 26; w++) {
      var wx = R() * W, wy = 344 + R() * 180;
      brush(seg(wx, wy, wx + 20 + R() * 40, wy, 0.3), 1.2, prog(t, 0.8 + R() * 1.0, 0.3), { alpha: 0.5 });
    }
    // the ice floe: a bright top and a dark front edge
    var top = closed([[170, 392], [300, 372], [520, 366], [720, 378], [800, 398], [640, 414], [380, 416], [220, 410]], 1);
    fill(closed([[170, 392], [220, 410], [380, 416], [640, 414], [800, 398], [796, 432], [620, 450], [360, 452], [200, 440]], 1), INK, 1, { still: true });
    brush(closed([[170, 392], [220, 410], [380, 416], [640, 414], [800, 398], [796, 432], [620, 450], [360, 452], [200, 440]], 1), 2, prog(t, 0.4, 1.0), { taper: 0.02 });
    fill(top, PAPER, prog(t, 0.5, 0.5) * 0.92);
    for (var c = 0; c < 6; c++) brush(seg(240 + c * 90, 420 + (c % 2) * 8, 252 + c * 90, 440 + (c % 2) * 4, 0.2), 1.2, prog(t, 1.0 + c * 0.05, 0.3), { alpha: 0.6 });

    // three standing penguins, and one trying to fly (last: it flaps and hops)
    var pa = prog(t, 1.0, 0.5);
    penguin(330, 398, 1.15, t, pa, 0, 0);
    penguin(400, 392, 0.95, t, pa, 0, 0);
    penguin(660, 398, 1.05, t, pa, 0, 0);
    var trying = prog(t, 2.0, 0.3);
    var flap = reduceMotion ? 1 : 0.5 + 0.5 * Math.sin(t * 14);
    var hop = reduceMotion ? 0 : Math.max(0, Math.sin(t * 3.5)) * 26 * trying;
    for (var ml = 0; ml < 3; ml++) {                                               // little motion lines
      brush(seg(520 - 34 + ml * 8, 330 - hop - 36 + ml * 10, 520 - 50 + ml * 8, 330 - hop - 36 + ml * 10, 0.1), 1.4, trying, { alpha: 0.6 * (hop > 4 ? 1 : 0), taper: 0.3, still: true });
    }
    penguin(530, 380, 1.1, t, pa, flap * trying, hop);
  }

  // ---------------------------------------------------------------- scene: behind a section's gallery, a quiet night
  function sGallery(t) {
    stars(60, 0, 0, W, 420, t, 0);
    fill(circlePts(860, 80, 20, 0.4), PAPER, prog(t, 0.3, 0.6));
    fill(circlePts(870, 74, 18, 0.4), INK, prog(t, 0.3, 0.6));
    brush(path([[0, 470], [160, 452], [330, 462], [520, 446], [700, 458], [860, 448], [960, 456]], 0.8), 2, prog(t, 0.2, 1.2), { alpha: 0.7 });
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
      lines: ["budhanilkantha school, kathmandu.", "A Levels: Physics (A*) Chemistry (A*) Computer Science (A*) Mathematics (A*)", "1600 SAT"] },
    lexington: { draw: sLexington, seed: 55, anchor: "tl", enter: "rise",
      lines: ["august 2026: about 12,000 km later.", "washington and lee university, lexington, virginia.", "a math + cs double major, on a full-ride scholarship."] },
    today: { draw: sEnd, seed: 77, anchor: "tl", enter: "wipe",
      lines: ["that’s my story so far.", "want to see more? pick one:"],
      choices: [
        { label: "projects →", track: "projects", aria: "Watch my projects" },
        { label: "experience →", track: "experience", aria: "Watch my experience" },
        { label: "words i live by →", track: "words", aria: "Words that give meaning to my life" },
        { label: "résumé →", track: "resume", aria: "See my résumé" }
      ],
      links: [
        { label: "email", href: "mailto:thakura30@wlu.edu", aria: "Email Aditya at thakura30@wlu.edu" },
        { label: "github ↗", href: "https://github.com/sirElvinn", aria: "Aditya on GitHub", ext: true },
        { label: "linkedin ↗", href: "https://www.linkedin.com/in/aditya-thakur-a76501266/", aria: "Aditya on LinkedIn", ext: true },
        { label: "watch again ↺", restart: true, aria: "Watch the story again from the start" }
      ] },

    // Each section opens on a gallery: its stories hang as small ink pictures, and a click opens one.
    // "items" lists the shots in the gallery and the label under each picture.
    projects: { draw: sGallery, seed: 150, anchor: "tc",
      lines: ["things i’ve built.", "pick one to know more."],
      items: [
        { id: "diatometer", label: "diatometer", aria: "Open DiatoMeter" },
        { id: "walden-life", label: "walden.life", aria: "Open walden.life" },
        { id: "satitude", label: "satitude", aria: "Open SATitude" }
      ] },
    experience: { draw: sGallery, seed: 151, anchor: "tc",
      lines: ["where i’ve learned and worked.", "pick one to know more."],
      items: [
        { id: "courses", label: "courses · 2025", aria: "Open my 2025 courses" },
        { id: "nepalingo", label: "nepalingo · 2024", aria: "Open Nepalingo" }
      ] },
    words: { draw: sGallery, seed: 152, anchor: "tc",
      lines: ["words that give meaning to my life.", "pick one."],
      items: [
        { id: "walden", label: "thoreau", aria: "Open the Thoreau quote" },
        { id: "penguins", label: "penguins on the ice", aria: "Open the penguin quote" }
      ] },

    // projects
    diatometer: { draw: sMicro, seed: 66, anchor: "tl",
      lines: ["diatometer · sep 2026 – now.", "with william & mary’s nano & biomaterials lab: measuring tiny glass algae shells.", "136 shells measured in about 15 seconds."],
      links: [
        { label: "visit ↗", href: "https://diamometer.us", aria: "Visit DiatoMeter", ext: true },
        { label: "source ↗", href: "https://github.com/sirElvinn/diatometer", aria: "DiatoMeter source code on GitHub", ext: true }
      ] },
    "walden-life": { draw: sWaldenLife, seed: 99, anchor: "tl",
      lines: ["summer 2026: walden.life.", "thoreau’s walden, one day at a time.", "100 entries drawn from 12 of walden’s 18 chapters."],
      links: [{ label: "walden.life ↗", href: "https://walden.life", aria: "Visit walden.life", ext: true }] },
    satitude: { draw: sSatitude, seed: 98, anchor: "tl",
      lines: ["summer 2026: satitude.", "practice for the digital sat."],
      links: [{ label: "satitude ↗", href: "https://satitude.xyz", aria: "Visit SATitude", ext: true }] },

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

    // words that give meaning to my life
    walden: { draw: sWoods, seed: 130, anchor: "tc",
      lines: [[
        "“i went to the woods because i wanted to live deliberately.",
        "i wanted to live deep and suck out all the marrow of life,",
        "to put to rout all that was not life, and not, when i had come to die, discover that i had not lived.”",
        "\n— henry david thoreau, as read in dead poets society."]] },
    penguins: { draw: sPenguins, seed: 140, anchor: "tc",
      lines: [["“she said we are penguins on the ice.", "\nwe’re not meant to fly,", "\nbut god knows we can try.”"]] },

    // résumé
    resume: { draw: sResume, seed: 120, anchor: "tl",
      lines: ["the one-page version.", "education, projects, experience and skills."],
      links: [{ label: "open the pdf ↗", href: "assets/aditya-thakur-resume.pdf", aria: "Open Aditya's résumé (PDF)", ext: true }] }
  };
  // A line written as a list is ONE box that grows: each part is its own click, typed into the same box.
  // Parts run on after a space; a part that starts with "\n" starts a new line inside the box.
  Object.keys(SHOT).forEach(function (id) {
    var s = SHOT[id], flat = [], box = [], sep = [];
    s.lines.forEach(function (ln, b) {
      [].concat(ln).forEach(function (part, j) {
        sep.push(j === 0 ? "" : part.charAt(0) === "\n" ? "\n" : " ");
        flat.push(part.replace(/^\n/, ""));
        box.push(b);
      });
    });
    s.id = id; s.lines = flat; s.box = box; s.sep = sep;
  });

  var TRACKS = {
    main: ["title", "pokhara", "school", "lexington", "today"],
    projects: ["projects", "diatometer", "walden-life", "satitude"],
    experience: ["experience", "courses", "nepalingo"],
    words: ["words", "walden", "penguins"],
    resume: ["resume"]
  };
  var MENU = "today";
  var ALIASES = { contact: "today", menu: "today", quotes: "words", "summer-builds": "walden-life" };

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
  var TYPE_CPS = 45, CAPTION_DELAY = 650, GROW_MS = 320;

  function typeDelay(k) { return shot.sep[k] ? GROW_MS : 0; }
  function typedDone(k, now) {
    return now - lineStarts[k] >= typeDelay(k) + (shot.lines[k].length / TYPE_CPS) * 1000;
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
  // Inside a section that opens on a gallery, each item is its own little film that returns to the gallery.
  function inItem() { return track !== "main" && pos > 0 && !!SHOT[TRACKS[track][0]].items; }
  function openItem(id) { var at = locate(id); if (at) go(at.track, at.pos, 1, "zoom", false); }
  function backToGallery(dir) { go(track, 0, dir, "zoom", true); }
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
    if (shot.items) return;              // a gallery waits for a pick
    if (inItem()) { backToGallery(-1); return; }
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
    if (inItem()) { backToGallery(-1); return; }
    if (pos > 0) { go(track, pos - 1, -1, track === "main" ? shot.enter : "pan", true); return; }
    if (track !== "main") backToChoices(-1);
  }

  // ---------------------------------------------------------------- captions and boxes (drawn in screen space, so they stay readable)
  var HAND_FONT = function (size) { return "700 " + size + "px " + HAND; };

  function wrap(text, maxW, size) {
    main.font = HAND_FONT(size);
    var lines = [];
    text.split("\n").forEach(function (para) {
      var words = para.split(" "), line = "";
      for (var i = 0; i < words.length; i++) {
        var test = line ? line + " " + words[i] : words[i];
        if (line && main.measureText(test).width > maxW) { lines.push(line); line = words[i]; }
        else line = test;
      }
      lines.push(line);
    });
    var w = 0;
    lines.forEach(function (l) { w = Math.max(w, main.measureText(l).width); });
    return { lines: lines, w: w };
  }

  // grow (optional): { box, prev, u } eases box number `box` from the size of text `prev` to its full size
  function stack(texts, size, anchor, big, grow) {
    var gap = size * 0.75, m = size * 0.95;
    var maxW = portrait ? VW - 32 - size * 1.5 : film.w * (anchor === "tc" ? 0.62 : 0.46);
    var boxes = texts.map(function (tx, k) {
      var sz = big && k === 0 ? size * 1.5 : size, px = sz * 0.75, py = sz * 0.5, lh = sz * 1.22;
      var r = wrap(tx, maxW, sz), w = r.w + px * 2, h = r.lines.length * lh + py * 2 - lh * 0.18;
      if (grow && grow.box === k && grow.u < 1) {
        var r0 = wrap(grow.prev, maxW, sz), e = easeOut(grow.u);
        w = lerp(r0.w + px * 2, w, e);
        h = lerp(r0.lines.length * lh + py * 2 - lh * 0.18, h, e);
      }
      return { lines: r.lines, w: w, h: h, padX: px, padY: py, lineH: lh, size: sz };
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
    var texts = [], parts = [], grow = null;   // per box: its text so far, and which beats are in it
    for (var k = 0; k < beat; k++) {
      var bi = shot.box[k];
      if (texts[bi] == null) { texts[bi] = shot.lines[k]; parts[bi] = [k]; continue; }
      if (now - lineStarts[k] < GROW_MS) grow = { box: bi, prev: texts[bi], u: Math.max(0, now - lineStarts[k]) / GROW_MS };
      texts[bi] += shot.sep[k] + shot.lines[k];
      parts[bi].push(k);
    }
    var st = stack(texts, capSize, shot.anchor, shot.auto, reduceMotion ? null : grow);
    st.boxes.forEach(function (b, bi) {
      var since = now - lineStarts[parts[bi][0]];
      if (since < 0) return;
      var a = clamp01(since / 260) * fade, chars = null;
      if (!reduceMotion) {
        chars = 0;
        for (var j = 0; j < parts[bi].length; j++) {
          var kk = parts[bi][j], typed = Math.floor(((now - lineStarts[kk] - typeDelay(kk)) / 1000) * TYPE_CPS);
          if (typed < shot.lines[kk].length) { chars += Math.max(0, typed); break; }
          chars += shot.lines[kk].length + 1;
        }
      }
      drawBox(b, bi + shot.seed * 10, a, chars);
    });
    hits = [];
    if (beat >= shot.lines.length && shot.items) drawGallery(st.bottom + capSize * 0.9, lineStarts[shot.lines.length - 1], now, fade);
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

  // ---------------------------------------------------------------- a section's gallery: its stories as ink pictures pegged to a line
  var thumbs = {}, hotKey = null, lift = {};
  function thumbFor(id, w, h, now) {
    var T = thumbs[id] || (thumbs[id] = { c: document.createElement("canvas"), boil: -1 });
    var pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (T.c.width !== pw || T.c.height !== ph) { T.c.width = pw; T.c.height = ph; T.boil = -1; }
    if (T.boil !== boil) {   // redrawn only when the ink "boils", about 8 times a second
      renderScene(SHOT[id], reduceMotion ? 60 : 60 + now / 1000, T.c.getContext("2d"), pw);
      T.boil = boil;
    }
    return T.c;
  }
  function fitSize(text, maxW, size) {
    main.font = HAND_FONT(size);
    var w = main.measureText(text).width;
    return w > maxW ? Math.max(10, (size * maxW) / w) : size;
  }

  function drawGallery(top, t0, now, fade) {
    var items = shot.items, n = items.length;
    var gap = capSize * 1.7, pinH = capSize * 0.9, labelSize = capSize * 0.86, labelH = labelSize * 1.7;
    var ax = portrait ? 16 : film.x + capSize, aw = portrait ? VW - 32 : film.w - capSize * 2;
    var ay = top + pinH, ah = (portrait ? VH - 44 : film.y + film.h - capSize * 0.8) - ay;
    // pick the number of columns that gives the biggest pictures
    var cw = 0, cols = 1;
    for (var c = 1; c <= n; c++) {
      var r = Math.ceil(n / c);
      var w = Math.min((aw - gap * (c - 1)) / c, ((ah - (r - 1) * (gap + pinH)) / r - labelH) / 0.55625, portrait ? 230 : film.w * 0.3);
      if (w > cw + 0.5) { cw = w; cols = c; }
    }
    var pad = cw * 0.05, iw = cw - pad * 2, ih = (iw * 9) / 16, ch = pad + ih + labelH;
    var rows = Math.ceil(n / cols), totalH = rows * ch + (rows - 1) * (gap + pinH);
    var y0 = ay + Math.max(0, ah - totalH) * (portrait ? 0 : 0.35);
    var imgs = items.map(function (it) { return thumbFor(it.id, iw, ih, now); });
    ctx = main;

    for (var row = 0; row < rows; row++) {
      var inRow = Math.min(cols, n - row * cols), rowW = inRow * cw + (inRow - 1) * gap;
      var rx = ax + (aw - rowW) / 2, ly = y0 + row * (ch + gap + pinH) - pinH * 0.55;
      var lx0 = rx - gap, lx1 = rx + rowW + gap, sag = capSize * 0.4;
      var lineY = function (x) { var u = ((x - lx0) / (lx1 - lx0)) * 2 - 1; return ly + sag * (1 - u * u); };
      var pts = [];
      for (var s = 0; s <= 16; s++) { var lx = lerp(lx0, lx1, s / 16); pts.push([lx, lineY(lx)]); }
      main.setTransform(dpr, 0, 0, dpr, 0, 0);
      sid = 65000 + row * 500; R = mulberry32(700 + row);
      brush(path(pts, 0.4), 1.6, clamp01((now - (t0 + 250 + row * 200)) / 400), { alpha: 0.8 * fade, taper: 0.05 });

      for (var j = 0; j < inRow; j++) {
        var idx = row * cols + j, it = items[idx], key = shot.id + ":item:" + idx;
        var px = rx + j * (cw + gap) + cw / 2, py = lineY(px), cardTop = pinH * 0.3;
        var a = clamp01((now - (t0 + 450 + idx * 160)) / 280) * fade;
        lift[key] = lerp(lift[key] || 0, hotKey === key ? 1 : 0, 0.3);
        var hv = lift[key], tilt = (idx % 2 ? 1 : -1) * 0.028 * (1 - hv);
        main.setTransform(dpr, 0, 0, dpr, 0, 0);
        main.translate(px, py);
        main.rotate(tilt);
        main.scale(1 + 0.04 * hv, 1 + 0.04 * hv);
        sid = 66000 + idx * 60; R = mulberry32(3000 + idx + shot.seed);
        fill(rectPts(-cw / 2 - 7, cardTop - 7, cw + 14, ch + 14, 1), INK, a);
        fill(rectPts(-cw / 2, cardTop, cw, ch, 1), PAPER, a);
        if (a > 0) {
          main.globalAlpha = a;
          main.drawImage(imgs[idx], -cw / 2 + pad, cardTop + pad, iw, ih);
          main.globalAlpha = 1;
        }
        brush(rectPts(-cw / 2 + pad, cardTop + pad, iw, ih, 0.6), 1.6, 1, { color: INK, taper: 0.03, alpha: a });
        brush(rectPts(-cw / 2 - 4, cardTop - 4, cw + 8, ch + 8, 1), 1.5, 1, { taper: 0.04, alpha: a });
        hand(it.label, 0, cardTop + pad + ih + labelH * 0.64, fitSize(it.label, iw, labelSize), INK, "center", a);
        fill(rectPts(-5, -pinH * 0.35, 10, pinH * 0.9, 0.3), INK, a);                       // the clothespin
        brush(rectPts(-5, -pinH * 0.35, 10, pinH * 0.9, 0.3), 1.4, 1, { taper: 0.05, alpha: a });
        if (a > 0) hits.push({ key: key, kind: "item", item: it, x: px - cw / 2 - 8, y: py + cardTop - 8, w: cw + 16, h: ch + 16 });
      }
    }
    main.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    var dots = n > 1 && !SHOT[list[0]].items;
    for (var i = 0; i < n && dots; i++) {
      main.beginPath();
      main.arc(x0 + i * gapD, dy, i === pos ? 3.6 : 2.6, 0, Math.PI * 2);
      main.globalAlpha = i === pos ? 0.95 : 0.35;
      main.fillStyle = PAPER;
      main.fill();
    }
    main.globalAlpha = 1;

    var atChoices = (shot.id === MENU || !!shot.items) && beat >= shot.lines.length;
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
    if (h.kind === "choice" || h.kind === "item" || it.restart) {
      el = document.createElement("button");
      el.type = "button";
      el.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (it.restart) restart(); else if (h.kind === "item") openItem(it.id); else startTrack(it.track);
        filmCanvas.focus();
      });
    } else {
      el = document.createElement("a");
      el.href = it.href;
      if (it.ext) { el.target = "_blank"; el.rel = "noopener"; }
    }
    el.className = "film-link";
    el.setAttribute("aria-label", it.aria || it.label);
    var on = function () { hotKey = h.key; }, off = function () { if (hotKey === h.key) hotKey = null; };
    el.addEventListener("pointerenter", on); el.addEventListener("focus", on);
    el.addEventListener("pointerleave", off); el.addEventListener("blur", off);
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
      if (shot.items) extra += " Pictures: " + shot.items.map(function (c) { return c.aria; }).join(", ") + ".";
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
    else if (e.key === "Escape" && inItem()) { e.preventDefault(); backToGallery(-1); }
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
    track: startTrack, open: openItem, next: next, prev: prev
  };
})();
