(() => {
  const engineArrowLines = '.cg-wrap :is(.cg-shapes, .cg-shapes-below) line[marker-end^="url(#arrowhead-pb"], .cg-wrap :is(.cg-shapes, .cg-shapes-below) line[marker-end^="url(#arrowhead-pg"], .cg-wrap :is(.cg-shapes, .cg-shapes-below) line[marker-end^="url(#arrowhead-pr"]';
  const outlines = new WeakMap();
  const sources = new WeakMap();

  function syncEngineArrowAppearance() {
    const root = document.documentElement;
    if (!root) return;

    const turnColor = window.lichess?.chessground?.()?.state?.turnColor;
    if (turnColor === "white" || turnColor === "black") {
      root.setAttribute("data-lfs-engine-turn-color", turnColor);
    }

    const enabled = root.hasAttribute("data-lfs-engine-arrow-outline");
    const sizeFactor = Math.max(0.5, Math.min(2, Number(root.dataset.lfsEngineArrowHeadSize) / 100 || 1));
    const outlineWidth = (Number(root.dataset.lfsEngineArrowOutlineWidth) || 3) / 100;
    const halfShaft = (Number(root.dataset.lfsEngineArrowShaftWidth) || 36) / 200;
    const rawStartOffset = Number(root.dataset.lfsEngineArrowStartOffset);
    const rawEndOffset = Number(root.dataset.lfsEngineArrowEndOffset);
    const startOffset = (Number.isFinite(rawStartOffset) ? rawStartOffset : 20) / 100;
    const endOffset = (Number.isFinite(rawEndOffset) ? rawEndOffset : 20) / 100;

    for (const path of document.querySelectorAll("[data-lfs-engine-arrow-path]")) {
      const line = sources.get(path);
      if (!enabled || !line?.isConnected || line.parentElement !== path.parentElement) path.remove();
    }
    if (!enabled) return;

    for (const line of document.querySelectorAll(engineArrowLines)) {
      const x1 = Number(line.getAttribute("x1"));
      const y1 = Number(line.getAttribute("y1"));
      const dx = Number(line.getAttribute("x2")) - x1;
      const dy = Number(line.getAttribute("y2")) - y1;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const ux = dx / length;
      const uy = dy / length;
      const start = Math.min(startOffset, length / 4);
      const tip = Math.max(start, length - endOffset);
      const visibleLength = tip - start;
      if (visibleLength <= 0) continue;
      const headLength = Math.min(0.55 * sizeFactor, visibleLength * 0.8);
      const neck = tip - headLength;
      const halfHead = Math.max(0.36 * sizeFactor, halfShaft + outlineWidth);
      const points = [
        [start, halfShaft], [neck, halfShaft], [neck, halfHead], [tip, 0],
        [neck, -halfHead], [neck, -halfShaft], [start, -halfShaft]
      ];
      let path = outlines.get(line);
      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("data-lfs-engine-arrow-path", "");
        outlines.set(line, path);
        sources.set(path, line);
      }
      // One open contour keeps the shaft and arrowhead hollow, without a seam.
      path.setAttribute("d", points.map(([along, across], index) =>
        `${index ? "L" : "M"}${x1 + ux * along - uy * across},${y1 + uy * along + ux * across}`
      ).join(" "));
      path.setAttribute("stroke-width", String(outlineWidth));
      // Pale green marks the best alternative to the previous move, not the current turn.
      const previousMove = /^url\(#arrowhead-pg(?!r)/.test(line.getAttribute("marker-end") || "");
      const arrowColor = previousMove && (turnColor === "white" || turnColor === "black")
        ? (turnColor === "white" ? "black" : "white") : turnColor;
      if (arrowColor === "white" || arrowColor === "black") {
        path.setAttribute("data-lfs-engine-arrow-color", arrowColor);
      } else {
        path.removeAttribute("data-lfs-engine-arrow-color");
      }
      path.setAttribute("opacity", line.getAttribute("opacity") || "1");
      if (path.parentElement !== line.parentElement) line.parentElement.appendChild(path);
    }
  }

  new MutationObserver(records => {
    let needsAppearanceSync = false;
    for (const record of records) {
      if (record.type === "childList") {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (record.target === document || target?.closest(".cg-wrap")) needsAppearanceSync = true;
        continue;
      }

      if (record.target === document.documentElement || record.target.closest?.(".cg-wrap")) {
        needsAppearanceSync = true;
      }
      if (record.attributeName !== "class") continue;
      const piece = record.target;
      if (piece.localName !== "piece" || piece.parentElement?.localName !== "cg-board") continue;

      const key = piece.classList.contains("anim") ? piece.cgKey : null;
      if (typeof key === "string") piece.setAttribute("data-lfs-move-key", key);
      else piece.removeAttribute("data-lfs-move-key");
    }
    if (needsAppearanceSync) syncEngineArrowAppearance();
  }).observe(document, {
    attributes: true,
    attributeFilter: [
      "class",
      "data-lfs-engine-arrow-outline",
      "data-lfs-engine-arrow-outline-width",
      "data-lfs-engine-arrow-head-size",
      "data-lfs-engine-arrow-shaft-width",
      "data-lfs-engine-arrow-start-offset",
      "data-lfs-engine-arrow-end-offset",
      "x1", "y1", "x2", "y2", "marker-end"
    ],
    childList: true,
    subtree: true
  });
  syncEngineArrowAppearance();
})();
