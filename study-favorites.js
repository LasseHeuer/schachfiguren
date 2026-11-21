(() => {
  const storageKey = "lfsStudyFavorites";
  const favoritePanelId = "lfs-study-favorites-panel";
  const puzzleFavoritePanelId = "lfs-puzzle-favorites-panel";
  const playlistPanelId = "lfs-puzzle-playlist-home";
  const contextMenuId = "lfs-study-favorites-context-menu";
  const tooltipId = "lfs-study-favorites-tooltip";
  const reservedSegments = new Set([
    "all", "search", "topics", "topical", "by", "mine", "mineMember", "minePublic",
    "minePrivate", "mineLikes", "staffPicks", "pick", "new", "create", "embed", "edit",
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
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{6,16}$/.test(id) || seen.has(id)) continue;
      const name = String(entry?.name || "").trim();
      const href = String(entry?.href || `/study/${id}`).trim() || `/study/${id}`;
      if (!name) continue;
      if (studyIdFromHref(href) !== id) continue;
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

  function toggleFavorite(study) {
    const map = favoriteMap();
    if (map.has(study.id)) map.delete(study.id);
    else map.set(study.id, study);
    saveFavorites({ items: [...map.values()] });
  }

  function removeFavorite(id) {
    saveFavorites({ items: favorites.filter((item) => item.id !== id) });
  }

  function studyIdFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "study" || !parts[1]) return null;
      const id = parts[1];
      if (reservedSegments.has(id)) return null;
      return /^[a-zA-Z0-9_-]{6,16}$/.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  function detailStudy() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] !== "study" || !parts[1]) return null;
    if (reservedSegments.has(parts[1])) return null;
    const id = parts[1];
    if (!/^[a-zA-Z0-9_-]{6,16}$/.test(id)) return null;
    let name = "";
    const pageData = document.querySelector("#page-init-data")?.textContent;
    if (pageData) {
      try {
        name = String(JSON.parse(pageData)?.study?.name || "").trim();
      } catch {
        name = "";
      }
    }
    if (!name) {
      name = document.querySelector(".study__metadata h2 .name")?.textContent?.trim() || "";
    }
    if (!name) return null;
    return { id, name: name.replace(/\s+/g, " "), href: `/study/${id}` };
  }

  function studyFromElement(element) {
    const overlay = element.querySelector("a.overlay[href]");
    const href = overlay?.getAttribute("href")
      || (element.matches("a[href]") ? element.getAttribute("href") : null);
    if (!href) return null;
    const id = studyIdFromHref(href);
    if (!id) return null;
    const nameEl = element.querySelector(".study-name")
      || [...element.querySelectorAll("span")].at(-1);
    const name = nameEl?.textContent?.trim().replace(/\s+/g, " ") || "";
    if (!name || name === "Studie") return null;
    const url = new URL(href, location.origin);
    return { id, name, href: url.pathname + url.search };
  }

  function makeStarButton(study) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lfs-favorite-star lfs-study-favorite-star";
    button.dataset.lfsStudyFavoriteStar = study.id;
    button.dataset.lfsStudyFavoriteName = study.name;
    button.dataset.lfsStudyFavoriteHref = study.href;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite({
        id: button.dataset.lfsStudyFavoriteStar,
        name: button.dataset.lfsStudyFavoriteName,
        href: button.dataset.lfsStudyFavoriteHref,
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
    const label = activeNow ? `${name} aus Favoriten-Studien entfernen` : `${name} zu Favoriten-Studien hinzufügen`;
    if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    const tip = activeNow ? "Aus Favoriten-Studien entfernen" : "Zu Favoriten-Studien hinzufügen";
    if (button.title !== tip) button.title = tip;
  }

  function renderListStars() {
    if (renderingStars) return;
    const elements = [...document.querySelectorAll(".study")];
    if (!elements.length) return;
    renderingStars = true;
    try {
      const map = favoriteMap();
      for (const element of elements) {
        const study = studyFromElement(element);
        if (!study) continue;
        const nameEl = element.querySelector(".study-name")
          || [...element.querySelectorAll("span")].at(-1);
        if (!nameEl) continue;
        let star = element.querySelector("[data-lfs-study-favorite-star]");
        if (!star || star.previousElementSibling !== nameEl) {
          star?.remove();
          star = makeStarButton(study);
          nameEl.after(star);
        } else {
          star.dataset.lfsStudyFavoriteName = study.name;
          star.dataset.lfsStudyFavoriteHref = study.href;
        }
        paintStar(star, map.has(study.id), study.name);
      }
    } finally {
      renderingStars = false;
    }
  }

  function renderDetailStar() {
    if (renderingStars) return;
    const study = detailStudy();
    if (!study) return;
    const metadata = document.querySelector(".study__metadata h2");
    if (!metadata) return;
    renderingStars = true;
    try {
      let star = metadata.querySelector("[data-lfs-study-favorite-star]");
      if (!star || star.parentElement !== metadata) {
        star?.remove();
        star = makeStarButton(study);
        const liking = metadata.querySelector(".liking");
        if (liking) liking.before(star);
        else metadata.append(star);
      } else {
        star.dataset.lfsStudyFavoriteName = study.name;
        star.dataset.lfsStudyFavoriteHref = study.href;
      }
      paintStar(star, favoriteMap().has(study.id), study.name);
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
    const list = favoritesPanel.querySelector(".lfs-study-favorites-list");
    if (!list) return;
    const moving = favorites.find((item) => item.id === draggedId);
    if (!moving) return;
    const rest = favorites.filter((item) => item.id !== draggedId);
    let targetIndex = 0;
    for (const node of list.children) {
      if (node === dragPlaceholder) break;
      if (node.dataset?.lfsStudyFavoriteId && node.dataset.lfsStudyFavoriteId !== draggedId) targetIndex++;
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
    favoritesPanel?.querySelector(".lfs-study-favorites-list")?.classList.remove("is-dragging");
    draggedId = null;
  }

  function updatePlaceholderPosition(clientY) {
    if (!dragPlaceholder || !favoritesPanel) return;
    const list = favoritesPanel.querySelector(".lfs-study-favorites-list");
    if (!list) return;
    const rows = [...list.querySelectorAll(".lfs-study-favorite-item")]
      .filter((row) => row.dataset.lfsStudyFavoriteId !== draggedId);
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

  function makeFavoriteRow(study) {
    const row = document.createElement("li");
    row.className = "lfs-study-favorite-item";
    row.dataset.lfsStudyFavoriteId = study.id;

    const link = document.createElement("span");
    link.className = "lfs-study-favorite-link";
    link.dataset.lfsStudyFavoriteHref = study.href;
    link.textContent = study.name;
    link.setAttribute("role", "link");
    link.setAttribute("tabindex", "0");
    const openStudy = () => {
      if (suppressNextClick) return;
      location.assign(study.href);
    };
    link.addEventListener("click", openStudy);
    link.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openStudy();
      }
    });
    link.addEventListener("focus", () => showTooltipIfTruncated(link, link, study.name));
    link.addEventListener("blur", hideTooltip);
    link.addEventListener("mouseenter", () => showTooltipIfTruncated(link, link, study.name));

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
      openContextMenu(event.clientX, event.clientY, study);
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
          draggedId = study.id;
          dragSource = row;
          suppressNextClick = true;
          hideTooltip();
          closeContextMenu();
          const list = favoritesPanel?.querySelector(".lfs-study-favorites-list");
          const rect = row.getBoundingClientRect();
          dragOffset = { x: moveEvent.clientX - rect.left, y: moveEvent.clientY - rect.top };
          if (list) {
            list.classList.add("is-dragging");
            dragPlaceholder = document.createElement("li");
            dragPlaceholder.className = "lfs-drag-placeholder lfs-study-favorite-placeholder";
            dragPlaceholder.setAttribute("aria-hidden", "true");
            list.insertBefore(dragPlaceholder, row);
          }
          row.classList.add("is-dragging", "is-drag-source");
          dragGhost = document.createElement("div");
          dragGhost.className = "lfs-drag-ghost lfs-study-favorite-ghost";
          dragGhost.textContent = study.name;
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

  function openContextMenu(x, y, study) {
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
      removeFavorite(study.id);
    });
    contextMenu.replaceChildren(remove);
    contextMenu.dataset.lfsStudyFavoriteId = study.id;
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
      contextMenu.removeAttribute("data-lfs-study-favorite-id");
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
    const puzzlePanel = document.getElementById(puzzleFavoritePanelId);
    const playlistPanel = document.getElementById(playlistPanelId);
    if (!favoritesPanel) {
      favoritesPanel = document.createElement("section");
      favoritesPanel.id = favoritePanelId;
      favoritesPanel.className = "lfs-favorites-card lfs-study-favorites-card";
      favoritesPanel.setAttribute("aria-label", "Favoriten Studien");
    }
    if (favoritesPanel.hasAttribute("data-lfs-playlist-hidden")) {
      favoritesPanel.removeAttribute("data-lfs-playlist-hidden");
    }
    if (puzzlePanel && puzzlePanel.parentElement === side) {
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
      hint.textContent = "Noch keine Favoriten – in den Studienlisten mit dem Stern markieren.";
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
    list.className = "lfs-study-favorites-list";
    list.setAttribute("aria-label", "Favoriten Studien");
    favorites.forEach((study) => list.append(makeFavoriteRow(study)));
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
    document.querySelectorAll("[data-lfs-study-favorite-star]").forEach((star) => star.remove());
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
      const row = event.target?.closest?.("[data-lfs-study-favorite-id]");
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

  new MutationObserver(records => {
    const atHome = isHomePage();
    const onStudyPage = location.pathname.startsWith("/study");
    if (!atHome && !onStudyPage) return;
    const selector = atHome ? "main.lobby, .lobby__side" : ".study, .study__metadata";
    const relevant = records.some(record => {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (atHome ? target?.matches(selector) : target?.closest(selector)) return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE
        && (node.matches(selector) || node.querySelector(selector)));
    });
    if (relevant) scheduleRender();
  }).observe(document, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("resize", scheduleRender);

  bindGlobalHandlers();
  render();
})();
