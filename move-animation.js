(() => {
  // Lichess (chessground) moves pieces frame by frame in JavaScript, so CSS transitions cannot change the curve or duration.
  // Here the moving piece is animated with the Web Animations API from its start to its target square.
  const moves = new WeakMap();
  const activeAnimations = new Set();
  let settings = null;
  let lichessDuration = 250;

  function easing() {
    return `cubic-bezier(${settings.moveAnimationCurve.map((value, index) => (index % 2 ? value / -90 : value)).join(", ")})`;
  }

  function findDestination(board, piece) {
    const key = (piece.getAttribute("data-lfs-move-key") ?? piece.dataset.key ?? piece.cgKey)?.toLowerCase();
    if (!key || !/^[a-h][1-8]$/.test(key)) return null;

    const blackOrientation = board.closest(".cg-wrap")?.classList.contains("orientation-black") ?? false;
    const logicalRow = 8 - Number(key[1]);
    const logicalCol = key.charCodeAt(0) - 97;
    const targetRow = blackOrientation ? 7 - logicalRow : logicalRow;
    const targetCol = blackOrientation ? 7 - logicalCol : logicalCol;
    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) return null;

    for (const square of board.querySelectorAll(":scope > square")) {
      const style = getComputedStyle(square);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = square.getBoundingClientRect();
      const row = Math.floor(((rect.top + rect.height / 2 - boardRect.top) / boardRect.height) * 8);
      const col = Math.floor(((rect.left + rect.width / 2 - boardRect.left) / boardRect.width) * 8);
      if (row !== targetRow || col !== targetCol) continue;
      return { transform: square.style.transform || style.transform, left: rect.left, top: rect.top };
    }

    return {
      transform: `translate(${targetCol * 100}%, ${targetRow * 100}%)`,
      left: boardRect.left + targetCol * boardRect.width / 8,
      top: boardRect.top + targetRow * boardRect.height / 8
    };
  }

  function startMove(piece, restart = false) {
    const board = piece.closest("cg-board");
    if (!board) return;
    const destination = findDestination(board, piece);
    const previous = moves.get(piece);
    if (!destination) {
      if (previous) cancelMove(piece, previous);
      return;
    }
    if (!restart && previous?.destination === destination.transform) return;

    const origin = getComputedStyle(piece).transform;
    const state = { start: performance.now(), animation: null, destination: destination.transform, ended: false };
    moves.set(piece, state);

    const pieceRect = piece.getBoundingClientRect();
    const alreadyAtDestination = Math.abs(pieceRect.left - destination.left) < 0.5
      && Math.abs(pieceRect.top - destination.top) < 0.5;
    if (settings?.enabled && !settings.disableAnimations && typeof piece.animate === "function"
      && !alreadyAtDestination) {
      const duration = settings.moveAnimationLichessSpeed ? lichessDuration : settings.moveAnimationDuration;
      if (duration > 0) {
        const animation = piece.animate([{ transform: origin }, { transform: destination.transform }], {
          duration,
          easing: easing(),
          fill: "forwards"
        });
        state.animation = animation;
        activeAnimations.add(animation);
        animation.finished.then(() => {
          if (moves.get(piece) !== state || !state.ended) return;
          activeAnimations.delete(animation);
          animation.cancel();
          moves.delete(piece);
        }, error => {
          activeAnimations.delete(animation);
          if (moves.get(piece) === state) moves.delete(piece);
          if (error?.name !== "AbortError") console.error(error);
        });
      }
    }

    if (previous) cancelMove(piece, previous);
  }

  function endMove(piece) {
    const state = moves.get(piece);
    if (!state || state.ended) return;
    state.ended = true;
    lichessDuration = Math.min(1500, Math.max(100, Math.round(performance.now() - state.start)));

    const animation = state.animation;
    if (!animation || animation.playState === "finished") {
      animation?.cancel();
      if (animation) activeAnimations.delete(animation);
      moves.delete(piece);
    }
  }

  function cancelMove(piece, state) {
    state.animation?.cancel();
    if (state.animation) activeAnimations.delete(state.animation);
    if (moves.get(piece) === state) moves.delete(piece);
  }

  function hasAnimationClass(value) {
    return (` ${value ?? ""} `).includes(" anim ");
  }

  new MutationObserver(records => {
    const changes = new Map();
    for (const record of records) {
      const piece = record.target;
      if (piece.localName !== "piece" || !piece.parentElement || piece.parentElement.localName !== "cg-board") continue;
      if (!changes.has(piece)) changes.set(piece, []);
      changes.get(piece).push(record);
    }

    for (const [piece, pieceRecords] of changes) {
      const classRecords = pieceRecords.filter(record => record.attributeName === "class");
      let animationClassChanged = false;
      if (classRecords.length) {
        let previous = hasAnimationClass(classRecords[0].oldValue);
        for (let index = 0; index < classRecords.length; index++) {
          const next = index + 1 < classRecords.length
            ? hasAnimationClass(classRecords[index + 1].oldValue)
            : piece.classList.contains("anim");
          if (previous !== next) animationClassChanged = true;
          previous = next;
        }
      }

      if (piece.classList.contains("anim")) startMove(piece, animationClassChanged);
      else endMove(piece);
    }
  }).observe(document, {
    attributes: true,
    attributeFilter: ["class", "data-key", "data-lfs-move-key"],
    attributeOldValue: true,
    subtree: true
  });

  function update(nextSettings) {
    settings = nextSettings;
    if (!settings.enabled || settings.disableAnimations) {
      for (const animation of activeAnimations) {
        const piece = animation.effect?.target;
        const state = piece && moves.get(piece);
        if (state?.animation === animation) moves.delete(piece);
        animation.cancel();
      }
      activeAnimations.clear();
    }
  }

  globalThis.LichessMoveAnimation = { update };
})();
