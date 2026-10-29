(() => {
  const previewBoardId = "lfs-move-preview";
  const baseBoardSelector = ".round__app .main-board cg-board, .analyse__board cg-board, .bot-game__board cg-board, .puzzle__board cg-board, .study__board cg-board";
  const pieceTypes = { pawn: "P", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" };
  const typeNames = { P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king" };
  const svgNamespace = "http://www.w3.org/2000/svg";
  const boardLogic = globalThis.LichessMovePreviewBoard;
  let settings = null;
  let active = null;
  let pending = null;
  let pendingPromotion = null;
  let mutationObserver = null;
  let orientationObserver = null;
  let documentObserver = null;
  let pageDataText = null;
  let pageDataFens = [];
  let pageVariantKey = "standard";
  let mainFenInfo = null;

  function getWrapper(board) {
    return board?.closest(".cg-wrap") ?? null;
  }

  function getSquareAtPoint(board, x, y, rect = board.getBoundingClientRect()) {
    if (!rect.width || !rect.height || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return null;
    const blackOrientation = getWrapper(board)?.classList.contains("orientation-black") ?? false;
    let row = Math.floor((y - rect.top) / rect.height * 8);
    let col = Math.floor((x - rect.left) / rect.width * 8);
    if (blackOrientation) ({ row, col } = { row: 7 - row, col: 7 - col });
    return { row, col };
  }

  function getPieceSquare(board, element, blackOrientation, boardRect = board.getBoundingClientRect()) {
    const key = (globalThis.LichessMoveAnimation?.getDestinationKey(element)
      ?? element.dataset.lfsMoveKey ?? element.dataset.key ?? element.dataset.square)?.toLowerCase();
    const keyedSquare = boardLogic.parseSquare(key);
    if (keyedSquare) return keyedSquare;
    const rect = element.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height || !rect.width || !rect.height) return null;
    let row = Math.floor((rect.top + rect.height / 2 - boardRect.top) / boardRect.height * 8);
    let col = Math.floor((rect.left + rect.width / 2 - boardRect.left) / boardRect.width * 8);
    if (blackOrientation) ({ row, col } = { row: 7 - row, col: 7 - col });
    return row >= 0 && row < 8 && col >= 0 && col < 8 ? { row, col } : null;
  }

  function parsePiecePosition(board) {
    if (!board?.closest(".is2d")) return null;
    const position = Array.from({ length: 8 }, () => Array(8).fill(""));
    const blackOrientation = getWrapper(board)?.classList.contains("orientation-black") ?? false;
    const rect = board.getBoundingClientRect();
    let count = 0;
    for (const element of board.querySelectorAll(":scope > piece")) {
      if (element.classList.contains("ghost") || element.classList.contains("fading") || element.classList.contains("lfs-move-preview-piece")) continue;
      const color = element.classList.contains("white") ? "w" : element.classList.contains("black") ? "b" : null;
      const type = Object.keys(pieceTypes).find(name => element.classList.contains(name));
      const square = getPieceSquare(board, element, blackOrientation, rect);
      if (!color || !type || !square) return null;
      if (position[square.row][square.col]) return null;
      position[square.row][square.col] = color + pieceTypes[type];
      count++;
    }
    if (!count || position.flat().filter(piece => piece === "wK").length !== 1
      || position.flat().filter(piece => piece === "bK").length !== 1) return null;
    return { position, blackOrientation };
  }

  function getTurn(board, position, lastMove) {
    for (const element of [board, getWrapper(board)]) {
      if (element?.classList.contains("turn-white")) return "w";
      if (element?.classList.contains("turn-black")) return "b";
    }
    if (lastMove?.to) {
      const piece = position[lastMove.to.row]?.[lastMove.to.col];
      if (piece) return piece[0] === "w" ? "b" : "w";
    }
    return null;
  }

  function readLastMove(board, position, blackOrientation) {
    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) return null;
    const squares = [...board.querySelectorAll(":scope > square.last-move")]
      .map(square => {
        const key = (square.dataset.lfsMoveKey ?? square.dataset.key ?? square.dataset.square)?.toLowerCase();
        if (/^[a-h][1-8]$/.test(key ?? "")) return boardLogic.parseSquare(key);
        const rect = square.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const screen = {
          row: Math.floor((rect.top + rect.height / 2 - boardRect.top) / boardRect.height * 8),
          col: Math.floor((rect.left + rect.width / 2 - boardRect.left) / boardRect.width * 8)
        };
        if (screen.row < 0 || screen.row > 7 || screen.col < 0 || screen.col > 7) return null;
        return blackOrientation ? { row: 7 - screen.row, col: 7 - screen.col } : screen;
      }).filter(Boolean);
    if (squares.length !== 2) return null;
    const empty = squares.filter(square => !position[square.row][square.col]);
    const occupied = squares.filter(square => position[square.row][square.col]);
    if (empty.length === 1 && occupied.length === 1) {
      const from = empty[0];
      const to = occupied[0];
      const piece = position[to.row][to.col];
      return { from, to, ...(piece?.[1] === "P" && Math.abs(from.row - to.row) === 2 ? { doublePawn: true } : {}) };
    }
    for (const from of squares) {
      for (const to of squares) {
        if (from === to) continue;
        const piece = position[to.row][to.col];
        if (piece?.[1] === "P" && Math.abs(from.row - to.row) === 2 && from.col === to.col) return { from, to, doublePawn: true };
      }
    }
    return { from: squares[0], to: squares[1], doublePawn: false };
  }

  function addFen(value, output) {
    if (typeof value !== "string" || !/^[pnbrqkPNBRQK1-8/]+\s+[wb]\s+[-KQkq]+\s+[-a-h][1-8]?\s+\d+\s+\d+/.test(value.trim())) return;
    const parsed = boardLogic.parseFen(value);
    if (parsed) output.push({ fen: value.trim(), state: parsed });
  }

  function readPageDataFens() {
    const script = document.getElementById("page-init-data");
    if (!script) return pageDataFens;
    const text = script?.textContent ?? "";
    if (text === pageDataText) return pageDataFens;
    pageDataText = text;
    pageDataFens = [];
    if (!text) return pageDataFens;
    try {
      const data = JSON.parse(text);
      pageVariantKey = data?.cfg?.data?.game?.variant?.key ?? data?.data?.game?.variant?.key
        ?? data?.game?.variant?.key ?? pageVariantKey;
      const collect = (value, depth = 0) => {
        if (!value || typeof value !== "object" || depth > 10) return;
        if (Array.isArray(value)) {
          for (const item of value) collect(item, depth + 1);
          return;
        }
        addFen(value.fen, pageDataFens);
        for (const [key, item] of Object.entries(value)) {
          if (key !== "fen") collect(item, depth + 1);
        }
      };
      collect(data);
    } catch {
      pageDataFens = [];
    }
    return pageDataFens;
  }

  const pageDataObserver = new MutationObserver(() => {
    if (!document.getElementById("page-init-data")) return;
    readPageDataFens();
    pageDataObserver.disconnect();
  });
  pageDataObserver.observe(document, { childList: true, subtree: true });
  if (document.getElementById("page-init-data")) {
    readPageDataFens();
    pageDataObserver.disconnect();
  } else {
    document.addEventListener("DOMContentLoaded", () => pageDataObserver.disconnect(), { once: true });
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "lfs-move-preview-fen") return;
    const state = boardLogic.parseFen(event.data.fen);
    if (!state) return;
    mainFenInfo = {
      fen: event.data.fen,
      variant: typeof event.data.variant === "string" ? event.data.variant : null,
      identity: typeof event.data.identity === "string" ? event.data.identity : null
    };
    const rightsKey = value => `${[...value.castling].sort().join("")}|${value.enPassant ? `${value.enPassant.row},${value.enPassant.col}` : "-"}`;
    const stateChanged = base => (mainFenInfo.identity && base.identity !== mainFenInfo.identity)
      || boardLogic.getPlacement(state) !== boardLogic.getPlacement(base)
      || state.turn !== base.turn || rightsKey(state) !== rightsKey(base);
    if (active && stateChanged(active.baseState)) restore();
    if (pendingPromotion && !active && stateChanged(pendingPromotion.state)) cancelPromotion();
    if (pending) {
      const refreshed = readBaseState(pending.board);
      if (refreshed && boardLogic.getPlacement(refreshed) === boardLogic.getPlacement(pending.state)) pending.state = refreshed;
    }
  });

  function requestMainFen() {
    window.postMessage({ channel: "lfs-move-preview-state-request" }, location.origin);
  }

  function getFenCandidates(board) {
    const candidates = [];
    for (const element of [board, getWrapper(board), board.closest(".analyse__board, .round__app, .puzzle__board, .study__board")]) {
      addFen(element?.dataset?.fen, candidates);
    }
    for (const element of document.querySelectorAll(".analyse__moves [data-fen], .round__app [data-fen], .pv_box[data-fen]")) {
      addFen(element.dataset.fen, candidates);
    }
    for (const move of document.querySelectorAll(".analyse__moves [data-board], .pv-san[data-board]")) {
      addFen(move.dataset.board?.split("|")[0], candidates);
    }
    candidates.push(...readPageDataFens());
    return candidates;
  }

  function makeFallbackFen(position, turn, lastMove) {
    const placement = position.map(rank => {
      let empty = 0;
      let output = "";
      for (const piece of rank) {
        if (!piece) empty++;
        else {
          if (empty) output += empty;
          empty = 0;
          output += piece[0] === "w" ? piece[1] : piece[1].toLowerCase();
        }
      }
      return output + (empty || "");
    }).join("/");
    let ep = "-";
    if (lastMove?.doublePawn) {
      const row = (lastMove.from.row + lastMove.to.row) / 2;
      ep = boardLogic.squareKey({ row, col: lastMove.from.col });
    }
    return `${placement} ${turn} - ${ep} 0 1`;
  }

  function readBaseState(board) {
    const parsed = parsePiecePosition(board);
    if (!parsed) return null;
    const lastMove = readLastMove(board, parsed.position, parsed.blackOrientation);
    const displayedTurn = getTurn(board, parsed.position, lastMove);
    const placement = parsed.position.map(rank => {
      let empty = 0;
      let output = "";
      for (const piece of rank) {
        if (!piece) empty++;
        else {
          if (empty) output += empty;
          empty = 0;
          output += piece[0] === "w" ? piece[1] : piece[1].toLowerCase();
        }
      }
      return output + (empty || "");
    }).join("/");
    const mainState = mainFenInfo ? boardLogic.parseFen(mainFenInfo.fen) : null;
    const positionCandidates = getFenCandidates(board).filter(({ state }) => boardLogic.getPlacement(state) === placement);
    const candidateTurns = new Set(positionCandidates.map(({ state }) => state.turn));
    const turn = displayedTurn ?? (mainState && boardLogic.getPlacement(mainState) === placement
      ? mainState.turn
      : candidateTurns.size === 1 ? positionCandidates[0].state.turn : null);
    const mainMatches = mainState && boardLogic.getPlacement(mainState) === placement
      && (!displayedTurn || mainState.turn === displayedTurn);
    const candidates = positionCandidates.filter(({ state }) => state.turn === turn);
    const explicit = candidates.find(({ fen }) => [board, getWrapper(board)].some(element => element?.dataset?.fen === fen));
    let state = mainMatches ? mainState : explicit?.state ?? null;
    if (!state && candidates.length) {
      state = {
        ...candidates[0].state,
        board: candidates[0].state.board.map(rank => [...rank]),
        castling: new Set(candidates[0].state.castling),
        enPassant: candidates[0].state.enPassant ? { ...candidates[0].state.enPassant } : null
      };
      for (const candidate of candidates.slice(1)) {
        state.castling = new Set([...state.castling].filter(right => candidate.state.castling.has(right)));
        if (!state.enPassant || !candidate.state.enPassant
          || state.enPassant.row !== candidate.state.enPassant.row || state.enPassant.col !== candidate.state.enPassant.col) {
          state.enPassant = null;
        }
      }
    }
    state ??= boardLogic.parseFen(makeFallbackFen(parsed.position, turn ?? "w", lastMove));
    if (!state || !["standard", "fromPosition"].includes(getVariantKey())) return null;
    return { ...state, board: parsed.position, blackOrientation: parsed.blackOrientation, lastMove,
      identity: mainMatches ? mainFenInfo.identity : null };
  }

  function getVariantKey() {
    if (mainFenInfo?.variant) return mainFenInfo.variant;
    const match = location.pathname.match(/^\/analysis\/([^/]+)/);
    return match?.[1] === "standard" || match?.[1] === "fromPosition" ? match[1] : pageVariantKey;
  }

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(svgNamespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function getArrowAttributes(color) {
    const width = Number(settings.userArrowWidthPercent ?? 3);
    const opacity = Number(settings.userArrowOpacity ?? 100);
    const attributes = {
      fill: "none",
      stroke: color === "w" ? settings.whitePieceColor : settings.blackPieceColor,
      "stroke-width": (Number.isFinite(width) ? width : 3) * 0.125,
      "stroke-opacity": Math.max(0, Math.min(100, Number.isFinite(opacity) ? opacity : 100)) / 100,
      "stroke-linecap": "butt",
      "stroke-linejoin": "miter"
    };
    if (settings.userArrowDashed) {
      const dash = Number(settings.userArrowDashLengthPercent ?? 5);
      const gap = Number(settings.userArrowDashGapPercent ?? 3);
      attributes["stroke-dasharray"] = `${(Number.isFinite(dash) ? dash : 5) * 0.125} ${(Number.isFinite(gap) ? gap : 3) * 0.125}`;
    }
    return attributes;
  }

  function updateArrowPath(path, points, blackOrientation) {
    const radiusPercent = Number(settings.userArrowCornerRadiusPercent ?? 25);
    path.setAttribute("d", getPathPointsData(points, blackOrientation,
      Number.isFinite(radiusPercent) ? radiusPercent : 25));
  }

  function createDragVisual(drag) {
    const layer = document.createElement("div");
    layer.id = "lfs-move-preview-drag";
    layer.setAttribute("aria-hidden", "true");
    const pieceCode = drag.state.board[drag.source.row][drag.source.col];
    const blackOrientation = getWrapper(drag.board)?.classList.contains("orientation-black") ?? false;
    layer.dataset.lfsSelectedPieceColor = settings.moveDotsPlayerColor ? pieceCode[0] : "";
    addSquare(layer, drag.source, "selected", blackOrientation);
    for (const key of drag.legalTargets) {
      const target = boardLogic.parseSquare(key);
      const occupied = target && drag.state.board[target.row][target.col];
      addSquare(layer, target, `move-dest${occupied ? " oc" : ""}`, blackOrientation);
    }
    const piece = document.createElement("piece");
    piece.className = `${pieceCode[0] === "w" ? "white" : "black"} ${typeNames[pieceCode[1]]} lfs-move-preview-drag-piece`;
    const sourceBoard = active?.board === drag.board ? active.overlay : drag.board;
    const boardRect = sourceBoard?.getBoundingClientRect() ?? drag.board.getBoundingClientRect();
    drag.sourceElement = [...(sourceBoard?.querySelectorAll(":scope > piece") ?? [])]
      .find(element => {
        const square = getPieceSquare(sourceBoard, element, blackOrientation, boardRect);
        return square?.row === drag.source.row && square?.col === drag.source.col;
      }) ?? null;
    drag.sourceElement?.classList.add("lfs-move-preview-drag-source");
    const sourceStyle = drag.sourceElement && getComputedStyle(drag.sourceElement);
    if (sourceStyle) {
      piece.style.background = sourceStyle.background;
      piece.style.backgroundImage = sourceStyle.backgroundImage;
      piece.style.backgroundSize = sourceStyle.backgroundSize;
      piece.style.backgroundPosition = sourceStyle.backgroundPosition;
      piece.style.backgroundRepeat = sourceStyle.backgroundRepeat;
      piece.style.mask = sourceStyle.mask;
      piece.style.webkitMask = sourceStyle.webkitMask;
      piece.style.filter = sourceStyle.filter;
    }
    const svg = createSvgElement("svg", { viewBox: "0 0 100 100", "aria-hidden": "true" });
    svg.classList.add("lfs-move-preview-drag-paths");
    const path = createSvgElement("path", getArrowAttributes(pieceCode[0]));
    svg.append(path);
    layer.append(svg, piece);
    drag.board.closest(".cg-wrap").append(layer);
    drag.layer = layer;
    drag.piece = piece;
    drag.path = path;
    drag.blackOrientation = blackOrientation;
    drag.outlineEntry = {};
    renderDragMoveOutline(drag);
    updateArrowPath(path, [drag.source, drag.source], blackOrientation);
    if (pieceCode[1] === "K") {
      globalThis.LichessKingMovementFields?.renderDragPreview(
        piece, drag.state.board, drag.source, blackOrientation);
    }
  }

  function renderDragMoveOutline(drag) {
    if (!drag?.layer) return;
    const piece = drag.piece;
    piece?.classList.add("ghost");
    globalThis.LichessSelectedPieceWedge?.renderMoveOutline(
      drag.layer, drag.outlineEntry, settings.moveDotsPlayerColor ? drag.state.board[drag.source.row][drag.source.col][0] : null);
    piece?.classList.remove("ghost");
  }

  function dispatchPreviewPointerMove(drag, x, y) {
    const board = active?.board === drag.board ? active.overlay : null;
    if (!board) return;
    document.dispatchEvent(new CustomEvent("lfs-move-preview-pointermove", {
      detail: { board, clientX: x, clientY: y }
    }));
  }

  function updateDragVisual(drag, x, y) {
    const rect = drag.board.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const target = getSquareAtPoint(drag.board, x, y, rect);
    const targetKey = target && boardLogic.squareKey(target);
    const legal = targetKey && drag.legalTargets.has(targetKey);
    drag.piece.style.left = `${(x - rect.left) / rect.width * 100}%`;
    drag.piece.style.top = `${(y - rect.top) / rect.height * 100}%`;
    const blackOrientation = getWrapper(drag.board)?.classList.contains("orientation-black") ?? false;
    const pointerX = (x - rect.left) / rect.width * 100;
    const pointerY = (y - rect.top) / rect.height * 100;
    const source = screenSquare(drag.source, blackOrientation);
    drag.path.setAttribute("d", `M ${source.col * 12.5 + 6.25} ${source.row * 12.5 + 6.25} L ${pointerX} ${pointerY}`);
    if (drag.targetKey === (legal ? targetKey : null)) {
      return;
    }
    drag.target = legal ? target : null;
    drag.targetKey = legal ? targetKey : null;
    const draggedPiece = drag.state.board[drag.source.row][drag.source.col];
    if (draggedPiece?.[1] === "K") {
      const previewState = legal ? boardLogic.applyMove(drag.state, drag.source, target) : drag.state;
      const blackOrientation = getWrapper(drag.board)?.classList.contains("orientation-black") ?? false;
      globalThis.LichessKingMovementFields?.renderDragPreview(
        drag.piece, previewState.board, legal ? target : drag.source, blackOrientation);
    }
    updateSessionDragPreview(drag, drag.target);
    dispatchPreviewPointerMove(drag, x, y);
  }

  function scheduleDragVisual(drag, x, y) {
    drag.clientX = x;
    drag.clientY = y;
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = 0;
      if (pending === drag) updateDragVisual(drag, drag.clientX, drag.clientY);
    });
  }

  function clearDragVisual(drag) {
    if (!drag) return;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    drag.frame = 0;
    drag.sourceElement?.classList.remove("lfs-move-preview-drag-source");
    drag.layer?.remove();
    drag.sourceElement = null;
    drag.layer = null;
    drag.piece = null;
  }

  function showPromotionChoice(drag) {
    const panel = document.createElement("div");
    panel.id = "lfs-move-promotion-choice";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Umwandlungsfigur wählen");
    for (const type of ["Q", "R", "B", "N"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.promotion = type;
      button.setAttribute("aria-label", type);
      button.textContent = type;
      button.style.color = drag.state.turn === "w" ? settings.whitePieceColor : settings.blackPieceColor;
      panel.append(button);
    }
    drag.board.closest(".cg-wrap").append(panel);
    drag.promotionPanel = panel;
  }

  function clearPromotionChoice(drag) {
    clearDragVisual(drag);
    drag?.promotionPanel?.remove();
    if (drag) drag.promotionPanel = null;
  }

  function completePromotion(type) {
    if (!pendingPromotion) return;
    const drag = pendingPromotion;
    pendingPromotion = null;
    clearPromotionChoice(drag);
    makeMove(drag.board, drag.source, drag.target, drag.state, type);
  }

  function cancelPromotion() {
    if (!pendingPromotion) return;
    const drag = pendingPromotion;
    pendingPromotion = null;
    clearPromotionChoice(drag);
    resetSessionDragPreview(drag);
  }

  function ensureOverlay(session) {
    if (session.overlay?.isConnected) return session.overlay;
    const overlay = document.createElement("cg-board");
    overlay.id = previewBoardId;
    overlay.setAttribute("aria-hidden", "true");
    overlay.dataset.position = "";
    session.wrapper.append(overlay);
    session.overlay = overlay;
    return overlay;
  }

  function screenSquare(square, blackOrientation) {
    return blackOrientation ? { row: 7 - square.row, col: 7 - square.col } : square;
  }

  function addSquare(board, square, className, blackOrientation) {
    if (!square) return;
    const screen = screenSquare(square, blackOrientation);
    const element = document.createElement("square");
    element.className = className;
    element.dataset.key = boardLogic.squareKey(square);
    element.style.left = `${screen.col * 12.5}%`;
    element.style.top = `${screen.row * 12.5}%`;
    board.append(element);
  }

  function getPathPointsData(points, blackOrientation, cornerRadiusPercent) {
    const screenPoints = points.map(point => {
      const screen = screenSquare(point, blackOrientation);
      return { x: screen.col * 12.5 + 6.25, y: screen.row * 12.5 + 6.25 };
    });
    if (screenPoints.length < 2) return "";
    let data = `M ${screenPoints[0].x} ${screenPoints[0].y}`;
    const configuredRadius = Number(cornerRadiusPercent ?? 25);
    const radiusPercent = Number.isFinite(configuredRadius) ? configuredRadius : 25;
    const radiusFactor = Math.max(0, Math.min(100, radiusPercent)) / 100 * 0.5;
    for (let index = 1; index < screenPoints.length - 1; index++) {
      const previous = screenPoints[index - 1];
      const corner = screenPoints[index];
      const next = screenPoints[index + 1];
      const incomingLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
      const outgoingLength = Math.hypot(next.x - corner.x, next.y - corner.y);
      const radius = Math.min(incomingLength, outgoingLength) * radiusFactor;
      if (!radius) {
        data += ` L ${corner.x} ${corner.y}`;
        continue;
      }
      const incomingX = (corner.x - previous.x) / incomingLength;
      const incomingY = (corner.y - previous.y) / incomingLength;
      const outgoingX = (next.x - corner.x) / outgoingLength;
      const outgoingY = (next.y - corner.y) / outgoingLength;
      data += ` L ${corner.x - incomingX * radius} ${corner.y - incomingY * radius}`
        + ` Q ${corner.x} ${corner.y} ${corner.x + outgoingX * radius} ${corner.y + outgoingY * radius}`;
    }
    const end = screenPoints[screenPoints.length - 1];
    return `${data} L ${end.x} ${end.y}`;
  }

  function renderMoves(session, overlay) {
    const moves = session.moves.slice(0, session.index);
    const lastMove = session.dragPreview ?? session.moves[session.index - 1]
      ?? (session.index === 0 ? session.baseState.lastMove : null);
    const pathsByPiece = new Map();
    for (const move of moves) {
      let path = pathsByPiece.get(move.pieceId);
      if (!path) {
        path = { color: move.color, points: [move.from, move.to] };
        pathsByPiece.set(move.pieceId, path);
      } else path.points.push(move.to);
    }
    for (const path of pathsByPiece.values()) {
      const element = createSvgElement("path", getArrowAttributes(path.color));
      element.dataset.pieceColor = path.color;
      updateArrowPath(element, path.points, session.blackOrientation);
      session.svg.append(element);
    }
    if (lastMove) {
      addSquare(overlay, lastMove.from, "last-move", session.blackOrientation);
      addSquare(overlay, lastMove.to, "last-move", session.blackOrientation);
    }
  }

  function render(session) {
    if (active !== session || !session.board.isConnected || !session.wrapper.isConnected) return;
    const state = session.dragPreview?.state ?? session.states[session.index];
    const overlay = ensureOverlay(session);
    session.blackOrientation = getWrapper(session.board)?.classList.contains("orientation-black") ?? false;
    overlay.className = "cg-board";
    overlay.toggleAttribute("data-lfs-move-preview-dragging", pending?.board === session.board);
    // Keep pieces (and their king fields) connected across drag target changes.
    const pieces = new Map([...overlay.querySelectorAll(":scope > piece")]
      .map(piece => [piece.dataset.previewPieceId, piece]));
    for (const child of [...overlay.children]) {
      if (!child.matches("piece, [data-lfs-board-overlay]")) child.remove();
    }
    const pieceIds = session.dragPreview
      ? movePieceIds(session.states[session.index], session.pieceIdStates[session.index],
        session.dragPreview.from, session.dragPreview.to)
      : session.pieceIdStates[session.index];
    session.svg = createSvgElement("svg", { viewBox: "0 0 100 100", "aria-hidden": "true" });
    session.svg.classList.add("lfs-move-preview-paths");
    overlay.append(session.svg);
    renderMoves(session, overlay);

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = state.board[row][col];
        if (!piece) continue;
        const screen = screenSquare({ row, col }, session.blackOrientation);
        const pieceId = pieceIds[row][col];
        let element = pieces.get(pieceId);
        pieces.delete(pieceId);
        if (!element) {
          element = document.createElement("piece");
          element.dataset.previewPieceId = pieceId;
          overlay.append(element);
        }
        const className = `${piece[0] === "w" ? "white" : "black"} ${typeNames[piece[1]]} lfs-move-preview-piece`;
        if (!element.classList.contains(typeNames[piece[1]])) element.className = className;
        const dragSquare = session.dragPreview?.to ?? (pending?.board === session.board ? pending.source : null);
        element.classList.toggle("lfs-move-preview-candidate-piece", dragSquare?.row === row && dragSquare.col === col);
        element.dataset.key = boardLogic.squareKey({ row, col });
        element.style.left = `${screen.col * 12.5}%`;
        element.style.top = `${screen.row * 12.5}%`;
      }
    }
    for (const element of pieces.values()) element.remove();
    const baseKey = `${boardLogic.getPlacement(state)} ${state.turn}`;
    overlay.dataset.position = baseKey;
    session.board.dataset.lfsMovePreviewActive = "";
    ensurePreviewMix(session);
    document.dispatchEvent(new CustomEvent("lfs-hover-preview-change", { detail: overlay }));
  }

  function ensurePreviewMix(session) {
    if (!session.mixOverlay) {
      session.mixOverlay = document.createElement("div");
      session.mixOverlay.id = "lfs-move-preview-mix";
      session.mixOverlay.setAttribute("aria-hidden", "true");
    }
    session.mixOverlay.style.backgroundColor = settings.movePreviewMixColor;
    session.mixOverlay.style.opacity = String(settings.movePreviewMixPercent / 100);
    session.wrapper.append(session.mixOverlay);
  }

  function stopObservers() {
    mutationObserver?.disconnect();
    orientationObserver?.disconnect();
    documentObserver?.disconnect();
    mutationObserver = null;
    orientationObserver = null;
    documentObserver = null;
  }

  function restore() {
    const session = active;
    active = null;
    clearDragVisual(pending);
    pending = null;
    cancelPromotion();
    if (!session) return;
    stopObservers();
    session.overlay?.remove();
    session.mixOverlay?.remove();
    session.board.removeAttribute("data-lfs-move-preview-active");
    document.dispatchEvent(new CustomEvent("lfs-hover-preview-change", { detail: session.board }));
  }

  function getCurrentMainBoard() {
    return [...document.querySelectorAll(baseBoardSelector)].find(board =>
      board.isConnected && board.closest(".is2d") && board.getBoundingClientRect().width > 0) ?? null;
  }

  function isRelevantPositionMutation(record, board) {
    if (record.type === "childList") {
      if (record.target !== board) return false;
      return [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === Node.ELEMENT_NODE && (node.matches("piece") || node.querySelector("piece")));
    }
    const target = record.target;
    if (record.attributeName === "style") {
      return target.matches("piece") && !target.matches("piece.anim, piece.dragging, piece.ghost, piece.fading");
    }
    if (record.attributeName === "data-key" || record.attributeName === "data-lfs-move-key") return target.matches("piece");
    if (record.attributeName !== "class") return false;
    if (target === board) {
      const oldTurn = (record.oldValue ?? "").match(/(?:^|\s)turn-(?:white|black)(?:\s|$)/)?.[0] ?? "";
      const newTurn = [...target.classList].find(name => name === "turn-white" || name === "turn-black") ?? "";
      return oldTurn.trim() !== newTurn;
    }
    if (target.matches("piece")) {
      const transient = new Set(["anim", "dragging", "ghost", "fading", "lfs-move-preview-drag-source"]);
      const stableClasses = value => (value ?? "").split(/\s+/).filter(name => name && !transient.has(name)).sort().join(" ");
      if (stableClasses(record.oldValue) !== stableClasses(target.className)) return true;
      const oldClasses = new Set((record.oldValue ?? "").split(/\s+/));
      // Motion class additions are visual; removal triggers one final position check.
      return ["anim", "dragging", "ghost", "fading"].some(name => oldClasses.has(name) && !target.classList.contains(name));
    }
    if (target.matches("square")) {
      const hadLastMove = (record.oldValue ?? "").split(/\s+/).includes("last-move");
      return hadLastMove !== target.classList.contains("last-move");
    }
    return false;
  }

  function monitorSession(session) {
    stopObservers();
    mutationObserver = new MutationObserver(records => {
      if (active !== session) return;
      if (!records.some(record => isRelevantPositionMutation(record, session.board))) return;
      if (!session.board.isConnected || !session.wrapper.isConnected || getCurrentMainBoard() !== session.board) {
        restore();
        return;
      }
      const current = parsePiecePosition(session.board);
      const lastMove = current ? readLastMove(session.board, current.position, current.blackOrientation) : null;
      const turn = current ? getTurn(session.board, current.position, lastMove) ?? session.baseState.turn : null;
      const moveKey = move => move ? `${move.from.row},${move.from.col}:${move.to.row},${move.to.col}` : "";
      if (!current || JSON.stringify(current.position) !== JSON.stringify(session.baseState.board)
        || turn !== session.baseState.turn || moveKey(lastMove) !== moveKey(session.baseState.lastMove)) restore();
    });
    mutationObserver.observe(session.board, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["class", "data-key", "data-lfs-move-key", "style"], attributeOldValue: true
    });
    const wrapper = getWrapper(session.board);
    orientationObserver = new MutationObserver(() => {
      if (active === session) render(session);
    });
    orientationObserver.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
    documentObserver = new MutationObserver(records => {
      if (active !== session) return;
      const touchesBoard = records.some(record => session.board.contains(record.target)
        || record.target.contains?.(session.board)
        || [...record.addedNodes, ...record.removedNodes].some(node =>
          node === session.board || node.contains?.(session.board)));
      if (!touchesBoard) return;
      if (!session.board.isConnected || !session.wrapper.isConnected || getCurrentMainBoard() !== session.board) restore();
    });
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function startSession(board, baseState) {
    const wrapper = getWrapper(board);
    if (!wrapper) return null;
    const session = {
      board, wrapper, baseState, states: [baseState], moves: [], index: 0,
      pieceIdStates: [createPieceIds(baseState.board)],
      blackOrientation: baseState.blackOrientation, baseIdentity: baseState.identity,
      provisional: false, dragPreview: null, dragPreviewKey: null,
      overlay: null, svg: null, wheelDelta: 0
    };
    active = session;
    monitorSession(session);
    return session;
  }

  function createPieceIds(board) {
    return board.map((rank, row) => rank.map((piece, col) => piece ? `${piece[0]}-${row}-${col}` : ""));
  }

  function movePieceIds(state, pieceIds, from, to) {
    const next = pieceIds.map(rank => [...rank]);
    const piece = state.board[from.row][from.col];
    const pieceId = next[from.row][from.col];
    if (!pieceId) return next;
    if (piece[1] === "P" && state.enPassant?.row === to.row && state.enPassant.col === to.col
      && !state.board[to.row][to.col] && from.col !== to.col) next[from.row][to.col] = "";
    if (piece[1] === "K" && Math.abs(to.col - from.col) === 2) {
      const rookFrom = to.col > from.col ? 7 : 0;
      const rookTo = to.col > from.col ? 5 : 3;
      next[from.row][rookTo] = next[from.row][rookFrom];
      next[from.row][rookFrom] = "";
    }
    next[to.row][to.col] = pieceId;
    next[from.row][from.col] = "";
    return next;
  }

  function updateSessionDragPreview(drag, target) {
    const session = active;
    if (!session || session.board !== drag.board) return;
    const targetKey = target ? boardLogic.squareKey(target) : null;
    if (session.dragPreviewKey === targetKey) return;
    session.dragPreviewKey = targetKey;
    if (!target) {
      session.dragPreview = null;
      render(session);
      return;
    }
    const state = session.states[session.index];
    const pieceIds = session.pieceIdStates[session.index];
    const nextState = boardLogic.applyMove(state, drag.source, target);
    if (!nextState) {
      session.dragPreview = null;
      session.dragPreviewKey = null;
      render(session);
      return;
    }
    session.dragPreview = {
      from: drag.source,
      to: target,
      color: state.turn,
      pieceId: pieceIds[drag.source.row][drag.source.col],
      state: nextState
    };
    render(session);
  }

  function resetSessionDragPreview(drag) {
    const session = active;
    if (!session || session.board !== drag?.board) return;
    session.dragPreview = null;
    session.dragPreviewKey = null;
    if (session.provisional) restore();
    else render(session);
  }

  function getDragPreviewState(board) {
    const session = active;
    if (!session || session.overlay !== board) return null;
    const drag = pending?.board === session.board ? pending : null;
    const preview = session.dragPreview;
    const source = preview?.from ?? drag?.source;
    if (!source) return null;
    const state = session.states[session.index];
    return {
      position: preview?.state.board ?? state.board,
      source,
      target: preview?.to ?? source,
      color: state.turn,
      pieceId: session.pieceIdStates[session.index][source.row][source.col],
      basePosition: state.board,
      blackOrientation: session.blackOrientation,
      legal: Boolean(preview),
      isHoverPreview: false,
      isDragging: Boolean(drag || preview)
    };
  }

  function makeMove(board, from, to, baseState, promotion = "Q") {
    const startsSession = !active || active.board !== board;
    const initial = startsSession ? (baseState ?? readBaseState(board)) : null;
    if (startsSession && !initial) return false;
    const state = startsSession ? initial : active.states[active.index];
    const currentPieceIds = startsSession ? createPieceIds(state.board) : active.pieceIdStates[active.index];
    const pieceId = currentPieceIds[from.row][from.col];
    const nextState = boardLogic.applyMove(state, from, to, promotion);
    if (!nextState) return false;
    const nextPieceIds = movePieceIds(state, currentPieceIds, from, to);
    if (startsSession) {
      restore();
      if (!startSession(board, initial)) return false;
    }
    const session = active;
    session.provisional = false;
    session.dragPreview = null;
    session.dragPreviewKey = null;
    session.moves.length = session.index;
    session.states.length = session.index + 1;
    session.pieceIdStates.length = session.index + 1;
    session.moves.push({ from, to, color: state.turn, pieceId });
    session.states.push(nextState);
    session.pieceIdStates.push(nextPieceIds);
    session.index++;
    render(session);
    return true;
  }

  function stepBy(session, delta) {
    if (active !== session) return;
    const nextIndex = Math.max(0, Math.min(session.moves.length, session.index + delta));
    if (nextIndex === session.index) return;
    session.index = nextIndex;
    render(session);
  }

  function isPreviewEnabled() {
    return settings?.enabled !== false && settings?.userArrowMode === "rightClickPreview";
  }

  function getBoardFromEvent(event) {
    return event.target?.closest?.(baseBoardSelector) ?? null;
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  document.addEventListener("pointerdown", event => {
    if (pendingPromotion) {
      const choice = event.target?.closest?.("#lfs-move-promotion-choice [data-promotion]");
      if (event.button === 0 && choice) {
        stopEvent(event);
        completePromotion(choice.dataset.promotion);
        return;
      }
      if (event.button === 0 && getBoardFromEvent(event) === pendingPromotion.board) {
        stopEvent(event);
        cancelPromotion();
        if (active) restore();
        return;
      }
      if (event.button === 2) cancelPromotion();
    }
    if (event.button === 0 && !event.altKey && active && getBoardFromEvent(event) === active.board) {
      stopEvent(event);
      restore();
      return;
    }
    if (event.button === 0 && active && getBoardFromEvent(event) !== active.board) restore();
    if ((event.button !== 2 && !(event.button === 0 && event.altKey)) || !isPreviewEnabled()) return;
    const board = getBoardFromEvent(event);
    if (!board || board.id === "lfs-pv-preview" || board.id === previewBoardId) return;
    requestMainFen();
    stopEvent(event);
    if (active && active.board !== board) restore();
    const source = getSquareAtPoint(board, event.clientX, event.clientY);
    const state = active?.board === board ? active.states[active.index] : readBaseState(board);
    if (!source || !state?.board[source.row]?.[source.col] || state.board[source.row][source.col][0] !== state.turn) {
      pending = null;
      return;
    }
    const legalTargets = new Set(boardLogic.getLegalMoves(state, source).map(move => boardLogic.squareKey(move)));
    pending = { board, source, state, legalTargets, pointerId: event.pointerId, button: event.button };
    if (!active && legalTargets.size) {
      const session = startSession(board, state);
      if (session) session.provisional = true;
    }
    createDragVisual(pending);
    updateDragVisual(pending, event.clientX, event.clientY);
    if (active?.board === board) render(active);
  }, true);

  document.addEventListener("pointermove", event => {
    if (!pending || event.pointerId !== pending.pointerId) return;
    stopEvent(event);
    scheduleDragVisual(pending, event.clientX, event.clientY);
  }, true);

  document.addEventListener("pointerup", event => {
    if (!pending || event.button !== pending.button || event.pointerId !== pending.pointerId) return;
    stopEvent(event);
    const drag = pending;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    drag.frame = 0;
    pending = null;
    updateDragVisual(drag, event.clientX, event.clientY);
    const { target, targetKey, board, source, state } = drag;
    if (!target || !targetKey) {
      clearDragVisual(drag);
      resetSessionDragPreview(drag);
      return;
    }
    const piece = state.board[source.row][source.col];
    const promotionRow = piece[0] === "w" ? 0 : 7;
    if (piece[1] === "P" && target.row === promotionRow) {
      const screen = screenSquare(target, getWrapper(board)?.classList.contains("orientation-black") ?? false);
      drag.piece.style.left = `${(screen.col + 0.5) * 12.5}%`;
      drag.piece.style.top = `${(screen.row + 0.5) * 12.5}%`;
      pendingPromotion = drag;
      showPromotionChoice(drag);
      const panel = drag.promotionPanel;
      panel.style.left = `${Math.min(screen.col * 12.5, 50)}%`;
      panel.style.top = `${Math.min(screen.row * 12.5, 82)}%`;
      return;
    }
    clearDragVisual(drag);
    if (!makeMove(board, source, target, state)) resetSessionDragPreview(drag);
  }, true);

  document.addEventListener("pointercancel", event => {
    if (!pending || event.pointerId !== pending.pointerId) return;
    const drag = pending;
    clearDragVisual(drag);
    pending = null;
    resetSessionDragPreview(drag);
  }, true);

  document.addEventListener("keydown", event => {
    if (!pendingPromotion) return;
    const promotion = ({ q: "Q", r: "R", b: "B", n: "N" })[event.key.toLowerCase()];
    if (promotion) {
      stopEvent(event);
      completePromotion(promotion);
    } else if (event.key === "Escape") {
      stopEvent(event);
      cancelPromotion();
    }
  }, true);

  document.addEventListener("contextmenu", event => {
    if (!isPreviewEnabled() || !getBoardFromEvent(event)) return;
    stopEvent(event);
  }, true);

  document.addEventListener("wheel", event => {
    if (pending && getBoardFromEvent(event) === pending.board) {
      stopEvent(event);
      return;
    }
    if (pendingPromotion && getBoardFromEvent(event) === pendingPromotion.board) {
      stopEvent(event);
      return;
    }
    if (!active || !isPreviewEnabled() || getBoardFromEvent(event) !== active.board) return;
    stopEvent(event);
    active.wheelDelta += event.deltaY;
    while (active.wheelDelta >= 90) {
      stepBy(active, 1);
      active.wheelDelta -= 90;
    }
    while (active.wheelDelta <= -90) {
      stepBy(active, -1);
      active.wheelDelta += 90;
    }
  }, { capture: true, passive: false });

  window.addEventListener("blur", () => {
    const drag = pending;
    clearDragVisual(drag);
    pending = null;
    if (drag) resetSessionDragPreview(drag);
  });
  window.addEventListener("hashchange", restore);
  window.addEventListener("popstate", restore);

  function update(nextSettings) {
    settings = nextSettings;
    if (pendingPromotion) cancelPromotion();
    if (!isPreviewEnabled()) {
      restore();
      return;
    }
    if (pending) renderDragMoveOutline(pending);
    if (active) render(active);
  }

  globalThis.LichessMovePreview = {
    update,
    restore,
    isActive: () => Boolean(active),
    getOverlayBoard: board => active?.board === board ? active.overlay : null,
    getDragPreviewState
  };
})();
