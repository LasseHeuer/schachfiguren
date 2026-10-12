(() => {
  const boardSelector = ".cg-wrap cg-board, .mini-game cg-board";
  const svgNamespace = "http://www.w3.org/2000/svg";
  const pieceTypes = ["pawn", "knight", "bishop", "rook", "queen", "king"];
  const pieceValues = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
  const slidingDirections = {
    bishop: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    rook: [[-1, 0], [1, 0], [0, -1], [0, 1]],
    queen: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
  };
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
  function getDefendedPieces(position, source, blackOrientation) {
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
        if (occupant?.type === "king") break;
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

  function getDefenseConnections(position, blackOrientation) {
    const connections = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const defender = position[row][col];
        if (!defender) continue;
        const source = { row, col };
        for (const target of getDefendedPieces(position, source, blackOrientation)) {
          if (position[target.row][target.col].type === "king") continue;
          connections.push({ source, target, color: defender.color });
        }
      }
    }
    return connections;
  }

  // Pieces that are attacked by more enemy pieces than they are defended by, with the attacking color.
  function getOverloadedPieces(position, blackOrientation) {
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
          else counts.get(key).attackers.push(sourcePiece.color);
        }
      }
    }

    const overloaded = [];
    for (const { target, defenders, attackers } of counts.values()) {
      if (attackers.length > defenders) overloaded.push({ target, color: attackers[0] });
    }
    return overloaded;
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
        threats.push({ square, color: piece.color, type: piece.type, attackers });
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
  const figureRadiiCache = new Map();

  // Directional radii per figure type, merged across the white and black SVGs the extension ships.
  function getFigureRadii(pieceSet) {
    if (!figureRadiiCache.has(pieceSet)) {
      const radii = new Map();
      figureRadiiCache.set(pieceSet, radii);
      Promise.all(Object.entries(figureAssetLetters).flatMap(([type, letter]) => ["w", "b"].map(async color => {
        const response = await fetch(chrome.runtime.getURL(pieceSet === "cage" ? `cage/cage_${letter}.svg` : `${pieceSet}/${color}${letter}.svg`));
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

  function renderSegmentSet(svg, segments, figureRadii) {
    const layeredSegments = assignSegmentLanes(segments);
    const minimumGapAngles = new Map();
    for (const segment of layeredSegments) {
      const targetKey = `${segment.target.row},${segment.target.col}`;
      const figureRadius = getMaximumFigureRadius(figureRadii, segment.type);
      const radius = getSegmentRadius(settings.threatArcRadius, figureRadius);
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
      const radius = getSegmentRadius(settings.threatArcRadius, figureRadius);
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

  function renderSquareSegmentSet(svg, segments, figureRadii) {
    const layeredSegments = assignSegmentLanes(segments);
    const radiusFactors = getSquareRadiusFactors(settings.threatSquareCornerRadiusPercent);
    const squareSizesByTarget = new Map();
    const configuredHalfSize = (settings.threatSquareRadius + settings.threatSquareThickness / 2)
      / getSquareRadiusFactorAt(radiusFactors, Math.PI / 4);
    for (const segment of layeredSegments) {
      const targetKey = `${segment.target.row},${segment.target.col},${segment.type}`;
      if (!squareSizesByTarget.has(targetKey)) {
        const boundingHalfSize = getRoundedBoundingSquareHalfSize(
          figureRadii,
          segment.type,
          radiusFactors,
          settings.threatSquareFigureMargin,
          settings.threatSquareThickness
        );
        squareSizesByTarget.set(targetKey, Math.max(configuredHalfSize, boundingHalfSize));
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
    }
  }

  // Knight lines keep the straight line's end points and only bend between them.
  function createKnightCurvePath(line, innerRadius, outerRadius) {
    const { center, direction, normal, offset } = line;
    const start = { x: center.x + direction.x * outerRadius + normal.x * offset, y: center.y + direction.y * outerRadius + normal.y * offset };
    const end = { x: center.x + direction.x * innerRadius + normal.x * offset, y: center.y + direction.y * innerRadius + normal.y * offset };
    const chord = { x: end.x - start.x, y: end.y - start.y };
    // The control point lies beside the chord; with a quadratic curve, the bulge at its peak is half this offset.
    const control = {
      x: (start.x + end.x) / 2 - chord.y * 2 * settings.threatLineCurvature,
      y: (start.y + end.y) / 2 + chord.x * 2 * settings.threatLineCurvature
    };
    const path = document.createElementNS(svgNamespace, "path");
    path.setAttribute("d", `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", line.color);
    path.setAttribute("stroke-width", String(settings.threatLineThickness));
    path.setAttribute("stroke-linecap", "butt");
    path.setAttribute("pointer-events", "none");
    return path;
  }

  function renderLineSet(svg, segments, figureRadii) {
    const linesByDirection = new Map();
    const boundingSquareHalfSizes = new Map();
    for (const segment of segments) {
      const direction = `${Math.cos(segment.angle).toFixed(4)},${Math.sin(segment.angle).toFixed(4)}`;
      const key = `${segment.target.row},${segment.target.col},${direction}`;
      if (!linesByDirection.has(key)) linesByDirection.set(key, []);
      linesByDirection.get(key).push(segment);
    }
    const lines = [];

    for (const group of linesByDirection.values()) {
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
        const usesBoundingSquare = segment.type === "knight" || segment.type === "queen";
        if (usesBoundingSquare && !boundingSquareHalfSizes.has(segment.type)) {
          boundingSquareHalfSizes.set(segment.type, getFigureBoundingSquareHalfSize(figureRadii.get(segment.type)));
        }
        const collisionRadius = getLineFigureClearance(
          figureRadii.get(segment.type),
          segment.angle,
          offset,
          settings.threatLineFigureMargin,
          settings.threatLineThickness,
          usesBoundingSquare ? boundingSquareHalfSizes.get(segment.type) : undefined
        );
        const configuredRadius = Math.sqrt(Math.max(0, settings.threatLineRadius ** 2 - offset ** 2));
        const innerRadius = Math.max(configuredRadius, collisionRadius);
        const outerRadius = innerRadius + settings.threatLineLength;
        lines.push({
          center,
          targetKey: `${segment.target.row},${segment.target.col}`,
          color: segment.color,
          direction,
          normal,
          offset,
          innerRadius,
          outerRadius,
          curved: segment.sourceType === "knight"
        });
      }
    }

    // Lines of different targets on one axis are shortened so that the gap remains between them.
    const gap = settings.threatLineLength * settings.threatLineGapPercent / 100;
    for (const line of lines) {
      let innerRadius = line.innerRadius;
      let outerRadius = line.outerRadius;
      let facingOuterLimit = Infinity;
      for (const other of lines) {
        if (other.targetKey === line.targetKey) continue;
        const dot = other.direction.x * line.direction.x + other.direction.y * line.direction.y;
        if (Math.abs(dot) < 0.99) continue;
        const otherX = other.center.x + other.normal.x * other.offset - line.center.x;
        const otherY = other.center.y + other.normal.y * other.offset - line.center.y;
        const lateral = otherX * line.normal.x + otherY * line.normal.y - line.offset;
        if (Math.abs(lateral) >= settings.threatLineThickness) continue;
        const base = otherX * line.direction.x + otherY * line.direction.y;
        // Lines pointing at each other split at the midpoint between their targets, so both keep the gap,
        // also when they only come close without touching.
        if (dot < 0 && base > 0) {
          const otherStart = base - other.outerRadius;
          const otherEnd = base - other.innerRadius;
          if (otherEnd <= innerRadius || otherStart >= line.outerRadius + settings.threatLineLength) continue;
          facingOuterLimit = Math.min(facingOuterLimit, base / 2 - gap / 2);
          continue;
        }
        const otherStart = dot > 0 ? base + other.innerRadius : base - other.outerRadius;
        const otherEnd = dot > 0 ? base + other.outerRadius : base - other.innerRadius;
        if (otherEnd <= innerRadius || otherStart >= outerRadius) continue;
        if (otherStart >= innerRadius) outerRadius = Math.min(outerRadius, otherStart - gap / 2);
        else innerRadius = Math.max(innerRadius, otherEnd + gap / 2);
      }
      if (Number.isFinite(facingOuterLimit)) outerRadius = facingOuterLimit;
      // Neighbouring lines may leave little room; a line keeps at least one thickness so it never disappears.
      outerRadius = Math.max(outerRadius, innerRadius + settings.threatLineThickness);
      const { center, direction, normal, offset } = line;
      if (line.curved) {
        svg.append(createKnightCurvePath(line, innerRadius, outerRadius));
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

    // While dragging, wedges are based on the piece's original square so they stay visible for all destinations, not only the hovered one.
    const wedgeParsed = dragPreview
      ? readDragPreview({ ...dragPreview, position: dragPreview.basePosition, legal: false })
      : parsed;
    const wedgeSelectedPiece = wedgeParsed.selected && wedgeParsed.position[wedgeParsed.selected.row]?.[wedgeParsed.selected.col];
    const sources = !settings.selectedPieceWedgeEnabled
      ? []
      : settings.selectedPieceWedgeOnlySelected
        ? wedgeSelectedPiece ? [wedgeParsed.selected] : []
        : wedgeParsed.position.flatMap((row, rowIndex) => row.flatMap((piece, colIndex) => piece ? [{ row: rowIndex, col: colIndex }] : []));
    const wedges = [];
    const wedgeThreatened = getThreatenedSquares(wedgeParsed.position, wedgeParsed.blackOrientation);
    for (const source of sources) {
      const piece = wedgeParsed.position[source.row][source.col];
      // No direct wedges from a piece that a lower-valued enemy piece could capture (kings cannot be captured).
      const capturedByLower = piece.type !== "king" && (wedgeThreatened[piece.color].get(`${source.row},${source.col}`) ?? [])
        .some(attacker => pieceValues[wedgeParsed.position[attacker.row][attacker.col].type] < pieceValues[piece.type]);
      const directTargets = capturedByLower ? [] : getAttackedPieces(wedgeParsed.position, source, wedgeParsed.blackOrientation)
        .filter(target => wedgeParsed.position[target.row][target.col].color !== piece.color);
      wedges.push(...directTargets.map(target => ({ source, target, color: piece.color })));

      if (!settings.wedgePotentialEnabled) continue;
      // Legal destinations from the board; while dragging on a board without them (setup mode), free fields are used.
      const legalDestinations = [...board.querySelectorAll(":scope > square.move-dest")]
        .map(square => getScreenSquare(square, board)).filter(Boolean);
      const canReuseLegalDestinations = settings.selectedPieceWedgeOnlySelected && (legalDestinations.length || !dragPreview);
      const destinations = canReuseLegalDestinations
        ? legalDestinations
        : getFreeFieldMoves(wedgeParsed.position, source, piece, wedgeParsed.blackOrientation);
      wedges.push(...getPotentialWedges(wedgeParsed.position, source, destinations, wedgeParsed.blackOrientation, settings)
        .map(wedge => ({ ...wedge, color: piece.color })));
    }
    const defenseSegments = settings.defenseCirclesEnabled
      ? getDefenseConnections(parsed.position, parsed.blackOrientation).map(connection => ({
        target: connection.target,
        angle: Math.atan2(connection.source.row - connection.target.row, connection.source.col - connection.target.col),
        type: parsed.position[connection.target.row][connection.target.col].type,
        sourceType: parsed.position[connection.source.row][connection.source.col].type,
        color: connection.color === "w" ? settings.whitePieceColor : settings.blackPieceColor
      }))
      : [];
    const centerCircles = settings.threatCenterCircleEnabled
      ? getOverloadedPieces(parsed.position, parsed.blackOrientation)
      : [];
    renderThreatArcs(
      board,
      entry,
      threats,
      defenseSegments,
      centerCircles,
      settings.threatAttackDisplayMode,
      settings.threatDefenseDisplayMode
    );
    if (!wedges.length) {
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

  }

  function renderThreatDisplaySet(svg, segments, figureRadii, displayMode) {
    if (!segments.length) return;
    if (displayMode === "lines") renderLineSet(svg, segments, figureRadii);
    else if (displayMode === "square") renderSquareSegmentSet(svg, segments, figureRadii);
    else renderSegmentSet(svg, segments, figureRadii);
  }

  // Attack and defense segments share one top-layer SVG while retaining their selected display modes.
  function renderThreatArcs(
    board,
    entry,
    threats,
    defenseSegments = [],
    centerCircles = [],
    attackDisplayMode = "segments",
    defenseDisplayMode = "segments"
  ) {
    if (!threats.length && !defenseSegments.length && !centerCircles.length) {
      entry.arcSvg?.remove();
      entry.arcSvg = null;
      entry.centerSvg?.remove();
      entry.centerSvg = null;
      return;
    }
    const attackSegments = [];
    for (const threat of threats) {
      const color = threat.color === "w" ? settings.blackPieceColor : settings.whitePieceColor;
      for (const attacker of threat.attackers) {
        attackSegments.push({
          target: threat.square,
          angle: Math.atan2(attacker.row - threat.square.row, attacker.col - threat.square.col),
          type: threat.type,
          sourceType: attacker.type,
          color,
          category: "attack"
        });
      }
    }
    const preparedDefenseSegments = defenseSegments.map(segment => ({ ...segment, category: "defense" }));

    if (!attackSegments.length && !preparedDefenseSegments.length) {
      entry.arcSvg?.remove();
      entry.arcSvg = null;
    } else if (!entry.arcSvg) {
      entry.arcSvg = document.createElementNS(svgNamespace, "svg");
      entry.arcSvg.classList.add("lfs-threat-arc");
      entry.arcSvg.setAttribute("viewBox", "0 0 8 8");
      entry.arcSvg.setAttribute("aria-hidden", "true");
    }
    if (entry.arcSvg && entry.arcSvg.parentNode !== board) board.append(entry.arcSvg);

    if (entry.arcSvg) {
      entry.arcSvg.replaceChildren();
      const figureRadii = getFigureRadii(settings.pieceSet);
      if (attackDisplayMode === defenseDisplayMode) {
        renderThreatDisplaySet(entry.arcSvg, [...attackSegments, ...preparedDefenseSegments], figureRadii, attackDisplayMode);
      } else {
        renderThreatDisplaySet(entry.arcSvg, attackSegments, figureRadii, attackDisplayMode);
        renderThreatDisplaySet(entry.arcSvg, preparedDefenseSegments, figureRadii, defenseDisplayMode);
      }
    }

    if (!centerCircles.length) {
      entry.centerSvg?.remove();
      entry.centerSvg = null;
      return;
    }
    if (!entry.centerSvg) {
      entry.centerSvg = document.createElementNS(svgNamespace, "svg");
      entry.centerSvg.classList.add("lfs-threat-center-circles");
      entry.centerSvg.setAttribute("viewBox", "0 0 8 8");
      entry.centerSvg.setAttribute("aria-hidden", "true");
    }
    if (entry.centerSvg.parentNode !== board) board.append(entry.centerSvg);

    const circles = [];
    for (const { target, color } of centerCircles) {
      const circle = document.createElementNS(svgNamespace, "circle");
      circle.setAttribute("cx", String(target.col + 0.5));
      circle.setAttribute("cy", String(target.row + 0.5));
      circle.setAttribute("r", String(settings.threatCenterCircleDiameterPercent / 200));
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", color === "w" ? settings.whitePieceColor : settings.blackPieceColor);
      circle.setAttribute("stroke-width", String(settings.threatCenterCircleThicknessPercent / 100));
      circle.setAttribute("pointer-events", "none");
      circles.push(circle);
    }
    entry.centerSvg.replaceChildren(...circles);
  }

  function observeBoard(board) {
    if (observedBoards.has(board)) return;
    const entry = {
      svg: null, arcSvg: null, centerSvg: null, frame: 0
    };
    observedBoards.set(board, entry);

    // Overlay elements are added to the board too; ignoring them stops the render from re-triggering itself every frame.
    const isOverlayOnlyChange = mutation => mutation.type === "childList"
      && ![...mutation.addedNodes, ...mutation.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && node.matches("piece, square"))
      && !mutation.target.matches?.("piece, square");
    const boardObserver = new MutationObserver(mutations => {
      if (mutations.some(mutation => !isOverlayOnlyChange(mutation) && (mutation.target === board || mutation.target.matches?.("piece, square")))) {
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
      entry.centerSvg?.remove();
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
