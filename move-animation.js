(() => {
  // Lichess (chessground) moves pieces frame by frame in JavaScript, so CSS transitions cannot change the curve or duration.
  // Here the moving piece is animated with the Web Animations API from its start to its target square.
  const moves = new WeakMap();
  const activeAnimations = new Set();
  const confirmedPreviews = new WeakMap();
  let settings = null;
  let lichessDuration = 250;

  document.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !settings?.enabled) return;
    const board = event.target?.closest?.("cg-board");
    if (!board) return;
    confirmedPreviews.delete(board);
    const previewSvg = board.querySelector(":scope > svg.lfs-move-preview-piece");
    if (!previewSvg) return;
    const preview = globalThis.LichessThreatCoding?.getInteractionPreview(board, event.clientX, event.clientY);
    if (!preview?.isHoverPreview || !preview.legal
      || (preview.source.row === preview.target.row && preview.source.col === preview.target.col)) return;
    if (previewSvg.getAttribute("data-lfs-preview-target") !== `${preview.target.row},${preview.target.col}`) return;
    const rect = board.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const screenRow = Math.floor((event.clientY - rect.top) * 8 / rect.height);
    const screenCol = Math.floor((event.clientX - rect.left) * 8 / rect.width);
    const row = preview.blackOrientation ? 7 - screenRow : screenRow;
    const col = preview.blackOrientation ? 7 - screenCol : screenCol;
    if (row !== preview.target.row || col !== preview.target.col) return;
    const targets = new Map();
    for (let targetRow = 0; targetRow < 8; targetRow++) {
      for (let targetCol = 0; targetCol < 8; targetCol++) {
        const piece = preview.position[targetRow][targetCol];
        if (!piece || piece === preview.basePosition[targetRow][targetCol]) continue;
        targets.set(`${String.fromCharCode(97 + targetCol)}${8 - targetRow}`, piece);
      }
    }
    confirmedPreviews.set(board, { targets, time: performance.now() });
  }, true);

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
      return {
        key,
        transform: square.style.transform || style.transform,
        left: rect.left,
        top: rect.top,
        squareWidth: rect.width,
        squareHeight: rect.height
      };
    }

    return {
      key,
      transform: `translate(${targetCol * 100}%, ${targetRow * 100}%)`,
      left: boardRect.left + targetCol * boardRect.width / 8,
      top: boardRect.top + targetRow * boardRect.height / 8,
      squareWidth: boardRect.width / 8,
      squareHeight: boardRect.height / 8
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
    const confirmed = confirmedPreviews.get(board);
    const code = confirmed?.targets.get(destination.key);
    const names = { P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king" };
    const instant = (previous?.instant && previous.destination === destination.transform)
      || Boolean(code && performance.now() - confirmed.time < 1000
        && piece.classList.contains(code[0] === "w" ? "white" : "black")
        && piece.classList.contains(names[code[1]]));
    if (instant && confirmed) confirmed.targets.delete(destination.key);
    const state = { start: performance.now(), animation: null, destination: destination.transform, key: destination.key, ended: false, instant };
    moves.set(piece, state);

    const pieceRect = piece.getBoundingClientRect();
    const alreadyAtDestination = Math.abs(pieceRect.left - destination.left) < 0.5
      && Math.abs(pieceRect.top - destination.top) < 0.5;
    if (settings?.enabled && !settings.disableAnimations && typeof piece.animate === "function"
      && (instant || !alreadyAtDestination)) {
      const distance = settings.moveAnimationTimeDistance
        ? Math.hypot(
          (destination.left - pieceRect.left) / destination.squareWidth,
          (destination.top - pieceRect.top) / destination.squareHeight
        )
        : 1;
      const baseDuration = settings.moveAnimationLichessSpeed ? lichessDuration : settings.moveAnimationDuration;
      const distanceFactor = settings.moveAnimationTimeDistance ? settings.moveAnimationDistanceFactor : 0;
      const duration = instant ? 0 : baseDuration + distance * distanceFactor * baseDuration;
      if (duration > 0 || instant) {
        const animation = piece.animate([{ transform: instant ? destination.transform : origin }, { transform: destination.transform }], {
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
          notifyMoveChange(piece);
        }, error => {
          activeAnimations.delete(animation);
          if (moves.get(piece) === state) moves.delete(piece);
          notifyMoveChange(piece);
          if (error?.name !== "AbortError") console.error(error);
        });
      }
    }

    if (previous) cancelMove(piece, previous);
    notifyMoveChange(piece);
  }

  function notifyMoveChange(piece) {
    const board = piece.closest("cg-board");
    if (board) document.dispatchEvent(new CustomEvent("lfs-hover-preview-change", { detail: board }));
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
    notifyMoveChange(piece);
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
        if (piece) notifyMoveChange(piece);
      }
      activeAnimations.clear();
    }
  }

  globalThis.LichessMoveAnimation = {
    update,
    getDestinationKey: piece => moves.get(piece)?.key ?? null,
    isInstantMove: piece => Boolean(moves.get(piece)?.instant && moves.get(piece)?.animation)
  };
})();
