(() => {
  const { defaults, normalize } = globalThis.LichessSettings;
  const pieceNames = ["wk", "wq", "wr", "wb", "wn", "wp", "bk", "bq", "br", "bb", "bn", "bp"];
  let settings = { ...defaults };

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
    globalThis.LichessLastMoveLine?.update(settings);
    globalThis.LichessThreatCoding?.update(settings);
    globalThis.LichessPieceBounce?.update(settings);

    const variables = {
      "--lfs-idle-mix-percent": `${settings.idleMixPercent}%`,
      "--lfs-hover-mix-percent": `${settings.hoverMixPercent}%`,
      "--lfs-hover-desaturation-setting": `${settings.hoverDesaturation}%`,
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
      const asset = complexPawnSet && ["wp", "bp"].includes(piece)
        ? `${piece}_2`
        : piece;
      root.style.setProperty(`--lfs-piece-${piece}`, `url("${base}${asset}.svg")`);
    }

    root.toggleAttribute("data-lfs-ready", true);
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
      const formattedHours = new Intl.NumberFormat(document.documentElement.lang || "de-DE").format(totalHours);
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "lfs-status") return;

    const root = document.documentElement;
    const board = document.querySelector(".main-board cg-board");
    sendResponse({
      ready: root?.hasAttribute("data-lfs-ready") ?? false,
      enabled: root ? !root.hasAttribute("data-lfs-disabled") : false,
      piecesLoaded: Boolean(root?.style.getPropertyValue("--lfs-piece-wk")),
      boardPresent: Boolean(board),
      boardHeight: Math.round(board?.getBoundingClientRect().height ?? 0),
      pieceCount: board?.querySelectorAll("piece").length ?? 0
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

  new MutationObserver(queuePlayTimeUpdate).observe(document, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
