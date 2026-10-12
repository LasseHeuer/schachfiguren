(() => {
  const pieceSelector = [
    ".main-board cg-board piece.white:not(.ghost):not(.dragging):not(.anim)",
    ".main-board cg-board piece.black:not(.ghost):not(.dragging):not(.anim)",
    ".mini-game cg-board piece.white:not(.ghost):not(.dragging):not(.anim)",
    ".mini-game cg-board piece.black:not(.ghost):not(.dragging):not(.anim)",
    ".board-editor .spare piece.white:not(.ghost)",
    ".board-editor .spare piece.black:not(.ghost)",
    ".pocket piece.white:not(.ghost)",
    ".pocket piece.black:not(.ghost)"
  ].join(", ");
  const activePieces = new Map();
  let settings = null;
  let hoveredPiece = null;

  function isEnabled() {
    return settings?.enabled && settings.pieceBounceEnabled && !settings.disableAnimations;
  }

  // Ends a running pause early and resumes the loop without waiting for the timer.
  function endPause(state) {
    if (!state.pauseTimer) return;
    clearTimeout(state.pauseTimer);
    state.pauseTimer = null;
    const resumePause = state.resumePause;
    state.resumePause = null;
    resumePause?.();
  }

  function stop(piece, state = activePieces.get(piece)) {
    if (!state || state.stopped) return;
    state.stopped = true;
    endPause(state);
    state.animation?.cancel();
    piece.removeAttribute("data-lfs-bounce-running");
    activePieces.delete(piece);
  }

  function getOrientationOffset(piece) {
    const orientation = piece.closest(".cg-wrap")?.classList;
    return (
      (orientation?.contains("orientation-white") && piece.classList.contains("black")) ||
      (orientation?.contains("orientation-black") && piece.classList.contains("white"))
    ) ? 180 : 0;
  }

  async function returnToBase(piece, state) {
    if (!state.angle || !piece.isConnected) return true;
    const angle = Math.round((state.angle % 360) / 360) * 360;
    const currentTransform = getComputedStyle(piece, "::before").transform;
    const targetTransform = `rotate(${getOrientationOffset(piece) + angle}deg)`;
    const animation = piece.animate([
      { transform: currentTransform },
      { transform: targetTransform }
    ], {
      duration: Math.max(80, Math.min(180, settings.pieceBounceDuration * 0.2)),
      easing: "ease-out",
      fill: "forwards",
      pseudoElement: "::before"
    });
    const previousAnimation = state.animation;
    state.animation = animation;
    previousAnimation?.cancel();

    try {
      await animation.finished;
    } catch (error) {
      if (error?.name !== "AbortError") console.error(error);
      return false;
    }

    if (activePieces.get(piece) !== state) return false;
    state.angle = 0;
    animation.cancel();
    return true;
  }

  function finishCurrentStep(piece) {
    const state = activePieces.get(piece);
    if (!state) return;
    state.finishAfterCycle = true;
    endPause(state);
  }

  async function animateWhileHovered(piece, state) {
    while (activePieces.get(piece) === state && isEnabled() && piece.isConnected) {
      if (state.finishAfterCycle || (!settings.pieceBounceLoop && state.steps > 0)) {
        const returned = await returnToBase(piece, state);
        if (!returned || activePieces.get(piece) !== state || !isEnabled() || !piece.isConnected) break;
        if (state.finishAfterCycle || !settings.pieceBounceLoop) break;
        continue;
      }

      const angle = state.angle;
      const isPawn = piece.classList.contains("pawn");
      const isWiggle = isPawn || settings.pieceBounceStyle === "wiggle-only";
      const rotation = isWiggle ? 0 : 90;
      const orientationOffset = getOrientationOffset(piece);
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
      state.angle = (state.angle + rotation) % 360;
      previousAnimation?.cancel();

      try {
        await animation.finished;
      } catch (error) {
        if (error?.name !== "AbortError") console.error(error);
        break;
      }
      state.steps++;
      if (activePieces.get(piece) !== state || !isEnabled() || !piece.isConnected) break;
      if (state.finishAfterCycle || !settings.pieceBounceLoop) continue;

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
    stop(piece, state);
  }

  function start(piece) {
    if (!isEnabled() || typeof piece.animate !== "function" || piece.matches(".dragging, .anim")) return;
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
      for (const piece of board.querySelectorAll(":scope > piece.white:not(.ghost):not(.dragging):not(.anim), :scope > piece.black:not(.ghost):not(.dragging):not(.anim)")) {
        const rect = piece.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (Math.abs(event.clientX - centerX) <= halfWidth && Math.abs(event.clientY - centerY) <= halfHeight) {
          return piece;
        }
      }
    }

    const pieceTray = target.closest(".board-editor .spare, .pocket");
    if (pieceTray) {
      for (const piece of pieceTray.querySelectorAll("piece.white:not(.ghost), piece.black:not(.ghost)")) {
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
  new MutationObserver(records => {
    for (const record of records) {
      const piece = record.target;
      if (piece.localName !== "piece" || !piece.matches(".dragging, .anim")) continue;
      finishCurrentStep(piece);
      if (hoveredPiece === piece) hoveredPiece = null;
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"], subtree: true });
  window.addEventListener("blur", () => {
    if (!hoveredPiece) return;
    finishCurrentStep(hoveredPiece);
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
      for (const state of activePieces.values()) endPause(state);
    }
    for (const piece of document.querySelectorAll(pieceSelector)) {
      if (piece.matches(":hover")) start(piece);
    }
  }

  globalThis.LichessPieceBounce = { update };
})();
