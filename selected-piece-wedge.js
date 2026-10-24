(() => {
  const boardSelector = ".cg-wrap cg-board, .mini-game cg-board";
  const svgNamespace = "http://www.w3.org/2000/svg";
  const pieceTypes = ["pawn", "knight", "bishop", "rook", "queen", "king"];
  const pieceValues = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
  const maxUnselectedPotentialMovesPerColor = 3;
  const pawnWedgeBaseOffset = 0.12;
  const slidingDirections = {
    bishop: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    rook: [[-1, 0], [1, 0], [0, -1], [0, 1]],
    queen: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
  };
  const pieceDirections = {
    ...slidingDirections,
    knight: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]],
    king: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
  };
  const pieceNamesByLetter = { P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king" };
  const promotionPreviewPieces = ["Q", "R", "B", "N"];
  const observedBoards = new Map();
  const moveDestinationPreviewCache = new WeakMap();
  const positionAnalysisCache = new Map();
  const maxPositionAnalysisCacheSize = 128;
  let settings = null;
  let pointerOverBoard = null;
  let lastPointerPosition = null;
  let documentObserver = null;
  let hatchAnimationFrame = 0;
  let hatchScrollLastTime = null;
  let hatchScrollDistance = 0;
  let defenseHighlightFilterId = 0;
  let defenseHighlightLineId = 0;
  let defenseHighlightMaskId = 0;


  function scheduleRender(board) {
    const entry = observedBoards.get(board);
    if (!entry || entry.frame) return;
    entry.frame = requestAnimationFrame(() => {
      entry.frame = 0;
      renderBoard(board, entry);
    });
  }

  // A single shared clock keeps every hatch in phase when board overlays are rebuilt.
  function advanceHatchScroll(timestamp = performance.now()) {
    if (hatchScrollLastTime !== null && settings) {
      hatchScrollDistance += Math.max(0, timestamp - hatchScrollLastTime) * settings.threatCenterHatchSpeed / 1000;
    }
    hatchScrollLastTime = timestamp;
    return hatchScrollDistance;
  }

  function hatchPatternTransform(angle, spacing, distance = hatchScrollDistance) {
    const offset = ((distance % spacing) + spacing) % spacing;
    return `rotate(${angle}) translate(0 ${offset.toFixed(4)})`;
  }

  function animateHatchPatterns(timestamp) {
    hatchAnimationFrame = 0;
    advanceHatchScroll(timestamp);
    let hasPatterns = false;
    for (const entry of observedBoards.values()) {
      for (const { pattern, spacing, angle } of entry.hatchPatterns) {
        const transform = hatchPatternTransform(angle, spacing);
        if (pattern.getAttribute("patternTransform") !== transform) pattern.setAttribute("patternTransform", transform);
        hasPatterns = true;
      }
    }
    if (hasPatterns && settings?.threatCenterHatchSpeed > 0) {
      hatchAnimationFrame = requestAnimationFrame(animateHatchPatterns);
    }
  }

  function syncHatchAnimation() {
    const hasPatterns = [...observedBoards.values()].some(entry => entry.hatchPatterns.length);
    if (settings?.threatCenterHatchSpeed > 0 && hasPatterns) {
      if (!hatchAnimationFrame) {
        hatchScrollLastTime = null;
        advanceHatchScroll();
        hatchAnimationFrame = requestAnimationFrame(animateHatchPatterns);
      }
    } else if (hatchAnimationFrame) {
      cancelAnimationFrame(hatchAnimationFrame);
      hatchAnimationFrame = 0;
      advanceHatchScroll();
    }
  }

  document.addEventListener("lfs-hover-preview-change", event => scheduleRender(event.detail));

  function updatePointerPosition(event) {
    lastPointerPosition = { x: event.clientX, y: event.clientY };
    const eventBoard = typeof event.target?.closest === "function"
      ? event.target.closest(boardSelector)
      : null;
    const previousBoard = pointerOverBoard;
    pointerOverBoard = eventBoard;
    const boardsToUpdate = new Set([eventBoard, previousBoard]);
    for (const [board, entry] of observedBoards) {
      if (entry.previewPieceSvg) boardsToUpdate.add(board);
    }

    for (const board of boardsToUpdate) {
      const entry = observedBoards.get(board);
      if (!entry) continue;
      const hasDraggingPiece = Boolean(board.querySelector(":scope > piece.dragging"));
      const shouldUpdatePreview = board === eventBoard || entry.previewPieceSvg || hasDraggingPiece;
      const rect = shouldUpdatePreview ? board.getBoundingClientRect() : null;
      const insideBoard = board === eventBoard && rect.width && rect.height
        && event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom;
      const nextHoveredSquare = insideBoard && rect.width && rect.height
        ? {
          row: Math.floor((event.clientY - rect.top) * 8 / rect.height),
          col: Math.floor((event.clientX - rect.left) * 8 / rect.width)
        }
        : null;
      if (entry.hoveredSquare?.row !== nextHoveredSquare?.row || entry.hoveredSquare?.col !== nextHoveredSquare?.col) {
        entry.hoveredSquare = nextHoveredSquare;
        scheduleRender(board);
      }
      if (!insideBoard && !entry.previewPieceSvg && !hasDraggingPiece) continue;
      if (!entry.previewPieceSvg && !hasDraggingPiece && !board.querySelector(":scope > square.selected")) continue;

      const preview = globalThis.LichessThreatCoding?.getInteractionPreview(board, event.clientX, event.clientY);
      if (preview?.isHoverPreview) {
        const now = performance.now();
        const sourceKey = `${preview.source.row},${preview.source.col}`;
        const previous = entry.previewPointerMotion;
        const x = (event.clientX - rect.left) * 8 / rect.width;
        const y = (event.clientY - rect.top) * 8 / rect.height;
        const elapsed = previous ? now - previous.time : 0;
        const targetKey = `${preview.source.row},${preview.source.col}:${preview.target.row},${preview.target.col}`;
        const heldTargetKey = previous && elapsed < 90 && previous.sourceKey === sourceKey
          ? previous.heldTargetKey
          : entry.previewTargetKey ?? targetKey;
        const waitingForTargetChange = heldTargetKey === targetKey;
        if (elapsed > 0 && elapsed < 90 && previous.sourceKey === sourceKey) {
          const vx = (x - previous.x) / elapsed;
          const vy = (y - previous.y) / elapsed;
          const speed = Math.hypot(vx, vy);
          const previousSpeed = Math.hypot(previous.vx, previous.vy);
          const consistent = speed > 0.00015 && previousSpeed > 0
            && (vx * previous.vx + vy * previous.vy) / (speed * previousSpeed) > 0.85
            && speed / previousSpeed > 0.4 && speed / previousSpeed < 2.5;
          const samples = consistent ? previous.samples + 1 : 0;
          const consistentSince = consistent ? previous.consistentSince : now;
          const anticipation = settings.movePreviewAnticipationPercent / 100;
          // Lower settings require sustained direction, independent of pointer event frequency.
          const confirmed = now - consistentSince >= (1 - anticipation) * 180;
          entry.previewPointerMotion = {
            x, y, time: now, sourceKey, samples, consistentSince,
            smooth: anticipation > 0 && confirmed && samples >= 2 && !waitingForTargetChange,
            vx: consistent ? previous.vx * 0.4 + vx * 0.6 : vx,
            vy: consistent ? previous.vy * 0.4 + vy * 0.6 : vy
          };
        } else {
          entry.previewPointerMotion = { x, y, time: now, sourceKey, samples: 0, consistentSince: now, smooth: false, vx: 0, vy: 0 };
        }
        // After a pause, movement inside the same field must not restart lookahead.
        entry.previewPointerMotion.heldTargetKey = waitingForTargetChange ? targetKey : null;
        if (!entry.previewPieceSvg || entry.previewTargetKey !== targetKey
          || (entry.previewPointerMotion.smooth && !entry.previewAnimation?.tracking)) scheduleRender(board);
      } else if (preview || entry.previewPieceSvg) {
        entry.previewPointerMotion = null;
        scheduleRender(board);
      }
    }
  }

  document.addEventListener("pointermove", updatePointerPosition, true);
  document.addEventListener("pointerover", event => {
    if (event.target?.closest?.(boardSelector) !== pointerOverBoard) updatePointerPosition(event);
  }, true);
  document.addEventListener("scroll", () => {
    if (!lastPointerPosition) return;
    const { x, y } = lastPointerPosition;
    for (const entry of observedBoards.values()) entry.previewPointerMotion = null;
    updatePointerPosition({ clientX: x, clientY: y, target: document.elementFromPoint(x, y) });
  }, true);

  function clearPointerPosition() {
    lastPointerPosition = null;
    pointerOverBoard = null;
    for (const [board, entry] of observedBoards) {
      entry.hoveredSquare = null;
      entry.previewPointerMotion = null;
      clearDefenseHoverTimer(entry);
      entry.defenseHoverKey = null;
      entry.defenseHoverStartedKey = null;
      scheduleRender(board);
    }
  }

  document.addEventListener("pointerout", event => {
    if (!event.relatedTarget) clearPointerPosition();
  }, true);
  globalThis.addEventListener?.("blur", clearPointerPosition);


  function getScreenSquare(element, board, boardRect) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return null;
    const rectForBoard = boardRect ?? board.getBoundingClientRect();
    if (!rectForBoard.width || !rectForBoard.height) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const screenCol = Math.floor(((rect.left + rect.width / 2 - rectForBoard.left) / rectForBoard.width) * 8);
    const screenRow = Math.floor(((rect.top + rect.height / 2 - rectForBoard.top) / rectForBoard.height) * 8);
    if (screenRow < 0 || screenRow > 7 || screenCol < 0 || screenCol > 7) return null;
    return { row: screenRow, col: screenCol };
  }

  function getPiece(element) {
    const color = element.classList.contains("white") ? "w" : element.classList.contains("black") ? "b" : "";
    const type = pieceTypes.find(name => element.classList.contains(name));
    if (!color || !type) return null;
    return { color, type, element };
  }

  function getPieceScreenSquare(element, board, blackOrientation, boardRect) {
    const moveKey = (globalThis.LichessMoveAnimation?.getDestinationKey(element)
      ?? (element.classList.contains("anim") ? element.getAttribute("data-lfs-move-key") : null))?.toLowerCase();
    const match = /^([a-h])([1-8])$/.exec(moveKey ?? "");
    if (match) {
      return logicalToScreen({ row: 8 - Number(match[2]), col: match[1].charCodeAt(0) - 97 }, blackOrientation);
    }
    return getScreenSquare(element, board, boardRect);
  }

  function readPosition(board) {
    const blackOrientation = board.closest(".cg-wrap")?.classList.contains("orientation-black") ?? false;
    const boardRect = board.getBoundingClientRect();
    const position = Array.from({ length: 8 }, () => Array(8).fill(null));

    for (const element of board.querySelectorAll(":scope > piece")) {
      if (element.classList.contains("ghost") || element.classList.contains("fading")) continue;
      const piece = getPiece(element);
      const square = getPieceScreenSquare(element, board, blackOrientation, boardRect);
      if (!piece || !square || position[square.row][square.col]) return null;
      position[square.row][square.col] = piece;
    }

    const selected = [...board.querySelectorAll(":scope > square.selected")]
      .map(square => getScreenSquare(square, board, boardRect)).find(Boolean) ?? null;
    return { position, selected, blackOrientation };
  }

  function readDragPreview(preview) {
    const position = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = preview.position[row][col];
        if (!piece) continue;
        const screenRow = preview.blackOrientation ? 7 - row : row;
        const screenCol = preview.blackOrientation ? 7 - col : col;
        position[screenRow][screenCol] = { color: piece[0], type: pieceNamesByLetter[piece[1]] };
      }
    }
    const focus = preview.legal ? preview.target : preview.source;
    const selected = preview.blackOrientation
      ? { row: 7 - focus.row, col: 7 - focus.col }
      : focus;
    return { position, selected, blackOrientation: preview.blackOrientation };
  }

  function getAttackedPieces(position, source, blackOrientation) {
    const piece = position[source.row]?.[source.col];
    if (!piece) return [];
    const targets = [];
    const pawnDirection = (piece.color === "w") !== blackOrientation ? -1 : 1;
    const directions = piece.type === "pawn"
      ? [[pawnDirection, -1], [pawnDirection, 1]]
      : pieceDirections[piece.type];
    const sliding = Boolean(slidingDirections[piece.type]);

    for (const [dr, dc] of directions) {
      let row = source.row + dr;
      let col = source.col + dc;
      while (row >= 0 && row < 8 && col >= 0 && col < 8) {
        const target = position[row][col];
        if (target) {
          targets.push({ row, col });
          if (sliding) break;
        }
        if (!sliding) break;
        row += dr;
        col += dc;
      }
    }
    return targets;
  }

  function logicalToScreen(square, blackOrientation) {
    return blackOrientation
      ? { row: 7 - square.row, col: 7 - square.col }
      : square;
  }

  function isPieceRotated(color, blackOrientation) {
    return (color === "b") !== blackOrientation;
  }

  // Sliding pieces also attack through own pieces on their line, if those pieces can recapture on the target in turn.
  function canRecaptureInChain(position, blockers, target, blackOrientation) {
    const simulated = position.map(row => [...row]);
    for (let index = blockers.length - 1; index >= 0; index--) {
      const blocker = blockers[index];
      if (!canReach(simulated, blocker, target, blackOrientation)) return false;
      simulated[blocker.row][blocker.col] = null;
    }
    return true;
  }

  function getBatteryTargets(position, source, blackOrientation) {
    const piece = position[source.row][source.col];
    const directions = slidingDirections[piece.type];
    if (!directions) return [];

    const targets = [];
    for (const [dr, dc] of directions) {
      const blockers = [];
      let row = source.row + dr;
      let col = source.col + dc;
      while (row >= 0 && row < 8 && col >= 0 && col < 8) {
        const occupant = position[row][col];
        if (occupant) {
          if (occupant.color !== piece.color) {
            const target = { row, col };
            if (blockers.length && canRecaptureInChain(position, blockers, target, blackOrientation)) targets.push(target);
            break;
          }
          if (occupant.type === "king") break;
          blockers.push({ row, col });
        }
        row += dr;
        col += dc;
      }
    }
    return targets;
  }

  function getThreatenedSquares(position, blackOrientation) {
    const threatened = { w: new Map(), b: new Map() };
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const attacker = position[row][col];
        if (!attacker) continue;
        const attacks = [
          ...getAttackedPieces(position, { row, col }, blackOrientation),
          ...getBatteryTargets(position, { row, col }, blackOrientation)
        ];
        for (const target of attacks) {
          const victim = position[target.row][target.col];
          if (!victim || victim.color === attacker.color) continue;
          const key = `${target.row},${target.col}`;
          if (!threatened[victim.color].has(key)) threatened[victim.color].set(key, []);
          threatened[victim.color].get(key).push({ row, col, type: attacker.type });
        }
      }
    }
    return threatened;
  }

  function canReach(position, source, target, blackOrientation) {
    return getAttackedPieces(position, source, blackOrientation).some(square => square.row === target.row && square.col === target.col);
  }

  // Sliding pieces also defend through blocking pieces that can reach the defended piece themselves.
  function getDefendedPieces(position, source, blackOrientation, includeKingTargets = false) {
    const piece = position[source.row][source.col];
    const directions = slidingDirections[piece.type];
    if (!directions) {
      return getAttackedPieces(position, source, blackOrientation)
        .filter(target => position[target.row][target.col].color === piece.color);
    }

    const defended = [];
    for (const [dr, dc] of directions) {
      const blockers = [];
      let row = source.row + dr;
      let col = source.col + dc;
      while (row >= 0 && row < 8 && col >= 0 && col < 8) {
        const occupant = position[row][col];
        if (occupant?.type === "king") {
          if (includeKingTargets && occupant.color === piece.color
            && blockers.every(blocker => canReach(position, blocker, { row, col }, blackOrientation))) {
            defended.push({ row, col });
          }
          break;
        }
        if (occupant) {
          const target = { row, col };
          if (occupant.color === piece.color && blockers.every(blocker => canReach(position, blocker, target, blackOrientation))) {
            defended.push(target);
          }
          blockers.push(target);
        }
        row += dr;
        col += dc;
      }
    }
    return defended;
  }

  function getDefenseConnections(position, blackOrientation, includeKingTargets = false) {
    const connections = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const defender = position[row][col];
        if (!defender) continue;
        const source = { row, col };
        for (const target of getDefendedPieces(position, source, blackOrientation, includeKingTargets)) {
          if (!includeKingTargets && position[target.row][target.col].type === "king") continue;
          connections.push({ source, target, color: defender.color });
        }
      }
    }
    return connections;
  }

  function getPositionKey(position) {
    return position.map(row => row.map(piece => piece ? `${piece.color}${piece.type}` : "-").join("")).join("/");
  }

  function getPositionAnalysis(position, blackOrientation) {
    const key = `${blackOrientation}:${getPositionKey(position)}`;
    let analysis = positionAnalysisCache.get(key);
    if (analysis) {
      positionAnalysisCache.delete(key);
    } else {
      analysis = { threatenedSquares: null, defenseConnections: null };
    }
    if (settings.threatenedPieceOutlineEnabled && !analysis.threatenedSquares) {
      analysis.threatenedSquares = getThreatenedSquares(position, blackOrientation);
    }
    if (settings.defenseCirclesEnabled && !analysis.defenseConnections) {
      analysis.defenseConnections = getDefenseConnections(position, blackOrientation);
    }
    positionAnalysisCache.set(key, analysis);
    if (positionAnalysisCache.size > maxPositionAnalysisCacheSize) {
      positionAnalysisCache.delete(positionAnalysisCache.keys().next().value);
    }
    return analysis;
  }

  function getDefenseCascadeLayers(position, root, blackOrientation, depth) {
    if (position[root?.row]?.[root?.col]?.type === "king") return [];
    return getHighlightCascadeLayers(position, root, blackOrientation, depth, false);
  }

  function getAttackCascadeLayers(position, root, blackOrientation, depth) {
    return getHighlightCascadeLayers(position, root, blackOrientation, depth, true);
  }

  function getHighlightCascadeLayers(position, root, blackOrientation, depth, isAttack) {
    const rootPiece = position[root?.row]?.[root.col];
    if (!rootPiece) return [];
    const simulated = position.map(row => row.slice());
    let color = isAttack ? rootPiece.color === "w" ? "b" : "w" : rootPiece.color;
    const layers = [[root]];
    let exchangeKing;
    for (let level = 0; level < depth; level++) {
      const next = [];
      const kings = [];
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          if (row === root.row && col === root.col) continue;
          if (simulated[row][col]?.color !== color) continue;
          const source = { row, col };
          if (!canReach(simulated, source, root, blackOrientation)) continue;
          if (simulated[row][col].type === "king") {
            if (isAttack) kings.push(source);
          } else next.push(source);
        }
      }
      // A king must finish the exchange, never vacate its square for a later recapture.
      if (!next.length) {
        for (const source of kings) {
          const capture = applyExchangeCapture(simulated, source, root, blackOrientation).position;
          const opponent = color === "w" ? "b" : "w";
          // Resolve individual captures, not whole waves: other attackers may still remain.
          if (exchangeKing === undefined) exchangeKing = getFinalExchangeKing(position, root, blackOrientation);
          const finishesExchange = exchangeKing?.row === source.row && exchangeKing.col === source.col;
          const unopposedDefense = !isAttack && !isSquareAttacked(position, root, opponent, blackOrientation);
          if (!finishesExchange && !unopposedDefense) continue;
          if (isSquareAttacked(capture, root, opponent, blackOrientation) && !finishesExchange) continue;
          next.push(source);
        }
      }
      if (!next.length) break;
      layers.push(next);
      if (kings.some(king => next.includes(king))) break;
      // Vacated source squares reveal batteries; every later wave still targets the original square.
      for (const source of next) simulated[source.row][source.col] = null;
      if (isAttack) color = color === "w" ? "b" : "w";
    }
    return layers.length > 1 ? layers : [];
  }

  function getHighlightCascadeConnections(position, layers, isAttack, blackOrientation) {
    const root = layers[0]?.[0];
    if (!root) return [];
    const simulated = position.map(row => row.slice());
    const rootPiece = position[root.row][root.col];
    if (!rootPiece) return [];
    const connections = [];
    for (let depth = 1; depth < layers.length; depth++) {
      const opposite = isAttack && depth % 2 === 1;
      const color = opposite ? rootPiece.color === "w" ? "b" : "w" : rootPiece.color;
      const wave = layers[depth].filter(to => simulated[to.row][to.col]?.color === color
        && canReach(simulated, to, root, blackOrientation));
      for (const to of wave) connections.push({ from: root, to, depth });
      for (const to of wave) simulated[to.row][to.col] = null;
    }
    return connections;
  }

  function getDefenseHighlightMix(phase, depth, strengthPercent, decayPercent) {
    return globalThis.LichessHighlightLinePreview.getHighlightMix(phase, depth, strengthPercent, decayPercent);
  }

  function isNewDefensePreviewTarget(entry, targetKey) {
    if (entry.defensePreviewLastTargetKey === targetKey) return false;
    entry.defensePreviewLastTargetKey = targetKey;
    return true;
  }

  function getMoveKey(source, target) {
    return `${source.row},${source.col}:${target.row},${target.col}`;
  }

  function getPreviewMoveKey(preview) {
    return getMoveKey(preview.source, preview.target);
  }

  function screenToLogical(square, blackOrientation) {
    return blackOrientation
      ? { row: 7 - square.row, col: 7 - square.col }
      : square;
  }

  function shouldPlayLastMoveCascade(entry, moveKey, targetAlreadyHighlighted = false) {
    if (!moveKey) {
      entry.defenseLastMoveKey = null;
      entry.defensePlayedMoveKeys.clear();
      return false;
    }
    if (entry.defenseLastMoveKey === moveKey) return false;
    entry.defenseLastMoveKey = moveKey;
    const previewed = entry.defensePlayedMoveKeys.has(moveKey);
    entry.defensePlayedMoveKeys.clear();
    return !previewed && !targetAlreadyHighlighted;
  }

  function markPreviewMovePlayed(entry, preview) {
    if (preview?.legal) entry.defensePlayedMoveKeys.add(getPreviewMoveKey(preview));
  }

  function getLastMove(board, position, blackOrientation) {
    const squares = [...board.querySelectorAll(":scope > square.last-move")]
      .map(element => getScreenSquare(element, board));
    if (squares.length !== 2 || squares.some(square => !square)) return null;
    const occupied = squares.filter(square => position[square.row]?.[square.col]);
    const destination = occupied.length === 1
      ? occupied[0]
      : occupied.length === 2
        ? occupied.find(square => position[square.row][square.col].type === "king")
        : null;
    if (!destination) return null;
    const source = squares.find(square => square !== destination);
    if (!source) return null;
    return {
      source,
      target: destination,
      key: getMoveKey(screenToLogical(source, blackOrientation), screenToLogical(destination, blackOrientation))
    };
  }

  function applyExchangeCapture(position, source, target, blackOrientation) {
    const piece = position[source.row][source.col];
    const nextPosition = position.map(row => row.slice());
    nextPosition[source.row][source.col] = null;
    nextPosition[target.row][target.col] = piece;

    const promotionRow = (piece.color === "w") !== blackOrientation ? 0 : 7;
    const promotes = piece.type === "pawn" && target.row === promotionRow;
    if (promotes) nextPosition[target.row][target.col] = { ...piece, type: "queen" };
    return { position: nextPosition, promotionGain: promotes ? pieceValues.queen - pieceValues.pawn : 0 };
  }

  function isSquareAttacked(position, target, color, blackOrientation) {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (position[row][col]?.color === color
          && canReach(position, { row, col }, target, blackOrientation)) return true;
      }
    }
    return false;
  }

  function canExchangeCapture(position, source, target, blackOrientation) {
    const piece = position[source.row][source.col];
    const victim = position[target.row][target.col];
    if (!piece || !victim || piece.color === victim.color || victim.type === "king"
      || !canReach(position, source, target, blackOrientation)) return false;

    const nextPosition = applyExchangeCapture(position, source, target, blackOrientation).position;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const occupant = nextPosition[row][col];
        if (occupant?.color === piece.color && occupant.type === "king") {
          return !isSquareAttacked(nextPosition, { row, col }, victim.color, blackOrientation);
        }
      }
    }
    return true;
  }

  function getLeastValuableAttacker(position, target, color, blackOrientation) {
    let leastValuable = null;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = position[row][col];
        if (!piece || piece.color !== color) continue;
        if (pieceValues[piece.type] >= (leastValuable?.value ?? Infinity)) continue;
        const source = { row, col };
        if (!canExchangeCapture(position, source, target, blackOrientation)) continue;
        leastValuable = { source, value: pieceValues[piece.type] };
      }
    }
    return leastValuable;
  }

  function getFinalExchangeKing(position, target, blackOrientation) {
    let simulated = position;
    let color = position[target.row][target.col].color === "w" ? "b" : "w";
    while (true) {
      const attacker = getLeastValuableAttacker(simulated, target, color, blackOrientation);
      if (!attacker) return null;
      const piece = simulated[attacker.source.row][attacker.source.col];
      if (piece.type === "king") return attacker.source;
      simulated = applyExchangeCapture(simulated, attacker.source, target, blackOrientation).position;
      color = color === "w" ? "b" : "w";
    }
  }

  // Evaluate captures on one square, allowing either side to stop the exchange.
  function getBestExchangeGain(position, target, color, blackOrientation) {
    const victim = position[target.row][target.col];
    if (!victim || victim.color === color) return 0;
    const attacker = getLeastValuableAttacker(position, target, color, blackOrientation);
    if (!attacker) return 0;

    const capture = applyExchangeCapture(position, attacker.source, target, blackOrientation);
    return Math.max(0, pieceValues[victim.type] + capture.promotionGain
      - getBestExchangeGain(capture.position, target, victim.color, blackOrientation));
  }

  function getCaptureGain(position, source, target, blackOrientation) {
    const piece = position[source.row][source.col];
    const victim = position[target.row][target.col];
    if (!piece || !victim || victim.type === "king" || !canExchangeCapture(position, source, target, blackOrientation)) return null;
    const capture = applyExchangeCapture(position, source, target, blackOrientation);
    return pieceValues[victim.type] + capture.promotionGain
      - getBestExchangeGain(capture.position, target, victim.color, blackOrientation);
  }

  function getBestCaptureGainOutsideSquare(position, previousPosition, color, excludedTarget, threshold, blackOrientation) {
    let bestGain = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (row === excludedTarget.row && col === excludedTarget.col) continue;
        const victim = position[row][col];
        if (!victim || victim.color === color || victim.type === "king"
          || pieceValues[victim.type] + pieceValues.queen - pieceValues.pawn <= bestGain) continue;
        const target = { row, col };
        // Existing capture opportunities are not a consequence of this exchange.
        const gain = getBestExchangeGain(position, target, color, blackOrientation)
          - getBestExchangeGain(previousPosition, target, color, blackOrientation);
        if (gain > bestGain) bestGain = gain;
        if (bestGain > threshold) return bestGain;
      }
    }
    return bestGain;
  }

  function getExchangeWinningAttacker(position, target, blackOrientation) {
    const victim = position[target.row][target.col];
    if (!victim || victim.type === "king") return null;
    const victimValue = pieceValues[victim.type];

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const attacker = position[row][col];
        if (!attacker || attacker.color === victim.color) continue;
        const source = { row, col };
        if (!canExchangeCapture(position, source, target, blackOrientation)) continue;

        const capture = applyExchangeCapture(position, source, target, blackOrientation);
        const gain = victimValue + capture.promotionGain
          - getBestExchangeGain(capture.position, target, victim.color, blackOrientation);
        if (gain <= 0) continue;
        const counterCaptureGain = getBestCaptureGainOutsideSquare(
          capture.position,
          position,
          victim.color,
          target,
          gain,
          blackOrientation
        );
        if (counterCaptureGain <= gain) return attacker.color;
      }
    }
    return null;
  }

  function shouldFilterHatchedThreats() {
    return settings?.threatCenterOutlineStyle === "hatching"
      && settings?.threatCenterHatchExchangeFilterEnabled;
  }

  function getSelectedCaptureTargets(position, selected, blackOrientation) {
    const piece = selected && position[selected.row]?.[selected.col];
    if (!piece) return new Set();
    return new Set(getAttackedPieces(position, selected, blackOrientation)
      .filter(target => {
        const targetPiece = position[target.row][target.col];
        return targetPiece.color !== piece.color && targetPiece.type !== "king";
      })
      .map(target => `${target.row},${target.col}`));
  }

  function shouldRestrictHatchedThreatsToSelectedPiece() {
    return settings?.threatCenterOutlineStyle === "hatching"
      && settings?.threatCenterHatchOnlySelectedCanCapture;
  }

  // Include attacks from cheaper pieces even when the target has defenders.
  function getOverloadedPieces(position, blackOrientation, filterByWinningExchange = false) {
    const counts = new Map();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sourcePiece = position[row][col];
        if (!sourcePiece) continue;
        const source = { row, col };
        for (const target of getAttackedPieces(position, source, blackOrientation)) {
          const targetPiece = position[target.row][target.col];
          const key = `${target.row},${target.col}`;
          if (!counts.has(key)) counts.set(key, { target, defenders: 0, attackers: [] });
          if (targetPiece.color === sourcePiece.color) counts.get(key).defenders++;
          else counts.get(key).attackers.push(sourcePiece);
        }
      }
    }

    const overloaded = [];
    for (const { target, defenders, attackers } of counts.values()) {
      const targetPiece = position[target.row][target.col];
      const cheaperAttacker = targetPiece.type === "king"
        ? null
        : attackers.find(attacker => pieceValues[attacker.type] < pieceValues[targetPiece.type]);
      if (cheaperAttacker) overloaded.push({ target, color: cheaperAttacker.color });
      else if (attackers.length > defenders) overloaded.push({ target, color: attackers[0].color });
    }
    if (!filterByWinningExchange) return overloaded;
    return overloaded.flatMap(({ target }) => {
      const color = getExchangeWinningAttacker(position, target, blackOrientation);
      return color ? [{ target, color }] : [];
    });
  }

  function clearThreatenedPieceOutline(element) {
    element.removeAttribute("data-lfs-threatened-piece");
  }

  function updateThreatenedPieces(board, position, dragPreview, threatened, enabled, blackOrientation) {
    const threats = [];
    for (const element of board.querySelectorAll(":scope > piece")) {
      if (!enabled) {
        clearThreatenedPieceOutline(element);
        continue;
      }

      let square;
      if (dragPreview && element.classList.contains("ghost")) {
        if (dragPreview.legal) {
          clearThreatenedPieceOutline(element);
          continue;
        }
        square = logicalToScreen(dragPreview.source, dragPreview.blackOrientation);
      } else if (dragPreview && element.classList.contains("dragging")) {
        if (!dragPreview.legal) {
          clearThreatenedPieceOutline(element);
          continue;
        }
        square = logicalToScreen(dragPreview.target, dragPreview.blackOrientation);
      } else {
        if (element.classList.contains("ghost") || element.classList.contains("fading")) {
          clearThreatenedPieceOutline(element);
          continue;
        }
        square = getPieceScreenSquare(element, board, blackOrientation);
      }

      const piece = getPiece(element);
      const occupant = square && position[square.row]?.[square.col];
      const attackers = piece && occupant?.color === piece.color && occupant.type === piece.type
        ? threatened[piece.color].get(`${square.row},${square.col}`)
        : undefined;
      if (attackers) {
        if (element.getAttribute("data-lfs-threatened-piece") !== piece.color) {
          element.setAttribute("data-lfs-threatened-piece", piece.color);
        }
        threats.push({ square, color: piece.color, type: piece.type, attackers });
      } else clearThreatenedPieceOutline(element);
    }
    if (enabled && dragPreview?.isHoverPreview
      && (dragPreview.target.row !== dragPreview.source.row || dragPreview.target.col !== dragPreview.source.col)) {
      const square = logicalToScreen(dragPreview.target, dragPreview.blackOrientation);
      const piece = position[square.row]?.[square.col];
      const attackers = piece && threatened[piece.color].get(`${square.row},${square.col}`);
      if (attackers) threats.push({ square, color: piece.color, type: piece.type, attackers });
    }
    return threats;
  }


  function clearMoveDestinationMarkers(board) {
    for (const square of board.querySelectorAll(":scope > square[data-lfs-contested-move-dest]")) {
      square.removeAttribute("data-lfs-contested-move-dest");
    }
  }

  function createMovePreview(position, source, target, blackOrientation) {
    const preview = position.map(row => [...row]);
    const piece = preview[source.row][source.col];
    if (!piece) return null;

    const pawnDirection = (piece.color === "w") !== blackOrientation ? -1 : 1;
    if (piece.type === "pawn" && source.col !== target.col && !preview[target.row][target.col]) {
      const capturedRow = target.row - pawnDirection;
      if (preview[capturedRow]?.[target.col]?.color !== piece.color
        && preview[capturedRow]?.[target.col]?.type === "pawn") {
        preview[capturedRow][target.col] = null;
      }
    }

    preview[source.row][source.col] = null;
    preview[target.row][target.col] = piece;

    if (piece.type === "king" && source.row === target.row && Math.abs(target.col - source.col) === 2) {
      const rookSourceCol = target.col > source.col ? 7 : 0;
      const rookTargetCol = target.col > source.col ? target.col - 1 : target.col + 1;
      const rook = preview[source.row][rookSourceCol];
      if (rook?.color === piece.color && rook.type === "rook") {
        preview[source.row][rookSourceCol] = null;
        preview[source.row][rookTargetCol] = rook;
      }
    }

    if (piece.type === "pawn" && target.row === (pawnDirection < 0 ? 0 : 7)) {
      preview[target.row][target.col] = { ...piece, type: "queen" };
    }
    return preview;
  }

  function getMoveDestinationLines(board, position, source, blackOrientation) {
    const piece = position[source.row]?.[source.col];
    if (!piece) return { targetKeys: new Set(), threats: [], defenseSegments: [] };

    const destinations = [...board.querySelectorAll(":scope > square.move-dest")]
      .map(square => ({ square, target: getScreenSquare(square, board) }))
      .filter(({ target }) => target);
    const positionKey = getPositionKey(position);
    const destinationKey = destinations.map(({ target }) => `${target.row},${target.col}`).join(";");
    const cacheKey = `${positionKey}:${source.row},${source.col}:${blackOrientation}:${destinationKey}:${settings.threatenedPieceOutlineEnabled}:${settings.defenseCirclesEnabled}:${settings.threatMoveFieldDisplayMode}:${settings.threatMoveFieldRadius}:${settings.whitePieceColor}:${settings.blackPieceColor}`;
    const cached = moveDestinationPreviewCache.get(board);
    if (cached?.key === cacheKey) {
      for (const { square, target } of destinations) {
        if (cached.result.targetKeys.has(`${target.row},${target.col}`)) square.setAttribute("data-lfs-contested-move-dest", "");
      }
      return cached.result;
    }

    const result = { targetKeys: new Set(), threats: [], defenseSegments: [] };
    const checkedTargets = new Set();
    for (const { target } of destinations) {
      const targetKey = `${target.row},${target.col}`;
      if (checkedTargets.has(targetKey)) continue;
      checkedTargets.add(targetKey);

      const preview = createMovePreview(position, source, target, blackOrientation);
      if (!preview) continue;
      const moveFieldRadius = position[target.row][target.col] ? undefined : settings.threatMoveFieldRadius;
      const attackers = settings.threatenedPieceOutlineEnabled && showsMoveFieldLines()
        ? getThreatenedSquares(preview, blackOrientation)[piece.color].get(targetKey) ?? []
        : [];
      const defenders = settings.defenseCirclesEnabled && piece.type !== "king" && showsMoveFieldLines()
        ? getDefenseConnections(preview, blackOrientation, true)
          .filter(connection => connection.target.row === target.row && connection.target.col === target.col)
        : [];
      if (!attackers.length && !defenders.length) continue;

      result.targetKeys.add(targetKey);
      if (attackers.length) {
        result.threats.push({ square: target, color: piece.color, type: preview[target.row][target.col].type, attackers, figureBlend: 0, moveFieldRadius });
      }
      result.defenseSegments.push(...defenders.map(connection => ({
        target: connection.target,
        source: connection.source,
        angle: Math.atan2(connection.source.row - connection.target.row, connection.source.col - connection.target.col),
        type: preview[target.row][target.col].type,
        sourceType: preview[connection.source.row][connection.source.col].type,
        color: connection.color === "w" ? settings.whitePieceColor : settings.blackPieceColor,
        figureBlend: 0,
        moveFieldRadius
      })));
    }
    for (const { square, target } of destinations) {
      if (result.targetKeys.has(`${target.row},${target.col}`)) square.setAttribute("data-lfs-contested-move-dest", "");
    }
    moveDestinationPreviewCache.set(board, { key: cacheKey, result });
    return result;
  }

  function syncCenterOutlineImage(image, transforms = new Map()) {
    const piece = image._lfsPieceElement;
    if (!piece) {
      image.style.removeProperty("transform");
      return;
    }

    let transform = transforms.get(piece);
    if (!transform) {
      transform = getComputedStyle(piece, "::before").transform;
      transforms.set(piece, transform);
    }
    if (image.style.transform !== transform) image.style.transform = transform;
    image.style.transformOrigin = "center";
    image.style.transformBox = "fill-box";
  }

  function showsMoveFieldLines() {
    return settings?.threatMoveFieldDisplayMode === "both" || settings?.threatMoveFieldDisplayMode === "lines";
  }

  function showsMoveFieldHatch() {
    return settings?.threatMoveFieldDisplayMode === "both" || settings?.threatMoveFieldDisplayMode === "hatch";
  }

  function getDraggingPiece(board) {
    return board.querySelector(":scope > piece.dragging")
      ?? board.closest(".cg-wrap")?.querySelector(":scope > piece.dragging")
      ?? null;
  }


  function clearMoveOutlineMarkers(board) {
    for (const square of board.querySelectorAll(":scope > square[data-lfs-move-outline]")) {
      square.removeAttribute("data-lfs-move-outline");
    }
  }

  function updateMoveOutlinePreviews(board, position, source, piece, blackOrientation) {
    clearMoveOutlineMarkers(board);
    const markWidth = settings?.threatCenterOutlineStyle === "hatching"
      ? settings.threatCenterHatchThicknessPercent
      : settings?.threatCenterOutlineWidthPercent;
    const invisibleOutline = settings?.threatCenterOutlineStyle !== "hatching" && !settings?.threatCenterOutlineOpacity;
    if (!settings?.threatCenterOutlineEnabled || !showsMoveFieldHatch() || !markWidth || invisibleOutline || !source || !piece
      || shouldRestrictHatchedThreatsToSelectedPiece()) return [];

    const pieceElement = piece.element ?? getDraggingPiece(board);
    const previews = [];
    const checkedTargets = new Set();
    for (const square of board.querySelectorAll(":scope > square.move-dest, :scope > square.premove-dest")) {
      const target = getScreenSquare(square, board);
      if (!target) continue;
      const targetKey = `${target.row},${target.col}`;
      if (checkedTargets.has(targetKey)) continue;
      checkedTargets.add(targetKey);

      const nextPosition = createMovePreview(position, source, target, blackOrientation);
      if (!nextPosition) continue;
      const outline = getOverloadedPieces(nextPosition, blackOrientation, shouldFilterHatchedThreats())
        .find(candidate => candidate.target.row === target.row && candidate.target.col === target.col);
      if (!outline) continue;

      const outlineValue = `${outline.color}:${piece.color}:${piece.type}`;
      square.setAttribute("data-lfs-move-outline", outlineValue);
      previews.push({
        ...outline,
        piece: { ...piece, element: pieceElement },
        moveOutlinePreview: true
      });
    }
    return previews;
  }

  function getFreeFieldMoves(position, source, piece, blackOrientation) {
    const moves = [];
    const pawnDirection = (piece.color === "w") !== blackOrientation ? -1 : 1;
    if (piece.type === "pawn") {
      const startRow = (piece.color === "w") !== blackOrientation ? 6 : 1;
      const oneStep = source.row + pawnDirection;
      if (oneStep < 0 || oneStep > 7 || position[oneStep][source.col]) return moves;
      moves.push({ row: oneStep, col: source.col });
      const twoStep = source.row + pawnDirection * 2;
      if (source.row === startRow && !position[twoStep][source.col]) {
        moves.push({ row: twoStep, col: source.col });
      }
      return moves;
    }

    const directions = pieceDirections[piece.type];
    const sliding = Boolean(slidingDirections[piece.type]);

    for (const [dr, dc] of directions) {
      let row = source.row + dr;
      let col = source.col + dc;
      while (row >= 0 && row < 8 && col >= 0 && col < 8 && !position[row][col]) {
        moves.push({ row, col });
        if (!sliding) break;
        row += dr;
        col += dc;
      }
    }
    return moves;
  }

  function getCandidateMoves(position, source, piece, blackOrientation) {
    const captures = getAttackedPieces(position, source, blackOrientation).filter(target => {
      const victim = position[target.row][target.col];
      return victim && victim.color !== piece.color && victim.type !== "king"
        && canExchangeCapture(position, source, target, blackOrientation);
    });
    return [...getFreeFieldMoves(position, source, piece, blackOrientation), ...captures];
  }

  function getPotentialWedges(position, selected, destinations, blackOrientation, options = {}) {
    const piece = position[selected.row][selected.col];
    const attackerValue = pieceValues[piece.type];
    const currentTargets = new Set(getAttackedPieces(position, selected, blackOrientation)
      .filter(target => {
        const targetPiece = position[target.row][target.col];
        return targetPiece && targetPiece.color !== piece.color && pieceValues[targetPiece.type] > attackerValue;
      })
      .map(target => `${target.row},${target.col}`));
    const candidates = [];

    for (const destination of destinations) {
      const destinationPiece = position[destination.row][destination.col];
      if (destinationPiece?.color === piece.color || destinationPiece?.type === "king") continue;
      const simulated = createMovePreview(position, selected, destination, blackOrientation);
      if (!simulated) continue;
      const attacks = getAttackedPieces(simulated, destination, blackOrientation)
        .filter(target => {
          const targetPiece = simulated[target.row][target.col];
          if (!targetPiece || targetPiece.color === piece.color) return false;
          return pieceValues[targetPiece.type] > attackerValue;
        });
      if (!attacks.length) continue;
      const officers = attacks.filter(target => pieceValues[simulated[target.row][target.col].type] >= 3);
      const fork = officers.length >= 2;
      const givesCheckAfterCapture = Boolean(destinationPiece)
        && attacks.some(target => simulated[target.row][target.col].type === "king");
      if (!fork && attacks.some(target => currentTargets.has(`${target.row},${target.col}`))) continue;
      const targets = fork ? officers : attacks;
      let attackers = 0;
      let defenders = 0;
      let minAttackerValue = Infinity;
      let kingInCheck = false;

      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const other = simulated[row][col];
          if (!other || (row === destination.row && col === destination.col)) continue;
          const otherAttacks = getAttackedPieces(simulated, { row, col }, blackOrientation);
          if (other.color !== piece.color && otherAttacks.some(target => {
            const occupant = simulated[target.row][target.col];
            return occupant?.color === piece.color && occupant.type === "king";
          })) kingInCheck = true;
          if (!otherAttacks.some(target => target.row === destination.row && target.col === destination.col)) continue;
          if (other.color === piece.color) defenders++;
          else {
            attackers++;
            minAttackerValue = Math.min(minAttackerValue, pieceValues[other.type]);
          }
        }
      }
      if (kingInCheck) continue;
      if (!givesCheckAfterCapture
        && ((attackers > 0 && attackerValue >= minAttackerValue) || attackers > defenders)) continue;
      if (piece.type !== "king"
        && getBestExchangeGain(simulated, destination, piece.color === "w" ? "b" : "w", blackOrientation) > 0) continue;
      candidates.push({
        source: destination,
        targets,
        fork,
        bestValue: Math.max(...targets.map(target => pieceValues[simulated[target.row][target.col].type])),
        distance: Math.max(Math.abs(destination.row - selected.row), Math.abs(destination.col - selected.col))
      });
    }

    // Prefer forks, then valuable targets and shorter moves, as in the visualization.
    candidates.sort((a, b) => Number(b.fork) - Number(a.fork) || b.bestValue - a.bestValue || a.distance - b.distance);
    const picked = [];
    for (const candidate of candidates) {
      if (picked.length >= (options.wedgePotentialPerPieceCount ?? 1)) break;
      picked.push(candidate);
    }
    const targetClass = value => value >= 100 ? 4 : value >= 9 ? 3 : value >= 5 ? 2 : 1;
    const highestClass = Math.max(0, ...picked.map(candidate => targetClass(candidate.bestValue)));
    return picked.filter(candidate => options.wedgePotentialStrategy === "waterfall"
      ? targetClass(candidate.bestValue) === highestClass
      : candidate.bestValue >= (options.wedgePotentialCutoffValue ?? 1))
      .flatMap(candidate => candidate.targets.map(target => ({ source: candidate.source, target, type: piece.type })));
  }

  function getUnselectedPotentialWedges(position, blackOrientation, options) {
    const wedgesByColor = { w: [], b: [] };
    const potentialMovesByColor = { w: new Set(), b: new Set() };
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = position[row][col];
        if (!piece || potentialMovesByColor[piece.color].size >= maxUnselectedPotentialMovesPerColor) continue;
        const source = { row, col };
        const destinations = getCandidateMoves(position, source, piece, blackOrientation);
        const potential = getPotentialWedges(position, source, destinations, blackOrientation, options);
        for (const wedge of potential) {
          const moveKey = `${row},${col}:${wedge.source.row},${wedge.source.col}`;
          if (!potentialMovesByColor[piece.color].has(moveKey)) {
            if (potentialMovesByColor[piece.color].size >= maxUnselectedPotentialMovesPerColor) break;
            potentialMovesByColor[piece.color].add(moveKey);
          }
          wedgesByColor[piece.color].push({ ...wedge, color: piece.color });
        }
      }
    }
    return [...wedgesByColor.w, ...wedgesByColor.b];
  }

  // Shifts both wedge ends along the wedge direction, measured as a percentage of the field width.
  function getWedgeEnds(sourceCenter, targetCenter, sourceVerticalOffset = 0) {
    const baseCenter = { ...sourceCenter, y: sourceCenter.y + sourceVerticalOffset };
    const dx = targetCenter.x - baseCenter.x;
    const dy = targetCenter.y - baseCenter.y;
    const length = Math.max(0.0001, Math.hypot(dx, dy));
    const unitX = dx / length;
    const unitY = dy / length;
    const startOffset = settings.wedgeStartOffsetPercent / 100;
    const endOffset = settings.wedgeEndOffsetPercent / 100;
    return {
      source: { x: baseCenter.x + unitX * startOffset, y: baseCenter.y + unitY * startOffset },
      target: { x: targetCenter.x - unitX * endOffset, y: targetCenter.y - unitY * endOffset }
    };
  }

  function createWedgeGeometry(source, target, baseWidth, tipWidth) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.max(0.0001, Math.hypot(dx, dy));
    const unitX = dx / length;
    const unitY = dy / length;
    const normalX = -unitY;
    const normalY = unitX;
    const halfBase = Math.max(0.0001, baseWidth) / 2;
    const halfTip = Math.max(0.0001, tipWidth) / 2;
    const roundedBaseX = source.x - unitX * halfBase * Math.SQRT2;
    const roundedBaseY = source.y - unitY * halfBase * Math.SQRT2;

    return [
      `M ${source.x + normalX * halfBase} ${source.y + normalY * halfBase}`,
      `L ${target.x + normalX * halfTip} ${target.y + normalY * halfTip}`,
      `L ${target.x - normalX * halfTip} ${target.y - normalY * halfTip}`,
      `L ${source.x - normalX * halfBase} ${source.y - normalY * halfBase}`,
      `Q ${roundedBaseX} ${roundedBaseY} ${source.x + normalX * halfBase} ${source.y + normalY * halfBase}`,
      "Z"
    ].join(" ");
  }

  // Keeps the long leg of a knight move straight before bending toward its short leg.
  function createKnightWedgeGeometry(source, target, baseWidth, tipWidth) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const horizontalLongLeg = Math.abs(dx) > Math.abs(dy);
    const longControlDistance = Math.max(Math.abs(dx), Math.abs(dy)) / 2;
    const shortControlDistance = Math.min(Math.abs(dx), Math.abs(dy)) / 2;
    const firstControl = horizontalLongLeg
      ? { x: source.x + Math.sign(dx) * longControlDistance, y: source.y }
      : { x: source.x, y: source.y + Math.sign(dy) * longControlDistance };
    const secondControl = horizontalLongLeg
      ? { x: target.x, y: target.y - Math.sign(dy) * shortControlDistance }
      : { x: target.x - Math.sign(dx) * shortControlDistance, y: target.y };
    const curve = [source, firstControl, secondControl, target];
    const left = [];
    const right = [];
    const samples = 16;
    for (let index = 0; index <= samples; index++) {
      const t = index / samples;
      const point = getCubicPoint(curve, t);
      const inverse = 1 - t;
      const tangentX = 3 * inverse * inverse * (firstControl.x - source.x)
        + 6 * inverse * t * (secondControl.x - firstControl.x)
        + 3 * t * t * (target.x - secondControl.x);
      const tangentY = 3 * inverse * inverse * (firstControl.y - source.y)
        + 6 * inverse * t * (secondControl.y - firstControl.y)
        + 3 * t * t * (target.y - secondControl.y);
      const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentY));
      const halfWidth = (baseWidth * (1 - t) + tipWidth * t) / 2;
      const normalX = -tangentY / tangentLength;
      const normalY = tangentX / tangentLength;
      left.push({ x: point.x + normalX * halfWidth, y: point.y + normalY * halfWidth });
      right.push({ x: point.x - normalX * halfWidth, y: point.y - normalY * halfWidth });
    }

    const startTangentLength = Math.max(0.0001, Math.hypot(firstControl.x - source.x, firstControl.y - source.y));
    const roundedBase = {
      x: source.x - (firstControl.x - source.x) / startTangentLength * baseWidth / 2 * Math.SQRT2,
      y: source.y - (firstControl.y - source.y) / startTangentLength * baseWidth / 2 * Math.SQRT2
    };
    return [
      `M ${left[0].x} ${left[0].y}`,
      ...left.slice(1).map(point => `L ${point.x} ${point.y}`),
      ...right.reverse().map(point => `L ${point.x} ${point.y}`),
      `Q ${roundedBase.x} ${roundedBase.y} ${left[0].x} ${left[0].y}`,
      "Z"
    ].join(" ");
  }

  function mixWithWhite(hex, weight) {
    const channels = globalThis.LichessColors.toRgb(hex);
    if (!channels) return "oklch(1 0 0)";
    const mixed = channels.map(channel => {
      // Preserve RGB8 rounding at half steps after the OKLCH round trip.
      const value = Math.abs(channel - Math.round(channel)) < 0.001 ? Math.round(channel) : channel;
      return Math.round(value * weight + 255 * (1 - weight));
    });
    return globalThis.LichessColors.format(globalThis.LichessColors.fromRgb(mixed));
  }

  function createOverlay() {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.classList.add("lfs-selected-piece-wedge");
    svg.setAttribute("viewBox", "0 0 8 8");
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }

  // Directional outline radii prevent pointed figures from using their maximum radius in every direction.
  function measureOutlineRadii(svgText) {
    const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
    const svg = document.importNode(parsed, true);
    const { x, y, width, height } = svg.viewBox.baseVal;
    svg.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
    document.documentElement.append(svg);
    const svgMatrix = svg.getScreenCTM().inverse();
    const center = { x: x + width / 2, y: y + height / 2 };
    const angularSteps = 720;
    const radii = Array(angularSteps).fill(0);
    for (const path of svg.querySelectorAll("path")) {
      const toViewBox = svgMatrix.multiply(path.getScreenCTM());
      const length = path.getTotalLength();
      const steps = 2000;
      for (let step = 0; step <= steps; step++) {
        const point = path.getPointAtLength(length * step / steps).matrixTransform(toViewBox);
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
        const bucket = Math.round(angle / (Math.PI * 2) * angularSteps) % angularSteps;
        const radius = Math.hypot(dx, dy);
        for (const offset of [-1, 0, 1]) {
          const index = (bucket + offset + angularSteps) % angularSteps;
          radii[index] = Math.max(radii[index], radius);
        }
      }
    }
    svg.remove();
    return radii.map(radius => radius / Math.max(width, height));
  }

  const figureAssetLetters = { pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k" };
  const roundKingInnerRadius = 5 / 14;
  // Normalized visible-content bounds from each cage SVG after its nested transforms.
  const cagePieceBounds = {
    p: [0.19615882, 0.29301634, 0.79673710, 0.74636993],
    n: [0.14241435, 0.14241039, 0.85290008, 0.85289861],
    b: [0.14221704, 0.14241220, 0.85309716, 0.85289664],
    r: [0.14221585, 0.14241192, 0.85309753, 0.85329284],
    q: [0.14241301, 0.14241039, 0.85289572, 0.85289299]
  };
  const figureRadiiCache = new Map();

  // Directional radii per figure type, merged across the white and black SVGs the extension ships.
  function getFigureRadii(pieceSet) {
    if (!figureRadiiCache.has(pieceSet)) {
      const radii = new Map();
      figureRadiiCache.set(pieceSet, radii);
      const figures = Object.entries(figureAssetLetters).filter(([type]) => pieceSet !== "cage" || type !== "king");
      const colors = ["cage", "system_rund"].includes(pieceSet) ? ["w"] : ["w", "b"];
      Promise.all(figures.flatMap(([type, letter]) => colors.map(async color => {
        if (pieceSet === "system_rund" && type !== "pawn") {
          radii.set(type, Array(720).fill(roundKingInnerRadius));
          return;
        }
        const response = await fetch(chrome.runtime.getURL(globalThis.LichessSettings.getPieceAsset({ pieceSet }, color, letter)));
        const measured = measureOutlineRadii(await response.text());
        const previous = radii.get(type);
        radii.set(type, previous ? measured.map((radius, index) => Math.max(radius, previous[index])) : measured);
      }))).then(() => {
        for (const board of observedBoards.keys()) scheduleRender(board);
      });
    }
    return figureRadiiCache.get(pieceSet);
  }

  function getMaximumFigureRadius(figureRadii, type) {
    const radii = figureRadii.get(type);
    if (!radii) return undefined;
    return radii.reduce((maximum, radius) => Math.max(maximum, radius), 0);
  }

  function assignSegmentLanes(segments) {
    const groups = new Map();
    return segments.map(segment => {
      const direction = `${Math.cos(segment.angle).toFixed(4)},${Math.sin(segment.angle).toFixed(4)}`;
      const key = `${segment.target.row},${segment.target.col},${direction}`;
      const group = groups.get(key) ?? { count: 0 };
      const assigned = { ...segment, lane: group.count, categoryGapCount: group.count };
      group.count++;
      groups.set(key, group);
      return assigned;
    });
  }

  // Segments stay outside the figure outline; if their inner edge would touch it, they move out by the margin.
  // figureBlend 0 keeps the configured default radius, 1 applies the figure-based radius; values in between are animated.
  const figureBlendStep = 0.2;

  // Moves every field's blend one step toward 1 for the hovered empty field and toward 0 otherwise; returns true while animating.
  function advanceFigureBlends(entry, hoverFieldKey) {
    const startsAtConfiguredRadius = hoverFieldKey && !entry.figureBlends.has(hoverFieldKey);
    if (startsAtConfiguredRadius) entry.figureBlends.set(hoverFieldKey, 0);
    let animating = false;
    for (const [key, value] of entry.figureBlends) {
      const goal = key === hoverFieldKey ? 1 : 0;
      if (startsAtConfiguredRadius && key === hoverFieldKey) {
        animating = true;
        continue;
      }
      const next = value + Math.sign(goal - value) * Math.min(Math.abs(goal - value), figureBlendStep);
      if (next === goal) {
        if (goal === 0) entry.figureBlends.delete(key);
        else entry.figureBlends.set(key, next);
      } else {
        entry.figureBlends.set(key, next);
        animating = true;
      }
    }
    return animating;
  }

  function blendRadius(configured, figureBased, segment) {
    const blend = segment.figureBlend ?? 1;
    return configured + (figureBased - configured) * blend;
  }

  function getSegmentRadius(radius, figureRadius) {
    if (figureRadius === undefined || radius >= figureRadius) return radius;
    return figureRadius + settings.segmentFigureMargin;
  }

  function createArcGeometry(center, innerRadius, outerRadius, start, end) {
    const point = (radius, angle) => `${center.x + Math.cos(angle) * radius} ${center.y + Math.sin(angle) * radius}`;
    const largeArc = end - start > Math.PI ? 1 : 0;
    return [
      `M ${point(outerRadius, start)}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${point(outerRadius, end)}`,
      `L ${point(innerRadius, end)}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${point(innerRadius, start)}`,
      "Z"
    ].join(" ");
  }

  // Shrink overlapping or touching sectors around each target so adjacent edges are separated by the configured gap.
  function getSegmentHalfAngles(segments, maxHalfAngle, gapPercent, minimumGapAngles = new Map()) {
    const halfAngles = Array.from({ length: segments.length }, () => ({ before: maxHalfAngle, after: maxHalfAngle }));
    const byTarget = new Map();
    segments.forEach((segment, index) => {
      const key = `${segment.target.row},${segment.target.col}`;
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push({ index, angle: (segment.angle + Math.PI * 2) % (Math.PI * 2) });
    });

    const configuredGapAngle = maxHalfAngle * 2 * gapPercent / 100;
    const sameAngle = 0.0001;
    for (const items of byTarget.values()) {
      const sorted = items.sort((a, b) => a.angle - b.angle);
      const targetKey = `${segments[sorted[0].index].target.row},${segments[sorted[0].index].target.col}`;
      const gapAngle = gapPercent > 0
        ? Math.max(configuredGapAngle, minimumGapAngles.get(targetKey) ?? 0)
        : 0;
      const groups = [];
      for (const item of sorted) {
        const group = groups[groups.length - 1];
        if (group && item.angle - group.angle < sameAngle) group.items.push(item);
        else groups.push({ angle: item.angle, items: [item] });
      }
      if (groups.length > 1 && groups[0].angle + Math.PI * 2 - groups[groups.length - 1].angle < sameAngle) {
        groups[0].items.push(...groups.pop().items);
      }
      if (groups.length < 2) continue;

      for (let index = 0; index < groups.length; index++) {
        const angle = groups[index].angle;
        const previous = groups[(index - 1 + groups.length) % groups.length].angle;
        const next = groups[(index + 1) % groups.length].angle;
        const previousGap = (angle - previous + Math.PI * 2) % (Math.PI * 2);
        const nextGap = (next - angle + Math.PI * 2) % (Math.PI * 2);
        // Only the side facing a colliding neighbour is shortened; the opposite side keeps the full half angle.
        const before = previousGap <= maxHalfAngle * 2 + sameAngle ? Math.max(0, (previousGap - gapAngle) / 2) : maxHalfAngle;
        const after = nextGap <= maxHalfAngle * 2 + sameAngle ? Math.max(0, (nextGap - gapAngle) / 2) : maxHalfAngle;
        for (const item of groups[index].items) halfAngles[item.index] = { before, after };
      }
    }
    return halfAngles;
  }

  function renderSegmentSet(svg, segments, figureRadii, highlightEndpoints) {
    const layeredSegments = assignSegmentLanes(segments);
    const minimumGapAngles = new Map();
    for (const segment of layeredSegments) {
      const targetKey = `${segment.target.row},${segment.target.col}`;
      const figureRadius = getMaximumFigureRadius(figureRadii, segment.type);
      const configuredRadius = segment.moveFieldRadius ?? settings.threatArcRadius;
      const radius = blendRadius(configuredRadius, getSegmentRadius(configuredRadius, figureRadius), segment);
      const middleRadius = radius + settings.threatArcThickness / 2;
      // Keep a nonzero gap at least one segment thickness wide around each target.
      const visibleGapAngle = 2 * Math.asin(Math.min(1, settings.threatArcThickness / (2 * middleRadius)));
      minimumGapAngles.set(targetKey, Math.max(minimumGapAngles.get(targetKey) ?? 0, visibleGapAngle));
    }
    const halfAngles = getSegmentHalfAngles(
      layeredSegments.map(({ target, angle }) => ({ target, angle })),
      settings.threatArcAngleDeg * Math.PI / 360,
      settings.threatArcGapPercent,
      minimumGapAngles
    );
    const laneSpacing = settings.threatArcThickness * (1 + settings.threatArcRadialGapPercent / 100);

    for (const [index, segment] of layeredSegments.entries()) {
      const center = { x: segment.target.col + 0.5, y: segment.target.row + 0.5 };
      const figureRadius = getMaximumFigureRadius(figureRadii, segment.type);
      const configuredRadius = segment.moveFieldRadius ?? settings.threatArcRadius;
      const radius = blendRadius(configuredRadius, getSegmentRadius(configuredRadius, figureRadius), segment);
      const categorySpacing = radius * settings.threatArcAngleDeg * Math.PI / 180 * settings.threatArcGapPercent / 100;
      const innerRadius = radius + segment.lane * laneSpacing + segment.categoryGapCount * categorySpacing;
      const outerRadius = innerRadius + settings.threatArcThickness;
      const path = document.createElementNS(svgNamespace, "path");
      path.setAttribute("d", createArcGeometry(
        center,
        innerRadius,
        outerRadius,
        segment.angle - halfAngles[index].before,
        segment.angle + halfAngles[index].after
      ));
      path.setAttribute("fill", segment.color);
      path.setAttribute("pointer-events", "none");
      svg.append(path);
      if (segment.source) highlightEndpoints?.set(`${segment.target.row},${segment.target.col}:${segment.source.row},${segment.source.col}`, {
        x: center.x + Math.cos(segment.angle) * outerRadius,
        y: center.y + Math.sin(segment.angle) * outerRadius
      });
    }
  }

  function getRoundedSquarePerimeter(radius, cornerRadius) {
    const halfSize = radius;
    if (!Number.isFinite(halfSize) || halfSize <= 0.000001 || !Number.isFinite(cornerRadius)) {
      return { points: [], distances: [], length: 0 };
    }
    cornerRadius = Math.max(0, Math.min(halfSize, cornerRadius));
    const points = [];
    const addPoint = point => {
      const previous = points[points.length - 1];
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.000001) points.push(point);
    };
    const addCorner = (centerX, centerY, startAngle, endAngle) => {
      const steps = Math.max(1, Math.ceil(16 * Math.abs(endAngle - startAngle) / (Math.PI / 2)));
      for (let step = 1; step <= steps; step++) {
        const angle = startAngle + (endAngle - startAngle) * step / steps;
        addPoint({ x: centerX + Math.cos(angle) * cornerRadius, y: centerY + Math.sin(angle) * cornerRadius });
      }
    };

    addPoint({ x: -halfSize + cornerRadius, y: -halfSize });
    addPoint({ x: halfSize - cornerRadius, y: -halfSize });
    addCorner(halfSize - cornerRadius, -halfSize + cornerRadius, -Math.PI / 2, 0);
    addPoint({ x: halfSize, y: halfSize - cornerRadius });
    addCorner(halfSize - cornerRadius, halfSize - cornerRadius, 0, Math.PI / 2);
    addPoint({ x: -halfSize + cornerRadius, y: halfSize });
    addCorner(-halfSize + cornerRadius, halfSize - cornerRadius, Math.PI / 2, Math.PI);
    addPoint({ x: -halfSize, y: -halfSize + cornerRadius });
    addCorner(-halfSize + cornerRadius, -halfSize + cornerRadius, Math.PI, Math.PI * 1.5);
    const lastPoint = points[points.length - 1];
    if (Math.hypot(points[0].x - lastPoint.x, points[0].y - lastPoint.y) < 0.000001) points.pop();

    const distances = [0];
    for (let index = 1; index < points.length; index++) {
      distances.push(distances[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
    }
    const closingLength = Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y);
    return { points, distances, length: distances[distances.length - 1] + closingLength };
  }

  function getSquarePerimeterIntersection(perimeter, angle, offset = 0) {
    if (!perimeter?.points?.length || !Number.isFinite(angle) || !Number.isFinite(offset)) {
      return { radius: Infinity, distance: 0 };
    }
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const normal = { x: -direction.y, y: direction.x };
    const lineOrigin = { x: normal.x * offset, y: normal.y * offset };
    let closestDistance = Infinity;
    let perimeterDistance = 0;
    for (let index = 0; index < perimeter.points.length; index++) {
      const start = perimeter.points[index];
      const end = perimeter.points[(index + 1) % perimeter.points.length];
      if (!start || !end || !Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(end.x) || !Number.isFinite(end.y)) continue;
      const edge = { x: end.x - start.x, y: end.y - start.y };
      const relativeStart = { x: start.x - lineOrigin.x, y: start.y - lineOrigin.y };
      const denominator = direction.x * edge.y - direction.y * edge.x;
      if (Math.abs(denominator) < 0.000001) continue;
      const distance = (relativeStart.x * edge.y - relativeStart.y * edge.x) / denominator;
      const edgePosition = (relativeStart.x * direction.y - relativeStart.y * direction.x) / denominator;
      if (distance < 0 || edgePosition < -0.000001 || edgePosition > 1.000001 || distance >= closestDistance) continue;
      closestDistance = distance;
      const edgeLength = Math.hypot(edge.x, edge.y);
      perimeterDistance = perimeter.distances[index] + Math.max(0, Math.min(1, edgePosition)) * edgeLength;
    }
    return { radius: closestDistance, distance: perimeterDistance };
  }

  const squareRadiusFactorCache = new Map();

  function getSquareRadiusFactors(cornerRadiusPercent) {
    if (!squareRadiusFactorCache.has(cornerRadiusPercent)) {
      const samples = 720;
      const perimeter = getRoundedSquarePerimeter(1, cornerRadiusPercent / 50);
      squareRadiusFactorCache.set(cornerRadiusPercent, Array.from({ length: samples }, (_, index) =>
        getSquarePerimeterIntersection(perimeter, index * Math.PI * 2 / samples).radius
      ));
    }
    return squareRadiusFactorCache.get(cornerRadiusPercent);
  }

  function getSquareRadiusFactorAt(factors, angle) {
    const position = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * factors.length;
    const lower = Math.floor(position);
    const upper = (lower + 1) % factors.length;
    const fraction = position - lower;
    return factors[lower] + (factors[upper] - factors[lower]) * fraction;
  }

  function getFigureBoundingSquareHalfSize(radii) {
    if (!radii) return 0;
    let halfSize = 0;
    for (let index = 0; index < radii.length; index++) {
      const angle = index * Math.PI * 2 / radii.length;
      halfSize = Math.max(halfSize, radii[index] * Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))));
    }
    return halfSize;
  }

  // Find where a line clears the directional outline or a supplied bounding square.
  function getLineFigureClearance(radii, angle, offset, figureMargin, strokeWidth, boundingSquareHalfSize) {
    if (!radii) return 0;
    const clearance = figureMargin + strokeWidth / 2;
    const step = 0.005;
    let clearDistance = 0;
    for (let distance = 0; distance <= 1; distance += step) {
      const pointX = distance * Math.cos(angle) - offset * Math.sin(angle);
      const pointY = distance * Math.sin(angle) + offset * Math.cos(angle);
      if (boundingSquareHalfSize !== undefined) {
        if (Math.abs(pointX) < boundingSquareHalfSize + clearance && Math.abs(pointY) < boundingSquareHalfSize + clearance) {
          clearDistance = distance + step;
        }
      } else {
        const pointRadius = Math.hypot(distance, offset);
        const pointAngle = angle + Math.atan2(offset, distance);
        if (pointRadius < getSquareRadiusFactorAt(radii, pointAngle) + clearance) clearDistance = distance + step;
      }
    }
    return clearDistance;
  }

  // Expand the rounded square until every sampled outline point fits inside it.
  function getRoundedBoundingSquareHalfSize(figureRadii, type, radiusFactors, figureMargin, strokeWidth) {
    const radii = figureRadii.get(type);
    if (!radii) return 0;
    let halfSize = 0;
    for (let index = 0; index < radii.length; index++) {
      const requiredRadius = radii[index] + figureMargin + strokeWidth / 2;
      halfSize = Math.max(halfSize, requiredRadius / radiusFactors[index]);
    }
    return halfSize;
  }

  function getSquarePerimeterPoint(perimeter, distance) {
    if (!perimeter?.points?.length || !Number.isFinite(perimeter.length) || perimeter.length <= 0 || !Number.isFinite(distance)) {
      return { x: 0, y: 0 };
    }
    const position = ((distance % perimeter.length) + perimeter.length) % perimeter.length;
    for (let index = 0; index < perimeter.points.length; index++) {
      const startDistance = perimeter.distances[index];
      const endDistance = index + 1 < perimeter.points.length ? perimeter.distances[index + 1] : perimeter.length;
      if (position > endDistance) continue;
      const start = perimeter.points[index];
      const end = perimeter.points[(index + 1) % perimeter.points.length];
      if (!start || !end || !Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(end.x) || !Number.isFinite(end.y)) continue;
      const progress = (position - startDistance) / (endDistance - startDistance);
      return { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress };
    }
    return perimeter.points[0] ?? { x: 0, y: 0 };
  }

  function createSquareSegmentPath(perimeter, startDistance, endDistance) {
    let start = ((startDistance % perimeter.length) + perimeter.length) % perimeter.length;
    let end = ((endDistance % perimeter.length) + perimeter.length) % perimeter.length;
    if (end <= start) end += perimeter.length;
    const points = [getSquarePerimeterPoint(perimeter, start)];
    for (let lap = 0; lap <= 1; lap++) {
      for (let index = 0; index < perimeter.points.length; index++) {
        const distance = perimeter.distances[index] + lap * perimeter.length;
        if (distance > start && distance < end) points.push(perimeter.points[index]);
      }
    }
    points.push(getSquarePerimeterPoint(perimeter, end));
    return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  }

  function renderSquareSegmentSet(svg, segments, figureRadii, highlightEndpoints) {
    const layeredSegments = assignSegmentLanes(segments);
    const radiusFactors = getSquareRadiusFactors(settings.threatSquareCornerRadiusPercent);
    const squareSizesByTarget = new Map();
    for (const segment of layeredSegments) {
      const targetKey = `${segment.target.row},${segment.target.col},${segment.type}`;
      if (!squareSizesByTarget.has(targetKey)) {
        const configuredRadius = segment.moveFieldRadius ?? settings.threatSquareRadius;
        const configuredHalfSize = (configuredRadius + settings.threatSquareThickness / 2)
          / getSquareRadiusFactorAt(radiusFactors, Math.PI / 4);
        const boundingHalfSize = getRoundedBoundingSquareHalfSize(
          figureRadii,
          segment.type,
          radiusFactors,
          settings.threatSquareFigureMargin,
          settings.threatSquareThickness
        );
        squareSizesByTarget.set(targetKey, blendRadius(configuredHalfSize, Math.max(configuredHalfSize, boundingHalfSize), segment));
      }
    }
    const halfAngles = getSegmentHalfAngles(
      layeredSegments.map(({ target, angle }) => ({ target, angle })),
      settings.threatSquareAngleDeg * Math.PI / 360,
      settings.threatSquareGapPercent,
      new Map()
    );
    const laneSpacing = settings.threatSquareThickness * (1 + settings.threatSquareRadialGapPercent / 100);
    const perimeterCache = new Map();
    const getCachedSquarePerimeter = (radius, cornerRadius) => {
      const cacheKey = `${radius.toFixed(5)}:${cornerRadius.toFixed(5)}`;
      if (!perimeterCache.has(cacheKey)) perimeterCache.set(cacheKey, getRoundedSquarePerimeter(radius, cornerRadius));
      return perimeterCache.get(cacheKey);
    };

    for (const [index, segment] of layeredSegments.entries()) {
      const startAngle = segment.angle - halfAngles[index].before;
      const endAngle = segment.angle + halfAngles[index].after;
      const targetKey = `${segment.target.row},${segment.target.col},${segment.type}`;
      const basePathRadius = squareSizesByTarget.get(targetKey);
      const laneOffset = segment.lane * laneSpacing;
      const radius = basePathRadius + laneOffset;
      const baseCornerRadius = basePathRadius * settings.threatSquareCornerRadiusPercent / 50;
      // Outer lanes scale the inner corner radius with their size, so all lanes show the same corner shape.
      const cornerRadius = baseCornerRadius * radius / basePathRadius;
      const perimeter = getCachedSquarePerimeter(radius, cornerRadius);
      // Outer segments keep the arc length of the inner segment, so their angle shrinks with the larger square.
      const basePerimeter = getCachedSquarePerimeter(basePathRadius, baseCornerRadius);
      const baseStart = getSquarePerimeterIntersection(basePerimeter, startAngle).distance;
      const baseEnd = getSquarePerimeterIntersection(basePerimeter, endAngle).distance;
      const segmentLength = (baseEnd - baseStart + basePerimeter.length) % basePerimeter.length;
      const outerStart = getSquarePerimeterIntersection(perimeter, startAngle).distance;
      const outerEnd = getSquarePerimeterIntersection(perimeter, endAngle).distance;
      const outerCenter = outerStart + (outerEnd - outerStart + perimeter.length) % perimeter.length / 2;
      const start = outerCenter - segmentLength / 2;
      const end = outerCenter + segmentLength / 2;
      const center = { x: segment.target.col + 0.5, y: segment.target.row + 0.5 };
      const path = document.createElementNS(svgNamespace, "path");
      path.setAttribute("d", createSquareSegmentPath(perimeter, start, end));
      path.setAttribute("transform", `translate(${center.x} ${center.y})`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", segment.color);
      path.setAttribute("stroke-width", String(settings.threatSquareThickness));
      path.setAttribute("stroke-linecap", "butt");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("pointer-events", "none");
      svg.append(path);
      if (segment.source && highlightEndpoints) {
        const intersection = getSquarePerimeterIntersection(perimeter, segment.angle);
        const distance = intersection.distance + Math.round((outerCenter - intersection.distance) / perimeter.length) * perimeter.length;
        // Shortened outer lanes may no longer cross the source ray. Stay on the visible path,
        // overlapping half its stroke so rounded corners and butt caps cannot leave a gap.
        const point = getSquarePerimeterPoint(perimeter, Math.max(start, Math.min(end, distance)));
        highlightEndpoints.set(`${segment.target.row},${segment.target.col}:${segment.source.row},${segment.source.col}`, {
          x: center.x + point.x,
          y: center.y + point.y
        });
      }
    }
  }

  // Finds the outline peak (arm or bar) of the target figure that lies nearest to the given angle.
  function getNearestOutlinePeakAngle(radii, angle) {
    if (!radii) return null;
    const count = radii.length;
    const start = Math.round((((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * count);
    for (let step = 0; step <= count / 2; step++) {
      for (const direction of [1, -1]) {
        const index = (start + direction * step + count) % count;
        if (radii[index] >= radii[(index - 1 + count) % count] && radii[index] >= radii[(index + 1) % count]) return index / count * Math.PI * 2;
      }
    }
    return null;
  }

  function getKnightCurveControlPoint(start, end, center, outline, angle, radius) {
    const chord = { x: end.x - start.x, y: end.y - start.y };
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const peakAngle = getNearestOutlinePeakAngle(outline, angle);
    const peak = peakAngle === null ? null : {
      x: center.x + Math.cos(peakAngle) * radius,
      y: center.y + Math.sin(peakAngle) * radius
    };
    const side = peak ? Math.sign(-chord.y * (peak.x - middle.x) + chord.x * (peak.y - middle.y)) || 1 : 1;
    const bend = -2 * settings.threatLineCurvature * side;
    return {
      x: middle.x - chord.y * bend,
      y: middle.y + chord.x * bend
    };
  }

  function getQuadraticPoint([start, control, end], t) {
    const inverse = 1 - t;
    return {
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
    };
  }

  function getCubicPoint([start, firstControl, secondControl, end], t) {
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * firstControl.x
        + 3 * inverse * t ** 2 * secondControl.x + t ** 3 * end.x,
      y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * firstControl.y
        + 3 * inverse * t ** 2 * secondControl.y + t ** 3 * end.y
    };
  }

  const outlinePolygonCache = new WeakMap();

  // Outline of a figure as points relative to its center, sampled every two degrees.
  function getOutlinePolygon(radii) {
    if (!outlinePolygonCache.has(radii)) {
      const count = 360;
      const polygon = [];
      for (let index = 0; index < count; index++) {
        const angle = index / count * Math.PI * 2;
        const radius = getSquareRadiusFactorAt(radii, angle);
        polygon.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      }
      outlinePolygonCache.set(radii, polygon);
    }
    return outlinePolygonCache.get(radii);
  }

  // Closest outline point to a point (both relative to the figure center); the distance is negative inside the outline.
  function getClosestOutlinePoint(polygon, radii, point) {
    let closest = null;
    let nearest = Infinity;
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
      const candidate = { x: a.x + dx * t, y: a.y + dy * t };
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (distance < nearest) {
        nearest = distance;
        closest = candidate;
      }
    }
    const inside = Math.hypot(point.x, point.y) < getSquareRadiusFactorAt(radii, Math.atan2(point.y, point.x));
    return { point: closest, distance: inside ? -nearest : nearest };
  }

  // Moves the curve away from the target figure outline until its samples keep the clearance.
  function pushCurveFromFigure(points, center, radii, clearance) {
    if (!radii) return points;
    const polygon = getOutlinePolygon(radii);
    let current = points;
    for (let iteration = 0; iteration < 10; iteration++) {
      let worst = null;
      for (let step = 0; step <= 40; step++) {
        const point = getQuadraticPoint(current, step / 40);
        const relative = { x: point.x - center.x, y: point.y - center.y };
        const closest = getClosestOutlinePoint(polygon, radii, relative);
        const deficit = clearance - closest.distance;
        if (deficit <= 0 || (worst && deficit <= worst.deficit)) continue;
        const sign = closest.distance < 0 ? -1 : 1;
        const length = Math.abs(closest.distance) || 1;
        worst = {
          deficit,
          x: sign * (relative.x - closest.point.x) / length,
          y: sign * (relative.y - closest.point.y) / length
        };
      }
      if (!worst) return current;
      current = current.map(point => ({ x: point.x + worst.x * worst.deficit, y: point.y + worst.y * worst.deficit }));
    }
    return current;
  }

  // Knight lines keep the straight line's end points and only bend between them.
  function createKnightCurvePath(line, innerRadius, outerRadius) {
    const { center, direction, normal, offset } = line;
    const start = { x: center.x + direction.x * outerRadius + normal.x * offset, y: center.y + direction.y * outerRadius + normal.y * offset };
    const end = { x: center.x + direction.x * innerRadius + normal.x * offset, y: center.y + direction.y * innerRadius + normal.y * offset };
    const control = getKnightCurveControlPoint(start, end, center, line.outline, line.angle, innerRadius);
    const path = document.createElementNS(svgNamespace, "path");
    const [curveStart, curveControl, curveEnd] = pushCurveFromFigure([start, control, end], center, line.outline, settings.threatLineFigureMargin + settings.threatLineThickness / 2);
    line.outerPoint = curveStart;
    path.setAttribute("d", `M ${curveStart.x} ${curveStart.y} Q ${curveControl.x} ${curveControl.y} ${curveEnd.x} ${curveEnd.y}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", line.color);
    path.setAttribute("stroke-width", String(settings.threatLineThickness));
    path.setAttribute("stroke-linecap", "butt");
    path.setAttribute("pointer-events", "none");
    return path;
  }

  function renderLineSet(svg, segments, figureRadii, highlightEndpoints) {
    const linesByDirection = new Map();
    const boundingSquareHalfSizes = new Map();
    for (const segment of segments) {
      const direction = `${Math.cos(segment.angle).toFixed(4)},${Math.sin(segment.angle).toFixed(4)}`;
      const key = `${segment.target.row},${segment.target.col},${direction}`;
      if (!linesByDirection.has(key)) linesByDirection.set(key, []);
      linesByDirection.get(key).push(segment);
    }
    const lines = [];

    for (const [lineGroupKey, group] of linesByDirection) {
      const first = group[0];
      const direction = { x: Math.cos(first.angle), y: Math.sin(first.angle) };
      const normal = { x: -direction.y, y: direction.x };
      const offsets = [0];
      for (let index = 1; index < group.length; index++) {
        offsets.push(offsets[index - 1] + settings.threatLineThickness + settings.threatLineGap);
      }
      const groupCenter = (offsets[0] + offsets[offsets.length - 1]) / 2;

      for (const [lane, segment] of group.entries()) {
        const center = { x: segment.target.col + 0.5, y: segment.target.row + 0.5 };
        const offset = offsets[lane] - groupCenter;
        lines.push({
          center,
          lineGroupKey,
          targetKey: `${segment.target.row},${segment.target.col}`,
          sourceKey: segment.source ? `${segment.source.row},${segment.source.col}` : null,
          category: segment.category ?? "defense",
          type: segment.type,
          outline: figureRadii.get(segment.type),
          figureBlend: segment.figureBlend,
          color: segment.color,
          wedge: segment.wedge,
          moveFieldRadius: segment.moveFieldRadius,
          length: segment.wedge ? settings.threatWedgeLengthPercent / 100 : settings.threatLineLength,
          direction,
          normal,
          offset,
          angle: segment.angle,
          curved: segment.sourceType === "knight"
        });
      }
    }

    const gap = settings.threatLineLength * settings.threatLineGapPercent / 100;
    const laneSpacing = settings.threatLineThickness + settings.threatLineGap;
    const axialStagger = settings.threatLineGap / 2;
    const proximityThreshold = Math.max(laneSpacing, gap + settings.threatLineThickness);
    const lateralTolerance = laneSpacing + 0.000001;

    function updateLineRadii(line) {
      const radius = line.moveFieldRadius ?? settings.threatLineRadius;
      const configuredRadius = Math.sqrt(Math.max(0, radius ** 2 - line.offset ** 2));
      const usesBoundingSquare = settings.pieceSet !== "system_rund"
        && (line.type === "queen" || (line.type === "knight" && settings.pieceSet !== "cage"));
      if (usesBoundingSquare && !boundingSquareHalfSizes.has(line.type)) {
        boundingSquareHalfSizes.set(line.type, getFigureBoundingSquareHalfSize(line.outline));
      }
      const collisionRadius = getLineFigureClearance(
        line.outline,
        line.angle,
        line.offset,
        settings.threatLineFigureMargin,
        settings.threatLineThickness,
        usesBoundingSquare ? boundingSquareHalfSizes.get(line.type) : undefined
      );
      line.innerRadius = blendRadius(configuredRadius, Math.max(configuredRadius, collisionRadius), line);
      line.outerRadius = line.innerRadius + line.length;
    }

    // Proximity is measured from the natural, unshifted line spans.
    for (const line of lines) updateLineRadii(line);

    // Only nearby parallel spans share a bundle and its spacing/length constraints.
    const unitRecords = lines.map(line => {
      const orientation = line.direction.x > 1e-6 || (Math.abs(line.direction.x) <= 1e-6 && line.direction.y > 0) ? 1 : -1;
      const axis = { x: line.direction.x * orientation, y: line.direction.y * orientation };
      const normal = { x: -axis.y, y: axis.x };
      const along = line.center.x * axis.x + line.center.y * axis.y;
      const start = orientation > 0 ? along + line.innerRadius : along - line.outerRadius;
      const end = orientation > 0 ? along + line.outerRadius : along - line.innerRadius;
      return {
        line,
        normal,
        orientation,
        lateral: line.center.x * normal.x + line.center.y * normal.y + line.offset * (line.normal.x * normal.x + line.normal.y * normal.y),
        start,
        end
      };
    });
    function getSegmentDistance(a, b) {
      if (a.normal.x * b.normal.x + a.normal.y * b.normal.y < 0.99) return Infinity;
      const axialGap = Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end));
      const lateralGap = Math.abs(a.lateral - b.lateral);
      if (lateralGap > lateralTolerance) return Infinity;
      return Math.hypot(axialGap, lateralGap);
    }
    const unitParent = unitRecords.map((_, index) => index);
    const findUnit = index => (unitParent[index] === index ? index : (unitParent[index] = findUnit(unitParent[index])));
    for (let i = 0; i < unitRecords.length; i++) {
      for (let j = i + 1; j < unitRecords.length; j++) {
        const a = unitRecords[i];
        const b = unitRecords[j];
        if (getSegmentDistance(a, b) > proximityThreshold) continue;
        unitParent[findUnit(i)] = findUnit(j);
      }
    }
    const units = new Map();
    unitRecords.forEach((record, index) => {
      const key = findUnit(index);
      if (!units.has(key)) units.set(key, []);
      units.get(key).push(record);
      record.line.unitKey = key;
      record.line.orientation = record.orientation;
      record.line.laneLateral = record.lateral;
    });
    for (const members of units.values()) {
      if (members.length < 2) continue;
      const forwardCount = members.filter(member => member.orientation === 1).length;
      const primaryOrientation = forwardCount >= members.length - forwardCount ? 1 : -1;
      const primary = members.filter(member => member.orientation === primaryOrientation).sort((a, b) => a.lateral - b.lateral);
      const secondary = members.filter(member => member.orientation !== primaryOrientation).sort((a, b) => a.lateral - b.lateral);
      const laneNormal = members[0].normal;
      const laneIncreasesRightOrDown = Math.abs(laneNormal.x) > 1e-6 ? laneNormal.x > 0 : laneNormal.y > 0;
      // Keep the larger direction block together on the left/top, as in the mockup.
      const orderedMembers = laneIncreasesRightOrDown ? [...primary, ...secondary] : [...secondary, ...primary];
      const meanLateral = members.reduce((sum, member) => sum + member.lateral, 0) / members.length;
      orderedMembers.forEach((member, index) => {
        const { line, normal } = member;
        const targetLateral = meanLateral + (index - (members.length - 1) / 2) * laneSpacing;
        line.offset = (targetLateral - (line.center.x * normal.x + line.center.y * normal.y)) / (line.normal.x * normal.x + line.normal.y * normal.y);
        line.laneLateral = targetLateral;
        line.primaryOrientation = primaryOrientation;
      });
    }

    // Recheck figure clearance after moving a nearby lane bundle as a unit.
    for (const line of lines) updateLineRadii(line);
    for (const record of unitRecords) {
      const { line, normal, orientation } = record;
      const along = line.center.x * line.direction.x * orientation + line.center.y * line.direction.y * orientation;
      record.lateral = line.center.x * normal.x + line.center.y * normal.y
        + line.offset * (line.normal.x * normal.x + line.normal.y * normal.y);
      record.start = orientation > 0 ? along + line.innerRadius : along - line.outerRadius;
      record.end = orientation > 0 ? along + line.outerRadius : along - line.innerRadius;
    }

    // Use the original proximity bundle: lane spacing can move reciprocal lines farther apart.
    const linesByConnection = new Map();
    for (const line of lines) {
      if (!line.sourceKey) continue;
      const key = `${line.category}|${line.sourceKey}>${line.targetKey}`;
      if (!linesByConnection.has(key)) linesByConnection.set(key, []);
      linesByConnection.get(key).push(line);
    }
    const pairedLines = new Set();
    for (const line of lines) {
      if (!line.sourceKey || pairedLines.has(line)) continue;
      const reverseKey = `${line.category}|${line.targetKey}>${line.sourceKey}`;
      const candidates = (linesByConnection.get(reverseKey) ?? [])
        .filter(other => !pairedLines.has(other) && other !== line
          && other.direction.x * line.direction.x + other.direction.y * line.direction.y < -0.99
          && other.unitKey === line.unitKey)
        .sort((a, b) => Math.abs(a.laneLateral - line.laneLateral) - Math.abs(b.laneLateral - line.laneLateral));
      const partner = candidates[0];
      if (!partner) continue;
      line.partner = partner;
      partner.partner = line;
      pairedLines.add(line);
      pairedLines.add(partner);
    }

    // Keep each direction block aligned; stagger only the block beside a nearby partner.
    for (const members of units.values()) {
      if (!members.some(member => member.line.partner)) continue;
      for (const { line } of members) {
        if (line.orientation === line.primaryOrientation) continue;
        line.axialShift = axialStagger;
        line.innerRadius += axialStagger;
        line.outerRadius += axialStagger;
      }
    }

    // Align lines from the same target and direction at their most conservative safe start.
    const directionGroups = new Map();
    for (const line of lines) {
      const key = line.lineGroupKey;
      if (!directionGroups.has(key)) directionGroups.set(key, []);
      directionGroups.get(key).push(line);
    }
    for (const members of directionGroups.values()) {
      if (members.length < 2) continue;
      const sharedInner = Math.max(...members.map(line => line.innerRadius));
      for (const line of members) {
        const lineLength = line.outerRadius - line.innerRadius;
        line.innerRadius = sharedInner;
        line.outerRadius = sharedInner + lineLength;
      }
    }

    // Reciprocal lines solve their final endpoints together at the partner midpoint.
    for (const line of lines) {
      const partner = line.partner;
      if (!partner || line.partnerSolved) continue;
      const distanceX = partner.center.x - line.center.x;
      const distanceY = partner.center.y - line.center.y;
      const distance = distanceX * line.direction.x + distanceY * line.direction.y;
      const lineLimit = (2 * distance + line.innerRadius - 2 * partner.innerRadius) / 3;
      const partnerLimit = (2 * distance + partner.innerRadius - 2 * line.innerRadius) / 3;
      if (lineLimit <= line.innerRadius + (line.wedge ? 0 : settings.threatLineThickness)
        || partnerLimit <= partner.innerRadius + (partner.wedge ? 0 : settings.threatLineThickness)) {
        line.suppressed = true;
        partner.suppressed = true;
      } else {
        line.facingLimit = lineLimit;
        partner.facingLimit = partnerLimit;
      }
      line.partnerSolved = true;
      partner.partnerSolved = true;
    }

    // A unit uses the shortened partner-line length as its shared length, when present.
    const linesByUnit = new Map();
    for (const line of lines) {
      if (!linesByUnit.has(line.unitKey)) linesByUnit.set(line.unitKey, []);
      linesByUnit.get(line.unitKey).push(line);
    }
    for (const members of linesByUnit.values()) {
      const active = members.filter(line => !line.suppressed);
      if (!active.length) continue;
      const partnerLengths = active.filter(line => line.partner)
        .map(line => Math.max(0, line.facingLimit - line.innerRadius));
      const candidateLength = partnerLengths.length
        ? Math.min(...partnerLengths)
        : Math.min(...active.map(line => line.outerRadius - line.innerRadius));
      const commonLength = Math.min(...active.map(line => line.length), candidateLength);
      if (commonLength <= 0 || active.some(line => !line.wedge && commonLength < settings.threatLineThickness)) {
        for (const line of active) {
          line.suppressed = true;
          if (line.partner) line.partner.suppressed = true;
        }
        continue;
      }
      for (const line of active) {
        line.finalInner = line.innerRadius;
        line.finalOuter = Math.min(line.innerRadius + commonLength, line.facingLimit ?? Infinity);
      }
    }

    // Apply any remaining collinear collision gaps from a stable snapshot of final endpoints.
    const lineRanges = lines.filter(line => !line.suppressed).map(line => ({
      line,
      inner: line.finalInner,
      outer: line.finalOuter
    }));
    for (const range of lineRanges) {
      const { line } = range;
      if (line.partner) continue;
      let inner = range.inner;
      let outer = range.outer;
      for (const otherRange of lineRanges) {
        const other = otherRange.line;
        if (other === line || other.targetKey === line.targetKey || other.unitKey === line.unitKey) continue;
        const dot = other.direction.x * line.direction.x + other.direction.y * line.direction.y;
        if (Math.abs(dot) < 0.99) continue;
        const otherX = other.center.x + other.normal.x * other.offset - line.center.x;
        const otherY = other.center.y + other.normal.y * other.offset - line.center.y;
        const lateral = otherX * line.normal.x + otherY * line.normal.y - line.offset;
        if (Math.abs(lateral) >= settings.threatLineThickness) continue;
        const base = otherX * line.direction.x + otherY * line.direction.y;
        const otherStart = dot > 0 ? base + otherRange.inner : base - otherRange.outer;
        const otherEnd = dot > 0 ? base + otherRange.outer : base - otherRange.inner;
        if (otherEnd <= inner || otherStart >= outer) continue;
        if (otherStart >= inner) outer = Math.min(outer, otherStart - gap / 2);
        else inner = Math.max(inner, otherEnd + gap / 2);
      }
      line.finalInner = inner;
      line.finalOuter = outer;
    }

    // A constrained line is omitted rather than expanded past its safe endpoint.
    for (const members of linesByUnit.values()) {
      const active = members.filter(line => !line.suppressed);
      if (!active.length) continue;
      const commonLength = Math.min(
        ...active.map(line => line.length),
        ...active.map(line => line.finalOuter - line.finalInner)
      );
      if (commonLength <= 0 || active.some(line => !line.wedge && commonLength < settings.threatLineThickness)) {
        for (const line of active) {
          line.suppressed = true;
          if (line.partner) line.partner.suppressed = true;
        }
        continue;
      }
      for (const line of active) line.finalOuter = line.finalInner + commonLength;
    }

    for (const line of lines) {
      if (line.suppressed) continue;
      const { center, direction, normal, offset } = line;
      const innerRadius = line.finalInner;
      const outerRadius = Math.min(line.finalOuter, innerRadius + line.length);
      line.outerPoint = {
        x: center.x + direction.x * outerRadius + normal.x * offset,
        y: center.y + direction.y * outerRadius + normal.y * offset
      };
      if (line.curved && !line.wedge) {
        svg.append(createKnightCurvePath(line, innerRadius, outerRadius));
      }
      if (line.sourceKey) highlightEndpoints?.set(`${line.targetKey}:${line.sourceKey}`, line.outerPoint);
      if (line.curved && !line.wedge) continue;
      if (line.wedge) {
        const tipX = center.x + direction.x * innerRadius + normal.x * offset;
        const tipY = center.y + direction.y * innerRadius + normal.y * offset;
        const baseX = center.x + direction.x * outerRadius + normal.x * offset;
        const baseY = center.y + direction.y * outerRadius + normal.y * offset;
        const halfWidth = settings.threatWedgeWidthPercent / 200;
        const triangle = document.createElementNS(svgNamespace, "polygon");
        triangle.setAttribute("points", `${tipX},${tipY} ${baseX + normal.x * halfWidth},${baseY + normal.y * halfWidth} ${baseX - normal.x * halfWidth},${baseY - normal.y * halfWidth}`);
        triangle.setAttribute("fill", line.color);
        triangle.setAttribute("pointer-events", "none");
        svg.append(triangle);
        continue;
      }
      const element = document.createElementNS(svgNamespace, "line");
      element.setAttribute("x1", String(center.x + direction.x * outerRadius + normal.x * offset));
      element.setAttribute("y1", String(center.y + direction.y * outerRadius + normal.y * offset));
      element.setAttribute("x2", String(center.x + direction.x * innerRadius + normal.x * offset));
      element.setAttribute("y2", String(center.y + direction.y * innerRadius + normal.y * offset));
      element.setAttribute("stroke", line.color);
      element.setAttribute("stroke-width", String(settings.threatLineThickness));
      element.setAttribute("stroke-linecap", "butt");
      element.setAttribute("pointer-events", "none");
      svg.append(element);
    }
  }

  // The drag preview has no DOM elements; the rotation of an outlined figure comes from its own element.
  function findPieceElement(board, square, dragPreview, blackOrientation) {
    const draggedSquare = dragPreview && logicalToScreen(dragPreview.legal ? dragPreview.target : dragPreview.source, dragPreview.blackOrientation);
    if (draggedSquare?.row === square.row && draggedSquare?.col === square.col) {
      if (!dragPreview.isHoverPreview) return getDraggingPiece(board);
      square = logicalToScreen(dragPreview.source, dragPreview.blackOrientation);
    }
    return [...board.querySelectorAll(":scope > piece")].find(element => {
      if (element.classList.contains("ghost") || element.classList.contains("fading") || element.classList.contains("dragging")) return false;
      const screen = getPieceScreenSquare(element, board, blackOrientation);
      return screen?.row === square.row && screen?.col === square.col;
    }) ?? null;
  }

  function clearDefensePreviewTimer(entry) {
    if (entry.defensePreviewTimer) clearTimeout(entry.defensePreviewTimer);
    entry.defensePreviewTimer = 0;
    entry.defensePreviewPendingKey = null;
    entry.defensePreviewPendingAt = 0;
  }

  function clearDefenseHoverTimer(entry) {
    if (entry.defenseHoverTimer) clearTimeout(entry.defenseHoverTimer);
    entry.defenseHoverTimer = 0;
    entry.defenseHoverPendingKey = null;
    entry.defenseHoverPendingAt = 0;
  }

  function getDefenseNodeMix(node, run, timestamp) {
    if (node.fadeOut) {
      const progress = (timestamp - node.fadeOut.startedAt) / node.fadeOut.duration;
      return progress >= 1 ? 0 : node.fadeOut.mix * (1 - Math.max(0, progress));
    }
    const elapsed = timestamp - run.startedAt - node.wave * settings.defenseHighlightWaveIntervalMs;
    if (elapsed < 0 || elapsed > settings.defenseHighlightDurationMs) return 0;
    return getDefenseHighlightMix(
      elapsed / settings.defenseHighlightDurationMs,
      node.depth,
      settings.defenseHighlightWhiteMixPercent,
      settings.defenseHighlightWaveDecayPercent
    );
  }

  function getHighlightLineState(line, run, timestamp, holdAtEnd = line.held) {
    const wave = line.wave ?? line.depth;
    const targetWave = holdAtEnd && run.reverse ? run.maxDepth : wave;
    const startWave = run.reverse ? wave : wave - 1;
    const state = globalThis.LichessHighlightLinePreview.getLineMotion(settings, line.depth, run.startedAt,
      timestamp, holdAtEnd, targetWave, startWave);
    if (line.fadeOut) {
      const progress = Math.max(0, Math.min(1, (timestamp - line.fadeOut.startedAt) / line.fadeOut.duration));
      const easedProgress = progress * progress * (3 - 2 * progress);
      return {
        progress: line.fadeOut.reverse ? line.fadeOut.progress * (1 - easedProgress) : state.progress,
        opacity: line.fadeOut.opacity * (1 - easedProgress),
        shrinking: line.fadeOut.reverse,
        finished: progress >= 1
      };
    }
    return state;
  }

  function removeHighlightLine(line) {
    line.path.remove();
    line.gradient.remove();
  }

  function updateHighlightLine(line, state) {
    globalThis.LichessHighlightLinePreview.updateLine(line, state, settings, 0.01);
  }

  function syncHighlightLineEndpoints(entry) {
    for (const run of entry.defenseHighlightRuns ?? []) {
      if (run.retiring) continue;
      for (const line of run.lines) {
        if (line.fadeOut) continue;
        const { startSquare: start, endSquare: end } = line;
        const from = entry.highlightLineEndpoints?.get(`${start.row},${start.col}:${end.row},${end.col}`);
        const to = entry.highlightLineEndpoints?.get(`${end.row},${end.col}:${start.row},${start.col}`);
        const fromX = from?.x ?? start.col + 0.5;
        const fromY = from?.y ?? start.row + 0.5;
        const toX = to?.x ?? end.col + 0.5;
        const toY = to?.y ?? end.row + 0.5;
        if (line.fromX === fromX && line.fromY === fromY && line.toX === toX && line.toY === toY) continue;
        Object.assign(line, { fromX, fromY, toX, toY, length: Math.max(0.000001, Math.hypot(toX - fromX, toY - fromY)) });
        line.styleKey = null;
        line.path.setAttribute("d", `M ${fromX} ${fromY} L ${toX} ${toY}`);
        line.path.setAttribute("stroke-linecap", from || to ? "butt" : "round");
        updateHighlightLine(line, getHighlightLineState(line, run, performance.now(),
          line.held || (run.holding ?? settings.highlightCascadeLinesHoldEnabled)));
      }
    }
  }

  function holdHighlightLine(line) {
    const opacity = globalThis.LichessHighlightLinePreview.getHighlightMix(
      0.5, line.depth, settings.highlightLineOpacityPercent, settings.highlightLineDecayPercent
    );
    updateHighlightLine(line, { progress: 1, opacity, holding: true });
    line.held = true;
  }

  function syncHighlightLineMaskBlur(resource, boardRect) {
    const blurPx = settings.defenseHighlightLineMaskBlurPx;
    const key = `${blurPx}:${boardRect.width}:${boardRect.height}`;
    if (resource.blurKey === key) return;
    resource.blurKey = key;
    resource.blur.setAttribute("stdDeviation", `${boardRect.width ? blurPx * 8 / boardRect.width : 0} ${boardRect.height ? blurPx * 8 / boardRect.height : 0}`);
  }

  function syncHighlightLineMasks(entry, board) {
    const resources = entry.highlightLineMaskCache?.values();
    if (!resources) return;
    const boardRect = board.getBoundingClientRect();
    for (const resource of resources) syncHighlightLineMaskBlur(resource, boardRect);
  }

  function createHighlightLineMask(entry, board, position, blackOrientation) {
    if (!["cage", "system_rund"].includes(settings.pieceSet)) return null;
    const positionKey = position.map(rank => rank.map(piece => piece ? `${piece.color}${piece.type}` : "-").join(",")).join(";");
    const key = `${settings.pieceSet}:${blackOrientation}:${positionKey}`;
    entry.highlightLineMaskCache ??= new Map();
    let resource = entry.highlightLineMaskCache.get(key);
    if (resource) {
      resource.references++;
      syncHighlightLineMaskBlur(resource, board.getBoundingClientRect());
      return resource;
    }

    const id = `lfs-highlight-mask-${++defenseHighlightMaskId}`;
    const filterId = `${id}-blur`;
    const filter = document.createElementNS(svgNamespace, "filter");
    filter.id = filterId;
    filter.setAttribute("x", "-4");
    filter.setAttribute("y", "-4");
    filter.setAttribute("width", "16");
    filter.setAttribute("height", "16");
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("primitiveUnits", "userSpaceOnUse");
    const blur = document.createElementNS(svgNamespace, "feGaussianBlur");
    blur.setAttribute("in", "SourceGraphic");
    filter.append(blur);

    const mask = document.createElementNS(svgNamespace, "mask");
    mask.id = id;
    mask.setAttribute("x", "-4");
    mask.setAttribute("y", "-4");
    mask.setAttribute("width", "16");
    mask.setAttribute("height", "16");
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("maskContentUnits", "userSpaceOnUse");
    mask.setAttribute("mask-type", "luminance");
    mask.style.setProperty("mask-type", "luminance");
    mask.append(document.createElementNS(svgNamespace, "rect"));
    const background = mask.firstElementChild;
    background.setAttribute("x", "-4");
    background.setAttribute("y", "-4");
    background.setAttribute("width", "16");
    background.setAttribute("height", "16");
    background.setAttribute("fill", "white");

    const figures = document.createElementNS(svgNamespace, "g");
    figures.setAttribute("filter", `url(#${filterId})`);
    for (let row = 0; row < position.length; row++) {
      for (let col = 0; col < position[row].length; col++) {
        const piece = position[row][col];
        const letter = piece && figureAssetLetters[piece.type];
        if (settings.pieceSet === "system_rund") {
          if (!letter || piece.type === "pawn") continue;
          const circle = document.createElementNS(svgNamespace, "circle");
          circle.setAttribute("cx", String(col + 0.5));
          circle.setAttribute("cy", String(row + 0.5));
          circle.setAttribute("r", String(roundKingInnerRadius));
          circle.setAttribute("fill", "black");
          figures.append(circle);
          continue;
        }
        const bounds = cagePieceBounds[letter];
        if (!bounds) continue;
        const [left, top, right, bottom] = bounds;
        const x1 = col + left;
        const y1 = row + top;
        const x2 = col + right;
        const y2 = row + bottom;
        const path = document.createElementNS(svgNamespace, "path");
        path.setAttribute("d", `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`);
        path.setAttribute("fill", "black");
        if (isPieceRotated(piece.color, blackOrientation)) {
          path.setAttribute("transform", `rotate(180 ${col + 0.5} ${row + 0.5})`);
        }
        figures.append(path);
      }
    }
    mask.append(figures);
    entry.highlightLineDefs.append(filter, mask);
    resource = { key, mask, filter, blur, references: 1, blurKey: "" };
    entry.highlightLineMaskCache.set(key, resource);
    if (typeof ResizeObserver === "function" && !entry.highlightLineMaskResizeObserver) {
      entry.highlightLineMaskResizeObserver = new ResizeObserver(() => syncHighlightLineMasks(entry, board));
      entry.highlightLineMaskResizeObserver.observe(board);
    }
    syncHighlightLineMaskBlur(resource, board.getBoundingClientRect());
    return resource;
  }

  function releaseHighlightLineMask(entry, resource) {
    if (!resource || --resource.references > 0) return;
    resource.mask.remove();
    resource.filter.remove();
    entry.highlightLineMaskCache?.delete(resource.key);
    if (!entry.highlightLineMaskCache?.size) {
      entry.highlightLineMaskResizeObserver?.disconnect();
      entry.highlightLineMaskResizeObserver = null;
    }
  }

  function releaseRemovedDefenseLineRuns(entry, previousRuns, nextRuns) {
    for (const run of previousRuns) {
      if (nextRuns.includes(run)) continue;
      run.lineGroup?.remove();
      releaseHighlightLineMask(entry, run.lineMask);
      run.lineMask = null;
    }
  }

  function endPreviousDefenseWaves(entry, timestamp = performance.now(), preserveLines = Boolean(
    settings.highlightCascadeLinesHoldEnabled && entry.defenseLineHoldRoot
  )) {
    const runs = [];
    for (const run of entry.defenseHighlightRuns ?? []) {
      const activeNodes = [];
      const activeLines = [];
      for (const node of run.nodes) {
        const waveStartsAt = run.startedAt + node.wave * settings.defenseHighlightWaveIntervalMs;
        if (waveStartsAt > timestamp) continue;
        const mix = getDefenseNodeMix(node, run, timestamp);
        if (mix <= 0) continue;
        node.fadeOut ??= { startedAt: timestamp, mix, duration: 180 };
        activeNodes.push(node);
      }
      const retainLines = preserveLines && !run.lines.some(line => line.fadeOut);
      // A context change can precede both the preview threshold and its first visible frame.
      run.retiring ||= !retainLines || run.root.row !== entry.defenseLineHoldRoot.row
        || run.root.col !== entry.defenseLineHoldRoot.col;
      run.waitingForReplacement = retainLines && run.retiring;
      for (const line of run.lines ?? []) {
        const state = getHighlightLineState(line, run, timestamp, Boolean(retainLines || run.holding || line.held));
        if (!retainLines && state.opacity <= 0) {
          removeHighlightLine(line);
          continue;
        }
        if (!retainLines) line.fadeOut ??= { startedAt: timestamp, opacity: state.opacity, progress: state.progress,
          duration: 180, reverse: Boolean(run.holding || line.held) };
        activeLines.push(line);
      }
      if (!activeNodes.length && !activeLines.length) continue;
      run.nodes = activeNodes;
      run.lines = activeLines;
      run.endAt = Math.max(
        retainLines ? run.endAt : 0,
        ...activeNodes.map(node => node.fadeOut.startedAt + node.fadeOut.duration),
        ...activeLines.filter(line => line.fadeOut).map(line => line.fadeOut.startedAt + line.fadeOut.duration)
      );
      run.held = false;
      runs.push(run);
    }
    releaseRemovedDefenseLineRuns(entry, entry.defenseHighlightRuns ?? [], runs);
    entry.defenseHighlightRuns = runs;
    if (!runs.some(run => run.lines?.length)) {
      entry.highlightLineSvg?.remove();
      entry.highlightLineSvg = null;
      entry.highlightLineDefs = null;
    }
    if (runs.length && !entry.defenseHighlightFrame) {
      entry.defenseHighlightFrame = requestAnimationFrame(nextTimestamp => {
        entry.defenseHighlightFrame = 0;
        advanceDefenseCascade(entry, nextTimestamp);
      });
    }
  }

  function setDefenseCascadeContext(entry, key) {
    if (entry.defenseCascadeContextKey === key) return false;
    entry.defenseCascadeContextKey = key;
    endPreviousDefenseWaves(entry);
    return true;
  }

  function setDefenseLineHoldRoot(entry, root) {
    const previous = entry.defenseLineHoldRoot;
    entry.defenseLineHoldRoot = root;
    if (previous && (previous.row !== root?.row || previous.col !== root?.col)) endPreviousDefenseWaves(entry);
  }

  function clearDefenseHighlights(entry) {
    clearDefensePreviewTimer(entry);
    clearDefenseHoverTimer(entry);
    if (entry.defenseHighlightFrame) cancelAnimationFrame(entry.defenseHighlightFrame);
    entry.defenseHighlightFrame = 0;
    for (const run of entry.defenseHighlightRuns ?? []) {
      for (const line of run.lines ?? []) removeHighlightLine(line);
    }
    entry.defenseHighlightRuns = [];
    entry.highlightLineSvg?.remove();
    entry.highlightLineSvg = null;
    entry.highlightLineDefs = null;
    entry.highlightLineMaskResizeObserver?.disconnect();
    entry.highlightLineMaskResizeObserver = null;
    entry.highlightLineMaskCache?.clear();
    for (const piece of entry.defenseHighlightedPieces ?? []) {
      piece.removeAttribute("data-lfs-defense-highlight");
      piece.style.removeProperty("--lfs-defense-highlight-mix");
    }
    entry.defenseHighlightedPieces = new Set();
    entry.defensePreviewMix = 0;
    entry.defenseSelectedKey = null;
    entry.defenseHoverKey = null;
    entry.defenseHoverStartedKey = null;
    entry.defenseCascadeContextKey = null;
    entry.defenseLineHoldRoot = null;
    entry.defenseLineHoldPendingRoot = null;
    entry.defensePreviewSourceKey = null;
    entry.defensePreviewLastTargetKey = null;
    entry.defensePlayedMoveKeys.clear();
    syncPreviewDefenseFilter(entry);
  }

  function createPreviewColorFilter(id) {
    const filter = document.createElementNS(svgNamespace, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("color-interpolation-filters", "sRGB");
    const flood = document.createElementNS(svgNamespace, "feFlood");
    flood.setAttribute("result", "piece-color");
    const composite = document.createElementNS(svgNamespace, "feComposite");
    composite.setAttribute("in", "piece-color");
    composite.setAttribute("in2", "SourceAlpha");
    composite.setAttribute("operator", "in");
    composite.setAttribute("result", "piece-color");
    filter.append(flood, composite);
    return { id, filter, flood };
  }

  function ensurePreviewDefenseFilter(entry) {
    if (entry.previewDefenseFilter || !entry.previewPieceSvg) return;
    const defs = document.createElementNS(svgNamespace, "defs");
    defs.setAttribute("data-lfs-defense-highlight-filter", "");
    const id = `lfs-defense-preview-${++defenseHighlightFilterId}`;
    const { filter, flood } = createPreviewColorFilter(id);
    const transfer = document.createElementNS(svgNamespace, "feComponentTransfer");
    const channels = ["R", "G", "B"].map(channel => {
      const func = document.createElementNS(svgNamespace, `feFunc${channel}`);
      func.setAttribute("type", "linear");
      transfer.append(func);
      return func;
    });
    filter.append(transfer);
    defs.append(filter);
    const colors = {};
    for (const side of ["w", "b"]) {
      colors[side] = createPreviewColorFilter(`${id}-${side}`);
      defs.append(colors[side].filter);
    }
    entry.previewPieceSvg.insertBefore(defs, entry.previewPieceSvg.firstChild);
    entry.previewDefenseFilter = { id, channels, flood, transfer, colors };
  }

  function syncPreviewDefenseFilter(entry) {
    if (!entry.previewPieceImage) return;
    const mix = Math.max(0, Math.min(1, entry.defensePreviewMix ?? 0));
    const recolor = settings.pieceSet !== "rund_comic";
    const previewFields = entry.previewPieceGroup?.querySelector(":scope > svg.lfs-king-preview-fields");
    if (!mix && !recolor) {
      entry.previewPieceImage.removeAttribute("filter");
      previewFields?.removeAttribute("filter");
      return;
    }
    ensurePreviewDefenseFilter(entry);
    if (!entry.previewDefenseFilter) return;
    const { flood, transfer, colors } = entry.previewDefenseFilter;
    transfer.setAttribute("in", recolor ? "piece-color" : "SourceGraphic");
    flood.setAttribute("flood-color", entry.previewPieceColor === "b" ? settings.blackPieceColor : settings.whitePieceColor);
    for (const side of ["w", "b"]) {
      colors[side].flood.setAttribute("flood-color", side === "w" ? settings.whitePieceColor : settings.blackPieceColor);
    }
    const filter = `url(#${entry.previewDefenseFilter.id})`;
    entry.previewPieceImage.setAttribute("filter", filter);
    previewFields?.setAttribute("filter", filter);
    for (const channel of entry.previewDefenseFilter.channels) {
      channel.setAttribute("slope", String(1 - mix));
      channel.setAttribute("intercept", String(mix));
    }
  }

  function startHighlightCascades(board, entry, position, root, blackOrientation, preview = null) {
    const cascades = [];
    if (settings.highlightCascadesEnabled && settings.defenseHighlightEnabled) {
      cascades.push({ layers: getDefenseCascadeLayers(position, root, blackOrientation, settings.defenseHighlightDepth), isAttack: false });
    }
    if (settings.highlightCascadesEnabled && settings.attackHighlightEnabled) {
      cascades.push({ layers: getAttackCascadeLayers(position, root, blackOrientation, settings.defenseHighlightDepth), isAttack: true });
    }
    const activeCascades = cascades.filter(cascade => cascade.layers.length);
    if (!activeCascades.length) {
      if (settings.highlightCascadeLinesHoldEnabled) endPreviousDefenseWaves(entry, performance.now(), false);
      return false;
    }
    const squares = new Map();
    const connections = new Map();
    for (const { layers, isAttack } of activeCascades) {
      for (const [depth, layer] of layers.entries()) {
        // An attack and its recapture belong to the same displayed wave.
        const displayDepth = isAttack ? Math.ceil(depth / 2) : depth;
        for (const square of layer) {
          const key = `${square.row},${square.col}`;
          if (!squares.has(key) || displayDepth < squares.get(key).depth) {
            squares.set(key, { square, depth: displayDepth });
          }
        }
      }
      if (settings.highlightCascadeLinesEnabled) {
        for (const edge of getHighlightCascadeConnections(position, layers, isAttack, blackOrientation)) {
          connections.set(`${edge.to.row},${edge.to.col}`, edge);
        }
      }
    }
    const reverse = settings.highlightCascadeReverseEnabled;
    const maxDepth = Math.max(...[...squares.values()].map(node => node.depth));
    for (const node of squares.values()) {
      if (node.depth && position[node.square.row][node.square.col].type === "king") node.depth = maxDepth;
    }
    const nodeWave = depth => reverse ? maxDepth - depth : depth;
    const nodes = [];
    for (const { square, depth } of squares.values()) {
      const previewRoot = Boolean(preview?.isHoverPreview && depth === 0
        && square.row === root.row && square.col === root.col);
      const piece = position[square.row][square.col];
      const element = previewRoot ? null : piece.element
        ?? findPieceElement(board, square, preview, blackOrientation);
      if (element || previewRoot) nodes.push({ element, depth, wave: nodeWave(depth), previewRoot });
    }
    const startedAt = performance.now();
    const lines = [];
    let lineGroup = null;
    let lineMask = null;
    if (connections.size) {
      if (!entry.highlightLineSvg) {
        entry.highlightLineSvg = document.createElementNS(svgNamespace, "svg");
        entry.highlightLineSvg.setAttribute("viewBox", "0 0 8 8");
        entry.highlightLineSvg.setAttribute("aria-hidden", "true");
        entry.highlightLineDefs = document.createElementNS(svgNamespace, "defs");
        entry.highlightLineSvg.append(entry.highlightLineDefs);
      }
      globalThis.LichessBoardOverlay.place(board, entry.highlightLineSvg, "between-pieces");
      lineMask = createHighlightLineMask(entry, board, position, blackOrientation);
      lineGroup = document.createElementNS(svgNamespace, "g");
      entry.highlightLineSvg.append(lineGroup);
      for (const [key, { from, to }] of connections) {
        const depth = squares.get(key).depth;
        const piece = position[to.row][to.col];
        const color = piece.color === "w" ? settings.whitePieceColor : settings.blackPieceColor;
        const id = `lfs-highlight-line-${++defenseHighlightLineId}`;
        const gradient = document.createElementNS(svgNamespace, "linearGradient");
        gradient.setAttribute("id", id);
        gradient.setAttribute("gradientUnits", "userSpaceOnUse");
        const stops = Array.from({ length: 10 }, () => document.createElementNS(svgNamespace, "stop"));
        for (const stop of stops) stop.setAttribute("stop-color", color);
        gradient.append(...stops);
        entry.highlightLineDefs.append(gradient);
        const path = document.createElementNS(svgNamespace, "path");
        const [start, end] = reverse ? [to, from] : [from, to];
        path.setAttribute("d", `M ${start.col + 0.5} ${start.row + 0.5} L ${end.col + 0.5} ${end.row + 0.5}`);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", `url(#${id})`);
        path.setAttribute("stroke-width", String(settings.defenseHighlightLineWidthPercent / 100));
        path.setAttribute("stroke-dasharray", "0 100");
        path.setAttribute("stroke-dashoffset", "0");
        path.setAttribute("stroke-opacity", "0");
        path.setAttribute("visibility", "hidden");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("pointer-events", "none");
        if (lineMask) path.setAttribute("mask", `url(#${lineMask.mask.id})`);
        lineGroup.append(path);
        lines.push({ path, gradient, stops, color, depth, wave: nodeWave(depth),
          lineMask,
          startSquare: start, endSquare: end,
          fromX: start.col + 0.5, fromY: start.row + 0.5,
          toX: end.col + 0.5, toY: end.row + 0.5,
          length: Math.hypot(to.col - from.col, to.row - from.row) });
      }
    }
    if (!nodes.length && !lines.length) return false;
    entry.defenseHighlightRuns ??= [];
    const previousRunCount = entry.defenseHighlightRuns.length;
    entry.defenseHighlightRuns.push({
      nodes,
      lines,
      lineGroup,
      lineMask,
      root: { row: root.row, col: root.col },
      held: false,
      reverse,
      maxDepth,
      startedAt,
      endAt: startedAt + maxDepth * settings.defenseHighlightWaveIntervalMs + settings.defenseHighlightDurationMs
    });
    if (settings.highlightCascadeLinesHoldEnabled) {
      for (const run of entry.defenseHighlightRuns.slice(0, previousRunCount)) {
        if (!run.lines.length || run.lines.some(line => line.fadeOut)) continue;
        run.retiring = true;
        run.waitingForReplacement = true;
        run.held = false;
      }
    }
    if (!entry.defenseHighlightFrame) {
      entry.defenseHighlightFrame = requestAnimationFrame(timestamp => {
        entry.defenseHighlightFrame = 0;
        advanceDefenseCascade(entry, timestamp);
      });
    }
    return true;
  }

  function advanceDefenseCascade(entry, timestamp) {
    const mixByPiece = new Map();
    let previewMix = 0;
    const runs = [];
    const previousRuns = entry.defenseHighlightRuns;
    const replacements = entry.defenseHighlightRuns.filter(run => !run.retiring);
    const replacementVisible = settings.highlightCascadeLinesHoldEnabled && replacements.length
      && replacements.every(run => run.lines.every(line => {
        const state = getHighlightLineState(line, run, timestamp, settings.highlightCascadeLinesHoldEnabled);
        return state.progress > 0 && (state.opacity > 0 || state.finished);
      }));
    for (const run of entry.defenseHighlightRuns) {
      if (run.waitingForReplacement && replacementVisible) {
        for (const line of run.lines) {
          const state = getHighlightLineState(line, run, timestamp, true);
          line.fadeOut = { startedAt: timestamp, opacity: state.opacity, progress: state.progress,
            duration: 180, reverse: true };
        }
        run.waitingForReplacement = false;
        run.endAt = timestamp + 180;
      }
      const holdLines = settings.highlightCascadeLinesHoldEnabled
        && (run.waitingForReplacement || (!run.retiring
          && entry.defenseLineHoldRoot?.row === run.root.row
          && entry.defenseLineHoldRoot?.col === run.root.col));
      run.holding = holdLines;
      let keepRun = timestamp < run.endAt;
      for (const node of run.nodes) {
        const mix = getDefenseNodeMix(node, run, timestamp);
        if (mix <= 0) continue;
        if (node.previewRoot) previewMix = Math.max(previewMix, mix);
        else if (node.element) mixByPiece.set(node.element, Math.max(mixByPiece.get(node.element) ?? 0, mix));
      }
      run.lines = run.lines.filter(line => {
        const state = getHighlightLineState(line, run, timestamp, holdLines || line.held);
        if (state.finished) {
          if (holdLines && !line.fadeOut) {
            holdHighlightLine(line);
            return true;
          }
          removeHighlightLine(line);
          return false;
        }
        updateHighlightLine(line, state);
        return true;
      });
      if (timestamp >= run.endAt) {
        if (holdLines && run.lines.length) {
          run.nodes = [];
          run.held = !run.waitingForReplacement;
          keepRun = true;
        } else {
          for (const line of run.lines) removeHighlightLine(line);
          run.lines = [];
        }
      }
      if (keepRun) runs.push(run);
    }
    for (const piece of entry.defenseHighlightedPieces) {
      if (mixByPiece.has(piece)) continue;
      piece.removeAttribute("data-lfs-defense-highlight");
      piece.style.removeProperty("--lfs-defense-highlight-mix");
    }
    for (const [piece, mix] of mixByPiece) {
      piece.setAttribute("data-lfs-defense-highlight", "");
      piece.style.setProperty("--lfs-defense-highlight-mix", `${(mix * 100).toFixed(2)}%`);
    }
    entry.defenseHighlightedPieces = new Set(mixByPiece.keys());
    entry.defensePreviewMix = previewMix;
    syncPreviewDefenseFilter(entry);
    releaseRemovedDefenseLineRuns(entry, previousRuns, runs);
    entry.defenseHighlightRuns = runs;
    if (!runs.some(run => run.lines.length)) {
      entry.highlightLineSvg?.remove();
      entry.highlightLineSvg = null;
      entry.highlightLineDefs = null;
    }
    if (runs.some(run => !run.held)) {
      entry.defenseHighlightFrame = requestAnimationFrame(timestamp => {
        entry.defenseHighlightFrame = 0;
        advanceDefenseCascade(entry, timestamp);
      });
    }
  }

  function updateDefenseHighlight(board, entry, parsed, preview) {
    if (!settings?.enabled || !settings.highlightCascadesEnabled
      || (!settings.defenseHighlightEnabled && !settings.attackHighlightEnabled)
      || settings.disableAnimations || !parsed) {
      clearDefenseHighlights(entry);
      return;
    }
    const highlightSettingsKey = [
      settings.highlightCascadesEnabled,
      settings.defenseHighlightEnabled,
      settings.attackHighlightEnabled,
      settings.highlightCascadeLinesEnabled,
      settings.highlightCascadeLinesHoldEnabled,
      settings.highlightCascadeReverseEnabled,
      settings.pieceSet
    ].join(":");
    if (entry.defenseHighlightSettingsKey !== undefined
      && entry.defenseHighlightSettingsKey !== highlightSettingsKey) clearDefenseHighlights(entry);
    entry.defenseHighlightSettingsKey = highlightSettingsKey;

    const selectedPosition = parsed.position;
    const selectedRoot = parsed.selected;
    const selectedPiece = selectedRoot && selectedPosition[selectedRoot.row]?.[selectedRoot.col];
    const selectedKey = selectedPiece
      ? `selected:${selectedRoot.row},${selectedRoot.col}:${selectedPiece.color}${selectedPiece.type}`
      : null;
    const nextHoldRoot = getDefenseLineHoldRoot(board, entry, parsed.position, selectedRoot, selectedPiece, preview);
    if (preview?.isHoverPreview && preview.legal) {
      entry.defenseLineHoldPendingRoot = nextHoldRoot;
    } else {
      entry.defenseLineHoldPendingRoot = null;
      setDefenseLineHoldRoot(entry, nextHoldRoot);
    }
    if (preview?.isHoverPreview && preview.legal) {
      clearDefenseHoverTimer(entry);
      entry.defenseHoverKey = null;
      entry.defenseHoverStartedKey = null;
    } else if (selectedPiece) {
      clearDefenseHoverTimer(entry);
      entry.defenseHoverKey = null;
      entry.defenseHoverStartedKey = null;
      if (entry.defenseSelectedKey !== selectedKey || entry.defenseCascadeContextKey?.startsWith("preview:")) {
        entry.defenseSelectedKey = selectedKey;
        setDefenseCascadeContext(entry, selectedKey);
        const started = (!settings.highlightCascadeLinesHoldEnabled || nextHoldRoot)
          && startHighlightCascades(board, entry, selectedPosition, selectedRoot, parsed.blackOrientation);
        if (started && preview && !preview.isHoverPreview) markPreviewMovePlayed(entry, preview);
      } else if (!preview?.isHoverPreview && !entry.defenseCascadeContextKey?.startsWith("move:")) {
        setDefenseCascadeContext(entry, selectedKey);
      }
    } else {
      entry.defenseSelectedKey = null;
      const square = entry.hoveredSquare;
      const piece = square && parsed.position[square.row]?.[square.col];
      const key = piece && square ? `hover:${square.row},${square.col}:${piece.color}${piece.type}` : null;
      if (key !== entry.defenseHoverKey) {
        entry.defenseHoverKey = key;
        entry.defenseHoverStartedKey = null;
        clearDefenseHoverTimer(entry);
        setDefenseCascadeContext(entry, key);
      }
      if (!key || entry.defenseHoverStartedKey === key) {
        if (!key && !entry.defenseCascadeContextKey?.startsWith("move:")) setDefenseCascadeContext(entry, null);
      } else {
        if (entry.defenseHoverPendingKey !== key) {
          clearDefenseHoverTimer(entry);
          entry.defenseHoverPendingKey = key;
          entry.defenseHoverPendingAt = performance.now();
        }
        const remaining = settings.defensePreviewThresholdMs - (performance.now() - entry.defenseHoverPendingAt);
        if (remaining > 0) {
          if (!entry.defenseHoverTimer) {
            entry.defenseHoverTimer = setTimeout(() => {
              entry.defenseHoverTimer = 0;
              scheduleRender(board);
            }, remaining);
          }
        } else {
          clearDefenseHoverTimer(entry);
          entry.defenseHoverStartedKey = key;
          setDefenseCascadeContext(entry, key);
          startHighlightCascades(board, entry, parsed.position, square, parsed.blackOrientation);
        }
      }
    }

    if (!preview?.isHoverPreview || !preview.legal) {
      clearDefensePreviewTimer(entry);
      entry.defensePreviewSourceKey = null;
      entry.defensePreviewLastTargetKey = null;
      if (selectedKey && !entry.defenseCascadeContextKey?.startsWith("move:")) {
        setDefenseCascadeContext(entry, selectedKey);
      }
      if (!preview && !board.querySelector(":scope > piece.anim")) {
        const lastMove = getLastMove(board, parsed.position, parsed.blackOrientation);
        const moveKey = lastMove?.key;
        const targetPiece = lastMove && parsed.position[lastMove.target.row][lastMove.target.col];
        const targetHoverKey = targetPiece
          ? `hover:${lastMove.target.row},${lastMove.target.col}:${targetPiece.color}${targetPiece.type}`
          : null;
        const targetSelectedKey = targetPiece
          ? `selected:${lastMove.target.row},${lastMove.target.col}:${targetPiece.color}${targetPiece.type}`
          : null;
        const alreadyHighlighted = Boolean(targetHoverKey && (
          entry.defenseHoverStartedKey === targetHoverKey || entry.defenseSelectedKey === targetSelectedKey
        ));
        if (shouldPlayLastMoveCascade(entry, moveKey, alreadyHighlighted)) {
          setDefenseCascadeContext(entry, `move:${moveKey}`);
          if (startHighlightCascades(board, entry, parsed.position, lastMove.target, parsed.blackOrientation)) {
            entry.defensePlayedMoveKeys.add(moveKey);
          }
        }
        if (targetHoverKey && entry.hoveredSquare?.row === lastMove.target.row
          && entry.hoveredSquare?.col === lastMove.target.col) {
          clearDefenseHoverTimer(entry);
          entry.defenseHoverKey = targetHoverKey;
          entry.defenseHoverStartedKey = targetHoverKey;
        }
      }
      return;
    }

    const sourceKey = `${preview.source.row},${preview.source.col}`;
    if (entry.defensePreviewSourceKey !== sourceKey) {
      clearDefensePreviewTimer(entry);
      entry.defensePreviewSourceKey = sourceKey;
      entry.defensePreviewLastTargetKey = null;
    }
    const targetKey = `${sourceKey}:${preview.target.row},${preview.target.col}`;
    if (preview.source.row === preview.target.row && preview.source.col === preview.target.col) {
      const sourceChanged = entry.defenseSelectedKey !== selectedKey
        || entry.defensePreviewLastTargetKey !== targetKey;
      clearDefensePreviewTimer(entry);
      entry.defensePreviewLastTargetKey = targetKey;
      entry.defenseSelectedKey = selectedKey;
      setDefenseLineHoldRoot(entry, entry.defenseLineHoldPendingRoot ?? nextHoldRoot);
      entry.defenseLineHoldPendingRoot = null;
      setDefenseCascadeContext(entry, selectedKey);
      const hasSourceRun = entry.defenseHighlightRuns.some(run => !run.retiring
        && run.root.row === selectedRoot.row && run.root.col === selectedRoot.col);
      if (!hasSourceRun && (settings.highlightCascadeLinesHoldEnabled || sourceChanged)) {
        startHighlightCascades(board, entry, selectedPosition, selectedRoot, parsed.blackOrientation, preview);
      }
      return;
    }
    if (isNewDefensePreviewTarget(entry, targetKey)) {
      clearDefensePreviewTimer(entry);
      entry.defensePreviewPendingKey = targetKey;
      entry.defensePreviewPendingAt = performance.now();
    } else if (entry.defensePreviewPendingKey !== targetKey) {
      return;
    }
    const remaining = settings.defensePreviewThresholdMs - (performance.now() - entry.defensePreviewPendingAt);
    if (remaining > 0) {
      if (!entry.defensePreviewTimer) {
        entry.defensePreviewTimer = setTimeout(() => {
          entry.defensePreviewTimer = 0;
          scheduleRender(board);
        }, remaining);
      }
      return;
    }
    clearDefensePreviewTimer(entry);
    setDefenseLineHoldRoot(entry, entry.defenseLineHoldPendingRoot ?? nextHoldRoot);
    entry.defenseLineHoldPendingRoot = null;
    setDefenseCascadeContext(entry, `preview:${targetKey}`);
    if (startHighlightCascades(board, entry, parsed.position, parsed.selected, parsed.blackOrientation, preview)) {
      markPreviewMovePlayed(entry, preview);
    }
  }

  function getDefenseLineHoldRoot(board, entry, position, selectedRoot, selectedPiece, preview) {
    if (!settings.highlightCascadeLinesHoldEnabled || !settings.highlightCascadeLinesEnabled) return null;
    if (selectedPiece) {
      const hoveredRoot = entry.hoveredSquare?.row === selectedRoot.row && entry.hoveredSquare?.col === selectedRoot.col;
      const previewRoot = Boolean(preview);
      return hoveredRoot || previewRoot || getDraggingPiece(board)
        ? { row: selectedRoot.row, col: selectedRoot.col }
        : null;
    }
    const square = entry.hoveredSquare;
    return position[square?.row]?.[square?.col] ? { row: square.row, col: square.col } : null;
  }

  function clearMovePreviewPiece(board, entry) {
    for (const square of board.querySelectorAll(":scope > square[data-lfs-preview-move-dest]")) {
      square.removeAttribute("data-lfs-preview-move-dest");
    }
    for (const piece of board.querySelectorAll(":scope > piece[data-lfs-move-preview-origin], :scope > piece[data-lfs-move-preview-hidden]")) {
      piece.removeAttribute("data-lfs-move-preview-origin");
      if (!piece.classList.contains("fading")) piece.removeAttribute("data-lfs-move-preview-hidden");
    }
    if (entry.previewAnimationFrame) cancelAnimationFrame(entry.previewAnimationFrame);
    entry.previewAnimationFrame = 0;
    entry.previewAnimation = null;
    entry.previewTranslation = { x: 0, y: 0 };
    entry.previewOpacity = 0;
    entry.previewTargetKey = null;
    entry.previewSourceKey = null;
    entry.previewPointerMotion = null;
    entry.defensePreviewMix = 0;
    clearPromotionPreview(entry);
    syncPreviewDefenseFilter(entry);
    if (!entry.previewPieceSvg) return;
    entry.previewPieceSvg.remove();
    entry.previewPieceSvg = null;
    entry.previewPieceGroup = null;
    entry.previewPieceImage = null;
    entry.previewDefenseFilter = null;
  }

  function clearPromotionPreview(entry) {
    if (entry.promotionPreview?.timer != null) clearInterval(entry.promotionPreview.timer);
    entry.promotionPreview = null;
  }

  function updatePromotionPreview(entry, color, sourcePiece, source, target, active) {
    const promotionRow = color === "w" ? 0 : 7;
    const interval = settings.promotionPreviewIntervalMs;
    const isPromotion = active && settings.enabled && !settings.disableAnimations
      && sourcePiece === `${color}P` && target.row === promotionRow
      && (source.row !== target.row || source.col !== target.col);
    if (!isPromotion) {
      clearPromotionPreview(entry);
      return null;
    }

    const key = `${color}:${source.row},${source.col}:${target.row},${target.col}`;
    if (entry.promotionPreview?.key !== key || entry.promotionPreview.interval !== interval) {
      clearPromotionPreview(entry);
      const state = { key, interval, index: 0, timer: null };
      state.timer = setInterval(() => {
        if (entry.promotionPreview !== state) return;
        state.index = (state.index + 1) % promotionPreviewPieces.length;
        if (entry.previewPieceImage) {
          entry.previewPieceImage.setAttribute("href", getPieceAssetUrl(color, pieceNamesByLetter[promotionPreviewPieces[state.index]]));
        }
      }, interval);
      entry.promotionPreview = state;
    }
    return promotionPreviewPieces[entry.promotionPreview.index];
  }

  function bezierCoordinate(t, firstControl, secondControl) {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * firstControl + 3 * inverse * t * t * secondControl + t * t * t;
  }

  function getMovePreviewEasedProgress(progress) {
    // Use the same configurable curve as the candidate-move animation.
    const [time1, value1, time2, value2] = settings.moveAnimationCurve;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 12; iteration++) {
      const middle = (low + high) / 2;
      if (bezierCoordinate(middle, time1, time2) < progress) low = middle;
      else high = middle;
    }
    return bezierCoordinate((low + high) / 2, value1 / -90, value2 / -90);
  }

  function getMovePreviewState(entry, now = performance.now()) {
    const animation = entry.previewAnimation;
    if (!animation) return { ...entry.previewTranslation, opacity: entry.previewOpacity };
    if (animation.tracking) {
      let target = animation.to;
      const motion = entry.previewPointerMotion;
      const age = motion ? Math.max(0, now - motion.time) : Infinity;
      const anticipation = settings.movePreviewAnticipationPercent / 100;
      if (anticipation > 0 && motion?.smooth && age < 90) {
        // Predict only along a connection to a neighbouring legal move field.
        const speed = Math.hypot(motion.vx, motion.vy);
        const lookAhead = Math.min(60, 0.65 / speed) * (1 - age / 90) * anticipation;
        const predicted = {
          x: motion.x - animation.source.col - 0.5 + motion.vx * lookAhead,
          y: motion.y - animation.source.row - 0.5 + motion.vy * lookAhead
        };
        let closest = Infinity;
        for (const destination of animation.destinations) {
          const dx = destination.x - animation.to.x;
          const dy = destination.y - animation.to.y;
          const distance = Math.hypot(dx, dy);
          if (!distance || distance > 1.5 || (dx * motion.vx + dy * motion.vy) / (distance * speed) < 0.85) continue;
          const progress = Math.max(0, Math.min(1,
            ((predicted.x - animation.to.x) * dx + (predicted.y - animation.to.y) * dy) / (distance * distance)));
          const candidate = { x: animation.to.x + dx * progress, y: animation.to.y + dy * progress };
          const error = Math.hypot(predicted.x - candidate.x, predicted.y - candidate.y);
          if (error < closest && error < 0.6) {
            target = candidate;
            closest = error;
          }
        }
      }
      // A critically damped response preserves velocity across field changes.
      const elapsed = Math.max(0, now - animation.lastTime);
      const response = 0.035 / (1 + (1 - anticipation) * 2);
      const decay = Math.exp(-response * elapsed);
      const state = { opacity: 1 - (1 - entry.previewOpacity) * decay };
      for (const axis of ["x", "y"]) {
        const offset = entry.previewTranslation[axis] - target[axis];
        const momentum = animation.velocity[axis] + response * offset;
        state[axis] = target[axis] + (offset + momentum * elapsed) * decay;
        state[`v${axis}`] = (animation.velocity[axis] - response * momentum * elapsed) * decay;
      }
      return state;
    }
    const progress = Math.min(1, (now - animation.startedAt) / animation.duration);
    const eased = getMovePreviewEasedProgress(progress);
    return {
      x: animation.from.x + (animation.to.x - animation.from.x) * eased,
      y: animation.from.y + (animation.to.y - animation.from.y) * eased,
      opacity: animation.from.opacity + (1 - animation.from.opacity) * eased
    };
  }

  function setMovePreviewTarget(board, entry, preview, sourceSquare, targetSquare) {
    const targetKey = `${preview.source.row},${preview.source.col}:${preview.target.row},${preview.target.col}`;
    const sourceKey = `${sourceSquare.row},${sourceSquare.col}`;
    const to = { x: targetSquare.col - sourceSquare.col, y: targetSquare.row - sourceSquare.row };
    const anticipationEnabled = settings.movePreviewAnticipationPercent > 0;
    const tracking = anticipationEnabled && entry.previewPointerMotion?.smooth
      && performance.now() - entry.previewPointerMotion.time < 90;
    if (entry.previewSourceKey !== sourceKey) {
      if (entry.previewAnimationFrame) cancelAnimationFrame(entry.previewAnimationFrame);
      entry.previewAnimationFrame = 0;
      entry.previewAnimation = null;
      entry.previewTranslation = { x: 0, y: 0 };
      entry.previewOpacity = 0;
      entry.previewTargetKey = null;
      entry.previewSourceKey = sourceKey;
      entry.previewPieceGroup.setAttribute("transform", "translate(0 0)");
      entry.previewPieceGroup.setAttribute("opacity", "0");
    }
    const destinations = tracking || entry.previewAnimation?.tracking
      ? [...board.querySelectorAll(":scope > square.move-dest, :scope > square.premove-dest")]
        .map(square => getScreenSquare(square, board)).filter(Boolean)
        .map(square => ({ x: square.col - sourceSquare.col, y: square.row - sourceSquare.row }))
      : [];
    if (anticipationEnabled && entry.previewAnimation?.tracking && !settings.disableAnimations) {
      entry.previewAnimation.to = to;
      entry.previewAnimation.destinations = destinations;
      entry.previewTargetKey = targetKey;
      return;
    }
    if (entry.previewTargetKey === targetKey) {
      const currentAnimation = entry.previewAnimation;
      const animationAlreadyTargets = currentAnimation
        && (anticipationEnabled || !currentAnimation.tracking)
        && Math.hypot(currentAnimation.to.x - to.x, currentAnimation.to.y - to.y) < 0.005;
      const alreadyAtTarget = !currentAnimation
        && Math.hypot(entry.previewTranslation.x - to.x, entry.previewTranslation.y - to.y) < 0.005;
      if (settings.disableAnimations) {
        if (alreadyAtTarget) return;
        if (entry.previewAnimationFrame) cancelAnimationFrame(entry.previewAnimationFrame);
        entry.previewAnimationFrame = 0;
        entry.previewAnimation = null;
        entry.previewPieceGroup.setAttribute("transform", `translate(${to.x} ${to.y})`);
        entry.previewTranslation = to;
        entry.previewPieceGroup.setAttribute("opacity", "1");
        entry.previewOpacity = 1;
        return;
      }
      if (!tracking && (alreadyAtTarget || animationAlreadyTargets)) return;
    }

    const now = performance.now();
    const from = getMovePreviewState(entry, now);
    const previous = getMovePreviewState(entry, now - 1);
    if (entry.previewAnimationFrame) cancelAnimationFrame(entry.previewAnimationFrame);
    entry.previewAnimationFrame = 0;
    entry.previewAnimation = null;
    entry.previewPieceGroup.setAttribute("transform", `translate(${from.x} ${from.y})`);
    entry.previewPieceGroup.setAttribute("opacity", String(from.opacity));
    entry.previewTranslation = { x: from.x, y: from.y };
    entry.previewOpacity = from.opacity;
    entry.previewTargetKey = targetKey;

    // Same duration formula as the normal move animation (move-animation.js).
    const remaining = Math.hypot(to.x - from.x, to.y - from.y);
    const travel = settings.moveAnimationTimeDistance ? remaining : 1;
    const baseDuration = settings.moveAnimationLichessSpeed ? 250 : settings.moveAnimationDuration;
    const distanceFactor = settings.moveAnimationTimeDistance ? settings.moveAnimationDistanceFactor : 0;
    const duration = baseDuration + travel * distanceFactor * baseDuration;
    if (!settings.enabled || settings.disableAnimations || duration <= 0 || (!tracking && remaining < 0.005)) {
      entry.previewPieceGroup.setAttribute("transform", `translate(${to.x} ${to.y})`);
      entry.previewTranslation = to;
      entry.previewOpacity = 1;
      entry.previewPieceGroup.setAttribute("opacity", "1");
      return;
    }

    entry.previewAnimation = { from, to, startedAt: now, duration };
    if (tracking) {
      Object.assign(entry.previewAnimation, {
        tracking: true, lastTime: now, source: sourceSquare,
        velocity: { x: from.x - previous.x, y: from.y - previous.y },
        destinations
      });
    }
    const animate = timestamp => {
      const animation = entry.previewAnimation;
      if (!animation) return;
      const progress = Math.min(1, (timestamp - animation.startedAt) / animation.duration);
      const current = getMovePreviewState(entry, timestamp);
      if (animation.tracking) {
        animation.velocity = { x: current.vx, y: current.vy };
        animation.lastTime = timestamp;
      }
      entry.previewPieceGroup.setAttribute("transform", `translate(${current.x} ${current.y})`);
      entry.previewPieceGroup.setAttribute("opacity", String(current.opacity));
      entry.previewTranslation = current;
      entry.previewOpacity = current.opacity;
      const settled = animation.tracking
        ? (!entry.previewPointerMotion?.smooth || timestamp - entry.previewPointerMotion.time >= 90)
          && Math.hypot(current.x - animation.to.x, current.y - animation.to.y) < 0.001
          && Math.hypot(current.vx, current.vy) < 0.0001 && current.opacity > 0.999
        : progress >= 1;
      if (settled) {
        entry.previewTranslation = animation.to;
        entry.previewOpacity = 1;
        entry.previewPieceGroup.setAttribute("transform", `translate(${animation.to.x} ${animation.to.y})`);
        entry.previewPieceGroup.setAttribute("opacity", "1");
        entry.previewAnimation = null;
        entry.previewAnimationFrame = 0;
        return;
      }
      entry.previewAnimationFrame = requestAnimationFrame(animate);
    };
    entry.previewAnimationFrame = requestAnimationFrame(animate);
  }

  function renderMovePreviewPiece(board, entry, preview) {
    for (const square of board.querySelectorAll(":scope > square[data-lfs-preview-move-dest]")) {
      square.removeAttribute("data-lfs-preview-move-dest");
    }
    for (const piece of board.querySelectorAll(":scope > piece[data-lfs-move-preview-origin], :scope > piece[data-lfs-move-preview-hidden]")) {
      piece.removeAttribute("data-lfs-move-preview-origin");
      if (!piece.classList.contains("fading")) piece.removeAttribute("data-lfs-move-preview-hidden");
    }
    if (!preview || (!preview.isHoverPreview && !preview.isDragging) || !preview.legal) {
      clearMovePreviewPiece(board, entry);
      return;
    }

    const { basePosition, position, blackOrientation } = preview;
    const newPieces = [];
    const changedPieces = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const previous = basePosition[row][col];
        const next = position[row][col];
        if (previous === next) continue;
        const square = logicalToScreen({ row, col }, blackOrientation);
        if (previous) changedPieces.push({ piece: previous, square, source: { row, col } });
        if (next) newPieces.push({ piece: next, square });
      }
    }

    for (const changed of changedPieces) {
      const element = findPieceElement(board, changed.square, null, blackOrientation);
      if (!element) continue;
      const isSelectedOrigin = changed.source.row === preview.source.row && changed.source.col === preview.source.col;
      const pieceMovesElsewhere = newPieces.some(candidate => candidate.piece === changed.piece
        && (candidate.square.row !== changed.square.row || candidate.square.col !== changed.square.col));
      element.setAttribute(isSelectedOrigin || pieceMovesElsewhere
        ? "data-lfs-move-preview-origin"
        : "data-lfs-move-preview-hidden", "");
    }
    if (preview.source.row === preview.target.row && preview.source.col === preview.target.col) {
      const sourceSquare = logicalToScreen(preview.source, blackOrientation);
      findPieceElement(board, sourceSquare, null, blackOrientation)?.setAttribute("data-lfs-move-preview-origin", "");
    }

    if (!entry.previewPieceSvg) {
      entry.previewPieceSvg = document.createElementNS(svgNamespace, "svg");
      entry.previewPieceSvg.classList.add("lfs-move-preview-piece");
      entry.previewPieceSvg.setAttribute("viewBox", "0 0 8 8");
      entry.previewPieceSvg.setAttribute("aria-hidden", "true");
    }

    const sourceSquare = logicalToScreen(preview.source, blackOrientation);
    const targetSquare = logicalToScreen(preview.target, blackOrientation);
    entry.previewPieceSvg.setAttribute("data-lfs-preview-target", `${preview.target.row},${preview.target.col}`);
    for (const square of board.querySelectorAll(":scope > square.move-dest, :scope > square.premove-dest")) {
      const screen = getScreenSquare(square, board);
      if (screen?.row === targetSquare.row && screen.col === targetSquare.col) {
        square.setAttribute("data-lfs-preview-move-dest", "");
      }
    }
    if (!entry.previewPieceGroup) {
      entry.previewPieceGroup = document.createElementNS(svgNamespace, "g");
      entry.previewPieceGroup.setAttribute("transform", "translate(0 0)");
      entry.previewPieceImage = document.createElementNS(svgNamespace, "image");
      entry.previewPieceImage.setAttribute("width", "1");
      entry.previewPieceImage.setAttribute("height", "1");
      entry.previewPieceImage.setAttribute("preserveAspectRatio", "xMidYMid meet");
      entry.previewPieceImage.setAttribute("pointer-events", "none");
      entry.previewPieceGroup.append(entry.previewPieceImage);
      entry.previewPieceSvg.append(entry.previewPieceGroup);
    }

    const movedPiece = position[preview.target.row][preview.target.col];
    const color = movedPiece[0];
    const sourcePiece = basePosition[preview.source.row][preview.source.col];
    const promotionLetter = updatePromotionPreview(entry, color, sourcePiece, preview.source, preview.target,
      preview.isHoverPreview || preview.isDragging);
    const type = pieceNamesByLetter[promotionLetter ?? movedPiece[1]];
    entry.previewPieceColor = color;
    entry.previewPieceImage.setAttribute("x", String(sourceSquare.col));
    entry.previewPieceImage.setAttribute("y", String(sourceSquare.row));
    entry.previewPieceImage.setAttribute("href", getPieceAssetUrl(color, type));
    syncPreviewDefenseFilter(entry);
    if (isPieceRotated(color, blackOrientation)) {
      entry.previewPieceImage.setAttribute("transform", `rotate(180 ${sourceSquare.col + 0.5} ${sourceSquare.row + 0.5})`);
    } else {
      entry.previewPieceImage.removeAttribute("transform");
    }

    for (const child of [...entry.previewPieceSvg.children]) {
      if (child !== entry.previewPieceGroup && !child.matches?.("defs[data-lfs-defense-highlight-filter]")) child.remove();
    }
    for (const { piece, square } of newPieces) {
      if (square.row === targetSquare.row && square.col === targetSquare.col) continue;
      const image = document.createElementNS(svgNamespace, "image");
      const otherColor = piece[0];
      const otherType = pieceNamesByLetter[piece[1]];
      image.setAttribute("x", String(square.col));
      image.setAttribute("y", String(square.row));
      image.setAttribute("width", "1");
      image.setAttribute("height", "1");
      image.setAttribute("preserveAspectRatio", "xMidYMid meet");
      image.setAttribute("href", getPieceAssetUrl(otherColor, otherType));
      if (settings.pieceSet !== "rund_comic") {
        image.setAttribute("filter", `url(#${entry.previewDefenseFilter.colors[otherColor].id})`);
      }
      image.setAttribute("pointer-events", "none");
      if (isPieceRotated(otherColor, blackOrientation)) {
        image.setAttribute("transform", `rotate(180 ${square.col + 0.5} ${square.row + 0.5})`);
      }
      entry.previewPieceSvg.append(image);
    }
    globalThis.LichessKingMovementFields?.renderPreview(entry.previewPieceGroup, preview, entry.previewDefenseFilter?.id);
    entry.previewPieceGroup.querySelector(":scope > g[data-lfs-preview-threat]")?.remove();
    const previewThreat = entry.centerSvg?.querySelector(":scope > [data-lfs-hover-preview-outline]");
    if (previewThreat) {
      const group = document.createElementNS(svgNamespace, "g");
      group.setAttribute("data-lfs-preview-threat", "");
      group.setAttribute("transform", `translate(${sourceSquare.col - targetSquare.col} ${sourceSquare.row - targetSquare.row})`);
      group.append(previewThreat);
      entry.previewPieceGroup.append(group);
    }
    setMovePreviewTarget(board, entry, preview, sourceSquare, targetSquare);
    globalThis.LichessBoardOverlay.place(board, entry.previewPieceSvg, "above-pieces");
    const lineOverlay = [...board.children].find(child => child === entry.arcSvg || child === entry.centerSvg);
    if (lineOverlay) board.insertBefore(entry.previewPieceSvg, lineOverlay);
  }

  // One outline for all connected move destinations. Shared straight edges are omitted; bevel corners
  // are kept as the connection between diagonal squares and dropped where three or four squares meet.
  function renderMoveOutline(board, entry, selectedColor) {
    const targets = settings?.enabled && settings.moveIndicatorMode === "outline" && board.closest(".is2d")
      ? board.querySelectorAll(":scope > square.move-dest, :scope > square.premove-dest")
      : [];
    const cells = targets.length
      ? [...targets, ...board.querySelectorAll(":scope > square.selected")]
        .map(square => getScreenSquare(square, board)).filter(Boolean)
      : [];
    entry.moveOutlineSvg = drawMoveOutline(board, entry.moveOutlineSvg, cells, selectedColor, "move");
    if (entry.moveOutlineSvg) globalThis.LichessBoardOverlay.place(board, entry.moveOutlineSvg, "between-pieces");
  }

  function renderLastMoveOutline(board, entry) {
    const parsed = settings?.enabled && settings.markLastMove && board.closest(".is2d")
      ? readPosition(board)
      : null;
    const lastMove = parsed && getLastMove(board, parsed.position, parsed.blackOrientation);
    const cells = lastMove ? getLastMoveOutlineCells(lastMove.source, lastMove.target) : [];
    const piece = lastMove && parsed.position[lastMove.target.row]?.[lastMove.target.col];
    const selectedColor = settings?.moveDotsPlayerColor ? piece?.color : null;
    entry.lastMoveOutlineSvg = drawMoveOutline(board, entry.lastMoveOutlineSvg, cells, selectedColor, "last-move");
    if (entry.lastMoveOutlineSvg) globalThis.LichessBoardOverlay.place(board, entry.lastMoveOutlineSvg, "between-pieces");
  }

  function getLastMoveOutlineCells(source, target) {
    const rowDelta = target.row - source.row;
    const colDelta = target.col - source.col;
    const steps = Math.max(Math.abs(rowDelta), Math.abs(colDelta));
    const isStraight = rowDelta === 0 || colDelta === 0 || Math.abs(rowDelta) === Math.abs(colDelta);
    if (!isStraight || steps < 2) return [source, target];
    const rowStep = Math.sign(rowDelta);
    const colStep = Math.sign(colDelta);
    return Array.from({ length: steps + 1 }, (_, index) => ({
      row: source.row + rowStep * index,
      col: source.col + colStep * index
    }));
  }

  function drawMoveOutline(board, svg, cells, selectedColor, idSuffix) {
    if (!cells.length) {
      svg?.remove();
      return null;
    }

    const set = new Set(cells.map(({ row, col }) => `${row},${col}`));
    const has = (row, col) => set.has(`${row},${col}`);
    const pointCount = (x, y) => [has(y - 1, x - 1), has(y - 1, x), has(y, x - 1), has(y, x)].filter(Boolean).length;
    const round = settings.boardBevelEnabled && settings.boardFieldShape === "round" ? settings.boardRoundPercent / 200 : 0;
    const bevel = settings.boardBevelEnabled && settings.boardFieldShape === "bevel" ? settings.boardBevelPercent / 200 : 0;
    const isGapFilled = (x, y) => {
      const count = pointCount(x, y);
      return count >= 3 || (count === 2 && ((has(y - 1, x - 1) && has(y, x)) || (has(y - 1, x) && has(y, x - 1))));
    };
    const connectRoundedFields = round > 0;
    const segments = [];
    const shapes = [];
    const roundPaths = [];
    for (const { row, col } of cells) {
      const x0 = col;
      const y0 = row;
      const x1 = col + 1;
      const y1 = row + 1;
      if (round) {
        // Only exposed ends are rounded; adjacent fields keep a straight shared boundary.
        const top = !has(row - 1, col);
        const right = !has(row, col + 1);
        const bottom = !has(row + 1, col);
        const left = !has(row, col - 1);
        const tl = (top && left) || isGapFilled(x0, y0) ? round : 0;
        const tr = (top && right) || isGapFilled(x1, y0) ? round : 0;
        const br = (bottom && right) || isGapFilled(x1, y1) ? round : 0;
        const bl = (bottom && left) || isGapFilled(x0, y1) ? round : 0;
        const topRight = tr ? `A${tr} ${tr} 0 0 1 ${x1} ${y0 + tr}` : `L${x1} ${y0}`;
        const bottomRight = br ? `A${br} ${br} 0 0 1 ${x1 - br} ${y1}` : `L${x1} ${y1}`;
        const bottomLeft = bl ? `A${bl} ${bl} 0 0 1 ${x0} ${y1 - bl}` : `L${x0} ${y1}`;
        const topLeft = tl ? `A${tl} ${tl} 0 0 1 ${x0 + tl} ${y0}` : `L${x0} ${y0}`;
        shapes.push(`<path d="M${x0 + tl} ${y0}H${x1 - tr}${topRight}V${y1 - br}${bottomRight}H${x0 + bl}${bottomLeft}V${y0 + tl}${topLeft}Z"/>`);
        if (top) roundPaths.push(`M${x0 + tl} ${y0}H${x1 - tr}`);
        if (tr && !isGapFilled(x1, y0)) roundPaths.push(`M${x1 - tr} ${y0}${topRight}`);
        if (right) roundPaths.push(`M${x1} ${y0 + tr}V${y1 - br}`);
        if (br && !isGapFilled(x1, y1)) roundPaths.push(`M${x1} ${y1 - br}${bottomRight}`);
        if (bottom) roundPaths.push(`M${x1 - br} ${y1}H${x0 + bl}`);
        if (bl && !isGapFilled(x0, y1)) roundPaths.push(`M${x0 + bl} ${y1}${bottomLeft}`);
        if (left) roundPaths.push(`M${x0} ${y1 - bl}V${y0 + tl}`);
        if (tl && !isGapFilled(x0, y0)) roundPaths.push(`M${x0} ${y0 + tl}${topLeft}`);
        continue;
      }
      shapes.push([[x0 + bevel, y0], [x1 - bevel, y0], [x1, y0 + bevel], [x1, y1 - bevel], [x1 - bevel, y1], [x0 + bevel, y1], [x0, y1 - bevel], [x0, y0 + bevel]]);
      if (!has(row - 1, col)) segments.push([x0 + bevel, y0, x1 - bevel, y0]);
      if (!has(row, col + 1)) segments.push([x1, y0 + bevel, x1, y1 - bevel]);
      if (!has(row + 1, col)) segments.push([x1 - bevel, y1, x0 + bevel, y1]);
      if (!has(row, col - 1)) segments.push([x0, y1 - bevel, x0, y0 + bevel]);
    }
    // Bridge rounded corners with matching curves when fields meet at a point or diagonally.
    if (connectRoundedFields) {
      for (let x = 0; x <= 8; x++) {
        for (let y = 0; y <= 8; y++) {
          if (!isGapFilled(x, y)) continue;
          shapes.push(`<path d="M${x} ${y - round}A${round} ${round} 0 0 1 ${x + round} ${y}A${round} ${round} 0 0 1 ${x} ${y + round}A${round} ${round} 0 0 1 ${x - round} ${y}A${round} ${round} 0 0 1 ${x} ${y - round}Z"/>`);
          const corners = [
            { row: y, col: x, path: `M${x} ${y + round}A${round} ${round} 0 0 1 ${x + round} ${y}` },
            { row: y - 1, col: x, path: `M${x + round} ${y}A${round} ${round} 0 0 1 ${x} ${y - round}` },
            { row: y, col: x - 1, path: `M${x - round} ${y}A${round} ${round} 0 0 1 ${x} ${y + round}` },
            { row: y - 1, col: x - 1, path: `M${x} ${y - round}A${round} ${round} 0 0 1 ${x - round} ${y}` }
          ];
          for (const { row, col, path } of corners) {
            if (!has(row, col)) roundPaths.push(path);
          }
        }
      }
    }

    // Bevel gaps (diamonds) at grid points are filled when three or four squares meet or two diagonal squares
    // connect. Their chamfers are drawn only for the squares that are not filled, so the gap is bridged.
    for (let x = 0; bevel && x <= 8; x++) {
      for (let y = 0; y <= 8; y++) {
        const filled = isGapFilled(x, y);
        if (filled) shapes.push([[x, y - bevel], [x + bevel, y], [x, y + bevel], [x - bevel, y]]);
        const chamfers = [
          { row: y, col: x, segment: [x, y + bevel, x + bevel, y] },
          { row: y - 1, col: x, segment: [x + bevel, y, x, y - bevel] },
          { row: y, col: x - 1, segment: [x - bevel, y, x, y + bevel] },
          { row: y - 1, col: x - 1, segment: [x, y - bevel, x - bevel, y] }
        ];
        for (const { row, col, segment } of chamfers) {
          if (has(row, col) !== filled) segments.push(segment);
        }
      }
    }

    const color = selectedColor
      ? (selectedColor === "w" ? settings.whitePieceColor : settings.blackPieceColor)
      : settings.moveOutlineColor;
    const id = `lfs-${idSuffix}-outline-${[...observedBoards.keys()].indexOf(board)}`;
    const d = roundPaths.join("") + segments.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join("");
    const clipPolygons = shapes.map(shape => Array.isArray(shape)
      ? `<polygon points="${shape.map(point => point.join(",")).join(" ")}"/>`
      : shape).join("");
    const blur = Math.max(settings.moveGlowRadiusPercent / 100, 0.001);
    const line = `fill="none" stroke="${color}" stroke-width="${settings.moveOutlineWidthPx}" stroke-linecap="round" vector-effect="non-scaling-stroke"`;

    if (!svg) {
      svg = document.createElementNS(svgNamespace, "svg");
      svg.setAttribute("viewBox", "0 0 8 8");
      svg.setAttribute("aria-hidden", "true");
    }
    svg.innerHTML = `<defs><clipPath id="${id}">${clipPolygons}</clipPath>`
      + `<filter id="${id}-glow" filterUnits="userSpaceOnUse" x="-1" y="-1" width="10" height="10"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>`
      + `<g clip-path="url(#${id})" opacity="${settings.moveGlowOpacity / 100}"><path d="${d}" ${line} filter="url(#${id}-glow)"/></g>`
      + `<path d="${d}" ${line}/>`;
    if (idSuffix.startsWith("last-move")) svg.classList?.add("lfs-last-move-outline");
    return svg;
  }

  function createLastMovePreview(board, uci, blackOrientation, color) {
    if (!settings?.enabled || !settings.markLastMove) return null;
    const squares = uci?.match(/[a-h][1-8]/g) ?? [];
    if (squares.length !== 2) return null;
    const [source, target] = squares.map(square => {
      const file = square.charCodeAt(0) - 97;
      const rank = 8 - Number(square[1]);
      return blackOrientation ? { row: 7 - rank, col: 7 - file } : { row: rank, col: file };
    });
    const cells = getLastMoveOutlineCells(source, target);
    return drawMoveOutline(board, null, cells, settings.moveDotsPlayerColor ? color : null, "last-move-preview");
  }

  function renderBoard(board, entry) {
    clearMoveDestinationMarkers(board);

    const movePreview = globalThis.LichessThreatCoding?.getInteractionPreview(board);
    const dragPreview = movePreview;
    const parsed = movePreview ? readDragPreview(movePreview) : readPosition(board);
    updateDefenseHighlight(board, entry, parsed, movePreview);
    const selectedPiece = parsed?.selected && parsed.position[parsed.selected.row]?.[parsed.selected.col];
    const selectedColor = settings?.enabled && settings.moveDotsPlayerColor ? selectedPiece?.color : null;
    if (board.getAttribute("data-lfs-selected-piece-color") !== (selectedColor ?? "")) {
      if (selectedColor) board.setAttribute("data-lfs-selected-piece-color", selectedColor);
      else board.removeAttribute("data-lfs-selected-piece-color");
    }

    renderMoveOutline(board, entry, selectedColor);
    if (!settings?.enabled || !board.closest(".is2d") || !parsed) {
      clearMovePreviewPiece(board, entry);
      updateThreatenedPieces(board, null, dragPreview, { w: new Map(), b: new Map() }, false, false);
      renderThreatArcs(board, entry, []);
      entry.svg?.remove();
      entry.svg = null;
      return;
    }

    const threatsEnabled = settings.threatenedPieceOutlineEnabled;
    const positionAnalysis = threatsEnabled || settings.defenseCirclesEnabled
      ? getPositionAnalysis(parsed.position, parsed.blackOrientation)
      : null;
    const threatenedSquares = threatsEnabled
      ? positionAnalysis.threatenedSquares
      : { w: new Map(), b: new Map() };
    const threats = updateThreatenedPieces(
      board,
      parsed.position,
      dragPreview,
      threatenedSquares,
      threatsEnabled,
      parsed.blackOrientation
    );

    // While dragging, wedges are based on the piece's original square so they stay visible for all destinations, not only the hovered one.
    const wedgeParsed = dragPreview && !dragPreview.isHoverPreview
      ? readDragPreview({ ...dragPreview, position: dragPreview.basePosition, legal: false })
      : parsed;
    const wedgeSelectedPiece = wedgeParsed.selected && wedgeParsed.position[wedgeParsed.selected.row]?.[wedgeParsed.selected.col];
    const sources = !settings.selectedPieceWedgeEnabled
      ? []
      : settings.selectedPieceWedgeOnlySelected
        ? wedgeSelectedPiece ? [wedgeParsed.selected] : []
        : wedgeParsed.position.flatMap((row, rowIndex) => row.flatMap((piece, colIndex) => piece ? [{ row: rowIndex, col: colIndex }] : []));
    const showUnselectedPotentials = settings.selectedPieceWedgeEnabled
      && !settings.selectedPieceWedgeOnlySelected
      && !wedgeParsed.selected;
    const wedges = [];
    let legalDestinations = null;
    for (const source of sources) {
      const piece = wedgeParsed.position[source.row][source.col];
      const directTargets = getAttackedPieces(wedgeParsed.position, source, wedgeParsed.blackOrientation)
        .filter(target => {
          const targetPiece = wedgeParsed.position[target.row][target.col];
          if (!targetPiece || targetPiece.color === piece.color) return false;
          if (targetPiece.type === "king") {
            return pieceValues[targetPiece.type] > pieceValues[piece.type]
              && getBestExchangeGain(wedgeParsed.position, source, piece.color === "w" ? "b" : "w", wedgeParsed.blackOrientation) === 0;
          }
          return getCaptureGain(wedgeParsed.position, source, target, wedgeParsed.blackOrientation) > 0;
        });
      wedges.push(...directTargets.map(target => ({ source, target, color: piece.color, type: piece.type })));

      if (showUnselectedPotentials) continue;
      // Legal destinations from the board; while dragging on a board without them (setup mode), free fields are used.
      legalDestinations ??= [...board.querySelectorAll(":scope > square.move-dest")]
        .map(square => getScreenSquare(square, board)).filter(Boolean);
      const canReuseLegalDestinations = settings.selectedPieceWedgeOnlySelected && (legalDestinations.length || !dragPreview);
      const destinations = canReuseLegalDestinations
        ? legalDestinations
        : getCandidateMoves(wedgeParsed.position, source, piece, wedgeParsed.blackOrientation);
      wedges.push(...getPotentialWedges(wedgeParsed.position, source, destinations, wedgeParsed.blackOrientation, settings)
        .map(wedge => ({ ...wedge, color: piece.color })));
    }
    if (showUnselectedPotentials) {
      wedges.push(...getUnselectedPotentialWedges(wedgeParsed.position, wedgeParsed.blackOrientation, settings));
    }
    // Suppress connections at animated destinations, but keep drag previews fully dynamic.
    const animatedSquares = new Set();
    if (settings.defenseCirclesEnabled && !dragPreview) {
      for (const piece of board.querySelectorAll(":scope > piece.anim")) {
        if (globalThis.LichessMoveAnimation?.isInstantMove(piece)) continue;
        const square = getPieceScreenSquare(piece, board, parsed.blackOrientation);
        if (square) animatedSquares.add(`${square.row},${square.col}`);
      }
    }
    const defenseSegments = settings.defenseCirclesEnabled
      ? positionAnalysis.defenseConnections
        .filter(({ source, target }) => ![source, target].some(square => animatedSquares.has(`${square.row},${square.col}`)))
        .map(connection => ({
          target: connection.target,
          source: connection.source,
          angle: Math.atan2(connection.source.row - connection.target.row, connection.source.col - connection.target.col),
          type: parsed.position[connection.target.row][connection.target.col].type,
          sourceType: parsed.position[connection.source.row][connection.source.col].type,
          color: connection.color === "w" ? settings.whitePieceColor : settings.blackPieceColor
        }))
      : [];
    // Move field lines use the unmoved board, so they show without hovering. While dragging, the unmoved position from the drag state is used.
    const idleParsed = dragPreview && !dragPreview.isHoverPreview
      ? wedgeParsed
      : dragPreview?.isHoverPreview ? readPosition(board) : parsed;
    const rawMoveDestinationLines = idleParsed?.selected
      && (settings.threatenedPieceOutlineEnabled || settings.defenseCirclesEnabled)
      ? getMoveDestinationLines(board, idleParsed.position, idleParsed.selected, idleParsed.blackOrientation)
      : { targetKeys: new Set(), threats: [], defenseSegments: [] };
    // An empty field under the hovered figure uses figure-based radii; the change is animated in both directions.
    const hoverMove = movePreview?.isHoverPreview && movePreview.legal && idleParsed ? logicalToScreen(movePreview.target, idleParsed.blackOrientation) : null;
    const hoverFieldKey = hoverMove && !idleParsed.position[hoverMove.row][hoverMove.col] ? `${hoverMove.row},${hoverMove.col}` : null;
    const blendsAnimating = advanceFigureBlends(entry, hoverFieldKey);
    if (blendsAnimating) scheduleRender(board);
    const blendOf = key => entry.figureBlends.get(key) ?? 0;
    const moveDestinationLines = {
      targetKeys: rawMoveDestinationLines.targetKeys,
      threats: rawMoveDestinationLines.threats.map(threat => ({ ...threat, figureBlend: blendOf(`${threat.square.row},${threat.square.col}`) })),
      defenseSegments: rawMoveDestinationLines.defenseSegments.map(segment => ({ ...segment, figureBlend: blendOf(`${segment.target.row},${segment.target.col}`) }))
    };
    const displayThreats = [
      ...threats.filter(({ square }) => !moveDestinationLines.targetKeys.has(`${square.row},${square.col}`)),
      ...moveDestinationLines.threats
    ];
    const displayDefenseSegments = [
      ...defenseSegments.filter(({ target }) => !moveDestinationLines.targetKeys.has(`${target.row},${target.col}`)),
      ...moveDestinationLines.defenseSegments
    ];
      const selectedCaptureTargets = shouldRestrictHatchedThreatsToSelectedPiece()
        ? getSelectedCaptureTargets(parsed.position, parsed.selected, parsed.blackOrientation)
        : null;
      const centerOutlines = settings.threatCenterOutlineEnabled
         ? getOverloadedPieces(parsed.position, parsed.blackOrientation, shouldFilterHatchedThreats())
           .filter(({ target }) => !selectedCaptureTargets || selectedCaptureTargets.has(`${target.row},${target.col}`))
           .map(outline => {
        const piece = parsed.position[outline.target.row][outline.target.col];
        const previewTarget = movePreview?.isHoverPreview && logicalToScreen(movePreview.target, parsed.blackOrientation);
        const hoverPreview = previewTarget?.row === outline.target.row && previewTarget?.col === outline.target.col;
        return { ...outline, piece: { ...piece, hoverPreview,
          element: hoverPreview ? null : findPieceElement(board, outline.target, dragPreview, parsed.blackOrientation) } };
      })
      : [];
    const moveOutlinePreviews = updateMoveOutlinePreviews(
      board,
      wedgeParsed.position,
      wedgeParsed.selected,
      wedgeSelectedPiece,
      wedgeParsed.blackOrientation
    );
    const hoveredTarget = movePreview?.isHoverPreview && logicalToScreen(movePreview.target, parsed.blackOrientation);
    const otherMoveOutlinePreviews = moveOutlinePreviews.filter(({ target }) =>
      !hoveredTarget || target.row !== hoveredTarget.row || target.col !== hoveredTarget.col);
    const moveOutlineTargets = new Set(otherMoveOutlinePreviews.map(({ target }) => `${target.row},${target.col}`));
    renderThreatArcs(
      board,
      entry,
      displayThreats,
      displayDefenseSegments,
      [...centerOutlines.filter(({ target }) => !moveOutlineTargets.has(`${target.row},${target.col}`)), ...otherMoveOutlinePreviews],
      settings.threatAttackDisplayMode,
      settings.threatDefenseDisplayMode
    );
    renderMovePreviewPiece(board, entry, movePreview);
    if (!wedges.length) {
      entry.svg?.remove();
      entry.svg = null;
      return;
    }

    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) return;
    if (!entry.svg) entry.svg = createOverlay();
    globalThis.LichessBoardOverlay.place(board, entry.svg, "between-pieces");

    const baseWidth = settings.wedgeBaseWidthPercent / 100;
    const tipWidth = settings.wedgeTipWidthPercent / 100;
    const glowWidth = settings.wedgeGlowWidthPercent / 100;
    const filterId = `lfs-selected-wedge-glow-${[...observedBoards.keys()].indexOf(board)}`;
    const defs = document.createElementNS(svgNamespace, "defs");
    const filter = document.createElementNS(svgNamespace, "filter");
    filter.id = filterId;
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("x", "-4");
    filter.setAttribute("y", "-4");
    filter.setAttribute("width", "16");
    filter.setAttribute("height", "16");
    const blur = document.createElementNS(svgNamespace, "feGaussianBlur");
    blur.setAttribute("stdDeviation", String(settings.wedgeGlowBlurPercent / 100));
    filter.append(blur);
    defs.append(filter);
    entry.svg.replaceChildren(defs);

    for (const [index, connection] of wedges.entries()) {
      const sourceVerticalOffset = connection.type === "pawn"
        ? (isPieceRotated(connection.color, parsed.blackOrientation) ? -pawnWedgeBaseOffset : pawnWedgeBaseOffset)
        : 0;
      const { source, target } = getWedgeEnds(
        { x: connection.source.col + 0.5, y: connection.source.row + 0.5 },
        { x: connection.target.col + 0.5, y: connection.target.row + 0.5 },
        sourceVerticalOffset
      );
      const getWedgePath = (base, tip) => connection.type === "knight"
        ? createKnightWedgeGeometry(source, target, base, tip)
        : createWedgeGeometry(source, target, base, tip);
      const color = connection.color === "w" ? settings.whitePieceColor : settings.blackPieceColor;
      const glowColor = mixWithWhite(color, 0.3);
      const gradientId = `${filterId}-gradient-${index}`;
      const gradient = document.createElementNS(svgNamespace, "linearGradient");
      gradient.id = gradientId;
      gradient.setAttribute("color-interpolation", "sRGB");
      gradient.setAttribute("gradientUnits", "userSpaceOnUse");
      gradient.setAttribute("x1", String(source.x));
      gradient.setAttribute("y1", String(source.y));
      gradient.setAttribute("x2", String(target.x));
      gradient.setAttribute("y2", String(target.y));
      for (const [offset, opacity] of [["0%", "1"], ["78%", "1"], ["100%", "0"]]) {
        const stop = document.createElementNS(svgNamespace, "stop");
        stop.setAttribute("offset", offset);
        stop.setAttribute("stop-color", color);
        stop.setAttribute("stop-opacity", opacity);
        gradient.append(stop);
      }
      defs.append(gradient);

      const glow = document.createElementNS(svgNamespace, "path");
      glow.setAttribute("d", getWedgePath(baseWidth + glowWidth, tipWidth + glowWidth));
      glow.setAttribute("fill", glowColor);
      glow.setAttribute("filter", `url(#${filterId})`);
      glow.setAttribute("opacity", String(settings.wedgeGlowWidthPercent > 0 ? settings.wedgeOpacity * 0.58 : 0));
      entry.svg.append(glow);

      const wedge = document.createElementNS(svgNamespace, "path");
      wedge.setAttribute("d", getWedgePath(baseWidth, tipWidth));
      wedge.setAttribute("fill", `url(#${gradientId})`);
      if (settings.wedgeBasePiecePreviewEnabled) {
        const maskId = `${filterId}-piece-mask-${index}`;
        const mask = document.createElementNS(svgNamespace, "mask");
        mask.id = maskId;
        mask.setAttribute("maskUnits", "userSpaceOnUse");
        mask.setAttribute("maskContentUnits", "userSpaceOnUse");
        mask.style.setProperty("mask-type", "alpha");
        const pieceImage = document.createElementNS(svgNamespace, "image");
        pieceImage.setAttribute("x", String(connection.source.col));
        pieceImage.setAttribute("y", String(connection.source.row));
        pieceImage.setAttribute("width", "1");
        pieceImage.setAttribute("height", "1");
        pieceImage.setAttribute("preserveAspectRatio", "xMidYMid meet");
        pieceImage.setAttribute("href", getPieceAssetUrl(connection.color, connection.type));
        if (isPieceRotated(connection.color, parsed.blackOrientation)) {
          pieceImage.setAttribute("transform", `rotate(180 ${connection.source.col + 0.5} ${connection.source.row + 0.5})`);
        }
        mask.append(pieceImage);
        defs.append(mask);

        const silhouette = document.createElementNS(svgNamespace, "rect");
        silhouette.setAttribute("x", String(connection.source.col));
        silhouette.setAttribute("y", String(connection.source.row));
        silhouette.setAttribute("width", "1");
        silhouette.setAttribute("height", "1");
        silhouette.setAttribute("fill", color);
        silhouette.setAttribute("mask", `url(#${maskId})`);
        silhouette.setAttribute("pointer-events", "none");
        // Keil und Figur bilden eine Gruppe, damit sich ihre Deckkraft nicht doppelt überlagert.
        const group = document.createElementNS(svgNamespace, "g");
        group.setAttribute("opacity", String(settings.wedgeOpacity));
        group.append(wedge, silhouette);
        entry.svg.append(group);
      } else {
        wedge.setAttribute("opacity", String(settings.wedgeOpacity));
        entry.svg.append(wedge);
      }
    }

  }

  function renderThreatDisplaySet(svg, segments, figureRadii, displayMode, highlightEndpoints) {
    if (!segments.length) return;
    if (displayMode === "lines" || displayMode === "wedge") {
      renderLineSet(svg, segments.map(segment => ({ ...segment, wedge: displayMode === "wedge" })), figureRadii, highlightEndpoints);
    }
    else if (displayMode === "square") renderSquareSegmentSet(svg, segments, figureRadii, highlightEndpoints);
    else renderSegmentSet(svg, segments, figureRadii, highlightEndpoints);
  }

  function createHatchPattern(defs, patternId, color, scrollDistance) {
    const spacing = settings.threatCenterHatchSpacingPercent / 100;
    const thickness = settings.threatCenterHatchThicknessPercent / 100;
    const angle = settings.threatCenterHatchAngleDeg;
    const pattern = document.createElementNS(svgNamespace, "pattern");
    pattern.id = patternId;
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    pattern.setAttribute("width", String(spacing));
    pattern.setAttribute("height", String(spacing));
    pattern.setAttribute("patternTransform", hatchPatternTransform(angle, spacing, scrollDistance));
    const line = document.createElementNS(svgNamespace, "path");
    line.setAttribute("d", `M 0 0 H ${spacing}`);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", String(thickness));
    pattern.append(line);
    defs.append(pattern);
    return { pattern, spacing, angle };
  }

  function getPieceAssetUrl(color, type) {
    const letter = figureAssetLetters[type];
    const asset = globalThis.LichessSettings.getPieceAsset(settings, color, letter);
    return chrome.runtime.getURL(asset);
  }

  function syncCenterOutlineImages(entry) {
    if (!entry.centerSvg) return;
    const transforms = new Map();
    for (const image of entry.centerSvg.querySelectorAll("image")) {
      syncCenterOutlineImage(image, transforms);
    }
  }

  function buildAttackSegments(threats) {
    const attackSegments = [];
    for (const threat of threats) {
      const color = threat.color === "w" ? settings.blackPieceColor : settings.whitePieceColor;
      for (const attacker of threat.attackers) {
        attackSegments.push({
          target: threat.square,
          source: { row: attacker.row, col: attacker.col },
          angle: Math.atan2(attacker.row - threat.square.row, attacker.col - threat.square.col),
          type: threat.type,
          sourceType: attacker.type,
          color,
          category: "attack",
          figureBlend: threat.figureBlend,
          moveFieldRadius: threat.moveFieldRadius
        });
      }
    }
    return attackSegments;
  }

  function renderThreatSegmentsInto(svg, attackSegments, defenseSegments, attackDisplayMode, defenseDisplayMode) {
    const highlightEndpoints = new Map();
    const preparedDefenseSegments = defenseSegments.map(segment => ({ ...segment, category: "defense" }));
    const figureRadii = getFigureRadii(settings.pieceSet);
    if ([attackDisplayMode, defenseDisplayMode].every(mode => mode === "lines" || mode === "wedge")) {
      renderLineSet(svg, [
        ...attackSegments.map(segment => ({ ...segment, wedge: attackDisplayMode === "wedge" })),
        ...preparedDefenseSegments.map(segment => ({ ...segment, wedge: defenseDisplayMode === "wedge" }))
      ], figureRadii, highlightEndpoints);
    } else if (attackDisplayMode === defenseDisplayMode) {
      renderThreatDisplaySet(svg, [...attackSegments, ...preparedDefenseSegments], figureRadii, attackDisplayMode, highlightEndpoints);
    } else {
      renderThreatDisplaySet(svg, attackSegments, figureRadii, attackDisplayMode, highlightEndpoints);
      renderThreatDisplaySet(svg, preparedDefenseSegments, figureRadii, defenseDisplayMode, highlightEndpoints);
    }
    return highlightEndpoints;
  }

  // Attack and defense segments share one top-layer SVG while retaining their selected display modes.
  function renderThreatArcs(
    board,
    entry,
    threats,
    defenseSegments = [],
    centerOutlines = [],
    attackDisplayMode = "segments",
    defenseDisplayMode = "segments"
  ) {
    entry.highlightLineEndpoints = null;
    if (!threats.length && !defenseSegments.length && !centerOutlines.length) {
      syncHighlightLineEndpoints(entry);
      entry.arcSvg?.remove();
      entry.arcSvg = null;
      entry.centerSvg?.remove();
      entry.centerSvg = null;
      entry.hatchPatterns = [];
      syncHatchAnimation();
      return;
    }
    const attackSegments = buildAttackSegments(threats);

    if (!attackSegments.length && !defenseSegments.length) {
      entry.arcSvg?.remove();
      entry.arcSvg = null;
    } else if (!entry.arcSvg) {
      entry.arcSvg = document.createElementNS(svgNamespace, "svg");
      entry.arcSvg.classList.add("lfs-threat-arc");
      entry.arcSvg.setAttribute("viewBox", "0 0 8 8");
      entry.arcSvg.setAttribute("aria-hidden", "true");
    }
    if (entry.arcSvg) globalThis.LichessBoardOverlay.place(board, entry.arcSvg, "above-pieces");

    if (entry.arcSvg) {
      entry.arcSvg.replaceChildren();
      entry.highlightLineEndpoints = renderThreatSegmentsInto(entry.arcSvg, attackSegments, defenseSegments, attackDisplayMode, defenseDisplayMode);
    }
    syncHighlightLineEndpoints(entry);

    if (!centerOutlines.length) {
      entry.centerSvg?.remove();
      entry.centerSvg = null;
      entry.hatchPatterns = [];
      syncHatchAnimation();
      return;
    }
    if (!entry.centerSvg) {
      entry.centerSvg = document.createElementNS(svgNamespace, "svg");
      entry.centerSvg.classList.add("lfs-threat-center-outline");
      entry.centerSvg.setAttribute("viewBox", "0 0 8 8");
      entry.centerSvg.setAttribute("aria-hidden", "true");
    }
    globalThis.LichessBoardOverlay.place(board, entry.centerSvg, "above-pieces");
    entry.centerSvg.toggleAttribute("data-lfs-hatching", settings.threatCenterOutlineStyle === "hatching");

    const defs = document.createElementNS(svgNamespace, "defs");
    const outlines = [];
    const hatchPatterns = [];
    const scrollDistance = advanceHatchScroll();
    for (const [index, { target, color, piece }] of centerOutlines.entries()) {
      const pieceUrl = getPieceAssetUrl(piece.color, piece.type);
      const pieceColor = color === "w" ? settings.whitePieceColor : settings.blackPieceColor;
      const image = document.createElementNS(svgNamespace, "image");
      image.setAttribute("x", String(target.col));
      image.setAttribute("y", String(target.row));
      image.setAttribute("width", "1");
      image.setAttribute("height", "1");
      image.setAttribute("preserveAspectRatio", "xMidYMid meet");
      image.setAttribute("href", pieceUrl);
      image.setAttribute("opacity", String(settings.threatCenterOutlineOpacity / 100));
      image.setAttribute("pointer-events", "none");
      image._lfsPieceElement = piece.element;
      if (piece.hoverPreview) {
        image.setAttribute("data-lfs-hover-preview-outline", "");
        const blackOrientation = Boolean(board.closest(".cg-wrap")?.classList.contains("orientation-black"));
        if (isPieceRotated(piece.color, blackOrientation)) {
          image.setAttribute("transform", `rotate(180 ${target.col + 0.5} ${target.row + 0.5})`);
        }
      }

      if (settings.threatCenterOutlineStyle === "hatching") {
        const boardIndex = [...observedBoards.keys()].indexOf(board);
        const maskId = `lfs-threat-center-hatch-mask-${boardIndex}-${index}`;
        const mask = document.createElementNS(svgNamespace, "mask");
        mask.id = maskId;
        mask.setAttribute("maskUnits", "userSpaceOnUse");
        mask.setAttribute("maskContentUnits", "userSpaceOnUse");
        mask.setAttribute("x", String(target.col));
        mask.setAttribute("y", String(target.row));
        mask.setAttribute("width", "1");
        mask.setAttribute("height", "1");
        mask.style.setProperty("mask-type", "alpha");
        const maskImage = image.cloneNode();
        maskImage.setAttribute("opacity", "1");
        maskImage._lfsPieceElement = piece.element;
        mask.append(maskImage);
        defs.append(mask);

        const patternId = `lfs-threat-center-hatch-${boardIndex}-${index}`;
        hatchPatterns.push(createHatchPattern(defs, patternId, pieceColor, scrollDistance));

        const hatch = document.createElementNS(svgNamespace, "rect");
        hatch.setAttribute("x", String(target.col));
        hatch.setAttribute("y", String(target.row));
        hatch.setAttribute("width", "1");
        hatch.setAttribute("height", "1");
        hatch.setAttribute("fill", `url(#${patternId})`);
        hatch.setAttribute("mask", `url(#${maskId})`);
        hatch.setAttribute("opacity", "1");
        hatch.setAttribute("pointer-events", "none");

        if (piece.hoverPreview) hatch.setAttribute("data-lfs-hover-preview-outline", "");
        outlines.push(hatch);
        continue;
      }

      const filterId = `lfs-threat-center-outline-${[...observedBoards.keys()].indexOf(board)}-${index}`;
      const filter = document.createElementNS(svgNamespace, "filter");
      filter.id = filterId;
      filter.setAttribute("x", "-0.2");
      filter.setAttribute("y", "-0.2");
      filter.setAttribute("width", "1.4");
      filter.setAttribute("height", "1.4");
      filter.setAttribute("filterUnits", "objectBoundingBox");
      filter.setAttribute("primitiveUnits", "objectBoundingBox");
      const expand = document.createElementNS(svgNamespace, "feMorphology");
      expand.setAttribute("in", "SourceAlpha");
      expand.setAttribute("operator", "dilate");
      expand.setAttribute("radius", String(settings.threatCenterOutlineWidthPercent / 200));
      expand.setAttribute("result", "expanded");
      const outside = document.createElementNS(svgNamespace, "feComposite");
      outside.setAttribute("in", "expanded");
      outside.setAttribute("in2", "SourceAlpha");
      outside.setAttribute("operator", "out");
      outside.setAttribute("result", "outline");
      const flood = document.createElementNS(svgNamespace, "feFlood");
      flood.setAttribute("flood-color", pieceColor);
      flood.setAttribute("result", "color");
      const colorOutline = document.createElementNS(svgNamespace, "feComposite");
      colorOutline.setAttribute("in", "color");
      colorOutline.setAttribute("in2", "outline");
      colorOutline.setAttribute("operator", "in");
      filter.append(expand, outside, flood, colorOutline);
      defs.append(filter);

      image.setAttribute("filter", `url(#${filterId})`);
      outlines.push(image);
    }
    entry.centerSvg.replaceChildren(defs, ...outlines);
    entry.hatchPatterns = hatchPatterns;
    syncCenterOutlineImages(entry);
    syncHatchAnimation();
  }

  function observeBoard(board) {
    if (observedBoards.has(board)) return;
    const entry = {
      svg: null,
      arcSvg: null,
      centerSvg: null,
      previewPieceSvg: null,
      previewPieceGroup: null,
      previewPieceImage: null,
      previewAnimation: null,
      previewAnimationFrame: 0,
      previewTranslation: { x: 0, y: 0 },
      previewOpacity: 0,
      previewTargetKey: null,
      previewSourceKey: null,
      hoveredSquare: null,
      defenseHoverTimer: 0,
      defenseHoverPendingKey: null,
      defenseHoverStartedKey: null,
      defenseCascadeContextKey: null,
      defenseHighlightRuns: [],
      defenseLineHoldRoot: null,
      defenseHighlightedPieces: new Set(),
      defensePreviewLastTargetKey: null,
      defenseLastMoveKey: null,
      defensePlayedMoveKeys: new Set(),
      defensePreviewMix: 0,
      frame: 0,
      figureBlends: new Map(),
      hatchPatterns: []
    };
    observedBoards.set(board, entry);

    // Overlay elements are added to the board too; ignoring them stops the render from re-triggering itself every frame.
    const isOverlayOnlyChange = mutation => mutation.type === "childList"
      && ![...mutation.addedNodes, ...mutation.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && node.matches("piece, square"))
      && !mutation.target.matches?.("piece, square");
    const boardObserver = new MutationObserver(mutations => {
      // Chessground updates moving-piece transforms every frame; recalculating overlays on those writes is expensive and unnecessary.
      const relevantChange = mutations.some(mutation => !isOverlayOnlyChange(mutation)
        && !(mutation.type === "attributes" && mutation.attributeName === "style" && mutation.target.matches?.("piece.anim"))
        && !(mutation.type === "attributes" && mutation.attributeName === "style" && mutation.target.matches?.("piece[data-lfs-defense-highlight]"))
        && (mutation.target === board || mutation.target.matches?.("piece, square")));
      if (!relevantChange) return;
      scheduleRender(board);
    });
    boardObserver.observe(board, {
      attributes: true,
      attributeFilter: ["class", "data-key", "data-lfs-move-key", "data-lfs-bounce-running", "style"],
      childList: true,
      subtree: true
    });
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
    return node.nodeType === Node.ELEMENT_NODE && (node.matches(boardSelector) || Boolean(node.querySelector(boardSelector)));
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

      for (const piece of board.querySelectorAll(":scope > piece")) clearThreatenedPieceOutline(piece);
      clearDefenseHighlights(entry);
      entry.svg?.remove();
      entry.arcSvg?.remove();
      entry.centerSvg?.remove();
      entry.moveOutlineSvg?.remove();
      clearMovePreviewPiece(board, entry);
      if (pointerOverBoard === board) pointerOverBoard = null;
      observedBoards.delete(board);
    }
    syncHatchAnimation();
  }

  documentObserver = new MutationObserver(mutations => {
    if (!mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(containsBoard))) return;
    scanBoards();
    for (const board of observedBoards.keys()) scheduleRender(board);
  });
  documentObserver.observe(document, { childList: true, subtree: true });
  scanBoards();

  globalThis.LichessSelectedPieceWedge = {
    createLastMovePreview,
    renderLastMoveOutline,
    update(nextSettings) {
      advanceHatchScroll();
      settings = nextSettings;
      scanBoards();
      for (const [board, entry] of observedBoards) syncHighlightLineMasks(entry, board);
      for (const board of observedBoards.keys()) scheduleRender(board);
      syncHatchAnimation();
    }
  };
})();
