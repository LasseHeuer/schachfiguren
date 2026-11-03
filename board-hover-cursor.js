(() => {
  const namespace = "http://www.w3.org/2000/svg";
  const boardSelector = "body[data-board] .is2d .cg-wrap cg-board, .mini-game .is2d cg-board";
  let settings;
  let activeBoard;
  let cursorSvg;
  let cursorPaths;
  let cursorState;
  let frame = 0;
  let lastFrameTime = 0;
  let piecePointer = null;
  let pieceDragStarted = false;

  function findBoard(target) {
    if (!(target instanceof Element)) return null;
    const board = target.closest(boardSelector);
    return board && board.id !== "lfs-pv-preview" && board.id !== "lfs-move-preview" ? board : null;
  }

  function createSvgElement(name, className) {
    const element = document.createElementNS(namespace, name);
    element.classList.add(className);
    element.setAttribute("fill", "none");
    element.setAttribute("stroke-linecap", "round");
    element.setAttribute("stroke-linejoin", "round");
    element.setAttribute("vector-effect", "non-scaling-stroke");
    return element;
  }

  function setCursorStyle() {
    if (!cursorSvg || !settings) return;
    cursorSvg.style.setProperty("--lfs-board-cursor-color", settings.boardCursorColor);
    cursorSvg.style.setProperty("--lfs-board-cursor-width", `${settings.boardCursorWidthPx}px`);
    cursorSvg.style.setProperty("--lfs-board-cursor-opacity", String(settings.boardCursorOpacity / 100));
    cursorSvg.style.setProperty("--lfs-board-cursor-highlight-opacity", String(settings.boardCursorOpacity / 100 * 0.34));
    cursorSvg.style.setProperty("--lfs-board-cursor-glow-opacity", String(settings.boardCursorGlowPercent / 100 * 0.3));
    cursorSvg.style.setProperty("--lfs-board-cursor-glow-blur", `${settings.boardCursorGlowPercent / 100 * 2.5}px`);
    cursorSvg.style.setProperty("--lfs-board-cursor-glow-width", `${settings.boardCursorWidthPx * 4}px`);
  }

  function createCursor(board) {
    const svg = document.createElementNS(namespace, "svg");
    svg.classList.add("lfs-board-cursor");
    svg.setAttribute("viewBox", "0 0 8 8");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("data-lfs-cursor-visible", "");
    const glow = createSvgElement("path", "lfs-board-cursor-glow");
    const outline = createSvgElement("path", "lfs-board-cursor-outline");
    const highlight = createSvgElement("path", "lfs-board-cursor-highlight");
    svg.append(glow, outline, highlight);
    board.setAttribute("data-lfs-board-cursor-board", "");
    board.append(svg);
    activeBoard = board;
    cursorSvg = svg;
    cursorPaths = [glow, outline, highlight];
    setCursorStyle();
  }

  function clearCursor() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastFrameTime = 0;
    activeBoard?.removeAttribute("data-lfs-board-cursor-board");
    cursorSvg?.remove();
    activeBoard = null;
    cursorSvg = null;
    cursorPaths = null;
    cursorState = null;
  }

  function smoothstep(value) {
    const amount = Math.max(0, Math.min(1, value));
    return amount * amount * (3 - 2 * amount);
  }

  function advanceSpring(positionKey, velocityKey, target, seconds, responseMs = settings.boardCursorResponseMs) {
    const omega = 4.6 / (responseMs / 1000);
    const displacement = cursorState[positionKey] - target;
    const velocity = cursorState[velocityKey];
    const response = velocity + omega * displacement;
    const decay = Math.exp(-omega * seconds);
    const nextDisplacement = (displacement + response * seconds) * decay;
    const nextVelocity = (velocity - omega * response * seconds) * decay;
    cursorState[positionKey] = target + nextDisplacement;
    cursorState[velocityKey] = nextVelocity;
    if (Math.abs(nextDisplacement) < 0.0005 && Math.abs(nextVelocity) < 0.01) {
      cursorState[positionKey] = target;
      cursorState[velocityKey] = 0;
    }
  }

  function updateFieldTarget(col, row) {
    if (col === cursorState.col && row === cursorState.row) return;
    const targetX = col + 0.5;
    const targetY = row + 0.5;
    if (cursorState.col < 0 || cursorState.row < 0) {
      cursorState.fieldX = targetX;
      cursorState.fieldY = targetY;
      cursorState.vFieldX = 0;
      cursorState.vFieldY = 0;
    }
    cursorState.col = col;
    cursorState.row = row;
    cursorState.targetFieldX = targetX;
    cursorState.targetFieldY = targetY;
  }

  function mix(start, end, amount) {
    return start + (end - start) * amount;
  }

  function curveCorner(startX, startY, endX, endY, roundControl1, roundControl2, curve, deform) {
    const start = deform(startX, startY);
    const end = deform(endX, endY);
    const lineControl1 = [mix(start[0], end[0], 1 / 3), mix(start[1], end[1], 1 / 3)];
    const lineControl2 = [mix(start[0], end[0], 2 / 3), mix(start[1], end[1], 2 / 3)];
    const round1 = deform(roundControl1[0], roundControl1[1]);
    const round2 = deform(roundControl2[0], roundControl2[1]);
    const control1 = [mix(lineControl1[0], round1[0], curve), mix(lineControl1[1], round1[1], curve)];
    const control2 = [mix(lineControl2[0], round2[0], curve), mix(lineControl2[1], round2[1], curve)];
    return `C${control1[0]} ${control1[1]} ${control2[0]} ${control2[1]} ${end[0]} ${end[1]}`;
  }

  function morphFieldPath(centerX, centerY, width, height, amount, rect) {
    const x = centerX - width / 2;
    const y = centerY - height / 2;
    const inset = settings.boardCursorInsetPercent / 100;
    let endRadiusX = 0;
    let endRadiusY = 0;
    let endCurve = 0;
    if (settings.boardBevelEnabled && settings.boardFieldShape === "round") {
      endRadiusX = Math.max(0, settings.boardRoundPercent / 200 - inset);
      endRadiusY = endRadiusX;
      endCurve = 1;
    } else if (settings.boardBevelEnabled) {
      const bevel = settings.boardBevelPercent / 200;
      endRadiusX = Math.max(0, bevel - inset);
      endRadiusY = endRadiusX;
    }

    const radiusX = Math.min(width / 2, mix(cursorState.circleWidth / 2, endRadiusX, amount));
    const radiusY = Math.min(height / 2, mix(cursorState.circleHeight / 2, endRadiusY, amount));
    const curve = mix(1, endCurve, amount);
    const k = 0.5522847498;
    const directionLength = Math.min(1, Math.hypot(cursorState.trailX, cursorState.trailY));
    const directionX = directionLength ? cursorState.trailX / directionLength : 0;
    const directionY = directionLength ? cursorState.trailY / directionLength : 0;
    const movement = cursorState.trailAmount
      * (1 - amount) * directionLength;
    const extension = settings.boardCursorTrailLengthPx * movement;
    const exponent = mix(1.5, 6, settings.boardCursorTrailTension / 100);
    const deform = (pointX, pointY) => {
      const offsetX = (pointX - centerX) * rect.width / 8;
      const offsetY = (pointY - centerY) * rect.height / 8;
      const distance = Math.hypot(offsetX, offsetY);
      if (!distance || !extension) return [pointX, pointY];
      const unitX = offsetX / distance;
      const unitY = offsetY / distance;
      const trailing = Math.max(0, -(unitX * directionX + unitY * directionY));
      const bulge = extension * trailing ** exponent;
      return [pointX + unitX * bulge / rect.width * 8, pointY + unitY * bulge / rect.height * 8];
    };
    const move = deform(x + radiusX, y);
    const topRight = deform(x + width - radiusX, y);
    const rightLower = deform(x + width, y + height - radiusY);
    const bottomRight = deform(x + width - radiusX, y + height);
    const bottomLeft = deform(x + radiusX, y + height);
    const leftUpper = deform(x, y + radiusY);
    return `M${move[0]} ${move[1]}L${topRight[0]} ${topRight[1]}`
      + curveCorner(x + width - radiusX, y, x + width, y + radiusY,
        [x + width - radiusX + k * radiusX, y], [x + width, y + radiusY - k * radiusY], curve, deform)
      + `L${rightLower[0]} ${rightLower[1]}`
      + curveCorner(x + width, y + height - radiusY, x + width - radiusX, y + height,
        [x + width, y + height - radiusY + k * radiusY], [x + width - radiusX + k * radiusX, y + height], curve, deform)
      + `L${bottomLeft[0]} ${bottomLeft[1]}`
      + curveCorner(x + radiusX, y + height, x, y + height - radiusY,
        [x + radiusX - k * radiusX, y + height], [x, y + height - radiusY + k * radiusY], curve, deform)
      + `L${leftUpper[0]} ${leftUpper[1]}`
      + curveCorner(x, y + radiusY, x + radiusX, y,
        [x, y + radiusY - k * radiusY], [x + radiusX - k * radiusX, y], curve, deform)
      + "Z";
  }

  function render(timestamp) {
    frame = 0;
    if (!activeBoard || !cursorSvg || !cursorState) return;
    const rect = activeBoard.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      clearCursor();
      return;
    }
    const pointerX = (cursorState.clientX - rect.left) / rect.width * 8;
    const pointerY = (cursorState.clientY - rect.top) / rect.height * 8;
    const col = Math.floor(pointerX);
    const row = Math.floor(pointerY);
    if (col < 0 || col > 7 || row < 0 || row > 7) {
      clearCursor();
      return;
    }
    updateFieldTarget(col, row);

    const seconds = Math.min(0.05, lastFrameTime ? (timestamp - lastFrameTime) / 1000 : 1 / 60);
    lastFrameTime = timestamp;
    const speedDecaySeconds = Math.max(0.025, settings.boardCursorResponseMs / 1000 * 0.45);
    cursorState.speed *= Math.exp(-seconds / speedDecaySeconds);
    const speedThreshold = settings.boardCursorSpeedThresholdPxPerSecond;
    const targetMorph = 1 - smoothstep(cursorState.speed / speedThreshold);
    const targetTrailAmount = smoothstep(cursorState.speed / speedThreshold);
    advanceSpring("morph", "vMorph", targetMorph, seconds);
    if (cursorState.morph < 0) {
      cursorState.morph = 0;
      cursorState.vMorph = 0;
    } else if (cursorState.morph > 1) {
      cursorState.morph = 1;
      cursorState.vMorph = 0;
    }
    advanceSpring("fieldX", "vFieldX", cursorState.targetFieldX, seconds);
    advanceSpring("fieldY", "vFieldY", cursorState.targetFieldY, seconds);
    const trailResponseMs = mix(220, 40, settings.boardCursorTrailTension / 100);
    advanceSpring("trailX", "vTrailX", cursorState.targetTrailX, seconds, trailResponseMs);
    advanceSpring("trailY", "vTrailY", cursorState.targetTrailY, seconds, trailResponseMs);
    advanceSpring("trailAmount", "vTrailAmount", targetTrailAmount, seconds,
      Math.max(35, settings.boardCursorResponseMs * 0.55));

    const morph = cursorState.morph;
    const centerX = mix(pointerX, cursorState.fieldX, morph);
    const centerY = mix(pointerY, cursorState.fieldY, morph);
    const circleWidth = settings.boardCursorDiameterPx / rect.width * 8;
    const circleHeight = settings.boardCursorDiameterPx / rect.height * 8;
    cursorState.circleWidth = circleWidth;
    cursorState.circleHeight = circleHeight;
    const inset = settings.boardCursorInsetPercent / 100;
    const width = mix(circleWidth, 1 - inset * 2, morph);
    const height = mix(circleHeight, 1 - inset * 2, morph);
    const path = morphFieldPath(centerX, centerY, width, height, morph, rect);
    for (const node of cursorPaths) node.setAttribute("d", path);

    const settled = cursorState.speed < 1
      && Math.abs(cursorState.morph - targetMorph) < 0.002 && Math.abs(cursorState.vMorph) < 0.01
      && Math.abs(cursorState.targetFieldX - cursorState.fieldX) < 0.002
      && Math.abs(cursorState.targetFieldY - cursorState.fieldY) < 0.002
      && Math.abs(cursorState.vFieldX) < 0.01 && Math.abs(cursorState.vFieldY) < 0.01
      && Math.abs(cursorState.targetTrailX - cursorState.trailX) < 0.002
      && Math.abs(cursorState.targetTrailY - cursorState.trailY) < 0.002
      && Math.abs(cursorState.vTrailX) < 0.01 && Math.abs(cursorState.vTrailY) < 0.01
      && Math.abs(targetTrailAmount - cursorState.trailAmount) < 0.002
      && Math.abs(cursorState.vTrailAmount) < 0.01;
    if (!settled) frame = requestAnimationFrame(render);
    else lastFrameTime = 0;
  }

  function scheduleRender() {
    if (!frame && activeBoard) frame = requestAnimationFrame(render);
  }

  function createCursorState(event) {
    return {
      clientX: event.clientX,
      clientY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastPointerTime: event.timeStamp,
      speed: settings.boardCursorSpeedThresholdPxPerSecond * 1.5,
      morph: 0,
      vMorph: 0,
      circleWidth: 0,
      circleHeight: 0,
      trailX: 0,
      trailY: 0,
      vTrailX: 0,
      vTrailY: 0,
      targetTrailX: 0,
      targetTrailY: 0,
      trailAmount: 0,
      vTrailAmount: 0,
      fieldX: 0,
      fieldY: 0,
      vFieldX: 0,
      vFieldY: 0,
      targetFieldX: 0,
      targetFieldY: 0,
      row: -1,
      col: -1
    };
  }

  function matchesPointer(event, pointerId) {
    return pointerId == null || event.pointerId == null || event.pointerId === pointerId;
  }

  function onPointerDown(event) {
    if (!settings?.enabled || !settings.boardCursorEnabled || ![0, 2].includes(event.button)) return;
    const board = findBoard(event.target);
    const piece = event.target instanceof Element ? event.target.closest("piece") : null;
    if (!board || !piece || !board.contains(piece)) return;
    piecePointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    pieceDragStarted = false;
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch") {
      clearCursor();
      return;
    }
    if (piecePointer && matchesPointer(event, piecePointer.id)) {
      const distance = Math.hypot(event.clientX - piecePointer.x, event.clientY - piecePointer.y);
      if (!pieceDragStarted && distance > 3) {
        pieceDragStarted = true;
        clearCursor();
      }
      if (pieceDragStarted) return;
    }
    if (!settings?.enabled || !settings.boardCursorEnabled) return;
    const board = findBoard(event.target);
    if (!board) {
      if (activeBoard) clearCursor();
      return;
    }
    if (activeBoard !== board) {
      clearCursor();
      createCursor(board);
      cursorState = createCursorState(event);
    } else {
      const elapsedMs = Math.max(1, event.timeStamp - cursorState.lastPointerTime);
      const moveX = event.clientX - cursorState.lastX;
      const moveY = event.clientY - cursorState.lastY;
      const distance = Math.hypot(moveX, moveY);
      const speed = distance / elapsedMs * 1000;
      cursorState.speed = Math.min(10000, speed);
      if (distance > 0) {
        cursorState.targetTrailX = moveX / distance;
        cursorState.targetTrailY = moveY / distance;
      }
      cursorState.clientX = event.clientX;
      cursorState.clientY = event.clientY;
      cursorState.lastX = event.clientX;
      cursorState.lastY = event.clientY;
      cursorState.lastPointerTime = event.timeStamp;
    }
    scheduleRender();
  }

  function onPointerUp(event) {
    if (!piecePointer || !matchesPointer(event, piecePointer.id)) return;
    const wasDragging = pieceDragStarted;
    piecePointer = null;
    pieceDragStarted = false;
    if (wasDragging) onPointerMove(event);
  }

  function onWindowBlur() {
    piecePointer = null;
    pieceDragStarted = false;
    clearCursor();
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("pointerout", event => {
    const board = findBoard(event.target);
    if (board && board === activeBoard && findBoard(event.relatedTarget) !== board) clearCursor();
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearCursor();
  });
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("resize", scheduleRender);
  window.addEventListener("scroll", scheduleRender, true);

  function update(nextSettings) {
    settings = nextSettings;
    const enabled = Boolean(settings.enabled && settings.boardCursorEnabled);
    document.documentElement.toggleAttribute("data-lfs-board-cursor-enabled", enabled);
    if (!enabled) {
      clearCursor();
      return;
    }
    setCursorStyle();
    if (activeBoard) scheduleRender();
  }

  globalThis.LichessBoardCursor = { update };
})();
