(() => {
  const storageKey = "lfsBlunderList";
  const ratingMaxPositionSetting = "puzzleRatingMaxPosition";
  const settings = globalThis.LichessSettings;
  const ratingThumbImage = `url("${chrome.runtime.getURL(settings.getPieceAsset({ pieceSet: "system_rund" }, "b", "q"))}")`;
  const autoSyncStorageKey = "lfsBlunderAutoSync";
  const scheduler = globalThis.LichessPuzzleScheduler;
  let ratingMaxPosition = settings.defaults[ratingMaxPositionSetting];
  const maxBlunders = 500;
  const recentGameCount = 10;
  const visitedAt = Date.now();
  const autoSyncInterval = 6 * 60 * 60 * 1000;
  const analysisOverlap = 7 * 24 * 60 * 60 * 1000;
  const maxAutoSyncAge = 30 * 24 * 60 * 60 * 1000;
  const earliestGameAt = 1356998400070;
  const minimumStartingEval = -100;
  let data = { items: [], activeQueue: [], activeIndex: null };
  let page;
  let lobby;
  let toolbar;
  let importing = false;
  let autoSyncStarted = false;
  let message = "";
  let scheduled = false;
  let exerciseState = "loading";
  let refreshTimer;

  function normalize(value) {
    const seen = new Set();
    const items = (Array.isArray(value?.items) ? value.items : []).filter(item => {
      if (!/^[a-zA-Z0-9]{8}$/.test(item?.gameId) || !Number.isInteger(item.ply) || item.ply < 1) return false;
      if (!["white", "black"].includes(item.color) || item.id !== `${item.gameId}:${item.ply}` || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).map(item => {
      const reps = Number.isInteger(item.reps) && item.reps >= 0 ? item.reps : 0;
      return {
        ...item,
        state: ["new", "learning", "review"].includes(item.state) ? item.state : "new",
        dueAt: Number.isFinite(item.dueAt) ? item.dueAt : 0,
        playedAt: Number.isFinite(item.playedAt) ? item.playedAt : 0,
        reps,
        attempts: Number.isInteger(item.attempts) && item.attempts >= reps ? item.attempts : reps,
        lastReviewedAt: Number.isFinite(item.lastReviewedAt) ? item.lastReviewedAt : null,
        lastRating: scheduler.normalizeRating(item.lastRating, value?.ratingScaleVersion),
      };
    }).sort((a, b) => b.playedAt - a.playedAt).slice(0, maxBlunders);
    seen.clear();
    items.forEach(item => seen.add(item.id));
    const activeQueue = [...new Set((Array.isArray(value?.activeQueue) ? value.activeQueue : []).filter(id => seen.has(id)))];
    const activeIndex = Number.isInteger(value?.activeIndex) && value.activeIndex >= 0 && value.activeIndex < activeQueue.length
      ? value.activeIndex : null;
    return { items, activeQueue, activeIndex, ratingScaleVersion: scheduler.ratingScaleVersion };
  }

  function save(update, done) {
    // Share one lock across Lichess tabs so imports cannot overwrite ratings.
    const operation = navigator.locks.request(storageKey, async () => {
      const stored = await chrome.storage.local.get(storageKey);
      const next = normalize(update(normalize(stored[storageKey])));
      await chrome.storage.local.set({ [storageKey]: next });
      data = next;
      render();
      renderPage();
      done?.(next);
    });
    operation.catch(error => {
      message = `Speichern fehlgeschlagen: ${error.message}`;
      renderPage();
    });
    return operation;
  }

  function username() {
    const tag = document.querySelector("#user_tag");
    const href = tag?.getAttribute("href");
    return href?.match(/^\/@\/([^/?#]+)/)?.[1] ?? tag?.textContent.trim() ?? "";
  }

  function extractBlunders(game, user) {
    const color = ["white", "black"].find(side => game.players?.[side]?.user?.id?.toLowerCase() === user.toLowerCase());
    if (!color || !/^[a-zA-Z0-9]{8}$/.test(game.id) || !Array.isArray(game.analysis)) return [];
    const opponent = game.players[color === "white" ? "black" : "white"]?.user?.name ?? "Unbekannt";
    const fen = game.initialFen?.split(/\s+/);
    const initialPly = fen ? (Math.max(1, Number(fen[5]) || 1) - 1) * 2 + Number(fen[1] === "b") : 0;
    return game.analysis.flatMap((evaluation, index) => {
      const ply = initialPly + index + 1;
      if ((ply % 2 === 1) !== (color === "white") || evaluation.judgment?.name !== "Blunder") return [];
      const previous = game.analysis[index - 1];
      const previousEval = Number.isFinite(previous?.eval)
        ? (color === "white" ? previous.eval : -previous.eval)
        : Number.isFinite(previous?.mate)
          ? Math.sign(previous.mate) * (color === "white" ? 1 : -1) * 10000
          : index === 0 && !game.initialFen ? 0 : null;
      if (previousEval === null || previousEval < minimumStartingEval) return [];
      return [{
        id: `${game.id}:${ply}`, gameId: game.id, ply, color, opponent,
        best: evaluation.best ?? null, owner: user.toLowerCase(),
        playedAt: game.createdAt ?? 0, state: "new", dueAt: 0, reps: 0, attempts: 0,
      }];
    });
  }

  async function importGames({ user = username(), since } = {}) {
    if (importing) return;
    if (!user) {
      message = "Melde dich bei Lichess an, um deine Partien einzulesen.";
      renderPage();
      return;
    }
    importing = true;
    message = "Analysierte Partien werden eingelesen ...";
    renderPage();
    let count = 0;
    let imported = [];
    let importedCount = 0;
    let limitReached = false;
    const importedIds = new Set(data.items.map(item => item.id));
    const merge = async () => {
      const batch = imported;
      imported = [];
      if (!batch.length) return;
      await save(current => {
        const existing = new Set(current.items.map(item => item.id));
        const additions = batch.filter(item => !existing.has(item.id) && existing.add(item.id));
        return { ...current, items: [...current.items, ...additions] };
      });
    };
    try {
      const query = new URLSearchParams({ analysed: "true", evals: "true", clocks: "false", opening: "false", moves: "false", ongoing: "false" });
      if (Number.isFinite(since)) query.set("since", String(since));
      const response = await fetch(`/api/games/user/${encodeURIComponent(user)}?${query}`, {
        headers: { Accept: "application/x-ndjson" },
      });
      if (!response.ok) throw new Error(response.status === 429
        ? "Lichess begrenzt gerade die Anfragen. Bitte später erneut synchronisieren."
        : `Partien konnten nicht geladen werden (HTTP ${response.status}).`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      const consume = async line => {
        if (!line.trim() || limitReached) return;
        const additions = extractBlunders(JSON.parse(line), user).filter(item => !importedIds.has(item.id));
        for (const item of additions) {
          if (importedCount >= maxBlunders) break;
          importedIds.add(item.id);
          imported.push(item);
          importedCount++;
        }
        count++;
        if (count % 20 === 0 || importedCount >= maxBlunders) {
          await merge();
        }
        if (importedCount >= maxBlunders) {
          limitReached = true;
          await reader.cancel?.();
        } else if (count % 20 === 0) {
          message = `${count} analysierte Partien eingelesen ...`;
          renderPage();
        }
      };
      try {
        while (true) {
          const { value, done } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          const lines = pending.split("\n");
          pending = lines.pop();
          for (const line of lines) {
            await consume(line);
            if (limitReached) break;
          }
          if (limitReached) break;
          if (done) break;
        }
        if (!limitReached && pending.trim()) await consume(pending);
      } finally {
        reader.releaseLock();
      }
      await merge();
      message = limitReached
        ? `Maximal ${maxBlunders} neue Blunder eingelesen.`
        : `${count} analysierte Partien eingelesen. Nicht analysierte Partien müssen zuerst auf Lichess analysiert werden.`;
      return true;
    } catch (error) {
      await merge();
      message = `Einlesen unterbrochen: ${error.message}`;
      return false;
    } finally {
      importing = false;
      renderPage();
    }
  }

  async function maybeAutoSync() {
    const user = username();
    if (!user || autoSyncStarted) return;
    autoSyncStarted = true;
    try {
      await navigator.locks.request(`${autoSyncStorageKey}:${user.toLowerCase()}`, async () => {
        const stored = await chrome.storage.local.get(autoSyncStorageKey);
        const timestamps = stored[autoSyncStorageKey] ?? {};
        const previousSync = timestamps[user.toLowerCase()];
        if (Number.isFinite(previousSync) && Date.now() - previousSync < autoSyncInterval) return;
        const since = Math.max(earliestGameAt, Date.now() - maxAutoSyncAge,
          Number.isFinite(previousSync) ? previousSync - analysisOverlap : 0);
        if (!await importGames({ user, since })) return;
        await chrome.storage.local.set({ [autoSyncStorageKey]: { ...timestamps, [user.toLowerCase()]: Date.now() } });
      });
    } catch (error) {
      console.warn("Lichess Blunder-Synchronisierung fehlgeschlagen:", error);
    }
  }

  function button(label, action, primary = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `lfs-playlist-button${primary ? " lfs-playlist-primary" : ""}`;
    element.textContent = label;
    element.dataset.action = action;
    return element;
  }

  function ownItems() {
    const owner = username().toLowerCase();
    return data.items.filter(item => item.owner === owner);
  }

  function dueItems() {
    const now = Date.now();
    return ownItems().filter(item => item.state === "new" || item.dueAt <= now)
      .sort((a, b) => Number(a.state === "new") - Number(b.state === "new") || a.dueAt - b.dueAt);
  }

  function exerciseUrl(item) {
    return `/${item.gameId}/${item.color}?lfs-blunder=${item.ply}#${item.ply - 1}`;
  }

  function startQueue(ids) {
    const item = ownItems().find(item => item.id === ids[0]);
    if (!item) return;
    const ownIds = new Set(ownItems().map(item => item.id));
    const queue = ids.filter(id => ownIds.has(id));
    return save(current => ({
      ...current,
      items: current.items.map(entry => entry.id === queue[0] ? { ...entry, attempts: entry.attempts + 1 } : entry),
      activeQueue: queue,
      activeIndex: 0,
    }), () => location.assign(exerciseUrl(item)));
  }

  async function recentGameIds() {
    const user = username();
    if (!user) throw new Error("Melde dich bei Lichess an, um zu trainieren.");
    const query = new URLSearchParams({ max: String(recentGameCount), ongoing: "false", moves: "false", clocks: "false", opening: "false" });
    const response = await fetch(`/api/games/user/${encodeURIComponent(user)}?${query}`, {
      headers: { Accept: "application/x-ndjson" },
    });
    if (!response.ok) throw new Error(`Die letzten Partien konnten nicht geladen werden (HTTP ${response.status}).`);
    const text = await response.text();
    return new Set(text.split("\n").filter(Boolean).slice(0, recentGameCount).map(line => JSON.parse(line).id));
  }

  let trainingStarting = false;
  async function startTraining(ids) {
    if (trainingStarting || !ids.length) return;
    trainingStarting = true;
    message = `Die letzten ${recentGameCount} Partien werden ausgeschlossen ...`;
    renderPage();
    try {
      const recent = await recentGameIds();
      const queue = ids.filter(id => {
        const item = ownItems().find(entry => entry.id === id);
        return item && !recent.has(item.gameId);
      });
      if (!queue.length) {
        message = `Keine passenden Blunder außerhalb der letzten ${recentGameCount} Partien.`;
        location.hash = "blunder-list";
        return;
      }
      await startQueue(queue);
    } catch (error) {
      message = `Training konnte nicht gestartet werden: ${error.message}`;
      location.hash = "blunder-list";
    } finally {
      trainingStarting = false;
      renderPage();
    }
  }

  function openBlunders() {
    const items = ownItems();
    if (!items.length) {
      location.hash = "blunder-list";
      return;
    }
    const due = dueItems();
    return startTraining((due.length ? due : items).map(item => item.id));
  }

  function activeItem() {
    if (data.activeIndex === null) return null;
    const item = ownItems().find(item => item.id === data.activeQueue[data.activeIndex]);
    return item && location.pathname === `/${item.gameId}/${item.color}`
      && new URLSearchParams(location.search).get("lfs-blunder") === String(item.ply) ? item : null;
  }

  function intervalLabel(milliseconds) {
    const minutes = Math.max(1, Math.round(milliseconds / 60000));
    if (minutes < 60) return `${minutes} Min.`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.round(hours)} Std.`;
    return `${Math.round(hours / 24)} Tage`;
  }

  function renderPage() {
    if (!page) return;
    const scrollTop = page.querySelector(".lfs-playlist-list")?.scrollTop ?? 0;
    const due = dueItems();
    const items = ownItems();
    const solvedCount = items.reduce((total, item) => total + item.reps, 0);
    const attemptCount = items.reduce((total, item) => total + item.attempts, 0);
    const header = document.createElement("header");
    header.className = "lfs-playlist-page-header";
    const title = document.createElement("h1");
    title.textContent = "Blunder-Liste";
    const home = button("Startseite", "home");
    home.classList.add("lfs-playlist-quiet");
    const score = document.createElement("div");
    score.className = "lfs-playlist-score";
    const scoreValue = document.createElement("strong");
    scoreValue.textContent = `${solvedCount} / ${attemptCount}`;
    const scoreLabel = document.createElement("small");
    scoreLabel.textContent = "Gelöst / Versuche";
    score.append(scoreValue, scoreLabel);
    header.append(title, score, home);
    const summary = document.createElement("p");
    summary.className = "lfs-playlist-page-summary";
    summary.textContent = `${items.length} Stellungen · ${due.length} bereit`;
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = message;
    const actions = document.createElement("div");
    actions.className = "lfs-playlist-page-actions";
    const start = button(`Trainieren (${due.length})`, "start", true);
    start.disabled = trainingStarting || !due.length;
    const sync = button(importing ? "Wird eingelesen ..." : "Synchronisieren", "sync");
    sync.classList.add("lfs-playlist-quiet");
    sync.disabled = importing;
    actions.append(start, sync);
    page.replaceChildren(header, summary, actions, status);
    const list = document.createElement("ol");
    list.className = "lfs-playlist-list";
    list.tabIndex = 0;
    list.setAttribute("aria-label", "Gespeicherte Blunder-Stellungen");
    for (const item of items) {
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.href = exerciseUrl(item);
      link.dataset.action = "play";
      link.dataset.id = item.id;
      link.textContent = `Gegen ${item.opponent}, Zug ${Math.ceil(item.ply / 2)} (${item.color === "white" ? "Weiß" : "Schwarz"})`;
      link.title = link.textContent;
      const status = document.createElement("small");
      status.className = "lfs-playlist-item-status";
      status.textContent = item.state === "new" ? "Neu" : item.dueAt <= Date.now() ? "Fällig" : `in ${intervalLabel(item.dueAt - Date.now())}`;
      status.dataset.ready = String(item.state === "new" || item.dueAt <= Date.now());
      const score = document.createElement("span");
      score.className = "lfs-playlist-item-score";
      score.textContent = `${item.reps} / ${item.attempts}`;
      score.title = "Gelöst / Versuche";
      row.append(link, status, score);
      list.append(row);
    }
    if (items.length) {
      page.append(list);
      list.scrollTop = scrollTop;
    }
    else {
      const empty = document.createElement("p");
      empty.className = "lfs-playlist-empty";
      empty.textContent = "Noch keine Stellungen. Synchronisiere deine analysierten Partien.";
      page.append(empty);
    }
    clearTimeout(refreshTimer);
    const nextDue = ownItems().reduce((next, item) => item.dueAt > Date.now() ? Math.min(next, item.dueAt) : next, Infinity);
    if (Number.isFinite(nextDue)) refreshTimer = setTimeout(renderPage, Math.min(Math.max(1, nextDue - Date.now()), 2147483647));
  }

  function pageClick(event) {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    switch (control.dataset.action) {
      case "home": location.hash = ""; break;
      case "sync": importGames(); break;
      case "start": startTraining(dueItems().map(item => item.id)); break;
      case "play":
        event.preventDefault();
        startTraining([control.dataset.id]);
        break;
    }
  }

  function renderToolbar() {
    const item = activeItem();
    const parent = document.querySelector(".analyse__tools");
    if (!item || !parent) {
      toolbar?.remove();
      toolbar = null;
      document.documentElement?.removeAttribute("data-lfs-blunder-training");
      return;
    }
    document.documentElement.setAttribute("data-lfs-blunder-training", exerciseState === "solved" ? "solved" : "active");
    if (!toolbar) {
      toolbar = document.createElement("section");
      toolbar.className = "lfs-playlist-toolbar lfs-blunder-toolbar";
      toolbar.addEventListener("click", toolbarClick);
      toolbar.addEventListener("change", toolbarChange);
      parent.prepend(toolbar);
    }
    if (toolbar.parentElement !== parent) parent.prepend(toolbar);
    const key = JSON.stringify([item, exerciseState, data.activeIndex, ratingMaxPosition]);
    if (toolbar.dataset.viewKey === key) return;
    toolbar.dataset.viewKey = key;
    const title = document.createElement("h3");
    title.textContent = `Blunder ${data.activeIndex + 1} von ${data.activeQueue.length}`;
    const description = document.createElement("p");
    description.textContent = exerciseState === "solved" ? "Lösung gefunden. Wie gut konntest du dich erinnern?"
      : exerciseState === "wrong" ? "Das ist nicht der gesuchte Zug. Versuche es erneut."
      : exerciseState === "error" ? "Die Stellung konnte nicht vorbereitet werden. Lade die Seite erneut."
      : exerciseState === "loading" ? "Stellung wird vorbereitet ..." : "Finde den besten Zug statt deines damaligen groben Fehlers.";
    toolbar.replaceChildren(title, description);
    if (item.lastReviewedAt >= visitedAt) {
      description.textContent = `Wiederholung in ${intervalLabel(item.dueAt - Date.now())} geplant.`;
      toolbar.append(button(data.activeIndex + 1 < data.activeQueue.length ? "Nächste Stellung" : "Sitzung abschließen", "next", true));
    } else if (exerciseState === "solved") {
      toolbar.replaceChildren();
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
      slider.value = String((item.lastRating ?? 0.5) * ratingMaxPosition);
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
      updateSliderPosition();
      ratings.append(easy, slider, hard);
      toolbar.append(ratings);
    } else if (["ready", "wrong"].includes(exerciseState)) {
      toolbar.append(button("Lösung zeigen", "reveal"));
    }
    const back = button("Zur Blunder-Liste", "list");
    back.classList.add("lfs-playlist-quiet");
    toolbar.append(back);
  }

  function toolbarClick(event) {
    const control = event.target.closest("[data-action]");
    const item = activeItem();
    if (!control || !item) return;
    if (control.dataset.action === "next" && item.lastReviewedAt >= visitedAt) {
      save(current => {
        if (current.activeQueue[current.activeIndex] !== item.id) return current;
        const nextIndex = current.activeIndex + 1;
        const hasNext = nextIndex < current.activeQueue.length;
        const nextId = hasNext ? current.activeQueue[nextIndex] : null;
        return {
          ...current,
          items: hasNext ? current.items.map(entry => entry.id === nextId ? { ...entry, attempts: entry.attempts + 1 } : entry) : current.items,
          activeIndex: hasNext ? nextIndex : null,
          activeQueue: hasNext ? current.activeQueue : [],
        };
      }, current => {
        const next = current.items.find(entry => entry.id === current.activeQueue[current.activeIndex]);
        location.assign(next ? exerciseUrl(next) : "/#blunder-list");
      });
    } else if (control.dataset.action === "reveal") {
      document.dispatchEvent(new CustomEvent("lfs-blunder-command", { detail: JSON.stringify({ action: "reveal" }) }));
    } else if (control.dataset.action === "list") {
      location.assign("/#blunder-list");
    }
  }

  function toolbarChange(event) {
    const control = event.target.closest('[data-action="rate"]');
    const item = activeItem();
    if (!control || !item || exerciseState !== "solved" || item.lastReviewedAt >= visitedAt) return;
    const rating = Number(control.value);
    if (!Number.isFinite(rating) || rating < 0 || rating > 1) return;
    save(current => ({ ...current, items: current.items.map(entry => entry.id === item.id && !(entry.lastReviewedAt >= visitedAt)
      ? scheduler.scheduleEase(entry, rating, Date.now(), ratingMaxPosition) : entry) }));
  }

  function render() {
    const nextLobby = location.pathname === "/" && location.hash === "#blunder-list" ? document.querySelector("main.lobby") : null;
    if (lobby && lobby !== nextLobby) {
      lobby.querySelectorAll("[data-lfs-blunder-hidden]").forEach(element => element.removeAttribute("data-lfs-blunder-hidden"));
      page?.remove();
      page = null;
      clearTimeout(refreshTimer);
    }
    lobby = nextLobby;
    if (lobby) {
      if (!page) {
        page = document.createElement("section");
        page.className = "lfs-playlist-page";
        page.id = "lfs-blunder-page";
        page.addEventListener("click", pageClick);
        lobby.append(page);
        renderPage();
      }
      for (const child of lobby.children) {
        if (child !== page) child.setAttribute("data-lfs-blunder-hidden", "");
      }
    }
    maybeAutoSync();
    renderToolbar();
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }

  document.addEventListener("lfs-blunder-state", event => {
    let state;
    try { state = JSON.parse(event.detail); } catch { return; }
    const item = activeItem();
    if (!item || state.id !== item.id) return;
    if (state.status === "request") {
      document.dispatchEvent(new CustomEvent("lfs-blunder-command", { detail: JSON.stringify({ action: "prepare", ...item }) }));
      return;
    }
    if (!["ready", "wrong", "solved", "error"].includes(state.status)) return;
    exerciseState = state.status;
    renderToolbar();
  });
  document.addEventListener("lfs-blunder-open", openBlunders);
  chrome.storage.local.get([storageKey, ratingMaxPositionSetting], stored => {
    ratingMaxPosition = settings.normalize({ [ratingMaxPositionSetting]: stored[ratingMaxPositionSetting] })[ratingMaxPositionSetting];
    const storedData = stored[storageKey];
    data = normalize(storedData);
    const finishLoading = () => {
      render();
      const item = activeItem();
      if (item) document.dispatchEvent(new CustomEvent("lfs-blunder-command", { detail: JSON.stringify({ action: "prepare", ...item }) }));
    };
    if (storedData && storedData.ratingScaleVersion !== scheduler.ratingScaleVersion) {
      chrome.storage.local.set({ [storageKey]: data }, finishLoading);
      return;
    }
    finishLoading();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const dataChanged = Object.hasOwn(changes, storageKey);
    const ratingSettingChanged = Object.hasOwn(changes, ratingMaxPositionSetting);
    if (!dataChanged && !ratingSettingChanged) return;
    if (dataChanged) data = normalize(changes[storageKey].newValue);
    if (ratingSettingChanged) {
      ratingMaxPosition = settings.normalize({ [ratingMaxPositionSetting]: changes[ratingMaxPositionSetting].newValue })[ratingMaxPositionSetting];
    }
    render();
    if (dataChanged) renderPage();
  });
  new MutationObserver(scheduleRender).observe(document, { childList: true, subtree: true });
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("popstate", scheduleRender);
})();
