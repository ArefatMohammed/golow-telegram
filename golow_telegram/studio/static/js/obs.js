/* window.GolowObs: a small obs-websocket v5 client (built into OBS Studio 28+: Tools → WebSocket Server Settings).
 * The panel uses it to show whether OBS is streaming/recording, list and switch scenes, and switch to the reveal
 * scene automatically. Runs in the panel's browser, so it reaches the OBS on the host's own computer. */
(function () {
  "use strict";
  var EVENTS_GENERAL = 1, EVENTS_SCENES = 4, EVENTS_OUTPUTS = 64;
  var ws = null, nextId = 1, pending = {}, listeners = [], retry = null, poll = null, wanted = null;
  var state = { connected: false, connecting: false, error: null, streaming: false, recording: false, timecode: null, scene: null, scenes: [] };

  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } }); }

  function sha256b64(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      var bytes = new Uint8Array(buf), s = "";
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    });
  }

  function request(type, data) {
    if (!ws || !state.connected) return Promise.reject(new Error("OBS is not connected"));
    var id = String(nextId++);
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error(type + ": no answer from OBS")); } }, 5000);
    });
  }

  function refresh() {
    request("GetSceneList").then(function (d) {
      state.scene = d.currentProgramSceneName || null;
      // OBS lists scenes bottom-up; show them in the order of its Scenes dock.
      state.scenes = (d.scenes || []).map(function (s) { return s.sceneName; }).reverse();
      emit();
    }).catch(function () {});
    request("GetStreamStatus").then(function (d) { state.streaming = !!d.outputActive; state.timecode = d.outputActive ? d.outputTimecode : null; emit(); }).catch(function () {});
    request("GetRecordStatus").then(function (d) { state.recording = !!d.outputActive; emit(); }).catch(function () {});
  }

  function onEvent(type, d) {
    if (type === "CurrentProgramSceneChanged") state.scene = d.sceneName;
    else if (type === "SceneListChanged") state.scenes = (d.scenes || []).map(function (s) { return s.sceneName; }).reverse();
    else if (type === "StreamStateChanged") { state.streaming = !!d.outputActive; if (!d.outputActive) state.timecode = null; }
    else if (type === "RecordStateChanged") state.recording = !!d.outputActive;
    else return;
    emit();
  }

  function connect(url, password) {
    disconnect(true);
    wanted = { url: url, password: password || "" };
    state.connecting = true; state.error = null; emit();
    try { ws = new WebSocket(url, "obswebsocket.json"); } catch (e) { fail("Invalid address"); return; }
    var sock = ws;
    sock.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.op === 0) { // Hello
        var auth = m.d && m.d.authentication;
        var identify = { rpcVersion: 1, eventSubscriptions: EVENTS_GENERAL | EVENTS_SCENES | EVENTS_OUTPUTS };
        var send = function () { if (sock.readyState === 1) sock.send(JSON.stringify({ op: 1, d: identify })); };
        if (!auth) return send();
        sha256b64(wanted.password + auth.salt).then(function (secret) { return sha256b64(secret + auth.challenge); })
          .then(function (a) { identify.authentication = a; send(); });
      } else if (m.op === 2) { // Identified
        state.connected = true; state.connecting = false; state.error = null;
        refresh(); emit();
        clearInterval(poll);
        poll = setInterval(function () {
          if (state.streaming) request("GetStreamStatus").then(function (d) { state.timecode = d.outputActive ? d.outputTimecode : null; emit(); }).catch(function () {});
        }, 1000);
      } else if (m.op === 5) onEvent(m.d.eventType, m.d.eventData || {});
      else if (m.op === 7) {
        var p = pending[m.d.requestId];
        if (!p) return;
        delete pending[m.d.requestId];
        if (m.d.requestStatus && m.d.requestStatus.result) p.resolve(m.d.responseData || {});
        else p.reject(new Error((m.d.requestStatus && m.d.requestStatus.comment) || "OBS refused " + m.d.requestType));
      }
    };
    sock.onclose = function (e) {
      if (sock !== ws) return;
      var was = state.connected;
      state.connected = false; state.connecting = false; state.streaming = false; state.recording = false; state.timecode = null;
      clearInterval(poll);
      state.error = e.code === 4009 ? "Wrong OBS WebSocket password" : was ? "OBS disconnected" : "Can't reach OBS at " + wanted.url;
      emit();
      // Keep trying (OBS restarted, or not open yet), except after a wrong password.
      if (wanted && e.code !== 4009) retry = setTimeout(function () { connect(wanted.url, wanted.password); }, 5000);
    };
  }

  function fail(msg) { state.connecting = false; state.error = msg; emit(); }

  function disconnect(keepWanted) {
    clearTimeout(retry); clearInterval(poll);
    if (!keepWanted) wanted = null;
    if (ws) { var old = ws; ws = null; try { old.close(); } catch (e) { /* ignore */ } }
    Object.keys(pending).forEach(function (id) { pending[id].reject(new Error("Disconnected")); delete pending[id]; });
    state.connected = false; state.connecting = false; state.streaming = false; state.recording = false; state.timecode = null;
    if (!keepWanted) { state.error = null; emit(); }
  }

  window.GolowObs = {
    connect: connect,
    disconnect: function () { disconnect(false); },
    setScene: function (name) { return request("SetCurrentProgramScene", { sceneName: name }); },
    request: request,
    onChange: function (fn) { listeners.push(fn); fn(state); },
    state: function () { return state; }
  };
})();
