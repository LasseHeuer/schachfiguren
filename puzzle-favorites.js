(() => {
  const storageKey = "lfsPuzzleFavorites";
  const favoritePanelId = "lfs-puzzle-favorites-panel";
  const playlistPanelId = "lfs-puzzle-playlist-home";
  const contextMenuId = "lfs-favorites-context-menu";
  const tooltipId = "lfs-favorites-tooltip";

  let favorites = [];
  let favoritesPanel = null;
  let favoritesSide = null;
  let contextMenu = null;
  let tooltip = null;
  let scheduled = false;
  let renderingThemes = false;
  let draggedId = null;
  let dragPlaceholder = null;
  let dragSource = null;
  let dragGhost = null;
  let dragOffset = { x: 0, y: 0 };
  let dragCleanup = null;
  let placeholderRaf = 0;
  let latestPointer = null;
  let lastDragPointer = null;
  let suppressNextClick = false;

  function isThemesPage() {
    return /\/training\/themes\/?$/.test(location.pathname);
  }

  function isHomePage() {
    return location.pathname === "/";
  }

  function normalizeFavorites(value) {
    const items = [];
    const seen = new Set();
    const list = Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
    for (const entry of list) {
      const id = typeof entry === "string" ? entry : entry?.id;
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{2,}$/.test(id) || seen.has(id)) continue;
      const name = String(entry?.name || "").trim();
      const icon = String(entry?.icon || "").trim();
      const href = String(entry?.href || `/training/${id}`).trim() || `/training/${id}`;
      if (!name && !icon) continue;
      seen.add(id);
      items.push({ id, name, icon, href });
    }
    return items;
  }

  function favoriteMap() {
    return new Map(favorites.map((item) => [item.id, item]));
  }

  function saveFavorites(next, onSaved) {
    favorites = normalizeFavorites(next);
    chrome.storage.local.set({ [storageKey]: { items: favorites } }, () => onSaved?.());
    render();
  }

  function toggleFavorite(category) {
    const map = favoriteMap();
    if (map.has(category.id)) map.delete(category.id);
    else map.set(category.id, category);
    saveFavorites({ items: [...map.values()] });
  }

  function deactivateFavorite(id) {
    saveFavorites({ items: favorites.filter((item) => item.id !== id) });
  }

  function reorderFavorites(fromId, targetId, position) {
    if (!fromId || !targetId || fromId === targetId) return;
    const moving = favorites.find((item) => item.id === fromId);
    if (!moving) return;
    const rest = favorites.filter((item) => item.id !== fromId);
    let toIndex = rest.findIndex((item) => item.id === targetId);
    if (toIndex < 0) toIndex = rest.length;
    else if (position === "after") toIndex++;
    rest.splice(toIndex, 0, moving);
    saveFavorites({ items: rest });
  }

  function commitDropAtPlaceholder() {
    if (!draggedId || !dragPlaceholder || !favoritesPanel) return;
    const matrix = favoritesPanel.querySelector(".lfs-favorites-matrix");
    if (!matrix) return;
    const moving = favorites.find((item) => item.id === draggedId);
    if (!moving) return;
    const rest = favorites.filter((item) => item.id !== draggedId);
    let targetIndex = 0;
    for (const node of matrix.children) {
      if (node === dragPlaceholder) break;
      if (node.dataset?.lfsFavoriteIcon && node.dataset.lfsFavoriteIcon !== draggedId) targetIndex++;
    }
    targetIndex = Math.max(0, Math.min(rest.length, targetIndex));
    rest.splice(targetIndex, 0, moving);
    saveFavorites({ items: rest });
  }

  function clearDragState(commit) {
    if (commit) commitDropAtPlaceholder();
    if (placeholderRaf) { cancelAnimationFrame(placeholderRaf); placeholderRaf = 0; }
    latestPointer = null;
    lastDragPointer = null;
    dragCleanup?.();
    dragCleanup = null;
    dragGhost?.remove();
    dragGhost = null;
    dragPlaceholder?.remove();
    dragPlaceholder = null;
    if (dragSource) {
      dragSource.classList.remove("is-dragging", "is-drag-source");
      dragSource = null;
    }
    favoritesPanel?.querySelector(".lfs-favorites-matrix")?.classList.remove("is-dragging");
    draggedId = null;
  }

  function updatePlaceholderPosition(clientX, clientY) {
    if (!dragPlaceholder || !favoritesPanel) return;
    const matrix = favoritesPanel.querySelector(".lfs-favorites-matrix");
    if (!matrix) return;
    const visible = [...matrix.querySelectorAll(".lfs-favorite-icon-button")]
      .filter((btn) => btn.dataset.lfsFavoriteIcon !== draggedId);
    // Layout-Position ohne Transform messen (offset), damit die FLIP-Animation nicht flackert.
    const matrixRect = matrix.getBoundingClientRect();
    const layoutLeft = (btn) => matrixRect.left + btn.offsetLeft - matrix.offsetLeft;
    const layoutTop = (btn) => matrixRect.top + btn.offsetTop - matrix.offsetTop;
    // Richtungs-Bias: Center frueher in Bewegungsrichtung, symmetrisch in alle Richtungen
    // (Mitte - Vorzeichen der Bewegung * 10px). Das ersetzt reine Hover-/Kantenlogik,
    // die eine Richtung hinterherhinkte oder eine Leerplatz-Totzone hatte.
    const stepX = (clientX - (lastDragPointer?.x ?? clientX)) || 0;
    const stepY = (clientY - (lastDragPointer?.y ?? clientY)) || 0;
    lastDragPointer = { x: clientX, y: clientY };
    const biasX = stepX > 1 ? 10 : stepX < -1 ? -10 : 0;
    const biasY = stepY > 1 ? 10 : stepY < -1 ? -10 : 0;
    // Zeilen nach Top gruppieren (DOM-Reihenfolge = Leserichtung).
    const rows = [];
    visible.forEach((btn) => {
      const top = layoutTop(btn);
      let row = rows.find((candidate) => Math.abs(candidate.top - top) < 4);
      if (!row) { row = { top, items: [] }; rows.push(row); }
      row.items.push(btn);
    });
    rows.sort((a, b) => a.top - b.top);
    rows.forEach((row) => row.items.sort((a, b) => layoutLeft(a) - layoutLeft(b)));
    let target = null;
    if (rows.length) {
      const mouseRow = rows.find((row) => {
        const centerY = row.top + (row.items[0].offsetHeight / 2);
        return clientY < centerY - biasY;
      }) || null;
      if (!mouseRow) {
        target = null; // unterhalb aller Zeilen: ans Ende
      } else {
        target = mouseRow.items.find((btn) => {
          const centerX = layoutLeft(btn) + btn.offsetWidth / 2;
          return clientX < centerX - biasX;
        }) || null;
        if (!target) {
          const index = rows.indexOf(mouseRow);
          target = rows[index + 1]?.items[0] || null; // Ende der Zeile = Anfang der naechsten
        }
      }
    }
    const already = target
      ? dragPlaceholder.nextElementSibling === target
      : dragPlaceholder === matrix.lastElementChild;
    if (already) return;
    // FLIP: alte Positionen notieren, dann Platz einsparen -> Icons gleiten weich zur Seite.
    const first = new Map(visible.map((btn) => [btn.dataset.lfsFavoriteIcon, { left: layoutLeft(btn), top: layoutTop(btn) }]));
    matrix.insertBefore(dragPlaceholder, target);
    visible.forEach((btn) => {
      const from = first.get(btn.dataset.lfsFavoriteIcon);
      if (!from) return;
      const to = { left: layoutLeft(btn), top: layoutTop(btn) };
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (!dx && !dy) return;
      btn.style.transition = "none";
      btn.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        btn.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
        btn.style.transform = "";
        setTimeout(() => { btn.style.transition = ""; }, 200);
      });
    });
  }

  function themeIdFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      const trainingIndex = parts.lastIndexOf("training");
      const theme = trainingIndex >= 0 ? parts.slice(trainingIndex + 1, trainingIndex + 2)[0] : parts.at(-1);
      if (!theme || theme === "themes" || !/^[a-zA-Z0-9_-]{2,}$/.test(theme)) return null;
      return theme;
    } catch {
      return null;
    }
  }

  function themeNameFromLink(link) {
    const heading = link?.querySelector("h3");
    if (!heading) return String(link?.textContent || "").trim();
    const clone = heading.cloneNode(true);
    clone.querySelectorAll("em").forEach((em) => em.remove());
    return String(clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function makeStarButton(category) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lfs-favorite-star";
    button.dataset.lfsFavoriteStar = category.id;
    button.dataset.lfsFavoriteIcon = category.icon;
    button.dataset.lfsFavoriteHref = category.href;
    button.dataset.lfsFavoriteName = category.name;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = {
        id: button.dataset.lfsFavoriteStar,
        name: button.dataset.lfsFavoriteName,
        icon: button.dataset.lfsFavoriteIcon,
        href: button.dataset.lfsFavoriteHref,
      };
      toggleFavorite(current);
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
    const label = activeNow ? `${name} als Favorit entfernen` : `${name} als Favorit markieren`;
    if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    const tip = activeNow ? "Favorit entfernen" : "Als Favorit markieren";
    if (button.title !== tip) button.title = tip;
  }

  function renderThemesStars() {
    if (!isThemesPage() || renderingThemes) return;
    const links = [...document.querySelectorAll(".puzzle-themes__link[href]")];
    if (!links.length) return;
    renderingThemes = true;
    try {
      const map = favoriteMap();
      links.forEach((link) => {
        const id = themeIdFromHref(link.getAttribute("href") || link.href || "");
        if (!id) return;
        const name = themeNameFromLink(link);
        const image = link.querySelector("img");
        const icon = image?.currentSrc || image?.src || "";
        const category = { id, name, icon, href: link.getAttribute("href") || link.href };
        const heading = link.querySelector("h3");
        if (!heading) return;
        let star = heading.querySelector("[data-lfs-favorite-star]");
        if (!star) {
          star = makeStarButton(category);
          heading.append(star);
        } else {
          if (star.dataset.lfsFavoriteName !== name) star.dataset.lfsFavoriteName = name;
          if (star.dataset.lfsFavoriteIcon !== icon) star.dataset.lfsFavoriteIcon = icon;
          if (star.dataset.lfsFavoriteHref !== category.href) star.dataset.lfsFavoriteHref = category.href;
        }
        paintStar(star, map.has(id), name);
      });
    } finally {
      renderingThemes = false;
    }
  }

  function makeFavoriteIcon(category) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lfs-favorite-icon-button";
    button.dataset.lfsFavoriteIcon = category.id;
    button.dataset.lfsFavoriteHref = category.href;
    button.dataset.lfsFavoriteName = category.name;
    button.setAttribute("aria-label", category.name);
    if (category.icon) {
      const image = document.createElement("img");
      image.src = category.icon;
      image.alt = "";
      image.loading = "lazy";
      image.draggable = false;
      button.append(image);
    } else {
      button.textContent = category.name?.slice(0, 1) || "?";
    }
    button.addEventListener("click", () => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      location.assign(category.href);
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, category);
    });
    button.addEventListener("mouseenter", () => showTooltip(button, category.name));
    button.addEventListener("focus", () => showTooltip(button, category.name));
    button.addEventListener("mouseleave", hideTooltip);
    button.addEventListener("blur", hideTooltip);
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.ctrlKey || event.metaKey) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const onMove = (moveEvent) => {
        if (!draggedId && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
        if (!draggedId) {
          draggedId = category.id;
          dragSource = button;
          suppressNextClick = true;
          hideTooltip();
          closeContextMenu();
          const matrix = favoritesPanel?.querySelector(".lfs-favorites-matrix");
          const rect = button.getBoundingClientRect();
          dragOffset = { x: moveEvent.clientX - rect.left, y: moveEvent.clientY - rect.top };
          if (matrix) {
            matrix.classList.add("is-dragging");
            dragPlaceholder = document.createElement("div");
            dragPlaceholder.className = "lfs-drag-placeholder";
            dragPlaceholder.setAttribute("aria-hidden", "true");
            matrix.insertBefore(dragPlaceholder, button);
          }
          button.classList.add("is-dragging", "is-drag-source");
          dragGhost = document.createElement("div");
          dragGhost.className = "lfs-drag-ghost";
          if (category.icon) {
            const ghostImage = document.createElement("img");
            ghostImage.src = category.icon;
            ghostImage.alt = "";
            ghostImage.draggable = false;
            dragGhost.append(ghostImage);
          } else {
            dragGhost.textContent = category.name?.slice(0, 1) || "?";
          }
          document.body.append(dragGhost);
          dragGhost.style.width = `${rect.width}px`;
          dragGhost.style.height = `${rect.height}px`;
          positionDragGhost(moveEvent.clientX, moveEvent.clientY);
          button.setPointerCapture?.(moveEvent.pointerId);
        }
        positionDragGhost(moveEvent.clientX, moveEvent.clientY);
        latestPointer = { x: moveEvent.clientX, y: moveEvent.clientY };
        if (!placeholderRaf) {
          placeholderRaf = requestAnimationFrame(() => {
            placeholderRaf = 0;
            if (latestPointer) updatePlaceholderPosition(latestPointer.x, latestPointer.y);
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
    return button;

  function positionDragGhost(x, y) {
    if (!dragGhost) return;
    dragGhost.style.left = `${Math.round(x - dragOffset.x)}px`;
    dragGhost.style.top = `${Math.round(y - dragOffset.y)}px`;
  }
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

  function openContextMenu(x, y, category) {
    ensureContextMenu();
    if (!contextMenu) return;
    hideTooltip();
    const deactivate = document.createElement("button");
    deactivate.type = "button";
    deactivate.className = "lfs-favorites-context-item";
    deactivate.setAttribute("role", "menuitem");
    deactivate.textContent = "Favoriten deaktivieren";
    deactivate.addEventListener("click", () => {
      closeContextMenu();
      deactivateFavorite(category.id);
    });
    contextMenu.replaceChildren(deactivate);
    contextMenu.dataset.lfsFavoriteId = category.id;
    contextMenu.hidden = false;
    const margin = 8;
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.min(x, window.innerWidth - rect.width - margin)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - rect.height - margin)}px`;
    deactivate.focus();
  }

  function closeContextMenu() {
    if (contextMenu) {
      contextMenu.hidden = true;
      contextMenu.replaceChildren();
      contextMenu.removeAttribute("data-lfs-favorite-id");
    }
  }

  function restoreHomePanel() {
    favoritesPanel?.remove();
    favoritesPanel = null;
    favoritesSide?.querySelectorAll(`#${CSS.escape(favoritePanelId)}`).forEach((element) => element.remove());
    favoritesSide = null;
  }

  function syncHomeFavoritesPanel() {
    if (!isHomePage()) {
      restoreHomePanel();
      return;
    }
    const lobby = document.querySelector("main.lobby");
    const side = lobby?.querySelector(".lobby__side") ?? document.querySelector(".lobby__side");
    if (!side) return;
    favoritesSide = side;
    const playlistPanel = document.getElementById(playlistPanelId);
    if (!favoritesPanel) {
      favoritesPanel = document.createElement("section");
      favoritesPanel.id = favoritePanelId;
      favoritesPanel.className = "lfs-favorites-card";
      favoritesPanel.setAttribute("aria-label", "Favoriten Rätsel Kategorien");
    }
    if (favoritesPanel.hasAttribute("data-lfs-playlist-hidden")) {
      favoritesPanel.removeAttribute("data-lfs-playlist-hidden");
    }
    if (playlistPanel && playlistPanel.parentElement === side) {
      if (favoritesPanel.previousElementSibling !== playlistPanel) playlistPanel.after(favoritesPanel);
    } else if (favoritesPanel.parentElement !== side) {
      side.append(favoritesPanel);
    }
    renderHomeFavoritesPanel();
  }

  function renderHomeFavoritesPanel() {
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
      hint.textContent = "Noch keine Favoriten – auf der Themen-Seite mit dem Stern markieren.";
      favoritesPanel.append(hint);
      delete favoritesPanel.dataset.viewKey;
      return;
    }
    delete favoritesPanel.dataset.empty;
    const viewKey = favorites.map((item) => item.id).join(",");
    if (favoritesPanel.dataset.viewKey === viewKey) return;
    if (draggedId) return;
    favoritesPanel.dataset.viewKey = viewKey;
    const matrix = document.createElement("div");
    matrix.className = "lfs-favorites-matrix";
    matrix.setAttribute("role", "group");
    matrix.setAttribute("aria-label", "Favoriten Rätsel Kategorien");
    favorites.forEach((category) => matrix.append(makeFavoriteIcon(category)));
    favoritesPanel.replaceChildren(matrix);
  }

  function render() {
    syncHomeFavoritesPanel();
    renderThemesStars();
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
      const icon = event.target?.closest?.("[data-lfs-favorite-icon]");
      if (icon) event.preventDefault();
    });
  }

  chrome.storage.local.get([storageKey], (stored) => {
    favorites = normalizeFavorites(stored?.[storageKey]);
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.hasOwn(changes, storageKey)) return;
    favorites = normalizeFavorites(changes[storageKey].newValue);
    render();
  });

  new MutationObserver(scheduleRender).observe(document, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("resize", scheduleRender);

  bindGlobalHandlers();
  render();
})();
