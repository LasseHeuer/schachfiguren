(() => {
  const boardSelector = ".cg-wrap cg-board";
  const svgNamespace = "http://www.w3.org/2000/svg";
  const observedBoards = new Map();
  let settings = null;

  function scheduleRender(board) {
    const entry = observedBoards.get(board);
    if (!entry || entry.frame) return;
    entry.frame = requestAnimationFrame(() => {
      entry.frame = 0;
      renderBoard(board, entry);
    });
  }

  function createOverlay(board) {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.classList.add("lfs-last-move-line");
    svg.setAttribute("viewBox", "0 0 8 8");
    svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS(svgNamespace, "polygon");
    svg.append(line);
    const firstPiece = board.querySelector(":scope > piece");
    board.insertBefore(svg, firstPiece);
    return { svg, line };
  }

  function renderBoard(board, entry) {
    if (!settings?.enabled || !settings.markLastMove || !board.closest(".is2d")) {
      if (entry.svg) entry.svg.style.display = "none";
      return;
    }

    const squares = board.querySelectorAll("square.last-move");
    if (squares.length !== 2) {
      if (entry.svg) entry.svg.style.display = "none";
      return;
    }

    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) {
      if (entry.svg) entry.svg.style.display = "none";
      return;
    }

    if (!entry.svg) Object.assign(entry, createOverlay(board));
    else {
      const firstPiece = board.querySelector(":scope > piece");
      if (entry.svg.parentNode !== board || entry.svg.nextSibling !== firstPiece) {
        board.insertBefore(entry.svg, firstPiece);
      }
    }
    const [first, second] = [...squares].map(square => {
      const rect = square.getBoundingClientRect();
      return {
        x: ((rect.left + rect.width / 2 - boardRect.left) / boardRect.width) * 8,
        y: ((rect.top + rect.height / 2 - boardRect.top) / boardRect.height) * 8
      };
    });

    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) {
      entry.svg.style.display = "none";
      return;
    }
    const halfWidth = settings.lastMoveLineWidth / 200;
    const direction = { x: dx / length, y: dy / length };
    const perpendicular = { x: -direction.y * halfWidth, y: direction.x * halfWidth };
    const isDiagonal = Math.abs(dx) > 0.01 && Math.abs(dy) > 0.01;
    // Like the bishop SVG, the two edges meet at a third point without widening the line.
    const inset = isDiagonal ? Math.min(halfWidth, length / 2) : 0;
    const start = { x: first.x + direction.x * inset, y: first.y + direction.y * inset };
    const end = { x: second.x - direction.x * inset, y: second.y - direction.y * inset };
    const points = [
      ...(isDiagonal ? [first] : []),
      { x: start.x + perpendicular.x, y: start.y + perpendicular.y },
      { x: end.x + perpendicular.x, y: end.y + perpendicular.y },
      ...(isDiagonal ? [second] : []),
      { x: end.x - perpendicular.x, y: end.y - perpendicular.y },
      { x: start.x - perpendicular.x, y: start.y - perpendicular.y }
    ];
    entry.line.setAttribute("points", points.map(point => `${point.x},${point.y}`).join(" "));

    entry.svg.style.display = "block";
  }

  function observeBoard(board) {
    if (observedBoards.has(board)) return;
    const entry = { svg: null, line: null, frame: 0 };
    observedBoards.set(board, entry);

    const boardObserver = new MutationObserver(mutations => {
      // Ignore our own SVG changes to avoid triggering a continuous render loop.
      if (mutations.some(mutation => mutation.target === board || mutation.target.matches("square"))) {
        scheduleRender(board);
      }
    });
    boardObserver.observe(board, { attributes: true, attributeFilter: ["class", "style"], childList: true, subtree: true });
    entry.boardObserver = boardObserver;

    const wrapper = board.closest(".cg-wrap");
    if (wrapper) {
      const wrapperObserver = new MutationObserver(() => scheduleRender(board));
      wrapperObserver.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
      entry.wrapperObserver = wrapperObserver;
    }

    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(() => scheduleRender(board));
      resizeObserver.observe(board);
      entry.resizeObserver = resizeObserver;
    }
    scheduleRender(board);
  }

  function containsBoard(node) {
    return node.nodeType === Node.ELEMENT_NODE && (node.matches("cg-board") || Boolean(node.querySelector("cg-board")));
  }

  function containsBoardContainer(node) {
    return node.nodeType === Node.ELEMENT_NODE && (node.matches(".cg-wrap") || Boolean(node.querySelector(".cg-wrap")));
  }

  function scanBoards() {
    const boards = new Set(document.querySelectorAll(boardSelector));
    for (const board of boards) observeBoard(board);
    for (const [board, entry] of observedBoards) {
      if (boards.has(board)) continue;
      entry.boardObserver.disconnect();
      entry.wrapperObserver?.disconnect();
      entry.resizeObserver?.disconnect();
      if (entry.frame) cancelAnimationFrame(entry.frame);
      entry.svg?.remove();
      observedBoards.delete(board);
    }
  }

  const documentObserver = new MutationObserver(mutations => {
    const shouldRefresh = mutations.some(mutation => mutation.type === "attributes"
      ? containsBoardContainer(mutation.target)
      : [...mutation.addedNodes, ...mutation.removedNodes].some(containsBoard));
    if (!shouldRefresh) return;
    scanBoards();
    for (const board of observedBoards.keys()) scheduleRender(board);
  });
  documentObserver.observe(document, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
  scanBoards();

  globalThis.LichessLastMoveLine = {
    update(nextSettings) {
      settings = nextSettings;
      scanBoards();
      for (const board of observedBoards.keys()) scheduleRender(board);
    }
  };
})();
