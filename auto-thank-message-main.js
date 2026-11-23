(() => {
  function findInput() {
    return document.querySelector(".round__app input.mchat__say")
      ?? document.querySelector(".round__side input.mchat__say");
  }

  function ensureDiscussionTab() {
    const tab = document.querySelector(".round__app .mchat__tab.discussion")
      ?? document.querySelector(".round__side .mchat__tab.discussion");
    if (!tab || tab.classList?.contains("mchat__tab-active")) return;
    tab.click?.();
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.channel !== "lfs-auto-thank-post") return;
    const { id, text } = event.data;
    let ok = false;
    try {
      ensureDiscussionTab();
      const input = findInput();
      if (input && !input.disabled && (typeof input.value !== "string" || input.value.trim() === "")) {
        input.focus?.();
        input.value = String(text ?? "");
        input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        ok = true;
      }
    } catch {
      ok = false;
    }
    window.postMessage({ channel: "lfs-auto-thank-posted", id, ok }, location.origin);
  });
})();
