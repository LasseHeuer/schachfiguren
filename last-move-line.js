(() => {
  const boardSelector = "cg-board";
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

  function renderBoard(board, entry) {
    const render = globalThis.LichessSelectedPieceWedge?.renderLastMoveOutline;
    if (render) render(board, entry);
    else {
      entry.lastMoveOutlineSvg?.remove();
      entry.lastMoveOutlineSvg = null;
    }
  }

  function observeBoard(board) {
    if (observedBoards.has(board)) return;
    const entry = { lastMoveOutlineSvg: null, frame: 0 };
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

  function scanBoards() {
    const boards = new Set(document.querySelectorAll(boardSelector));
    for (const board of boards) observeBoard(board);
    for (const [board, entry] of observedBoards) {
      if (boards.has(board)) continue;
      entry.boardObserver.disconnect();
      entry.wrapperObserver?.disconnect();
      entry.resizeObserver?.disconnect();
      if (entry.frame) cancelAnimationFrame(entry.frame);
      entry.lastMoveOutlineSvg?.remove();
      observedBoards.delete(board);
    }
  }

  const documentObserver = new MutationObserver(mutations => {
    const shouldRefresh = mutations.some(mutation => mutation.type === "attributes"
      ? containsBoard(mutation.target)
      : [...mutation.addedNodes, ...mutation.removedNodes].some(containsBoard));
    if (!shouldRefresh) return;
    scanBoards();
    for (const board of observedBoards.keys()) scheduleRender(board);
  });
  documentObserver.observe(document, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
  scanBoards();

  globalThis.LichessLastMoveLine = {
    createPreviewLine(uci, blackOrientation, board, color) {
      if (!settings?.enabled || !settings.markLastMove) return null;
      return globalThis.LichessSelectedPieceWedge?.createLastMovePreview(board, uci, blackOrientation, color) ?? null;
    },
    update(nextSettings) {
      settings = nextSettings;
      scanBoards();
      for (const board of observedBoards.keys()) scheduleRender(board);
    }
  };
})();
