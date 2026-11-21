(() => {
  const storageKey = "lfsGameFavorites";
  const favoritePanelId = "lfs-game-favorites-panel";
  const studyPanelId = "lfs-study-favorites-panel";
  const puzzlePanelId = "lfs-puzzle-favorites-panel";
  const playlistPanelId = "lfs-puzzle-playlist-home";
  const contextMenuId = "lfs-game-favorites-context-menu";
  const tooltipId = "lfs-game-favorites-tooltip";
  const gameIdPattern = /^[a-zA-Z0-9_-]{8}$/;
  const fullIdPattern = /^[a-zA-Z0-9_-]{8}[wb]$/;
  const reservedSegments = new Set([
    "training", "broadcast", "tournament", "timetable", "study",
    "puzzle", "swag", "patron", "tv", "watch", "play", "analyse",
    "embed", "faq", "about", "contact", "terms", "privacy",
  ]);

  let favorites = [];
  let favoritesPanel = null;
  let favoritesSide = null;
  let contextMenu = null;
  let tooltip = null;
  let scheduled = false;
  let renderingStars = false;
  let draggedId = null;
  let dragPlaceholder = null;
  let dragSource = null;
  let dragGhost = null;
  let dragOffset = { x: 0, y: 0 };
  let latestPointer = null;
  let placeholderRaf = 0;
  let suppressNextClick = false;
  let pluginEnabled = true;

  function isHomePage() {
    return location.pathname === "/";
  }

  function normalizeFavorites(value) {
    const items = [];
    const seen = new Set();
    const list = Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
    for (const entry of list) {
      const id = typeof entry === "string" ? entry : entry?.id;
      if (typeof id !== "string" || !gameIdPattern.test(id) || seen.has(id)) continue;
      const name = String(entry?.name || "").trim();
      const href = String(entry?.href || `/${id}`).trim() || `/${id}`;
      if (!name) continue;
      if (gameIdFromHref(href) !== id) continue;
      seen.add(id);
      items.push({ id, name, href });
    }
    return items;
  }

  function favoriteMap() {
    return new Map(favorites.map((item) => [item.id, item]));
  }

  function saveFavorites(next) {
    favorites = normalizeFavorites(next);
    chrome.storage.local.set({ [storageKey]: { items: favorites } });
    render();
  }

  function toggleFavorite(game) {
    const map = favoriteMap();
    if (map.has(game.id)) map.delete(game.id);
    else map.set(game.id, game);
    saveFavorites({ items: [...map.values()] });
  }

  function removeFavorite(id) {
    saveFavorites({ items: favorites.filter((item) => item.id !== id) });
  }

  function gameIdFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      if (!parts[0]) return null;
      if (parts[0] === "broadcast") {
        const last = parts[parts.length - 1];
        const prev = parts[parts.length - 2];
        if (gameIdPattern.test(last) && gameIdPattern.test(prev || "")) return last;
        return null;
      }
      if (reservedSegments.has(parts[0])) return null;
      if (gameIdPattern.test(parts[0])) return parts[0];
      if (fullIdPattern.test(parts[0])) return parts[0].slice(0, 8);
      return null;
    } catch {
      return null;
    }
  }

  function gameHrefFromElement(anchor) {
    const href = anchor?.getAttribute?.("href") || anchor?.href || "";
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      return url.pathname + url.search;
    } catch {
      return href;
    }
  }

  function gameNameFromListElement(anchor, id) {
    if (anchor?.classList?.contains("relay-game")) {
      const players = [...(anchor.querySelectorAll(".relay-game__player") || [])]
        .map((playerEl) => playerEl.textContent?.trim().replace(/\s+/g, " ") || "")
        .filter(Boolean);
      if (players.length >= 2) return `${players[0]} vs ${players[1]}`;
      if (players.length === 1) return players[0];
    }
    const meta = anchor?.querySelector?.(".meta");
    const raw = meta?.textContent?.trim().replace(/\s+/g, " ") || "";
    if (raw) return raw;
    return `Partie ${id}`;
  }

  function playerName(playerEl) {
    return playerEl?.textContent?.trim().replace(/\s+/g, " ") || "";
  }

  function detailGame() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (!parts[0]) return null;
    if (parts[0] === "broadcast") {
      const last = parts[parts.length - 1];
      const prev = parts[parts.length - 2];
      if (!gameIdPattern.test(last) || !gameIdPattern.test(prev || "")) return null;
      if (!document.querySelector(".analyse__board") && !document.querySelector(".relay-tour") && !document.querySelector(".relay-game--current")) return null;
      const currentPlayers = [...document.querySelectorAll(".relay-game--current .relay-game__player")]
        .map((playerEl) => playerEl.textContent?.trim().replace(/\s+/g, " ") || "")
        .filter(Boolean);
      let name = "";
      if (currentPlayers.length >= 2) name = `${currentPlayers[0]} vs ${currentPlayers[1]}`;
      else if (currentPlayers.length === 1) name = currentPlayers[0];
      if (!name) {
        const title = document.querySelector(".relay-tour__header h1")?.textContent?.trim().replace(/\s+/g, " ") || "";
        if (title) name = title;
      }
      if (!name) name = `Partie ${last}`;
      return { id: last, name: name.replace(/\s+/g, " ").slice(0, 200), href: location.pathname + location.search };
    }
    if (reservedSegments.has(parts[0])) return null;
    let id = null;
    if (gameIdPattern.test(parts[0])) id = parts[0];
    else if (fullIdPattern.test(parts[0])) id = parts[0].slice(0, 8);
    if (!id) return null;
    if (parts.length > 1 && !/^([wb]|white|black)$/i.test(parts[1])) return null;
    if (!document.querySelector(".round__app") && !document.querySelector(".game__meta")) return null;
    const players = [...document.querySelectorAll(".game__meta__players .player")];
    let name = "";
    if (players.length >= 2) {
      name = `${playerName(players[0])} vs ${playerName(players[1])}`;
    } else if (players.length === 1) {
      name = playerName(players[0]);
    }
    if (!name) {
      const pageData = document.querySelector("#page-init-data")?.textContent;
      if (pageData) {
        try {
          const data = JSON.parse(pageData)?.data || {};
          const white = data.white?.user?.username || data.game?.white?.user?.username || "";
          const black = data.black?.user?.username || data.game?.black?.user?.username || "";
          if (white || black) name = `${white || "Weiß"} vs ${black || "Schwarz"}`;
        } catch {
          name = "";
        }
      }
    }
    if (!name) name = `Partie ${id}`;
    return { id, name: name.replace(/\s+/g, " ").slice(0, 200), href: location.pathname + location.search };
  }

  function gameFromElement(anchor) {
    const href = gameHrefFromElement(anchor);
    if (!href) return null;
    const id = gameIdFromHref(href);
    if (!id) return null;
    const name = gameNameFromListElement(anchor, id);
    if (!name || name === "Studie") return null;
    return { id, name: name.replace(/\s+/g, " ").slice(0, 200), href };
  }

  function makeStarButton(game) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lfs-favorite-star lfs-game-favorite-star";
    button.dataset.lfsGameFavoriteStar = game.id;
    button.dataset.lfsGameFavoriteName = game.name;
    button.dataset.lfsGameFavoriteHref = game.href;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite({
        id: button.dataset.lfsGameFavoriteStar,
        name: button.dataset.lfsGameFavoriteName,
        href: button.dataset.lfsGameFavoriteHref,
      });
    });
    return button;
  }

  function paintStar(button, active, name) {
    const activeNow = Boolean(active);
    button.setAttribute("aria-pressed", String(activeNow));
    button.classList.toggle("is-active", activeNow);
    if (button.dataset.state !== (activeNow ? "active" : "inactive")) {
      button.dataset.state = activeNow ? "active" : "inactive";
      button.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.77l-5.9 3.1 1.13-6.58-4.78-4.66 6.6-.96z" fill="${activeNow ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path></svg>`;
    }
    const label = activeNow ? `${name} aus Favoriten-Partien entfernen` : `${name} zu Favoriten-Partien hinzufügen`;
    if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    const tip = activeNow ? "Aus Favoriten-Partien entfernen" : "Zu Favoriten-Partien hinzufügen";
    if (button.title !== tip) button.title = tip;
  }

  function renderListStars() {
    if (renderingStars) return;
    document.querySelectorAll(".study__multiboard [data-lfs-game-favorite-star]")
      .forEach((star) => star.remove());
    const anchors = [...document.querySelectorAll(".now-playing a[href], a.relay-game[href]")]
      .filter((anchor) => !anchor.closest(".study__multiboard"));
    if (!anchors.length) return;
    renderingStars = true;
    try {
      const map = favoriteMap();
      for (const anchor of anchors) {
        const game = gameFromElement(anchor);
        if (!game) continue;
        const meta = anchor.querySelector(".meta") || anchor.querySelector(".relay-game__players");
        if (!meta) continue;
        let star = anchor.querySelector("[data-lfs-game-favorite-star]");
        if (!star || star.previousElementSibling !== meta) {
          star?.remove();
          star = makeStarButton(game);
          meta.after(star);
        } else {
          star.dataset.lfsGameFavoriteName = game.name;
          star.dataset.lfsGameFavoriteHref = game.href;
        }
        paintStar(star, map.has(game.id), game.name);
      }
    } finally {
      renderingStars = false;
    }
  }

  function renderDetailStar() {
    if (renderingStars) return;
    const game = detailGame();
    if (!game) return;
    const setup = document.querySelector(".game__meta__infos .setup");
    if (setup) {
      renderingStars = true;
      try {
        let star = setup.querySelector("[data-lfs-game-favorite-star]");
        const bookmark = setup.querySelector(".bookmark");
        if (!star || (bookmark && star.previousElementSibling !== bookmark) || (!bookmark && star !== setup.lastElementChild)) {
          star?.remove();
          star = makeStarButton(game);
          if (bookmark) bookmark.after(star);
          else setup.append(star);
        } else {
          star.dataset.lfsGameFavoriteName = game.name;
          star.dataset.lfsGameFavoriteHref = game.href;
        }
        paintStar(star, favoriteMap().has(game.id), game.name);
      } finally {
        renderingStars = false;
      }
      return;
    }
    const title = document.querySelector(".relay-tour__header h1");
    const headerContent = title?.parentElement;
    if (!title || !headerContent) return;
    renderingStars = true;
    try {
      let star = headerContent.querySelector("[data-lfs-game-favorite-star]");
      if (!star || star.previousElementSibling !== title) {
        star?.remove();
        star = makeStarButton(game);
        title.after(star);
      } else {
        star.dataset.lfsGameFavoriteName = game.name;
        star.dataset.lfsGameFavoriteHref = game.href;
      }
      paintStar(star, favoriteMap().has(game.id), game.name);
    } finally {
      renderingStars = false;
    }
  }

  function positionDragGhost(x, y) {
    if (!dragGhost) return;
    dragGhost.style.left = `${Math.round(x - dragOffset.x)}px`;
    dragGhost.style.top = `${Math.round(y - dragOffset.y)}px`;
  }

  function commitDropAtPlaceholder() {
    if (!draggedId || !dragPlaceholder || !favoritesPanel) return;
    const list = favoritesPanel.querySelector(".lfs-game-favorites-list");
    if (!list) return;
    const moving = favorites.find((item) => item.id === draggedId);
    if (!moving) return;
    const rest = favorites.filter((item) => item.id !== draggedId);
    let targetIndex = 0;
    for (const node of list.children) {
      if (node === dragPlaceholder) break;
      if (node.dataset?.lfsGameFavoriteId && node.dataset.lfsGameFavoriteId !== draggedId) targetIndex++;
    }
    targetIndex = Math.max(0, Math.min(rest.length, targetIndex));
    rest.splice(targetIndex, 0, moving);
    saveFavorites({ items: rest });
  }

  function clearDragState(commit) {
    if (commit) commitDropAtPlaceholder();
    if (placeholderRaf) { cancelAnimationFrame(placeholderRaf); placeholderRaf = 0; }
    latestPointer = null;
    dragGhost?.remove();
    dragGhost = null;
    dragPlaceholder?.remove();
    dragPlaceholder = null;
    if (dragSource) {
      dragSource.classList.remove("is-dragging", "is-drag-source");
      dragSource = null;
    }
    favoritesPanel?.querySelector(".lfs-game-favorites-list")?.classList.remove("is-dragging");
    draggedId = null;
  }

  function updatePlaceholderPosition(clientY) {
    if (!dragPlaceholder || !favoritesPanel) return;
    const list = favoritesPanel.querySelector(".lfs-game-favorites-list");
    if (!list) return;
    const rows = [...list.querySelectorAll(".lfs-game-favorite-item")]
      .filter((row) => row.dataset.lfsGameFavoriteId !== draggedId);
    let target = null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) { target = row; break; }
    }
    const already = target
      ? dragPlaceholder.nextElementSibling === target
      : dragPlaceholder === list.lastElementChild;
    if (!already) list.insertBefore(dragPlaceholder, target);
  }

  function isTextTruncated(element) {
    if (!element) return false;
    return element.scrollHeight > element.clientHeight + 1
      || element.scrollWidth > element.clientWidth + 1;
  }

  function showTooltipIfTruncated(anchor, truncatedElement, text) {
    if (isTextTruncated(truncatedElement)) showTooltip(anchor, text);
    else hideTooltip();
  }

  function makeFavoriteRow(game) {
    const row = document.createElement("li");
    row.className = "lfs-game-favorite-item";
    row.dataset.lfsGameFavoriteId = game.id;

    const link = document.createElement("span");
    link.className = "lfs-game-favorite-link";
    link.dataset.lfsGameFavoriteHref = game.href;
    link.textContent = game.name;
    link.setAttribute("role", "link");
    link.setAttribute("tabindex", "0");
    const openGame = () => {
      if (suppressNextClick) return;
      location.assign(game.href);
    };
    link.addEventListener("click", openGame);
    link.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGame();
      }
    });
    link.addEventListener("focus", () => showTooltipIfTruncated(link, link, game.name));
    link.addEventListener("blur", hideTooltip);
    link.addEventListener("mouseenter", () => showTooltipIfTruncated(link, link, game.name));

    row.append(link);
    row.addEventListener("click", (event) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
      }
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, game);
    });
    row.addEventListener("mouseleave", hideTooltip);
    row.addEventListener("blur", hideTooltip);
    row.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.ctrlKey || event.metaKey) return;
      const startX = event.clientX;
      const onMove = (moveEvent) => {
        if (!draggedId && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - event.clientY) < 4) return;
        if (!draggedId) {
          draggedId = game.id;
          dragSource = row;
          suppressNextClick = true;
          hideTooltip();
          closeContextMenu();
          const list = favoritesPanel?.querySelector(".lfs-game-favorites-list");
          const rect = row.getBoundingClientRect();
          dragOffset = { x: moveEvent.clientX - rect.left, y: moveEvent.clientY - rect.top };
          if (list) {
            list.classList.add("is-dragging");
            dragPlaceholder = document.createElement("li");
            dragPlaceholder.className = "lfs-drag-placeholder lfs-game-favorite-placeholder";
            dragPlaceholder.setAttribute("aria-hidden", "true");
            list.insertBefore(dragPlaceholder, row);
          }
          row.classList.add("is-dragging", "is-drag-source");
          dragGhost = document.createElement("div");
          dragGhost.className = "lfs-drag-ghost lfs-game-favorite-ghost";
          dragGhost.textContent = game.name;
          document.body.append(dragGhost);
          dragGhost.style.width = `${rect.width}px`;
          positionDragGhost(moveEvent.clientX, moveEvent.clientY);
          row.setPointerCapture?.(moveEvent.pointerId);
        }
        positionDragGhost(moveEvent.clientX, moveEvent.clientY);
        latestPointer = { x: moveEvent.clientX, y: moveEvent.clientY };
        if (!placeholderRaf) {
          placeholderRaf = requestAnimationFrame(() => {
            placeholderRaf = 0;
            if (latestPointer) updatePlaceholderPosition(latestPointer.y);
          });
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (draggedId) {
          suppressNextClick = true;
          clearDragState(true);
          setTimeout(() => { suppressNextClick = false; }, 50);
        }
      };
      const onCancel = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (draggedId) {
          suppressNextClick = true;
          clearDragState(false);
          setTimeout(() => { suppressNextClick = false; }, 50);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
    return row;
  }

  function showTooltip(anchor, text) {
    if (!text) return;
    ensureTooltip();
    if (!tooltip) return;
    tooltip.textContent = text;
    tooltip.hidden = false;
    const rect = anchor.getBoundingClientRect();
    tooltip.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    tooltip.style.top = `${Math.round(rect.top)}px`;
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.hidden = true;
      tooltip.textContent = "";
    }
  }

  function ensureTooltip() {
    if (tooltip || document.getElementById(tooltipId)) {
      tooltip = document.getElementById(tooltipId);
      return;
    }
    tooltip = document.createElement("div");
    tooltip.id = tooltipId;
    tooltip.className = "lfs-favorites-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.append(tooltip);
  }

  function ensureContextMenu() {
    if (contextMenu || document.getElementById(contextMenuId)) {
      contextMenu = document.getElementById(contextMenuId);
      return;
    }
    contextMenu = document.createElement("div");
    contextMenu.id = contextMenuId;
    contextMenu.className = "lfs-favorites-context-menu";
    contextMenu.setAttribute("role", "menu");
    contextMenu.hidden = true;
    document.body.append(contextMenu);
  }

  function openContextMenu(x, y, game) {
    ensureContextMenu();
    if (!contextMenu) return;
    hideTooltip();
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "lfs-favorites-context-item";
    remove.setAttribute("role", "menuitem");
    remove.textContent = "Aus Liste entfernen";
    remove.addEventListener("click", () => {
      closeContextMenu();
      removeFavorite(game.id);
    });
    contextMenu.replaceChildren(remove);
    contextMenu.dataset.lfsGameFavoriteId = game.id;
    contextMenu.hidden = false;
    const margin = 8;
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.min(x, window.innerWidth - rect.width - margin)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - rect.height - margin)}px`;
    remove.focus();
  }

  function closeContextMenu() {
    if (contextMenu) {
      contextMenu.hidden = true;
      contextMenu.replaceChildren();
      contextMenu.removeAttribute("data-lfs-game-favorite-id");
    }
  }

  function restoreHomePanel() {
    favoritesPanel?.remove();
    favoritesPanel = null;
    favoritesSide?.querySelectorAll(`#${CSS.escape(favoritePanelId)}`).forEach((element) => element.remove());
    favoritesSide = null;
  }

  function syncHomePanel() {
    if (!isHomePage()) {
      restoreHomePanel();
      return;
    }
    const lobby = document.querySelector("main.lobby");
    const side = lobby?.querySelector(".lobby__side") ?? document.querySelector(".lobby__side");
    if (!side) return;
    favoritesSide = side;
    const studyPanel = document.getElementById(studyPanelId);
    const puzzlePanel = document.getElementById(puzzlePanelId);
    const playlistPanel = document.getElementById(playlistPanelId);
    if (!favoritesPanel) {
      favoritesPanel = document.createElement("section");
      favoritesPanel.id = favoritePanelId;
      favoritesPanel.className = "lfs-favorites-card lfs-game-favorites-card";
      favoritesPanel.setAttribute("aria-label", "Favoriten Partien");
    }
    if (favoritesPanel.hasAttribute("data-lfs-playlist-hidden")) {
      favoritesPanel.removeAttribute("data-lfs-playlist-hidden");
    }
    if (studyPanel && studyPanel.parentElement === side) {
      if (favoritesPanel.previousElementSibling !== studyPanel) studyPanel.after(favoritesPanel);
    } else if (puzzlePanel && puzzlePanel.parentElement === side) {
      if (favoritesPanel.previousElementSibling !== puzzlePanel) puzzlePanel.after(favoritesPanel);
    } else if (playlistPanel && playlistPanel.parentElement === side) {
      if (favoritesPanel.previousElementSibling !== playlistPanel) playlistPanel.after(favoritesPanel);
    } else if (favoritesPanel.parentElement !== side) {
      side.append(favoritesPanel);
    }
    renderHomePanel();
  }

  function renderHomePanel() {
    if (!favoritesPanel) return;
    if (favoritesPanel.hasAttribute("data-lfs-playlist-hidden")) {
      favoritesPanel.removeAttribute("data-lfs-playlist-hidden");
    }
    if (!favorites.length) {
      if (favoritesPanel.dataset.empty === "true" && favoritesPanel.querySelector(".lfs-favorites-hint")) return;
      favoritesPanel.dataset.empty = "true";
      favoritesPanel.replaceChildren();
      const hint = document.createElement("p");
      hint.className = "lfs-favorites-hint";
      hint.textContent = "Noch keine Favoriten – offene Partien mit dem Stern markieren.";
      favoritesPanel.append(hint);
      delete favoritesPanel.dataset.viewKey;
      return;
    }
    delete favoritesPanel.dataset.empty;
    const viewKey = favorites.map((item) => item.id).join(",");
    if (favoritesPanel.dataset.viewKey === viewKey) return;
    if (draggedId) return;
    favoritesPanel.dataset.viewKey = viewKey;
    const list = document.createElement("ol");
    list.className = "lfs-game-favorites-list";
    list.setAttribute("aria-label", "Favoriten Partien");
    favorites.forEach((game) => list.append(makeFavoriteRow(game)));
    favoritesPanel.replaceChildren(list);
  }

  function teardown() {
    clearDragState(false);
    restoreHomePanel();
    closeContextMenu();
    contextMenu?.remove();
    contextMenu = null;
    tooltip?.remove();
    tooltip = null;
    document.querySelectorAll("[data-lfs-game-favorite-star]").forEach((star) => star.remove());
  }

  function render() {
    if (!pluginEnabled) {
      teardown();
      return;
    }
    syncHomePanel();
    renderListStars();
    renderDetailStar();
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }

  function bindGlobalHandlers() {
    document.addEventListener("click", (event) => {
      if (contextMenu && !contextMenu.contains(event.target)) closeContextMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeContextMenu();
        hideTooltip();
      }
    });
    document.addEventListener("scroll", () => {
      hideTooltip();
      if (contextMenu && !contextMenu.hidden) closeContextMenu();
    }, true);
    document.addEventListener("contextmenu", (event) => {
      const row = event.target?.closest?.("[data-lfs-game-favorite-id]");
      if (row) event.preventDefault();
    });
  }

  chrome.storage.local.get([storageKey, "enabled"], (stored) => {
    pluginEnabled = stored?.enabled !== false;
    favorites = normalizeFavorites(stored?.[storageKey]);
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (Object.hasOwn(changes, "enabled")) {
      pluginEnabled = changes.enabled.newValue !== false;
      render();
    }
    if (!Object.hasOwn(changes, storageKey)) return;
    favorites = normalizeFavorites(changes[storageKey].newValue);
    render();
  });

  const gameFavoriteMutationSelector = ".now-playing, a.relay-game, .game__meta, .relay-tour__header, .lobby__side";
  new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (target?.closest("cg-board, .mini-game__clock")) return false;
      if (target?.closest(gameFavoriteMutationSelector)) return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE
        && (node.matches(gameFavoriteMutationSelector)
          || node.querySelector(gameFavoriteMutationSelector)));
    });
    if (relevant) scheduleRender();
  }).observe(document, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("resize", scheduleRender);

  bindGlobalHandlers();
  render();
})();
