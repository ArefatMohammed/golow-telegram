/* login.html: admin sign-in with GOLOW admin platform credentials. */
(function () {
  var cfg = window.GOLOW_STUDIO || {}, env = document.getElementById("env");
  env.textContent = cfg.environment === "prod" ? "PRODUCTION" : "DEV";
  env.className = "env " + (cfg.environment === "prod" ? "prod" : "dev");
})();
document.getElementById("form").addEventListener("submit", function (e) {
  e.preventDefault();
  var f = e.target, btn = document.getElementById("go"), err = document.getElementById("err");
  btn.disabled = true; err.textContent = "";
  fetch("auth/login", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: f.phone.value, password: f.password.value })
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (b) {
      if (r.ok) { location.replace("./"); return; }
      err.textContent = b.error || (r.status === 422 ? "Enter your phone number and password." : "Sign-in failed (HTTP " + r.status + ").");
      f.password.value = "";
    });
  }).catch(function () { err.textContent = "Network error. Try again."; })
    .then(function () { btn.disabled = false; });
});
