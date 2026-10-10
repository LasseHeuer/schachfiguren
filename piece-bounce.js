(() => {
  const pieceSelector = [
    ".main-board cg-board piece.white:not(.ghost)",
    ".main-board cg-board piece.black:not(.ghost)",
    ".mini-game cg-board piece.white:not(.ghost)",
    ".mini-game cg-board piece.black:not(.ghost)",
    ".board-editor .spare piece.white:not(.ghost)",
    ".board-editor .spare piece.black:not(.ghost)"
  ].join(", ");
  const activePieces = new Map();
  let settings = null;
  let hoveredPiece = null;

  function isEnabled() {
    return settings?.enabled && settings.pieceBounceEnabled && !settings.disableAnimations;
  }

  function stop(piece, state = activePieces.get(piece)) {
    if (!state || state.stopped) return;
    state.stopped = true;
    if (state.pauseTimer) clearTimeout(state.pauseTimer);
    state.resumePause?.();
    state.animation?.cancel();
    piece.removeAttribute("data-lfs-bounce-running");
    activePieces.delete(piece);
  }

  function finishCurrentStep(piece) {
    const state = activePieces.get(piece);
    if (!state) return;
    state.finishAfterCycle = true;
    if (!state.pauseTimer) return;
    clearTimeout(state.pauseTimer);
    state.pauseTimer = null;
    const resumePause = state.resumePause;
    state.resumePause = null;
    resumePause?.();
  }

  async function animateWhileHovered(piece, state) {
    while (activePieces.get(piece) === state && isEnabled() && piece.isConnected && !state.finishAfterCycle && (settings.pieceBounceLoop || state.steps === 0)) {
      const angle = state.angle;
      const isPawn = piece.classList.contains("pawn");
      const isWiggle = isPawn || settings.pieceBounceStyle === "wiggle-only";
      const rotation = isWiggle ? 0 : 90;
      const board = piece.closest("cg-board");
      const orientation = board?.closest(".cg-wrap")?.classList;
      const orientationOffset = board && (
        (orientation?.contains("orientation-white") && piece.classList.contains("black")) ||
        (orientation?.contains("orientation-black") && piece.classList.contains("white"))
      ) ? 180 : 0;
      const curve = isWiggle ? settings.pieceBounceWiggleCurve : settings.pieceBounceCurve;
      const [handle1Time, handle1Value, handle2Time, handle2Value] = curve;
      // Normalize the saved 90-degree curve so its timing stays the same at every rotation size.
      const easing = `cubic-bezier(${handle1Time}, ${handle1Value / -90}, ${handle2Time}, ${handle2Value / -90})`;
      const centerAngle = orientationOffset + angle;
      const wiggleAngle = settings.pieceBounceWiggleAngle * (isPawn ? 1 : 0.5);
      const keyframes = isWiggle ? [
        { transform: `rotate(${centerAngle}deg)`, offset: 0 },
        { transform: `rotate(${centerAngle - wiggleAngle}deg)`, offset: 1 / 3 },
        { transform: `rotate(${centerAngle + wiggleAngle}deg)`, offset: 2 / 3 },
        { transform: `rotate(${centerAngle}deg)`, offset: 1 }
      ] : [
        { transform: `rotate(${centerAngle}deg)`, offset: 0, easing },
        { transform: `rotate(${centerAngle + rotation}deg)`, offset: 1 }
      ];
      const animation = piece.animate(keyframes, {
        duration: isWiggle ? settings.pieceBounceWiggleDuration : settings.pieceBounceDuration,
        fill: "forwards",
        easing: isWiggle ? easing : "linear",
        pseudoElement: "::before"
      });
      const previousAnimation = state.animation;
      state.animation = animation;
      state.angle += rotation;
      previousAnimation?.cancel();

      try {
        await animation.finished;
      } catch {
        break;
      }
      state.steps++;
      if (activePieces.get(piece) !== state || !isEnabled() || !piece.isConnected || state.finishAfterCycle || !settings.pieceBounceLoop) break;

      if (settings.pieceBounceTiming > 0) {
        await new Promise(resolve => {
          state.resumePause = resolve;
          state.pauseTimer = setTimeout(() => {
            state.pauseTimer = null;
            state.resumePause = null;
            resolve();
          }, settings.pieceBounceTiming);
        });
      }
    }
    if (state.finishAfterCycle || !settings.pieceBounceLoop) {
      state.stopped = true;
      if (state.pauseTimer) clearTimeout(state.pauseTimer);
      state.resumePause?.();
      state.animation?.cancel();
      piece.removeAttribute("data-lfs-bounce-running");
      activePieces.delete(piece);
      return;
    }
    stop(piece, state);
  }

  function start(piece) {
    if (!isEnabled() || typeof piece.animate !== "function") return;
    const currentState = activePieces.get(piece);
    if (currentState) {
      currentState.finishAfterCycle = false;
      return;
    }
    const state = { angle: 0, animation: null, pauseTimer: null, resumePause: null, stopped: false, finishAfterCycle: false, steps: 0 };
    activePieces.set(piece, state);
    piece.setAttribute("data-lfs-bounce-running", "");
    void animateWhileHovered(piece, state);
  }

  function getPiece(target) {
    return target instanceof Element ? target.closest(pieceSelector) : null;
  }

  function findPieceAtPoint(event) {
    const eventTarget = event.type === "pointerout"
      ? event.relatedTarget || document.elementFromPoint(event.clientX, event.clientY)
      : event.target;
    const eventPiece = getPiece(eventTarget);
    if (eventPiece) return eventPiece;
    const target = event.type === "pointerout"
      ? eventTarget
      : document.elementFromPoint(event.clientX, event.clientY) || event.target;
    const directPiece = getPiece(target);
    if (directPiece) return directPiece;

    if (!(target instanceof Element)) return null;
    const container = target.closest(".main-board, .mini-game");
    const board = container?.querySelector("cg-board");
    if (board) {
      const boardRect = board.getBoundingClientRect();
      const halfWidth = boardRect.width / 16;
      const halfHeight = boardRect.height / 16;
      for (const piece of board.querySelectorAll(":scope > piece.white:not(.ghost), :scope > piece.black:not(.ghost)")) {
        const rect = piece.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (Math.abs(event.clientX - centerX) <= halfWidth && Math.abs(event.clientY - centerY) <= halfHeight) {
          return piece;
        }
      }
    }

    const spare = target.closest(".board-editor .spare");
    if (spare) {
      for (const piece of spare.querySelectorAll("piece.white:not(.ghost), piece.black:not(.ghost)")) {
        const rect = piece.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
          return piece;
        }
      }
    }
    return null;
  }

  function updateHoveredPiece(event) {
    if (event.pointerType !== "mouse") return;
    const nextPiece = findPieceAtPoint(event);
    if (hoveredPiece === nextPiece) return;
    if (hoveredPiece) finishCurrentStep(hoveredPiece);
    hoveredPiece = nextPiece;
    if (hoveredPiece) start(hoveredPiece);
  }

  document.addEventListener("pointerover", updateHoveredPiece, true);
  document.addEventListener("pointermove", updateHoveredPiece, true);
  document.addEventListener("pointerout", updateHoveredPiece, true);
  window.addEventListener("blur", () => {
    if (!hoveredPiece) return;
    stop(hoveredPiece);
    hoveredPiece = null;
  });

  function update(nextSettings) {
    if (settings && settings.pieceBounceStyle !== nextSettings.pieceBounceStyle) {
      for (const [piece, state] of [...activePieces]) stop(piece, state);
    }
    settings = nextSettings;
    if (!isEnabled()) {
      for (const [piece, state] of activePieces) stop(piece, state);
      hoveredPiece = null;
      return;
    }
    if (!settings.pieceBounceLoop) {
      for (const state of activePieces.values()) {
        if (!state.pauseTimer) continue;
        clearTimeout(state.pauseTimer);
        state.pauseTimer = null;
        const resumePause = state.resumePause;
        state.resumePause = null;
        resumePause?.();
      }
    }
    for (const piece of document.querySelectorAll(pieceSelector)) {
      if (piece.matches(":hover")) start(piece);
    }
  }

  globalThis.LichessPieceBounce = { update };
})();
