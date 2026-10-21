(() => {
  const boardSelector = "body[data-board] .cg-wrap cg-board, .mini-game cg-board";
  const svgNamespace = "http://www.w3.org/2000/svg";
  const pieceTypes = ["pawn", "knight", "bishop", "rook", "queen", "king"];
  const pieceCodes = { pawn: "P", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" };
  const observedBoards = new Map();
  let settings = null;
  let documentObserver = null;

  document.addEventListener("lfs-hover-preview-change", event => scheduleRender(event.detail));

  function isInside(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function isBlackOrientation(board) {
    return Boolean(board.closest(".cg-wrap")?.classList.contains("orientation-black"));
  }

  function logicalToScreen(square, blackOrientation) {
    return blackOrientation
      ? { row: 7 - square.row, col: 7 - square.col }
      : square;
  }

  function getLogicalSquareAtPoint(board, x, y, blackOrientation) {
    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) return null;
    const screenCol = Math.floor(((x - boardRect.left) / boardRect.width) * 8);
    const screenRow = Math.floor(((y - boardRect.top) / boardRect.height) * 8);
    if (!isInside(screenRow, screenCol)) return null;
    return logicalToScreen({ row: screenRow, col: screenCol }, blackOrientation);
  }

  function getLogicalSquare(element, board, blackOrientation) {
    const key = (globalThis.LichessMoveAnimation?.getDestinationKey(element)
      ?? element.dataset.lfsMoveKey ?? element.dataset.key)?.toLowerCase();
    if (key && /^[a-h][1-8]$/.test(key)) {
      return { row: 8 - Number(key[1]), col: key.charCodeAt(0) - 97 };
    }
    const rect = element.getBoundingClientRect();
    return getLogicalSquareAtPoint(board, rect.left + rect.width / 2, rect.top + rect.height / 2, blackOrientation);
  }

  function readPosition(board) {
    if (!board.closest(".is2d")) return null;
    const blackOrientation = isBlackOrientation(board);
    const position = Array.from({ length: 8 }, () => Array(8).fill(""));
    const kings = [];
    let complete = true;
    const preview = globalThis.LichessThreatCoding?.getInteractionPreview(board);

    for (const element of board.querySelectorAll(":scope > piece")) {
      if (element.classList.contains("ghost") || element.classList.contains("fading")) continue;
      if (!preview && element.classList.contains("dragging")) {
        complete = false;
        continue;
      }
      const side = element.classList.contains("white") ? "w" : element.classList.contains("black") ? "b" : "";
      const type = pieceTypes.find(name => element.classList.contains(name));
      if (!side || !type) {
        complete = false;
        continue;
      }
      if (preview && type !== "king") continue;
      let square;
      if (preview) {
        const row = preview.position.findIndex(rank => rank.includes(`${side}K`));
        square = row < 0 ? null : { row, col: preview.position[row].indexOf(`${side}K`) };
      } else {
        square = getLogicalSquare(element, board, blackOrientation);
      }
      const positioned = square && isInside(square.row, square.col);
      if (type === "king") {
        kings.push({
          row: positioned ? square.row : null,
          col: positioned ? square.col : null,
          color: side,
          element
        });
      }
      if (!positioned) {
        complete = false;
        continue;
      }
      if (preview) continue;
      if (position[square.row][square.col]) {
        complete = false;
        continue;
      }
      position[square.row][square.col] = side + pieceCodes[type];
    }

    return { position: preview?.position ?? position, kings, blackOrientation, complete };
  }

  function attacksSquare(position, piece, source, target) {
    const rowDelta = target.row - source.row;
    const colDelta = target.col - source.col;
    const absRow = Math.abs(rowDelta);
    const absCol = Math.abs(colDelta);

    if (piece[1] === "P") {
      return rowDelta === (piece[0] === "w" ? -1 : 1) && absCol === 1;
    }
    if (piece[1] === "N") return (absRow === 2 && absCol === 1) || (absRow === 1 && absCol === 2);
    if (piece[1] === "K") return Math.max(absRow, absCol) === 1;

    const diagonal = absRow === absCol && absRow > 0;
    const straight = (rowDelta === 0) !== (colDelta === 0);
    if ((piece[1] === "B" && !diagonal)
      || (piece[1] === "R" && !straight)
      || (piece[1] === "Q" && !diagonal && !straight)) return false;

    const stepRow = Math.sign(rowDelta);
    const stepCol = Math.sign(colDelta);
    let row = source.row + stepRow;
    let col = source.col + stepCol;
    while (row !== target.row || col !== target.col) {
      if (position[row][col]) return false;
      row += stepRow;
      col += stepCol;
    }
    return true;
  }

  function isSquareAttacked(position, target, attackerColor) {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = position[row][col];
        if (piece?.[0] !== attackerColor) continue;
        if (attacksSquare(position, piece, { row, col }, target)) return true;
      }
    }
    return false;
  }

  function getDestinationState(position, king, target) {
    if (!isInside(target.row, target.col)) return "edge";
    const occupant = position[target.row][target.col];
    if (occupant) return "piece";

    const nextPosition = position.map(row => [...row]);
    nextPosition[king.row][king.col] = "";
    nextPosition[target.row][target.col] = `${king.color}K`;
    return isSquareAttacked(nextPosition, target, king.color === "w" ? "b" : "w") ? "threat" : "open";
  }

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(svgNamespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function createOverlay(kingElement) {
    const svg = createSvgElement("svg", { viewBox: "0 0 1 1", "aria-hidden": "true" });
    svg.classList.add("lfs-king-movement-fields");
    kingElement.setAttribute("data-lfs-king-movement-fields", "");
    kingElement.append(svg);
    return svg;
  }

  function removeOverlays(entry) {
    for (const [piece, svg] of entry.overlays) {
      svg.remove();
      piece.removeAttribute("data-lfs-king-movement-fields");
    }
    entry.overlays.clear();
  }

  function appendCell(paths, rowOffset, colOffset, state) {
    if (state === "open") return;
    const edges = [0.14, 0.38, 0.62, 0.86];
    const x = colOffset + 1;
    const y = rowOffset + 1;
    paths.push(`M${edges[x]} ${edges[y]}H${edges[x + 1]}V${edges[y + 1]}H${edges[x]}Z`);
  }

  function fillOverlay(svg, position, king, blackOrientation) {
    const paths = [];
    const orientationSign = blackOrientation ? -1 : 1;
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
      for (let colOffset = -1; colOffset <= 1; colOffset++) {
        if (!rowOffset && !colOffset) continue;
        const target = { row: king.row + rowOffset, col: king.col + colOffset };
        appendCell(paths, rowOffset * orientationSign, colOffset * orientationSign, getDestinationState(position, king, target));
      }
    }
    svg.replaceChildren();
    if (paths.length) svg.append(createSvgElement("path", {
      d: paths.join(""),
      fill: king.color === "w" ? settings.whitePieceColor : settings.blackPieceColor,
      "fill-rule": "nonzero",
      "shape-rendering": "crispEdges"
    }));
  }

  function renderPreview(group, preview) {
    group.querySelector(":scope > svg.lfs-king-preview-fields")?.remove();
    if (!settings?.enabled || !settings.kingMovementFieldsEnabled) return;
    const piece = preview.position[preview.target.row][preview.target.col];
    if (piece?.[1] !== "K") return;
    const source = logicalToScreen(preview.source, preview.blackOrientation);
    const svg = createSvgElement("svg", {
      x: source.col, y: source.row, width: 1, height: 1,
      viewBox: "0 0 1 1", "aria-hidden": "true", "pointer-events": "none"
    });
    svg.classList.add("lfs-king-preview-fields");
    fillOverlay(svg, preview.position, { ...preview.target, color: piece[0] }, preview.blackOrientation);
    group.append(svg);
  }

  function renderBoard(board, entry) {
    if (!settings?.enabled || !settings.kingMovementFieldsEnabled || !board.closest(".is2d")) {
      removeOverlays(entry);
      return;
    }
    const parsed = readPosition(board);
    if (!parsed) return;
    if (!parsed.complete) {
      removeOverlays(entry);
      return;
    }
    if (!parsed.kings.length) {
      removeOverlays(entry);
      return;
    }
    const currentKings = new Set(parsed.kings.map(king => king.element));
    for (const [piece, svg] of entry.overlays) {
      if (!parsed.complete || currentKings.has(piece)) continue;
      svg.remove();
      piece.removeAttribute("data-lfs-king-movement-fields");
      entry.overlays.delete(piece);
    }

    for (const king of parsed.kings) {
      let svg = entry.overlays.get(king.element);
      if (!svg) {
        svg = createOverlay(king.element);
        entry.overlays.set(king.element, svg);
      } else if (svg.parentNode !== king.element) {
        king.element.append(svg);
      }
      king.element.setAttribute("data-lfs-king-movement-fields", "");
      fillOverlay(svg, parsed.position, king, parsed.blackOrientation);
    }
  }

  function scheduleRender(board) {
    const entry = observedBoards.get(board);
    if (!entry || entry.frame) return;
    entry.frame = requestAnimationFrame(() => {
      entry.frame = 0;
      renderBoard(board, entry);
    });
  }

  function isRelevantMutation(mutation) {
    if (mutation.type === "attributes") {
      if (mutation.target.matches("cg-board, .cg-wrap")) return mutation.attributeName === "class";
      if (mutation.target.matches("square")) return true;
      if (!mutation.target.matches("piece")) return false;
      return !(mutation.attributeName === "style" && mutation.target.matches(".anim, .dragging"));
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      node.nodeType === Node.ELEMENT_NODE && (node.matches("piece, square") || node.querySelector("piece, square"))
    );
  }

  function observeBoards(boards) {
    const currentBoards = new Set(boards);
    for (const [board, entry] of observedBoards) {
      if (currentBoards.has(board)) continue;
      entry.observer.disconnect();
      entry.orientationObserver?.disconnect();
      entry.resizeObserver?.disconnect();
      if (entry.frame) cancelAnimationFrame(entry.frame);
      removeOverlays(entry);
      observedBoards.delete(board);
    }

    for (const board of boards) {
      if (observedBoards.has(board)) continue;
      const entry = { overlays: new Map(), frame: 0, observer: null, orientationObserver: null, resizeObserver: null };
      entry.observer = new MutationObserver(mutations => {
        if (mutations.some(isRelevantMutation)) scheduleRender(board);
      });
      entry.observer.observe(board, {
        attributes: true,
        attributeFilter: ["class", "data-key", "data-lfs-move-key", "style"],
        childList: true,
        subtree: true
      });

      const wrapper = board.closest(".cg-wrap");
      if (wrapper) {
        entry.orientationObserver = new MutationObserver(() => scheduleRender(board));
        entry.orientationObserver.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
      }
      if (typeof ResizeObserver !== "undefined") {
        entry.resizeObserver = new ResizeObserver(() => scheduleRender(board));
        entry.resizeObserver.observe(board);
      }
      observedBoards.set(board, entry);
      scheduleRender(board);
    }
  }

  function initialize() {
    observeBoards([...document.querySelectorAll(boardSelector)]);
    if (!documentObserver) {
      documentObserver = new MutationObserver(mutations => {
        const boardChanged = mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
          node.nodeType === Node.ELEMENT_NODE && (node.matches("cg-board") || node.querySelector("cg-board"))
        ));
        if (boardChanged) observeBoards([...document.querySelectorAll(boardSelector)]);
      });
      documentObserver.observe(document, { childList: true, subtree: true });
    }
    for (const board of observedBoards.keys()) scheduleRender(board);
  }

  function update(nextSettings) {
    settings = nextSettings;
    initialize();
  }

  globalThis.LichessKingMovementFields = { update, renderPreview };
})();
