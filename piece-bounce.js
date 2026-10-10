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

  async function animateWhileHovered(piece, state) {
    while (activePieces.get(piece) === state && isEnabled() && piece.isConnected) {
      const angle = state.angle;
      const animation = piece.animate([
        { transform: `rotate(${angle}deg)`, offset: 0 },
        { transform: `rotate(${angle}deg)`, offset: 0.07 },
        { transform: `rotate(${angle - 9}deg)`, offset: 0.16, easing: "cubic-bezier(.2,.8,.3,1)" },
        { transform: `rotate(${angle - 9}deg)`, offset: 0.22 },
        { transform: `rotate(${angle + 102}deg)`, offset: 0.48, easing: "cubic-bezier(.65,0,.35,1)" },
        { transform: `rotate(${angle + 90}deg)`, offset: 0.58, easing: "cubic-bezier(.2,.8,.3,1)" },
        { transform: `rotate(${angle + 94}deg)`, offset: 0.66 },
        { transform: `rotate(${angle + 90}deg)`, offset: 0.74 },
        { transform: `rotate(${angle + 90}deg)`, offset: 1 }
      ], { duration: settings.pieceBounceDuration, fill: "forwards", easing: "linear", pseudoElement: "::before" });
      const previousAnimation = state.animation;
      state.animation = animation;
      state.angle += 90;
      previousAnimation?.cancel();

      try {
        await animation.finished;
      } catch {
        break;
      }
      if (activePieces.get(piece) !== state || !isEnabled() || !piece.isConnected) break;

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
    if (!isEnabled() || activePieces.has(piece) || typeof piece.animate !== "function") return;
    const state = { angle: 0, animation: null, pauseTimer: null, resumePause: null, stopped: false };
    activePieces.set(piece, state);
    piece.setAttribute("data-lfs-bounce-running", "");
    void animateWhileHovered(piece, state);
  }

  function getPiece(target) {
    return target instanceof Element ? target.closest(pieceSelector) : null;
  }

  function findPieceAtPoint(event) {
    const eventPiece = getPiece(event.target);
    if (eventPiece) return eventPiece;
    const target = document.elementFromPoint(event.clientX, event.clientY) || event.target;
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
    if (hoveredPiece) stop(hoveredPiece);
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
    settings = nextSettings;
    if (!isEnabled()) {
      for (const [piece, state] of activePieces) stop(piece, state);
      hoveredPiece = null;
      return;
    }
    for (const piece of document.querySelectorAll(pieceSelector)) {
      if (piece.matches(":hover")) start(piece);
    }
  }

  globalThis.LichessPieceBounce = { update };
})();
