/* reveal.html: the results reveal scene (duplicates cancel out, the lowest unique bid wins). */
(function () {
  "use strict";
  var G = Golow, U = G.util, T = GolowText, esc = U.esc, Bus = GolowBus;
  var params = new URLSearchParams(location.search);
  var run = 0, timer = null;
  var $ = function (id) { return document.getElementById(id); };

  function log(kind, text, id) { Bus.send("evt", { kind: kind, text: text, auctionId: id }); }

  function hide() { run++; clearTimeout(timer); $("reveal").classList.add("hidden"); $("list").innerHTML = ""; }

  function start(id, speed) {
    hide();
    var mine = run;
    id = Number(id);
    if (!id) return;
    Promise.all([G.getAuction(id), G.getBidGroups(id)]).then(function (res) {
      if (mine !== run) return;
      var a = res[0], groups = res[1].items.slice().sort(function (x, y) { return x.amount - y.amount; });
      var total = groups.reduce(function (s, g) { return s + (g.occurrenceCount || 0); }, 0);
      $("head").innerHTML = esc(T.result) + " · " + esc(a.title);
      $("sub").textContent = T.totalBids(total) + " · " + T.distinct(res[1].totalCount || groups.length);
      $("legend").textContent = T.legend;
      $("reveal").classList.remove("hidden");
      var winAt = groups.findIndex(function (g) { return g.containsWinner; });
      var rows = winAt >= 0 ? groups.slice(0, winAt + 1) : groups.slice(0, 15);
      var step = U.revealStep(winAt >= 0 ? winAt : rows.length, speed);
      log("reveal", "Reveal started: " + a.title, id);
      var i = 0;
      (function next() {
        if (mine !== run) return;
        if (i >= rows.length) {
          if (winAt < 0) { GolowSound.play("closed", "No unique winning bid"); log("reveal", "Reveal ended: no unique winner", id); }
          return;
        }
        addRow(rows[i], a);
        i++;
        timer = setTimeout(next, rows[i - 1].containsWinner ? 0 : step);
      })();
    }).catch(function (e) {
      if (mine !== run) return;
      var msg = e.status === 400 || e.status === 403 ? T.revealGated : e.message;
      $("status").textContent = msg;
      log("error", "Reveal: " + msg, id);
    });
  }

  function addRow(g, a) {
    var row = document.createElement("div"), amt = esc(U.money(g.amount, a.currency));
    if (g.containsWinner) {
      var who = (g.biddersPreview || []).find(function (b) { return b.isWinner; }) || (g.biddersPreview || [])[0] || {};
      row.className = "rrow win";
      row.innerHTML = '<span>👑</span><span class="amt">' + amt + '</span><span class="who">' + esc(who.maskedBidder || (a.winner && a.winner.maskedBidder) || "") + '</span><span class="tag">' + esc(T.winnerTag) + "</span>";
      GolowFx.confetti($("fx"), 160);
      GolowSound.play("winner", "We have a winner!");
      log("reveal", "Reveal winner: " + U.money(g.amount, a.currency), a.id);
    } else if (!g.isUnique) {
      row.className = "rrow dup";
      row.innerHTML = '<span class="amt">' + amt + '</span><span class="tag">×' + esc(g.occurrenceCount) + " ❌</span>";
      GolowSound.play("cancel");
    } else {
      row.className = "rrow uniq";
      row.innerHTML = '<span class="amt">' + amt + '</span><span class="tag">' + esc(T.unique) + "</span>";
      GolowSound.play("new-bid");
    }
    var list = $("list");
    list.appendChild(row);
    // Keep the newest rows visible: drop the oldest while the list overflows.
    while (list.scrollHeight > list.clientHeight && list.children.length > 1) list.removeChild(list.firstChild);
  }

  Bus.on("reveal", function (d) { if (d.hide) hide(); else start(d.auctionId, d.speed); });
  if (params.get("auction")) start(params.get("auction"), params.get("speed"));
})();
