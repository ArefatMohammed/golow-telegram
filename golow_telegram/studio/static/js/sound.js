/* window.GolowSound: effects synthesized in the browser (works with zero files), optional recorded clips in
 * sounds/<kind>.mp3, optional English speech. Mode: ?voice= → localStorage golow.voice → "synth". */
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var preview = params.get("role") === "preview";
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } }

  var MODES = ["synth", "clips", "tts", "off"];
  var mode = params.get("voice") || lsGet("golow.voice") || "synth";
  if (MODES.indexOf(mode) < 0) mode = "synth";
  var volume = Number(lsGet("golow.volume"));
  if (!(volume >= 0 && volume <= 1) || lsGet("golow.volume") == null) volume = 0.8;

  var ctx = null;
  function audio() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(ac, freq, start, dur, type, peak) {
    var t = ac.currentTime + start, o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, (peak || 0.3) * volume), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // [frequency Hz, start s, duration s, wave, peak]
  var SYNTH = {
    "new-bid": [[988, 0, 0.12, "triangle", 0.35], [1319, 0.09, 0.28, "triangle", 0.35]],
    almost: [[880, 0, 0.08, "square", 0.18], [880, 0.15, 0.08, "square", 0.18], [880, 0.3, 0.08, "square", 0.18]],
    closed: [[110, 0, 1.8, "sine", 0.6], [220, 0, 1.2, "sine", 0.25], [330, 0.02, 0.8, "sine", 0.12]],
    winner: [[523, 0, 0.18, "triangle", 0.4], [659, 0.13, 0.18, "triangle", 0.4], [784, 0.26, 0.18, "triangle", 0.4], [1047, 0.39, 0.7, "triangle", 0.45]],
    rules: [[660, 0, 0.25, "sine", 0.35], [880, 0.18, 0.4, "sine", 0.35]],
    cancel: [[140, 0, 0.28, "sawtooth", 0.25], [120, 0.05, 0.25, "sawtooth", 0.2]],
    hype: [[1200, 0, 0.06, "square", 0.15], [900, 0.07, 0.06, "square", 0.15], [1200, 0.14, 0.08, "square", 0.15]]
  };

  function synth(kind) {
    var ac = audio(), notes = SYNTH[kind];
    if (!ac || !notes || volume <= 0) return;
    notes.forEach(function (n) { tone(ac, n[0], n[1], n[2], n[3], n[4]); });
  }

  function clip(kind) {
    var a = new Audio("sounds/" + kind + ".mp3");
    a.volume = volume;
    a.onerror = function () { synth(kind); };
    var p = a.play();
    if (p && p.catch) p.catch(function () { synth(kind); });
  }

  function speak(line) {
    if (!line || !("speechSynthesis" in window)) return;
    setTimeout(function () {
      var u = new SpeechSynthesisUtterance(line);
      u.lang = "en-US"; u.volume = volume;
      window.speechSynthesis.speak(u);
    }, 350);
  }

  window.GolowSound = {
    play: function (kind, englishLine) {
      if (preview || mode === "off") return;
      if (mode === "clips") clip(kind);
      else synth(kind);
      if (mode === "tts") speak(englishLine);
    },
    set: function (opts) {
      if (preview) return;
      if (opts.mode && MODES.indexOf(opts.mode) >= 0) { mode = opts.mode; lsSet("golow.voice", mode); }
      if (opts.volume != null && opts.volume >= 0 && opts.volume <= 1) { volume = Number(opts.volume); lsSet("golow.volume", volume); }
    },
    mode: function () { return mode; },
    volume: function () { return volume; },
    unlock: function () { audio(); }
  };

  if (window.GolowBus) window.GolowBus.on("voice", function (d) { window.GolowSound.set(d); });
})();
