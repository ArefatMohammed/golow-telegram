/* index.html: the host's control panel. It only sends commands on the bus; each scene fetches its own data. */
(function () {
  "use strict";
  var G = window.Golow, U = G.util, T = window.GolowText, Bus = window.GolowBus, Sound = window.GolowSound;
  var P = window.GolowPlatform, Obs = window.GolowObs;
  var esc = U.esc;
  var $ = function (id) { return document.getElementById(id); };
  var base = location.origin + location.pathname.replace(/[^/]*$/, "");
  var cfg = G.config || {};

  var auctions = [], onair = Number(G.lsGet("golow.onair")) || null;
  var lastState = null, lastBeat = 0, sceneKey = null, pvScene = "overlay", apiError = false;
  var platform = P.all[G.lsGet("golow.platform")] ? G.lsGet("golow.platform") : "tiktok";
  var toggles = { card: true, rules: false, cta: false, qr: G.lsGet("golow.qr") === "1", welcome: G.lsGet("golow.welcome") !== "0", mute: false };

  // ---------- header ----------
  var isProd = cfg.environment === "prod";
  $("env").textContent = isProd ? "PRODUCTION" : "DEV";
  $("env").className = "env " + (isProd ? "prod" : "dev");
  document.title = (isProd ? "" : "[DEV] ") + "GOLOW Live Studio";
  var name = cfg.user && cfg.user.name ? cfg.user.name : "";
  $("who").textContent = name;
  $("avatar").textContent = name.split(/\s+/).map(function (w) { return w[0] || ""; }).join("").slice(0, 2).toUpperCase() || "A";
  $("logout").addEventListener("click", function () {
    fetch("auth/logout", { method: "POST", credentials: "same-origin" }).finally(function () { location.replace("login"); });
  });

  function chip(id, cls, text, title) { var c = $(id); c.className = "chip " + cls; c.textContent = text; c.title = title || ""; }

  function apiPill() {
    var s = G.live.status();
    if (apiError) return chip("apiPill", "bad", "API error", "The studio server can't load auctions from " + (cfg.apiHost || "the API"));
    chip("apiPill", s === "live" ? "ok" : s === "polling" ? "ok" : "", "API · " + (cfg.apiHost || ""),
      s === "live" ? "Live events from the API hub" : s === "polling" ? "No live-events hub on the API: refreshing every few seconds" : "Connecting…");
  }
  G.live.onStatus(apiPill);

  setInterval(function () {
    var ok = Date.now() - lastBeat < 7000;
    chip("ovPill", ok ? "ok" : "", ok ? "Overlay" : "Overlay not seen", ok ? "An overlay is running in this browser/OBS" : "No overlay has reported in the last 7 s");
    renderOnAir();
  }, 1000);

  // A signed-out panel goes to the sign-in page instead of failing silently.
  setInterval(function () {
    fetch("auth/me", { credentials: "same-origin", cache: "no-store" }).then(function (r) { if (r.status === 401) location.replace("login"); }).catch(function () {});
  }, 5 * 60000);

  // ---------- log ----------
  function log(kind, text) {
    var li = document.createElement("li");
    li.innerHTML = "<time>" + new Date().toLocaleTimeString() + '</time><span class="k-' + esc(kind) + '">' + esc(text) + "</span>";
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
      var count = a.targetBidCount ? a.activeBidCount + " / " + a.targetBidCount : a.activeBidCount + " · time-based";
      return '<button type="button" class="auc' + (a.id === onair ? " air" : "") + '" data-id="' + a.id + '">' + img +
        '<span class="t">' + (a.id === onair ? "🔴 " : "") + esc(a.title) + "</span>" +
        '<span class="m">#' + esc(a.shortCode) + " · " + esc(count) + " bids · " + esc(U.money(a.tenderFeeAmount, a.currency)) + "</span>" +
        '<span class="bar' + (a.targetBidCount ? "" : " tb") + '"><i style="width:' + pct(a).toFixed(1) + '%"></i></span></button>';
    }).join("");
  }

  function loadAuctions() {
    return G.listAuctions().then(function (list) {
      apiError = false; apiPill();
      auctions = list;
      // Only when nothing is on air: an auction that just ended leaves the list but stays on air for its result.
      if (!onair && list.length) putOnAir(list[0].id, true);
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
    } else if (/^auction(Closed|Finalized|Cancelled|Started)$/.test(type)) {
      if (Number(p.auctionId) === onair) log("closed", "On-air auction " + type.slice(7).toLowerCase());
      loadAuctions();
    } else if (type === "reconnected") loadAuctions();
  });
  G.live.joinList();
  setInterval(function () { if (G.live.status() !== "live") loadAuctions(); }, 5000);

  // ---------- on air ----------
  Bus.on("state", function (d) { lastState = d; lastBeat = Date.now(); });

  function tile(value, label) { return '<div class="tile"><b>' + esc(value) + "</b><span>" + esc(label) + "</span></div>"; }

  function renderOnAir() {
    var a = auctions.find(function (x) { return x.id === onair; });
    var beat = Date.now() - lastBeat < 7000 && lastState && lastState.auctionId === onair ? lastState : null;
    var title = beat ? beat.title : a ? a.title : onair ? "#" + onair : "Pick an auction";
    var count = beat ? beat.count : a ? a.activeBidCount : 0;
    var target = beat ? beat.target : a ? a.targetBidCount : null;
    var status = beat ? beat.status : a ? a.status : "—";
    var running = !beat || !beat.done;
    $("oaTitle").textContent = title || "—";
    $("oaLive").classList.toggle("off", !onair || !running);
    $("oaLive").textContent = !onair ? "OFF AIR" : running ? "ON AIR" : "ENDED";
    var img = $("oaImg");
    if (a && a.imageUrl) { if (img.getAttribute("src") !== a.imageUrl) img.src = a.imageUrl; img.classList.remove("hidden"); } else if (!a) img.classList.add("hidden");
    $("oaTiles").innerHTML = tile(count, "bids") + tile(target ? Math.max(0, target - count) : "—", target ? "left of " + target : "time-based") +
      tile(beat ? beat.rate : "—", "bids / min") + tile(status || "—", "status");
    $("oaBar").className = "bar" + (target ? "" : " tb");
    $("oaBar").firstChild.style.width = (target ? Math.min(100, (count / target) * 100) : 100).toFixed(1) + "%";
    $("oaNote").textContent = beat ? (beat.cardOn === false ? "Auction card hidden on stream" : "") : onair ? "Overlay not connected yet" : "";
    var warn = beat && beat.welcomeOn && beat.welcomeStatus && beat.welcomeStatus !== "ok";
    $("oaWarn").classList.toggle("hidden", !warn);
    $("oaWarn").textContent = warn ? "Welcome popups cover Telegram sign-ups only until an admin signs in to this panel again (the server lost its GOLOW admin session)." : "";
  }

  // ---------- controls ----------
  function setOn(id, on) { var b = $(id); b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false"); }
  function sendCta() { Bus.send("cta", { show: toggles.cta, text: $("ctaText").value, qr: toggles.qr }); }

  var SWITCHES = {
    tCard: ["card", function () { Bus.send("card", { show: toggles.card }); return "Auction card " + (toggles.card ? "shown" : "hidden"); }],
    tRules: ["rules", function () { Bus.send("rules", { show: toggles.rules }); return "Rules " + (toggles.rules ? "shown" : "hidden"); }],
    tCta: ["cta", function () { sendCta(); return "Banner " + (toggles.cta ? "shown" : "hidden"); }],
    tQr: ["qr", function () { G.lsSet("golow.qr", toggles.qr ? "1" : null); if (toggles.cta) sendCta(); return "QR code on banner " + (toggles.qr ? "on" : "off"); }],
    tWelcome: ["welcome", function () { G.lsSet("golow.welcome", toggles.welcome ? null : "0"); Bus.send("welcome", { on: toggles.welcome }); return "Welcome popups " + (toggles.welcome ? "on" : "off"); }],
    bMute: ["mute", function () { Bus.send("mutebids", { on: toggles.mute }); return "Bid alerts " + (toggles.mute ? "muted" : "on"); }]
  };
  Object.keys(SWITCHES).forEach(function (id) {
    var key = SWITCHES[id][0];
    setOn(id, toggles[key]);
    $(id).addEventListener("click", function () { toggles[key] = !toggles[key]; setOn(id, toggles[key]); log("show", SWITCHES[id][1]()); });
  });
  if (!cfg.botUsername) { $("tQr").disabled = true; $("tQr").title = "Set BOT_USERNAME on the server"; }

  $("ctaSet").addEventListener("click", function () { if (!toggles.cta) { toggles.cta = true; setOn("tCta", true); } sendCta(); log("show", "Banner: " + $("ctaText").value); });
  $("bHype").addEventListener("click", function () { Bus.send("hype", { seconds: 10 }); log("show", "Hype countdown"); });
  $("bTest").addEventListener("click", function () { Bus.send("testbid", {}); log("show", "Test bid alert"); });
  $("bTestWelcome").addEventListener("click", function () { Bus.send("testwelcome", {}); log("show", "Test welcome"); });

  var msgSeconds = 10;
  $("msgDur").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    msgSeconds = Number(b.getAttribute("data-v"));
    this.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
  });
  function flash(text) {
    if (!text.trim()) return;
    Bus.send("message", { text: text, seconds: msgSeconds });
    log("message", "Message: " + text.replace(/\n/g, " / "));
  }
  $("msgGo").addEventListener("click", function () { flash($("msg").value); });
  function lines(box, list) {
    $(box).innerHTML = list.map(function (l, i) { return '<button type="button" data-i="' + i + '">' + esc(l) + "</button>"; }).join("");
    $(box).addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) flash(list[Number(b.getAttribute("data-i"))]); });
  }
  lines("quick", T.quick);
  lines("script", T.script);

  // ---------- results (+ OBS scene switch) ----------
  var backTimer = null;
  $("rvGo").addEventListener("click", function () {
    if (!onair) return log("error", "Pick an auction first");
    Bus.send("reveal", { auctionId: onair, speed: 1 }); log("reveal", "Reveal requested");
    // A freshly loaded preview missed the bus message, so it starts from its URL instead.
    if (pvScene !== "reveal") selectPreview("reveal", "auction=" + onair);
    var target = $("obsReveal").value, os = Obs.state();
    if (target && os.connected && os.scene !== target) {
      var previous = os.scene, after = Number($("obsBack").value);
      Obs.setScene(target).then(function () {
        log("obs", "OBS → " + target);
        clearTimeout(backTimer);
        if (after > 0 && previous) backTimer = setTimeout(function () { Obs.setScene(previous).then(function () { log("obs", "OBS → " + previous); }).catch(function () {}); }, after * 1000);
      }).catch(function (e) { log("error", "OBS: " + e.message); });
    }
  });
  $("rvHide").addEventListener("click", function () { Bus.send("reveal", { hide: true }); log("reveal", "Reveal hidden"); });
  $("wGo").addEventListener("click", function () { Bus.send("winner", { show: true }); log("winner", "Show winner"); });
  $("wHide").addEventListener("click", function () { Bus.send("winner", { show: false }); log("winner", "Hide winner"); });

  // ---------- sound ----------
  $("voice").value = Sound.mode();
  $("vol").value = Sound.volume();
  function sendVoice() { var d = { mode: $("voice").value, volume: Number($("vol").value) }; Sound.set(d); Bus.send("voice", d); }
  $("voice").addEventListener("change", function () { sendVoice(); log("show", "Sound: " + $("voice").selectedOptions[0].textContent); });
  $("vol").addEventListener("change", sendVoice);

  // ---------- OBS ----------
  var obsCfg = {};
  try { obsCfg = JSON.parse(G.lsGet("golow.obs") || "{}") || {}; } catch (e) { obsCfg = {}; }
  if (obsCfg.url) $("obsUrl").value = obsCfg.url;
  if (obsCfg.password) $("obsPass").value = obsCfg.password;
  if (obsCfg.back != null) $("obsBack").value = String(obsCfg.back);
  function saveObs() {
    obsCfg = { url: $("obsUrl").value.trim(), password: $("obsPass").value, reveal: $("obsReveal").value || obsCfg.reveal || "", back: Number($("obsBack").value), auto: obsCfg.auto };
    G.lsSet("golow.obs", JSON.stringify(obsCfg));
  }
  $("obsConnect").addEventListener("click", function () { obsCfg.auto = true; saveObs(); Obs.connect($("obsUrl").value.trim(), $("obsPass").value); });
  $("obsDisconnect").addEventListener("click", function () { obsCfg.auto = false; saveObs(); Obs.disconnect(); });
  $("obsReveal").addEventListener("change", function () { obsCfg.reveal = this.value; saveObs(); });
  $("obsBack").addEventListener("change", saveObs);
  $("obsScenes").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-scene]"); if (!b) return;
    var s = b.getAttribute("data-scene");
    Obs.setScene(s).then(function () { log("obs", "OBS → " + s); }).catch(function (err) { log("error", "OBS: " + err.message); });
  });

  var lastObs = { streaming: null, connected: null };
  Obs.onChange(function (s) {
    var st = $("obsStatus");
    st.className = "obs-status" + (s.streaming ? " live" : "") + (s.error && !s.connected ? " err" : "");
    st.textContent = s.connected
      ? (s.streaming ? "● LIVE " + (s.timecode ? s.timecode.split(".")[0] : "") : "Connected · not streaming") + (s.recording ? " · REC" : "") + (s.scene ? " · " + s.scene : "")
      : s.connecting ? "Connecting to OBS…" : s.error || "Not connected";
    chip("obsPill", s.streaming ? "live" : s.connected ? "ok" : s.error && obsCfg.auto ? "warn" : "",
      s.streaming ? "LIVE " + (s.timecode ? s.timecode.split(".")[0] : "") : s.connected ? "OBS" : "OBS off", s.error || "");
    $("obsScenes").innerHTML = s.connected && s.scenes.length
      ? s.scenes.map(function (n) { return '<button type="button" data-scene="' + esc(n) + '" class="' + (n === s.scene ? "on" : "") + '">' + esc(n) + "</button>"; }).join("")
      : '<span class="muted small">' + (s.connected ? "No scenes." : "Connect to see your scenes.") + "</span>";
    var sel = $("obsReveal"), keep = obsCfg.reveal || sel.value;
    var names = [""].concat(s.scenes);
    if (keep && names.indexOf(keep) < 0) names.push(keep);
    sel.innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">' + (n ? esc(n) : "Don't switch") + "</option>"; }).join("");
    sel.value = keep || "";
    if (lastObs.connected !== null && s.connected !== lastObs.connected) log("obs", s.connected ? "OBS connected" : "OBS disconnected");
    if (lastObs.streaming !== null && s.streaming !== lastObs.streaming) log("obs", s.streaming ? "OBS started streaming" : "OBS stopped streaming");
    lastObs = { streaming: s.streaming, connected: s.connected };
  });
  if (obsCfg.auto && obsCfg.url) Obs.connect(obsCfg.url, obsCfg.password || "");

  // ---------- platform, scene links (signed keys) and preview ----------
  $("platform").innerHTML = Object.keys(P.all).map(function (id) { return '<option value="' + id + '">' + esc(P.all[id].name) + "</option>"; }).join("");
  $("platform").value = platform;
  $("platform").addEventListener("change", function () {
    platform = this.value; G.lsSet("golow.platform", platform);
    log("show", "Layout: " + P.all[platform].name + " — copy the scene links again for OBS");
    renderUrls(); selectPreview(pvScene);
  });

  function sceneUrl(page, extra) {
    var q = [];
    if (page === "overlay" && onair) q.push("auction=" + onair);
    if (platform !== "tiktok") q.push("platform=" + platform);
    if (sceneKey) q.push("key=" + encodeURIComponent(sceneKey.key));
    if (extra) q.push(extra);
    return base + page + ".html" + (q.length ? "?" + q.join("&") : "");
  }

  function renderUrls() {
    $("uOverlay").value = sceneUrl("overlay");
    $("uBoard").value = sceneUrl("board");
    $("uReveal").value = sceneUrl("reveal");
    $("uPanel").value = base;
    var p = P.all[platform];
    $("guideCanvas").textContent = p.w + "×" + p.h;
    if (sceneKey) {
      var days = Math.round((sceneKey.expiresAt * 1000 - Date.now()) / 86400000);
      $("keyNote").textContent = "Scene links work for " + days + " more day" + (days === 1 ? "" : "s") + " (until " + new Date(sceneKey.expiresAt * 1000).toLocaleDateString() + "). Canvas " + p.w + "×" + p.h + ".";
    }
  }

  function loadKey() {
    var cached = null;
    try { cached = JSON.parse(G.lsGet("golow.scenekey") || "null"); } catch (e) { cached = null; }
    // Reuse a key with more than 3 days left, so the links already in OBS keep matching.
    if (cached && cached.env === cfg.environment && cached.expiresAt * 1000 - Date.now() > 3 * 86400000) { sceneKey = cached; renderUrls(); return; }
    fetch("auth/scene-key", { method: "POST", credentials: "same-origin" }).then(function (r) {
      if (r.status === 401) { location.replace("login"); return null; }
      return r.json();
    }).then(function (k) {
      if (!k || !k.key) return;
      k.env = cfg.environment;
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
    var p = P.all[platform], f = $("pvFrame");
    $("pv").classList.toggle("landscape", p.w > p.h);
    f.style.width = p.w + "px"; f.style.height = p.h + "px";
    f.src = sceneUrl(scene, "role=preview&preview=1" + (extra ? "&" + extra : ""));
    fitPreview();
  }
  document.querySelectorAll("[data-pv]").forEach(function (b) { b.addEventListener("click", function () { selectPreview(b.getAttribute("data-pv")); }); });

  function fitPreview() {
    var box = $("pv"), p = P.all[platform];
    $("pvFrame").style.transform = "scale(" + Math.min(box.clientWidth / p.w, box.clientHeight / p.h) + ")";
  }
  window.addEventListener("resize", fitPreview);

  // ---------- start ----------
  renderUrls(); loadKey(); loadAuctions(); renderOnAir();
  selectPreview("overlay");
  setTimeout(function () { Bus.send("ping", {}); if (toggles.welcome === false) Bus.send("welcome", { on: false }); }, 500);
  log("info", "Panel ready · " + (isProd ? "production" : "dev") + " · " + (cfg.apiHost || ""));
})();
