/* window.GolowFx: toasts, coin bursts and confetti. Every element removes itself after its animation, so a scene
 * can run for hours without the DOM growing. */
(function () {
  "use strict";
  var esc = window.Golow.util.esc;
  var COLORS = ["#ffb800", "#ff6a00", "#22c55e", "#ffffff", "#ef4444", "#60a5fa"];

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function removeLater(e, ms) { setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, ms); }

  window.GolowFx = {
    /** text: { am, en } or a string; opts: { long, color: "red" | "green" } */
    toast: function (box, text, opts) {
      opts = opts || {};
      var am = typeof text === "string" ? text : text.am, en = typeof text === "string" ? "" : text.en;
      var t = el("div", "toast" + (opts.long ? " long" : "") + (opts.color ? " " + opts.color : ""), esc(am) + (en ? '<span class="en">' + esc(en) + "</span>" : ""));
      box.appendChild(t);
      while (box.children.length > 4) box.removeChild(box.firstChild);
      removeLater(t, opts.long ? 7100 : 2900);
      return t;
    },
    coins: function (layer, x, y, n) {
      for (var i = 0; i < (n || 16); i++) {
        var c = el("div", "coin");
        var angle = Math.random() * Math.PI - Math.PI; // upwards fan
        var dist = 220 + Math.random() * 380;
        c.style.left = (x - 28) + "px"; c.style.top = (y - 28) + "px";
        c.style.setProperty("--dx", Math.round(Math.cos(angle) * dist) + "px");
        c.style.setProperty("--dy", Math.round(Math.sin(angle) * dist) + "px");
        c.style.animationDelay = Math.round(Math.random() * 120) + "ms";
        layer.appendChild(c);
        removeLater(c, 1700);
      }
    },
    confetti: function (layer, n) {
      for (var i = 0; i < (n || 140); i++) {
        var c = el("div", "confetti");
        var dur = 2.5 + Math.random() * 2.5;
        c.style.left = Math.round(Math.random() * 1080) + "px";
        c.style.background = COLORS[i % COLORS.length];
        c.style.animationDuration = dur.toFixed(2) + "s";
        c.style.animationDelay = (Math.random() * 0.6).toFixed(2) + "s";
        c.style.setProperty("--dx", Math.round(Math.random() * 300 - 150) + "px");
        c.style.setProperty("--rot", Math.round(Math.random() * 1080 - 540) + "deg");
        layer.appendChild(c);
        removeLater(c, (dur + 0.7) * 1000);
      }
    },
    clear: function (box) { while (box.firstChild) box.removeChild(box.firstChild); }
  };
})();
