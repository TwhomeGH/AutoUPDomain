(() => {
  const key = 'autoupdomain-theme';
  const valid = (value) => (['system', 'light', 'dark'].includes(value) ? value : 'system');
  let preference = 'system';
  try {
    preference = valid(localStorage.getItem(key));
  } catch {
    /* Storage may be blocked; theme still works for this page. */
  }
  // Runs before CSS is loaded to avoid flashing the wrong theme on reload.
  document.documentElement.dataset.theme = preference;
  document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('theme');
    selector.value = preference;
    selector.addEventListener('change', () => {
      preference = valid(selector.value);
      document.documentElement.dataset.theme = preference;
      try {
        localStorage.setItem(key, preference);
      } catch {
        /* Keep the current selection in memory. */
      }
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== key && event.key !== null) return;
      preference = valid(event.newValue);
      selector.value = preference;
      document.documentElement.dataset.theme = preference;
    });
  });
})();
