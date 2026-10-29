(() => {
  const storageKey = "lfsPuzzlePlaylist";
  const zenModeStorageKey = "lfsPuzzlePlaylistZenMode";
  if (document.documentElement && sessionStorage.getItem(zenModeStorageKey) === "true") {
    document.documentElement.setAttribute("data-lfs-zen-mode", "");
    document.documentElement.setAttribute("data-lfs-zen-restore-pending", "");
    sessionStorage.removeItem(zenModeStorageKey);
  }
  const homePanelId = "lfs-puzzle-playlist-home";
  const puzzleToolbarId = "lfs-puzzle-playlist-toolbar";
  const scheduler = globalThis.LichessPuzzleScheduler;
  const pageLoadedAt = Date.now();
  let playlist = { items: [], activeQueue: [], activeIndex: null };
  let homePanel;
  let homeSide;
  let playlistPage;
  let playlistPageLobby;
  let puzzleToolbar;
  let puzzleMenuSaveButton;
  let puzzleObserver;
  let observedPuzzle;
  let renderedPlaylistKey;
  let scheduled = false;
  let zenToolbarFrame;
  let dueRefreshTimer;
  let dueRefreshAt;

  function normalizePlaylist(value) {
    const items = [];
    const seen = new Set();
    for (const entry of Array.isArray(value?.items) ? value.items : []) {
      const id = typeof entry === "string" ? entry : entry?.id;
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{4,}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      const reps = Number.isInteger(entry?.reps) && entry.reps >= 0 ? entry.reps : 0;
      const state = ["new", "learning", "review"].includes(entry?.state)
        ? entry.state
        : reps ? "review" : "new";
      items.push({
        id,
        state,
        dueAt: Number.isFinite(entry?.dueAt) ? entry.dueAt : 0,
        stability: Number.isFinite(entry?.stability) ? entry.stability : 0,
        difficulty: Number.isFinite(entry?.difficulty) ? entry.difficulty : 0,
        reps,
        attempts: Number.isInteger(entry?.attempts) && entry.attempts >= reps ? entry.attempts : reps,
        lapses: Number.isInteger(entry?.lapses) && entry.lapses >= 0 ? entry.lapses : 0,
        lastReviewedAt: Number.isFinite(entry?.lastReviewedAt) ? entry.lastReviewedAt : null,
        lastRating: Number.isInteger(entry?.lastRating) && entry.lastRating >= 1 && entry.lastRating <= 4 ? entry.lastRating : null,
      });
    }
    const itemIds = new Set(items.map(item => item.id));
    const legacyActiveIndex = Number.isInteger(value?.activeIndex) && value.activeIndex >= 0 ? value.activeIndex : null;
    const activeId = Array.isArray(value?.activeQueue) && legacyActiveIndex !== null
      ? value.activeQueue[legacyActiveIndex] : items[legacyActiveIndex]?.id;
    const activeQueue = Array.isArray(value?.activeQueue)
      ? [...new Set(value.activeQueue.filter(id => typeof id === "string" && (itemIds.has(id) || (id === activeId && /^[a-zA-Z0-9_-]{4,}$/.test(id)))))]
      : legacyActiveIndex !== null ? items.map(item => item.id) : [];
    const activeIndex = legacyActiveIndex !== null && activeQueue.includes(activeId) ? activeQueue.indexOf(activeId) : null;
    return { items, activeQueue, activeIndex };
  }

  function savePlaylist(next, onSaved) {
    playlist = normalizePlaylist(next);
    chrome.storage.local.set({ [storageKey]: playlist }, () => onSaved?.());
    render();
  }

  function puzzleId() {
    const puzzleLink = document.querySelector(".puzzle__side__metas .infos.puzzle a[href]");
    if (puzzleLink) {
      const parts = new URL(puzzleLink.href, location.origin).pathname.split("/").filter(Boolean);
      const trainingIndex = parts.lastIndexOf("training");
      const candidate = trainingIndex >= 0 && parts.length === trainingIndex + 2 ? parts.at(-1) : null;
      if (typeof candidate === "string" && /^[a-zA-Z0-9_-]{4,}$/.test(candidate)) return candidate;
    }

    const currentLink = document.querySelector(".puzzle__session a.current[href]");
    if (currentLink) {
      const parts = new URL(currentLink.href, location.origin).pathname.split("/").filter(Boolean);
      const trainingIndex = parts.lastIndexOf("training");
      const candidate = trainingIndex >= 0 && parts.length > trainingIndex + 1 ? parts.at(-1) : null;
      if (typeof candidate === "string" && /^[a-zA-Z0-9_-]{4,}$/.test(candidate)) return candidate;
    }

    const pageData = document.querySelector("#page-init-data")?.textContent;
    let initialId = null;
    if (pageData) {
      try {
        initialId = JSON.parse(pageData)?.data?.puzzle?.id ?? null;
      } catch {
        initialId = null;
      }
    }
    const ogUrl = document.querySelector('meta[property="og:url"]')?.content;
    const metaParts = ogUrl ? new URL(ogUrl, location.origin).pathname.split("/").filter(Boolean) : [];
    const metaTrainingIndex = metaParts.lastIndexOf("training");
    const metaId = metaTrainingIndex >= 0 && metaParts.length === metaTrainingIndex + 2 ? metaParts.at(-1) : null;

    if (!initialId) {
      initialId = metaId;
    }
    const parts = location.pathname.split("/").filter(Boolean);
    const trainingIndex = parts.lastIndexOf("training");
    const routeParts = trainingIndex >= 0 ? parts.slice(trainingIndex + 1) : [];
    if (routeParts.length > 1 && /^[a-zA-Z0-9_-]{4,}$/.test(routeParts.at(-1))) return routeParts.at(-1);
    const routeId = routeParts[0];
    if (routeId === initialId && /^[a-zA-Z0-9_-]{4,}$/.test(routeId)) return routeId;
    if (/^[a-zA-Z0-9_-]{5}$/.test(routeId) && /[A-Z0-9_-]/.test(routeId)) return routeId;
    return initialId;
  }

  function trainingPath(id) {
    return `/training/${encodeURIComponent(id)}`;
  }

  function navigateToPlaylistPuzzle(id) {
    if (document.documentElement?.hasAttribute?.("data-lfs-zen-mode")) {
      sessionStorage.setItem(zenModeStorageKey, "true");
    } else {
      sessionStorage.removeItem(zenModeStorageKey);
    }
    location.assign(trainingPath(id));
  }

  function isDue(item, now = Date.now()) {
    return item.state === "new" || item.dueAt <= now;
  }

  function dueItems(now = Date.now()) {
    return playlist.items.filter(item => isDue(item, now)).sort((a, b) => {
      if (a.state === "new" && b.state !== "new") return 1;
      if (b.state === "new" && a.state !== "new") return -1;
      return a.dueAt - b.dueAt;
    });
  }

  function formatInterval(milliseconds) {
    const minutes = Math.max(1, Math.round(milliseconds / 60000));
    if (minutes < 60) return `${minutes} Min.`;
    const hours = minutes / 60;
    if (hours < 24) return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(hours)} Std.`;
    const days = hours / 24;
    if (days < 30) return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(days)} ${days < 1.5 ? "Tag" : "Tage"}`;
    const months = days / 30.4375;
    if (months < 12) return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(months)} ${months < 1.5 ? "Monat" : "Monate"}`;
    const years = months / 12;
    return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(years)} ${years < 1.5 ? "Jahr" : "Jahre"}`;
  }

  function dueLabel(item, now = Date.now()) {
    if (item.state === "new") return "Neu";
    return item.dueAt <= now ? "Fällig" : `in ${formatInterval(item.dueAt - now)}`;
  }

  function startQueue(ids) {
    if (!ids.length) return;
    const [firstId] = ids;
    const items = playlist.items.map(item => item.id === firstId ? { ...item, attempts: item.attempts + 1 } : item);
    savePlaylist({ ...playlist, items, activeQueue: ids, activeIndex: 0 }, () => {
      location.assign(trainingPath(ids[0]));
    });
  }

  function makeButton(label, action, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `lfs-playlist-button ${className}`.trim();
    button.textContent = label;
    button.dataset.action = action;
    return button;
  }

  function restoreHomeSide() {
    clearTimeout(dueRefreshTimer);
    dueRefreshTimer = null;
    dueRefreshAt = null;
    homePanel?.remove();
    homePanel = null;
    homeSide?.querySelectorAll("[data-lfs-playlist-hidden]").forEach(element => {
      element.removeAttribute("data-lfs-playlist-hidden");
    });
    homeSide = null;
  }

  function restorePlaylistPage() {
    playlistPage?.remove();
    playlistPage = null;
    playlistPageLobby?.querySelectorAll("[data-lfs-playlist-page-hidden]").forEach(element => {
      element.removeAttribute("data-lfs-playlist-page-hidden");
    });
    playlistPageLobby = null;
    renderedPlaylistKey = null;
  }

  function syncHomePanel() {
    const atHome = location.pathname === "/";
    const lobby = atHome ? document.querySelector("main.lobby") : null;
    if (atHome && location.hash === "#puzzle-playlist" && lobby) {
      restoreHomeSide();
      syncPlaylistPage(lobby);
      return;
    }

    restorePlaylistPage();
    const side = atHome ? lobby?.querySelector(".lobby__side") ?? document.querySelector(".lobby__side") : null;
    if (side !== homeSide) {
      restoreHomeSide();
      if (!side) return;
      homeSide = side;
    }
    if (!homeSide) return;
    if (!homePanel || homePanel.parentElement !== homeSide) {
      homePanel = document.createElement("section");
      homePanel.id = homePanelId;
      homePanel.className = "lfs-playlist-card";
      homePanel.setAttribute("aria-label", "Rätsel-Playlist");
      homeSide.append(homePanel);
    }
    for (const child of homeSide.children) {
      if (child.id !== homePanelId && !child.hasAttribute("data-lfs-playlist-hidden")) {
        child.dataset.lfsPlaylistHidden = "";
      }
    }
    renderHomePanel();
  }

  function syncPlaylistPage(lobby) {
    if (lobby !== playlistPageLobby) {
      restorePlaylistPage();
      playlistPageLobby = lobby;
    }
    for (const child of lobby.children) {
      if (child.id !== "lfs-puzzle-playlist-page" && !child.hasAttribute("data-lfs-playlist-page-hidden")) {
        child.dataset.lfsPlaylistPageHidden = "";
      }
    }
    if (!playlistPage || playlistPage.parentElement !== lobby) {
      playlistPage = document.createElement("section");
      playlistPage.id = "lfs-puzzle-playlist-page";
      playlistPage.className = "lfs-playlist-page";
      playlistPage.setAttribute("aria-label", "Rätsel-Playlist");
      lobby.append(playlistPage);
      renderedPlaylistKey = null;
    }
    renderPlaylistPage();
  }

  function renderHomePanel() {
    if (!homePanel || homePanel.dataset.rendered) return;
    homePanel.dataset.rendered = "true";
    homePanel.replaceChildren(
      makeButton("Rätsel-Playlist", "open", "lfs-playlist-primary"),
      makeButton("Blunder-Liste", "blunders"),
    );
  }

  function renderPlaylistPage() {
    if (!playlistPage) return;
    const scrollTop = playlistPage.querySelector(".lfs-playlist-list")?.scrollTop ?? 0;
    const now = Date.now();
    scheduleDueRefresh(now);
    const dueCount = playlist.items.filter(item => item.state !== "new" && item.dueAt <= now).length;
    const newCount = playlist.items.filter(item => item.state === "new").length;
    const readyCount = dueCount + newCount;
    const solvedCount = playlist.items.reduce((total, item) => total + item.reps, 0);
    const attemptCount = playlist.items.reduce((total, item) => total + item.attempts, 0);
    const viewKey = JSON.stringify([playlist.items, playlist.activeQueue, playlist.activeIndex, dueCount, newCount]);
    if (renderedPlaylistKey === viewKey) return;
    renderedPlaylistKey = viewKey;

    const header = document.createElement("header");
    header.className = "lfs-playlist-page-header";
    const title = document.createElement("h1");
    title.textContent = "Rätsel-Playlist";
    header.append(title, makeButton("Startseite", "home", "lfs-playlist-quiet"));
    const score = document.createElement("div");
    score.className = "lfs-playlist-score";
    const scoreValue = document.createElement("strong");
    scoreValue.textContent = `${solvedCount} / ${attemptCount}`;
    const scoreLabel = document.createElement("small");
    scoreLabel.textContent = "Gelöst / Versuche";
    score.append(scoreValue, scoreLabel);
    header.insertBefore(score, header.lastElementChild);
    const summary = document.createElement("p");
    summary.className = "lfs-playlist-page-summary";
    summary.textContent = `${playlist.items.length} Rätsel · ${dueCount} fällig · ${newCount} neu`;
    playlistPage.replaceChildren(header, summary);

    if (!playlist.items.length) {
      const empty = document.createElement("p");
      empty.className = "lfs-playlist-empty";
      empty.textContent = "Speichere Rätsel über den Playlist-Button unter dem Spielfeld.";
      playlistPage.append(empty);
      return;
    }

    const list = document.createElement("ol");
    list.className = "lfs-playlist-list";
    list.tabIndex = 0;
    list.setAttribute("aria-label", "Gespeicherte Rätsel");
    playlist.items.forEach((entry, index) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = trainingPath(entry.id);
      link.textContent = `Rätsel ${index + 1}`;
      link.dataset.action = "play";
      link.dataset.id = entry.id;
      const status = document.createElement("small");
      status.className = "lfs-playlist-item-status";
      status.textContent = dueLabel(entry, now);
      status.dataset.ready = String(isDue(entry, now));
      const score = document.createElement("span");
      score.className = "lfs-playlist-item-score";
      score.textContent = `${entry.reps} / ${entry.attempts}`;
      score.title = "Gelöst / Versuche";
      const remove = makeButton("×", "remove", "lfs-playlist-remove");
      remove.title = "Aus Playlist entfernen";
      remove.setAttribute("aria-label", `Rätsel ${index + 1} aus Playlist entfernen`);
      remove.dataset.id = entry.id;
      item.append(link, status, score, remove);
      list.append(item);
    });
    const actions = document.createElement("div");
    actions.className = "lfs-playlist-page-actions";
    actions.append(
      makeButton(`Trainieren (${readyCount})`, "start-due", "lfs-playlist-primary"),
      makeButton("Alle spielen", "start-all", "lfs-playlist-quiet"),
    );
    actions.querySelector('[data-action="start-due"]').disabled = readyCount === 0;
    playlistPage.append(actions, list);
    list.scrollTop = scrollTop;
  }

  function scheduleDueRefresh(now) {
    const nextDueAt = playlist.items
      .filter(item => item.state !== "new" && item.dueAt > now)
      .reduce((nearest, item) => Math.min(nearest, item.dueAt), Infinity);
    const target = Number.isFinite(nextDueAt) ? nextDueAt : null;
    if (target === dueRefreshAt) return;
    clearTimeout(dueRefreshTimer);
    dueRefreshAt = target;
    dueRefreshTimer = target === null ? null : setTimeout(() => {
      dueRefreshAt = null;
      dueRefreshTimer = null;
      renderPlaylistPage();
    }, Math.min(target - now, 2147483647));
  }

  function ensureHomeClickHandler() {
    if (!homePanel || homePanel.dataset.handlerBound) return;
    homePanel.dataset.handlerBound = "true";
    homePanel.addEventListener("click", event => {
      const control = event.target.closest("[data-action]");
      if (control?.dataset.action === "open") {
        const ready = dueItems();
        if (playlist.items.length) startQueue((ready.length ? ready : playlist.items).map(item => item.id));
        else location.hash = "puzzle-playlist";
      } else if (control?.dataset.action === "blunders") {
        document.dispatchEvent(new CustomEvent("lfs-blunder-open"));
      }
    });
  }

  function ensurePlaylistPageClickHandler() {
    if (!playlistPage || playlistPage.dataset.handlerBound) return;
    playlistPage.dataset.handlerBound = "true";
    playlistPage.addEventListener("click", event => {
      const control = event.target.closest("[data-action]");
      if (!control) return;
      const id = control.dataset.id;
      if (control.dataset.action === "home") {
        location.hash = "";
      } else if (control.dataset.action === "start-due") {
        startQueue(dueItems().map(item => item.id));
      } else if (control.dataset.action === "start-all") {
        const ordered = [...playlist.items].sort((a, b) => {
          if (a.state === "new" && b.state !== "new") return 1;
          if (b.state === "new" && a.state !== "new") return -1;
          return a.dueAt - b.dueAt;
        });
        startQueue(ordered.map(item => item.id));
      } else if (control.dataset.action === "play") {
        event.preventDefault();
        const item = playlist.items.find(item => item.id === id);
        if (item) startQueue([item.id]);
      } else if (control.dataset.action === "remove") {
        removePlaylistItem(id);
      }
    });
  }

  function removePlaylistItem(removedId) {
    if (!playlist.items.some(item => item.id === removedId)) return;
    const items = playlist.items.filter(item => item.id !== removedId);
    const queueIndex = playlist.activeQueue.indexOf(removedId);
    const activeQueue = playlist.activeQueue.filter((id, index) => id !== removedId || index === playlist.activeIndex);
    let activeIndex = playlist.activeIndex;
    if (activeIndex !== null && queueIndex >= 0 && queueIndex < activeIndex) activeIndex--;
    savePlaylist({ items, activeQueue: activeIndex === null ? [] : activeQueue, activeIndex });
  }

  function renderPuzzleToolbar() {
    const id = puzzleId();
    const board = document.querySelector(".puzzle__board cg-board");
    const toolbarParent = document.querySelector(".puzzle__session") ?? board?.closest(".puzzle");
    if (!id || !toolbarParent || !board) {
      puzzleToolbar?.remove();
      puzzleToolbar = null;
      puzzleMenuSaveButton?.remove();
      puzzleMenuSaveButton = null;
      return;
    }

    const savedIndex = playlist.items.findIndex(item => item.id === id);
    const savedItem = savedIndex >= 0 ? playlist.items[savedIndex] : null;
    const zenMode = Boolean(document.documentElement?.hasAttribute?.("data-lfs-zen-mode"));
    const saveDescription = savedIndex < 0 ? "In Playlist speichern" : "Aus Playlist entfernen";

    if (!puzzleMenuSaveButton) {
      puzzleMenuSaveButton = makeButton(saveDescription, "menu-save");
      puzzleMenuSaveButton.addEventListener("click", toggleSavedPuzzle);
    }
    const isActivePuzzle = playlist.activeIndex !== null && playlist.activeQueue[playlist.activeIndex] === id;
    const isComplete = !!document.querySelector(".puzzle__feedback.after");
    const ratedThisVisit = Number.isFinite(savedItem?.lastReviewedAt) && savedItem.lastReviewedAt >= pageLoadedAt;
    if (!puzzleToolbar) {
      puzzleToolbar = document.createElement("div");
      puzzleToolbar.id = puzzleToolbarId;
      puzzleToolbar.className = "lfs-playlist-toolbar";
    }
    if (puzzleToolbar.parentElement !== toolbarParent) toolbarParent.append(puzzleToolbar);

    const viewKey = JSON.stringify([id, savedItem, playlist.activeQueue, playlist.activeIndex, isComplete, ratedThisVisit, zenMode]);
    if (puzzleToolbar.dataset.viewKey === viewKey && puzzleMenuSaveButton.parentElement === puzzleToolbar) return;
    puzzleToolbar.dataset.viewKey = viewKey;
    puzzleToolbar.dataset.puzzleId = id;
    puzzleToolbar.dataset.solved = String(isComplete);
    puzzleMenuSaveButton.dataset.puzzleId = id;
    puzzleMenuSaveButton.textContent = saveDescription;
    puzzleMenuSaveButton.className = `lfs-playlist-button ${savedIndex < 0 ? "lfs-playlist-primary" : "lfs-playlist-quiet lfs-playlist-toolbar-remove"}`;
    puzzleMenuSaveButton.setAttribute("aria-pressed", String(savedIndex >= 0));
    puzzleToolbar.replaceChildren();

    if (isComplete && savedItem) {
      if (ratedThisVisit) {
        if (isActivePuzzle) {
          const nextIndex = playlist.activeIndex + 1;
          const isLast = nextIndex >= playlist.activeQueue.length;
          puzzleToolbar.append(makeButton(isLast ? "Sitzung abschließen" : `Nächstes Rätsel (${nextIndex + 1}/${playlist.activeQueue.length})`, isLast ? "finish" : "next", "lfs-playlist-primary"));
        }
      } else {
        const ratings = document.createElement("div");
        ratings.className = "lfs-review-ratings";
        const now = Date.now();
        for (const [label, grade] of [["Einfach", 4], ["Gut", 3], ["Schwer", 2], ["Nochmal", 1]]) {
          const result = scheduler.schedule(savedItem, grade, now);
          const button = makeButton(label, "rate", "lfs-review-button");
          button.dataset.grade = String(grade);
          button.title = `Wiederholung in ${formatInterval(result.dueAt - now)}`;
          ratings.append(button);
        }
        puzzleToolbar.append(ratings);
      }
    }
    puzzleToolbar.append(puzzleMenuSaveButton);
    if (zenMode && isComplete && !isActivePuzzle) {
      puzzleToolbar.append(makeButton("Nächstes Rätsel", "native-next"));
    }

    if (puzzleToolbar.dataset.handlerBound) return;
    puzzleToolbar.dataset.handlerBound = "true";
    puzzleToolbar.addEventListener("click", event => {
      const control = event.target.closest("[data-action]");
      if (!control) return;
      if (puzzleToolbar.dataset.puzzleId !== puzzleId()) {
        render();
        return;
      }
      if (control.dataset.action === "rate") {
        const currentId = puzzleId();
        const index = playlist.items.findIndex(item => item.id === currentId);
        const grade = Number(control.dataset.grade);
        if (index < 0 || grade < 1 || grade > 4) return;
        const items = [...playlist.items];
        items[index] = scheduler.schedule(items[index], grade, Date.now());
        const next = { ...playlist, items };
        playlist = normalizePlaylist(next);
        const isActive = playlist.activeIndex !== null && playlist.activeQueue[playlist.activeIndex] === currentId;
        if (isActive && continuePlaylist(currentId)) return;
        savePlaylist(next, advanceNativePuzzle);
      } else if (control.dataset.action === "native-next") {
        advanceNativePuzzle();
      } else if (control.dataset.action === "finish") {
        finishPlaylistSession();
      } else if (control.dataset.action === "next" && playlist.activeIndex !== null) {
        continuePlaylist(puzzleId());
      }
    });
  }

  function advanceNativePuzzle() {
    document.querySelector(".puzzle__feedback.after .continue")?.click?.();
  }

  function continuePlaylist(currentId) {
    if (playlist.activeIndex === null || playlist.activeQueue[playlist.activeIndex] !== currentId) return false;
    const nextIndex = playlist.activeIndex + 1;
    const nextId = playlist.activeQueue[nextIndex];
    if (!nextId) {
      finishPlaylistSession();
      return true;
    }
    const items = playlist.items.map(item => item.id === nextId ? { ...item, attempts: item.attempts + 1 } : item);
    savePlaylist({ ...playlist, items, activeIndex: nextIndex }, () => {
      navigateToPlaylistPuzzle(nextId);
    });
    return true;
  }

  function finishPlaylistSession() {
    savePlaylist({ ...playlist, activeQueue: [], activeIndex: null }, () => {
      location.assign("/#puzzle-playlist");
    });
  }

  function handleNativePuzzleContinue(event) {
    const control = event.target.closest(".puzzle__feedback.after .continue");
    if (!control || playlist.activeIndex === null) return;
    if (playlist.activeQueue[playlist.activeIndex] !== puzzleId()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    continuePlaylist(playlist.activeQueue[playlist.activeIndex]);
  }

  function toggleSavedPuzzle(event) {
    const id = puzzleId();
    if (!id || event.currentTarget.dataset.puzzleId !== id) {
      render();
      return;
    }
    const index = playlist.items.findIndex(item => item.id === id);
    if ((event.currentTarget.getAttribute("aria-pressed") === "true") !== (index >= 0)) {
      render();
      return;
    }
    if (index >= 0) {
      removePlaylistItem(id);
      return;
    }
    const items = [...playlist.items];
    items.push({ id, state: "new", dueAt: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReviewedAt: null, lastRating: null });
    savePlaylist({ ...playlist, items });
  }

  function render() {
    observePuzzleState();
    syncHomePanel();
    ensureHomeClickHandler();
    ensurePlaylistPageClickHandler();
    renderPuzzleToolbar();
    scheduleZenToolbarPosition();
  }

  function positionZenToolbar() {
    if (!puzzleToolbar) return;
    const zenMode = Boolean(document.documentElement?.hasAttribute?.("data-lfs-zen-mode"));
    if (!zenMode || puzzleToolbar.dataset.solved !== "true") {
      for (const property of ["--lfs-zen-toolbar-left", "--lfs-zen-toolbar-top", "--lfs-zen-toolbar-width"]) {
        puzzleToolbar.style.removeProperty(property);
      }
      return;
    }
    const board = document.querySelector(".puzzle__board cg-board");
    const rect = board?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return;
    const gap = 6;
    const height = puzzleToolbar.getBoundingClientRect().height;
    const top = Math.min(rect.bottom + gap, Math.max(gap, window.innerHeight - height - gap));
    puzzleToolbar.style.setProperty("--lfs-zen-toolbar-left", `${rect.left}px`);
    puzzleToolbar.style.setProperty("--lfs-zen-toolbar-top", `${top}px`);
    puzzleToolbar.style.setProperty("--lfs-zen-toolbar-width", `${rect.width}px`);
  }

  function scheduleZenToolbarPosition() {
    cancelAnimationFrame(zenToolbarFrame);
    zenToolbarFrame = requestAnimationFrame(() => {
      zenToolbarFrame = requestAnimationFrame(positionZenToolbar);
    });
  }

  function observePuzzleState() {
    const puzzle = document.querySelector(".puzzle__board")?.closest(".puzzle");
    if (puzzle === observedPuzzle) return;
    puzzleObserver?.disconnect();
    observedPuzzle = puzzle;
    if (!puzzle) return;
    puzzleObserver = new MutationObserver(scheduleRender);
    puzzleObserver.observe(puzzle, {
      attributes: true,
      attributeFilter: ["class", "href"],
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }

  chrome.storage.local.get(storageKey, stored => {
    playlist = normalizePlaylist(stored[storageKey]);
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.hasOwn(changes, storageKey)) return;
    playlist = normalizePlaylist(changes[storageKey].newValue);
    render();
  });

  new MutationObserver(scheduleRender).observe(document, { childList: true, subtree: true });
  if (document.documentElement) {
    new MutationObserver(scheduleRender).observe(document.documentElement, { attributes: true, attributeFilter: ["data-lfs-zen-mode"] });
  }
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("resize", scheduleZenToolbarPosition);
  document.addEventListener("click", handleNativePuzzleContinue, true);
})();
