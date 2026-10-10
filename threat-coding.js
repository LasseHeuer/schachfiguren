(() => {
  const directions = {
    N: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]],
    K: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
    R: [[-1, 0], [1, 0], [0, -1], [0, 1]],
    B: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    Q: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
  };

  let settings = null;
  let observedBoard = null;
  let boardObserver = null;
  let orientationObserver = null;
  let documentObserver = null;
  let themeObserver = null;
  let renderFrame = 0;
  let pieceInteractionActive = false;
  let activePieceDrag = null;
  let lastPointerPosition = null;
  let interactionListenersAdded = false;

  function isInside(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function getDirections(piece) {
    const type = piece[1];
    if (type === "P") return piece[0] === "w" ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    return directions[type] || [];
  }

  function getInitialMoves(row, col, piece, board) {
    const type = piece[1];
    const moves = [];
    const vectors = getDirections(piece);

    if (type === "N" || type === "K" || type === "P") {
      for (const [dr, dc] of vectors) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (isInside(nextRow, nextCol)) moves.push([nextRow, nextCol]);
      }
      return moves;
    }

    for (const [dr, dc] of vectors) {
      let nextRow = row + dr;
      let nextCol = col + dc;
      while (isInside(nextRow, nextCol)) {
        moves.push([nextRow, nextCol]);
        if (board[nextRow][nextCol]) break;
        nextRow += dr;
        nextCol += dc;
      }
    }
    return moves;
  }

  function getNextMoves(row, col, piece, board) {
    const type = piece[1];
    const moves = [];
    const vectors = getDirections(piece);

    if (type === "P") {
      const nextRow = row + (piece[0] === "w" ? -1 : 1);
      if (isInside(nextRow, col) && !board[nextRow][col]) moves.push([nextRow, col]);
      return moves;
    }

    if (type === "N" || type === "K") {
      for (const [dr, dc] of vectors) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (isInside(nextRow, nextCol)) moves.push([nextRow, nextCol]);
      }
      return moves;
    }

    for (const [dr, dc] of vectors) {
      let nextRow = row + dr;
      let nextCol = col + dc;
      while (isInside(nextRow, nextCol)) {
        moves.push([nextRow, nextCol]);
        if (board[nextRow][nextCol]) break;
        nextRow += dr;
        nextCol += dc;
      }
    }
    return moves;
  }

  function calculateThreatMap(board, options) {
    const result = Array.from({ length: 8 }, () => Array(8).fill(0));
    const maxDepth = Math.max(1, Math.min(5, Math.round(Number(options.threatMoveDepth) || 1)));
    const depthFactor = Math.max(0, Math.min(1, Number(options.threatDepthFactor) || 0));
    const ownSeeThrough = Math.max(0, Math.min(1, Number(options.threatOwnSeeThrough) || 0));
    const opponentSeeThrough = Math.max(0, Math.min(1, Number(options.threatOpponentSeeThrough) || 0));

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (!piece) continue;

        const sign = piece[0] === "w" ? 1 : -1;
        const pieceThreats = Array.from({ length: 8 }, () => Array(8).fill(0));
        const visited = Array.from({ length: 8 }, () => Array(8).fill(null));
        const queue = [];

        for (const [nextRow, nextCol] of getInitialMoves(row, col, piece, board)) {
          if (visited[nextRow][nextCol] !== null) continue;
          visited[nextRow][nextCol] = 1;
          pieceThreats[nextRow][nextCol] += sign;
          queue.push([nextRow, nextCol, 1]);
        }

        for (let head = 0; head < queue.length; head++) {
          const [fromRow, fromCol, depth] = queue[head];
          if (depth >= maxDepth) continue;
          const strength = Math.pow(depthFactor, depth) * sign;
          for (const [nextRow, nextCol] of getNextMoves(fromRow, fromCol, piece, board)) {
            if (visited[nextRow][nextCol] !== null && visited[nextRow][nextCol] <= depth + 1) continue;
            visited[nextRow][nextCol] = depth + 1;
            pieceThreats[nextRow][nextCol] += strength;
            queue.push([nextRow, nextCol, depth + 1]);
          }
        }

        if (!["B", "R", "Q"].includes(piece[1])) continue;
        for (const [dr, dc] of getDirections(piece)) {
          let nextRow = row + dr;
          let nextCol = col + dc;
          let blocked = false;
          let throughFactor = 1;
          let cumulativeFactor = 1;
          while (isInside(nextRow, nextCol)) {
            const occupant = board[nextRow][nextCol];
            if (blocked) {
              cumulativeFactor *= throughFactor;
              if (cumulativeFactor === 0) break;
              const strength = pieceThreats[nextRow][nextCol] + (sign * cumulativeFactor);
              pieceThreats[nextRow][nextCol] = Math.max(-1, Math.min(1, strength));
            }
            if (occupant) {
              blocked = true;
              throughFactor = occupant[0] === piece[0] ? ownSeeThrough : opponentSeeThrough;
              cumulativeFactor *= throughFactor;
            }
            nextRow += dr;
            nextCol += dc;
          }
        }

        for (let targetRow = 0; targetRow < 8; targetRow++) {
          for (let targetCol = 0; targetCol < 8; targetCol++) {
            result[targetRow][targetCol] += pieceThreats[targetRow][targetCol];
          }
        }
      }
    }

    for (const row of result) {
      for (let col = 0; col < row.length; col++) row[col] = Math.max(-5, Math.min(5, row[col]));
    }
    return result;
  }

  function parseHexColor(hex) {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : [255, 255, 255];
  }

  function toRgbString(rgb) {
    return `rgb(${rgb.map(channel => Math.round(channel)).join(", ")})`;
  }

  function getBoardBaseColor(row, col, options) {
    const lightTheme = document.documentElement.classList.contains("light");
    const lightSquareColor = parseHexColor(lightTheme ? options.boardLightLight : options.boardLightDark);
    if (options.monochromeBoard) return lightSquareColor;
    const darkSquareColor = parseHexColor(lightTheme ? options.boardDarkLight : options.boardDarkDark);
    return (row + col) % 2 === 0 ? lightSquareColor : darkSquareColor;
  }

  function getOpacityColor(value, options, baseColor) {
    const normalized = Math.max(-5, Math.min(5, Number(value) || 0));
    const base = Array.isArray(baseColor) ? baseColor : parseHexColor(baseColor);
    if (normalized === 0) return toRgbString(base);
    const tint = parseHexColor(normalized > 0 ? options.whitePieceColor : options.blackPieceColor);
    const maxMix = Math.max(0, Math.min(100, Number(options.threatMaxMixPercent) || 0)) / 100;
    const amount = Math.min(Math.abs(normalized) / 5, 1) * maxMix;
    return toRgbString(base.map((channel, index) => channel + ((tint[index] - channel) * amount)));
  }

  function isBlackOrientation(board) {
    return Boolean(board.closest(".cg-wrap")?.classList.contains("orientation-black"));
  }

  function getLogicalSquare(element, board, blackOrientation) {
    const key = element.dataset.key?.toLowerCase();
    if (key && /^[a-h][1-8]$/.test(key)) {
      return { row: 8 - Number(key[1]), col: key.charCodeAt(0) - 97 };
    }

    const rect = element.getBoundingClientRect();
    return getLogicalSquareAtPoint(board, rect.left + rect.width / 2, rect.top + rect.height / 2, blackOrientation);
  }

  function getLogicalSquareAtPoint(board, x, y, blackOrientation) {
    const boardRect = board.getBoundingClientRect();
    if (boardRect.width <= 0 || boardRect.height <= 0) return null;
    const relativeX = x - boardRect.left;
    const relativeY = y - boardRect.top;
    if (relativeX < 0 || relativeX >= boardRect.width || relativeY < 0 || relativeY >= boardRect.height) return null;
    const screenCol = Math.floor((relativeX / boardRect.width) * 8);
    const screenRow = Math.floor((relativeY / boardRect.height) * 8);
    return blackOrientation
      ? { row: 7 - screenRow, col: 7 - screenCol }
      : { row: screenRow, col: screenCol };
  }

  function createPreviewPosition(position, source, target) {
    const preview = position.map(row => [...row]);
    if (source.row === target.row && source.col === target.col) return preview;
    const piece = preview[source.row][source.col];
    if (!piece) return null;

    if (piece[1] === "P" && source.col !== target.col && !preview[target.row][target.col]) {
      const capturedRow = target.row + (piece[0] === "w" ? 1 : -1);
      if (preview[capturedRow]?.[target.col]?.[0] !== piece[0] && preview[capturedRow]?.[target.col]?.[1] === "P") {
        preview[capturedRow][target.col] = "";
      }
    }

    preview[source.row][source.col] = "";
    preview[target.row][target.col] = piece;

    if (piece[1] === "K" && source.row === target.row && Math.abs(target.col - source.col) === 2) {
      const rookSourceCol = target.col > source.col ? 7 : 0;
      const rookTargetCol = target.col > source.col ? target.col - 1 : target.col + 1;
      if (preview[source.row][rookSourceCol] === `${piece[0]}R`) {
        preview[source.row][rookSourceCol] = "";
        preview[source.row][rookTargetCol] = `${piece[0]}R`;
      }
    }

    return preview;
  }

  function getAllowedDestinations(board, blackOrientation) {
    const destinations = new Set();
    for (const square of board.querySelectorAll(":scope > square.move-dest, :scope > square.premove-dest")) {
      const destination = getLogicalSquare(square, board, blackOrientation);
      if (destination) destinations.add(`${destination.row},${destination.col}`);
    }
    return destinations;
  }

  function getAllowedMovePreview(board, position, source, x, y, blackOrientation) {
    const target = getLogicalSquareAtPoint(board, x, y, blackOrientation);
    if (!target) return null;
    const allowed = getAllowedDestinations(board, blackOrientation);
    if (!allowed.has(`${target.row},${target.col}`)) return null;
    return createPreviewPosition(position, source, target);
  }

  function readBoard(board) {
    if (!board.closest(".is2d")) return null;
    const blackOrientation = isBlackOrientation(board);
    const position = Array.from({ length: 8 }, () => Array(8).fill(""));
    let pieceCount = 0;

    for (const element of board.querySelectorAll(":scope > piece")) {
      if (element.classList.contains("ghost")) continue;
      const side = element.classList.contains("white") ? "w" : element.classList.contains("black") ? "b" : "";
      const type = ["pawn", "knight", "bishop", "rook", "queen", "king"].find(name => element.classList.contains(name));
      const square = getLogicalSquare(element, board, blackOrientation);
      if (!side || !type || !square || !isInside(square.row, square.col) || position[square.row][square.col]) return null;
      const pieceCode = { pawn: "P", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" }[type];
      position[square.row][square.col] = side + pieceCode;
      pieceCount++;
    }

    return pieceCount ? { position, blackOrientation } : null;
  }

  function clearThreatBackground(board) {
    if (!board) return;
    board.removeAttribute("data-lfs-threat-board");
    board.style.removeProperty("--lfs-threat-background");
    board.style.removeProperty("--lfs-threat-background-position");
  }

  function renderPosition(board, position, blackOrientation) {
    const threatMap = calculateThreatMap(position, settings);
    const backgroundLayers = [];
    const backgroundPositions = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const screenRow = blackOrientation ? 7 - row : row;
        const screenCol = blackOrientation ? 7 - col : col;
        const baseColor = getBoardBaseColor(row, col, settings);
        const color = getOpacityColor(threatMap[row][col], settings, baseColor);
        const positionX = ((screenCol / 7) * 100).toFixed(6);
        const positionY = ((screenRow / 7) * 100).toFixed(6);
        backgroundLayers.push(`linear-gradient(${color}, ${color})`);
        backgroundPositions.push(`${positionX}% ${positionY}%`);
      }
    }
    board.style.setProperty("--lfs-threat-background", backgroundLayers.join(", "));
    board.style.setProperty("--lfs-threat-background-position", backgroundPositions.join(", "));
    board.setAttribute("data-lfs-threat-board", "");
  }

  function getDragPreview(board) {
    if (!activePieceDrag || activePieceDrag.board !== board) return null;
    const blackOrientation = isBlackOrientation(board);
    const position = getAllowedMovePreview(
      board,
      activePieceDrag.position,
      activePieceDrag.source,
      activePieceDrag.clientX,
      activePieceDrag.clientY,
      blackOrientation
    );
    return { position: position || activePieceDrag.position, blackOrientation };
  }

  function getSelectedMovePreview(board, position, blackOrientation) {
    if (!lastPointerPosition) return null;
    const selectedSquare = board.querySelector(":scope > square.selected");
    if (!selectedSquare) return null;
    const source = getLogicalSquare(selectedSquare, board, blackOrientation);
    if (!source || !position[source.row][source.col]) return null;
    return getAllowedMovePreview(
      board,
      position,
      source,
      lastPointerPosition.x,
      lastPointerPosition.y,
      blackOrientation
    );
  }

  function render() {
    renderFrame = 0;
    const board = document.querySelector(".main-board cg-board");
    if (board !== observedBoard) observeBoard(board);
    if (!board || !settings?.enabled || !settings.threatColoringEnabled) {
      clearThreatBackground(board || observedBoard);
      return;
    }
    if (!board.closest(".is2d")) {
      clearThreatBackground(board);
      return;
    }
    if (pieceInteractionActive) {
      const preview = getDragPreview(board);
      if (preview) renderPosition(board, preview.position, preview.blackOrientation);
      return;
    }

    const parsed = readBoard(board);
    if (!parsed) return;
    const preview = getSelectedMovePreview(board, parsed.position, parsed.blackOrientation);
    renderPosition(board, preview || parsed.position, parsed.blackOrientation);
  }

  function scheduleRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(render);
  }

  function containsMainBoard(node) {
    return node.nodeType === Node.ELEMENT_NODE && (
      node.matches(".main-board, .cg-wrap, cg-board") ||
      Boolean(node.querySelector(".main-board, cg-board"))
    );
  }

  function isRelevantBoardMutation(mutation) {
    if (mutation.type === "attributes") {
      const target = mutation.target;
      if (target.matches("cg-board, .cg-wrap")) return mutation.attributeName === "class";
      return target.matches("piece, square");
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      node.nodeType === Node.ELEMENT_NODE && (
        node.matches("piece, square.move-dest, square.premove-dest") ||
        node.querySelector("piece, square.move-dest, square.premove-dest")
      )
    );
  }

  function observeBoard(board) {
    const previousBoard = observedBoard;
    boardObserver?.disconnect();
    orientationObserver?.disconnect();
    observedBoard = board || null;
    if (previousBoard && previousBoard !== observedBoard) clearThreatBackground(previousBoard);
    if (!board) return;

    boardObserver = new MutationObserver(mutations => {
      if (mutations.some(isRelevantBoardMutation)) scheduleRender();
    });
    boardObserver.observe(board, {
      attributes: true,
      attributeFilter: ["class", "data-key", "style"],
      childList: true,
      subtree: true
    });

    const wrapper = board.closest(".cg-wrap");
    if (wrapper) {
      orientationObserver = new MutationObserver(scheduleRender);
      orientationObserver.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
    }
  }

  function initialize() {
    if (!interactionListenersAdded) {
      document.addEventListener("pointerdown", event => {
        lastPointerPosition = { x: event.clientX, y: event.clientY };
        if (event.button !== 0 || typeof event.target?.closest !== "function") return;
        const piece = event.target.closest(".main-board cg-board piece");
        if (!piece) return;
        const board = piece.closest("cg-board");
        const parsed = board ? readBoard(board) : null;
        const source = parsed ? getLogicalSquare(piece, board, parsed.blackOrientation) : null;
        pieceInteractionActive = true;
        activePieceDrag = parsed && source && parsed.position[source.row][source.col]
          ? { board, position: parsed.position, source, clientX: event.clientX, clientY: event.clientY }
          : null;
      }, true);
      document.addEventListener("pointermove", event => {
        lastPointerPosition = { x: event.clientX, y: event.clientY };
        if (pieceInteractionActive && activePieceDrag) {
          activePieceDrag.clientX = event.clientX;
          activePieceDrag.clientY = event.clientY;
          scheduleRender();
          return;
        }
        if (settings?.enabled && settings.threatColoringEnabled && document.querySelector(".main-board cg-board > square.selected")) {
          scheduleRender();
        }
      }, true);
      const finishPieceInteraction = () => {
        if (!pieceInteractionActive) return;
        pieceInteractionActive = false;
        activePieceDrag = null;
        scheduleRender();
      };
      document.addEventListener("pointerup", finishPieceInteraction, true);
      document.addEventListener("pointercancel", finishPieceInteraction, true);
      window.addEventListener("blur", finishPieceInteraction);
      interactionListenersAdded = true;
    }

    if (!documentObserver) {
      documentObserver = new MutationObserver(mutations => {
        if (!mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(containsMainBoard))) return;
        const board = document.querySelector(".main-board cg-board");
        if (board !== observedBoard) observeBoard(board);
        scheduleRender();
      });
      documentObserver.observe(document, { childList: true, subtree: true });
    }
    if (document.documentElement && !themeObserver) {
      themeObserver = new MutationObserver(scheduleRender);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    }
    const board = document.querySelector(".main-board cg-board");
    if (board !== observedBoard) observeBoard(board);
    scheduleRender();
  }

  function update(nextSettings) {
    settings = nextSettings;
    initialize();
  }

  globalThis.LichessThreatCoding = { update, calculateThreatMap, createPreviewPosition, getBoardBaseColor, getOpacityColor };
})();
