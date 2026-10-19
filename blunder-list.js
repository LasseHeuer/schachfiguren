(() => {
  const storageKey = "lfsBlunderList";
  const autoSyncStorageKey = "lfsBlunderAutoSync";
  const scheduler = globalThis.LichessPuzzleScheduler;
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
    }).map(item => ({
      ...item,
      state: ["new", "learning", "review"].includes(item.state) ? item.state : "new",
      dueAt: Number.isFinite(item.dueAt) ? item.dueAt : 0,
      reps: Number.isInteger(item.reps) && item.reps >= 0 ? item.reps : 0,
      lastReviewedAt: Number.isFinite(item.lastReviewedAt) ? item.lastReviewedAt : null,
    }));
    const activeQueue = [...new Set((Array.isArray(value?.activeQueue) ? value.activeQueue : []).filter(id => seen.has(id)))];
    const activeIndex = Number.isInteger(value?.activeIndex) && value.activeIndex >= 0 && value.activeIndex < activeQueue.length
      ? value.activeIndex : null;
    return { items, activeQueue, activeIndex };
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
        playedAt: game.createdAt ?? 0, state: "new", dueAt: 0, reps: 0,
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
        if (!line.trim()) return;
        imported.push(...extractBlunders(JSON.parse(line), user));
        count++;
        if (count % 20 === 0) {
          await merge();
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
          for (const line of lines) await consume(line);
          if (done) break;
        }
        if (pending.trim()) await consume(pending);
      } finally {
        reader.releaseLock();
      }
      await merge();
      message = `${count} analysierte Partien eingelesen. Nicht analysierte Partien müssen zuerst auf Lichess analysiert werden.`;
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
    return save(current => ({ ...current, activeQueue: ids.filter(id => ownIds.has(id)), activeIndex: 0 }), () => location.assign(exerciseUrl(item)));
  }

  function openBlunders() {
    const items = ownItems();
    if (!items.length) {
      location.hash = "blunder-list";
      return;
    }
    const due = dueItems();
    startQueue((due.length ? due : items).map(item => item.id));
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
    const due = dueItems();
    const header = document.createElement("header");
    header.className = "lfs-playlist-page-header";
    const title = document.createElement("h1");
    title.textContent = "Blunder-Liste";
    header.append(title, button("Zur Startseite", "home"));
    const summary = document.createElement("p");
    summary.textContent = `${due.length} Stellungen bereit · ${ownItems().length} insgesamt. Gesammelt werden nur deine eigenen groben Fehler aus analysierten Partien.`;
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = message;
    const actions = document.createElement("div");
    actions.className = "lfs-playlist-page-actions";
    const start = button(`Bereite Stellungen starten (${due.length})`, "start", true);
    start.disabled = !due.length;
    const sync = button(importing ? "Wird eingelesen ..." : "Partien synchronisieren", "sync");
    sync.disabled = importing;
    actions.append(start, sync);
    page.replaceChildren(header, summary, actions, status);
    const list = document.createElement("ol");
    list.className = "lfs-playlist-list";
    for (const item of ownItems()) {
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.href = exerciseUrl(item);
      link.dataset.action = "play";
      link.dataset.id = item.id;
      link.textContent = `Gegen ${item.opponent}, Zug ${Math.ceil(item.ply / 2)} (${item.color === "white" ? "Weiß" : "Schwarz"})`;
      const status = document.createElement("small");
      status.className = "lfs-playlist-item-status";
      status.textContent = item.state === "new" ? "Neu" : item.dueAt <= Date.now() ? "Fällig" : `in ${intervalLabel(item.dueAt - Date.now())}`;
      row.append(link, status);
      list.append(row);
    }
    page.append(list);
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
      case "start": startQueue(dueItems().map(item => item.id)); break;
      case "play":
        event.preventDefault();
        startQueue([control.dataset.id]);
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
      parent.prepend(toolbar);
    }
    if (toolbar.parentElement !== parent) parent.prepend(toolbar);
    const key = JSON.stringify([item, exerciseState, data.activeIndex]);
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
      const ratings = document.createElement("div");
      ratings.className = "lfs-review-ratings";
      for (const [label, grade] of [["Nochmal", 1], ["Schwer", 2], ["Gut", 3], ["Leicht", 4]]) {
        const rating = button(label, "rate");
        rating.classList.add("lfs-review-button");
        rating.dataset.grade = String(grade);
        const interval = document.createElement("small");
        interval.textContent = intervalLabel(scheduler.schedule(item, grade).dueAt - Date.now());
        rating.append(interval);
        ratings.append(rating);
      }
      toolbar.append(ratings);
    } else if (["ready", "wrong"].includes(exerciseState)) {
      toolbar.append(button("Lösung zeigen", "reveal"));
    }
    toolbar.append(button("Zur Blunder-Liste", "list"));
  }

  function toolbarClick(event) {
    const control = event.target.closest("[data-action]");
    const item = activeItem();
    if (!control || !item) return;
    if (control.dataset.action === "rate" && exerciseState === "solved" && !(item.lastReviewedAt >= visitedAt)) {
      const grade = Number(control.dataset.grade);
      if (![1, 2, 3, 4].includes(grade)) return;
      save(current => ({ ...current, items: current.items.map(entry => entry.id === item.id && !(entry.lastReviewedAt >= visitedAt)
        ? scheduler.schedule(entry, grade) : entry) }));
    } else if (control.dataset.action === "next" && item.lastReviewedAt >= visitedAt) {
      save(current => {
        if (current.activeQueue[current.activeIndex] !== item.id) return current;
        const nextIndex = current.activeIndex + 1;
        const hasNext = nextIndex < current.activeQueue.length;
        return { ...current, activeIndex: hasNext ? nextIndex : null, activeQueue: hasNext ? current.activeQueue : [] };
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
  chrome.storage.local.get(storageKey, stored => {
    data = normalize(stored[storageKey]);
    render();
    const item = activeItem();
    if (item) document.dispatchEvent(new CustomEvent("lfs-blunder-command", { detail: JSON.stringify({ action: "prepare", ...item }) }));
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.hasOwn(changes, storageKey)) return;
    data = normalize(changes[storageKey].newValue);
    render();
    renderPage();
  });
  new MutationObserver(scheduleRender).observe(document, { childList: true, subtree: true });
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("popstate", scheduleRender);
})();
