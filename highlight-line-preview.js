(() => {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const xlinkNamespace = "http://www.w3.org/1999/xlink";
  let nextPreviewId = 0;

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(svgNamespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function getLineMotion(settings, depth, startedAt, timestamp, holdAtEnd = settings.highlightCascadeLinesHoldEnabled,
    wave = depth, startWave = wave - 1) {
    const waveInterval = settings.defenseHighlightWaveIntervalMs;
    const duration = settings.defenseHighlightDurationMs;
    const startAt = startedAt + (holdAtEnd ? startWave : wave) * waveInterval;
    const targetAt = startedAt + wave * waveInterval;
    const travelDuration = holdAtEnd ? targetAt - startAt : duration;
    const endAt = holdAtEnd ? targetAt + duration : startAt + duration;
    if (timestamp < startAt) return { progress: 0, opacity: 0, finished: false };
    if (timestamp >= endAt || endAt <= startAt) return {
      progress: 1,
      opacity: holdAtEnd
        ? getHighlightMix(0.5, depth, settings.highlightLineOpacityPercent, settings.highlightLineDecayPercent)
        : 0,
      finished: true,
      ...(holdAtEnd ? { holding: true } : {})
    };
    const linearProgress = holdAtEnd && travelDuration === 0 ? 1
      : Math.min(1, (timestamp - startAt) / travelDuration);
    let progress = linearProgress;
    if (!holdAtEnd && (settings.highlightLineEaseInPercent || settings.highlightLineEaseOutPercent)) {
      const x1 = settings.highlightLineEaseInPercent / 100 * 0.85;
      const x2 = 1 - settings.highlightLineEaseOutPercent / 100 * 0.85;
      let lower = 0;
      let upper = 1;
      let parameter = linearProgress;
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
    const targetPhase = (timestamp - targetAt) / duration;
    let opacity;
    if (holdAtEnd) {
      const fadeProgress = Math.max(0, Math.min(1, (targetPhase - 0.5) * 2));
      const fadeMix = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
      const finalOpacity = getHighlightMix(0.5, depth, settings.highlightLineOpacityPercent, settings.highlightLineDecayPercent);
      const initialOpacity = settings.highlightLineHoldStartOpacityPercent / 100;
      opacity = initialOpacity + (finalOpacity - initialOpacity) * fadeMix;
    } else {
      opacity = getHighlightMix(linearProgress, depth,
        settings.highlightLineOpacityPercent, settings.highlightLineDecayPercent);
    }
    return {
      progress,
      opacity,
      finished: false,
      ...(holdAtEnd ? { holding: true } : {})
    };
  }

  function updateLine(line, state, settings, unitScale = 1) {
    const segmentLength = line.length * settings.defenseHighlightLineLengthPercent / 100;
    const visibleLength = line.length * state.progress;
    const holding = Boolean(state.holding || line.held);
    const span = state.shrinking || holding ? visibleLength : Math.min(visibleLength, segmentLength);
    const startLength = state.shrinking ? line.length - visibleLength : visibleLength - span;
    const dx = (line.toX - line.fromX) / line.length;
    const dy = (line.toY - line.fromY) / line.length;
    const styleKey = [segmentLength, settings.defenseHighlightLineWidthPercent,
      settings.defenseHighlightLineBlurPercent, line.color, Boolean(state.shrinking), holding].join(":");
    if (line.styleKey !== styleKey) {
      line.styleKey = styleKey;
      line.path.setAttribute("stroke-width", String(settings.defenseHighlightLineWidthPercent * unitScale));
      const fadeLength = segmentLength * settings.defenseHighlightLineBlurPercent / 50;
      const fadeRatio = settings.defenseHighlightLineBlurPercent / 100;
      line.gradient.setAttribute("x1", "0");
      line.gradient.setAttribute("y1", "0");
      line.gradient.setAttribute("x2", "1");
      line.gradient.setAttribute("y2", "0");
      const edgeSteps = Math.floor((line.stops.length - 1) / 2);
      line.stops.forEach((stop, index) => {
        if (holding) {
          const fraction = index / (line.stops.length - 1);
          const fadeStart = fadeLength === 0 ? 1 : Math.max(0, 1 - fadeLength / line.length);
          const progress = state.shrinking ? Math.min(1, fraction / (1 - fadeStart || 1))
            : Math.min(1, (1 - fraction) / (1 - fadeStart || 1));
          stop.setAttribute("offset", String(fraction));
          stop.setAttribute("stop-opacity", String(fadeLength === 0 ? 1 : progress * progress * (3 - 2 * progress)));
          stop.setAttribute("stop-color", line.color);
          return;
        }
        const fadeProgress = Math.min(1, Math.min(index, line.stops.length - 1 - index) / edgeSteps);
        const offset = index <= edgeSteps ? index / edgeSteps * fadeRatio
          : 1 - (line.stops.length - 1 - index) / edgeSteps * fadeRatio;
        const easedFade = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
        stop.setAttribute("offset", String(offset));
        stop.setAttribute("stop-opacity", String(fadeRatio === 0 ? 1 : easedFade));
        stop.setAttribute("stop-color", line.color);
      });
    }
    const fadeLength = segmentLength * settings.defenseHighlightLineBlurPercent / 50;
    const gradientLength = Math.max(holding ? fadeLength : span, 0.000001);
    const gradientStart = holding
      ? state.shrinking ? line.length - visibleLength : Math.max(0, visibleLength - fadeLength)
      : startLength;
    line.gradient.setAttribute("gradientTransform", `matrix(${dx * gradientLength} ${dy * gradientLength} ${-dy} ${dx} ${line.fromX + dx * gradientStart} ${line.fromY + dy * gradientStart})`);
    line.path.setAttribute("stroke-dasharray", span >= line.length ? "none" : `${span} ${line.length + 1}`);
    line.path.setAttribute("stroke-dashoffset", String(-startLength));
    line.path.setAttribute("stroke-opacity", String(state.opacity));
    const visible = state.opacity > 0;
    if (line.visible !== visible) {
      line.visible = visible;
      line.path.setAttribute("visibility", String(visible ? "visible" : "hidden"));
    }
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
      viewBox: "0 0 300 90",
      role: "img",
      "aria-label": "Animierte Highlight-Linien zwischen drei Figuren"
    });
    svg.classList.add("lfs-highlight-line-preview-svg");

    const background = createSvgElement("rect", { x: 0, y: 0, width: 300, height: 90 });
    background.classList.add("lfs-highlight-line-preview-background");
    const definitions = createSvgElement("defs");
    const centers = [50, 150, 250];
    const pieceTypes = ["r", "n", "b"];
    const pieceColors = ["w", "b", "w"];
    const nodes = centers.map((x, depth) => {
      const cell = createSvgElement("rect", { x: depth * 100, y: 0, width: 100, height: 90 });
      cell.classList.add("lfs-highlight-line-preview-cell", `lfs-highlight-line-preview-cell-${depth}`);
      const maskId = `lfs-highlight-line-preview-mask-${previewId}-${depth}`;
      const mask = createSvgElement("mask", {
        id: maskId,
        x: x - 40,
        y: 5,
        width: 80,
        height: 80,
        maskUnits: "userSpaceOnUse",
        "mask-type": "alpha"
      });
      mask.style.maskType = "alpha";
      const maskImage = createSvgElement("image", {
        x: x - 35,
        y: 10,
        width: 70,
        height: 70,
        preserveAspectRatio: "xMidYMid meet"
      });
      mask.append(maskImage);
      definitions.append(mask);
      const maskUrl = `url(#${maskId})`;
      const piece = createSvgElement("rect", {
        x: x - 35,
        y: 10,
        width: 70,
        height: 70,
        mask: maskUrl
      });
      piece.classList.add("lfs-highlight-line-preview-piece");
      const highlight = createSvgElement("rect", {
        x: x - 35,
        y: 10,
        width: 70,
        height: 70,
        fill: "white",
        opacity: 0,
        mask: maskUrl
      });
      return { depth, color: pieceColors[depth], type: pieceTypes[depth], cell, maskImage, piece, highlight };
    });
    const lines = [
      { depth: 1, fromX: 50, fromY: 45, toX: 150, toY: 45 },
      { depth: 2, fromX: 150, fromY: 45, toX: 250, toY: 45 }
    ].map(({ depth, fromX, fromY, toX, toY }) => {
      const gradient = createSvgElement("linearGradient", {
        id: `lfs-highlight-line-preview-${previewId}-${depth}`,
        gradientUnits: "userSpaceOnUse"
      });
      const stops = Array.from({ length: 10 }, () => createSvgElement("stop"));
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
    let startedAt = 0;
    let animationEndsAt = 0;
    let lastGapColor;

    function clearPreview() {
      for (const node of nodes) node.highlight.setAttribute("opacity", "0");
      for (const line of lines) {
        line.path.setAttribute("stroke-opacity", "0");
        line.path.setAttribute("visibility", "hidden");
        line.visible = false;
      }
    }

    function render(timestamp, initial = false) {
      frame = 0;
      if (disposed) return;
      if (!container.isConnected) {
        dispose();
        return;
      }
      if (!initial && (!visible || document.hidden)) return;

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
      const elapsed = timestamp - startedAt;
      const boardColors = getBoardColors(settings);
      if (boardColors.gap !== lastGapColor) {
        lastGapColor = boardColors.gap;
        container.style.setProperty("background", boardColors.gap, "important");
        background.setAttribute("fill", boardColors.gap);
        background.style.setProperty("fill", boardColors.gap, "important");
      }
      for (const node of nodes) {
        const phase = (elapsed - node.depth * waveInterval) / highlightDuration;
        const mix = phase < 0 || phase > 1 ? 0
          : getHighlightMix(phase, node.depth, settings.defenseHighlightWhiteMixPercent, settings.defenseHighlightWaveDecayPercent);
        const pieceColor = node.color === "w" ? settings.whitePieceColor : settings.blackPieceColor;
        const tileColor = settings.monochromeBoard ? boardColors.light
          : node.depth % 2 === 0 ? boardColors.light : boardColors.dark;
        if (node.tileColor !== tileColor) {
          node.tileColor = tileColor;
          node.cell.setAttribute("fill", tileColor);
          node.cell.style.setProperty("fill", tileColor, "important");
        }
        const outlineColor = settings.squareOutline ? boardColors.gap : "none";
        const outlineWidth = settings.squareOutline ? "1" : "0";
        if (node.outlineColor !== outlineColor) {
          node.outlineColor = outlineColor;
          node.cell.setAttribute("stroke", outlineColor);
        }
        if (node.outlineWidth !== outlineWidth) {
          node.outlineWidth = outlineWidth;
          node.cell.setAttribute("stroke-width", outlineWidth);
        }
        if (node.pieceColor !== pieceColor) {
          node.pieceColor = pieceColor;
          node.piece.setAttribute("fill", pieceColor);
        }
        node.highlight.setAttribute("opacity", String(mix));
      }
      for (const line of lines) {
        const state = getLineMotion(settings, line.depth, startedAt, timestamp);
        line.color = nodes[line.depth].color === "w" ? settings.whitePieceColor : settings.blackPieceColor;
        updateLine(line, state, settings, 1.2);
      }
      if (timestamp < animationEndsAt) frame = requestAnimationFrame(render);
      else {
        frame = 0;
        animationEndsAt = 0;
        clearPreview();
      }
    }

    function schedule() {
      if (!disposed && visible && !document.hidden && animationEndsAt && !frame) frame = requestAnimationFrame(render);
    }

    function onVisibilityChange() {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        animationEndsAt = 0;
        clearPreview();
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
          animationEndsAt = 0;
          clearPreview();
        }
      })
      : null;
    render(performance.now(), true);
    clearPreview();
    observer?.observe(container);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return {
      play() {
        if (disposed) return;
        const settings = getSettings();
        startedAt = performance.now();
        animationEndsAt = startedAt + settings.defenseHighlightDurationMs
          + 2 * settings.defenseHighlightWaveIntervalMs;
        clearPreview();
        schedule();
      },
      dispose
    };
  }

  globalThis.LichessHighlightLinePreview = { getHighlightMix, getLineMotion, updateLine, mount };
})();
