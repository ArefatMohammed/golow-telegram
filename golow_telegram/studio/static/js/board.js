/* board.html: the live board scene (every running auction with its progress). */
(function () {
  "use strict";
  var G = Golow, U = G.util, T = GolowText, esc = U.esc;
  var params = new URLSearchParams(location.search);
  var max = Math.max(1, Math.min(10, Number(params.get("max")) || 5));
  var sound = params.get("sound") !== "0";
  var items = [], counts = {};
  document.getElementById("head").innerHTML = esc(T.board.am) + '<span class="en">' + esc(T.board.en) + "</span>";

  function pct(a) {
    if (a.targetBidCount) return Math.min(1, (a.activeBidCount || 0) / a.targetBidCount);
    var s = Date.parse(a.startsAt), e = Date.parse(a.endsAt), n = U.now();
    return isFinite(s) && isFinite(e) && e > s ? Math.max(0, Math.min(1, (n - s) / (e - s))) : 0;
  }

  function render(flashId) {
    var list = items.filter(U.isLive).sort(function (x, y) { return pct(y) - pct(x) || (y.activeBidCount || 0) - (x.activeBidCount || 0); }).slice(0, max);
    document.getElementById("rows").innerHTML = list.map(function (a) {
      var img = a.imageUrl ? '<img src="' + esc(a.imageUrl) + '" alt="">' : '<div class="ph">🎁</div>';
      var count = a.targetBidCount ? a.activeBidCount + " / " + a.targetBidCount : String(a.activeBidCount || 0);
      return '<div class="brow' + (a.id === flashId ? " flash" : "") + '">' + img +
        '<div class="t">' + esc(a.title) + "</div>" +
        '<div class="m">' + esc(count) + " " + T.bidsUnit + " · " + esc(U.money(a.tenderFeeAmount, a.currency)) + " · #" + esc(a.shortCode) + "</div>" +
        '<div class="bar' + (a.targetBidCount ? "" : " timebased") + '"><i style="width:' + (pct(a) * 100).toFixed(1) + '%"></i></div></div>';
    }).join("");
  }

  function reload() {
    return G.listAuctions().then(function (list) {
      items = list; list.forEach(function (a) { counts[a.id] = a.activeBidCount; });
      document.getElementById("status").textContent = "";
      render();
    }).catch(function (e) { document.getElementById("status").textContent = "API: " + e.message; });
  }

  G.live.on(function (type, p) {
    if (type === "bidCountChanged") {
      var a = items.find(function (x) { return x.id === Number(p.auctionId); });
      if (!a) return reload();
      var up = p.activeBidCount > (counts[a.id] || 0);
      a.activeBidCount = counts[a.id] = p.activeBidCount;
      render(up ? a.id : null);
      if (up && sound) GolowSound.play("new-bid");
    } else if (type !== "bidCountChanged") reload();
  });
  // Without the hub, reload every 5 s and flash the rows whose count went up.
  function poll() {
    if (G.live.status() === "live") return;
    var before = Object.assign({}, counts);
    G.listAuctions().then(function (list) {
      items = list;
      var up = list.filter(function (a) { return a.activeBidCount > (before[a.id] == null ? a.activeBidCount : before[a.id]); });
      list.forEach(function (a) { counts[a.id] = a.activeBidCount; });
      render(up.length ? up[0].id : null);
      if (up.length && sound) GolowSound.play("new-bid");
      document.getElementById("status").textContent = "";
    }).catch(function (e) { document.getElementById("status").textContent = "API: " + e.message; });
  }
  setInterval(poll, 5000);
  // A broken image becomes the gift placeholder (no inline handlers: the page has a strict CSP).
  document.getElementById("rows").addEventListener("error", function (e) {
    if (e.target.tagName === "IMG") { var ph = document.createElement("div"); ph.className = "ph"; ph.textContent = "🎁"; e.target.replaceWith(ph); }
  }, true);
  G.live.joinList();
  reload();
  setInterval(reload, 60000);
})();
