(function () {
  var stored = localStorage.getItem("opensprint.theme");
  var theme = stored === "light" || stored === "dark" ? stored : "system";
  var resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
})();
