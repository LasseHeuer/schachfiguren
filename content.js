(() => {
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
  let zenCenterFrame;
  let zenSideElements = [];
  let normalRoundApp;
  let normalRoundSide;
  let normalRoundTable;
  let normalRoundBoardHeight = 0;
  let normalRoundFrame;
  const analysisInputs = new Map();
  const analysisRows = new Map();

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
      requestAnimationFrame(syncZenSideElements);
    });
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
    const materials = [...root.querySelectorAll(".material")].filter(visible);
    let clocks = [...root.querySelectorAll(".rclock")].filter(visible);
    if (!clocks.length) clocks = [...root.querySelectorAll(".clock")].filter(visible);
    const nextElements = [...new Set([...materials, ...clocks])];
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
    const topMaterial = materials.find(element => element.classList.contains("material-top")) ?? materials.slice().sort(byTop)[0];
    const bottomMaterial = materials.find(element => element.classList.contains("material-bottom")) ?? materials.slice().sort(byTop).at(-1);
    clocks.sort(byTop);
    const topClock = clocks[0];
    const bottomClock = clocks.length > 1 ? clocks.at(-1) : null;
    const topMaterialRect = topMaterial?.getBoundingClientRect();
    const bottomMaterialRect = bottomMaterial?.getBoundingClientRect();
    const topClockRect = topClock?.getBoundingClientRect();
    const bottomClockRect = bottomClock?.getBoundingClientRect();
    const padding = 6;
    const clockLeft = boardRect.right + padding;

    const place = (element, left, top) => {
      if (!element) return;
      element.style.setProperty("--lfs-zen-side-left", `${left}px`);
      element.style.setProperty("--lfs-zen-side-top", `${top}px`);
    };
    place(topClock, clockLeft, boardRect.top);
    place(bottomClock, clockLeft, boardRect.bottom - (bottomClockRect?.height ?? 0));
    place(topMaterial, boardRect.left - (topMaterialRect?.width ?? 0) - padding, boardRect.top);
    place(bottomMaterial, boardRect.left - (bottomMaterialRect?.width ?? 0) - padding, boardRect.bottom - (bottomMaterialRect?.height ?? 0));
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
      "--lfs-hover-mix-light": settings.hoverMixLight,
      "--lfs-last-move-dark": settings.lastMoveDark,
      "--lfs-selected-dark": settings.selectedDark,
      "--lfs-check-dark": settings.checkSquareDark,
      "--lfs-engine-arrow-dark": settings.engineArrowDark,
      "--lfs-hover-mix-dark": settings.hoverMixDark
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
    queuePlayTimeUpdate();
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
  });

  chrome.storage.local.get(null, stored => {
    settings = normalize(stored);
    applyWhenReady();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, change] of Object.entries(changes)) settings[key] = change.newValue;
    settings = normalize(settings);
    applyWhenReady();
    queuePlayTimeUpdate();
  });

  // One observer for both jobs; play time is only re-formatted while a profile page is present.
  new MutationObserver(records => {
    if (records.some(record => record.addedNodes.length || record.removedNodes.length)) {
      syncBoardLayout();
      if (document.documentElement.hasAttribute("data-lfs-zen-mode")) scheduleZenCenter();
      else syncNormalRoundLayout();
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
  }).observe(document, { childList: true, subtree: true, characterData: true });
})();
