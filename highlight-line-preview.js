(() => {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const xlinkNamespace = "http://www.w3.org/1999/xlink";
  let nextPreviewId = 0;

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(svgNamespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function getLineMotion(settings, depth, startedAt, timestamp) {
    const waveInterval = settings.defenseHighlightWaveIntervalMs;
    const startAt = startedAt + (depth - 1) * waveInterval;
    const endAt = startAt + settings.defenseHighlightDurationMs;
    if (timestamp < startAt) return { progress: 0, opacity: 0, finished: false };
    if (timestamp >= endAt || endAt <= startAt) return { progress: 1, opacity: 0, finished: true };
    const linearProgress = (timestamp - startAt) / (endAt - startAt);
    let progress = linearProgress;
    if (settings.highlightLineEaseInPercent || settings.highlightLineEaseOutPercent) {
      const x1 = settings.highlightLineEaseInPercent / 100 * 0.85;
      const x2 = 1 - settings.highlightLineEaseOutPercent / 100 * 0.85;
      let lower = 0;
      let upper = 1;
      let parameter = linearProgress;
      // Invert the time axis of the Bezier curve, just like CSS cubic-bezier().
      for (let iteration = 0; iteration < 20; iteration++) {
        const inverse = 1 - parameter;
        const time = 3 * inverse * inverse * parameter * x1
          + 3 * inverse * parameter * parameter * x2 + parameter ** 3;
        if (Math.abs(time - linearProgress) < 1e-7) break;
        if (time < linearProgress) lower = parameter;
        else upper = parameter;
        parameter = (lower + upper) / 2;
      }
      progress = parameter * parameter * (3 - 2 * parameter);
    }
    return {
      progress,
      opacity: getHighlightMix(linearProgress, depth, settings.highlightLineOpacityPercent, settings.highlightLineDecayPercent),
      finished: false
    };
  }

  function updateLine(line, state, settings, unitScale = 1) {
    const segmentLength = line.length * settings.defenseHighlightLineLengthPercent / 100;
    // Seed the pulse near the source silhouette so easing cannot hide its entrance inside the piece.
    const initialHead = Math.min(line.length * 0.6, Math.max(line.length * 0.12, unitScale * 60));
    const startLength = (line.length + segmentLength - initialHead) * state.progress - segmentLength + initialHead;
    const dx = (line.toX - line.fromX) / line.length;
    const dy = (line.toY - line.fromY) / line.length;
    const styleKey = [segmentLength, settings.defenseHighlightLineWidthPercent,
      settings.defenseHighlightLineBlurPercent, line.color].join(":");
    if (line.styleKey !== styleKey) {
      line.styleKey = styleKey;
      line.path.setAttribute("stroke-width", String(settings.defenseHighlightLineWidthPercent * unitScale));
      // A gap longer than the whole path prevents a second dash from wrapping into view.
      line.path.setAttribute("stroke-dasharray", `${segmentLength} ${line.length + segmentLength + 1}`);
      line.gradient.setAttribute("x1", String(line.fromX));
      line.gradient.setAttribute("y1", String(line.fromY));
      line.gradient.setAttribute("x2", String(line.fromX + dx * segmentLength));
      line.gradient.setAttribute("y2", String(line.fromY + dy * segmentLength));
      const blur = settings.defenseHighlightLineBlurPercent / 100;
      line.stops.forEach((stop, index) => {
        const fraction = index / (line.stops.length - 1);
        const offset = fraction <= 0.5 ? fraction * 2 * blur : 1 - (1 - fraction) * 2 * blur;
        const ramp = Math.min(1, fraction * 2, (1 - fraction) * 2);
        stop.setAttribute("offset", String(offset));
        stop.setAttribute("stop-opacity", String(blur === 0 ? 1 : ramp * ramp * (3 - 2 * ramp)));
        stop.setAttribute("stop-color", line.color);
      });
      line.path.setAttribute("visibility", "visible");
    }
    line.gradient.setAttribute("gradientTransform", `translate(${dx * startLength} ${dy * startLength})`);
    line.path.setAttribute("stroke-dashoffset", String(-startLength));
    line.path.setAttribute("stroke-opacity", String(state.opacity));
  }

  function getHighlightMix(phase, depth, strengthPercent, decayPercent) {
    return Math.sin(Math.PI * phase) * strengthPercent / 100 * Math.pow(1 - decayPercent / 100, depth);
  }

  function mount(container, getSettings, getPieceUrl, getBoardColors = settings => ({
    gap: settings.boardGapLight,
    light: settings.boardLightLight,
    dark: settings.boardDarkLight
  })) {
    if (!container) return () => {};

    const previewId = ++nextPreviewId;
    const svg = createSvgElement("svg", {
      viewBox: "0 0 360 120",
      role: "img",
      "aria-label": "Animierte Highlight-Linien zwischen drei Figuren"
    });
    svg.classList.add("lfs-highlight-line-preview-svg");

    const background = createSvgElement("rect", { x: 0, y: 0, width: 360, height: 120 });
    background.classList.add("lfs-highlight-line-preview-background");
    const definitions = createSvgElement("defs");
    const centers = [60, 180, 300];
    const pieceTypes = ["r", "n", "b"];
    const pieceColors = ["w", "b", "w"];
    const nodes = centers.map((x, depth) => {
      const cell = createSvgElement("rect", { x: depth * 120, y: 0, width: 120, height: 120 });
      cell.classList.add("lfs-highlight-line-preview-cell", `lfs-highlight-line-preview-cell-${depth}`);
      const maskId = `lfs-highlight-line-preview-mask-${previewId}-${depth}`;
      const mask = createSvgElement("mask", {
        id: maskId,
        x: x - 48,
        y: 12,
        width: 96,
        height: 96,
        maskUnits: "userSpaceOnUse",
        "mask-type": "alpha"
      });
      mask.style.maskType = "alpha";
      const maskImage = createSvgElement("image", {
        x: x - 42,
        y: 18,
        width: 84,
        height: 84,
        preserveAspectRatio: "xMidYMid meet"
      });
      mask.append(maskImage);
      definitions.append(mask);
      const maskUrl = `url(#${maskId})`;
      const piece = createSvgElement("rect", {
        x: x - 42,
        y: 18,
        width: 84,
        height: 84,
        mask: maskUrl
      });
      piece.classList.add("lfs-highlight-line-preview-piece");
      const highlight = createSvgElement("rect", {
        x: x - 42,
        y: 18,
        width: 84,
        height: 84,
        fill: "white",
        opacity: 0,
        mask: maskUrl
      });
      return { depth, color: pieceColors[depth], type: pieceTypes[depth], cell, maskImage, piece, highlight };
    });
    const lines = [
      { depth: 1, fromX: 60, fromY: 60, toX: 180, toY: 60 },
      { depth: 2, fromX: 180, fromY: 60, toX: 300, toY: 60 }
    ].map(({ depth, fromX, fromY, toX, toY }) => {
      const gradient = createSvgElement("linearGradient", {
        id: `lfs-highlight-line-preview-${previewId}-${depth}`,
        gradientUnits: "userSpaceOnUse"
      });
      const stops = Array.from({ length: 9 }, () => createSvgElement("stop"));
      gradient.append(...stops);
      definitions.append(gradient);

      const path = createSvgElement("path", {
        d: `M ${fromX} ${fromY} L ${toX} ${toY}`,
        fill: "none",
        stroke: `url(#lfs-highlight-line-preview-${previewId}-${depth})`,
        visibility: "hidden",
        "stroke-linecap": "round"
      });
      path.classList.add("lfs-highlight-line-preview-run");
      return { depth, fromX, fromY, toX, toY, length: Math.hypot(toX - fromX, toY - fromY), gradient, stops, path };
    });

    svg.append(background, definitions, ...nodes.map(node => node.cell), ...lines.map(line => line.path),
      ...nodes.map(node => node.piece), ...nodes.map(node => node.highlight));
    container.replaceChildren(svg);

    let currentPieceSet;
    let visible = !globalThis.IntersectionObserver;
    let frame = 0;
    let disposed = false;
    const startedAt = performance.now();

    function render(timestamp) {
      frame = 0;
      if (disposed) return;
      if (!container.isConnected) {
        dispose();
        return;
      }
      if (!visible || document.hidden) return;

      const settings = getSettings();
      const pieceSet = settings.pieceSet;
      if (pieceSet !== currentPieceSet) {
        currentPieceSet = pieceSet;
        for (const [index, node] of nodes.entries()) {
          const source = getPieceUrl(node.type, node.color, settings);
          node.maskImage.setAttribute("href", source);
          node.maskImage.setAttributeNS(xlinkNamespace, "xlink:href", source);
        }
      }

      const waveInterval = Math.max(0, settings.defenseHighlightWaveIntervalMs);
      const highlightDuration = Math.max(1, settings.defenseHighlightDurationMs);
      const cycleDuration = highlightDuration + 2 * waveInterval + 250;
      const elapsed = (timestamp - startedAt) % cycleDuration;
      const cycleStartedAt = timestamp - elapsed;
      const boardColors = getBoardColors(settings);
      container.style.setProperty("background", boardColors.gap, "important");
      background.setAttribute("fill", boardColors.gap);
      background.style.setProperty("fill", boardColors.gap, "important");
      for (const node of nodes) {
        const phase = (elapsed - node.depth * waveInterval) / highlightDuration;
        const mix = phase < 0 || phase > 1 ? 0
          : getHighlightMix(phase, node.depth, settings.defenseHighlightWhiteMixPercent, settings.defenseHighlightWaveDecayPercent);
        const pieceColor = node.color === "w" ? settings.whitePieceColor : settings.blackPieceColor;
        const tileColor = settings.monochromeBoard ? boardColors.light
          : node.depth % 2 === 0 ? boardColors.light : boardColors.dark;
        node.cell.setAttribute("fill", tileColor);
        node.cell.style.setProperty("fill", tileColor, "important");
        node.cell.setAttribute("stroke", settings.squareOutline ? boardColors.gap : "none");
        node.cell.setAttribute("stroke-width", settings.squareOutline ? "1" : "0");
        node.piece.setAttribute("fill", pieceColor);
        node.highlight.setAttribute("opacity", String(mix));
      }
      for (const line of lines) {
        const state = getLineMotion(settings, line.depth, cycleStartedAt, timestamp);
        line.color = nodes[line.depth].color === "w" ? settings.whitePieceColor : settings.blackPieceColor;
        updateLine(line, state, settings, 1.2);
      }
      frame = requestAnimationFrame(render);
    }

    function schedule() {
      if (!disposed && visible && !document.hidden && !frame) frame = requestAnimationFrame(render);
    }

    function onVisibilityChange() {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        schedule();
      }
    }

    function dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }

    const observer = globalThis.IntersectionObserver
      ? new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        if (visible) schedule();
        else if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      })
      : null;
    observer?.observe(container);
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return dispose;
  }

  globalThis.LichessHighlightLinePreview = { getHighlightMix, getLineMotion, updateLine, mount };
})();
