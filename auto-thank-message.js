(() => {
  const MESSAGE = "Thank you for the game. Well played.";
  const STORAGE_PREFIX = "lfsAutoThankSent:";
  const GAME_ID_PATTERN = /^[a-zA-Z0-9_-]{8}$/;
  const PLAYER_URL_PATTERN = /^[a-zA-Z0-9_-]{12}$/;
  const COLOR_URL_PATTERN = /^[a-zA-Z0-9_-]{8}[wb]$/;
  let settings;
  let observer;
  let pendingTimer;
  let posting = false;
  let postCounter = 0;
  let cachedPageData = null;
  const memorySent = new Set();
  const pendingPosts = new Map();

  function capturePageData() {
    const text = document.querySelector("#page-init-data")?.textContent;
    if (!text) return cachedPageData;
    try {
      const json = JSON.parse(text);
      cachedPageData = json?.cfg?.data ?? json?.data ?? json;
    } catch {
      // Ignore malformed JSON.
    }
    return cachedPageData;
  }

  // Lichess entfernt #page-init-data direkt beim Initialisieren der Seite.
  if (typeof MutationObserver === "function") {
    const initObserver = new MutationObserver(() => {
      if (!document.querySelector("#page-init-data")) return;
      capturePageData();
      initObserver.disconnect();
    });
    initObserver.observe(document, { childList: true, subtree: true });
    if (document.querySelector("#page-init-data")) {
      capturePageData();
      initObserver.disconnect();
    } else if (typeof document.addEventListener === "function") {
      document.addEventListener("DOMContentLoaded", () => {
        capturePageData();
        initObserver.disconnect();
      }, { once: true });
    }
  } else {
    capturePageData();
  }

  function isActive() {
    return Boolean(settings?.enabled && settings?.autoThankMessageEnabled
      && !document.documentElement?.hasAttribute?.("data-lfs-disabled"));
  }

  function readPageData() {
    return capturePageData();
  }

  function gameIdFromData(data) {
    const id = data?.game?.id;
    if (typeof id === "string" && GAME_ID_PATTERN.test(id)) return id;
    const first = location.pathname?.split("/").filter(Boolean)[0] ?? "";
    if (GAME_ID_PATTERN.test(first)) return first;
    if (PLAYER_URL_PATTERN.test(first) || COLOR_URL_PATTERN.test(first)) return first.slice(0, 8);
    return null;
  }

  function isPlayerGame(data) {
    const player = data?.player;
    if (player) {
      if (player.spectator === true) return false;
      return player.color === "white" || player.color === "black";
    }
    const first = location.pathname?.split("/").filter(Boolean)[0] ?? "";
    return PLAYER_URL_PATTERN.test(first);
  }

  function resultText() {
    return document.querySelector(".round__app .result-wrap .result")?.textContent?.trim().replace(/\s+/g, "") ?? "";
  }

  function gameOutcome(result) {
    if (result === "1-0") return "win";
    if (result === "0-1") return "lose";
    if (result === "½-½") return "draw";
    return null;
  }

  function sentKey(gameId, result) {
    return `${STORAGE_PREFIX}${gameId}:${result}`;
  }

  function alreadySent(key) {
    if (memorySent.has(key)) return true;
    try {
      return globalThis.sessionStorage?.getItem(key) === "sent";
    } catch {
      return false;
    }
  }

  function markSent(key) {
    memorySent.add(key);
    try {
      globalThis.sessionStorage?.setItem(key, "sent");
    } catch {
      // In-memory set above still prevents duplicates in this page load.
    }
  }

  function clearPending() {
    if (pendingTimer !== undefined && pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function findChatInput() {
    return document.querySelector(".round__app input.mchat__say")
      ?? document.querySelector(".round__side input.mchat__say");
  }

  function ensureDiscussionTab() {
    const tab = document.querySelector(".round__app .mchat__tab.discussion")
      ?? document.querySelector(".round__side .mchat__tab.discussion");
    if (!tab) return true;
    if (tab.classList?.contains("mchat__tab-active")) return true;
    tab.click?.();
    return Boolean(findChatInput());
  }

  function postViaMain(text) {
    return new Promise(resolve => {
      const id = `lfs-thank-${++postCounter}-${Date.now()}`;
      const timer = setTimeout(() => {
        pendingPosts.delete(id);
        resolve(false);
      }, 2000);
      pendingPosts.set(id, ok => {
        clearTimeout(timer);
        resolve(ok);
      });
      window.postMessage({ channel: "lfs-auto-thank-post", id, text }, location.origin);
    });
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.channel !== "lfs-auto-thank-posted") return;
    const pending = pendingPosts.get(event.data.id);
    if (!pending) return;
    pendingPosts.delete(event.data.id);
    pending(event.data.ok === true);
  });

  async function check() {
    if (!isActive() || posting) return false;
    if (document.querySelector(".bot-game")) return false;
    if (!document.querySelector(".round__app")) return false;
    const result = resultText();
    const outcome = gameOutcome(result);
    if (!outcome) return false;
    const data = readPageData();
    if (!isPlayerGame(data)) return false;
    const gameId = gameIdFromData(data);
    if (!gameId) return false;
    const key = sentKey(gameId, result);
    if (alreadySent(key)) return false;
    posting = true;
    try {
      if (!ensureDiscussionTab()) return false;
      const input = findChatInput();
      if (!input || input.disabled) return false;
      if (typeof input.value === "string" && input.value.trim() !== "") return false;
      const ok = await postViaMain(MESSAGE);
      if (!ok) return false;
      markSent(key);
      return true;
    } finally {
      posting = false;
    }
  }

  function scheduleCheck(delay = 500) {
    if (!isActive()) {
      clearPending();
      return;
    }
    if (pendingTimer !== null && pendingTimer !== undefined) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      check();
    }, delay);
  }

  function startObserver() {
    if (observer || typeof MutationObserver !== "function") return;
    observer = new MutationObserver(() => scheduleCheck(100));
    observer.observe(document, { childList: true, subtree: true, characterData: true });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
    clearPending();
  }

  function update(nextSettings) {
    settings = nextSettings;
    if (!isActive()) {
      stopObserver();
      return;
    }
    startObserver();
    scheduleCheck(500);
  }

  globalThis.LichessAutoThankMessage = { update, check, MESSAGE };
})();
