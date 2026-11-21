/* window.GolowBus: panel ↔ scenes messaging in one browser engine (BroadcastChannel, with a localStorage
 * fallback). Messages: { id, from, type, data, at }. Receivers ignore their own and de-duplicate by id. */
(function () {
  "use strict";
  var me = Math.random().toString(36).slice(2, 10);
  var role = new URLSearchParams(location.search).get("role") || "";
  var counter = 0, seen = {}, order = [], listeners = [];
  var channel = "BroadcastChannel" in window ? new BroadcastChannel("golow-live") : null;

  function remember(id) {
    seen[id] = true; order.push(id);
    if (order.length > 500) delete seen[order.shift()];
  }

  function deliver(msg) {
    if (!msg || typeof msg !== "object" || !msg.id || msg.from === me || seen[msg.id]) return;
    remember(msg.id);
    listeners.forEach(function (l) {
      if (l.type === "*" || l.type === msg.type) {
        try { l.fn(msg.data || {}, msg); } catch (e) { console.error(e); }
      }
    });
  }

  if (channel) channel.onmessage = function (e) { deliver(e.data); };
  window.addEventListener("storage", function (e) {
    if (e.key === "golow.bus" && e.newValue) { try { deliver(JSON.parse(e.newValue)); } catch (err) { /* ignore */ } }
  });

  window.GolowBus = {
    id: me,
    isPreview: role === "preview",
    send: function (type, data) {
      // A preview iframe in the panel must not report state or log lines.
      if (role === "preview" && (type === "state" || type === "evt")) return;
      var msg = { id: me + "-" + (++counter), from: me, type: type, data: data || {}, at: Date.now() };
      remember(msg.id);
      if (channel) channel.postMessage(msg);
      try { localStorage.setItem("golow.bus", JSON.stringify(msg)); } catch (e) { /* private mode */ }
    },
    on: function (type, fn) { listeners.push({ type: type, fn: fn }); }
  };
})();
