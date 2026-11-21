/* index.html: the host's control panel. It only sends commands on the bus; each scene fetches its own data. */
(function () {
  "use strict";
  var G = window.Golow, U = G.util, T = window.GolowText, Bus = window.GolowBus, Sound = window.GolowSound;
  var esc = U.esc;
  var $ = function (id) { return document.getElementById(id); };
  var base = location.origin + location.pathname.replace(/[^/]*$/, "");

  var auctions = [], onair = Number(G.lsGet("golow.onair")) || null;
  var lastState = null, lastBeat = 0, sceneKey = null, pvScene = "overlay";
  var toggles = { rules: false, cta: false, card: true, mute: false };

  // ---------- header ----------
  var cfg = G.config || {};
  $("who").textContent = cfg.user && cfg.user.name ? cfg.user.name : "";
  $("logout").addEventListener("click", function () {
    fetch("auth/logout", { method: "POST", credentials: "same-origin" }).finally(function () { location.replace("login"); });
  });

  function apiPill() {
    var s = G.live.status(), p = $("apiPill");
    p.className = "pill " + (s === "live" ? "ok" : s === "reconnecting" ? "warn" : "");
    p.textContent = s === "live" ? "API: live · " + (cfg.apiHost || "") : s === "reconnecting" ? "API: reconnecting…" : "API: connecting…";
    if (apiError) { p.className = "pill bad"; p.textContent = "API: error"; }
  }
  var apiError = false;
  G.live.onStatus(apiPill);

  function ovPill() {
    var ok = Date.now() - lastBeat < 7000;
    $("ovPill").className = "pill " + (ok ? "ok" : "");
    $("ovPill").textContent = "Overlay: " + (ok ? "connected" : "not seen");
    renderOnAir();
  }
  setInterval(ovPill, 1000);

  // Session check: a signed-out panel sends people to the sign-in page instead of failing silently.
  function checkSession() {
    fetch("auth/me", { credentials: "same-origin", cache: "no-store" }).then(function (r) { if (r.status === 401) location.replace("login"); }).catch(function () {});
  }
  setInterval(checkSession, 5 * 60000);

  // ---------- log ----------
  function log(kind, text) {
    var li = document.createElement("li"), t = new Date();
    li.innerHTML = "<time>" + t.toLocaleTimeString() + '</time><span class="k-' + esc(kind) + '">' + esc(text) + "</span>";
    var ul = $("log");
    ul.insertBefore(li, ul.firstChild);
    while (ul.children.length > 150) ul.removeChild(ul.lastChild);
  }
  Bus.on("evt", function (d) { log(d.kind || "info", d.text || ""); });

  // ---------- auctions ----------
  function pct(a) { return a.targetBidCount ? Math.min(100, (a.activeBidCount / a.targetBidCount) * 100) : 100; }

  function renderAuctions() {
    var box = $("auctions");
    if (!auctions.length) { box.innerHTML = '<div class="muted">No live auctions right now.</div>'; return; }
    box.innerHTML = auctions.map(function (a) {
      var img = a.imageUrl ? '<img src="' + esc(a.imageUrl) + '" alt="">' : '<div class="ph">🎁</div>';
      var count = a.targetBidCount ? a.activeBidCount + " / " + a.targetBidCount : a.activeBidCount + " (time-based)";
      return '<button type="button" class="auc' + (a.id === onair ? " air" : "") + '" data-id="' + a.id + '">' + img +
        '<span class="t">' + (a.id === onair ? "🔴 " : "") + esc(a.title) + "</span>" +
        '<span class="m">#' + esc(a.shortCode) + " · " + esc(count) + " bids · fee " + esc(U.money(a.tenderFeeAmount, a.currency)) + "</span>" +
        '<span class="bar' + (a.targetBidCount ? "" : " tb") + '"><i style="width:' + pct(a).toFixed(1) + '%"></i></span></button>';
    }).join("");
  }

  function loadAuctions() {
    return G.listAuctions().then(function (list) {
      apiError = false; apiPill();
      auctions = list;
      if (!onair || !list.some(function (a) { return a.id === onair; })) {
        if (list.length && !(onair && lastState && lastState.auctionId === onair)) putOnAir(list[0].id, true);
      }
      renderAuctions(); renderOnAir();
    }).catch(function (e) {
      if (e.status === 401) { location.replace("login"); return; }
      apiError = true; apiPill();
      $("auctions").innerHTML = '<div class="err-box">Couldn\'t load auctions: ' + esc(e.message) +
        "<br>The studio server reaches the GOLOW API itself; check its GOLOW_API_URL and that the API is up.</div>";
      log("error", "Auction list: " + e.message);
    });
  }

  $("auctions").addEventListener("click", function (e) {
    var b = e.target.closest(".auc");
    if (b) putOnAir(Number(b.getAttribute("data-id")));
  });
  $("refresh").addEventListener("click", loadAuctions);

  function putOnAir(id, auto) {
    onair = id;
    G.lsSet("golow.onair", id);
    Bus.send("switch", { auctionId: id });
    var a = auctions.find(function (x) { return x.id === id; });
    log("onair", (auto ? "Auto on air: " : "On air: ") + (a ? a.title : "#" + id));
    renderAuctions(); renderUrls(); renderOnAir();
  }

  G.live.on(function (type, p) {
    if (type === "bidCountChanged") {
      var a = auctions.find(function (x) { return x.id === Number(p.auctionId); });
      if (!a) return loadAuctions();
      var delta = p.activeBidCount - a.activeBidCount;
      a.activeBidCount = p.activeBidCount;
      if (a.id === onair && delta > 0) log("bid", "+" + delta + " bid" + (delta > 1 ? "s" : "") + " → " + a.activeBidCount);
      renderAuctions(); renderOnAir();
    } else if (type === "auctionClosed" || type === "auctionFinalized" || type === "auctionCancelled" || type === "auctionStarted") {
      var name = { auctionClosed: "closed", auctionFinalized: "finalized", auctionCancelled: "cancelled", auctionStarted: "started" }[type];
      if (Number(p.auctionId) === onair) log(name, "On-air auction " + name);
      loadAuctions();
    } else if (type === "reconnected") loadAuctions();
  });
  G.live.joinList();

  // ---------- on air ----------
  Bus.on("state", function (d) { lastState = d; lastBeat = Date.now(); });

  function renderOnAir() {
    var a = auctions.find(function (x) { return x.id === onair; });
    var beat = Date.now() - lastBeat < 7000 && lastState && lastState.auctionId === onair ? lastState : null;
    var title = beat ? beat.title : a ? a.title : onair ? "#" + onair : "—";
    var count = beat ? beat.count : a ? a.activeBidCount : 0;
    var target = beat ? beat.target : a ? a.targetBidCount : null;
    var status = beat ? beat.status : a ? a.status : "";
    $("oaTitle").textContent = (onair ? "🔴 " : "") + (title || "—");
    $("oaStats").innerHTML = "<span><b>" + esc(target ? count + " / " + target : count) + "</b> bids</span>" +
      (beat ? "<span><b>" + esc(beat.rate) + "</b> bids/min</span>" : "") + "<span>" + esc(status || "") + "</span>" +
      (beat && beat.cardOn === false ? "<span>card hidden</span>" : "");
    $("oaBar").className = "bar" + (target ? "" : " tb");
    $("oaBar").firstChild.style.width = (target ? Math.min(100, (count / target) * 100) : 100).toFixed(1) + "%";
    $("oaNote").textContent = beat ? "" : onair ? "Overlay not connected yet" : "Pick an auction";
  }

  // ---------- controls ----------
  function setOn(id, on) { $(id).classList.toggle("on", on); }
  $("tRules").addEventListener("click", function () {
    toggles.rules = !toggles.rules; setOn("tRules", toggles.rules);
    Bus.send("rules", { show: toggles.rules }); log("show", "Rules " + (toggles.rules ? "shown" : "hidden"));
  });
  function sendCta() { Bus.send("cta", { show: toggles.cta, text: $("ctaText").value }); }
  $("tCta").addEventListener("click", function () {
    toggles.cta = !toggles.cta; setOn("tCta", toggles.cta); sendCta(); log("show", "Banner " + (toggles.cta ? "shown" : "hidden"));
  });
  $("ctaSet").addEventListener("click", function () { if (!toggles.cta) { toggles.cta = true; setOn("tCta", true); } sendCta(); log("show", "Banner: " + $("ctaText").value); });
  $("tCard").addEventListener("click", function () {
    toggles.card = !toggles.card; setOn("tCard", toggles.card);
    Bus.send("card", { show: toggles.card }); log("show", "Auction card " + (toggles.card ? "shown" : "hidden"));
  });
  $("bHype").addEventListener("click", function () { Bus.send("hype", { seconds: 10 }); log("show", "Hype countdown"); });
  $("bMute").addEventListener("click", function () {
    toggles.mute = !toggles.mute; setOn("bMute", toggles.mute);
    Bus.send("mutebids", { on: toggles.mute }); log("show", "Bid alerts " + (toggles.mute ? "muted" : "on"));
  });
  $("bTest").addEventListener("click", function () { Bus.send("testbid", {}); log("show", "Test bid alert"); });

  function flash(text, seconds) {
    if (!text.trim()) return;
    Bus.send("message", { text: text, seconds: seconds || Number($("msgDur").value) });
    log("message", "Message: " + text.replace(/\n/g, " / "));
  }
  $("msgGo").addEventListener("click", function () { flash($("msg").value); });
  function lines(box, list) {
    $(box).innerHTML = list.map(function (l, i) { return '<button type="button" data-i="' + i + '">' + esc(l) + "</button>"; }).join("");
    $(box).addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) flash(list[Number(b.getAttribute("data-i"))]); });
  }
  lines("quick", T.quick);
  lines("script", T.script);

  $("rvGo").addEventListener("click", function () {
    if (!onair) return log("error", "Pick an auction first");
    Bus.send("reveal", { auctionId: onair, speed: 1 }); log("reveal", "Reveal requested");
    // A freshly loaded preview missed the bus message, so it starts from its URL instead.
    if (pvScene !== "reveal") selectPreview("reveal", "auction=" + onair);
  });
  $("rvHide").addEventListener("click", function () { Bus.send("reveal", { hide: true }); log("reveal", "Reveal hidden"); });
  $("wGo").addEventListener("click", function () { Bus.send("winner", { show: true }); log("winner", "Show winner"); });
  $("wHide").addEventListener("click", function () { Bus.send("winner", { show: false }); log("winner", "Hide winner"); });

  $("voice").value = Sound.mode();
  $("vol").value = Sound.volume();
  function sendVoice() {
    var d = { mode: $("voice").value, volume: Number($("vol").value) };
    Sound.set(d); Bus.send("voice", d);
  }
  $("voice").addEventListener("change", function () { sendVoice(); log("show", "Sound: " + $("voice").selectedOptions[0].textContent); });
  $("vol").addEventListener("change", sendVoice);

  // ---------- OBS links (signed scene keys) and preview ----------
  function sceneUrl(page, extra) {
    var q = [];
    if (page === "overlay" && onair) q.push("auction=" + onair);
    if (sceneKey) q.push("key=" + encodeURIComponent(sceneKey.key));
    if (extra) q.push(extra);
    return base + page + ".html" + (q.length ? "?" + q.join("&") : "");
  }

  function renderUrls() {
    $("uOverlay").value = sceneUrl("overlay");
    $("uBoard").value = sceneUrl("board");
    $("uReveal").value = sceneUrl("reveal");
    $("uPanel").value = base;
    if (sceneKey) {
      var days = Math.round((sceneKey.expiresAt * 1000 - Date.now()) / 86400000);
      $("keyNote").textContent = "Scene links work for " + days + " more day" + (days === 1 ? "" : "s") + " (until " + new Date(sceneKey.expiresAt * 1000).toLocaleDateString() + ").";
    }
  }

  function loadKey() {
    var cached = null;
    try { cached = JSON.parse(G.lsGet("golow.scenekey") || "null"); } catch (e) { cached = null; }
    // Reuse a key with more than 3 days left, so the links already in OBS keep matching.
    if (cached && cached.expiresAt * 1000 - Date.now() > 3 * 86400000) { sceneKey = cached; renderUrls(); return; }
    fetch("auth/scene-key", { method: "POST", credentials: "same-origin" }).then(function (r) {
      if (r.status === 401) { location.replace("login"); return null; }
      return r.json();
    }).then(function (k) {
      if (!k || !k.key) return;
      sceneKey = k; G.lsSet("golow.scenekey", JSON.stringify(k)); renderUrls();
    }).catch(function () { $("keyNote").textContent = "Couldn't create scene links. Reload the page."; });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]");
    if (!b) return;
    var input = $(b.getAttribute("data-copy"));
    (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).catch(function () { input.select(); document.execCommand("copy"); });
    b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1200);
  });

  function selectPreview(scene, extra) {
    pvScene = scene;
    document.querySelectorAll("[data-pv]").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-pv") === scene); });
    $("pvFrame").src = sceneUrl(scene, "role=preview&preview=1" + (extra ? "&" + extra : ""));
  }
  document.querySelectorAll("[data-pv]").forEach(function (b) { b.addEventListener("click", function () { selectPreview(b.getAttribute("data-pv")); }); });

  function fitPreview() {
    var box = $("pv"), f = $("pvFrame");
    f.style.transform = "scale(" + Math.min(box.clientWidth / 1080, box.clientHeight / 1920) + ")";
  }
  window.addEventListener("resize", fitPreview);

  // ---------- start ----------
  renderUrls(); fitPreview(); loadKey(); loadAuctions();
  selectPreview("overlay");
  setTimeout(function () { Bus.send("ping", {}); }, 500);
  log("info", "Panel ready");
})();
