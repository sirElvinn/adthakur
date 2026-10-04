// Theme button and the hover notes on dashed phrases.
// The pages still read fine if this file never loads.

(function () {
  var root = document.documentElement;

  // ---- Theme: system -> light -> dark -> system ----
  // "system" means: follow the device's own light/dark setting.
  var ORDER = ["system", "light", "dark"];
  var btn = document.querySelector(".theme-btn");

  function saved() {
    try { return localStorage.getItem("theme") || "system"; } catch (e) { return "system"; }
  }

  function apply(mode) {
    if (mode === "light" || mode === "dark") root.dataset.theme = mode;
    else delete root.dataset.theme;
    if (btn) {
      btn.querySelectorAll("svg").forEach(function (svg) {
        svg.classList.toggle("on", svg.dataset.mode === mode);
      });
      btn.setAttribute("aria-label", "Theme: " + mode + ". Click to change.");
      btn.title = "Theme: " + mode;
    }
    window.dispatchEvent(new Event("themechange"));
  }

  apply(saved());

  if (btn) {
    btn.addEventListener("click", function () {
      var next = ORDER[(ORDER.indexOf(saved()) + 1) % ORDER.length];
      try { localStorage.setItem("theme", next); } catch (e) {}
      apply(next);
    });
  }

  // ---- Hover notes for .term[data-tip] ----
  var terms = document.querySelectorAll(".term[data-tip]");
  if (!terms.length) return;

  var tip = document.createElement("div");
  tip.className = "tip";
  tip.id = "term-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  function show(el) {
    tip.textContent = el.dataset.tip;
    el.setAttribute("aria-describedby", "term-tip");

    // Measure, then place above the phrase (or below if there's no room), kept inside the screen.
    var r = el.getClientRects()[0] || el.getBoundingClientRect();
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 8), window.innerWidth - w - 8);
    var top = r.top - h - 10;
    if (top < 8) top = r.bottom + 10;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
    tip.classList.add("show");
  }

  function hide(el) {
    tip.classList.remove("show");
    if (el) el.removeAttribute("aria-describedby");
  }

  terms.forEach(function (el) {
    el.addEventListener("mouseenter", function () { show(el); });
    el.addEventListener("mouseleave", function () { hide(el); });
    el.addEventListener("focus", function () { show(el); });
    el.addEventListener("blur", function () { hide(el); });
  });
  window.addEventListener("scroll", function () { hide(); }, { passive: true });
})();
