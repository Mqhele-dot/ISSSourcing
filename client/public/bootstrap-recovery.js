/* Deliberately independent of React and the application module graph. */
(function () {
  function showLoadFailure(event) {
    const resource = event.target;
    if (!resource || (resource.tagName !== "SCRIPT" && resource.tagName !== "LINK")) return;
    const fallback = document.getElementById("bootstrap-recovery");
    if (!fallback) return; // Never replace a mounted app or interrupt an unsaved draft.
    document.getElementById("bootstrap-heading").textContent = "The app could not finish loading";
    document.getElementById("bootstrap-message").textContent =
      "An app file could not be loaded. Check your connection, then choose Reload app. If this continues, ask your administrator to check the app service.";
  }

  window.addEventListener("error", showLoadFailure, true);
  document.addEventListener("click", function (event) {
    if (event.target && event.target.id === "bootstrap-reload" && document.getElementById("bootstrap-recovery")) {
      window.location.reload(); // Explicit user action; keeps the current path, filters and fragment.
    }
  });
})();
