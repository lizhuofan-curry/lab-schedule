/* Only aggregate route categories and explicitly named UI events leave the page. */
(function () {
  var routes = ["/", "/login", "/register", "/dashboard", "/my-schedule", "/availability", "/members", "/groups", "/tasks", "/tasks/new", "/graph", "/registration", "/notifications"];
  var events = ["nav_dashboard", "nav_my-schedule", "nav_availability", "nav_members", "nav_groups", "nav_tasks", "nav_graph", "nav_registration", "graph_settings", "task_create"];
  window.henuAnalyticsBeforeSend = function (type, payload) {
    if (type !== "event" || !payload || (payload.name && events.indexOf(payload.name) < 0)) return false;
    var path;
    try { path = new URL(payload.url, window.location.origin).pathname; } catch { return false; }
    if (routes.indexOf(path) < 0) {
      var match = path.match(/^\/(tasks|members|groups)\/\d+$/);
      path = match ? "/" + match[1] + "/:id" : "/other";
    }
    var clean = { website: payload.website, hostname: window.location.hostname,
      screen: payload.screen, language: payload.language, url: path,
      title: "HenuBCI", referrer: "" };
    if (payload.name) clean.name = payload.name;
    return clean;
  };
  // Do not use Umami's link handler: navigation must never await analytics.
  document.addEventListener("click", function (event) {
    var element = event.target instanceof Element ? event.target.closest("[data-analytics-event]") : null;
    var name = element && element.getAttribute("data-analytics-event");
    if (!name || events.indexOf(name) < 0 || !window.umami) return;
    try { Promise.resolve(window.umami.track(name)).catch(function () {}); } catch { /* Keep navigation independent. */ }
  }, true);
})();
