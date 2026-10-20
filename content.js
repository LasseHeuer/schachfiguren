(() => {
  function isAllowedSoundUrl(value) {
    if (typeof value !== "string") return false;
    if (value.startsWith("data:audio/") || value.startsWith(chrome.runtime.getURL("sounds/"))) return true;
    try {
      const url = new URL(value, location.href);
      return url.protocol === "https:" && (url.origin === location.origin || url.hostname === "lichess.org" || /^lichess\d+\.org$/.test(url.hostname));
    } catch {
      return false;
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || !["lfs-audio-play", "lfs-audio-preload"].includes(message.channel) || !isAllowedSoundUrl(message.url)) return;
    if (message.channel === "lfs-audio-preload") {
      chrome.runtime.sendMessage({ type: "lfs-audio-preload", url: message.url }, () => void chrome.runtime.lastError);
      return;
    }
    if (typeof message.id !== "string" || !Number.isFinite(message.volume)) return;
    chrome.runtime.sendMessage({ type: "lfs-audio-play", id: message.id, url: message.url, volume: message.volume }, response => {
      window.postMessage({
        channel: "lfs-audio-result",
        id: message.id,
        ok: !chrome.runtime.lastError && response?.ok === true
      }, location.origin);
    });
  });

  const { defaults, normalize } = globalThis.LichessSettings;
  const pieceNames = ["wk", "wq", "wr", "wb", "wn", "wp", "bk", "bq", "br", "bb", "bn", "bp"];
  const analysisFeatures = [
    ["threatColoringEnabled", "Bedrohungsfarben"],
    ["selectedPieceWedgeEnabled", "Kandidatenzüge"],
    ["selectedPieceWedgeOnlySelected", "Keile nur für Auswahl", "selectedPieceWedgeEnabled"],
    ["wedgeBasePiecePreviewEnabled", "Figur an Keilbasis", "selectedPieceWedgeEnabled"],
    ["threatenedPieceOutlineEnabled", "Angriffe"],
    ["kingMovementFieldsEnabled", "Königbewegungsfelder"],
    ["defenseCirclesEnabled", "Verteidigungen"],
    ["threatCenterOutlineEnabled", "Figurenkontur"],
    ["threatCenterHatchExchangeFilterEnabled", "Nur haltbare Schraffur", "threatCenterOutlineEnabled"]
  ];
  let settings = { ...defaults };
  let analysisToolbar;
  let analysisEnabledInput;
  let zenToggle;
  let boardLayout;
  let zenBoard;
  let zenOrientationObserver;
  let zenOrientationBoard;
  let zenCenterFrame;
  let zenClockFrame;
  let zenClockProgressFrame;
  let zenSideFrame;
  let zenSideElements = [];
  let zenClockOverlay;
  let zenClockRows;
  let zenClockSources = { top: null, bottom: null };
  const zenClockMaxTimes = new WeakMap();
  const zenClockProgress = new WeakMap();
  let normalRoundApp;
  let normalRoundSide;
  let normalRoundTable;
  let normalRoundBoardHeight = 0;
  let normalRoundFrame;
  let pvPreviewFrame;
  let pvPreview;
  let pvPreviewBoard;
  let pvPreviewSlider;
  let pvPreviewFen;
  let pvPreviewSourceSlider;
  let pvPreviewSourceRow;
  let pvPreviewSourceFen;
  let pvPreviewSourceOrientation;
  let pvPreviewSourceIndex = -1;
  let pvPreviewSpeedSlider;
  let pvPreviewSpeedRow;
  let pvPreviewSpeedFen;
  let pvPreviewSpeedIndex = -1;
  let pvPreviewSpeedTime = 0;
  let pvPreviewStepDuration;
  const analysisInputs = new Map();
  const analysisRows = new Map();

  function observeZenBoardOrientation(board) {
    const nextOrientationBoard = board?.matches(".cg-wrap") ? board : board?.querySelector(".cg-wrap") ?? null;
    if (nextOrientationBoard === zenOrientationBoard) return;
    zenOrientationObserver?.disconnect();
    zenOrientationBoard = nextOrientationBoard;
    if (!zenOrientationBoard) return;

    zenOrientationObserver = new MutationObserver(() => {
      if (!document.documentElement.hasAttribute("data-lfs-zen-mode")) return;
      scheduleZenClockUpdate();
      scheduleZenSideUpdate();
    });
    zenOrientationObserver.observe(zenOrientationBoard, { attributes: true, attributeFilter: ["class"] });
  }

  function syncAnalysisToolbar() {
    if (!analysisToolbar) {
      analysisToolbar = document.createElement("aside");
      analysisToolbar.id = "lfs-analysis-toolbar";
      analysisToolbar.setAttribute("aria-label", "Analyse-Schnellzugriff");

      const header = document.createElement("div");
      header.className = "lfs-analysis-toolbar-header";
      const title = document.createElement("button");
      title.type = "button";
      title.className = "lfs-analysis-toolbar-title";
      title.textContent = "Analyse";
      title.setAttribute("aria-label", "Analyseleiste ausklappen");
      title.setAttribute("aria-expanded", "false");
      const masterLabel = document.createElement("label");
      masterLabel.className = "lfs-analysis-toolbar-master";
      analysisEnabledInput = document.createElement("input");
      analysisEnabledInput.type = "checkbox";
      analysisEnabledInput.setAttribute("role", "switch");
      analysisEnabledInput.setAttribute("aria-label", "Alle Analysefunktionen aktivieren oder deaktivieren");
      analysisEnabledInput.addEventListener("click", event => {
        if (event.detail) setTimeout(() => analysisEnabledInput.blur(), 0);
      });
      analysisEnabledInput.addEventListener("change", () => {
        const value = analysisEnabledInput.checked;
        settings = normalize({ ...settings, analysisEnabled: value });
        apply(document.documentElement);
        chrome.storage.local.set({ analysisEnabled: value });
      });
      masterLabel.append(analysisEnabledInput);
      const featureList = document.createElement("div");
      featureList.className = "lfs-analysis-toolbar-features";
      featureList.hidden = true;
      header.addEventListener("click", event => {
        if (event.target.closest(".lfs-analysis-toolbar-master")) return;
        featureList.hidden = !featureList.hidden;
        title.setAttribute("aria-expanded", String(!featureList.hidden));
        title.setAttribute("aria-label", featureList.hidden ? "Analyseleiste ausklappen" : "Analyseleiste einklappen");
        if (event.detail) title.blur();
      });
      header.append(title, masterLabel);
      analysisToolbar.append(header, featureList);

      zenToggle = document.createElement("button");
      zenToggle.id = "lfs-zen-toggle";
      zenToggle.type = "button";
      zenToggle.textContent = "Zen";
      zenToggle.setAttribute("aria-label", "Zenmodus aktivieren");
      zenToggle.setAttribute("aria-pressed", "false");
      zenToggle.addEventListener("click", event => {
        if (!zenBoard) return;
        const enabled = !document.documentElement.hasAttribute("data-lfs-zen-mode");
        document.documentElement.toggleAttribute("data-lfs-zen-mode", enabled);
        zenToggle.setAttribute("aria-pressed", String(enabled));
        zenToggle.setAttribute("aria-label", `Zenmodus ${enabled ? "deaktivieren" : "aktivieren"}`);
        if (enabled) scheduleZenCenter();
        else {
          clearZenOffset(zenBoard);
          syncZenPromotionChoice();
          syncNormalRoundLayout();
        }
        if (event.detail) zenToggle.blur();
      });

      for (const [key, labelText, parentKey] of analysisFeatures) {
        const label = document.createElement("label");
        label.className = parentKey ? "lfs-analysis-toolbar-feature lfs-analysis-toolbar-child" : "lfs-analysis-toolbar-feature";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("role", "switch");
        input.addEventListener("click", event => {
          if (event.detail) setTimeout(() => input.blur(), 0);
        });
        input.addEventListener("change", () => {
          const value = input.checked;
          settings = normalize({ ...settings, [key]: value });
          apply(document.documentElement);
          syncAnalysisToolbar();
          chrome.storage.local.set({ [key]: value });
        });
        const text = document.createElement("span");
        text.textContent = labelText;
        label.append(input, text);
        featureList.append(label);
        analysisInputs.set(key, input);
        analysisRows.set(key, { label, parentKey });
      }

      document.documentElement.append(zenToggle, analysisToolbar);
    }

    analysisEnabledInput.checked = settings.analysisEnabled;
    for (const [key, input] of analysisInputs) input.checked = settings[key];
    for (const [key, { label, parentKey }] of analysisRows) label.hidden = Boolean(parentKey) && !settings[parentKey];
  }

  function syncBoardLayout() {
    const board = document.querySelector(".puzzle__board cg-board, .analyse__board cg-board, .main-board cg-board, .bot-game cg-board, .study__board cg-board, main cg-board");
    const layout = board?.closest(".puzzle, .analyse, .round__app, .bot-game, .study__main, main") ?? null;
    const nextZenBoard = [
      board?.closest(".round__app__board"),
      board?.closest(".puzzle__board"),
      board?.closest(".analyse__board"),
      board?.closest(".bot-game__board"),
      board?.closest(".study__board"),
      board?.closest(".main-board"),
      board?.closest(".cg-wrap")
    ].find(candidate => {
      const rect = candidate?.getBoundingClientRect();
      return rect?.width > 0 && rect?.height > 0;
    }) ?? null;
    const zenBoardChanged = zenBoard !== nextZenBoard;
    if (boardLayout && boardLayout !== layout) boardLayout.removeAttribute("data-lfs-board-layout");
    if (zenBoard && zenBoardChanged) {
      zenBoard.removeAttribute("data-lfs-zen-board");
      clearZenOffset(zenBoard);
    }
    boardLayout = layout;
    zenBoard = nextZenBoard;
    observeZenBoardOrientation(zenBoard);
    boardLayout?.toggleAttribute("data-lfs-board-layout", settings.boardTopGapPercent > 0);
    zenBoard?.toggleAttribute("data-lfs-zen-board", true);
    if (zenToggle) {
      zenToggle.hidden = !zenBoard;
      zenToggle.disabled = !zenBoard;
    }
    if (!zenBoard && document.documentElement.hasAttribute("data-lfs-zen-mode")) {
      document.documentElement.removeAttribute("data-lfs-zen-mode");
      zenToggle?.setAttribute("aria-pressed", "false");
      zenToggle?.setAttribute("aria-label", "Zenmodus aktivieren");
    }
    if (zenBoard && document.documentElement.hasAttribute("data-lfs-zen-mode")) scheduleZenCenter();
  }

  function clearNormalRoundLayout() {
    cancelAnimationFrame(normalRoundFrame);
    if (normalRoundApp) {
      normalRoundApp.removeAttribute("data-lfs-normal-fit");
      normalRoundApp.style.removeProperty("--lfs-normal-app-height");
      for (const child of normalRoundApp.querySelectorAll("[data-lfs-normal-moves]")) child.removeAttribute("data-lfs-normal-moves");
    }
    if (normalRoundSide) {
      normalRoundSide.removeAttribute("data-lfs-normal-fit");
      normalRoundSide.style.removeProperty("--lfs-normal-side-offset");
    }
    if (normalRoundTable) {
      normalRoundTable.removeAttribute("data-lfs-normal-fit");
    }
    normalRoundApp = null;
    normalRoundSide = null;
    normalRoundTable = null;
    normalRoundBoardHeight = 0;
    normalRoundFrame = 0;
  }

  function syncNormalRoundLayout() {
    if (document.documentElement.hasAttribute("data-lfs-zen-mode")) return;
    cancelAnimationFrame(normalRoundFrame);
    normalRoundFrame = requestAnimationFrame(() => {
      if (document.documentElement.hasAttribute("data-lfs-zen-mode")) return;
      const board = document.querySelector(".round .round__app .main-board cg-board");
      const app = board?.closest(".round__app");
      const round = app?.closest(".round");
      const side = round?.querySelector(".round__side");
      const table = app?.querySelector(".round__app__table");
      if (!board || !app || !side || !table) {
        clearNormalRoundLayout();
        return;
      }

      const boardRect = board.getBoundingClientRect();
      const appRect = app.getBoundingClientRect();
      const sideRect = side.getBoundingClientRect();
      const wideLayout = boardRect.width > 0 && boardRect.height > 0 && sideRect.right <= boardRect.left && appRect.right > boardRect.right;
      if (!wideLayout) {
        clearNormalRoundLayout();
        return;
      }

      const changed = app !== normalRoundApp || side !== normalRoundSide || table !== normalRoundTable
        || Math.abs(boardRect.height - normalRoundBoardHeight) > 1;
      if (changed && normalRoundApp) clearNormalRoundLayout();
      const appStyle = getComputedStyle(app);
      const appPadding = (parseFloat(appStyle.paddingTop) || 0) + (parseFloat(appStyle.paddingBottom) || 0);

      normalRoundApp = app;
      normalRoundSide = side;
      normalRoundTable = table;
      normalRoundBoardHeight = boardRect.height;
      app.setAttribute("data-lfs-normal-fit", "");
      app.style.setProperty("--lfs-normal-app-height", `${boardRect.height + appPadding}px`);
      table.setAttribute("data-lfs-normal-fit", "");
      for (const child of app.children) {
        child.toggleAttribute("data-lfs-normal-moves", getComputedStyle(child).gridArea.split(" / ")[0] === "moves");
      }
      side.setAttribute("data-lfs-normal-fit", "");

      normalRoundFrame = requestAnimationFrame(() => {
        if (document.documentElement.hasAttribute("data-lfs-zen-mode") || app !== normalRoundApp) return;
        const currentBoard = board.getBoundingClientRect();
        const currentSide = side.getBoundingClientRect();
        const offset = parseFloat(side.style.getPropertyValue("--lfs-normal-side-offset")) || 0;
        const delta = currentBoard.top - currentSide.top;
        if (Math.abs(delta) >= 0.01) side.style.setProperty("--lfs-normal-side-offset", `${offset + delta}px`);
        document.dispatchEvent(new Event("scroll"));
        schedulePvPreviewSync();
      });
    });
  }

  function scheduleZenCenter() {
    cancelAnimationFrame(zenCenterFrame);
    zenCenterFrame = requestAnimationFrame(() => {
      if (!zenBoard || !document.documentElement.hasAttribute("data-lfs-zen-mode")) return;
      const board = zenBoard.querySelector("cg-board");
      if (!board) return;
      const boardRect = board.getBoundingClientRect();
      if (!boardRect.width || !boardRect.height) return;
      const offsetX = parseFloat(zenBoard.style.getPropertyValue("--lfs-zen-offset-x")) || 0;
      const offsetY = parseFloat(zenBoard.style.getPropertyValue("--lfs-zen-offset-y")) || 0;
      const deltaX = window.innerWidth / 2 - boardRect.left - boardRect.width / 2;
      const deltaY = window.innerHeight * (0.5 - settings.zenBoardUpPercent / 100) - boardRect.top - boardRect.height / 2;
      if (Math.abs(deltaX) >= 0.01 || Math.abs(deltaY) >= 0.01) {
        zenBoard.style.setProperty("--lfs-zen-offset-x", `${offsetX + deltaX}px`);
        zenBoard.style.setProperty("--lfs-zen-offset-y", `${offsetY + deltaY}px`);
        // Chessground clears its cached pointer bounds on scroll, not on CSS translation.
        document.dispatchEvent(new Event("scroll"));
      }
      requestAnimationFrame(() => {
        syncZenPromotionChoice();
        syncZenSideElements();
        schedulePvPreviewSync();
      });
    });
  }

  function syncZenPromotionChoice() {
    const choice = document.querySelector("#promotion-choice");
    if (!choice) return;
    if (!zenBoard || !document.documentElement.hasAttribute("data-lfs-zen-mode") || zenBoard.contains(choice)) {
      choice.removeAttribute("data-lfs-zen-promotion-outside-board");
      choice.style.removeProperty("--lfs-zen-promotion-top");
      choice.style.removeProperty("--lfs-zen-promotion-left");
      choice.style.removeProperty("--lfs-zen-promotion-width");
      choice.style.removeProperty("--lfs-zen-promotion-height");
      return;
    }

    const board = zenBoard.querySelector("cg-board");
    const rect = board?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;

    choice.setAttribute("data-lfs-zen-promotion-outside-board", "");
    choice.style.setProperty("--lfs-zen-promotion-top", `${rect.top}px`);
    choice.style.setProperty("--lfs-zen-promotion-left", `${rect.left}px`);
    choice.style.setProperty("--lfs-zen-promotion-width", `${rect.width}px`);
    choice.style.setProperty("--lfs-zen-promotion-height", `${rect.height}px`);
  }

  function ensureZenClockOverlay() {
    if (zenClockOverlay) return;
    zenClockOverlay = document.createElement("div");
    zenClockOverlay.id = "lfs-zen-clock-overlay";
    zenClockRows = {};
    for (const side of ["top", "bottom"]) {
      const row = document.createElement("div");
      row.className = "lfs-zen-clock";
      row.dataset.side = side;
      row.setAttribute("role", "timer");
      row.setAttribute("aria-label", side === "top" ? "Zeit des oberen Spielers" : "Zeit des unteren Spielers");
      const time = document.createElement("span");
      time.className = "lfs-zen-clock-time";
      const bar = document.createElement("span");
      bar.className = "lfs-zen-clock-bar";
      const fill = document.createElement("span");
      fill.className = "lfs-zen-clock-fill";
      const end = document.createElement("span");
      end.className = "lfs-zen-clock-active-end";
      fill.append(end);
      bar.append(fill);
      row.append(time, bar);
      zenClockOverlay.append(row);
      zenClockRows[side] = { row, time, bar, fill };
    }
    document.documentElement.append(zenClockOverlay);
  }

  function clockSeconds(clock) {
    const text = clock.querySelector(".clock")?.textContent.trim() ?? clock.textContent.trim();
    const match = /\d+(?::\d{1,2}){1,2}(?:[.,]\d+)?|\d+(?:[.,]\d+)?/.exec(text);
    if (!match) return null;
    return match[0].replace(",", ".").split(":").reduce((total, part) => total * 60 + Number(part), 0);
  }

  function rememberZenClockMaximum(source, remaining = clockSeconds(source)) {
    if (remaining === null) return null;
    const maximum = Math.max(zenClockMaxTimes.get(source) ?? remaining, remaining);
    zenClockMaxTimes.set(source, maximum);
    return { remaining, maximum };
  }

  function updateZenClock(side, source, now = performance.now()) {
    const { row, time, fill } = zenClockRows[side];
    row.hidden = !source;
    if (!source) {
      row.removeAttribute("data-running");
      row.removeAttribute("data-critical");
      return false;
    }

    const face = source.matches(".clock") ? source : source.querySelector(".clock") ?? source;
    const reading = clockSeconds(source);
    const clockTime = rememberZenClockMaximum(source, reading);
    const running = face.matches(".running") || source.matches(".running") || Boolean(source.querySelector(".running"));
    const nextText = face.textContent.trim();
    let progress = zenClockProgress.get(source);
    if (reading !== null && (!progress || progress.reading !== reading || progress.running !== running)) {
      let remaining = reading;
      if (running && progress?.running && reading <= progress.reading) {
        // Carry the sub-second estimate across displayed clock ticks to avoid visible steps.
        const predicted = progress.remaining - (now - progress.timestamp) / 1000;
        if (predicted >= reading && predicted - reading <= 1.1) remaining = predicted;
      }
      progress = { reading, remaining, timestamp: now, running };
      zenClockProgress.set(source, progress);
    }
    const remaining = reading === null ? null : running
      ? Math.max(0, progress.remaining - (now - progress.timestamp) / 1000)
      : reading;
    row.toggleAttribute("data-running", running);
    row.toggleAttribute("data-critical", remaining !== null && remaining <= 10);
    const showTime = !settings.zenClockShowTimeOnlyWhenLow || remaining !== null && remaining <= 10;
    time.hidden = !showTime;
    if (showTime && time.textContent !== nextText) time.textContent = nextText;
    if (clockTime) {
      const width = `${Math.max(0, Math.min(100, remaining / clockTime.maximum * 100))}%`;
      if (fill.style.width !== width) fill.style.width = width;
    } else {
      if (fill.style.width !== "100%") fill.style.width = "100%";
    }
    return running;
  }

  function animateZenClockProgress() {
    zenClockProgressFrame = 0;
    if (document.hidden || !document.documentElement.hasAttribute("data-lfs-zen-mode") || !zenClockRows) return;
    const now = performance.now();
    const topRunning = updateZenClock("top", zenClockSources.top, now);
    const bottomRunning = updateZenClock("bottom", zenClockSources.bottom, now);
    if (topRunning || bottomRunning) zenClockProgressFrame = requestAnimationFrame(animateZenClockProgress);
  }

  function scheduleZenClockProgress() {
    cancelAnimationFrame(zenClockProgressFrame);
    if (!document.hidden) zenClockProgressFrame = requestAnimationFrame(animateZenClockProgress);
  }

  function positionZenClock(side, boardRect) {
    const { row, fill } = zenClockRows[side];
    if (row.hidden) return;
    row.style.left = `${boardRect.left}px`;
    row.style.width = `${boardRect.width}px`;
    fill.style.setProperty("--lfs-zen-clock-end-size", `${boardRect.width * settings.zenClockActiveEndSizePercent / 100}px`);
    const margin = settings.zenClockMarginPx;
    const top = side === "top"
      ? boardRect.top - margin - row.getBoundingClientRect().height
      : boardRect.bottom + margin;
    row.style.top = `${top}px`;
  }

  function setZenClockPlayerColors() {
    if (!zenClockRows || !zenBoard) return;
    const board = zenBoard.querySelector("cg-board");
    const blackOrientation = board?.closest(".cg-wrap")?.classList.contains("orientation-black") ?? false;
    const topColor = blackOrientation ? "white" : "black";
    const bottomColor = blackOrientation ? "black" : "white";
    if (zenClockRows.top.row.dataset.playerColor !== topColor) zenClockRows.top.row.dataset.playerColor = topColor;
    if (zenClockRows.bottom.row.dataset.playerColor !== bottomColor) zenClockRows.bottom.row.dataset.playerColor = bottomColor;
  }

  function scheduleZenClockUpdate() {
    cancelAnimationFrame(zenClockFrame);
    cancelAnimationFrame(zenClockProgressFrame);
    zenClockFrame = requestAnimationFrame(() => {
      if (!document.documentElement.hasAttribute("data-lfs-zen-mode") || !zenClockRows) return;
      setZenClockPlayerColors();
      const boardRect = zenBoard?.querySelector("cg-board")?.getBoundingClientRect();
      const now = performance.now();
      const topRunning = updateZenClock("top", zenClockSources.top, now);
      const bottomRunning = updateZenClock("bottom", zenClockSources.bottom, now);
      if (boardRect?.width && boardRect.height) {
        positionZenClock("top", boardRect);
        positionZenClock("bottom", boardRect);
      }
      if (topRunning || bottomRunning) scheduleZenClockProgress();
    });
  }

  function scheduleZenSideUpdate() {
    cancelAnimationFrame(zenSideFrame);
    zenSideFrame = requestAnimationFrame(syncZenSideElements);
  }

  function syncZenSideElements() {
    if (!zenBoard || !document.documentElement.hasAttribute("data-lfs-zen-mode")) return;
    const board = zenBoard.querySelector("cg-board");
    if (!board) return;
    const root = zenBoard.closest(".round__app, .analyse__board, .analyse, .bot-game, .puzzle, .study__main, .study, main") ?? zenBoard.parentElement;
    if (!root) return;

    const boardRect = board.getBoundingClientRect();
    const visible = element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const materials = [...root.querySelectorAll(".material")];
    let clocks = [...root.querySelectorAll(".rclock")].filter(visible);
    if (!clocks.length) clocks = [...root.querySelectorAll(".clock")].filter(visible);
    let topMaterial = materials.find(element => element.classList.contains("material-top"));
    let bottomMaterial = materials.find(element => element.classList.contains("material-bottom"));
    if (!topMaterial && !bottomMaterial) {
      [topMaterial, bottomMaterial] = [materials[0] ?? null, materials[1] ?? null];
    } else {
      topMaterial ??= materials.find(element => element !== bottomMaterial) ?? null;
      bottomMaterial ??= materials.find(element => element !== topMaterial) ?? null;
    }
    const nextElements = [...new Set([topMaterial, bottomMaterial].filter(Boolean))];
    const nextSet = new Set(nextElements);
    for (const element of zenSideElements) {
      if (nextSet.has(element)) continue;
      element.removeAttribute("data-lfs-zen-side");
      element.style.removeProperty("--lfs-zen-side-left");
      element.style.removeProperty("--lfs-zen-side-top");
    }
    zenSideElements = nextElements;
    for (const element of zenSideElements) element.setAttribute("data-lfs-zen-side", "");

    if (!boardRect.width || !boardRect.height) return;
    const byTop = (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    clocks.sort(byTop);
    const topClock = clocks[0];
    const topMaterialRect = topMaterial?.getBoundingClientRect();
    const bottomMaterialRect = bottomMaterial?.getBoundingClientRect();
    const padding = 6;
    const materialLeft = boardRect.right + padding;
    const zenBoardRect = zenBoard.getBoundingClientRect();

    const place = (element, left, top) => {
      if (!element) return;
      const insideZenBoard = zenBoard.contains(element);
      const originLeft = insideZenBoard ? zenBoardRect.left + zenBoard.clientLeft : 0;
      const originTop = insideZenBoard ? zenBoardRect.top + zenBoard.clientTop : 0;
      element.style.setProperty("--lfs-zen-side-left", `${left - originLeft}px`);
      element.style.setProperty("--lfs-zen-side-top", `${top - originTop}px`);
    };
    place(topMaterial, materialLeft, boardRect.top);
    place(bottomMaterial, materialLeft, boardRect.bottom - (bottomMaterialRect?.height ?? 0));

    ensureZenClockOverlay();
    zenClockOverlay.style.setProperty("--lfs-zen-clock-font-size", `${settings.zenClockFontSizePx}px`);
    const devicePixelRatio = window.devicePixelRatio || 1;
    const lineThickness = Math.max(1, Math.round(settings.zenClockLineThicknessPx * devicePixelRatio)) / devicePixelRatio;
    zenClockOverlay.style.setProperty("--lfs-zen-clock-line-thickness", `${lineThickness}px`);
    zenClockOverlay.style.setProperty("--lfs-zen-clock-line-gap", `${settings.zenClockLineGapPx}px`);
    const bottomClock = clocks.length > 1 ? clocks.at(-1) : clocks[0]?.classList.contains("rclock-bottom") ? clocks[0] : null;
    zenClockSources = { top: topClock === bottomClock ? null : topClock, bottom: bottomClock };
    setZenClockPlayerColors();
    let running = false;
    for (const side of ["top", "bottom"]) {
      running = updateZenClock(side, zenClockSources[side]) || running;
      positionZenClock(side, boardRect);
    }
    if (running) scheduleZenClockProgress();
  }

  function schedulePvPreviewSync() {
    cancelAnimationFrame(pvPreviewFrame);
    pvPreviewFrame = requestAnimationFrame(syncPvPreview);
  }

  function previewPvMove(slider, index) {
    const row = slider._lfsPvRow;
    const moves = row ? [...row.querySelectorAll(":scope > .pv-san")] : [];
    const move = moves[index];
    if (!move) return;

    const now = performance.now();
    const fen = row.closest(".pv_box")?.dataset.fen;
    const sameSpeedTrack = pvPreviewSpeedSlider === slider && pvPreviewSpeedRow === row && pvPreviewSpeedFen === fen;
    if (sameSpeedTrack && index !== pvPreviewSpeedIndex) {
      const steps = Math.abs(index - pvPreviewSpeedIndex);
      const elapsed = now - pvPreviewSpeedTime;
      if (elapsed > 0) {
        const measuredStepDuration = Math.max(16, Math.min(1000, elapsed / steps));
        pvPreviewStepDuration = pvPreviewStepDuration == null
          ? measuredStepDuration * 1.08
          : pvPreviewStepDuration * 0.3 + measuredStepDuration * 1.08 * 0.7;
      }
    } else if (!sameSpeedTrack) {
      pvPreviewStepDuration = undefined;
    }
    if (!sameSpeedTrack || index !== pvPreviewSpeedIndex) {
      pvPreviewSpeedSlider = slider;
      pvPreviewSpeedRow = row;
      pvPreviewSpeedFen = fen;
      pvPreviewSpeedIndex = index;
      pvPreviewSpeedTime = now;
    }

    slider.value = String(index);
    slider.setAttribute("aria-valuetext", move.textContent.trim());
    slider.style.setProperty("--lfs-pv-progress", `${moves.length > 1 ? index * 100 / (moves.length - 1) : 0}%`);
    pvPreviewSlider = slider;
    pvPreviewFen = row.closest(".pv_box")?.dataset.fen;
    syncPvPreview();
  }

  function previewPvMoveAtPointer(slider, clientX) {
    const moves = slider._lfsPvRow ? [...slider._lfsPvRow.querySelectorAll(":scope > .pv-san")] : [];
    if (!moves.length) return;
    const rect = slider.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    previewPvMove(slider, Math.round(progress * (moves.length - 1)));
  }

  function syncPvLineSliders() {
    for (const box of document.querySelectorAll(".pv_box")) {
      const rows = [...box.querySelectorAll(":scope > .pv")];
      let container = box.querySelector(":scope > [data-lfs-pv-slider-container]");
      if (!rows.length) {
        container?.remove();
        box.removeAttribute("data-lfs-pv-sliders");
        continue;
      }

      box.setAttribute("data-lfs-pv-sliders", "");
      if (!container) {
        container = document.createElement("div");
        container.setAttribute("data-lfs-pv-slider-container", "");
        box.append(container);
      }

      while (container.children.length > rows.length) container.lastElementChild.remove();
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        let slider = container.children[index];
        if (!slider) {
          slider = document.createElement("input");
          slider.type = "range";
          slider.min = "0";
          slider.step = "1";
          slider.dir = "ltr";
          slider.setAttribute("aria-label", `Vorschau Kandidatenlinie ${index + 1}`);
          slider.addEventListener("pointerenter", event => previewPvMoveAtPointer(slider, event.clientX));
          slider.addEventListener("pointermove", event => {
            if (event.pointerType !== "touch") previewPvMoveAtPointer(slider, event.clientX);
          });
          slider.addEventListener("pointerleave", clearPvPreview);
          slider.addEventListener("blur", clearPvPreview);
          slider.addEventListener("pointerdown", event => event.stopPropagation());
          slider.addEventListener("input", () => previewPvMove(slider, Number(slider.value)));
          container.append(slider);
        }

        const moves = [...row.querySelectorAll(":scope > .pv-san")];
        slider._lfsPvRow = row;
        slider.max = String(Math.max(0, moves.length - 1));
        slider.disabled = !moves.length;
        slider.hidden = !moves.length;
        if (slider.dataset.moveCount !== String(moves.length)) {
          slider.value = "0";
          slider.dataset.moveCount = String(moves.length);
        }

        const rowRect = row.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        const score = row.querySelector(":scope > strong");
        const start = score ? score.getBoundingClientRect().right - boxRect.left + 6 : rowRect.left - boxRect.left + 8;
        const end = rowRect.right - boxRect.left - 8;
        slider.style.left = `${start}px`;
        slider.style.top = `${rowRect.top - boxRect.top + rowRect.height / 2 - 11}px`;
        slider.style.width = `${Math.max(24, end - start)}px`;
      }
    }
  }

  function clearPvPreview() {
    pvPreview?.remove();
    pvPreviewBoard?.removeAttribute("data-lfs-pv-preview");
    pvPreview = null;
    pvPreviewBoard = null;
    pvPreviewSlider = null;
    pvPreviewFen = null;
    pvPreviewSourceSlider = null;
    pvPreviewSourceRow = null;
    pvPreviewSourceFen = null;
    pvPreviewSourceOrientation = null;
    pvPreviewSourceIndex = -1;
    pvPreviewSpeedSlider = null;
    pvPreviewSpeedRow = null;
    pvPreviewSpeedFen = null;
    pvPreviewSpeedIndex = -1;
    pvPreviewSpeedTime = 0;
    pvPreviewStepDuration = undefined;
  }

  function syncPvPreview() {
    if (!settings.enabled) {
      for (const box of document.querySelectorAll(".pv_box[data-lfs-pv-sliders]")) {
        box.removeAttribute("data-lfs-pv-sliders");
        box.querySelector(":scope > [data-lfs-pv-slider-container]")?.remove();
      }
      clearPvPreview();
      return;
    }

    syncPvLineSliders();
    const boards = [...document.querySelectorAll(".round__app .main-board cg-board, .analyse__board cg-board, .bot-game__board cg-board, .puzzle__board cg-board, .study__board cg-board")];
    const board = boards.find(candidate => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
    const row = pvPreviewSlider?._lfsPvRow;
    const move = row?.querySelectorAll(":scope > .pv-san")[Number(pvPreviewSlider.value)];
    if (!board || !pvPreviewSlider?.isConnected || !row?.isConnected || !move?.dataset.board
      || row.closest(".pv_box")?.dataset.fen !== pvPreviewFen) {
      clearPvPreview();
      return;
    }

    const blackOrientation = board.closest(".cg-wrap")?.classList.contains("orientation-black");
    const key = `${move.dataset.board}:${blackOrientation}:${settings.markLastMove}:${settings.lastMoveLineWidth}`;
    if (pvPreviewBoard !== board) pvPreviewBoard?.removeAttribute("data-lfs-pv-preview");
    const sameBoard = pvPreviewBoard === board;
    pvPreviewBoard = board;
    pvPreview ??= document.createElement("div");
    pvPreview.id = "lfs-pv-preview";
    pvPreview.setAttribute("aria-hidden", "true");
    if (pvPreview.parentElement !== board) board.append(pvPreview);
    board.setAttribute("data-lfs-pv-preview", "");
    if (pvPreview.dataset.position === key) return;

    // Use Lichess's per-move FEN, not the mini-board's pixel-sized DOM.
    const [fen, uci] = move.dataset.board.split("|");
    const previewMoves = [...row.querySelectorAll(":scope > .pv-san")];
    const previewIndex = Number(pvPreviewSlider.value);
    const samePreviewLine = pvPreviewSourceSlider === pvPreviewSlider && pvPreviewSourceRow === row
      && pvPreviewSourceFen === pvPreviewFen && pvPreviewSourceOrientation === blackOrientation;
    const adjacentPreview = samePreviewLine && Math.abs(previewIndex - pvPreviewSourceIndex) === 1;
    const transitionUci = previewIndex > pvPreviewSourceIndex
      ? uci
      : previewMoves[pvPreviewSourceIndex]?.dataset.board.split("|")[1];
    const roles = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
    const targets = [];
    fen.split(" ")[0].split("[")[0].split("/").forEach((rank, rankIndex) => {
      let file = 0;
      for (const symbol of rank) {
        if (/\d/.test(symbol)) {
          file += Number(symbol);
          continue;
        }
        const role = roles[symbol.toLowerCase()];
        if (!role) continue;
        const color = symbol === symbol.toUpperCase() ? "white" : "black";
        const targetFile = blackOrientation ? 7 - file : file;
        const targetRank = blackOrientation ? 7 - rankIndex : rankIndex;
        targets.push({
          square: `${String.fromCharCode(97 + file)}${8 - rankIndex}`,
          piece: `${color} ${role}`,
          color,
          role,
          symbol,
          left: targetFile * 12.5,
          top: targetRank * 12.5
        });
        file++;
      }
    });

    const boardRect = board.getBoundingClientRect();
    const existingPieces = [...pvPreview.querySelectorAll(":scope > .lfs-pv-piece")];
    const origins = new Map(existingPieces.map(piece => {
      const rect = piece.getBoundingClientRect();
      for (const animation of piece.getAnimations()) animation.cancel();
      return [piece, {
        left: boardRect.width ? (rect.left - boardRect.left) / boardRect.width * 100 : 0,
        top: boardRect.height ? (rect.top - boardRect.top) / boardRect.height * 100 : 0
      }];
    }));
    const usedPieces = new Set();
    const reusedPieces = new Map();
    const reuse = (target, piece) => {
      if (!piece || usedPieces.has(piece)) return false;
      usedPieces.add(piece);
      reusedPieces.set(target, piece);
      return true;
    };

    for (const target of targets) {
      reuse(target, existingPieces.find(piece => piece.dataset.square === target.square && piece.dataset.piece === target.piece));
    }

    const moveSquares = adjacentPreview && transitionUci?.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (moveSquares) {
      const [, from, to] = moveSquares;
      const movingBackwards = previewIndex < pvPreviewSourceIndex;
      const sourceSquare = movingBackwards ? to : from;
      const targetSquare = movingBackwards ? from : to;
      const movingPiece = existingPieces.find(piece => piece.dataset.square === sourceSquare && !usedPieces.has(piece));
      const destination = targets.find(target => target.square === targetSquare && target.color === movingPiece?.dataset.piece.split(" ")[0]);
      if (movingPiece && destination && !reusedPieces.has(destination)) reuse(destination, movingPiece);
    }

    for (const target of targets) {
      if (reusedPieces.has(target)) continue;
      const candidates = existingPieces.filter(piece => !usedPieces.has(piece) && piece.dataset.piece === target.piece);
      candidates.sort((first, second) => {
        const distance = piece => {
          const origin = origins.get(piece);
          return Math.hypot((origin.left - target.left) * boardRect.width / 100, (origin.top - target.top) * boardRect.height / 100);
        };
        return distance(first) - distance(second);
      });
      reuse(target, candidates[0]);
    }

    const fragment = document.createDocumentFragment();
    const lastMoveLine = globalThis.LichessLastMoveLine.createPreviewLine(uci, blackOrientation);
    if (lastMoveLine) fragment.append(lastMoveLine);
    const shouldAnimate = Boolean(pvPreview.dataset.position) && sameBoard && samePreviewLine && settings.enabled && !settings.disableAnimations
      && typeof Element.prototype.animate === "function" && boardRect.width > 0 && boardRect.height > 0;
    const baseDuration = pvPreviewStepDuration ?? (settings.moveAnimationLichessSpeed ? 250 : settings.moveAnimationDuration);
    for (const target of targets) {
      const piece = reusedPieces.get(target) ?? document.createElement("span");
      const origin = origins.get(piece);
      piece.className = "lfs-pv-piece";
      piece.dataset.piece = target.piece;
      piece.dataset.square = target.square;
      piece.style.left = `${target.left}%`;
      piece.style.top = `${target.top}%`;
      piece.style.setProperty("--lfs-pv-piece-color", `var(--lfs-${target.color}-piece-color)`);
      piece.style.setProperty("--lfs-pv-piece-mask", `var(--lfs-piece-${target.color[0]}${target.symbol.toLowerCase()})`);
      if (shouldAnimate && origin && baseDuration > 0) {
        const moveX = target.left - origin.left;
        const moveY = target.top - origin.top;
        const distance = Math.hypot(moveX / 12.5, moveY / 12.5);
        const pixelDistance = Math.hypot(moveX * boardRect.width / 100, moveY * boardRect.height / 100);
        if (pixelDistance > 0.5) {
          const distanceFactor = pvPreviewStepDuration == null && settings.moveAnimationTimeDistance ? settings.moveAnimationDistanceFactor : 0;
          const duration = baseDuration + distance * distanceFactor * baseDuration;
          const easing = `cubic-bezier(${settings.moveAnimationCurve.map((value, index) => (index % 2 ? value / -90 : value)).join(", ")})`;
          const animation = piece.animate([
            { left: `${origin.left}%`, top: `${origin.top}%` },
            { left: `${target.left}%`, top: `${target.top}%` }
          ], { duration, easing, fill: "forwards" });
          animation.onfinish = () => animation.cancel();
        }
      }
      fragment.append(piece);
    }
    pvPreview.replaceChildren(fragment);
    pvPreview.dataset.position = key;
    pvPreviewSourceSlider = pvPreviewSlider;
    pvPreviewSourceRow = row;
    pvPreviewSourceFen = pvPreviewFen;
    pvPreviewSourceOrientation = blackOrientation;
    pvPreviewSourceIndex = previewIndex;
  }

  function clearZenOffset(board) {
    for (const property of ["--lfs-zen-offset-x", "--lfs-zen-offset-y"]) {
      board.style.removeProperty(property);
    }
    for (const element of zenSideElements) {
      element.removeAttribute("data-lfs-zen-side");
      element.style.removeProperty("--lfs-zen-side-left");
      element.style.removeProperty("--lfs-zen-side-top");
    }
    zenSideElements = [];
    document.dispatchEvent(new Event("scroll"));
  }

  function apply(root) {
    if (!root) return;

    root.toggleAttribute("data-lfs-disabled", !settings.enabled);
    root.toggleAttribute("data-lfs-square-move-dots", settings.squareMoveDots);
    root.toggleAttribute("data-lfs-graph-colors-disabled", !settings.analysisGraphColors);
    root.toggleAttribute("data-lfs-remove-outlines", settings.removeOutlines);
    root.toggleAttribute("data-lfs-remove-glows", settings.removeGlows);
    root.toggleAttribute("data-lfs-remove-gradients", settings.removeGradients);
    root.toggleAttribute("data-lfs-remove-shadows", settings.removeShadows);
    root.toggleAttribute("data-lfs-remove-rounded-corners", settings.removeRoundedCorners);
    root.toggleAttribute("data-lfs-disable-animations", settings.disableAnimations);
    root.toggleAttribute("data-lfs-engine-arrow-outline", settings.enabled && settings.engineArrowOutlineEnabled);
    root.dataset.lfsEngineArrowOutlineWidth = settings.engineArrowOutlineWidthPercent;
    root.dataset.lfsEngineArrowHeadSize = settings.engineArrowHeadSizePercent;
    root.dataset.lfsEngineArrowShaftWidth = settings.engineArrowShaftWidthPercent;
    root.dataset.lfsEngineArrowStartOffset = settings.engineArrowStartOffsetPercent;
    root.dataset.lfsEngineArrowEndOffset = settings.engineArrowEndOffsetPercent;
    root.toggleAttribute("data-lfs-monochrome-board", settings.monochromeBoard);
    root.toggleAttribute("data-lfs-square-outline", settings.squareOutline);
    root.toggleAttribute("data-lfs-rund-comic", settings.pieceSet === "rund_comic");
    const analysisSettings = settings.analysisEnabled ? settings : {
      ...settings,
      threatColoringEnabled: false,
      selectedPieceWedgeEnabled: false,
      threatenedPieceOutlineEnabled: false,
      kingMovementFieldsEnabled: false,
      defenseCirclesEnabled: false,
      threatCenterOutlineEnabled: false
    };
    globalThis.LichessLastMoveLine?.update(settings);
    globalThis.LichessThreatCoding?.update(analysisSettings);
    globalThis.LichessKingMovementFields?.update(analysisSettings);
    globalThis.LichessPieceBounce?.update(settings);
    globalThis.LichessMoveAnimation?.update(settings);

    globalThis.LichessSelectedPieceWedge?.update(analysisSettings);

    const variables = {
      "--lfs-idle-mix-percent": `${settings.idleMixPercent}%`,
      "--lfs-hover-mix-percent": `${settings.hoverMixPercent}%`,
      "--lfs-hover-desaturation-setting": `${settings.hoverDesaturation}%`,
      "--lfs-board-top-gap": `${settings.boardTopGapPercent}vh`,
      "--lfs-move-dot-size": `${settings.moveDotSize}%`,
      "--lfs-white-piece-color": settings.whitePieceColor,
      "--lfs-black-piece-color": settings.blackPieceColor,
      "--lfs-board-light-light": settings.boardLightLight,
      "--lfs-board-dark-light": settings.boardDarkLight,
      "--lfs-board-light-dark": settings.boardLightDark,
      "--lfs-board-dark-dark": settings.boardDarkDark,
      "--lfs-last-move-light": settings.lastMoveLight,
      "--lfs-selected-light": settings.selectedLight,
      "--lfs-check-light": settings.checkSquareLight,
      "--lfs-engine-arrow-light": settings.engineArrowLight,
      "--lfs-engine-arrow-opacity": settings.engineArrowOpacity / 100,
      "--lfs-hover-mix-light": settings.hoverMixLight,
      "--lfs-last-move-dark": settings.lastMoveDark,
      "--lfs-selected-dark": settings.selectedDark,
      "--lfs-check-dark": settings.checkSquareDark,
      "--lfs-engine-arrow-dark": settings.engineArrowDark,
      "--lfs-hover-mix-dark": settings.hoverMixDark,
      "--lfs-zen-clock-blink-duration": `${1 / settings.zenClockBlinkFrequency}s`,
      "--lfs-zen-clock-end-blend": `${settings.zenClockActiveEndBlendPercent}%`
    };

    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);

    const base = chrome.runtime.getURL(`${settings.pieceSet}/`);
    const complexPawnSet = settings.complexPawn && ["system_pixel", "system_eckig"].includes(settings.pieceSet);
    for (const piece of pieceNames) {
      const asset = settings.pieceSet === "cage"
        ? `cage_${piece[1]}`
        : complexPawnSet && ["wp", "bp"].includes(piece)
          ? `${piece}_2`
          : piece;
      root.style.setProperty(`--lfs-piece-${piece}`, `url("${base}${asset}.svg")`);
    }

    root.toggleAttribute("data-lfs-ready", true);
    syncAnalysisToolbar();
    syncBoardLayout();
    syncNormalRoundLayout();
    schedulePvPreviewSync();
    queuePlayTimeUpdate();
    if (document.documentElement.hasAttribute("data-lfs-zen-mode")) scheduleZenClockUpdate();
  }

  const dayPattern = /(\d[\d.,\s\u00a0]*)\s*(?:days?|tage?|jours?|d[ií]as?|giorni?|dias?|dagen?|dagar?|дн(?:я|ей|ь)?)/iu;
  const hourPattern = /(\d[\d.,\s\u00a0]*)\s*(?:hours?|stunden?|heures?|horas?|ore|uur|timm(?:e|ar)|ч(?:ас(?:а|ов)?)?)/iu;
  let playTimeTimer;

  function numericValue(match) {
    return match ? Number(match[1].replace(/\D/g, "")) : 0;
  }

  function formatPlayTime() {
    const timeElements = [...document.querySelectorAll("#us_profile .stats p[title]")];
    const timeLabels = /^(?:time spent playing|gesamtspielzeit|spielzeit|temps? de jeu|tiempo (?:de juego|jugando)|tempo (?:di gioco|de jogo))$/iu;

    for (const header of document.querySelectorAll(".perf-stat .counter th")) {
      if (timeLabels.test(header.textContent.trim()) && header.nextElementSibling) {
        timeElements.push(header.nextElementSibling);
      }
    }

    const numberFormat = new Intl.NumberFormat(document.documentElement.lang || "de-DE");
    for (const element of timeElements) {
      const originalText = element.dataset.lfsOriginalTimeText ?? element.textContent;
      const colon = originalText.indexOf(":");
      const prefix = colon < 0 ? "" : originalText.slice(0, colon + 1);
      const duration = colon < 0 ? originalText : originalText.slice(colon + 1);
      const days = dayPattern.exec(duration);

      if (!settings.enabled || !settings.showPlayTimeInHours) {
        if (element.dataset.lfsOriginalTimeText !== undefined) {
          element.textContent = element.dataset.lfsOriginalTimeText;
          if (element.dataset.lfsOriginalTimeHasTitle === "true") {
            element.title = element.dataset.lfsOriginalTimeTitle ?? "";
          } else {
            element.removeAttribute("title");
          }
          delete element.dataset.lfsOriginalTimeText;
          delete element.dataset.lfsOriginalTimeTitle;
          delete element.dataset.lfsOriginalTimeHasTitle;
        }
        continue;
      }

      if (!days) continue;

      const originalTitle = element.dataset.lfsOriginalTimeTitle ?? element.title;
      const titleHours = hourPattern.exec(originalTitle);
      const visibleHours = hourPattern.exec(duration);
      const totalHours = titleHours
        ? numericValue(titleHours)
        : numericValue(days) * 24 + numericValue(visibleHours);
      const formattedHours = numberFormat.format(totalHours);
      const formattedText = `${prefix}${prefix ? " " : ""}${formattedHours} Std.`;

      if (element.textContent !== formattedText) {
        element.dataset.lfsOriginalTimeText = originalText;
        element.dataset.lfsOriginalTimeTitle = originalTitle;
        element.dataset.lfsOriginalTimeHasTitle = String(element.hasAttribute("title"));
        element.textContent = formattedText;
        element.title = formattedText;
      }
    }
  }

  function queuePlayTimeUpdate() {
    clearTimeout(playTimeTimer);
    playTimeTimer = setTimeout(formatPlayTime, 80);
  }

  function applyPromotionSquareTheme() {
    for (const square of document.querySelectorAll("#promotion-choice square")) {
      const file = Number.parseFloat(square.style.left) / 12.5;
      const rank = Number.parseFloat(square.style.top) / 12.5;
      if (!Number.isFinite(file) || !Number.isFinite(rank)) continue;

      const tone = (Math.round(file) + Math.round(rank)) % 2 === 0 ? "light" : "dark";
      if (square.dataset.lfsPromotionTone !== tone) square.dataset.lfsPromotionTone = tone;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "lfs-preview-sound" && typeof message.name === "string") {
      window.postMessage({
        channel: "lfs-sound-preview",
        name: message.name,
        source: message.source,
        volume: message.volume
      }, location.origin);
      sendResponse({ ok: true });
      return;
    }
    if (message?.type !== "lfs-status") return;

    const root = document.documentElement;
    const boards = [...document.querySelectorAll(".cg-wrap cg-board, .mini-game cg-board")];
    const board = boards.find(candidate => candidate.getBoundingClientRect().height > 0) ?? boards[0];
    sendResponse({
      ready: root?.hasAttribute("data-lfs-ready") ?? false,
      enabled: root ? !root.hasAttribute("data-lfs-disabled") : false,
      piecesLoaded: Boolean(root?.style.getPropertyValue("--lfs-piece-wk")),
      boardPresent: Boolean(board),
      boardHeight: Math.round(board?.getBoundingClientRect().height ?? 0),
      pieceCount: board?.querySelectorAll(":scope > piece:not(.ghost)").length ?? 0
    });
  });

  function applyWhenReady() {
    if (document.documentElement) {
      apply(document.documentElement);
      return;
    }

    new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      apply(document.documentElement);
      observer.disconnect();
    }).observe(document, { childList: true });
  }

  function isBoardTarget(target) {
    return target instanceof Element && target.closest("cg-board");
  }

  document.addEventListener("pointerover", event => {
    if (isBoardTarget(event.target)) document.documentElement?.setAttribute("data-lfs-board-hover", "");
  });

  document.addEventListener("pointerout", event => {
    if (!isBoardTarget(event.target) || isBoardTarget(event.relatedTarget)) return;
    document.documentElement?.removeAttribute("data-lfs-board-hover");
  });

  window.addEventListener("resize", () => {
    if (document.documentElement.hasAttribute("data-lfs-zen-mode")) scheduleZenCenter();
    else syncNormalRoundLayout();
    schedulePvPreviewSync();
  });

  const refreshZenClock = () => {
    if (document.hidden) {
      cancelAnimationFrame(zenClockFrame);
      cancelAnimationFrame(zenClockProgressFrame);
      return;
    }
    scheduleZenClockUpdate();
  };
  document.addEventListener("visibilitychange", refreshZenClock);
  window.addEventListener("focus", refreshZenClock);
  window.addEventListener("pageshow", refreshZenClock);

  document.addEventListener("scroll", schedulePvPreviewSync, true);

  const syncedCustomSoundFiles = new Set();
  function syncSoundSettings() {
    chrome.storage.local.get("soundSettings", stored => {
      const soundSettings = stored.soundSettings && typeof stored.soundSettings === "object" ? stored.soundSettings : {};
      const customNames = new Set(Object.values(soundSettings)
        .map(setting => setting?.source)
        .filter(source => typeof source === "string" && source.startsWith("custom:"))
        .map(source => source.slice("custom:".length)));
      const pendingNames = [...customNames].filter(name => !syncedCustomSoundFiles.has(name));
      const fileKeys = pendingNames.map(name => `lfsCustomSound:${name}`);
      const sendSettings = files => window.postMessage({
        channel: "lfs-sound-settings",
        settings: soundSettings,
        files: Object.fromEntries(pendingNames.flatMap(name => {
          const fileKey = `lfsCustomSound:${name}`;
          const source = files[fileKey] || (globalThis.LichessSoundCatalog.customFiles.includes(name)
            ? chrome.runtime.getURL(`sounds/${encodeURIComponent(name)}`)
            : undefined);
          return source ? [[name, source]] : [];
        }))
      }, location.origin);
      if (!fileKeys.length) {
        sendSettings({});
        return;
      }
      chrome.storage.local.get(fileKeys, files => {
        for (const name of pendingNames) {
          if (files[`lfsCustomSound:${name}`] || globalThis.LichessSoundCatalog.customFiles.includes(name)) syncedCustomSoundFiles.add(name);
        }
        sendSettings(files);
      });
    });
  }

  chrome.storage.local.get(Object.keys(defaults), stored => {
    settings = normalize(stored);
    applyWhenReady();
    syncSoundSettings();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const changedKeys = Object.keys(changes);
    if (changedKeys.some(key => key === "soundSettings" || key === "lfsCustomSoundFiles" || key.startsWith("lfsCustomSound:"))) {
      for (const key of changedKeys.filter(key => key.startsWith("lfsCustomSound:"))) {
        syncedCustomSoundFiles.delete(key.slice("lfsCustomSound:".length));
      }
      syncSoundSettings();
    }
    if (!changedKeys.some(key => key !== "soundSettings" && Object.prototype.hasOwnProperty.call(defaults, key))) return;
    for (const [key, change] of Object.entries(changes)) settings[key] = change.newValue;
    settings = normalize(settings);
    applyWhenReady();
    queuePlayTimeUpdate();
  });

  // One observer for both jobs; play time is only re-formatted while a profile page is present.
  new MutationObserver(records => {
    const targetElement = record => record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    const isZenClockMutation = record => Boolean(targetElement(record)?.closest(".rclock, .clock"));
    const isZenMaterialMutation = record => Boolean(targetElement(record)?.closest(".material"));
    const isZenOverlayMutation = record => {
      const target = targetElement(record);
      if (target?.closest("#lfs-zen-clock-overlay")) return true;
      const nodes = [...record.addedNodes, ...record.removedNodes];
      return nodes.length > 0 && nodes.every(node => node === zenClockOverlay
        || node.nodeType === Node.ELEMENT_NODE && (node.id === "lfs-zen-clock-overlay" || node.closest("#lfs-zen-clock-overlay"))
        || node.parentElement?.closest("#lfs-zen-clock-overlay"));
    };
    const clockSources = new Set();
    const addClockSource = element => {
      if (element?.nodeType !== Node.ELEMENT_NODE) return;
      const source = element.closest(".rclock") ?? element.closest(".clock");
      if (source) clockSources.add(source);
    };
    for (const record of records) {
      addClockSource(targetElement(record));
      for (const node of record.addedNodes) {
        addClockSource(node);
        if (node.nodeType === Node.ELEMENT_NODE) {
          node.querySelectorAll(".rclock, .clock").forEach(addClockSource);
        }
      }
    }
    for (const source of clockSources) rememberZenClockMaximum(source);

    const zenMode = document.documentElement.hasAttribute("data-lfs-zen-mode");
    const hasPreviewMutation = records.some(record => {
      const hasChangedNodes = record.addedNodes.length || record.removedNodes.length;
      if (!zenMode) return hasChangedNodes || record.type === "characterData";
      if (isZenClockMutation(record) || isZenMaterialMutation(record) || isZenOverlayMutation(record)) return false;
      return hasChangedNodes || record.type === "characterData";
    });
    if (hasPreviewMutation) schedulePvPreviewSync();
    const hasLayoutMutation = records.some(record => (record.addedNodes.length || record.removedNodes.length)
      && (!zenMode || !isZenClockMutation(record) && !isZenMaterialMutation(record) && !isZenOverlayMutation(record)));
    if (hasLayoutMutation) {
      syncBoardLayout();
      if (zenMode) scheduleZenCenter();
      else syncNormalRoundLayout();
    }
    if (zenMode) {
      if (records.some(isZenClockMutation)) scheduleZenClockUpdate();
      if (records.some(isZenMaterialMutation)) scheduleZenSideUpdate();
    }
    if (document.querySelector("#us_profile, .perf-stat")) queuePlayTimeUpdate();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.id === "promotion-choice" || node.querySelector("#promotion-choice")) {
          applyPromotionSquareTheme();
          return;
        }
      }
    }
  }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
})();
