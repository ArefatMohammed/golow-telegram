/* overlay.html: the main OBS scene (auction card, bid alerts, rules, banner, messages, hype, winner). */
(function () {
  "use strict";
  var G = window.Golow, U = G.util, T = window.GolowText, Bus = window.GolowBus, Sound = window.GolowSound, Fx = window.GolowFx;
  var esc = U.esc;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);

  var state = { id: null, a: null, count: 0, target: null, done: false, mute: false, cardOn: true };
  var rate = new U.RateWindow(60000);
  var queue = new U.AlertQueue(3000, alertBids);
  var timers = { message: null, rules: null, cta: null, winner: null, hype: null, poll: null };

  // ---------- render ----------
  function leftCount() { return state.target ? Math.max(0, state.target - state.count) : null; }

  function renderCount() {
    var left = leftCount();
    $("count").textContent = state.target ? state.count + " / " + state.target + " " + T.bidsUnit : state.count + " " + T.bidsUnit;
    var bar = $("bar");
    bar.classList.toggle("timebased", !state.target);
    bar.firstChild.style.width = state.target ? Math.min(100, (state.count / state.target) * 100).toFixed(1) + "%" : "100%";
    return left;
  }

  function renderCard() {
    var a = state.a;
    if (!a) { $("card").classList.add("hidden"); return; }
    $("card").classList.toggle("hidden", !state.cardOn);
    var img = $("thumb");
    var url = a.imageUrl || (a.imageUrls && a.imageUrls[0]);
    var card = $("card");
    function noThumb() { img.classList.add("hidden"); card.classList.add("nothumb"); }
    if (url) { img.onerror = noThumb; img.src = url; img.classList.remove("hidden"); card.classList.remove("nothumb"); }
    else noThumb();
    $("title").textContent = a.title || "GOLOW";
    $("meta").innerHTML = a.retailPrice != null ? esc(T.retail) + " <b>" + esc(U.money(a.retailPrice, a.currency)) + "</b>" : "";
    $("meta2").innerHTML = esc(T.feePerBid) + " <b>" + esc(U.money(a.tenderFeeAmount, a.currency)) + "</b> · #" + esc(a.shortCode);
    renderCount();
    tick();
  }

  function tick() {
    var a = state.a;
    if (!a) return;
    var remaining = Date.parse(a.endsAt) - U.now();
    var running = U.isLive(a) && !state.done;
    var text = running ? U.fmtCountdown(remaining) : null;
    $("timer").textContent = text || T.done;
    $("card").querySelector(".live").classList.toggle("hidden", !running);
    // "Almost": 1–10 bids left (break-even), or the last 5 minutes (time-based).
    var left = leftCount();
    var almost = running && (state.target ? left >= 1 && left <= 10 : remaining > 0 && remaining <= 300000);
    $("card").classList.toggle("almost", almost);
    var hot = running && rate.count() >= 3;
    $("hot").textContent = T.hot;
    $("hot").classList.toggle("hidden", !hot);
  }

  function setStatus() {
    var s = G.live.status(), el = $("status");
    el.className = "status";
    if (state.error) { el.textContent = "API: " + state.error; el.classList.add("bad"); return; }
    el.textContent = s === "live" ? "● live" : s === "polling" ? "● polling" : "connecting…";
  }

  // ---------- alerts ----------
  function isAlmost() {
    var left = leftCount();
    if (state.target) return left >= 1 && left <= 10;
    var remaining = state.a ? Date.parse(state.a.endsAt) - U.now() : 0;
    return remaining > 0 && remaining <= 300000;
  }

  function alertBids(n) {
    if (state.mute || !state.a) return;
    var c = $("count");
    c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
    var r = $("card").getBoundingClientRect();
    Fx.coins($("fx"), r.left + r.width / 2, r.bottom - 40, 16);
    var left = leftCount();
    var line = state.target ? state.count + " / " + state.target + " — " + T.left(left) : state.count + " " + T.bidsUnit;
    Fx.toast($("toasts"), { am: T.newBid.am + (n > 1 ? " +" + n : ""), en: line });
    Sound.play(isAlmost() ? "almost" : "new-bid", n > 1 ? n + " new bids" : "New bid");
  }

  function onCount(newCount) {
    var delta = newCount - state.count;
    state.count = newCount;
    renderCount();
    if (delta > 0) {
      rate.record(delta);
      if (!state.mute) queue.push(delta);
      heartbeat();
    } else if (delta < 0) heartbeat(); // refunds: silent update
    tick();
  }

  function log(kind, text) { Bus.send("evt", { kind: kind, text: text, auctionId: state.id }); }

  // ---------- panels ----------
  function hide(id) { $(id).classList.add("hidden"); clearTimeout(timers[id]); }

  function showRules(on, seconds) {
    hide("rules");
    if (!on) return;
    hide("message");
    var html = "<h2>" + esc(T.rulesTitle.am) + '<span class="en">' + esc(T.rulesTitle.en) + "</span></h2><ol>";
    T.rules.forEach(function (r, i) {
      html += '<li style="animation-delay:' + (0.25 + i * 0.35) + 's"><span class="n">' + (i + 1) + "</span><span>" + esc(r.am) + '<span class="en">' + esc(r.en) + "</span></span></li>";
    });
    $("rules").innerHTML = html + "</ol>";
    $("rules").classList.remove("hidden");
    Sound.play("rules", "How it works");
    if (seconds) timers.rules = setTimeout(function () { hide("rules"); }, seconds * 1000);
  }

  function linesHtml(text) {
    var lines = String(text || "").split("\n").filter(function (l) { return l.trim(); });
    if (!lines.length) return "";
    return esc(lines[0]) + lines.slice(1).map(function (l) { return '<span class="en">' + esc(l) + "</span>"; }).join("");
  }

  function showMessage(text, seconds) {
    hide("message");
    var html = linesHtml(text);
    if (!html) return;
    hide("rules");
    $("message").innerHTML = html;
    $("message").classList.remove("hidden");
    timers.message = setTimeout(function () { hide("message"); }, (seconds || 10) * 1000);
  }

  var cta = { on: false, text: "", qr: false };

  function showCta(on, text, seconds, qr) {
    hide("cta");
    cta = { on: on, text: text, qr: !!qr };
    if (!on) return;
    renderCta();
    if (seconds) timers.cta = setTimeout(function () { hide("cta"); cta.on = false; }, seconds * 1000);
  }

  function renderCta() {
    var box = $("cta");
    // "Amharic | English" (or two lines). Escaped here, never trusted as HTML.
    var parts = String(cta.text || T.ctaDefault).split(/\s*\|\s*|\n/);
    var html = '<div class="txt">' + linesHtml(parts.join("\n")) + "</div>";
    var bot = (G.config && G.config.botUsername) || "";
    var withQr = cta.qr && state.id && bot;
    if (withQr) {
      // Scan → the GOLOW bot in Telegram → the Mini App opens on this auction.
      var src = "qr.svg?auction=" + state.id + (G.key ? "&key=" + encodeURIComponent(G.key) : "");
      html = '<div class="qr"><img alt="" src="' + esc(src) + '"><small>t.me/' + esc(bot) + "</small></div>" + html;
    }
    box.innerHTML = html;
    box.classList.toggle("has-qr", !!withQr);
    box.classList.remove("hidden");
  }

  function hype(seconds) {
    clearTimeout(timers.hype);
    var n = Math.max(1, Math.min(30, Number(seconds) || 10)), box = $("hype");
    box.classList.remove("hidden");
    (function step() {
      if (n > 0) {
        box.innerHTML = "<span>" + n + "</span>";
        Sound.play("hype");
        n--;
        timers.hype = setTimeout(step, 1000);
      } else {
        box.innerHTML = '<span class="go">' + esc(T.go.am) + "</span>";
        Sound.play("winner", "Bid now!");
        timers.hype = setTimeout(function () { box.classList.add("hidden"); box.innerHTML = ""; }, 1600);
      }
    })();
  }

  function showWinner(on) {
    hide("winner");
    if (!on || !state.id) return;
    G.getAuction(state.id).then(function (a) {
      state.a = a; state.count = a.activeBidCount || state.count; renderCard();
      // Amounts only once the auction is over: the API itself only sends a winner after finalization.
      if (!a.winner || U.isLive(a)) {
        Fx.toast($("toasts"), T.noWinner, { long: true, color: "red" });
        Sound.play("closed", "No unique winning bid");
        log("winner", "No unique winning bid");
        return;
      }
      hide("rules"); hide("message"); Fx.clear($("toasts"));
      $("winner").innerHTML = '<div class="trophy">🏆</div><div class="big">' + esc(T.winner.am) + '<span class="en">' + esc(T.winner.en) + "</span></div>" +
        '<div class="amount">' + esc(U.money(a.winner.amount, a.currency)) + '</div><div class="who">' + esc(a.winner.maskedBidder || "") + "</div>";
      $("winner").classList.remove("hidden");
      Fx.confetti($("fx"), 160);
      Sound.play("winner", "We have a winner!");
      timers.winner = setTimeout(function () { hide("winner"); }, 20000);
      log("winner", "Winner: " + U.money(a.winner.amount, a.currency) + " " + (a.winner.maskedBidder || ""));
    }).catch(function (e) { log("error", "Winner: " + e.message); });
  }

  // ---------- data ----------
  function load(id) {
    if (state.id && state.id !== id) G.live.leaveAuction(state.id);
    queue.clear(); Fx.clear($("toasts"));
    ["rules", "message", "winner"].forEach(hide);
    state = { id: id, a: null, count: 0, target: null, done: false, mute: state.mute, cardOn: state.cardOn, closed: false, finalized: false, cancelled: false };
    rate = new U.RateWindow(60000);
    if (!id) {
      $("card").classList.add("hidden");
      Fx.toast($("toasts"), T.pickAuction, { long: true });
      return;
    }
    G.live.joinAuction(id);
    refetch(true);
    if (cta.on) renderCta();
  }

  function refetch(initial) {
    var id = state.id;
    if (!id) return Promise.resolve();
    return G.getAuction(id).then(function (a) {
      if (state.id !== id) return;
      state.error = null;
      var had = !!state.a;
      state.a = a; state.target = a.targetBidCount || null;
      if (initial || !had) {
        // Already over when we tuned in: no toasts, just the finished card.
        state.done = !U.isLive(a);
        state.closed = state.finalized = U.isFinished(a) || !U.isLive(a);
        state.cancelled = U.isCancelled(a);
        state.count = a.activeBidCount || 0; renderCard();
      } else {
        renderCard(); onCount(a.activeBidCount || 0); // new bids since the last poll alert like live ones
        // Without the hub, status changes are noticed here.
        if (U.isCancelled(a)) onCancelled();
        else if (U.isFinished(a)) onFinalized();
        else if (!U.isLive(a)) onClosed();
      }
      setStatus(); heartbeat();
    }).catch(function (e) {
      state.error = (e.status ? e.status + " " : "") + e.message;
      setStatus();
      log("error", "Auction " + id + ": " + state.error);
    });
  }

  G.live.on(function (type, p) {
    if (type === "reconnected") { refetch(false); return; }
    if (!p || Number(p.auctionId) !== Number(state.id)) return;
    if (type === "bidCountChanged") onCount(Number(p.activeBidCount) || 0);
    else if (type === "auctionClosed") onClosed();
    else if (type === "auctionFinalized") onFinalized();
    else if (type === "auctionCancelled") onCancelled();
    else if (type === "auctionStarted") refetch(false);
  });

  // Each runs once per auction, whether the hub or a poll noticed it first.
  function onClosed() {
    if (state.closed) return;
    state.closed = state.done = true; tick();
    Fx.toast($("toasts"), T.closed, { long: true, color: "red" });
    Sound.play("closed", "Bidding closed");
    log("closed", "Bidding closed");
    heartbeat();
  }
  function onFinalized() {
    if (state.finalized) return;
    var wasClosed = state.closed;
    onClosed();
    state.finalized = true;
    log("finalized", "Finalized");
    // Give the closed toast a moment when both arrive in the same poll.
    setTimeout(function () { showWinner(true); }, wasClosed ? 0 : 2500);
  }
  function onCancelled() {
    if (state.cancelled) return;
    state.cancelled = state.closed = state.finalized = state.done = true; tick();
    Fx.toast($("toasts"), T.cancelled, { long: true, color: "red" });
    Sound.play("closed", "Auction cancelled");
    log("cancelled", "Auction cancelled");
  }

  G.live.onStatus(function (s) {
    setStatus();
    // Without the hub, poll the detail endpoint every 3 s: bids, closing and the winner all come from it.
    clearInterval(timers.poll);
    if (s !== "live") timers.poll = setInterval(function () { refetch(false); }, 3000);
  });

  // ---------- panel commands ----------
  Bus.on("switch", function (d) { var id = Number(d.auctionId) || null; G.lsSet("golow.onair", id); load(id); });
  Bus.on("rules", function (d) { showRules(!!d.show, d.seconds); });
  Bus.on("cta", function (d) { showCta(!!d.show, d.text, d.seconds, d.qr); });
  Bus.on("message", function (d) { showMessage(d.text, d.seconds); });
  Bus.on("card", function (d) { state.cardOn = !!d.show; renderCard(); heartbeat(); });
  Bus.on("hype", function (d) { hype(d.seconds); });
  Bus.on("mutebids", function (d) { state.mute = !!d.on; if (state.mute) queue.clear(); });
  Bus.on("testbid", function () {
    // A rehearsal alert only: the count isn't changed.
    var m = state.mute; state.mute = false; alertBids(1); state.mute = m;
  });
  Bus.on("winner", function (d) { showWinner(d.show !== false); });
  Bus.on("ping", function () { heartbeat(); });

  // ---------- welcome new users ----------
  var welcome = { on: G.lsGet("golow.welcome") !== "0", after: -1, queue: [], showing: false, status: null };

  function pollWelcome() {
    G.getWelcome(welcome.after).then(function (d) {
      welcome.after = d.seq; welcome.status = d.status;
      if (welcome.on) welcome.queue = welcome.queue.concat(d.events || []);
      nextWelcome();
    }).catch(function () { /* the next poll retries */ });
  }

  function nextWelcome() {
    if (welcome.showing || !welcome.queue.length || !welcome.on) return;
    // A burst of sign-ups becomes one popup, so the stream never falls behind.
    var batch = welcome.queue.length > 3 ? welcome.queue.splice(0) : [welcome.queue.shift()];
    var text = batch.length > 1 ? T.welcomeMany(batch.length) : T.welcome(batch[0].name);
    welcome.showing = true;
    Fx.toast($("toasts"), text, { long: true, color: "blue" });
    Sound.play("rules", "Welcome to GOLOW!");
    log("welcome", batch.length > 1 ? "Welcomed " + batch.length + " new members" : "Welcomed " + (batch[0].name || "a new member") + " (" + batch[0].source + ")");
    setTimeout(function () { welcome.showing = false; nextWelcome(); }, 4500);
  }

  setInterval(pollWelcome, 5000);
  pollWelcome();
  Bus.on("welcome", function (d) { welcome.on = !!d.on; G.lsSet("golow.welcome", welcome.on ? null : "0"); if (!welcome.on) welcome.queue = []; heartbeat(); });
  Bus.on("testwelcome", function () { if (!welcome.on) return; welcome.queue.push({ name: "Abebe K.", source: "test" }); nextWelcome(); });

  // ---------- heartbeat ----------
  function heartbeat() {
    var a = state.a;
    Bus.send("state", {
      auctionId: state.id, title: a ? a.title : null, count: state.count, target: state.target,
      status: a ? a.status : null, endsAt: a ? a.endsAt : null, rate: rate.count(), done: state.done, cardOn: state.cardOn,
      welcomeOn: welcome.on, welcomeStatus: welcome.status
    });
  }
  setInterval(heartbeat, 3000);
  setInterval(tick, 1000);
  document.addEventListener("click", function () { Sound.unlock(); });

  var first = Number(params.get("auction")) || Number(G.lsGet("golow.onair")) || null;
  load(first);
})();
