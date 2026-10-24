(() => {
  const directions = {
    N: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]],
    K: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
    R: [[-1, 0], [1, 0], [0, -1], [0, 1]],
    B: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    Q: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
  };
  const pieceTypeNames = ["pawn", "knight", "bishop", "rook", "queen", "king"];
  const pieceCodes = { pawn: "P", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" };
  const pieceValues = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 };
  const boardSelector = "body[data-board] .cg-wrap cg-board, .mini-game cg-board";
  const selectedSquareSelector = "body[data-board] .cg-wrap cg-board > square.selected, .mini-game cg-board > square.selected";
  // Standard blend functions operate on encoded sRGB channels in [0, 1].
  const rgbBlendModes = Object.freeze({
    normal: (base, tint) => tint,
    multiply: (base, tint) => base * tint,
    screen: (base, tint) => base + tint - base * tint,
    overlay: (base, tint) => base <= 0.5 ? 2 * base * tint : 1 - 2 * (1 - base) * (1 - tint),
    "soft-light": (base, tint) => {
      if (tint <= 0.5) return base - (1 - 2 * tint) * base * (1 - base);
      const curve = base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
      return base + (2 * tint - 1) * (curve - base);
    },
    "hard-light": (base, tint) => tint <= 0.5 ? 2 * base * tint : 1 - 2 * (1 - base) * (1 - tint),
    darken: (base, tint) => Math.min(base, tint),
    lighten: (base, tint) => Math.max(base, tint),
    difference: (base, tint) => Math.abs(base - tint)
  });

  let settings = null;
  const observedBoards = new Map();
  let documentObserver = null;
  let themeObserver = null;
  const threatImageCache = new Map();
  const threatMapCache = new Map();
  const parsedColorCache = new Map();
  let threatCanvas = null;
  const displayedThreatKeys = new WeakMap();
  const pendingThreatKeys = new WeakMap();
  const hoveredMoveTargets = new WeakMap();
  const knightHoverGaps = new WeakMap();
  const dirtyBoards = new Set();
  const waitingBoards = new Set();
  let renderFrame = 0;
  let renderAllBoards = true;
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
    if (piece[1] !== "P") return getInitialMoves(row, col, piece, board);

    const moves = [];
    const nextRow = row + (piece[0] === "w" ? -1 : 1);
    if (isInside(nextRow, col) && !board[nextRow][col]) moves.push([nextRow, col]);
    return moves;
  }

  function calculateThreatMap(board, options) {
    const result = Array.from({ length: 8 }, () => Array(8).fill(0));
    const totalThreats = Array.from({ length: 8 }, () => Array(8).fill(0));
    const weightedTotalThreats = Array.from({ length: 8 }, () => Array(8).fill(0));
    const maxDepth = Math.max(1, Math.min(5, Math.round(Number(options.threatMoveDepth) || 1)));
    const depthFactor = Math.max(0, Math.min(1, Number(options.threatDepthFactor) || 0));
    const ownSeeThrough = Math.max(0, Math.min(1, Number(options.threatOwnSeeThrough) || 0));
    const opponentSeeThrough = Math.max(0, Math.min(1, Number(options.threatOpponentSeeThrough) || 0));
    const pieceValueInfluence = Math.max(0, Math.min(100, Number(options.threatPieceValueInfluencePercent ?? 100) || 0)) / 100;

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (!piece) continue;

        const sign = piece[0] === "w" ? 1 : -1;
        // Cheaper pieces exert safer control because exchanging them costs less.
        const pieceWeight = 1 - pieceValueInfluence + pieceValueInfluence / pieceValues[piece[1]];
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

        if (["B", "R", "Q"].includes(piece[1])) {
          for (const [dr, dc] of getDirections(piece)) {
            let nextRow = row + dr;
            let nextCol = col + dc;
            let blocked = false;
            let cumulativeFactor = 1;
            while (isInside(nextRow, nextCol)) {
              const occupant = board[nextRow][nextCol];
              if (blocked) {
                const strength = pieceThreats[nextRow][nextCol] + (sign * cumulativeFactor);
                pieceThreats[nextRow][nextCol] = Math.max(-1, Math.min(1, strength));
              }
              if (occupant) {
                blocked = true;
                cumulativeFactor *= occupant[0] === piece[0] ? ownSeeThrough : opponentSeeThrough;
                if (cumulativeFactor === 0) break;
              }
              nextRow += dr;
              nextCol += dc;
            }
          }
        }

        for (let targetRow = 0; targetRow < 8; targetRow++) {
          for (let targetCol = 0; targetCol < 8; targetCol++) {
            const threat = pieceThreats[targetRow][targetCol];
            result[targetRow][targetCol] += threat * pieceWeight;
            totalThreats[targetRow][targetCol] += Math.abs(threat);
            weightedTotalThreats[targetRow][targetCol] += Math.abs(threat) * pieceWeight;
          }
        }
      }
    }

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        // Weight the balance between players without fading uncontested control.
        if (pieceValueInfluence > 0 && weightedTotalThreats[row][col] > 0) {
          result[row][col] *= totalThreats[row][col] / weightedTotalThreats[row][col];
        }
        result[row][col] = Math.max(-5, Math.min(5, result[row][col]));
      }
    }
    return result;
  }

  function parseHexColor(hex) {
    const cached = parsedColorCache.get(hex);
    if (cached) {
      parsedColorCache.delete(hex);
      parsedColorCache.set(hex, cached);
      return [...cached];
    }
    const channels = globalThis.LichessColors.toRgb(hex);
    // Remove conversion noise from legacy RGB8 colors without quantizing picker colors.
    const parsed = channels ? channels.map(channel => Math.abs(channel - Math.round(channel)) < 0.001 ? Math.round(channel) : channel) : [255, 255, 255];
    parsedColorCache.set(hex, parsed);
    if (parsedColorCache.size > 64) parsedColorCache.delete(parsedColorCache.keys().next().value);
    return [...parsed];
  }

  function getCachedThreatMap(position, options) {
    const cacheKey = JSON.stringify([
      position,
      options.threatMoveDepth,
      options.threatDepthFactor,
      options.threatOwnSeeThrough,
      options.threatOpponentSeeThrough,
      options.threatPieceValueInfluencePercent
    ]);
    const cached = threatMapCache.get(cacheKey);
    if (cached) {
      threatMapCache.delete(cacheKey);
      threatMapCache.set(cacheKey, cached);
      return cached;
    }
    const threatMap = calculateThreatMap(position, options);
    threatMapCache.set(cacheKey, threatMap);
    if (threatMapCache.size > 32) threatMapCache.delete(threatMapCache.keys().next().value);
    return threatMap;
  }

  function toRgbString(rgb) {
    return globalThis.LichessColors.format(globalThis.LichessColors.fromRgb(rgb));
  }

  function getBoardBaseColor(row, col, options) {
    const lightTheme = document.documentElement.classList.contains("light");
    const lightSquareColor = parseHexColor(lightTheme ? options.boardLightLight : options.boardLightDark);
    if (options.monochromeBoard) return lightSquareColor;
    const darkSquareColor = parseHexColor(lightTheme ? options.boardDarkLight : options.boardDarkDark);
    return (row + col) % 2 === 0 ? lightSquareColor : darkSquareColor;
  }

  function getOpacityRgb(value, options, baseColor) {
    const normalized = Math.max(-5, Math.min(5, Number(value) || 0));
    const base = Array.isArray(baseColor) ? baseColor : parseHexColor(baseColor);
    const maxMix = Math.max(0, Math.min(100, Number(options.threatMaxMixPercent) || 0)) / 100;
    const amount = Math.min(Math.abs(normalized) / 5, 1) * maxMix;
    if (amount === 0) return base;
    const tintRgb = parseHexColor(normalized > 0 ? options.whitePieceColor : options.blackPieceColor);
    const blend = Object.hasOwn(rgbBlendModes, options.threatBlendMode) ? rgbBlendModes[options.threatBlendMode] : null;
    if (blend) {
      return base.map((channel, index) => {
        const background = Math.max(0, Math.min(1, channel / 255));
        const tint = Math.max(0, Math.min(1, tintRgb[index] / 255));
        return (background + (blend(background, tint) - background) * amount) * 255;
      });
    }
    const colors = globalThis.LichessColors;
    const background = colors.fromRgb(base);
    const tint = colors.fromRgb(tintRgb);
    const baseHue = background.h * Math.PI / 180;
    const tintHue = tint.h * Math.PI / 180;
    const a = background.c * Math.cos(baseHue) * (1 - amount) + tint.c * Math.cos(tintHue) * amount;
    const b = background.c * Math.sin(baseHue) * (1 - amount) + tint.c * Math.sin(tintHue) * amount;
    // Oklab mixing preserves the same light/dark separation for either player hue.
    // Reduce chroma rather than clip RGB channels, which would change that lightness.
    return colors.toRgb(colors.toGamut({
      l: background.l + (tint.l - background.l) * amount,
      c: Math.hypot(a, b),
      h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360,
      alpha: 1
    }));
  }

  function getOpacityColor(value, options, baseColor) {
    return toRgbString(getOpacityRgb(value, options, baseColor));
  }

  function isBlackOrientation(board) {
    return Boolean(board.closest(".cg-wrap")?.classList.contains("orientation-black"));
  }

  function logicalToScreen(square, blackOrientation) {
    return blackOrientation
      ? { row: 7 - square.row, col: 7 - square.col }
      : square;
  }

  function getLogicalSquare(element, board, blackOrientation) {
    const key = (globalThis.LichessMoveAnimation?.getDestinationKey(element)
      ?? (element.classList.contains("anim") ? element.getAttribute("data-lfs-move-key") : null))?.toLowerCase();
    if (key && /^[a-h][1-8]$/.test(key)) {
      return { row: 8 - Number(key[1]), col: key.charCodeAt(0) - 97 };
    }

    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) {
      return getLogicalSquareAtPoint(board, rect.left + rect.width / 2, rect.top + rect.height / 2, blackOrientation);
    }
    const datasetKey = element.dataset?.key?.toLowerCase();
    if (datasetKey && /^[a-h][1-8]$/.test(datasetKey)) {
      return { row: 8 - Number(datasetKey[1]), col: datasetKey.charCodeAt(0) - 97 };
    }
    const transform = element.style?.transform?.match(/translate(?:3d)?\(\s*(-?[\d.]+)%\s*,\s*(-?[\d.]+)%/);
    if (!transform) return null;
    const screenRow = Math.round(Number(transform[2]) / 100);
    const screenCol = Math.round(Number(transform[1]) / 100);
    if (!isInside(screenRow, screenCol)) return null;
    return blackOrientation
      ? { row: 7 - screenRow, col: 7 - screenCol }
      : { row: screenRow, col: screenCol };
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
    const promotionRow = piece[0] === "w" ? 0 : 7;
    preview[target.row][target.col] = piece[1] === "P" && target.row === promotionRow
      ? `${piece[0]}Q`
      : piece;

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

  function readBoard(board) {
    if (!board.closest(".is2d")) return null;
    const blackOrientation = isBlackOrientation(board);
    const position = Array.from({ length: 8 }, () => Array(8).fill(""));
    let pieceCount = 0;

    for (const element of board.querySelectorAll(":scope > piece")) {
      if (element.classList.contains("ghost") || element.classList.contains("fading")) continue;
      const side = element.classList.contains("white") ? "w" : element.classList.contains("black") ? "b" : "";
      const type = pieceTypeNames.find(name => element.classList.contains(name));
      const square = getLogicalSquare(element, board, blackOrientation);
      if (!side || !type || !square || !isInside(square.row, square.col) || position[square.row][square.col]) return null;
      position[square.row][square.col] = side + pieceCodes[type];
      pieceCount++;
    }

    return pieceCount ? { position, blackOrientation } : null;
  }

  function clearThreatBackground(board) {
    if (!board) return;
    displayedThreatKeys.delete(board);
    pendingThreatKeys.delete(board);
    board.removeAttribute("data-lfs-threat-board");
    board.style.removeProperty("--lfs-threat-background");
    board.style.removeProperty("--lfs-threat-background-position");
    board.style.removeProperty("--lfs-threat-background-size");
    board.style.removeProperty("--lfs-threat-gap-background");
  }

  function getThreatImage(cacheKey, colors, transitionPercent) {
    const cached = threatImageCache.get(cacheKey);
    if (cached) {
      threatImageCache.delete(cacheKey);
      threatImageCache.set(cacheKey, cached);
      return cached;
    }

    threatCanvas ??= Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
    const context = threatCanvas.getContext("2d");
    context.putImageData(new ImageData(getThreatPixels(colors, transitionPercent), 256, 256), 0, 0);

    const url = threatCanvas.toDataURL("image/png");
    const image = document.createElement("img");
    let ready;
    if (typeof image.decode === "function") {
      image.src = url;
      ready = image.decode().catch(() => undefined);
    } else {
      ready = new Promise(resolve => {
        image.onload = resolve;
        image.onerror = resolve;
        image.src = url;
      });
    }
    const entry = { url, image, ready };
    threatImageCache.set(cacheKey, entry);
    if (threatImageCache.size > 64) threatImageCache.delete(threatImageCache.keys().next().value);
    return entry;
  }

  function showThreatImage(board, cacheKey, entry) {
    if (displayedThreatKeys.get(board) === cacheKey) {
      pendingThreatKeys.delete(board);
      return;
    }
    if (pendingThreatKeys.get(board) === cacheKey) return;
    pendingThreatKeys.set(board, cacheKey);
    entry.ready.then(() => {
      if (!board.isConnected || pendingThreatKeys.get(board) !== cacheKey) return;
      pendingThreatKeys.delete(board);
      board.style.setProperty("--lfs-threat-background", `url(\"${entry.url}\")`);
      board.style.setProperty("--lfs-threat-background-position", "center");
      board.style.setProperty("--lfs-threat-background-size", "100% 100%");
      board.setAttribute("data-lfs-threat-board", "");
      displayedThreatKeys.set(board, cacheKey);
    });
  }

  function waitForPieceMoves(board) {
    const animations = [...board.querySelectorAll(":scope > piece")]
      .flatMap(piece => piece.getAnimations())
      .filter(animation => animation.transitionProperty === "transform" && animation.playState === "running");
    if (!animations.length) return false;
    if (waitingBoards.has(board)) return true;

    waitingBoards.add(board);
    Promise.all(animations.map(animation => animation.finished.catch(() => undefined)))
      .then(() => {
        waitingBoards.delete(board);
        scheduleRender(board);
      });
    return true;
  }

  function getAxisBlend(position, transitionPercent) {
    const scaledPosition = position * 8;
    const cell = Math.min(7, Math.floor(scaledPosition));
    const offset = scaledPosition - cell;
    const halfWidth = transitionPercent / 200;
    if (!halfWidth) return [cell, cell, 0];

    if (cell > 0 && offset < halfWidth) {
      const progress = (offset + halfWidth) / (2 * halfWidth);
      return [cell - 1, cell, progress * progress * (3 - 2 * progress)];
    }
    if (cell < 7 && offset > 1 - halfWidth) {
      const progress = (offset - (1 - halfWidth)) / (2 * halfWidth);
      return [cell, cell + 1, progress * progress * (3 - 2 * progress)];
    }
    return [cell, cell, 0];
  }

  function getThreatPixels(colors, transitionPercent) {
    const size = 256;
    const axisBlends = Array.from({ length: size }, (_, pixel) =>
      getAxisBlend((pixel + 0.5) / size, transitionPercent)
    );
    // Blend each board row across the columns once; the pixel loop then only mixes two rows vertically.
    const strips = new Float64Array(8 * size * 3);
    for (let row = 0; row < 8; row++) {
      for (let x = 0; x < size; x++) {
        const [fromCol, toCol, colBlend] = axisBlends[x];
        const from = colors[row][fromCol];
        const to = colors[row][toCol];
        const offset = (row * size + x) * 3;
        for (let channel = 0; channel < 3; channel++) {
          strips[offset + channel] = from[channel] + (to[channel] - from[channel]) * colBlend;
        }
      }
    }

    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      const [fromRow, toRow, rowBlend] = axisBlends[y];
      for (let x = 0; x < size; x++) {
        const top = (fromRow * size + x) * 3;
        const bottom = (toRow * size + x) * 3;
        const offset = (y * size + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const topValue = strips[top + channel];
          pixels[offset + channel] = topValue + (strips[bottom + channel] - topValue) * rowBlend;
        }
        pixels[offset + 3] = 255;
      }
    }

    return pixels;
  }

  function getThreatGapColor(colors, row, col) {
    const neighbors = [];
    for (const r of [row - 1, row]) {
      for (const c of [col - 1, col]) {
        if (isInside(r, c)) neighbors.push(colors[r][c]);
      }
    }
    return [0, 1, 2].map(channel => neighbors.reduce((sum, color) => sum + color[channel], 0) / neighbors.length);
  }

  function renderPosition(board, position, blackOrientation) {
    const threatMap = getCachedThreatMap(position, settings);
    const colors = Array.from({ length: 8 }, () => Array(8));
    const fieldShapePercent = settings.boardFieldShape === "round" ? settings.boardRoundPercent : settings.boardBevelPercent;
    const bevelEnabled = settings.boardBevelEnabled && fieldShapePercent > 0;
    const gapColors = bevelEnabled ? Array.from({ length: 8 }, () => Array(8)) : null;
    const lightTheme = document.documentElement.classList.contains("light");
    const lightSquareColor = parseHexColor(lightTheme ? settings.boardLightLight : settings.boardLightDark);
    const darkSquareColor = settings.monochromeBoard
      ? lightSquareColor
      : parseHexColor(lightTheme ? settings.boardDarkLight : settings.boardDarkDark);
    const gapBase = bevelEnabled ? parseHexColor(document.documentElement.classList.contains("light") ? settings.boardGapLight : settings.boardGapDark) : null;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const screenRow = blackOrientation ? 7 - row : row;
        const screenCol = blackOrientation ? 7 - col : col;
        const baseColor = settings.monochromeBoard || (row + col) % 2 === 0 ? lightSquareColor : darkSquareColor;
        colors[screenRow][screenCol] = getOpacityRgb(threatMap[row][col], settings, baseColor);
        if (gapColors) gapColors[screenRow][screenCol] = getOpacityRgb(threatMap[row][col], settings, gapBase);
      }
    }
    if (gapColors) {
      const patches = [];
      for (let row = 0; row <= 8; row++) {
        for (let col = 0; col <= 8; col++) {
          const color = toRgbString(getThreatGapColor(gapColors, row, col));
          patches.push(`<rect x="${col - 0.5}" y="${row - 0.5}" width="1" height="1" fill="${color}"/>`);
        }
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">${patches.join("")}</svg>`;
      board.style.setProperty("--lfs-threat-gap-background", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    } else {
      board.style.removeProperty("--lfs-threat-gap-background");
    }
    const cacheKey = `${settings.threatGradientPercent}:${JSON.stringify(colors)}`;
    if (settings.threatGradientPercent === 0) {
      const layers = [];
      const positions = [];
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const x = ((col / 7) * 100).toFixed(6);
          const y = ((row / 7) * 100).toFixed(6);
          const color = toRgbString(colors[row][col]);
          layers.push(`linear-gradient(in srgb, ${color}, ${color})`);
          positions.push(`${x}% ${y}%`);
        }
      }
      pendingThreatKeys.delete(board);
      board.style.setProperty("--lfs-threat-background", layers.join(", "));
      board.style.setProperty("--lfs-threat-background-position", positions.join(", "));
      board.style.setProperty("--lfs-threat-background-size", "12.5% 12.5%");
      board.setAttribute("data-lfs-threat-board", "");
      displayedThreatKeys.set(board, cacheKey);
      return;
    }
    showThreatImage(board, cacheKey, getThreatImage(cacheKey, colors, settings.threatGradientPercent));
  }

  function getDragPreviewState(board) {
    if (!pieceInteractionActive || !activePieceDrag || activePieceDrag.board !== board) return null;
    const blackOrientation = isBlackOrientation(board);
    const target = getLogicalSquareAtPoint(board, activePieceDrag.clientX, activePieceDrag.clientY, blackOrientation);
    // The board editor (Stellung aufbauen) has no legal destinations, so every field is a valid target there.
    const isEditor = Boolean(board.closest(".board-editor"));
    const allowed = target && (isEditor || getAllowedDestinations(board, blackOrientation).has(`${target.row},${target.col}`));
    const position = allowed
      ? createPreviewPosition(activePieceDrag.position, activePieceDrag.source, target)
      : null;
    return {
      position: position || activePieceDrag.position,
      source: activePieceDrag.source,
      target: position ? target : activePieceDrag.source,
      legal: Boolean(position),
      basePosition: activePieceDrag.position,
      blackOrientation,
      isHoverPreview: false
    };
  }

  function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const progress = lengthSquared
      ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
      : 0;
    return Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy));
  }

  function getHoverMoveTarget(board, allowed, blackOrientation, x, y, source, isKnight = false) {
    const pointSquare = getLogicalSquareAtPoint(board, x, y, blackOrientation);
    if (!pointSquare) return null;
    if (pointSquare.row === source.row && pointSquare.col === source.col) return source;
    // A move field under the pointer wins.
    if (allowed.has(`${pointSquare.row},${pointSquare.col}`)) return pointSquare;

    // Any other field returns the figure to its origin, except inside the corridor between two diagonally connected move fields.
    const boardRect = board.getBoundingClientRect();
    const point = {
      x: (x - boardRect.left) * 8 / boardRect.width,
      y: (y - boardRect.top) * 8 / boardRect.height
    };
    const previousState = hoveredMoveTargets.get(board);
    const previous = previousState?.source.row === source.row && previousState.source.col === source.col
      ? previousState.target
      : null;
    const candidates = [...allowed].map(key => {
      const [row, col] = key.split(",").map(Number);
      const screen = logicalToScreen({ row, col }, blackOrientation);
      return { square: { row, col }, screen, center: { x: screen.col + 0.5, y: screen.row + 0.5 } };
    });
    const distanceTo = candidate => Math.hypot(point.x - candidate.center.x, point.y - candidate.center.y);
    const isPrevious = candidate => previous && candidate.square.row === previous.row && candidate.square.col === previous.col;

    let corridor = null;
    const corridorRadius = settings.movePreviewCorridorWidthPercent / 200;
    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex++) {
        const first = candidates[firstIndex];
        const second = candidates[secondIndex];
        const rows = Math.abs(first.screen.row - second.screen.row);
        const cols = Math.abs(first.screen.col - second.screen.col);
        const diagonal = rows === 1 && cols === 1;
        const straightKnightGap = isKnight && ((rows === 2 && cols === 0) || (rows === 0 && cols === 2));
        if (!diagonal && !straightKnightGap) continue;
        const distance = distanceToSegment(point, first.center, second.center);
        if (distance > corridorRadius || (corridor && distance >= corridor.distance)) continue;

        const nearest = distanceTo(first) <= distanceTo(second) ? first : second;
        const other = nearest === first ? second : first;
        const target = isPrevious(other) && distanceTo(other) <= distanceTo(nearest) + 0.1 ? other : nearest;
        corridor = { distance, target: target.square };
      }
    }
    return corridor?.target ?? source;
  }

  function clearKnightHoverGap(board) {
    const gap = knightHoverGaps.get(board);
    if (gap) clearTimeout(gap.timer);
    knightHoverGaps.delete(board);
  }

  function getSelectedMovePreview(board, position, blackOrientation, x, y) {
    const selectedSquare = board.querySelector(":scope > square.selected");
    if (!selectedSquare) return null;
    const source = getLogicalSquare(selectedSquare, board, blackOrientation);
    if (!source || !position[source.row][source.col]) return null;
    const allowed = getAllowedDestinations(board, blackOrientation);
    const isKnight = position[source.row][source.col][1] === "N";
    let target = getHoverMoveTarget(
      board,
      allowed,
      blackOrientation,
      x,
      y,
      source,
      isKnight
    );
    if (!target) return null;
    const pointerSquare = getLogicalSquareAtPoint(board, x, y, blackOrientation);
    const isKnightGap = isKnight && pointerSquare
      && !position[pointerSquare.row][pointerSquare.col]
      && !allowed.has(`${pointerSquare.row},${pointerSquare.col}`)
      && (target.row !== source.row || target.col !== source.col);
    if (isKnightGap) {
      const key = `${source.row},${source.col}:${pointerSquare.row},${pointerSquare.col}`;
      let gap = knightHoverGaps.get(board);
      if (gap?.key !== key) {
        clearKnightHoverGap(board);
        gap = { key, expired: false, timer: null };
        gap.timer = setTimeout(() => {
          gap.expired = true;
          scheduleRender(board);
          document.dispatchEvent(new CustomEvent("lfs-hover-preview-change", { detail: board }));
        }, 250);
        knightHoverGaps.set(board, gap);
      }
      if (gap.expired) target = source;
    } else {
      clearKnightHoverGap(board);
    }
    const preview = createPreviewPosition(position, source, target);
    return preview ? {
      position: preview,
      source,
      target,
      legal: true,
      basePosition: position,
      blackOrientation,
      isHoverPreview: true
    } : null;
  }

  function getInteractionPreview(board, x = lastPointerPosition?.x, y = lastPointerPosition?.y) {
    const dragPreview = getDragPreviewState(board);
    if (dragPreview) {
      clearKnightHoverGap(board);
      hoveredMoveTargets.delete(board);
      return dragPreview;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      clearKnightHoverGap(board);
      hoveredMoveTargets.delete(board);
      return null;
    }
    const parsed = readBoard(board);
    const preview = parsed ? getSelectedMovePreview(board, parsed.position, parsed.blackOrientation, x, y) : null;
    if (preview) hoveredMoveTargets.set(board, { source: preview.source, target: preview.target });
    else {
      clearKnightHoverGap(board);
      hoveredMoveTargets.delete(board);
    }
    return preview;
  }

  function render() {
    renderFrame = 0;
    const boards = [...document.querySelectorAll(boardSelector)];
    observeBoards(boards);
    const boardsToRender = renderAllBoards ? boards : boards.filter(board => dirtyBoards.has(board));
    renderAllBoards = false;
    dirtyBoards.clear();
    for (const board of boardsToRender) {
      if (!settings?.enabled || !settings.threatColoringEnabled || !board.closest(".is2d")) {
        clearThreatBackground(board);
        continue;
      }
      const preview = getInteractionPreview(board);
      if (pieceInteractionActive) {
        if (preview) renderPosition(board, preview.position, preview.blackOrientation);
        continue;
      }
      if (waitForPieceMoves(board)) continue;

      const parsed = readBoard(board);
      if (!parsed) continue;
      renderPosition(board, preview?.position ?? parsed.position, preview?.blackOrientation ?? parsed.blackOrientation);
    }
  }

  function scheduleRender(board) {
    if (board) dirtyBoards.add(board);
    else renderAllBoards = true;
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(render);
  }

  function containsMainBoard(node) {
    return node.nodeType === Node.ELEMENT_NODE && (
      node.matches(".main-board, .mini-game, .cg-wrap, cg-board") ||
      Boolean(node.querySelector(boardSelector))
    );
  }

  function isRelevantBoardMutation(mutation) {
    if (mutation.type === "attributes") {
      const target = mutation.target;
      if (target.matches("cg-board, .cg-wrap")) return mutation.attributeName === "class";
      // Moving-piece transforms are rewritten on every Chessground animation frame.
      if (mutation.attributeName === "style" && target.matches("piece.anim")) return false;
      return target.matches("piece, square");
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      node.nodeType === Node.ELEMENT_NODE && (
        node.matches("piece, square.selected, square.move-dest, square.premove-dest") ||
        node.querySelector("piece, square.selected, square.move-dest, square.premove-dest")
      )
    );
  }

  function observeBoards(boards) {
    const currentBoards = new Set(boards);
    for (const [board, observers] of observedBoards) {
      if (currentBoards.has(board)) continue;
      observers.board.disconnect();
      observers.orientation?.disconnect();
      clearKnightHoverGap(board);
      clearThreatBackground(board);
      observedBoards.delete(board);
    }

    for (const board of boards) {
      if (observedBoards.has(board)) continue;
      const boardObserver = new MutationObserver(mutations => {
        if (!mutations.some(isRelevantBoardMutation)) return;
        scheduleRender(board);
      });
      boardObserver.observe(board, {
        attributes: true,
        attributeFilter: ["class", "data-key", "data-lfs-move-key", "style"],
        childList: true,
        subtree: true
      });

      const wrapper = board.closest(".cg-wrap");
      let orientationObserver = null;
      if (wrapper) {
        orientationObserver = new MutationObserver(() => scheduleRender(board));
        orientationObserver.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
      }
      observedBoards.set(board, { board: boardObserver, orientation: orientationObserver });
    }
  }

  function initialize() {
    if (!interactionListenersAdded) {
      document.addEventListener("lfs-hover-preview-change", event => scheduleRender(event.detail));
      document.addEventListener("pointerdown", event => {
        lastPointerPosition = { x: event.clientX, y: event.clientY };
        if (event.button !== 0 || typeof event.target?.closest !== "function") return;
        const board = event.target.closest("cg-board");
        if (!board || !board.matches(boardSelector)) return;
        const parsed = board ? readBoard(board) : null;
        const source = parsed
          ? getLogicalSquareAtPoint(board, event.clientX, event.clientY, parsed.blackOrientation)
          : null;
        if (!parsed || !source || !parsed.position[source.row][source.col]) return;
        const selectedElement = board.querySelector(":scope > square.selected");
        const selected = selectedElement && getLogicalSquare(selectedElement, board, parsed.blackOrientation);
        // A capture click confirms the selected piece instead of starting a drag of its victim.
        if (selected && (selected.row !== source.row || selected.col !== source.col)
          && getAllowedDestinations(board, parsed.blackOrientation).has(`${source.row},${source.col}`)) return;
        pieceInteractionActive = true;
        activePieceDrag = { board, position: parsed.position, source, clientX: event.clientX, clientY: event.clientY };
      }, true);
      document.addEventListener("pointermove", event => {
        lastPointerPosition = { x: event.clientX, y: event.clientY };
        if (pieceInteractionActive && activePieceDrag) {
          activePieceDrag.clientX = event.clientX;
          activePieceDrag.clientY = event.clientY;
          document.dispatchEvent(new CustomEvent("lfs-hover-preview-change", { detail: activePieceDrag.board }));
          return;
        }
        if (settings?.enabled) {
          const selected = document.querySelector(selectedSquareSelector);
          if (selected) document.dispatchEvent(new CustomEvent("lfs-hover-preview-change", { detail: selected.parentElement }));
        }
      }, true);
      const finishPieceInteraction = event => {
        pieceInteractionActive = false;
        activePieceDrag = null;
        if (event.type === "blur" || event.type === "pointercancel") lastPointerPosition = null;
        for (const board of observedBoards.keys()) {
          document.dispatchEvent(new CustomEvent("lfs-hover-preview-change", { detail: board }));
        }
      };
      document.addEventListener("pointerup", finishPieceInteraction, true);
      document.addEventListener("pointercancel", finishPieceInteraction, true);
      window.addEventListener("blur", finishPieceInteraction);
      interactionListenersAdded = true;
    }

    if (!documentObserver) {
      documentObserver = new MutationObserver(mutations => {
        if (!mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(containsMainBoard))) return;
        scheduleRender();
      });
      documentObserver.observe(document, { childList: true, subtree: true });
    }
    if (document.documentElement && !themeObserver) {
      themeObserver = new MutationObserver(() => scheduleRender());
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    }
    observeBoards([...document.querySelectorAll(boardSelector)]);
    scheduleRender();
  }

  function update(nextSettings) {
    settings = nextSettings;
    initialize();
  }

  globalThis.LichessThreatCoding = {
    update,
    calculateThreatMap,
    createPreviewPosition,
    getBoardBaseColor,
    getOpacityColor,
    getThreatPixels,
    getThreatGapColor,
    getInteractionPreview
  };
})();
