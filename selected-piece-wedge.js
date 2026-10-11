(() => {
  const boardSelector = ".cg-wrap cg-board, .mini-game cg-board";
  const svgNamespace = "http://www.w3.org/2000/svg";
  const pieceTypes = ["pawn", "knight", "bishop", "rook", "queen", "king"];
  const pieceValues = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
  const observedBoards = new Map();
  let settings = null;
  let documentObserver = null;

  function scheduleRender(board) {
    const entry = observedBoards.get(board);
    if (!entry || entry.frame) return;
    entry.frame = requestAnimationFrame(() => {
      entry.frame = 0;
      renderBoard(board, entry);
    });
  }

  document.addEventListener("pointermove", () => {
    for (const board of observedBoards.keys()) {
      if (globalThis.LichessThreatCoding?.getInteractionPreview(board)) scheduleRender(board);
    }
  }, true);

  function getScreenSquare(element, board) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return null;
    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const screenCol = Math.floor(((rect.left + rect.width / 2 - boardRect.left) / boardRect.width) * 8);
    const screenRow = Math.floor(((rect.top + rect.height / 2 - boardRect.top) / boardRect.height) * 8);
    if (screenRow < 0 || screenRow > 7 || screenCol < 0 || screenCol > 7) return null;
    return { row: screenRow, col: screenCol };
  }

  function getPiece(element) {
    const color = element.classList.contains("white") ? "w" : element.classList.contains("black") ? "b" : "";
    const type = pieceTypes.find(name => element.classList.contains(name));
    if (!color || !type) return null;
    return { color, type, element };
  }

  function readPosition(board) {
    const blackOrientation = board.closest(".cg-wrap")?.classList.contains("orientation-black") ?? false;
    const position = Array.from({ length: 8 }, () => Array(8).fill(null));

    for (const element of board.querySelectorAll(":scope > piece")) {
      if (element.classList.contains("ghost") || element.classList.contains("fading")) continue;
      const piece = getPiece(element);
      const square = getScreenSquare(element, board);
      if (!piece || !square || position[square.row][square.col]) return null;
      position[square.row][square.col] = piece;
    }

    const selected = [...board.querySelectorAll(":scope > square.selected")]
      .map(square => getScreenSquare(square, board)).find(Boolean) ?? null;
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
        position[screenRow][screenCol] = {
          color: piece[0],
          type: { P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king" }[piece[1]]
        };
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
    const directions = {
      bishop: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
      rook: [[-1, 0], [1, 0], [0, -1], [0, 1]],
      queen: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
      knight: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]],
      king: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
      pawn: [[pawnDirection, -1], [pawnDirection, 1]]
    }[piece.type];
    const sliding = ["bishop", "rook", "queen"].includes(piece.type);

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

  function getThreatenedSquares(position, blackOrientation) {
    const threatened = { w: new Map(), b: new Map() };
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const attacker = position[row][col];
        if (!attacker) continue;
        for (const target of getAttackedPieces(position, { row, col }, blackOrientation)) {
          const victim = position[target.row][target.col];
          if (!victim || victim.color === attacker.color) continue;
          const key = `${target.row},${target.col}`;
          if (!threatened[victim.color].has(key)) threatened[victim.color].set(key, []);
          threatened[victim.color].get(key).push({ row, col });
        }
      }
    }
    return threatened;
  }

  function getDefenseLines(position, blackOrientation) {
    const lines = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const defender = position[row][col];
        if (!defender) continue;
        const source = { row, col };
        for (const target of getAttackedPieces(position, source, blackOrientation)) {
          if (position[target.row][target.col]?.color === defender.color) {
            lines.push({ source, target, color: defender.color });
          }
        }
      }
    }
    return lines;
  }

  function getThreatCountLabels(position, blackOrientation) {
    const counts = new Map();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sourcePiece = position[row][col];
        if (!sourcePiece) continue;
        const source = { row, col };
        for (const target of getAttackedPieces(position, source, blackOrientation)) {
          const targetPiece = position[target.row][target.col];
          const key = `${target.row},${target.col}`;
          if (!counts.has(key)) counts.set(key, { target, defenders: [], attackers: [] });
          counts.get(key)[targetPiece.color === sourcePiece.color ? "defenders" : "attackers"].push({ source, color: sourcePiece.color });
        }
      }
    }

    const labels = [];
    for (const { target, defenders, attackers } of counts.values()) {
      if (!attackers.length) continue;
      const net = defenders.length - attackers.length;
      if (!net) continue;
      const winners = net > 0 ? defenders : attackers;
      let directionX = 0;
      let directionY = 0;
      for (const relation of winners) {
        const dx = relation.source.col - target.col;
        const dy = relation.source.row - target.row;
        const length = Math.hypot(dx, dy);
        directionX += dx / length;
        directionY += dy / length;
      }
      const directionLength = Math.hypot(directionX, directionY);
      labels.push({
        target,
        text: net > 0 ? `+${net}` : `${-net}`,
        color: net > 0 ? position[target.row][target.col].color : attackers[0].color,
        direction: directionLength > 0.0001
          ? { x: directionX / directionLength, y: directionY / directionLength }
          : { x: 0, y: -1 }
      });
    }
    return labels;
  }

  function clearThreatenedPieceOutline(element) {
    element.removeAttribute("data-lfs-threatened-piece");
  }

  function updateThreatenedPieces(board, position, dragPreview, threatened, enabled) {
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
        square = getScreenSquare(element, board);
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
        threats.push({ square, color: piece.color, attackers });
      } else clearThreatenedPieceOutline(element);
    }
    return threats;
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

    const directions = {
      bishop: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
      rook: [[-1, 0], [1, 0], [0, -1], [0, 1]],
      queen: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
      knight: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]],
      king: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
    }[piece.type];
    const sliding = ["bishop", "rook", "queen"].includes(piece.type);

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

  function getPotentialWedges(position, selected, destinations, blackOrientation, options = {}) {
    const piece = position[selected.row][selected.col];
    const attackerValue = pieceValues[piece.type];
    const candidates = [];

    for (const destination of destinations) {
      if (position[destination.row][destination.col]) continue;
      const simulated = position.map(row => [...row]);
      simulated[selected.row][selected.col] = null;
      simulated[destination.row][destination.col] = piece;
      const attacks = getAttackedPieces(simulated, destination, blackOrientation)
        .filter(target => simulated[target.row][target.col].color !== piece.color);
      if (!attacks.some(target => pieceValues[simulated[target.row][target.col].type] > attackerValue)) continue;
      const officers = attacks.filter(target => pieceValues[simulated[target.row][target.col].type] >= 3);
      const fork = officers.length >= 2;
      const targets = fork ? officers : attacks.filter(target => pieceValues[simulated[target.row][target.col].type] > attackerValue);
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
            return occupant.color === piece.color && occupant.type === "king";
          })) kingInCheck = true;
          if (!otherAttacks.some(target => target.row === destination.row && target.col === destination.col)) continue;
          if (other.color === piece.color) defenders++;
          else {
            attackers++;
            minAttackerValue = Math.min(minAttackerValue, pieceValues[other.type]);
          }
        }
      }
      if (kingInCheck || (attackers > 0 && attackerValue >= minAttackerValue) || attackers > defenders) continue;
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
    const usedDirections = new Set();
    for (const candidate of candidates) {
      if (picked.length >= (options.wedgePotentialPerPieceCount ?? 1)) break;
      const directions = candidate.targets.map(target => {
        const dr = target.row - candidate.source.row;
        const dc = target.col - candidate.source.col;
        return ["bishop", "rook", "queen", "pawn"].includes(piece.type)
          ? `${Math.sign(dr)},${Math.sign(dc)}` : `${dr},${dc}`;
      });
      if (directions.some(direction => usedDirections.has(direction))) continue;
      directions.forEach(direction => usedDirections.add(direction));
      picked.push(candidate);
    }
    const targetClass = value => value >= 100 ? 4 : value >= 9 ? 3 : value >= 5 ? 2 : 1;
    const highestClass = Math.max(0, ...picked.map(candidate => targetClass(candidate.bestValue)));
    return picked.filter(candidate => options.wedgePotentialStrategy === "waterfall"
      ? targetClass(candidate.bestValue) === highestClass
      : candidate.bestValue >= (options.wedgePotentialCutoffValue ?? 1))
      .flatMap(candidate => candidate.targets.map(target => ({ source: candidate.source, target })));
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

  function mixWithWhite(hex, weight) {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!match) return "#ffffff";
    const channels = match.slice(1).map(channel => Number.parseInt(channel, 16));
    return `#${channels.map(channel => Math.round(channel * weight + 255 * (1 - weight)).toString(16).padStart(2, "0")).join("")}`;
  }

  function createOverlay(board) {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.classList.add("lfs-selected-piece-wedge");
    svg.setAttribute("viewBox", "0 0 8 8");
    svg.setAttribute("aria-hidden", "true");
    const firstPiece = board.querySelector(":scope > piece");
    board.insertBefore(svg, firstPiece);
    return svg;
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

  function renderBoard(board, entry) {
    const dragPreview = globalThis.LichessThreatCoding?.getInteractionPreview(board);
    const parsed = dragPreview ? readDragPreview(dragPreview) : readPosition(board);
    const selectedPiece = parsed?.selected && parsed.position[parsed.selected.row]?.[parsed.selected.col];
    const selectedColor = settings?.enabled && settings.moveDotsPlayerColor ? selectedPiece?.color : null;
    if (board.getAttribute("data-lfs-selected-piece-color") !== (selectedColor ?? "")) {
      if (selectedColor) board.setAttribute("data-lfs-selected-piece-color", selectedColor);
      else board.removeAttribute("data-lfs-selected-piece-color");
    }

    if (!settings?.enabled || !board.closest(".is2d") || !parsed) {
      updateThreatenedPieces(board, null, dragPreview, { w: new Map(), b: new Map() }, false);
      renderThreatArcs(board, entry, []);
      entry.svg?.remove();
      entry.svg = null;
      return;
    }

    const threatsEnabled = settings.threatenedPieceOutlineEnabled;
    const threatenedSquares = threatsEnabled
      ? getThreatenedSquares(parsed.position, parsed.blackOrientation)
      : { w: new Map(), b: new Map() };
    const threats = updateThreatenedPieces(
      board,
      parsed.position,
      dragPreview,
      threatenedSquares,
      threatsEnabled
    );

    const sources = !settings.selectedPieceWedgeEnabled
      ? []
      : settings.selectedPieceWedgeOnlySelected
        ? selectedPiece ? [parsed.selected] : []
        : parsed.position.flatMap((row, rowIndex) => row.flatMap((piece, colIndex) => piece ? [{ row: rowIndex, col: colIndex }] : []));
    const wedges = [];
    for (const source of sources) {
      const piece = parsed.position[source.row][source.col];
      const directTargets = getAttackedPieces(parsed.position, source, parsed.blackOrientation)
        .filter(target => parsed.position[target.row][target.col].color !== piece.color);
      wedges.push(...directTargets.map(target => ({ source, target, color: piece.color })));

      if (!settings.wedgePotentialEnabled) continue;
      const canReuseLegalDestinations = settings.selectedPieceWedgeOnlySelected && (!dragPreview || !dragPreview.legal);
      const destinations = canReuseLegalDestinations
        ? [...board.querySelectorAll(":scope > square.move-dest")]
          .map(square => getScreenSquare(square, board)).filter(Boolean)
        : getFreeFieldMoves(parsed.position, source, piece, parsed.blackOrientation);
      wedges.push(...getPotentialWedges(parsed.position, source, destinations, parsed.blackOrientation, settings)
        .map(wedge => ({ ...wedge, color: piece.color })));
    }
    const defenseLines = settings.defenseLinesEnabled
      ? getDefenseLines(parsed.position, parsed.blackOrientation)
      : [];
    const countLabels = settings.threatCountLabelsEnabled
      ? getThreatCountLabels(parsed.position, parsed.blackOrientation)
      : [];
    renderThreatArcs(board, entry, threats, countLabels);
    if (!wedges.length && !defenseLines.length) {
      entry.svg?.remove();
      entry.svg = null;
      return;
    }

    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) return;
    if (!entry.svg) entry.svg = createOverlay(board);
    const firstPiece = board.querySelector(":scope > piece");
    if (entry.svg.parentNode !== board || entry.svg.nextSibling !== firstPiece) board.insertBefore(entry.svg, firstPiece);

    const widthScale = 8 / boardRect.width;
    const baseWidth = settings.wedgeBaseWidthPx * widthScale;
    const tipWidth = settings.wedgeTipWidthPx * widthScale;
    const glowWidth = settings.wedgeGlowWidthPx * widthScale;
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
    blur.setAttribute("stdDeviation", String(settings.wedgeGlowBlurPx * widthScale));
    filter.append(blur);
    defs.append(filter);
    entry.svg.replaceChildren(defs);

    for (const [index, connection] of wedges.entries()) {
      const source = { x: connection.source.col + 0.5, y: connection.source.row + 0.5 };
      const target = { x: connection.target.col + 0.5, y: connection.target.row + 0.5 };
      const color = connection.color === "w" ? settings.whitePieceColor : settings.blackPieceColor;
      const glowColor = mixWithWhite(color, 0.3);
      const gradientId = `${filterId}-gradient-${index}`;
      const gradient = document.createElementNS(svgNamespace, "linearGradient");
      gradient.id = gradientId;
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
      glow.setAttribute("d", createWedgeGeometry(source, target, baseWidth + glowWidth, tipWidth + glowWidth));
      glow.setAttribute("fill", glowColor);
      glow.setAttribute("filter", `url(#${filterId})`);
      glow.setAttribute("opacity", String(settings.wedgeGlowWidthPx > 0 ? settings.wedgeOpacity * 0.58 : 0));
      entry.svg.append(glow);

      const wedge = document.createElementNS(svgNamespace, "path");
      wedge.setAttribute("d", createWedgeGeometry(source, target, baseWidth, tipWidth));
      wedge.setAttribute("fill", `url(#${gradientId})`);
      wedge.setAttribute("opacity", String(settings.wedgeOpacity));
      entry.svg.append(wedge);
    }

    for (const connection of defenseLines) {
      const sourceCenter = { x: connection.source.col + 0.5, y: connection.source.row + 0.5 };
      const targetCenter = { x: connection.target.col + 0.5, y: connection.target.row + 0.5 };
      const dx = sourceCenter.x - targetCenter.x;
      const dy = sourceCenter.y - targetCenter.y;
      const length = Math.hypot(dx, dy);
      const unitX = dx / length;
      const unitY = dy / length;
      const start = settings.defenseLineDistance;
      const end = settings.defenseLineDistance + settings.defenseLineLength;
      const line = document.createElementNS(svgNamespace, "line");
      line.setAttribute("x1", String(targetCenter.x + unitX * start));
      line.setAttribute("y1", String(targetCenter.y + unitY * start));
      line.setAttribute("x2", String(targetCenter.x + unitX * end));
      line.setAttribute("y2", String(targetCenter.y + unitY * end));
      line.setAttribute("stroke", connection.color === "w" ? settings.whitePieceColor : settings.blackPieceColor);
      line.setAttribute("stroke-width", String(settings.defenseLineThicknessPx * widthScale));
      line.setAttribute("stroke-linecap", "butt");
      line.setAttribute("opacity", String(settings.defenseLineOpacity));
      entry.svg.append(line);
    }

  }

  // One arc per attacker, centred on the attacker's direction. Overlapping arcs of the same colour merge into a wider arc.
  function renderThreatArcs(board, entry, threats, countLabels = []) {
    if (!threats.length && !countLabels.length) {
      entry.arcSvg?.remove();
      entry.arcSvg = null;
      entry.countSvg?.remove();
      entry.countSvg = null;
      return;
    }
    if (!threats.length) {
      entry.arcSvg?.remove();
      entry.arcSvg = null;
    } else if (!entry.arcSvg) {
      entry.arcSvg = document.createElementNS(svgNamespace, "svg");
      entry.arcSvg.classList.add("lfs-threat-arc");
      entry.arcSvg.setAttribute("viewBox", "0 0 8 8");
      entry.arcSvg.setAttribute("aria-hidden", "true");
    }
    if (entry.arcSvg && entry.arcSvg.parentNode !== board) board.append(entry.arcSvg);

    const halfAngle = settings.threatArcAngleDeg * Math.PI / 360;
    const arcs = [];
    for (const threat of threats) {
      const center = { x: threat.square.col + 0.5, y: threat.square.row + 0.5 };
      const color = threat.color === "w" ? settings.blackPieceColor : settings.whitePieceColor;
      for (const attacker of threat.attackers) {
        const angle = Math.atan2(attacker.row - threat.square.row, attacker.col - threat.square.col);
        const path = document.createElementNS(svgNamespace, "path");
        path.setAttribute("d", createArcGeometry(center, settings.threatArcRadius, settings.threatArcRadius + settings.threatArcThickness, angle - halfAngle, angle + halfAngle));
        path.setAttribute("fill", color);
        path.setAttribute("pointer-events", "none");
        arcs.push(path);
      }
    }
    entry.arcSvg?.replaceChildren(...arcs);

    if (!countLabels.length) {
      entry.countSvg?.remove();
      entry.countSvg = null;
      return;
    }
    if (!entry.countSvg) {
      entry.countSvg = document.createElementNS(svgNamespace, "svg");
      entry.countSvg.classList.add("lfs-threat-count-labels");
      entry.countSvg.setAttribute("viewBox", "0 0 8 8");
      entry.countSvg.setAttribute("aria-hidden", "true");
    }
    if (entry.countSvg.parentNode !== board) board.append(entry.countSvg);

    const boardWidth = board.getBoundingClientRect().width;
    const fontSize = boardWidth > 0 ? settings.threatCountFontSizePx * 8 / boardWidth : 0;
    const labelRadius = settings.threatArcRadius + settings.threatArcThickness
      + settings.threatArcRadius * settings.threatCountOffsetRadius;
    const labels = [];
    for (const label of countLabels) {
      const text = document.createElementNS(svgNamespace, "text");
      text.setAttribute("x", String(label.target.col + 0.5 + label.direction.x * labelRadius));
      text.setAttribute("y", String(label.target.row + 0.5 + label.direction.y * labelRadius));
      text.setAttribute("fill", label.color === "w" ? settings.whitePieceColor : settings.blackPieceColor);
      text.setAttribute("font-size", String(fontSize));
      text.setAttribute("font-family", "sans-serif");
      text.setAttribute("font-weight", "700");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      if (settings.threatCountTextOutlineEnabled) {
        text.setAttribute("stroke", "#151515");
        text.setAttribute("stroke-width", String(fontSize * 0.14));
        text.setAttribute("paint-order", "stroke");
      }
      text.setAttribute("pointer-events", "none");
      text.textContent = label.text;
      labels.push(text);
    }
    entry.countSvg.replaceChildren(...labels);
  }

  function observeBoard(board) {
    if (observedBoards.has(board)) return;
    const entry = { svg: null, arcSvg: null, countSvg: null, frame: 0 };
    observedBoards.set(board, entry);

    const boardObserver = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.target === board || mutation.target.matches?.("piece, square"))) {
        scheduleRender(board);
      }
    });
    boardObserver.observe(board, {
      attributes: true,
      attributeFilter: ["class", "data-key", "style"],
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
      entry.svg?.remove();
      entry.arcSvg?.remove();
      entry.countSvg?.remove();
      observedBoards.delete(board);
    }
  }

  documentObserver = new MutationObserver(mutations => {
    if (!mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(containsBoard))) return;
    scanBoards();
    for (const board of observedBoards.keys()) scheduleRender(board);
  });
  documentObserver.observe(document, { childList: true, subtree: true });
  scanBoards();

  globalThis.LichessSelectedPieceWedge = {
    update(nextSettings) {
      settings = nextSettings;
      scanBoards();
      for (const board of observedBoards.keys()) scheduleRender(board);
    }
  };
})();
