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
  const ratingMaxPositionSetting = "puzzleRatingMaxPosition";
  const settings = globalThis.LichessSettings;
  const ratingThumbImage = `url("${chrome.runtime.getURL(settings.getPieceAsset({ pieceSet: "system_rund" }, "b", "q"))}")`;
  const scheduler = globalThis.LichessPuzzleScheduler;
  const pageLoadedAt = Date.now();
  let ratingMaxPosition = settings.defaults[ratingMaxPositionSetting];
  let playlist = { items: [], activeQueue: [], activeIndex: null, activeStartedAt: null };
  let homePanel;
  let homeSide;
  let playlistPage;
  let playlistPageLobby;
  let puzzleToolbar;
  let puzzleMenuSaveButton;
  let puzzleObserver;
  let observedPuzzle;
  let renderedPlaylistKey;
  let pluginEnabled = true;
  let scheduled = false;
  let zenToolbarFrame;
  let dueRefreshTimer;
  let dueRefreshAt;
  let homeTickTimer = null;
  let pieceSettings = settings.normalize({});
  const timelinePieceElements = new Map();
  const timelineStartPx = 40;
  let timelineWindowHours = 6;
  let timelineZoomFrame = 0;

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
        lastRating: scheduler.normalizeRating(entry?.lastRating, value?.ratingScaleVersion),
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
    const activeStartedAt = activeIndex !== null && Number.isFinite(value?.activeStartedAt) ? value.activeStartedAt : null;
    return { items, activeQueue, activeIndex, activeStartedAt, ratingScaleVersion: scheduler.ratingScaleVersion };
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

  function newlyDueItems(now = Date.now()) {
    if (playlist.activeIndex === null || !Number.isFinite(playlist.activeStartedAt)) return [];
    // The saved queue keeps completed entries and allows each puzzle only once.
    const queuedIds = new Set(playlist.activeQueue);
    return playlist.items
      .filter(item => item.dueAt > playlist.activeStartedAt && item.dueAt <= now && !queuedIds.has(item.id))
      .sort((a, b) => a.dueAt - b.dueAt);
  }

  function appendNewlyDueToSession(now = Date.now()) {
    const ids = newlyDueItems(now).map(item => item.id);
    if (!ids.length) return false;
    savePlaylist({ ...playlist, activeQueue: [...playlist.activeQueue, ...ids] });
    return true;
  }

  const intervalNumberFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
  function formatInterval(milliseconds) {
    const minutes = Math.max(1, Math.round(milliseconds / 60000));
    if (minutes < 60) return `${minutes} Min.`;
    const hours = minutes / 60;
    if (hours < 24) return `${intervalNumberFormat.format(hours)} Std.`;
    const days = hours / 24;
    if (days < 30) return `${intervalNumberFormat.format(days)} ${days < 1.5 ? "Tag" : "Tage"}`;
    const months = days / 30.4375;
    if (months < 12) return `${intervalNumberFormat.format(months)} ${months < 1.5 ? "Monat" : "Monate"}`;
    const years = months / 12;
    return `${intervalNumberFormat.format(years)} ${years < 1.5 ? "Jahr" : "Jahre"}`;
  }

  function dueLabel(item, now = Date.now()) {
    if (item.state === "new") return "Neu";
    return item.dueAt <= now ? "Fällig" : `in ${formatInterval(item.dueAt - now)}`;
  }

  function startQueue(ids) {
    if (!ids.length) return;
    const [firstId] = ids;
    const items = playlist.items.map(item => item.id === firstId ? { ...item, attempts: item.attempts + 1 } : item);
    savePlaylist({ ...playlist, items, activeQueue: ids, activeIndex: 0, activeStartedAt: Date.now() }, () => {
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

  function clearHomeTick() {
    if (homeTickTimer !== null) {
      clearInterval(homeTickTimer);
      homeTickTimer = null;
    }
    if (timelineZoomFrame !== 0) {
      cancelAnimationFrame(timelineZoomFrame);
      timelineZoomFrame = 0;
    }
    timelinePieceElements.clear();
  }

  function restoreHomeSide() {
    clearTimeout(dueRefreshTimer);
    dueRefreshTimer = null;
    dueRefreshAt = null;
    clearHomeTick();
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
    const lobby = document.querySelector("main.lobby");
    if (lobby && location.hash === "#puzzle-playlist") {
      restoreHomeSide();
      syncPlaylistPage(lobby);
      return;
    }

    restorePlaylistPage();
    const side = lobby?.querySelector(".lobby__side") ?? null;
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
      if (child.id !== homePanelId && child.id !== "lfs-puzzle-favorites-panel" && child.id !== "lfs-study-favorites-panel" && child.id !== "lfs-game-favorites-panel" && !child.hasAttribute("data-lfs-playlist-hidden")) {
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

  function timelineLetter(item) {
    if (item.state === "learning") return "b";
    if (item.state === "review" && item.reps < 3) return "r";
    if (item.state === "review") return "q";
    return "b";
  }

  function pieceAssetUrl(item) {
    return chrome.runtime.getURL(settings.getPieceAsset(pieceSettings, "w", timelineLetter(item)));
  }

  function nextDueProgress(now) {
    const future = playlist.items
      .filter(item => item.state !== "new" && item.dueAt > now)
      .sort((a, b) => a.dueAt - b.dueAt);
    const next = future[0];
    if (!next) return 1;
    const last = next.lastReviewedAt;
    if (!Number.isFinite(last) || last >= next.dueAt) return 1;
    return Math.max(0, Math.min(1, (next.dueAt - now) / (next.dueAt - last)));
  }

  function formatWindow(hours) {
    const minutes = Math.round(hours * 60);
    if (minutes < 60) return `${minutes} Min.`;
    return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(hours)} Std.`;
  }

  function updateHomeTimeline(now) {
    const wrapper = homePanel?.querySelector(".lfs-playlist-primary-wrap");
    const timeline = homePanel?.querySelector(".lfs-playlist-timeline");
    if (!wrapper || !timeline) return;
    const label = `Rätsel-Playlist (${dueItems(now).length})`;
    timeline.setAttribute("aria-label", label);
    const due = dueItems(now).length > 0;
    wrapper.dataset.due = String(due);
    const ring = due ? 1 : nextDueProgress(now);
    wrapper.style.setProperty("--lfs-home-ring", `${Math.round(ring * 100)}%`);
    const dueLeft = playlist.items
      .filter(item => item.state === "new" || item.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt);
    const dueCount = dueLeft.length;
    const dueCountElement = timeline.querySelector(".lfs-playlist-timeline-due-count");
    if (dueCountElement && dueCountElement.textContent !== String(dueCount)) {
      dueCountElement.textContent = String(dueCount);
    }
    timeline.dataset.windowHours = String(timelineWindowHours);
    timeline.setAttribute("aria-label", `${label}, Rad zoomen, Zeitfenster ${formatWindow(timelineWindowHours)}`);
    const legend = homePanel.querySelector(".lfs-playlist-timeline-legend");
    if (legend) {
      const legendEnd = legend.querySelector(".lfs-playlist-timeline-legend-end");
      if (legendEnd) legendEnd.textContent = `+${formatWindow(timelineWindowHours)}`;
      const tickKey = String(timelineWindowHours);
      if (legend.dataset.tickWindow !== tickKey) {
        legend.dataset.tickWindow = tickKey;
        const ticks = legend.querySelector(".lfs-playlist-timeline-ticks");
        if (ticks) {
          ticks.replaceChildren();
          const stepHours = timelineWindowHours <= 2 ? 1 / 6 : 1;
          for (let hours = 0; hours <= timelineWindowHours + 0.001; hours += stepHours) {
            const tick = document.createElement("span");
            const isHour = Math.abs(hours - Math.round(hours)) < 0.001;
            const isStart = hours < 0.001;
            tick.className = isStart ? "lfs-playlist-timeline-tick lfs-playlist-timeline-tick-hour lfs-playlist-timeline-tick-start"
              : isHour ? "lfs-playlist-timeline-tick lfs-playlist-timeline-tick-hour" : "lfs-playlist-timeline-tick";
            tick.style.left = `${Math.min((hours / timelineWindowHours) * 100, 100)}%`;
            ticks.append(tick);
          }
        }
      }
    }
    const windowMs = timelineWindowHours * 60 * 60 * 1000;
    const future = playlist.items
      .filter(item => item.state !== "new" && item.dueAt > now && item.dueAt <= now + windowMs)
      .sort((a, b) => a.dueAt - b.dueAt);
    const desiredIds = new Set(future.map(item => item.id));
    for (const [id, element] of [...timelinePieceElements.entries()]) {
      if (desiredIds.has(id)) continue;
      element.remove();
      timelinePieceElements.delete(id);
    }
    const width = timeline.clientWidth || 240;
    const baseSize = 18;
    const trackHeight = 30;
    const minSize = 6;
    const clusterGap = (baseSize / Math.max(width, 1)) * 100;
    const clusters = [];
    for (const item of future) {
      const xPx = timelineStartPx + ((item.dueAt - now) / windowMs) * Math.max(width - timelineStartPx, 1);
      const xPercent = (xPx / Math.max(width, 1)) * 100;
      const last = clusters.at(-1);
      if (last && Math.abs(xPercent - last.xPercent) < clusterGap) {
        last.items.push({ item, xPercent });
        last.xPercent = last.items.reduce((sum, entry) => sum + entry.xPercent, 0) / last.items.length;
      } else {
        clusters.push({ xPercent, items: [{ item, xPercent }] });
      }
    }
    const renderedIds = new Set();
    for (const cluster of clusters) {
      const count = cluster.items.length;
      const fitSize = Math.floor(trackHeight / count);
      let size = Math.min(baseSize, fitSize);
      if (size < minSize) size = minSize;
      const visible = Math.min(count, Math.floor(trackHeight / size));
      cluster.items.slice(0, visible).forEach((entry, index) => {
        renderedIds.add(entry.item.id);
        let element = timelinePieceElements.get(entry.item.id);
        if (!element) {
          element = document.createElement("img");
          element.className = "lfs-playlist-timeline-piece";
          element.dataset.id = entry.item.id;
          element.alt = "";
          element.setAttribute("aria-hidden", "true");
          timeline.append(element);
          timelinePieceElements.set(entry.item.id, element);
        }
        element.style.left = `${cluster.xPercent}%`;
        element.style.bottom = `${index * size}px`;
        element.style.width = `${size}px`;
        element.style.height = `${size}px`;
        const url = pieceAssetUrl(entry.item);
        if (element.dataset.asset !== url) {
          element.src = url;
          element.dataset.asset = url;
        }
      });
    }
    for (const [id, element] of [...timelinePieceElements.entries()]) {
      if (renderedIds.has(id)) continue;
      element.remove();
      timelinePieceElements.delete(id);
    }
  }

  function startHomeTick() {
    if (homeTickTimer !== null) return;
    homeTickTimer = window.setInterval(() => {
      if (!homePanel) return;
      updateHomeTimeline(Date.now());
    }, 1000);
  }

  function renderHomePanel() {
    if (!homePanel) return;
    const now = Date.now();
    scheduleDueRefresh(now);
    const label = `Rätsel-Playlist (${dueItems(now).length})`;
    if (homePanel.dataset.rendered) {
      updateHomeTimeline(now);
      startHomeTick();
      return;
    }
    homePanel.dataset.rendered = "true";
    const wrapper = document.createElement("div");
    wrapper.className = "lfs-playlist-primary-wrap";
    const timeline = makeButton(label, "open", "lfs-playlist-primary lfs-playlist-timeline");
    timeline.textContent = "";
    timeline.setAttribute("aria-label", label);
    const dueCountElement = document.createElement("span");
    dueCountElement.className = "lfs-playlist-timeline-due-count";
    dueCountElement.setAttribute("aria-hidden", "true");
    timeline.append(dueCountElement);
    timeline.addEventListener("wheel", event => {
      event.preventDefault();
      const deltaPx = event.deltaMode === 1 ? event.deltaY * 33
        : event.deltaMode === 2 ? event.deltaY * window.innerHeight
          : event.deltaY;
      const factor = Math.exp(deltaPx * 0.0012);
      timelineWindowHours = Math.min(48, Math.max(0.5, timelineWindowHours * factor));
      if (timelineZoomFrame !== 0) return;
      timelineZoomFrame = window.requestAnimationFrame(() => {
        timelineZoomFrame = 0;
        updateHomeTimeline(Date.now());
      });
    }, { passive: false });
    wrapper.append(timeline);
    const legend = document.createElement("div");
    legend.className = "lfs-playlist-timeline-legend";
    legend.setAttribute("aria-hidden", "true");
    const ticks = document.createElement("span");
    ticks.className = "lfs-playlist-timeline-ticks";
    const end = document.createElement("span");
    end.className = "lfs-playlist-timeline-legend-end";
    legend.append(ticks, end);
    homePanel.replaceChildren(
      wrapper,
      legend,
    );
    updateHomeTimeline(now);
    startHomeTick();
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
      render();
    }, Math.min(target - now, 2147483647));
  }

  function ensureHomeClickHandler() {
    if (!homePanel || homePanel.dataset.handlerBound) return;
    homePanel.dataset.handlerBound = "true";
    homePanel.addEventListener("click", event => {
      const control = event.target.closest("[data-action]");
      if (control?.dataset.action === "open") {
        const ready = dueItems();
        if (ready.length) startQueue(ready.map(item => item.id));
        else location.hash = "puzzle-playlist";
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
    savePlaylist({ ...playlist, items, activeQueue: activeIndex === null ? [] : activeQueue, activeIndex });
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
    const saveDescription = "Zu Playlist hinzufügen";

    if (!puzzleMenuSaveButton) {
      puzzleMenuSaveButton = makeButton(saveDescription, "menu-save");
      puzzleMenuSaveButton.addEventListener("click", toggleSavedPuzzle);
    }
    const isComplete = !!document.querySelector(".puzzle__feedback.after");
    const ratedThisVisit = Number.isFinite(savedItem?.lastReviewedAt) && savedItem.lastReviewedAt >= pageLoadedAt;
    if (!puzzleToolbar) {
      puzzleToolbar = document.createElement("div");
      puzzleToolbar.id = puzzleToolbarId;
      puzzleToolbar.className = "lfs-playlist-toolbar";
    }
    if (puzzleToolbar.parentElement !== toolbarParent) toolbarParent.append(puzzleToolbar);

    const viewKey = JSON.stringify([id, savedItem, playlist.activeQueue, playlist.activeIndex, isComplete, ratedThisVisit, zenMode, ratingMaxPosition]);
    if (puzzleToolbar.dataset.viewKey === viewKey) return;
    puzzleToolbar.removeAttribute("data-lfs-zen-toolbar-positioned");
    puzzleToolbar.dataset.viewKey = viewKey;
    puzzleToolbar.dataset.puzzleId = id;
    puzzleToolbar.dataset.solved = String(isComplete);
    puzzleMenuSaveButton.dataset.puzzleId = id;
    puzzleMenuSaveButton.textContent = saveDescription;
    puzzleMenuSaveButton.className = "lfs-playlist-button lfs-playlist-primary";
    puzzleToolbar.replaceChildren();

    if (isComplete && savedItem && !ratedThisVisit) {
      const ratings = document.createElement("div");
      ratings.className = "lfs-review-ratings";
      const easy = document.createElement("span");
      easy.className = "lfs-review-label lfs-review-label-easy";
      easy.textContent = "Einfach";
      const slider = document.createElement("input");
      slider.className = "lfs-review-slider";
      slider.type = "range";
      slider.min = "0";
      slider.max = "1";
      slider.step = "any";
      slider.value = String((savedItem.lastRating ?? 0.5) * ratingMaxPosition);
      slider.style.setProperty("--lfs-review-max-position", `${ratingMaxPosition * 100}%`);
      slider.style.setProperty("--lfs-review-thumb-image", ratingThumbImage);
      slider.dataset.action = "rate";
      slider.setAttribute("aria-label", "Bewertung von einfach bis nochmal");
      const hard = document.createElement("span");
      hard.className = "lfs-review-label lfs-review-label-hard";
      hard.textContent = "Schwer";
      const updateSliderPosition = () => {
        slider.style.setProperty("--lfs-review-value", `${Number(slider.value) * 100}%`);
      };
      slider.addEventListener("input", updateSliderPosition);
      slider.addEventListener("click", () => ratePlaylistPuzzle(slider));
      updateSliderPosition();
      ratings.append(easy, slider, hard);
      puzzleToolbar.append(ratings);
    }
    if (!savedItem) {
      puzzleToolbar.append(puzzleMenuSaveButton);
      if (isComplete) {
        const nextButton = makeButton("Nächstes Rätsel", "native-next");
        nextButton.addEventListener("click", () => {
          if (puzzleToolbar.dataset.puzzleId !== puzzleId()) {
            render();
            return;
          }
          advanceNativePuzzle();
        });
        puzzleToolbar.append(nextButton);
      }
    }

    if (puzzleToolbar.dataset.handlerBound) return;
    puzzleToolbar.dataset.handlerBound = "true";
    puzzleToolbar.addEventListener("change", event => {
      const control = event.target.closest('[data-action="rate"]');
      if (control) ratePlaylistPuzzle(control);
    });
  }

  function ratePlaylistPuzzle(control) {
    const currentId = puzzleId();
    if (puzzleToolbar.dataset.puzzleId !== currentId) {
      render();
      return;
    }
    const index = playlist.items.findIndex(item => item.id === currentId);
    if (index < 0 || playlist.items[index].lastReviewedAt >= pageLoadedAt) return;
    const position = Number(control.value);
    if (!Number.isFinite(position)) return;
    const rating = Math.max(0, Math.min(1, position));
    const items = [...playlist.items];
    items[index] = scheduler.scheduleEase(items[index], rating, Date.now(), ratingMaxPosition);
    const next = { ...playlist, items };
    playlist = normalizePlaylist(next);
    const isActive = playlist.activeIndex !== null && playlist.activeQueue[playlist.activeIndex] === currentId;
    if (isActive && continuePlaylist(currentId)) return;
    savePlaylist(next, advanceNativePuzzle);
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
    savePlaylist({ ...playlist, activeQueue: [], activeIndex: null, activeStartedAt: null }, () => {
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

  function teardown() {
    puzzleObserver?.disconnect();
    observedPuzzle = null;
    puzzleToolbar?.remove();
    puzzleToolbar = null;
    puzzleMenuSaveButton?.remove();
    puzzleMenuSaveButton = null;
    restoreHomeSide();
    restorePlaylistPage();
  }

  function render() {
    if (!pluginEnabled) {
      teardown();
      return;
    }
    if (appendNewlyDueToSession()) return;
    scheduleDueRefresh(Date.now());
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
      puzzleToolbar.removeAttribute("data-lfs-zen-toolbar-positioned");
      return;
    }
    const board = document.querySelector(".puzzle__board cg-board");
    const rect = board?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) {
      puzzleToolbar.removeAttribute("data-lfs-zen-toolbar-positioned");
      return;
    }
    const scale = Number.parseFloat(document.documentElement.style.getPropertyValue("--lfs-board-ui-scale")) || 1;
    const gap = 6 * scale;
    const height = puzzleToolbar.getBoundingClientRect().height;
    const top = Math.min(rect.bottom + gap, Math.max(gap, window.innerHeight - height - gap));
    puzzleToolbar.style.setProperty("--lfs-zen-toolbar-left", `${rect.left}px`);
    puzzleToolbar.style.setProperty("--lfs-zen-toolbar-top", `${top}px`);
    puzzleToolbar.style.setProperty("--lfs-zen-toolbar-width", `${rect.width}px`);
    puzzleToolbar.setAttribute("data-lfs-zen-toolbar-positioned", "");
  }

  function scheduleZenToolbarPosition() {
    if (!puzzleToolbar) return;
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

  function normalizePieceSettings(values) {
    const partial = {};
    if (values?.pieceSet !== undefined) partial.pieceSet = values.pieceSet;
    if (values?.complexPawn !== undefined) partial.complexPawn = values.complexPawn;
    return settings.normalize(partial);
  }

  chrome.storage.local.get([storageKey, ratingMaxPositionSetting, "enabled", "pieceSet", "complexPawn"], stored => {
    pluginEnabled = stored.enabled !== false;
    pieceSettings = normalizePieceSettings(stored);
    ratingMaxPosition = settings.normalize({ [ratingMaxPositionSetting]: stored[ratingMaxPositionSetting] })[ratingMaxPositionSetting];
    const storedPlaylist = stored[storageKey];
    playlist = normalizePlaylist(storedPlaylist);
    if (storedPlaylist && storedPlaylist.ratingScaleVersion !== scheduler.ratingScaleVersion) {
      chrome.storage.local.set({ [storageKey]: playlist }, render);
      return;
    }
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let changed = false;
    if (Object.hasOwn(changes, "enabled")) {
      pluginEnabled = changes.enabled.newValue !== false;
      changed = true;
    }
    if (Object.hasOwn(changes, storageKey)) {
      playlist = normalizePlaylist(changes[storageKey].newValue);
      changed = true;
    }
    if (Object.hasOwn(changes, ratingMaxPositionSetting)) {
      ratingMaxPosition = settings.normalize({ [ratingMaxPositionSetting]: changes[ratingMaxPositionSetting].newValue })[ratingMaxPositionSetting];
      changed = true;
    }
    if (Object.hasOwn(changes, "pieceSet") || Object.hasOwn(changes, "complexPawn")) {
      pieceSettings = normalizePieceSettings({
        pieceSet: changes.pieceSet?.newValue,
        complexPawn: changes.complexPawn?.newValue,
      });
      for (const element of timelinePieceElements.values()) delete element.dataset.asset;
      changed = true;
    }
    if (!changed) return;
    render();
  });

  new MutationObserver(records => {
    const atHome = /^\/(?:[a-z]{2,3}(?:-[a-z0-9]+)*\/?)?$/i.test(location.pathname);
    const onPuzzlePage = /^\/training(?:\/|$)/.test(location.pathname);
    if (!atHome && !onPuzzlePage) return;
    const selector = atHome ? "main.lobby, .lobby__side" : ".puzzle";
    const relevant = records.some(record => {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (atHome && target?.matches(selector)) return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE
        && (node.matches(selector) || node.querySelector(selector)));
    });
    if (relevant) scheduleRender();
  }).observe(document, { childList: true, subtree: true });
  if (document.documentElement) {
    new MutationObserver(scheduleRender).observe(document.documentElement, { attributes: true, attributeFilter: ["data-lfs-zen-mode"] });
  }
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("resize", scheduleZenToolbarPosition);
  window.visualViewport?.addEventListener("resize", scheduleZenToolbarPosition);
  document.addEventListener("fullscreenchange", scheduleZenToolbarPosition);
  document.addEventListener("scroll", scheduleZenToolbarPosition, true);
  document.addEventListener("lfs-board-layout", scheduleZenToolbarPosition);
  document.addEventListener("click", handleNativePuzzleContinue, true);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && homePanel) updateHomeTimeline(Date.now());
  });
  window.addEventListener("focus", () => {
    if (homePanel) updateHomeTimeline(Date.now());
  });
})();
