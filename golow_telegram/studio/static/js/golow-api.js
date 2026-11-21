/* window.Golow: config, REST client (through the studio's read-only proxy), SignalR live events, helpers. Classic script (no modules) so pages run as OBS Browser Sources. */
(function () {
  "use strict";

  var cfg = window.GOLOW_STUDIO || {};
  var params = new URLSearchParams(location.search);

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) { /* private mode */ } }

  var key = params.get("key") || "";
  var role = params.get("role") || "";

  // ---------- helpers ----------
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function money(amount, currency) {
    var n = Number(amount);
    if (amount == null || !isFinite(n)) return "—";
    return (currency || "ETB") + " " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  /** "Nd HH:MM:SS" (days only when > 0); null when the time is up. */
  function fmtCountdown(ms) {
    if (!(ms > 0)) return null;
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400);
    s -= d * 86400;
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (d > 0 ? d + "d " : "") + pad(h) + ":" + pad(m) + ":" + pad(sec);
  }

  function statusIs(a, name) { return !!a && String(a.status || "").toLowerCase() === name.toLowerCase(); }
  // The API calls an auction in progress "Active" ("Live" in older docs). A finished one is "Ended" with an
  // outcome (WinnerDeclared / NoUniqueBid), or "Settled".
  function isLive(a) { return statusIs(a, "active") || statusIs(a, "live"); }
  function isFinished(a) { return !!a && (!!a.outcome || statusIs(a, "settled") || statusIs(a, "finalized")); }
  function isCancelled(a) { return statusIs(a, "cancelled"); }

  // Server clock skew (server UTC − local clock), from JoinAuction results and REST serverTimeUtc.
  var skew = 0;
  function noteServerTime(t) { var ms = Date.parse(t); if (isFinite(ms)) skew = ms - Date.now(); }
  function now() { return Date.now() + skew; }

  /** Alerts at most one per `interval` ms; a backlog collapses into one "+N" so the stream never lags. */
  function AlertQueue(interval, emit, clock) {
    this.interval = interval; this.emit = emit; this.clock = clock || Date.now;
    this.pending = 0; this.last = -Infinity; this.timer = null;
  }
  AlertQueue.prototype.push = function (n) {
    this.pending += n;
    if (this.timer) return;
    var self = this, wait = Math.max(0, this.last + this.interval - this.clock());
    this.timer = setTimeout(function () { self.timer = null; self.flush(); }, wait);
  };
  AlertQueue.prototype.flush = function () {
    if (this.pending <= 0) return;
    var n = this.pending;
    this.pending = 0; this.last = this.clock();
    this.emit(n);
  };
  AlertQueue.prototype.clear = function () { clearTimeout(this.timer); this.timer = null; this.pending = 0; };

  /** Bids in the last `windowMs` (default 60 s). */
  function RateWindow(windowMs) { this.windowMs = windowMs || 60000; this.hits = []; }
  RateWindow.prototype.record = function (n, t) { t = t == null ? Date.now() : t; for (var i = 0; i < n; i++) this.hits.push(t); this.prune(t); };
  RateWindow.prototype.prune = function (t) { var cut = t - this.windowMs; while (this.hits.length && this.hits[0] <= cut) this.hits.shift(); if (this.hits.length > 5000) this.hits.splice(0, this.hits.length - 5000); };
  RateWindow.prototype.count = function (t) { this.prune(t == null ? Date.now() : t); return this.hits.length; };

  /** Reveal step: about 22 s spread over the rows before the winner, 350–1500 ms per row, divided by speed. */
  function revealStep(rowsBeforeWinner, speed) {
    var step = Math.min(1500, Math.max(350, 22000 / Math.max(1, rowsBeforeWinner)));
    return step / Math.max(0.1, Number(speed) || 1);
  }

  // ---------- REST (through /studio/api, so no CORS setup is needed on the API) ----------
  function HttpError(status, message) { this.status = status; this.message = message; }
  HttpError.prototype = Object.create(Error.prototype);

  function get(path) {
    var headers = key ? { "X-Studio-Key": key } : {};
    return fetch("api/" + path, { headers: headers, credentials: "same-origin", cache: "no-store" }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok || body.success === false) throw new HttpError(r.status, (body && body.message) || ("HTTP " + r.status));
        if (body.data && body.data.serverTimeUtc) noteServerTime(body.data.serverTimeUtc);
        return body.data;
      });
    });
  }

  var rest = {
    listAuctions: function () { return get("auctions?status=Active&pageSize=50").then(function (d) { return (d && d.items) || []; }); },
    getAuction: function (id) { return get("auctions/" + Number(id)); },
    getResult: function (id) { return get("auctions/" + Number(id) + "/result"); },
    /** All bid groups, lowest amount first (up to 5 pages of 100). 403 until the auction is finalized. */
    getBidGroups: function (id) {
      var items = [], total = 0;
      function page(n) {
        return get("auctions/" + Number(id) + "/bids?page=" + n + "&pageSize=100").then(function (d) {
          var got = (d && d.items) || [];
          items = items.concat(got); total = (d && d.totalCount) || items.length;
          if (got.length === 100 && items.length < total && n < 5) return page(n + 1);
          return { items: items, totalCount: total };
        });
      }
      return page(1);
    }
  };

  // ---------- live events ----------
  var EVENTS = ["bidCountChanged", "auctionClosed", "auctionStarted", "auctionFinalized", "auctionCancelled"];
  var listeners = [], statusListeners = [];
  var status = "connecting";
  function setStatus(s) { if (s === status) return; status = s; statusListeners.forEach(function (fn) { try { fn(s); } catch (e) { console.error(e); } }); }
  function dispatch(type, payload) {
    if (payload && payload.serverTimeUtc) noteServerTime(payload.serverTimeUtc);
    listeners.slice().forEach(function (fn) { try { fn(type, payload || {}); } catch (e) { console.error(e); } });
  }

  var groups = { auctions: {}, list: false };
  var conn = null, starting = false;

  function loadSignalR() {
    if (window.signalR) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@microsoft/signalr@8.0.7/dist/browser/signalr.min.js";
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Couldn't load the SignalR client")); };
      document.head.appendChild(s);
    });
  }

  function rejoin() {
    if (!conn || conn.state !== "Connected") return;
    Object.keys(groups.auctions).forEach(function (id) {
      conn.invoke("JoinAuction", Number(id)).then(function (t) { if (t) noteServerTime(t); }).catch(function (e) { console.warn("JoinAuction", e); });
    });
    if (groups.list) conn.invoke("JoinAuctionList").then(function (t) { if (t) noteServerTime(t); }).catch(function (e) { console.warn("JoinAuctionList", e); });
  }

  function start() {
    if (starting || !cfg.hubUrl) return;
    starting = true;
    loadSignalR().then(function () {
      if (!conn) {
        // WebSockets + skipNegotiation: no negotiate request, so no CORS preflight.
        conn = new signalR.HubConnectionBuilder()
          .withUrl(cfg.hubUrl, { skipNegotiation: true, transport: signalR.HttpTransportType.WebSockets })
          .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
          .configureLogging(signalR.LogLevel.Warning)
          .build();
        EVENTS.forEach(function (ev) { conn.on(ev, function (p) { dispatch(ev, p); }); });
        conn.onreconnecting(function () { setStatus("polling"); });
        conn.onreconnected(function () { setStatus("live"); rejoin(); dispatch("reconnected", {}); });
        conn.onclose(function () { setStatus("polling"); setTimeout(function () { starting = false; start(); }, 30000); });
      }
      return conn.start().then(function () { starting = false; setStatus("live"); rejoin(); dispatch("reconnected", {}); });
    }).catch(function (e) {
      console.info("Live hub unavailable, polling instead:", e && e.message);
      // No hub (the API may not run one): pages poll the REST API meanwhile. Retry now and then.
      starting = false; setStatus("polling");
      setTimeout(start, 60000);
    });
  }

  var live = {
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    onStatus: function (fn) { statusListeners.push(fn); fn(status); },
    status: function () { return status; },
    joinAuction: function (id) {
      if (id == null || groups.auctions[id]) return;
      groups.auctions[id] = true;
      if (conn && conn.state === "Connected") conn.invoke("JoinAuction", Number(id)).then(function (t) { if (t) noteServerTime(t); }).catch(function () {});
      else start();
    },
    leaveAuction: function (id) {
      if (!groups.auctions[id]) return;
      delete groups.auctions[id];
      if (conn && conn.state === "Connected") conn.invoke("LeaveAuction", Number(id)).catch(function () {});
    },
    joinList: function () {
      if (groups.list) return;
      groups.list = true;
      if (conn && conn.state === "Connected") conn.invoke("JoinAuctionList").catch(function () {});
      else start();
    }
  };

  window.Golow = {
    config: cfg, key: key, role: role, isPreview: role === "preview",
    lsGet: lsGet, lsSet: lsSet,
    listAuctions: rest.listAuctions, getAuction: rest.getAuction, getResult: rest.getResult, getBidGroups: rest.getBidGroups,
    live: live,
    util: { esc: esc, money: money, fmtCountdown: fmtCountdown, isLive: isLive, isFinished: isFinished, isCancelled: isCancelled, statusIs: statusIs, now: now, noteServerTime: noteServerTime, AlertQueue: AlertQueue, RateWindow: RateWindow, revealStep: revealStep },
    HttpError: HttpError
  };
  start();
})();
