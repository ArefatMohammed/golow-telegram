/* window.GolowPlatform: canvas size and safe areas per streaming platform, from ?platform= (default tiktok).
 * Safe areas are where the platform's own UI sits on top of the video; scenes keep their content out of them.
 * Each one can be fine-tuned per OBS source with ?safeTop= / ?safeBottom= / ?safeRight= / ?safeLeft= (pixels). */
(function () {
  "use strict";
  var PLATFORMS = {
    tiktok:           { name: "TikTok Live",          w: 1080, h: 1920, safe: { top: 150, bottom: 560, right: 150, left: 40 } },
    instagram:        { name: "Instagram Live",       w: 1080, h: 1920, safe: { top: 210, bottom: 480, right: 60,  left: 40 } },
    "youtube-shorts": { name: "YouTube Live (vertical)", w: 1080, h: 1920, safe: { top: 180, bottom: 450, right: 160, left: 40 } },
    youtube:          { name: "YouTube Live (16:9)",  w: 1920, h: 1080, safe: { top: 40,  bottom: 110, right: 40,  left: 40 } },
    facebook:         { name: "Facebook Live (16:9)", w: 1920, h: 1080, safe: { top: 40,  bottom: 130, right: 40,  left: 40 } }
  };
  var params = new URLSearchParams(location.search);
  var id = params.get("platform");
  if (!PLATFORMS[id]) id = "tiktok";
  var p = PLATFORMS[id], safe = Object.assign({}, p.safe);
  ["top", "bottom", "right", "left"].forEach(function (side) {
    var v = Number(params.get("safe" + side[0].toUpperCase() + side.slice(1)));
    if (params.has("safe" + side[0].toUpperCase() + side.slice(1)) && v >= 0 && v < 1000) safe[side] = v;
  });

  function apply() {
    var root = document.documentElement.style;
    root.setProperty("--w", p.w + "px");
    root.setProperty("--h", p.h + "px");
    Object.keys(safe).forEach(function (k) { root.setProperty("--safe-" + k, safe[k] + "px"); });
    if (!document.body) return;
    document.body.classList.add("platform-" + id, p.w > p.h ? "landscape" : "portrait");
    if (params.get("preview") === "1") document.body.classList.add("checker");
  }
  apply();
  document.addEventListener("DOMContentLoaded", apply);

  window.GolowPlatform = { id: id, name: p.name, w: p.w, h: p.h, landscape: p.w > p.h, safe: safe, all: PLATFORMS };
})();
