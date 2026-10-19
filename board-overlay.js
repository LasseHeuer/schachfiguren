(() => {
  function getLayer(element) {
    const value = Number.parseInt(getComputedStyle(element).zIndex, 10);
    return Number.isFinite(value) ? value : null;
  }

  function setLayer(svg, layer) {
    if (layer === null) {
      if (svg.style.getPropertyValue("z-index")) svg.style.removeProperty("z-index");
      return;
    }
    const value = String(layer);
    if (svg.style.getPropertyValue("z-index") !== value || svg.style.getPropertyPriority("z-index") !== "important") {
      svg.style.setProperty("z-index", value, "important");
    }
  }

  function precedes(element, reference) {
    return Boolean(element.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function getBoardPoint(board, element, boardRect = board.getBoundingClientRect()) {
    if (!boardRect.width || !boardRect.height) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((rect.left + rect.width / 2 - boardRect.left) / boardRect.width) * 8,
      y: ((rect.top + rect.height / 2 - boardRect.top) / boardRect.height) * 8
    };
  }

  function place(board, svg, layer) {
    const squares = [...board.children].filter(element => element.localName === "square");
    const pieces = [...board.children].filter(element => element.localName === "piece");
    const squareLayers = squares.map(getLayer).filter(value => value !== null);
    const pieceLayers = pieces.map(getLayer).filter(value => value !== null);
    const highestSquareLayer = squareLayers.length ? Math.max(...squareLayers) : null;
    const lowestPieceLayer = pieceLayers.length ? Math.min(...pieceLayers) : null;
    const highestPieceLayer = pieceLayers.length ? Math.max(...pieceLayers) : null;

    svg.dataset.lfsBoardOverlay = layer;
    if (layer === "above-pieces") {
      setLayer(svg, highestPieceLayer === null ? null : highestPieceLayer + 1);
      if (svg.parentNode !== board || pieces.some(piece => !precedes(piece, svg))
        || squares.some(square => !precedes(square, svg))) board.append(svg);
      return svg;
    }

    const betweenLayer = highestSquareLayer === null
      ? lowestPieceLayer === null ? null : lowestPieceLayer - 1
      : lowestPieceLayer === null || lowestPieceLayer <= highestSquareLayer
        ? highestSquareLayer
        : Math.max(highestSquareLayer, lowestPieceLayer - 1);
    setLayer(svg, betweenLayer);
    const firstPiece = pieces[0];
    if (firstPiece && (svg.parentNode !== board || !precedes(svg, firstPiece))) board.insertBefore(svg, firstPiece);
    else if (!firstPiece && (svg.parentNode !== board || squares.some(square => !precedes(square, svg)))) board.append(svg);
    return svg;
  }

  globalThis.LichessBoardOverlay = { getBoardPoint, place };
})();
