const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./colors.js");
require("./settings.js");
require("./threat-coding.js");
require("./highlight-line-preview.js");
const colors = globalThis.LichessColors;
const settings = globalThis.LichessSettings;
const threats = globalThis.LichessThreatCoding;

test("promotion preview cycles through promotion pieces at its configured interval", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    document: { addEventListener() {} },
    LichessSettings: settings,
    chrome: { runtime: { getURL: path => path } },
    setInterval(callback, interval) {
      const id = ++nextTimer;
      timers.set(id, { callback, interval });
      return id;
    },
    clearInterval: id => timers.delete(id)
  });
  const source = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  const marker = "  documentObserver = new MutationObserver";
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker, `
    globalThis.testing = { updatePromotionPreview, configure(value) { settings = value; } };
    return;
${marker}`), context);
  const api = context.testing;
  const options = settings.normalize({ pieceSet: "system_eckig", promotionPreviewIntervalMs: 320 });
  api.configure(options);
  const image = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const entry = { previewPieceImage: image };
  const sourceSquare = { row: 1, col: 4 };
  const targetSquare = { row: 0, col: 4 };

  assert.equal(api.updatePromotionPreview(entry, "w", "wP", sourceSquare, targetSquare, true), "Q");
  assert.equal([...timers.values()][0].interval, 320);
  for (const expected of ["R", "B", "N", "Q"]) {
    [...timers.values()][0].callback();
    assert.equal(api.updatePromotionPreview(entry, "w", "wP", sourceSquare, targetSquare, true), expected);
  }
  assert.equal(image.attributes.href, "system_eckig/wq.svg");
  assert.equal(api.updatePromotionPreview(entry, "w", "wN", sourceSquare, targetSquare, true), null);
  assert.equal(timers.size, 0);
  assert.equal(settings.normalize({ promotionPreviewIntervalMs: 5000 }).promotionPreviewIntervalMs, 2000);
});

test("threat wedges point at the piece and share line placement in both display roles", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const element = (_, tag) => ({
    tag, attributes: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    append(child) { this.children.push(child); }
  });
  const context = vm.createContext({ document: { addEventListener() {}, createElementNS: element } });
  const source = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  vm.runInContext(source.replace("  documentObserver = new MutationObserver", `
    getFigureRadii = () => new Map([["pawn", Array(720).fill(0.2)]]);
    globalThis.testing = { renderThreatSegmentsInto, configure(value) { settings = value; } };
    return;
    documentObserver = new MutationObserver`), context);
  const api = context.testing;
  const options = settings.normalize({ threatAttackDisplayMode: "wedge", threatDefenseDisplayMode: "wedge" });
  assert.equal(options.threatAttackDisplayMode, "wedge");
  assert.equal(options.threatDefenseDisplayMode, "wedge");
  const clamped = settings.normalize({ threatWedgeLengthPercent: -5, threatWedgeWidthPercent: 200 });
  assert.equal(clamped.threatWedgeLengthPercent, 1);
  assert.equal(clamped.threatWedgeWidthPercent, 30);
  const points = polygon => polygon.attributes.points.split(" ").map(point => point.split(",").map(Number));
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    api.configure(options);
    const segment = { target: { row: 3, col: 3 }, type: "pawn", angle, color: "#20cc60" };
    for (const role of ["attack", "defense"]) {
      const attacks = role === "attack" ? [segment] : [];
      const defenses = role === "defense" ? [segment] : [];
      const lines = element();
      api.renderThreatSegmentsInto(lines, attacks, defenses, "lines", "lines");
      const wedges = element();
      api.renderThreatSegmentsInto(wedges, attacks, defenses, "wedge", "wedge");
      assert.equal(wedges.children.length, 1);
      const triangle = wedges.children[0];
      assert.equal(triangle.tag, "polygon");
      assert.equal(triangle.attributes.fill, segment.color);
      const [tip, left, right] = points(triangle);
      const line = lines.children[0].attributes;
      close(tip[0], Number(line.x2));
      close(tip[1], Number(line.y2));
      close((left[0] + right[0]) / 2, Number(line.x1));
      close((left[1] + right[1]) / 2, Number(line.y1));
      close(Math.hypot(left[0] - right[0], left[1] - right[1]), 0.1);
    }
  }
  const segment = { target: { row: 3, col: 3 }, type: "pawn", angle: 0, color: "#20cc60", sourceType: "knight" };
  for (const length of [1, 8, 30]) {
    api.configure(settings.normalize({ ...options, threatWedgeLengthPercent: length, threatWedgeWidthPercent: 18 }));
    const svg = element();
    api.renderThreatSegmentsInto(svg, [segment], [], "wedge", "lines");
    const [tip, left, right] = points(svg.children[0]);
    close((left[0] + right[0]) / 2 - tip[0], length / 100);
    close(Math.hypot(left[0] - right[0], left[1] - right[1]), 0.18);
  }
  api.configure(options);
  const lines = element();
  const mixed = element();
  api.renderThreatSegmentsInto(lines, [{ ...segment, sourceType: "rook" }], [segment], "lines", "lines");
  api.renderThreatSegmentsInto(mixed, [segment], [segment], "wedge", "lines");
  assert.equal(mixed.children.length, 2);
  close(points(mixed.children[0])[0][1], Number(lines.children[0].attributes.y2));
  assert.equal(mixed.children[1].tag, "path");
});

test("empty move-field attacks and defenses share their configured radius in every display mode", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const element = (_, tag) => ({
    tag, attributes: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    append(child) { this.children.push(child); }
  });
  const context = vm.createContext({ document: { addEventListener() {}, createElementNS: element } });
  const source = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  vm.runInContext(source.replace("  documentObserver = new MutationObserver", `
    getFigureRadii = () => new Map([["pawn", Array(720).fill(0.2)]]);
    globalThis.testing = { renderThreatSegmentsInto, advanceFigureBlends, configure(value) { settings = value; } };
    return;
    documentObserver = new MutationObserver`), context);
  const api = context.testing;
  const options = settings.normalize({ threatMoveFieldRadius: 0.42, threatSquareCornerRadiusPercent: 50 });
  api.configure(options);
  const segment = {
    target: { row: 3, col: 3 }, source: { row: 3, col: 4 }, angle: 0,
    type: "pawn", color: "#20cc60", figureBlend: 0, moveFieldRadius: 0.42
  };
  const expectedRadii = {
    lines: 0.42 + options.threatLineLength,
    wedge: 0.42 + options.threatWedgeLengthPercent / 100,
    segments: 0.42 + options.threatArcThickness,
    square: 0.42 + options.threatSquareThickness / 2
  };
  const blendEntry = { figureBlends: new Map() };
  assert.equal(api.advanceFigureBlends(blendEntry, "3,3"), true);
  assert.equal(blendEntry.figureBlends.get("3,3"), 0, "the configured radius is rendered before the figure arrives");
  while (api.advanceFigureBlends(blendEntry, "3,3")) {}
  assert.equal(blendEntry.figureBlends.get("3,3"), 1, "the line radius animates to the figure clearance");
  for (const [mode, expectedRadius] of Object.entries(expectedRadii)) for (const role of ["attack", "defense"]) {
    const svg = element();
    const endpoints = api.renderThreatSegmentsInto(svg,
      role === "attack" ? [segment] : [], role === "defense" ? [segment] : [], mode, mode);
    const point = endpoints.get("3,3:3,4");
    assert.ok(point, `${role} ${mode} should expose its rendered endpoint`);
    assert.ok(Math.abs(Math.hypot(point.x - 3.5, point.y - 3.5) - expectedRadius) < 1e-9,
      `${role} ${mode} endpoint should use the shared radius`);
  }
});

test("king move fields do not show defense lines or wedges", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const context = vm.createContext({ document: { addEventListener() {} } });
  const source = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  vm.runInContext(source.replace("  documentObserver = new MutationObserver", `
    getScreenSquare = square => square;
    globalThis.testing = { getMoveDestinationLines, configure(value) { settings = value; } };
    return;
    documentObserver = new MutationObserver`), context);
  const api = context.testing;
  const target = { row: 3, col: 4, setAttribute() {} };
  const board = { querySelectorAll: () => [target] };
  const positionFor = type => {
    const position = Array.from({ length: 8 }, () => Array(8).fill(null));
    position[4][4] = { color: "w", type };
    position[7][4] = { color: "w", type: "rook" };
    return position;
  };
  api.configure(settings.normalize({ defenseCirclesEnabled: true, threatMoveFieldDisplayMode: "lines" }));

  const kingMove = api.getMoveDestinationLines(board, positionFor("king"), { row: 4, col: 4 }, false);
  assert.equal(kingMove.defenseSegments.length, 0);
  assert.equal(kingMove.targetKeys.size, 0);

  const queenMove = api.getMoveDestinationLines(board, positionFor("queen"), { row: 4, col: 4 }, false);
  assert.equal(queenMove.defenseSegments.length, 1, "other pieces still show defended move fields");
  assert.deepEqual([...queenMove.targetKeys], ["3,4"]);
});

test("highlight lines meet the rendered markers in either animation direction", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const element = (_, tag) => ({
    tag, attributes: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    append(child) { this.children.push(child); }
  });
  const context = vm.createContext({
    document: { addEventListener() {}, createElementNS: element }, performance: { now: () => 500 },
    LichessHighlightLinePreview: globalThis.LichessHighlightLinePreview
  });
  vm.runInContext(readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8")
    .replace("  documentObserver = new MutationObserver", `
      getFigureRadii = () => new Map([["pawn", Array(720).fill(0.2)]]);
      globalThis.testing = { renderThreatSegmentsInto, syncHighlightLineEndpoints, configure(value) { settings = value; } };
      return;
      documentObserver = new MutationObserver`), context);
  const api = context.testing;
  const root = { row: 3, col: 3 };
  const source = { row: 3, col: 6 };
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
  for (const mode of ["lines", "wedge", "segments", "square"]) for (const reverse of [false, true]) {
    for (const sourceType of ["rook", "knight"]) {
      api.configure(settings.normalize({ highlightCascadeLinesHoldEnabled: true }));
      const svg = element();
      const marker = { target: root, source, type: "pawn", angle: 0, color: "#20cc60", sourceType };
      const endpoints = api.renderThreatSegmentsInto(svg, [marker], [], mode, "lines");
      const drawn = svg.children[0];
      let expected;
      if (mode === "wedge") {
        const [, left, right] = drawn.attributes.points.split(" ").map(point => point.split(",").map(Number));
        expected = { x: (left[0] + right[0]) / 2, y: (left[1] + right[1]) / 2 };
      } else if (mode === "segments") {
        const [, radius] = /A ([\d.e+-]+)/.exec(drawn.attributes.d);
        expected = { x: root.col + 0.5 + Number(radius), y: root.row + 0.5 };
      } else if (mode === "square") {
        const points = [...drawn.attributes.d.matchAll(/[ML] ([\d.e+-]+) ([\d.e+-]+)/g)];
        expected = { x: root.col + 0.5 + Number(points[0][1]), y: root.row + 0.5 };
      } else if (sourceType === "knight") {
        const [, x, y] = /^M ([\d.e+-]+) ([\d.e+-]+)/.exec(drawn.attributes.d);
        expected = { x: Number(x), y: Number(y) };
      } else expected = { x: Number(drawn.attributes.x1), y: Number(drawn.attributes.y1) };
      const [startSquare, endSquare] = reverse ? [source, root] : [root, source];
      const line = {
        path: element(), gradient: element(), stops: Array.from({ length: 10 }, element), color: marker.color,
        depth: 1, wave: 1, held: true, startSquare, endSquare,
        fromX: startSquare.col + 0.5, fromY: startSquare.row + 0.5,
        toX: endSquare.col + 0.5, toY: endSquare.row + 0.5, length: 3
      };
      const entry = { highlightLineEndpoints: endpoints,
        defenseHighlightRuns: [{ lines: [line], startedAt: 0, maxDepth: 1, reverse, holding: true }] };
      api.syncHighlightLineEndpoints(entry);
      close(reverse ? line.toX : line.fromX, expected.x);
      close(reverse ? line.toY : line.fromY, expected.y);
      close(reverse ? line.fromX : line.toX, source.col + 0.5);
      close(line.length, Math.hypot(line.toX - line.fromX, line.toY - line.fromY));
      assert.ok(line.length < 3);
      assert.equal(line.path.attributes["stroke-linecap"], "butt");
      assert.ok(!line.gradient.attributes.gradientTransform.includes("NaN"));
      const geometry = () => JSON.stringify({
        fromX: line.fromX, fromY: line.fromY, toX: line.toX, toY: line.toY, length: line.length,
        path: line.path.attributes, gradient: line.gradient.attributes
      });
      const previousGeometry = geometry();
      entry.highlightLineEndpoints = null;
      const run = entry.defenseHighlightRuns[0];
      run.retiring = true;
      run.waitingForReplacement = true;
      api.syncHighlightLineEndpoints(entry);
      assert.equal(geometry(), previousGeometry, "held lines retain their geometry while waiting for a new hover preview");
      run.retiring = false;
      run.waitingForReplacement = false;
      line.fadeOut = { startedAt: 400, opacity: 1, progress: 1, duration: 180, reverse: true };
      api.syncHighlightLineEndpoints(entry);
      assert.equal(geometry(), previousGeometry, "fading lines must not extend to the center when their marker disappears");
      entry.highlightLineEndpoints = new Map([[`${root.row},${root.col}:${source.row},${source.col}`, { x: 4.2, y: 3.8 }]]);
      api.syncHighlightLineEndpoints(entry);
      assert.equal(geometry(), previousGeometry, "a replacement preview must not move fading lines");
      delete line.fadeOut;
      entry.highlightLineEndpoints = null;
      api.syncHighlightLineEndpoints(entry);
      close(line.fromX, startSquare.col + 0.5);
      close(line.toX, endSquare.col + 0.5);
      close(line.length, 3);
      assert.equal(line.path.attributes["stroke-linecap"], "round");
    }
  }
  for (const attackMode of ["lines", "wedge", "segments", "square"]) {
    for (const defenseMode of ["lines", "wedge", "segments", "square"]) for (const reverse of [false, true]) {
      api.configure(settings.normalize({ highlightCascadeLinesHoldEnabled: true }));
      const marker = { target: root, source, type: "pawn", angle: 0, color: "#20cc60", sourceType: "rook" };
      const endpoints = api.renderThreatSegmentsInto(element(), [marker],
        [{ ...marker, target: source, source: root, angle: Math.PI }], attackMode, defenseMode);
      const [startSquare, endSquare] = reverse ? [source, root] : [root, source];
      const line = {
        path: element(), gradient: element(), stops: Array.from({ length: 10 }, element), color: marker.color,
        depth: 1, wave: 1, held: true, startSquare, endSquare,
        fromX: startSquare.col + 0.5, fromY: startSquare.row + 0.5,
        toX: endSquare.col + 0.5, toY: endSquare.row + 0.5, length: 3
      };
      api.syncHighlightLineEndpoints({ highlightLineEndpoints: endpoints,
        defenseHighlightRuns: [{ lines: [line], startedAt: 0, maxDepth: 1, reverse, holding: true }] });
      const from = endpoints.get(`${startSquare.row},${startSquare.col}:${endSquare.row},${endSquare.col}`);
      const to = endpoints.get(`${endSquare.row},${endSquare.col}:${startSquare.row},${startSquare.col}`);
      assert.ok(from && to, `${attackMode}/${defenseMode} supplies both ends`);
      close(line.fromX, from.x);
      close(line.fromY, from.y);
      close(line.toX, to.x);
      close(line.toY, to.y);
      close(line.length, Math.hypot(to.x - from.x, to.y - from.y));
      assert.ok(line.length > 0 && line.length < 3);
    }
  }
});

test("segment highlight endpoints stay on rendered geometry across directions, lanes and mixed display roles", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const element = (_, tag) => ({
    tag, attributes: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    append(child) { this.children.push(child); }
  });
  const context = vm.createContext({ document: { addEventListener() {}, createElementNS: element } });
  vm.runInContext(readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8")
    .replace("  documentObserver = new MutationObserver", `
      getFigureRadii = () => new Map([["pawn", Array(720).fill(0.65)]]);
      globalThis.testing = { renderThreatSegmentsInto, configure(value) { settings = value; } };
      return;
      documentObserver = new MutationObserver`), context);
  const api = context.testing;
  const target = { row: 3, col: 3 };
  const modes = ["segments", "square", "lines", "wedge"];
  let clampedEndpoints = 0;
  for (const mode of ["segments", "square"]) for (const otherMode of modes) {
    for (const role of ["attack", "defense"]) for (const cornerRadius of [0, 6, 50]) {
      api.configure(settings.normalize({
        threatSquareCornerRadiusPercent: cornerRadius, threatSquareRadialGapPercent: 100,
        threatArcRadialGapPercent: 200, threatSquareThickness: 0.08, threatArcThickness: 0.08
      }));
      const directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
        [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]];
      for (const [dx, dy] of directions) for (const figureBlend of [0, 0.5, 1]) {
        const angle = Math.atan2(dy, dx);
        const segments = Array.from({ length: 4 }, (_, lane) => ({
          target, source: { row: target.row + dy * (lane + 1), col: target.col + dx * (lane + 1) },
          type: "pawn", sourceType: Math.abs(dx * dy) === 2 ? "knight" : "queen",
          angle, color: "#20cc60", figureBlend
        }));
        // This neighbour shortens only one side, shifting outer square lanes away from the source ray.
        const neighbour = { ...segments[0], source: undefined, angle: angle + 0.12 };
        const other = { ...segments[0], target: { row: 6, col: 6 }, source: { row: 6, col: 7 }, angle: 0 };
        const svg = element();
        const own = [...segments, neighbour];
        const endpoints = api.renderThreatSegmentsInto(svg,
          role === "attack" ? own : [other], role === "attack" ? [other] : own,
          role === "attack" ? mode : otherMode, role === "attack" ? otherMode : mode);
        const drawn = svg.children.filter(child => child.attributes.d && !child.attributes.d.includes(" Q "));
        const ownPaths = role === "attack" ? drawn.slice(0, 4) : drawn.slice(-5, -1);
        assert.equal(ownPaths.length, 4);
        for (const [index, segment] of segments.entries()) {
          const point = endpoints.get(`3,3:${segment.source.row},${segment.source.col}`);
          assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y));
          const x = point.x - 3.5;
          const y = point.y - 3.5;
          const path = ownPaths[index].attributes.d;
          if (mode === "segments") {
            const radius = Number(/A ([\d.e+-]+)/.exec(path)[1]);
            assert.ok(Math.abs(Math.hypot(x, y) - radius) < 1e-9);
            assert.ok(Math.abs(x * Math.sin(angle) - y * Math.cos(angle)) < 1e-9);
          } else {
            const points = [...path.matchAll(/[ML] ([\d.e+-]+) ([\d.e+-]+)/g)]
              .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
            let closest = Infinity;
            for (let i = 1; i < points.length; i++) {
              const a = points[i - 1];
              const b = points[i];
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const fraction = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
              closest = Math.min(closest, Math.hypot(x - a.x - fraction * dx, y - a.y - fraction * dy));
            }
            assert.ok(closest < 1e-9, JSON.stringify({ role, otherMode, cornerRadius, angle, index, closest }));
            if (Math.abs(x * Math.sin(angle) - y * Math.cos(angle)) > 1e-6) clampedEndpoints++;
          }
        }
        assert.ok(endpoints.has("6,6:6,7"), "the other display role also supplies its endpoint");
        assert.equal(endpoints.size, 5, "markers without a source must not create highlight connections");
      }
    }
  }
  assert.ok(clampedEndpoints > 0, "asymmetric outer lanes exercise endpoint clamping");
});

test("System Rund shares existing SVG assets for both piece colors", () => {
  const { existsSync } = require("node:fs");
  const { join } = require("node:path");
  for (const complexPawn of [false, true]) {
    const options = settings.normalize({ pieceSet: "system_rund", complexPawn });
    assert.equal(options.pieceSet, "system_rund");
    for (const letter of ["p", "n", "b", "r", "q", "k"]) {
      const asset = settings.getPieceAsset(options, "w", letter);
      assert.equal(asset, settings.getPieceAsset(options, "b", letter));
      assert.ok(existsSync(join(__dirname, asset)), asset);
    }
    assert.equal(settings.getPieceAsset(options, "w", "p"), "system_rund/bp_2.svg");
  }
  for (const pieceSet of ["system_pixel", "system_eckig", "rund", "rund_comic", "cage"]) {
    for (const color of ["w", "b"]) for (const complexPawn of [false, true]) {
      for (const letter of ["p", "n", "b", "r", "q", "k"]) {
        if (pieceSet === "cage" && letter === "k") continue;
        const options = settings.normalize({ pieceSet, complexPawn });
        const suffix = complexPawn && letter === "p" && pieceSet.startsWith("system_") ? "_2" : "";
        const expected = pieceSet === "cage" ? `cage/cage_${letter}.svg` : `${pieceSet}/${color}${letter}${suffix}.svg`;
        assert.equal(settings.getPieceAsset(options, color, letter), expected);
      }
    }
  }
});

test("round king movement sectors follow blocked directions and board orientation", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const element = () => ({
    attributes: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    classList: { add() {} },
    querySelector() { return null; },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; }
  });
  const context = vm.createContext({ document: { addEventListener() {}, createElementNS: element } });
  const source = readFileSync(join(__dirname, "king-movement-fields.js"), "utf8");
  vm.runInContext(source.replace("  globalThis.LichessKingMovementFields = {", `
    globalThis.testing = { fillOverlay, getDestinationState, renderPreview, configure(value) { settings = value; } };
    globalThis.LichessKingMovementFields = {`), context);
  const api = context.testing;
  const position = Array.from({ length: 8 }, () => Array(8).fill(""));
  const king = { row: 4, col: 4, color: "w" };
  position[4][4] = "wK";
  position[3][4] = "wP";
  for (const blackOrientation of [false, true]) {
    api.configure(settings.normalize({ pieceSet: "system_rund" }));
    const svg = element();
    api.fillOverlay(svg, position, king, blackOrientation);
    const path = svg.children[0].attributes;
    assert.equal(path["shape-rendering"], "geometricPrecision");
    assert.equal((path.d.match(/A/g) ?? []).length, 1);
    const coordinates = /^M0.5 0.5L([\d.e+-]+) ([\d.e+-]+)A([\d.e+-]+)/.exec(path.d);
    assert.ok(coordinates);
    const [, x, y, radius] = coordinates.map(Number);
    assert.ok(Math.abs(Math.hypot(x - 0.5, y - 0.5) - 5 / 14) < 1e-12);
    assert.ok(Math.abs(radius - 5 / 14) < 1e-12);
    assert.equal(y > 0.5, blackOrientation);
  }
  api.configure(settings.normalize({ pieceSet: "system_eckig" }));
  const squareSvg = element();
  api.fillOverlay(squareSvg, position, king, false);
  assert.equal(squareSvg.children[0].attributes.d, "M0.38 0.14H0.62V0.38H0.38Z");
  assert.equal(squareSvg.children[0].attributes["shape-rendering"], "crispEdges");
  const previewPosition = Array.from({ length: 8 }, () => Array(8).fill(""));
  previewPosition[3][3] = "wK";
  previewPosition[2][3] = "wP";
  const previewGroup = element();
  api.renderPreview(previewGroup, {
    position: previewPosition,
    source: { row: 4, col: 4 },
    target: { row: 3, col: 3 },
    blackOrientation: false
  }, "preview-highlight");
  assert.equal(previewGroup.children[0].attributes.x, "4");
  assert.equal(previewGroup.children[0].attributes.y, "4");
  assert.equal(previewGroup.children[0].attributes.filter, "url(#preview-highlight)");
  assert.equal(previewGroup.children[0].children[0].attributes.fill, settings.normalize({ pieceSet: "system_eckig" }).whitePieceColor);
  api.configure(settings.normalize({ pieceSet: "system_rund" }));
  position[3][4] = "";
  const emptySvg = element();
  api.fillOverlay(emptySvg, position, king, false);
  assert.equal(emptySvg.children.length, 0);
  position[0][0] = "wK";
  position[4][4] = "";
  const cornerSvg = element();
  api.fillOverlay(cornerSvg, position, { row: 0, col: 0, color: "w" }, false);
  assert.equal((cornerSvg.children[0].attributes.d.match(/A/g) ?? []).length, 5);
  position[4][0] = "bR";
  assert.equal(api.getDestinationState(position, { row: 0, col: 0, color: "w" }, { row: 1, col: 0 }), "threat");
  api.fillOverlay(cornerSvg, position, { row: 0, col: 0, color: "w" }, false);
  assert.equal((cornerSvg.children[0].attributes.d.match(/A/g) ?? []).length, 6);
});

test("preview filters respect custom piece colors and System Rund uses a circular inner cage", async () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const assets = [];
  const element = () => ({
    attributes: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    append(...children) { this.children.push(...children); },
    insertBefore(child) { this.children.unshift(child); }
  });
  const context = vm.createContext({
    document: { addEventListener() {}, createElementNS: element },
    chrome: { runtime: { getURL: asset => asset } },
    LichessSettings: settings,
    fetch: async asset => { assets.push(asset); return { text: async () => "pawn" }; }
  });
  const source = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  vm.runInContext(source.replace("  documentObserver = new MutationObserver", `
    measureOutlineRadii = () => Array(720).fill(0.2);
    globalThis.cageBounds = [];
    const originalClearance = getLineFigureClearance;
    getLineFigureClearance = (...args) => { cageBounds.push(args[5]); return originalClearance(...args); };
    globalThis.testing = { getFigureRadii, getLineFigureClearance, renderLineSet, syncPreviewDefenseFilter,
      configure(value) { settings = value; } };
    return;
    documentObserver = new MutationObserver`), context);
  const api = context.testing;
  for (const pieceSet of ["system_rund", "system_eckig", "system_pixel", "rund", "cage", "rund_comic"]) {
    const options = settings.normalize({ pieceSet, whitePieceColor: "#20cc60", blackPieceColor: "#c040a0" });
    api.configure(options);
    for (const side of ["w", "b"]) {
      const previewFields = element();
      const entry = {
        previewPieceSvg: element(), previewPieceImage: element(), previewPieceColor: side,
        previewPieceGroup: { querySelector: () => previewFields }
      };
      api.syncPreviewDefenseFilter(entry);
      if (pieceSet === "rund_comic") {
        assert.equal(entry.previewPieceImage.attributes.filter, undefined);
        assert.equal(previewFields.attributes.filter, undefined);
        entry.defensePreviewMix = 0.5;
        api.syncPreviewDefenseFilter(entry);
        assert.equal(entry.previewDefenseFilter.transfer.attributes.in, "SourceGraphic");
        assert.equal(previewFields.attributes.filter, entry.previewPieceImage.attributes.filter);
      } else {
        const { flood, transfer, channels, colors: filters } = entry.previewDefenseFilter;
        assert.equal(flood.attributes["flood-color"], side === "w" ? options.whitePieceColor : options.blackPieceColor);
        assert.equal(transfer.attributes.in, "piece-color");
        assert.equal(filters.w.flood.attributes["flood-color"], options.whitePieceColor);
        assert.equal(filters.b.flood.attributes["flood-color"], options.blackPieceColor);
        assert.ok(channels.every(channel => channel.attributes.slope === "1" && channel.attributes.intercept === "0"));
        assert.equal(previewFields.attributes.filter, entry.previewPieceImage.attributes.filter);
        entry.defensePreviewMix = 0.5;
        api.syncPreviewDefenseFilter(entry);
        assert.ok(channels.every(channel => channel.attributes.slope === "0.5" && channel.attributes.intercept === "0.5"));
        assert.equal(previewFields.attributes.filter, entry.previewPieceImage.attributes.filter);
      }
    }
  }
  const radii = api.getFigureRadii("system_rund");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(assets, ["system_rund/bp_2.svg"]);
  for (const type of ["knight", "bishop", "rook", "queen", "king"]) {
    assert.equal(radii.get(type).length, 720);
    assert.ok(radii.get(type).every(radius => radius === 5 / 14));
    const clearance = api.getLineFigureClearance(radii.get(type), 0, 0, 0, 0);
    assert.equal(api.getLineFigureClearance(radii.get(type), Math.PI / 4, 0, 0, 0), clearance);
  }
  assert.ok(radii.get("pawn").every(radius => radius === 0.2));
  api.configure(settings.normalize({ pieceSet: "system_rund" }));
  context.cageBounds.length = 0;
  api.renderLineSet(element(), ["queen", "knight"].map((type, index) => ({
    type, target: { row: index * 3, col: index * 3 }, angle: Math.PI / 4, color: "#20cc60"
  })), radii);
  assert.ok(context.cageBounds.length > 0);
  assert.ok(context.cageBounds.every(bound => bound === undefined), "queens and knights must not use square clearance for System Rund");
});

test("move outlines keep rounded joins and share formatting with last-move previews", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const context = vm.createContext({
    document: { addEventListener() {}, createElementNS: () => ({ setAttribute() {} }) },
    LichessBoardOverlay: { place() {} }
  });
  const source = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  vm.runInContext(source.replace("  documentObserver = new MutationObserver", `
    getScreenSquare = square => square;
    readPosition = () => ({
      position: Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) =>
        row === 4 && col === 4 ? { color: "w", type: "pawn" } : null)),
      blackOrientation: false
    });
    globalThis.testing = { renderMoveOutline, renderLastMoveOutline, createLastMovePreview, getLastMoveOutlineCells, configure(value) { settings = value; } };
    return;
    documentObserver = new MutationObserver`), context);
  const render = (cells, selected = []) => {
    const board = { closest: () => true, querySelectorAll: selector => selector.includes("selected") ? selected : cells };
    const entry = {};
    context.testing.renderMoveOutline(board, entry, null);
    const html = entry.moveOutlineSvg.innerHTML;
    return { html, path: [...html.matchAll(/<path d="([^"]*)" fill="none"/g)][0][1] };
  };
  for (const percent of [20, 60, 100]) {
    context.testing.configure(settings.normalize({
      enabled: true, boardBevelEnabled: true, boardFieldShape: "round",
      boardRoundPercent: percent, moveIndicatorMode: "outline"
    }));
    const radius = percent / 200;
    const horizontal = render([{ row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 }]);
    assert.equal((horizontal.path.match(/A/g) ?? []).length, 4);
    assert.ok(horizontal.path.includes("M3 2H4"));
    assert.ok(horizontal.path.includes("M4 3H3"));
    assert.ok(horizontal.html.includes('<path d="M3 2H4L4 2V3L4 3H3L3 3V2L3 2Z"/>'));
    const vertical = render([{ row: 2, col: 2 }, { row: 3, col: 2 }, { row: 4, col: 2 }]);
    assert.equal((vertical.path.match(/A/g) ?? []).length, 4);
    assert.ok(vertical.path.includes("M3 3V4"));
    assert.ok(vertical.path.includes("M2 4V3"));
    const selected = render([{ row: 2, col: 3 }], [{ row: 2, col: 2 }]);
    assert.equal((selected.path.match(/A/g) ?? []).length, 4);
    const separate = render([{ row: 2, col: 2 }, { row: 2, col: 4 }]);
    assert.equal((separate.path.match(/A/g) ?? []).length, 8);
    const diagonal = render([{ row: 2, col: 2 }, { row: 3, col: 3 }]);
    assert.equal((diagonal.path.match(/A/g) ?? []).length, 8);
    const corner = render([{ row: 2, col: 2 }, { row: 2, col: 3 }, { row: 3, col: 2 }]);
    assert.equal((corner.path.match(/A/g) ?? []).length, 6);
    assert.ok(corner.path.includes(`M3 ${3 + radius}A${radius} ${radius} 0 0 1 ${3 + radius} 3`));
    const block = render([{ row: 2, col: 2 }, { row: 2, col: 3 }, { row: 3, col: 2 }, { row: 3, col: 3 }]);
    assert.equal((block.path.match(/A/g) ?? []).length, 4);
  }
  const outlineSettings = settings.normalize({
    enabled: true, markLastMove: true, moveDotsPlayerColor: true,
    whitePieceColor: "#abcdef", moveOutlineColor: "#123456", moveOutlineWidthPx: 3,
    moveGlowOpacity: 20, moveGlowRadiusPercent: 5, boardBevelEnabled: false
  });
  context.testing.configure(outlineSettings);
  const preview = context.testing.createLastMovePreview({}, "e2e4", false, "w");
  assert.ok(preview.innerHTML.includes(`stroke="${outlineSettings.whitePieceColor}" stroke-width="3"`));
  assert.ok(preview.innerHTML.includes("M4 4L5 4"));
  assert.ok(preview.innerHTML.includes("M5 7L4 7"));
  assert.ok(!preview.innerHTML.includes("M4 5L5 5"));
  assert.ok(!preview.innerHTML.includes("M4 6L5 6"));
  const cells = (source, target) => Array.from(context.testing.getLastMoveOutlineCells(source, target), cell => [cell.row, cell.col]);
  assert.deepEqual(cells({ row: 6, col: 4 }, { row: 3, col: 4 }), [[6, 4], [5, 4], [4, 4], [3, 4]]);
  assert.deepEqual(cells({ row: 6, col: 1 }, { row: 1, col: 6 }), [[6, 1], [5, 2], [4, 3], [3, 4], [2, 5], [1, 6]]);
  assert.deepEqual(cells({ row: 7, col: 1 }, { row: 5, col: 2 }), [[7, 1], [5, 2]]);
  const board = {
    closest: () => true,
    querySelectorAll: () => [{ row: 6, col: 4 }, { row: 4, col: 4 }]
  };
  const entry = {};
  context.testing.renderLastMoveOutline(board, entry);
  assert.ok(entry.lastMoveOutlineSvg.innerHTML.includes(`stroke="${outlineSettings.whitePieceColor}" stroke-width="3"`));
  assert.ok(entry.lastMoveOutlineSvg.innerHTML.includes("M4 4L5 4"));
  assert.ok(!entry.lastMoveOutlineSvg.innerHTML.includes("M4 6L5 6"));
});

const previousColors = {
  boardLightLight: "#dedae6", boardDarkLight: "#d6dbd5", lastMoveLight: "#dae0d7",
  selectedLight: "#ffffff", checkSquareLight: "#e57373", engineArrowLight: "#4a4a4a",
  hoverMixLight: "#d4d2d2", boardLightDark: "#424240", boardDarkDark: "#3e3d40",
  lastMoveDark: "#2f2d30", selectedDark: "#252823", checkSquareDark: "#8c3434",
  engineArrowDark: "#000000", hoverMixDark: "#282727", whitePieceColor: "#d1521d",
  blackPieceColor: "#2ba4d1", primaryButtonColor: "#3692e7", onlineIndicatorLight: "#7c9e4f", onlineIndicatorDark: "#7c9e4f", buttonBackgroundDark: "#333332",
  buttonBackgroundLight: "#bdbdbd", threatPinnedOutlineDark: "#383838", threatPinnedOutlineLight: "#f0f0f0"
};

test("board bevel defaults and limits", () => {
  const defaults = settings.normalize();
  assert.equal(defaults.boardBevelEnabled, true);
  assert.equal(defaults.boardFieldShape, "bevel");
  assert.equal(defaults.boardBevelPercent, 40);
  assert.equal(defaults.boardRoundPercent, 0);
  assert.equal(settings.normalize({ boardBevelPercent: -10 }).boardBevelPercent, 0);
  assert.equal(settings.normalize({ boardBevelPercent: 120 }).boardBevelPercent, 100);
  assert.equal(settings.normalize({ boardFieldShape: "unknown" }).boardFieldShape, "bevel");
  assert.equal(settings.normalize({ boardFieldShape: "round", boardRoundPercent: -10 }).boardRoundPercent, 0);
  assert.equal(settings.normalize({ boardRoundPercent: 120 }).boardRoundPercent, 100);
  assert.equal(settings.normalize({ boardBevelEnabled: true }).boardBevelEnabled, true);
  for (const key of ["boardGapLight", "boardGapDark"]) {
    assert.equal(colors.parse(defaults[key]).alpha, 1);
    assert.equal(colors.toHex(settings.normalize({ [key]: "#123456" })[key]), "#123456");
    assert.equal(settings.normalize({ [key]: "invalid" })[key], settings.defaults[key]);
  }
});

test("gap colors equally mix adjacent fields and only include existing edge neighbors", () => {
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => [0, 0, 0]));
  grid[0][0] = [200, 0, 0];
  grid[0][1] = [0, 100, 0];
  grid[1][0] = [0, 0, 80];
  grid[1][1] = [40, 20, 0];
  assert.deepEqual(threats.getThreatGapColor(grid, 1, 1), [60, 30, 20]);
  assert.deepEqual(threats.getThreatGapColor(grid, 0, 1), [100, 50, 0]);
  assert.deepEqual(threats.getThreatGapColor(grid, 1, 0), [100, 0, 40]);
  assert.deepEqual(threats.getThreatGapColor(grid, 0, 0), [200, 0, 0]);
  grid[7][7] = [12, 34, 56];
  assert.deepEqual(threats.getThreatGapColor(grid, 8, 8), [12, 34, 56]);
  const rotated = grid.map(row => [...row].reverse()).reverse();
  assert.deepEqual(threats.getThreatGapColor(rotated, 7, 7), [60, 30, 20]);
});

test("gap mixing preserves the chosen base without threats and combines both player tints", () => {
  for (const threatBlendMode of ["oklab", "normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten", "difference"]) {
    const options = { ...settings.defaults, threatBlendMode };
    const base = "#778899";
    const neutral = colors.toRgb(threats.getOpacityColor(0, options, base));
    const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => neutral));
    assert.equal(colors.toHex(colors.fromRgb(threats.getThreatGapColor(grid, 1, 1))), base);
    grid[0][0] = colors.toRgb(threats.getOpacityColor(5, options, base));
    grid[0][1] = colors.toRgb(threats.getOpacityColor(-5, options, base));
    const mixed = threats.getThreatGapColor(grid, 1, 1);
    mixed.forEach((channel, index) => assert.ok(Math.abs(channel - (grid[0][0][index] + grid[0][1][index] + 2 * neutral[index]) / 4) < 0.000001));
  }
});

test("sRGB primary colors match the published Oklab reference", () => {
  for (const [hex, expected] of [
    ["#ff0000", [0.62795536, 0.25768331, 29.23388519]],
    ["#00ff00", [0.86643961, 0.29482724, 142.49533889]],
    ["#0000ff", [0.45201372, 0.31321437, 264.05202064]]
  ]) {
    const actual = colors.parse(hex);
    [actual.l, actual.c, actual.h].forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 0.000001));
  }
});

test("OKLCH round trips an sRGB grid without changing any 8-bit channels", () => {
  for (let r = 0; r <= 255; r += 15) {
    for (let g = 0; g <= 255; g += 15) {
      for (let b = 0; b <= 255; b += 15) {
        const hex = `#${[r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
        const converted = colors.toOklch(hex);
        assert.equal(colors.toHex(converted), hex);
        colors.toRgb(converted).forEach((channel, index) => assert.ok(Math.abs(channel - [r, g, b][index]) < 0.001));
      }
    }
  }
});

test("neutral colors have no chroma or arbitrary hue", () => {
  for (let channel = 0; channel <= 255; channel++) {
    const color = colors.fromRgb([channel, channel, channel]);
    assert.equal(color.c, 0);
    assert.equal(color.h, 0);
    assert.equal(colors.toHex(color), `#${channel.toString(16).padStart(2, "0").repeat(3)}`);
  }
  assert.equal(colors.toOklch("#fff"), "oklch(1 0 0)");
  assert.equal(colors.toOklch("#000"), "oklch(0 0 0)");
});

test("default and saved custom colors remain valid and retain their appearance", () => {
  const migrated = settings.normalize(previousColors);
  for (const [key, hex] of Object.entries(previousColors)) {
    assert.equal(colors.parse(settings.defaults[key]).alpha, 1, key);
    assert.equal(colors.toHex(migrated[key]), hex, key);
    assert.equal(settings.normalize(migrated)[key], migrated[key], key);
    assert.equal(colors.toHex(settings.normalize({ [key]: "#12abef" })[key]), "#12abef", key);
    assert.equal(settings.normalize({ [key]: "invalid" })[key], settings.defaults[key], key);
  }
});

test("hover preview corridor width and origin opacity retain saved values and valid limits", () => {
  assert.equal(settings.normalize().movePreviewCorridorWidthPercent, 185);
  for (const [saved, expected] of [[0, 0], [60, 60], [150, 150], [-5, 0], [250, 200], ["invalid", 185]]) {
    const normalized = settings.normalize({ movePreviewCorridorWidthPercent: saved });
    assert.equal(normalized.movePreviewCorridorWidthPercent, expected);
    assert.equal(settings.normalize(normalized).movePreviewCorridorWidthPercent, expected);
  }
  for (const opacity of [0, 0.25, 1]) {
    assert.equal(settings.normalize({ movePreviewOriginOpacity: opacity }).movePreviewOriginOpacity, opacity);
  }
});

test("hover preview anticipation uses the configured default and clamps saved values", () => {
  assert.equal(settings.normalize().movePreviewAnticipationPercent, 40);
  for (const [saved, expected] of [[0, 0], [35, 35], [100, 100], [-5, 0], [150, 100], ["invalid", 40]]) {
    const normalized = settings.normalize({ movePreviewAnticipationPercent: saved });
    assert.equal(normalized.movePreviewAnticipationPercent, expected);
    assert.equal(settings.normalize(normalized).movePreviewAnticipationPercent, expected);
  }
});

test("empty move-field radius has a stable default and supported limits", () => {
  assert.equal(settings.normalize().threatMoveFieldRadius, 0.35);
  for (const [saved, expected] of [[0.1, 0.1], [0.48, 0.48], [0.7, 0.7], [-1, 0.1], [1, 0.7], ["invalid", 0.35]]) {
    const normalized = settings.normalize({ threatMoveFieldRadius: saved });
    assert.equal(normalized.threatMoveFieldRadius, expected);
    assert.equal(settings.normalize(normalized).threatMoveFieldRadius, expected);
  }
});

test("defense highlight settings have stable defaults and clamp saved values", () => {
  const defaults = settings.normalize();
  assert.equal(defaults.defenseHighlightEnabled, true);
  assert.equal(defaults.attackHighlightEnabled, true);
  assert.equal(defaults.highlightCascadesEnabled, true);
  assert.equal(defaults.highlightCascadeLinesEnabled, true);
  assert.equal(defaults.highlightCascadeLinesHoldEnabled, false);
  assert.equal(defaults.highlightCascadeReverseEnabled, false);
  assert.equal(defaults.defenseHighlightDepth, 3);
  assert.equal(defaults.defenseHighlightWaveIntervalMs, 210);
  assert.equal(defaults.defenseHighlightDurationMs, 700);
  assert.equal(defaults.defenseHighlightWaveDecayPercent, 20);
  assert.equal(defaults.defenseHighlightWhiteMixPercent, 35);
  assert.equal(defaults.defensePreviewThresholdMs, 200);
  assert.equal(defaults.defenseHighlightLineWidthPercent, 0.5);
  assert.equal(defaults.defenseHighlightLineLengthPercent, 70);
  assert.equal(defaults.defenseHighlightLineBlurPercent, 20);
  assert.equal(settings.normalize({ highlightLineDurationMs: 1600 }).highlightLineDurationMs, undefined);
  assert.equal(settings.normalize({ highlightLineArrivalLeadPercent: 45 }).highlightLineArrivalLeadPercent, undefined);
  assert.equal(defaults.highlightLineOpacityPercent, 100);
  assert.equal(defaults.highlightLineDecayPercent, 20);
  assert.equal(defaults.highlightLineHoldStartOpacityPercent, 80);
  assert.equal(defaults.defenseHighlightLineMaskBlurPx, 1);
  assert.equal(settings.normalize({ highlightLineEaseInPercent: 100 }).highlightLineEaseInPercent, undefined);
  assert.equal(settings.normalize({ highlightLineEaseOutPercent: 100 }).highlightLineEaseOutPercent, undefined);
  assert.equal(settings.normalize({ defenseHighlightWaveDecayPercent: 35 }).highlightLineDecayPercent, 35);
  const normalized = settings.normalize({
    defenseHighlightEnabled: true,
    attackHighlightEnabled: false,
    highlightCascadesEnabled: false,
    highlightCascadeLinesEnabled: false,
    highlightCascadeLinesHoldEnabled: "true",
    defenseHighlightDepth: 20,
    defenseHighlightWaveIntervalMs: -5,
    defenseHighlightDurationMs: 2050,
    defenseHighlightWaveDecayPercent: 90,
    defenseHighlightWhiteMixPercent: 120,
    defensePreviewThresholdMs: "invalid",
    defenseHighlightLineWidthPercent: -5,
    defenseHighlightLineLengthPercent: 120,
    defenseHighlightLineBlurPercent: "invalid",
    highlightLineOpacityPercent: -10,
    highlightLineDecayPercent: 70,
    highlightLineHoldStartOpacityPercent: 150,
    defenseHighlightLineMaskBlurPx: 12.38,
    highlightLineEaseInPercent: 150,
    highlightLineEaseOutPercent: -5
  });
  assert.equal(normalized.defenseHighlightEnabled, true);
  assert.equal(normalized.attackHighlightEnabled, false);
  assert.equal(normalized.highlightCascadesEnabled, false);
  assert.equal(normalized.highlightCascadeLinesEnabled, false);
  assert.equal(normalized.highlightCascadeLinesHoldEnabled, true);
  assert.equal(normalized.defenseHighlightDepth, 6);
  assert.equal(normalized.defenseHighlightWaveIntervalMs, 0);
  assert.equal(normalized.defenseHighlightDurationMs, 2000);
  assert.equal(normalized.defenseHighlightWaveDecayPercent, 50);
  assert.equal(normalized.defenseHighlightWhiteMixPercent, 100);
  assert.equal(normalized.defensePreviewThresholdMs, 200);
  assert.equal(normalized.defenseHighlightLineWidthPercent, 0.2);
  assert.equal(normalized.defenseHighlightLineLengthPercent, 100);
  assert.equal(normalized.defenseHighlightLineBlurPercent, 20);
  assert.equal(normalized.highlightLineOpacityPercent, 0);
  assert.equal(normalized.highlightLineDecayPercent, 50);
  assert.equal(normalized.highlightLineHoldStartOpacityPercent, 100);
  assert.equal(normalized.defenseHighlightLineMaskBlurPx, 10);
  assert.equal(normalized.highlightLineEaseInPercent, undefined);
  assert.equal(normalized.highlightLineEaseOutPercent, undefined);
});

test("highlight pulses remain continuous with zero wave spacing and reuse static SVG attributes", () => {
  const animation = globalThis.LichessHighlightLinePreview;
  const options = settings.normalize({ defenseHighlightWaveIntervalMs: 0 });
  const startedAt = 1000;
  const pulseStart = startedAt;
  for (const duration of [200, 520, 1600]) {
    const values = { ...options, defenseHighlightDurationMs: duration };
    let previousProgress = 0;
    for (let elapsed = 0; elapsed <= duration; elapsed++) {
      const state = animation.getLineMotion(values, 1, startedAt, pulseStart + elapsed);
      assert.ok(Number.isFinite(state.progress) && Number.isFinite(state.opacity));
      assert.ok(state.progress >= previousProgress && state.progress <= 1);
      assert.ok(state.opacity >= 0 && state.opacity <= 1);
      previousProgress = state.progress;
    }
    assert.equal(animation.getLineMotion(values, 1, startedAt, pulseStart).opacity, 0);
    assert.equal(animation.getLineMotion(values, 1, startedAt, pulseStart + duration).opacity, 0);
    assert.ok(animation.getLineMotion(values, 1, startedAt, pulseStart + duration / 2).opacity > 0);
  }
  const writes = [];
  const element = () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; writes.push(key); } });
  for (const length of [1, 70, 100]) {
    const values = { ...options, defenseHighlightLineLengthPercent: length };
    const line = { path: element(), gradient: element(), stops: Array.from({ length: 9 }, element),
      length: 5, fromX: 1, fromY: 2, toX: 4, toY: 6, color: "red" };
    animation.updateLine(line, { progress: 0, opacity: 0 }, values, 0.01);
    assert.equal(Number(line.path.attributes["stroke-dashoffset"]), 0);
    const [dash, gap] = line.path.attributes["stroke-dasharray"].split(" ").map(Number);
    assert.equal(dash, 0);
    assert.ok(gap > line.length);
    animation.updateLine(line, { progress: 0.4, opacity: 0.6 }, values, 0.01);
    writes.length = 0;
    animation.updateLine(line, { progress: 0.5, opacity: 0.8 }, values, 0.01);
    assert.deepEqual(writes, [
      "gradientTransform",
      ...(length === 1 ? [] : ["stroke-dasharray"]),
      ...(length === 1 ? ["stroke-dashoffset"] : []),
      "stroke-opacity"
    ]);
    assert.ok(Math.abs(Number(line.path.attributes["stroke-dasharray"].split(" ")[0]) - Math.min(2.5, 5 * length / 100)) < 1e-12);
    animation.updateLine(line, { progress: 1, opacity: 0 }, values, 0.01);
    assert.equal(line.path.attributes["stroke-dasharray"], length === 100 ? "none" : `${5 * length / 100} 6`);
    assert.ok(Math.abs(Number(line.path.attributes["stroke-dashoffset"]) + 5 - 5 * length / 100) < 1e-12);
    animation.updateLine(line, { progress: 0.5, opacity: 0.8, shrinking: true }, values, 0.01);
    assert.equal(Number(line.path.attributes["stroke-dashoffset"]), -2.5);
    const matrix = line.gradient.attributes.gradientTransform.slice(7, -1).split(" ").map(Number);
    assert.ok(Math.abs(matrix[0] + matrix[4] - 4) < 1e-12);
    assert.ok(Math.abs(matrix[1] + matrix[5] - 6) < 1e-12);
    animation.updateLine(line, { progress: 0.5, opacity: 0.8 }, { ...values, defenseHighlightLineBlurPercent: 0 }, 0.01);
    assert.ok(line.stops.every(stop => stop.attributes["stop-opacity"] === "1"));
  }
});

test("non-held pulses animate in the destination wave and finish without holding", () => {
  const animation = globalThis.LichessHighlightLinePreview;
  const options = settings.normalize();
  const startedAt = 1000;
  for (const duration of [100, 700, 2000]) {
    const values = { ...options, defenseHighlightDurationMs: duration };
    const travelDuration = duration;
    const pulseStart = startedAt + values.defenseHighlightWaveIntervalMs;
    assert.equal(animation.getLineMotion(values, 1, startedAt, pulseStart).progress, 0);
    const firstFrame = animation.getLineMotion(values, 1, startedAt, pulseStart + 16);
    assert.ok(firstFrame.opacity > 0, "the first rendered frame already shows the pulse");
    assert.ok(firstFrame.progress > 0);
    for (let elapsed = 0; elapsed < travelDuration; elapsed++) {
      const state = animation.getLineMotion(values, 1, startedAt, pulseStart + elapsed);
      const progress = elapsed / travelDuration;
      const opacity = animation.getHighlightMix(progress, 1, values.highlightLineOpacityPercent, values.highlightLineDecayPercent);
      assert.ok(Math.abs(state.progress - progress) < 1e-12);
      assert.ok(Math.abs(state.opacity - opacity) < 1e-12);
      assert.equal(state.finished, false);
    }
    const arrived = animation.getLineMotion(values, 1, startedAt, pulseStart + travelDuration);
    assert.deepEqual({ ...arrived }, { progress: 1, opacity: 0, finished: true });
  }
  const holding = settings.normalize({ highlightCascadeLinesHoldEnabled: true,
    highlightLineOpacityPercent: 20, highlightLineDecayPercent: 0 });
  const heldOpacity = animation.getHighlightMix(0.5, 1, holding.highlightLineOpacityPercent, holding.highlightLineDecayPercent);
  const nearlyComplete = animation.getLineMotion(holding, 1, startedAt,
    startedAt + holding.defenseHighlightWaveIntervalMs + holding.defenseHighlightDurationMs * 0.999);
  assert.equal(nearlyComplete.progress, 1);
  assert.ok(Math.abs(nearlyComplete.opacity - heldOpacity) < 0.001);
  assert.deepEqual({ ...animation.getLineMotion(holding, 1, startedAt,
    startedAt + holding.defenseHighlightWaveIntervalMs + holding.defenseHighlightDurationMs) },
    { progress: 1, opacity: heldOpacity, finished: true, holding: true });
});

test("held lines align with destination highlights while pulses retain their configured duration", () => {
  const animation = globalThis.LichessHighlightLinePreview;
  for (const hold of [false, true]) {
    for (const interval of [0, 210, 1000]) {
      for (const duration of [100, 700, 2000]) {
        const options = settings.normalize({ highlightCascadeLinesHoldEnabled: hold,
          defenseHighlightWaveIntervalMs: interval, defenseHighlightDurationMs: duration,
          highlightLineOpacityPercent: 20, highlightLineDecayPercent: 0 });
        for (let depth = 1; depth <= 6; depth++) {
          const arrival = 1000 + depth * interval;
          const start = hold ? arrival - interval : arrival;
          const lineEnd = hold ? arrival + duration : start + duration;
          if (!hold) {
            assert.ok(animation.getLineMotion(options, depth, 1000, lineEnd - 1).progress < 1);
          }
          const arrived = animation.getLineMotion(options, depth, 1000, lineEnd);
          assert.equal(arrived.progress, 1);
          assert.equal(arrived.finished, true);
          if (hold) {
            const fading = animation.getLineMotion(options, depth, 1000, arrival + duration * 0.75);
            assert.ok(fading.opacity > animation.getHighlightMix(0.5, depth, options.highlightLineOpacityPercent, options.highlightLineDecayPercent));
          } else assert.equal(arrived.opacity, 0);
        }
      }
    }
  }
});

test("non-held pulses follow the highlight and are never briefly held", () => {
  const animation = globalThis.LichessHighlightLinePreview;
  const element = () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } });
  for (const duration of [100, 700, 2000]) {
    for (const interval of [0, 210, 1000]) {
      for (const opacityPercent of [0, 20, 100]) {
        const options = settings.normalize({ highlightCascadeLinesHoldEnabled: false,
          highlightLineOpacityPercent: opacityPercent,
          defenseHighlightDurationMs: duration, defenseHighlightWaveIntervalMs: interval });
        for (const depth of [1, 2, 3]) {
          const line = { path: element(), gradient: element(), stops: Array.from({ length: 10 }, element),
            length: 5, fromX: 1, fromY: 2, toX: 4, toY: 6, color: "red" };
          const start = depth * interval;
          const travelDuration = duration;
          const fadeEnd = travelDuration;
          for (let elapsed = 0; elapsed <= interval + duration + 16; elapsed++) {
            const state = animation.getLineMotion(options, depth, 0, start + elapsed);
            animation.updateLine(line, state, options, 0.01);
            const opacity = Number(line.path.attributes["stroke-opacity"]);
            if (elapsed >= fadeEnd) {
              assert.equal(opacity, 0);
              assert.equal(state.finished, true);
              assert.equal(line.path.attributes.visibility, "hidden");
              continue;
            }
            const progress = Math.min(1, elapsed / travelDuration);
            const expectedOpacity = animation.getHighlightMix(progress, depth,
              options.highlightLineOpacityPercent, options.highlightLineDecayPercent);
            assert.ok(Math.abs(opacity - expectedOpacity) < 1e-12);
            assert.notEqual(state.holding, true);
            assert.notEqual(line.path.attributes["stroke-dasharray"], "none", "a short pulse must not become a temporarily held full line");
            assert.equal(line.path.attributes.visibility, opacity > 0 ? "visible" : "hidden");
          }
        }
      }
    }
  }
});

test("held lines use the configured initial opacity and fade to the final opacity with the target highlight", () => {
  const animation = globalThis.LichessHighlightLinePreview;
  const element = () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } });
  for (const length of [1, 10, 70, 100]) {
    for (const interval of [0, 210, 1000]) {
      for (const startOpacity of [0, 40, 80, 100]) {
        const options = settings.normalize({ highlightCascadeLinesHoldEnabled: true,
          highlightLineOpacityPercent: 25, highlightLineHoldStartOpacityPercent: startOpacity,
          defenseHighlightLineLengthPercent: length, defenseHighlightWaveIntervalMs: interval });
        const line = { path: element(), gradient: element(), stops: Array.from({ length: 10 }, element),
          length: 100, fromX: 0, fromY: 0, toX: 100, toY: 0, color: "red" };
        const finalOpacity = animation.getHighlightMix(0.5, 1, options.highlightLineOpacityPercent, options.highlightLineDecayPercent);
        for (let timestamp = 0; timestamp <= interval + options.defenseHighlightDurationMs + 16; timestamp++) {
          const state = animation.getLineMotion(options, 1, 0, timestamp);
          animation.updateLine(line, state, options);
          const span = Math.min(1, interval > 0 ? timestamp / interval : 1) * line.length;
          assert.equal(line.path.attributes["stroke-dasharray"], span >= line.length ? "none" : `${span} 101`,
            `length=${length}, interval=${interval}, timestamp=${timestamp}, progress=${state.progress}`);
          assert.equal(Number(line.path.attributes["stroke-dashoffset"]), 0);
          const targetPhase = (timestamp - interval) / options.defenseHighlightDurationMs;
          const fadeProgress = Math.max(0, Math.min(1, (targetPhase - 0.5) * 2));
          const fadeMix = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
          const initialOpacity = startOpacity / 100;
          const expectedOpacity = initialOpacity + (finalOpacity - initialOpacity) * fadeMix;
          assert.ok(Math.abs(state.opacity - expectedOpacity) < 1e-12);
          assert.equal(state.holding, true);
        }
      }
    }
  }
});

test("mask blur setting keeps pixel precision and clamps to its supported range", () => {
  assert.equal(settings.normalize({ defenseHighlightLineMaskBlurPx: 2.34 }).defenseHighlightLineMaskBlurPx, 2.3);
  assert.equal(settings.normalize({ defenseHighlightLineMaskBlurPx: -1 }).defenseHighlightLineMaskBlurPx, 0);
  assert.equal(settings.normalize({ defenseHighlightLineMaskBlurPx: "invalid" }).defenseHighlightLineMaskBlurPx, 1);
});

test("line length limits only the travelling pulse, width changes its stroke and edges change its fade span", () => {
  const animation = globalThis.LichessHighlightLinePreview;
  const element = () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } });
  const line = { path: element(), gradient: element(), stops: Array.from({ length: 10 }, element),
    length: 100, fromX: 0, fromY: 0, toX: 100, toY: 0, color: "red" };
  const values = settings.normalize({ defenseHighlightLineLengthPercent: 10, defenseHighlightLineBlurPercent: 5 });
  animation.updateLine(line, { progress: 0.5, opacity: 0.8 }, values);
  assert.equal(line.path.attributes["stroke-dasharray"], "10 101");
  assert.equal(Number(line.path.attributes["stroke-dashoffset"]), -40);
  assert.equal(Number(line.path.attributes["stroke-width"]), 0.5);
  assert.equal(Number(line.stops[4].attributes.offset), 0.05);
  animation.updateLine(line, { progress: 0.5, opacity: 0.8 }, { ...values,
    defenseHighlightLineLengthPercent: 90, defenseHighlightLineWidthPercent: 8, defenseHighlightLineBlurPercent: 50 });
  assert.equal(line.path.attributes["stroke-dasharray"], "50 101");
  assert.equal(Number(line.path.attributes["stroke-dashoffset"]), 0);
  assert.equal(Number(line.path.attributes["stroke-width"]), 8);
  assert.equal(Number(line.stops[4].attributes.offset), 0.5);
  animation.updateLine(line, { progress: 1, opacity: 0.2, holding: true }, values);
  assert.equal(line.path.attributes["stroke-dasharray"], "none", "a held line must remain full length even with a short pulse");
  assert.equal(Number(line.path.attributes["stroke-dashoffset"]), 0);
});

test("line timing and brightness stay synchronized with each highlight wave", () => {
  const animation = globalThis.LichessHighlightLinePreview;
  for (const duration of [100, 700, 2000]) {
    for (const interval of [0, 210, 1000]) {
      const options = settings.normalize({ defenseHighlightDurationMs: duration, defenseHighlightWaveIntervalMs: interval });
      for (let depth = 1; depth <= 6; depth++) {
        const start = 1000 + depth * interval;
        assert.equal(animation.getLineMotion(options, depth, 1000, start - 1).opacity, 0);
        const end = start + duration;
        for (const phase of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
          const timestamp = start + phase * duration;
          const line = animation.getLineMotion(options, depth, 1000, timestamp);
          const expectedProgress = Math.min(1, (timestamp - start) / duration);
          assert.ok(Math.abs(line.opacity - animation.getHighlightMix(expectedProgress, depth,
            options.highlightLineOpacityPercent, options.highlightLineDecayPercent)) < 1e-12);
          assert.ok(Math.abs(line.progress - expectedProgress) < 1e-12);
        }
        assert.equal(animation.getLineMotion(options, depth, 1000, end - 1).finished, false);
        assert.equal(animation.getLineMotion(options, depth, 1000, end).finished, true);
      }
    }
  }
});

test("board preview updates do not trigger round layout and synthetic scroll feedback", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  let observer;
  let zenMode = false;
  const calls = [];
  const context = vm.createContext({
    LichessSettings: settings,
    window: { addEventListener() {} },
    document: { addEventListener() {}, documentElement: { hasAttribute: () => zenMode } },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: { local: { get() {} }, onChanged: { addListener() {} } }
    },
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: class {
      constructor(callback) { observer = callback; }
      observe() {}
    },
    recordLayout: name => calls.push(name)
  });
  const source = readFileSync(join(__dirname, "content.js"), "utf8");
  vm.runInContext(source.replace("  new MutationObserver(records => {", `
    syncBoardLayout = () => recordLayout("board");
    syncNormalRoundLayout = () => recordLayout("round");
    scheduleZenCenter = () => recordLayout("zen");
    schedulePvPreviewSync = () => recordLayout("pv");
    scheduleZenClockUpdate = () => recordLayout("clock");
    new MutationObserver(records => {`), context);
  const node = { nodeType: 1, matches: () => false, querySelector: () => null, querySelectorAll: () => [], closest: () => null };
  for (zenMode of [false, true]) {
    const board = { ...node, closest: selector => selector === "cg-board" || selector.includes("main") ? board : null };
    const overlay = { ...node, closest: selector => selector === "cg-board" || selector.includes("main") ? board : null };
    for (const target of [board, overlay]) {
      observer([{ type: "childList", target, addedNodes: [node], removedNodes: [] }]);
      assert.deepEqual(calls, [], "board overlays and piece changes must not reset hover anticipation via layout updates");
    }
    const round = { ...node, closest: selector => selector.includes("main") ? round : null };
    observer([{ type: "childList", target: round, addedNodes: [node], removedNodes: [] }]);
    assert.deepEqual(calls, ["board", zenMode ? "zen" : "round", "clock"], "real surrounding layout changes must still be handled");
    calls.length = 0;
    const clock = { ...node, textContent: "1:00", closest: selector => selector.includes(".rclock") ? clock : null };
    observer([{ type: "characterData", target: clock, addedNodes: [], removedNodes: [] }]);
    assert.deepEqual(calls, ["clock"], "clock changes must refresh the lines in both display modes");
    calls.length = 0;
  }
});

test("hover previews ignore stale move keys and respect active move animations", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const context = vm.createContext({
    document: { addEventListener: () => {} },
    getComputedStyle: () => ({ display: "block", visibility: "visible" })
  });
  const threatSource = readFileSync(join(__dirname, "threat-coding.js"), "utf8");
  vm.runInContext(threatSource.replace("  globalThis.LichessThreatCoding = {", `
    globalThis.threatTesting = { getLogicalSquare, getAllowedDestinations, getHoverMoveTarget, getInteractionPreview };
    globalThis.LichessThreatCoding = {`), context);
  const previewSource = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  vm.runInContext(previewSource.replace("  documentObserver = new MutationObserver", `
    globalThis.previewTesting = { getPieceScreenSquare };
    return;
    documentObserver = new MutationObserver`), context);
  const board = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 80 }) };
  const animationKeyPiece = isAnimating => ({
    classList: { contains: name => name === "anim" && isAnimating },
    dataset: { key: "a1" },
    getAttribute: name => name === "data-lfs-move-key" ? "h8" : null,
    getBoundingClientRect: () => ({ left: 30, top: 20, width: 10, height: 10 })
  });
  for (const [isAnimating, expected] of [[false, { row: 2, col: 3 }], [true, { row: 0, col: 7 }]]) {
    const piece = animationKeyPiece(isAnimating);
    assert.deepEqual({ ...context.threatTesting.getLogicalSquare(piece, board, false) }, expected);
    assert.deepEqual({ ...context.previewTesting.getPieceScreenSquare(piece, board, false) }, expected);
  }

  const hiddenDestination = {
    classList: { contains: () => false },
    dataset: {},
    style: { transform: "translate(100%, 100%)" },
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
  };
  const hiddenMoveBoard = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 80 }),
    querySelectorAll: () => [hiddenDestination]
  };
  const allowed = context.threatTesting.getAllowedDestinations(hiddenMoveBoard, false);
  assert.deepEqual([...allowed], ["1,1"], "CSS-hidden legal fields remain valid move targets");
  assert.deepEqual({ ...context.threatTesting.getHoverMoveTarget(hiddenMoveBoard, allowed, false, 15, 15, { row: 0, col: 0 }) },
    { row: 1, col: 1 }, "hovering a hidden legal destination must preview the move instead of returning to origin");
  const unusedDestination = { ...hiddenDestination, style: { display: "none", transform: "translate(200%, 200%)" } };
  hiddenMoveBoard.querySelectorAll = () => [unusedDestination, hiddenDestination];
  assert.deepEqual([...context.threatTesting.getAllowedDestinations(hiddenMoveBoard, false)], ["1,1"],
    "Chessground's unused inline-hidden destinations must not remain legal targets");

  const sourcePiece = {
    classList: { contains: name => name === "white" || name === "rook" },
    dataset: { key: "a1" },
    getBoundingClientRect: () => ({ left: 30, top: 40, width: 10, height: 10 })
  };
  const selectedSquare = {
    classList: { contains: () => false },
    getBoundingClientRect: () => ({ left: 30, top: 40, width: 10, height: 10 })
  };
  const destinationSquare = {
    classList: { contains: () => false },
    getBoundingClientRect: () => ({ left: 40, top: 40, width: 10, height: 10 })
  };
  const historyBoard = {
    closest: selector => selector === ".is2d" ? {} : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 80 }),
    querySelector: () => selectedSquare,
    querySelectorAll: selector => selector === ":scope > piece" ? [sourcePiece]
      : selector === ":scope > square.selected" ? [selectedSquare] : [destinationSquare]
  };
  const preview = context.threatTesting.getInteractionPreview(historyBoard, 45, 45);
  assert.deepEqual({ ...preview.source }, { row: 4, col: 3 }, "history navigation must use the piece's current square instead of its stale key");
  assert.deepEqual({ ...preview.target }, { row: 4, col: 4 }, "the selected piece must preview the hovered legal field after history navigation");

  const unusedSelection = { ...hiddenDestination, style: { display: "none", transform: "translate(0%, 0%)" } };
  const historySquares = historyBoard.querySelectorAll;
  historyBoard.querySelector = () => unusedSelection;
  historyBoard.querySelectorAll = selector => selector === ":scope > square.selected"
    ? [unusedSelection, selectedSquare] : historySquares(selector);
  for (const blackOrientation of [false, true]) {
    historyBoard.closest = selector => selector === ".is2d" ? {}
      : selector === ".cg-wrap" ? { classList: { contains: () => blackOrientation } } : null;
    const current = context.threatTesting.getInteractionPreview(historyBoard, 45, 45);
    assert.deepEqual({ ...current.source }, blackOrientation ? { row: 3, col: 4 } : { row: 4, col: 3 },
      "a retained hidden selection must not suppress the current piece preview in either orientation");
    assert.deepEqual({ ...current.target }, blackOrientation ? { row: 3, col: 3 } : { row: 4, col: 4 });
  }
  historyBoard.closest = selector => selector === ".is2d" ? {} : null;
  historyBoard.querySelectorAll = selector => selector === ":scope > square.selected" ? [unusedSelection] : historySquares(selector);
  assert.equal(context.threatTesting.getInteractionPreview(historyBoard, 45, 45), null,
    "deselection must not revive a retained hidden selection");
  historyBoard.querySelectorAll = historySquares;

  const listeners = {};
  const interactionContext = vm.createContext({
    document: {
      addEventListener: (name, callback) => { listeners[name] = callback; },
      querySelector: () => null,
      dispatchEvent() {}
    },
    window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
    requestAnimationFrame: () => 1
  });
  vm.runInContext(threatSource.replace("    if (!documentObserver) {", "    return;\n    if (!documentObserver) {"), interactionContext);
  const interaction = interactionContext.LichessThreatCoding;
  interaction.update(settings.normalize({ enabled: true }));
  listeners.pointermove({ clientX: 45, clientY: 45 });
  assert.deepEqual({ ...interaction.getInteractionPreview(historyBoard).target }, { row: 4, col: 4 });
  listeners.pointerout({ type: "pointerout", relatedTarget: null });
  assert.equal(interaction.getInteractionPreview(historyBoard), null, "leaving the window clears the move preview");
  listeners.pointerover({ clientX: 45, clientY: 45 });
  assert.deepEqual({ ...interaction.getInteractionPreview(historyBoard).target }, { row: 4, col: 4 },
    "re-entering the window restores the move preview without pointermove");
});

test("highlight cascades only follow recaptures on the root square and reveal vacated lines", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const previewSource = readFileSync(join(__dirname, "highlight-line-preview.js"), "utf8");
  const context = vm.createContext({
    document: { addEventListener: () => {} },
    getComputedStyle: () => ({ display: "block", visibility: "visible" })
  });
  const source = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  vm.runInContext(previewSource, context);
  vm.runInContext(source.replace("  documentObserver = new MutationObserver", `
    globalThis.testing = {
      getDefenseCascadeLayers,
      getAttackCascadeLayers,
      getHighlightCascadeConnections,
      getPositionAnalysis,
      getDefenseHighlightMix,
      getHighlightLineState,
      getPreviewMoveKey,
      getLastMove,
      readDragPreview,
      shouldPlayLastMoveCascade,
      getDefenseLineHoldRoot,
      setSettings: value => { settings = value; },
      isNewDefensePreviewTarget
    };
    return;
    documentObserver = new MutationObserver`), context);
  const position = Array.from({ length: 8 }, () => Array(8).fill(null));
  position[4][4] = { color: "w", type: "pawn" };
  position[2][5] = { color: "w", type: "knight" };
  position[7][5] = { color: "w", type: "rook" };
  position[5][7] = { color: "w", type: "bishop" };
  context.testing.setSettings({ ...settings.normalize(), highlightCascadeLinesEnabled: true, highlightCascadeLinesHoldEnabled: true });
  const noDragBoard = { querySelector: () => null, closest: () => null };
  const hoverEntry = { hoveredSquare: { row: 4, col: 4 } };
  assert.deepEqual({ ...context.testing.getDefenseLineHoldRoot(noDragBoard, hoverEntry, position, null, null, null) }, { row: 4, col: 4 });
  assert.equal(context.testing.getDefenseLineHoldRoot(noDragBoard, { hoveredSquare: { row: 3, col: 3 } }, position, null, null, null), null);
  assert.equal(context.testing.getDefenseLineHoldRoot(noDragBoard, { hoveredSquare: { row: 3, col: 3 } }, position,
    { row: 4, col: 4 }, position[4][4], null), null);
  assert.deepEqual({ ...context.testing.getDefenseLineHoldRoot(noDragBoard,
    { hoveredSquare: { row: 3, col: 3 } }, position, { row: 4, col: 4 }, position[4][4],
    { isHoverPreview: true, source: { row: 6, col: 4 }, target: { row: 4, col: 4 } }) }, { row: 4, col: 4 });
  const draggingBoard = { querySelector: () => ({}), closest: () => null };
  assert.deepEqual({ ...context.testing.getDefenseLineHoldRoot(draggingBoard,
    { hoveredSquare: { row: 3, col: 3 } }, position, { row: 4, col: 4 }, position[4][4], null) }, { row: 4, col: 4 });
  const movedPosition = Array.from({ length: 8 }, () => Array(8).fill(null));
  movedPosition[3][3] = "wR";
  const hoverMove = { position: movedPosition, legal: true, target: { row: 3, col: 3 },
    source: { row: 4, col: 4 }, blackOrientation: false, isHoverPreview: true };
  const hoverMovePosition = context.testing.readDragPreview(hoverMove);
  assert.deepEqual({ ...hoverMovePosition.selected }, { row: 3, col: 3 });
  assert.deepEqual({ ...context.testing.getDefenseLineHoldRoot(noDragBoard,
    { hoveredSquare: { row: 3, col: 3 } }, hoverMovePosition.position, hoverMovePosition.selected,
    hoverMovePosition.position[3][3], hoverMove) }, { row: 3, col: 3 });
  context.testing.setSettings({ ...settings.normalize(), highlightCascadeLinesHoldEnabled: false });
  assert.equal(context.testing.getDefenseLineHoldRoot(noDragBoard, hoverEntry, position, null, null, null), null);
  const layers = context.testing.getDefenseCascadeLayers(position, { row: 4, col: 4 }, false, 6);
  assert.deepEqual(Array.from(layers, layer => Array.from(layer, square => [square.row, square.col])), [
    [[4, 4]], [[2, 5]]
  ]);
  context.testing.setSettings({ threatenedPieceOutlineEnabled: true, defenseCirclesEnabled: true });
  const cachedAnalysis = context.testing.getPositionAnalysis(position, false);
  assert.equal(context.testing.getPositionAnalysis(position, false), cachedAnalysis);
  assert.notEqual(context.testing.getPositionAnalysis(position, true), cachedAnalysis);
  assert.deepEqual(Array.from(context.testing.getHighlightCascadeConnections(position, layers, false, false), edge => [
    [edge.from.row, edge.from.col], [edge.to.row, edge.to.col], edge.depth
  ]), [
    [[4, 4], [2, 5], 1]
  ]);
  const directOnly = context.testing.getDefenseCascadeLayers(position, { row: 4, col: 4 }, false, 1);
  assert.deepEqual(Array.from(directOnly, layer => layer.length), [1, 1]);
  assert.ok(Math.abs(context.testing.getDefenseHighlightMix(0.5, 0, 80, 25) - 0.8) < 1e-12);
  assert.ok(Math.abs(context.testing.getDefenseHighlightMix(0.5, 1, 80, 25) - 0.6) < 1e-12);
  const previewEntry = { defensePreviewLastTargetKey: null };
  assert.equal(context.testing.isNewDefensePreviewTarget(previewEntry, "A"), true);
  assert.equal(context.testing.isNewDefensePreviewTarget(previewEntry, "A"), false);
  assert.equal(context.testing.isNewDefensePreviewTarget(previewEntry, "B"), true);
  assert.equal(context.testing.isNewDefensePreviewTarget(previewEntry, "A"), true);
  const moveEntry = { defenseLastMoveKey: null, defensePlayedMoveKeys: new Set(["1,0:3,0"]) };
  assert.equal(context.testing.getPreviewMoveKey({
    source: { row: 1, col: 0 }, target: { row: 3, col: 0 }, blackOrientation: true
  }), "1,0:3,0");
  const makeSquare = (row, col) => ({
    getBoundingClientRect: () => ({ left: col * 10, top: row * 10, width: 10, height: 10 })
  });
  const board = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 80 }),
    querySelector: () => null,
    querySelectorAll: () => [makeSquare(6, 7), makeSquare(4, 7)]
  };
  const movePosition = Array.from({ length: 8 }, () => Array(8).fill(null));
  movePosition[4][7] = { color: "w", type: "pawn" };
  const lastMove = context.testing.getLastMove(board, movePosition, true);
  assert.deepEqual({ ...lastMove.source }, { row: 6, col: 7 });
  assert.deepEqual({ ...lastMove.target }, { row: 4, col: 7 });
  assert.equal(lastMove.key, "1,0:3,0");
  assert.equal(context.testing.shouldPlayLastMoveCascade(moveEntry, "1,0:3,0"), false);
  assert.equal(moveEntry.defensePlayedMoveKeys.size, 0);
  assert.equal(context.testing.shouldPlayLastMoveCascade(moveEntry, "1,0:3,0"), false);
  assert.equal(context.testing.shouldPlayLastMoveCascade(moveEntry, "1,0:4,0"), true);
  assert.equal(context.testing.shouldPlayLastMoveCascade(moveEntry, "1,0:4,0"), false);
  assert.equal(context.testing.shouldPlayLastMoveCascade(moveEntry, null), false);
  assert.equal(context.testing.shouldPlayLastMoveCascade(moveEntry, "1,0:3,0"), true);
  context.testing.setSettings({
    defenseHighlightWaveIntervalMs: 210,
    defenseHighlightDurationMs: 520,
    defenseHighlightWaveDecayPercent: 20,
    defenseHighlightWhiteMixPercent: 35,
    highlightLineOpacityPercent: 100,
    highlightLineDecayPercent: 20,
  });
  const line = { depth: 2 };
  const run = { startedAt: 1000 };
  assert.deepEqual({ ...context.testing.getHighlightLineState(line, run, 1419) }, { progress: 0, opacity: 0, finished: false });
  const atStart = context.testing.getHighlightLineState(line, run, 1420);
  assert.equal(atStart.progress, 0);
  assert.equal(atStart.opacity, 0);
  assert.equal(atStart.finished, false);
  const atQuarter = context.testing.getHighlightLineState(line, run, 1550);
  assert.ok(Math.abs(atQuarter.progress - 130 / 520) < 1e-12);
  assert.ok(Math.abs(atQuarter.opacity - context.testing.getDefenseHighlightMix(130 / 520, 2, 100, 20)) < 1e-12);
  const atMidpoint = context.testing.getHighlightLineState(line, run, 1680);
  assert.ok(Math.abs(atMidpoint.progress - 0.5) < 1e-12);
  assert.ok(Math.abs(atMidpoint.opacity - 0.64) < 1e-12);
  assert.ok(Math.abs(context.testing.getDefenseHighlightMix(0.5, 2, 35, 20) - 0.224) < 1e-12);
  const atArrival = context.testing.getHighlightLineState(line, run, 1939);
  assert.equal(atArrival.finished, false);
  assert.ok(atArrival.progress > 0.99 && atArrival.opacity > 0);
  assert.deepEqual({ ...context.testing.getHighlightLineState(line, run, 1940) }, { progress: 1, opacity: 0, finished: true });
  context.testing.setSettings({
    defenseHighlightWaveIntervalMs: 210,
    defenseHighlightDurationMs: 520,
    defenseHighlightWaveDecayPercent: 20,
    highlightLineOpacityPercent: 50,
    highlightLineDecayPercent: 0,
  });
  const adjustedLine = context.testing.getHighlightLineState(line, run, 1550);
  assert.ok(Math.abs(adjustedLine.progress - 130 / 520) < 1e-12);
  assert.ok(Math.abs(adjustedLine.opacity - context.testing.getDefenseHighlightMix(130 / 520, 2, 50, 0)) < 1e-12);
  context.testing.setSettings({
    defenseHighlightWaveIntervalMs: 210,
    defenseHighlightDurationMs: 520,
    highlightLineOpacityPercent: 100,
    highlightLineDecayPercent: 20,
  });
  assert.ok(Math.abs(context.testing.getHighlightLineState(line, run, 1550).progress - 130 / 520) < 1e-12);
  const interruptedLine = { depth: 2, fadeOut: { startedAt: 1680, opacity: 0.64, duration: 180 } };
  assert.ok(context.testing.getHighlightLineState(interruptedLine, run, 1770).progress > 0.4);
  assert.ok(Math.abs(context.testing.getHighlightLineState(interruptedLine, run, 1770).opacity - 0.32) < 1e-12);
  assert.equal(context.testing.getHighlightLineState(interruptedLine, run, 1860).finished, true);
  context.testing.setSettings({ defenseHighlightWaveIntervalMs: 210, defenseHighlightDurationMs: 520,
    highlightCascadeLinesHoldEnabled: true, highlightLineOpacityPercent: 100, highlightLineDecayPercent: 20 });
  const heldLine = { depth: 2, held: true,
    fadeOut: { startedAt: 2000, opacity: 0.64, progress: 1, duration: 180, reverse: true } };
  const retracting = context.testing.getHighlightLineState(heldLine, run, 2090);
  assert.equal(retracting.progress, 0.5);
  assert.equal(retracting.opacity, 0.32);
  assert.equal(retracting.shrinking, true);
  assert.equal(retracting.finished, false);
  assert.deepEqual({ ...context.testing.getHighlightLineState(heldLine, run, 2180) },
    { progress: 0, opacity: 0, shrinking: true, finished: true });
  const unprotected = Array.from({ length: 8 }, () => Array(8).fill(null));
  unprotected[4][4] = { color: "w", type: "queen" };
  assert.equal(context.testing.getDefenseCascadeLayers(unprotected, { row: 4, col: 4 }, false, 3).length, 0);

  const attackedPosition = Array.from({ length: 8 }, () => Array(8).fill(null));
  attackedPosition[4][4] = { color: "w", type: "king" };
  attackedPosition[7][4] = { color: "w", type: "rook" };
  attackedPosition[2][5] = { color: "b", type: "knight" };
  attackedPosition[4][7] = { color: "w", type: "bishop" };
  const attackLayers = context.testing.getAttackCascadeLayers(attackedPosition, { row: 4, col: 4 }, false, 3);
  assert.deepEqual(Array.from(attackLayers, layer => Array.from(layer, square => [square.row, square.col])), [
    [[4, 4]], [[2, 5]], [[7, 4]]
  ]);
  assert.deepEqual(Array.from(context.testing.getHighlightCascadeConnections(attackedPosition, attackLayers, true, false), edge => [
    [edge.from.row, edge.from.col], [edge.to.row, edge.to.col], edge.depth
  ]), [
    [[4, 4], [2, 5], 1], [[4, 4], [7, 4], 2]
  ]);
  assert.deepEqual(Array.from(context.testing.getDefenseCascadeLayers(attackedPosition, { row: 4, col: 4 }, false, 3)), [],
    "a king cannot be the root of a defense cascade");
  attackedPosition[7][4] = null;
  assert.equal(context.testing.getAttackCascadeLayers(attackedPosition, { row: 4, col: 4 }, false, 3).length, 2);

  const coordinates = result => Array.from(result, layer => Array.from(layer, square => [square.row, square.col]));
  const battery = Array.from({ length: 8 }, () => Array(8).fill(null));
  battery[6][4] = { color: "w", type: "pawn" };
  battery[4][4] = { color: "w", type: "rook" };
  battery[2][4] = { color: "w", type: "rook" };
  battery[0][4] = { color: "w", type: "queen" };
  battery[2][3] = { color: "w", type: "knight" };
  const unchanged = JSON.stringify(battery);
  const batteryLayers = context.testing.getDefenseCascadeLayers(battery, { row: 6, col: 4 }, false, 6);
  assert.deepEqual(coordinates(batteryLayers), [[[6, 4]], [[4, 4]], [[2, 4]], [[0, 4]]]);
  assert.equal(JSON.stringify(battery), unchanged, "simulations never change the displayed position");
  assert.deepEqual(Array.from(context.testing.getHighlightCascadeConnections(battery, batteryLayers, false, false), edge => [
    [edge.from.row, edge.from.col], [edge.to.row, edge.to.col], edge.depth
  ]), [
    [[6, 4], [4, 4], 1], [[6, 4], [2, 4], 2], [[6, 4], [0, 4], 3]
  ]);
  assert.equal(context.testing.getDefenseCascadeLayers(battery, { row: 6, col: 4 }, false, 1).length, 2);
  battery[3][4] = { color: "b", type: "pawn" };
  assert.deepEqual(coordinates(context.testing.getDefenseCascadeLayers(battery, { row: 6, col: 4 }, false, 6)), [
    [[6, 4]], [[4, 4]]
  ], "a blocker outside earlier waves must stay on the board");
  assert.equal(context.testing.getHighlightCascadeConnections(battery, batteryLayers, false, false).length, 1);

  const diagonal = Array.from({ length: 8 }, () => Array(8).fill(null));
  diagonal[4][4] = { color: "w", type: "knight" };
  diagonal[5][3] = { color: "w", type: "pawn" };
  diagonal[6][2] = { color: "w", type: "bishop" };
  diagonal[7][1] = { color: "w", type: "queen" };
  diagonal[5][0] = { color: "w", type: "rook" };
  const diagonalExpected = [[[4, 4]], [[5, 3]], [[6, 2]], [[7, 1]]];
  assert.deepEqual(coordinates(context.testing.getDefenseCascadeLayers(diagonal, { row: 4, col: 4 }, false, 6)), diagonalExpected);
  const rotatedDiagonal = diagonal.map(row => [...row].reverse()).reverse();
  assert.deepEqual(coordinates(context.testing.getDefenseCascadeLayers(rotatedDiagonal, { row: 3, col: 3 }, true, 6)),
    diagonalExpected.map(layer => layer.map(([row, col]) => [7 - row, 7 - col])));

  const exchange = Array.from({ length: 8 }, () => Array(8).fill(null));
  exchange[4][4] = { color: "w", type: "knight" };
  exchange[3][3] = { color: "b", type: "pawn" };
  exchange[2][2] = { color: "b", type: "bishop" };
  exchange[1][1] = { color: "b", type: "queen" };
  exchange[4][6] = { color: "w", type: "rook" };
  exchange[4][7] = { color: "w", type: "rook" };
  exchange[3][0] = { color: "w", type: "rook" };
  const exchangeLayers = context.testing.getAttackCascadeLayers(exchange, { row: 4, col: 4 }, false, 6);
  const exchangeExpected = [[[4, 4]], [[3, 3]], [[4, 6]], [[2, 2]], [[4, 7]], [[1, 1]]];
  assert.deepEqual(coordinates(exchangeLayers), exchangeExpected,
    "attacking waves alternate sides but always recapture on the root square");
  const exchangeLines = context.testing.getHighlightCascadeConnections(exchange, exchangeLayers, true, false);
  assert.equal(exchangeLines.length, 5);
  assert.ok(exchangeLines.every(edge => edge.from.row === 4 && edge.from.col === 4));
  const rotatedExchange = exchange.map(row => [...row].reverse()).reverse();
  assert.deepEqual(coordinates(context.testing.getAttackCascadeLayers(rotatedExchange, { row: 3, col: 3 }, true, 6)),
    exchangeExpected.map(layer => layer.map(([row, col]) => [7 - row, 7 - col])));
});

test("defense cascades exclude kings while attack cascades keep safe final recaptures", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const context = vm.createContext({ document: { addEventListener() {} } });
  vm.runInContext(readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8")
    .replace("  documentObserver = new MutationObserver", `
      globalThis.testing = { getDefenseCascadeLayers, getAttackCascadeLayers, getHighlightCascadeConnections };
      return;
      documentObserver = new MutationObserver`), context);
  const scenarios = [
    { pieces: [[5, 4, "w", "king"], [3, 3, "b", "pawn"], [2, 2, "b", "bishop"]],
      defense: [], attack: [[[4, 4]], [[3, 3]]] },
    { pieces: [[5, 4, "w", "king"], [3, 3, "b", "pawn"]],
      defense: [], attack: [[[4, 4]], [[3, 3]], [[5, 4]]] },
    { pieces: [[5, 4, "w", "king"], [4, 6, "w", "rook"], [3, 3, "b", "pawn"], [2, 2, "b", "bishop"]],
      defense: [[[4, 4]], [[4, 6]]],
      attack: [[[4, 4]], [[3, 3]], [[4, 6]], [[2, 2]], [[5, 4]]] },
    { pieces: [[5, 4, "w", "king"], [4, 6, "w", "rook"], [3, 3, "b", "pawn"], [2, 2, "b", "bishop"], [1, 1, "b", "queen"]],
      defense: [[[4, 4]], [[4, 6]]], attack: [[[4, 4]], [[3, 3]], [[4, 6]], [[2, 2]]] },
    { pieces: [[4, 5, "w", "king"], [4, 7, "w", "rook"]], defense: [], attack: [] },
    { pieces: [[5, 5, "w", "king"], [6, 6, "b", "bishop"]], defense: [], attack: [] },
    { pieces: [[5, 4, "w", "king"], [3, 5, "b", "king"]], defense: [], attack: [] },
    { pieces: [[5, 4, "w", "king"], [2, 5, "b", "knight"], [3, 3, "b", "pawn"]],
      defense: [], attack: [[[4, 4]], [[2, 5], [3, 3]]] }
  ];
  for (const scenario of scenarios) for (const rotated of [false, true]) {
    const position = Array.from({ length: 8 }, () => Array(8).fill(null));
    const transform = ([row, col]) => rotated ? [7 - row, 7 - col] : [row, col];
    for (const [row, col, color, type] of [[4, 4, "w", "knight"], ...scenario.pieces]) {
      const [r, c] = transform([row, col]);
      position[r][c] = { color, type };
    }
    const [row, col] = transform([4, 4]);
    const root = { row, col };
    const unchanged = JSON.stringify(position);
    for (const isAttack of [false, true]) for (const depth of [1, 6]) {
      const getLayers = isAttack ? context.testing.getAttackCascadeLayers : context.testing.getDefenseCascadeLayers;
      const layers = getLayers(position, root, rotated, depth);
      const expected = (isAttack ? scenario.attack : scenario.defense).slice(0, depth + 1)
        .map(layer => layer.map(transform).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
      assert.deepEqual(Array.from(layers, layer => Array.from(layer, square => [square.row, square.col])),
        expected);
      const connections = context.testing.getHighlightCascadeConnections(position, layers, isAttack, rotated);
      assert.deepEqual(Array.from(connections, edge => [edge.to.row, edge.to.col, edge.depth]),
        expected.slice(1).flatMap((layer, index) => layer.map(square => [...square, index + 1])));
    }
    assert.equal(JSON.stringify(position), unchanged);
  }
});

test("attack and defense share deduplicated figure and line waves in both directions", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  let now = 1000;
  const element = () => ({
    attributes: {}, children: [], style: {
      values: {}, setProperty(key, value) { this.values[key] = value; },
      removeProperty(key) { delete this.values[key]; }
    },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
    remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  });
  const context = vm.createContext({
    document: { addEventListener() {}, createElementNS: element }, performance: { now: () => now },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    LichessBoardOverlay: { place: (board, svg) => board.append(svg) }
  });
  vm.runInContext(readFileSync(join(__dirname, "highlight-line-preview.js"), "utf8"), context);
  vm.runInContext(readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8")
    .replace("  documentObserver = new MutationObserver", `
      globalThis.testing = { startHighlightCascades, advanceDefenseCascade, getDefenseNodeMix,
        getHighlightLineState, endPreviousDefenseWaves, clearDefenseHighlights, configure(value) { settings = value; } };
      return;
      documentObserver = new MutationObserver`), context);
  const api = context.testing;
  const board = { ...element(), querySelectorAll: () => [] };
  const position = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const [row, color, type] of [[4, "w", "knight"], [6, "w", "rook"], [7, "w", "queen"],
    [1, "b", "rook"], [0, "b", "queen"]]) {
    position[row][4] = { color, type, element: element() };
  }
  const root = { row: 4, col: 4 };
  for (const [defense, attack] of [[true, true], [true, false], [false, true]]) {
    for (const reverse of [false, true]) for (const hold of [false, true]) {
      for (const interval of [0, 210, 1000]) for (const duration of [100, 700]) {
        const options = settings.normalize({ pieceSet: "rund", defenseHighlightDepth: 4,
          defenseHighlightEnabled: defense, attackHighlightEnabled: attack,
          highlightCascadeReverseEnabled: reverse, highlightCascadeLinesHoldEnabled: hold,
          defenseHighlightWaveIntervalMs: interval, defenseHighlightDurationMs: duration,
          defenseHighlightWhiteMixPercent: 100, highlightLineOpacityPercent: 100 });
        api.configure(options);
        const entry = { defenseHighlightedPieces: new Set(), defensePlayedMoveKeys: new Set(), defenseLineHoldRoot: root };
        assert.equal(api.startHighlightCascades(board, entry, position, root, false), true);
        assert.equal(entry.defenseHighlightRuns.length, 1, "both cascades must use one common display plan");
        const run = entry.defenseHighlightRuns[0];
        const nodes = [...run.nodes];
        const lines = [...run.lines];
        assert.equal(nodes.length, attack ? 5 : 3, "each figure is scheduled only once");
        assert.equal(new Set(nodes.map(node => node.element)).size, nodes.length);
        assert.equal(lines.length, nodes.length - 1, "each root connection is drawn only once");
        assert.equal(run.endAt, 1000 + 2 * interval + duration);
        for (const row of attack ? [6, 7, 1, 0] : [6, 7]) {
          const node = nodes.find(node => node.element === position[row][4].element);
          const depth = row === 6 || row === 1 ? 1 : 2;
          assert.equal(node.depth, depth, "attack and defense of the same stage share a depth");
          assert.equal(node.wave, reverse ? 2 - depth : depth);
          const line = lines.find(line => (reverse ? line.fromY : line.toY) === row + 0.5);
          assert.equal(line.depth, depth);
          assert.equal(line.wave, node.wave);
          const atPeak = 1000 + node.wave * interval + duration / 2;
          const nodeMix = api.getDefenseNodeMix(node, run, atPeak);
          if (!hold) {
            const state = api.getHighlightLineState(line, run, atPeak, false);
            assert.ok(Math.abs(state.opacity - nodeMix) < 1e-12, "pulse and figure peak in the same wave");
            assert.equal(state.progress, 0.5);
            assert.equal(state.holding, undefined);
            assert.equal(api.getHighlightLineState(line, run, atPeak + duration / 2, false).finished, true);
          } else {
            const arrival = 1000 + (reverse ? 2 : node.wave) * interval;
            assert.equal(api.getHighlightLineState(line, run, arrival, true).progress, 1);
            if (interval) assert.ok(api.getHighlightLineState(line, run, arrival - 1, true).progress < 1,
              "held lines arrive at the actual target's highlight, including reversed root connections");
          }
        }
        for (let timestamp = 1000; timestamp <= run.endAt + 32; timestamp += 16) {
          entry.defenseHighlightFrame = 0;
          api.advanceDefenseCascade(entry, timestamp);
          for (const node of nodes) {
            const expected = api.getDefenseNodeMix(node, run, timestamp);
            const actual = Number.parseFloat(node.element.style.values["--lfs-defense-highlight-mix"]) || 0;
            assert.ok(Math.abs(actual / 100 - expected) <= 0.000051, "rendered pieces follow their single scheduled wave");
          }
        }
        assert.equal(entry.defenseHighlightRuns.length, hold ? 1 : 0);
        if (hold) assert.ok(run.lines.every(line => line.path.attributes["stroke-dasharray"] === "none"));
        api.clearDefenseHighlights(entry);
      }
    }
  }
  position[5][4] = { color: "w", type: "rook", element: element() };
  for (const reverse of [false, true]) for (const preview of [null, { isHoverPreview: true }, { isHoverPreview: false }]) {
    api.configure(settings.normalize({ pieceSet: "rund", defenseHighlightDepth: 4,
      highlightCascadeReverseEnabled: reverse, defenseHighlightWaveIntervalMs: 1000, defenseHighlightDurationMs: 100 }));
    const entry = { defenseHighlightedPieces: new Set(), defensePlayedMoveKeys: new Set() };
    api.startHighlightCascades(board, entry, position, root, false, preview);
    const run = entry.defenseHighlightRuns[0];
    assert.equal(run.nodes.length, 6);
    assert.equal(run.lines.length, 5);
    assert.equal(run.maxDepth, 3, "unequal cascade lengths use the longest shared display plan");
    assert.equal(run.endAt, 4100);
    const rootNode = run.nodes.find(node => node.depth === 0);
    assert.equal(rootNode.wave, reverse ? 3 : 0, "the root is scheduled exactly once, including reverse previews");
    assert.equal(rootNode.previewRoot, Boolean(preview?.isHoverPreview));
    assert.equal(run.nodes.find(node => node.element === position[5][4].element).wave, reverse ? 2 : 1);
    assert.equal(run.nodes.find(node => node.element === position[1][4].element).wave, reverse ? 2 : 1);
    api.advanceDefenseCascade(entry, 1000 + rootNode.wave * 1000 + 50);
    assert.equal(entry.defensePreviewMix > 0, Boolean(preview?.isHoverPreview));
    api.clearDefenseHighlights(entry);
  }
  position[5][4] = null;
  const reverseHeld = settings.normalize({ pieceSet: "rund", defenseHighlightDepth: 4,
    highlightCascadeReverseEnabled: true, highlightCascadeLinesHoldEnabled: true,
    defenseHighlightWaveIntervalMs: 1000, defenseHighlightDurationMs: 100 });
  api.configure(reverseHeld);
  const entry = { defenseHighlightedPieces: new Set(), defensePlayedMoveKeys: new Set(), defenseLineHoldRoot: root };
  api.startHighlightCascades(board, entry, position, root, false);
  const interrupted = entry.defenseHighlightRuns[0];
  api.advanceDefenseCascade(entry, 1100);
  const growing = interrupted.lines.filter(line => line.path.attributes.visibility === "visible");
  const lengths = growing.map(line => api.getHighlightLineState(line, interrupted, 1100, true).progress);
  assert.equal(growing.length, 2);
  entry.defenseLineHoldRoot = null;
  api.endPreviousDefenseWaves(entry, 1100, false);
  api.advanceDefenseCascade(entry, 1190);
  growing.forEach((line, index) => {
    const state = api.getHighlightLineState(line, interrupted, 1190, false);
    assert.ok(Math.abs(state.progress - lengths[index] / 2) < 1e-12,
      "interrupting reversed growth retracts the existing length without a jump");
    assert.equal(state.shrinking, true);
  });
  api.advanceDefenseCascade(entry, 1280);
  assert.equal(entry.defenseHighlightRuns.length, 0);
  api.clearDefenseHighlights(entry);

  entry.defenseLineHoldRoot = root;
  api.startHighlightCascades(board, entry, position, root, false);
  const previous = entry.defenseHighlightRuns[0];
  api.advanceDefenseCascade(entry, 1100);
  const previousVisible = previous.lines.filter(line => line.path.attributes.visibility === "visible");
  const movedPosition = position.map(rank => rank.slice());
  movedPosition[4][4] = null;
  movedPosition[3][4] = position[4][4];
  const previewRoot = { row: 3, col: 4 };
  entry.defenseLineHoldRoot = previewRoot;
  api.endPreviousDefenseWaves(entry, 1100, true);
  now = 1100;
  api.startHighlightCascades(board, entry, movedPosition, previewRoot, false, { isHoverPreview: true });
  for (const timestamp of [1100, 1116, 2000, 2100]) {
    api.advanceDefenseCascade(entry, timestamp);
    assert.ok(previousVisible.every(line => line.path.parent && line.path.attributes.visibility === "visible"),
      "reversed preview replacement retains visible lines while deeper replacements are still growing");
    assert.equal(previous.waitingForReplacement, true);
  }
  api.advanceDefenseCascade(entry, 2116);
  assert.equal(previous.waitingForReplacement, false);
  api.advanceDefenseCascade(entry, 2296);
  assert.ok(previousVisible.every(line => !line.path.parent));
  api.advanceDefenseCascade(entry, 3150);
  assert.ok(entry.defensePreviewMix > 0, "the replacement preview highlights its root in the final reversed wave");
  api.clearDefenseHighlights(entry);

  const kingPosition = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const [row, col, color, type] of [[4, 4, "w", "knight"], [5, 4, "w", "king"],
    [4, 6, "w", "rook"], [3, 3, "b", "pawn"], [2, 2, "b", "bishop"]]) {
    kingPosition[row][col] = { color, type, element: element() };
  }
  for (const reverse of [false, true]) for (const attack of [false, true]) {
    api.configure(settings.normalize({ pieceSet: "rund", defenseHighlightDepth: 6,
      attackHighlightEnabled: attack, highlightCascadeReverseEnabled: reverse }));
    api.startHighlightCascades(board, entry, kingPosition, root, false);
    const run = entry.defenseHighlightRuns[0];
    if (!attack) {
      assert.ok(run.nodes.every(node => node.element !== kingPosition[5][4].element),
        "the king never receives a defense highlight");
      assert.ok(run.lines.every(line => line.fromY !== 5.5 && line.toY !== 5.5),
        "defense lines never end at or originate from the king");
    }
    api.clearDefenseHighlights(entry);
  }
  kingPosition[1][1] = { color: "b", type: "queen", element: element() };
  api.startHighlightCascades(board, entry, kingPosition, root, false);
  assert.ok(entry.defenseHighlightRuns[0].nodes.every(node => node.element !== kingPosition[5][4].element));
  assert.ok(entry.defenseHighlightRuns[0].lines.every(line => line.fromY !== 5.5));
  api.clearDefenseHighlights(entry);
});

test("held SVG lines survive selection, preview waits and replacement before retracting", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  let now = 0;
  let dragging = false;
  let nextFrame = 0;
  const frames = new Map();
  const element = () => ({
    attributes: {}, children: [], style: { setProperty() {} },
    get firstElementChild() { return this.children[0] ?? null; },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
    remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  });
  const board = {
    querySelector: selector => selector.includes("dragging") && dragging ? {} : null,
    querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ width: 640, height: 640 }),
    append(child) { child.parent = this; },
    children: []
  };
  const context = vm.createContext({
    document: { addEventListener() {}, createElementNS: element },
    chrome: { runtime: { getURL: asset => `extension://${asset}` } },
    LichessSettings: settings,
    performance: { now: () => now },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: () => 1, clearTimeout() {},
    LichessBoardOverlay: { place: (board, svg) => board.append(svg) }
  });
  vm.runInContext(readFileSync(join(__dirname, "highlight-line-preview.js"), "utf8"), context);
  vm.runInContext(readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8")
    .replace("  documentObserver = new MutationObserver", `
      globalThis.testing = { updateDefenseHighlight, readDragPreview, clearDefenseHighlights,
        configure(value) { settings = value; }, createHighlightLineMask, syncHighlightLineMasks, releaseHighlightLineMask };
      return;
      documentObserver = new MutationObserver`), context);
  const api = context.testing;
  const options = settings.normalize({ highlightCascadeLinesHoldEnabled: true });
  api.configure({ ...options, pieceSet: "cage" });
  const maskDefs = element();
  const maskEntry = { highlightLineDefs: maskDefs };
  const maskPosition = Array.from({ length: 8 }, () => Array(8).fill(null));
  maskPosition[2][4] = { color: "b", type: "queen" };
  maskPosition[3][2] = { color: "w", type: "knight" };
  maskPosition[4][4] = { color: "w", type: "rook" };
  maskPosition[5][3] = { color: "b", type: "pawn" };
  maskPosition[6][2] = { color: "w", type: "bishop" };
  maskPosition[7][4] = { color: "w", type: "king" };
  api.configure({ ...options, pieceSet: "cage", defenseHighlightLineMaskBlurPx: 2 });
  const mask = api.createHighlightLineMask(maskEntry, board, maskPosition, false);
  const reusedMask = api.createHighlightLineMask(maskEntry, board, maskPosition, false);
  assert.equal(mask, reusedMask, "identical positions share one static cage mask");
  assert.equal(mask.references, 2);
  assert.equal(mask.blur.attributes.stdDeviation, "0.025 0.025");
  const paths = mask.mask.children[1].children;
  assert.equal(paths.length, 5, "all five available cage-piece bounds become mask paths; no king asset exists");
  const boundsByType = new Map([
    ["queen", "M 4.14241301 2.14241039 H 4.85289572 V 2.85289299 H 4.14241301 Z"],
    ["knight", "M 2.14241435 3.14241039 H 2.85290008 V 3.85289861 H 2.14241435 Z"],
    ["rook", "M 4.14221585 4.14241192 H 4.85309753 V 4.85329284 H 4.14221585 Z"],
    ["pawn", "M 3.19615882 5.29301634 H 3.7967371 V 5.74636993 H 3.19615882 Z"],
    ["bishop", "M 2.14221704 6.1424122 H 2.85309716 V 6.85289664 H 2.14221704 Z"]
  ]);
  for (const [type, pathData] of boundsByType) {
    const path = paths.find(candidate => candidate.attributes.d === pathData);
    assert.ok(path, `${type} uses the normalized bounds of its Cage SVG`);
  }
  const pawnMaskPath = paths.find(path => path.attributes.d === "M 3.19615882 5.29301634 H 3.7967371 V 5.74636993 H 3.19615882 Z");
  assert.equal(pawnMaskPath.attributes.transform, "rotate(180 3.5 5.5)");
  api.configure({ ...options, pieceSet: "cage", defenseHighlightLineMaskBlurPx: 3 });
  api.syncHighlightLineMasks(maskEntry, board);
  assert.equal(mask.blur.attributes.stdDeviation, "0.0375 0.0375");
  api.releaseHighlightLineMask(maskEntry, mask);
  assert.equal(mask.mask.parent, maskDefs, "shared mask stays until its last run releases it");
  api.releaseHighlightLineMask(maskEntry, reusedMask);
  assert.equal(maskDefs.children.length, 0);
  assert.equal(maskEntry.highlightLineMaskCache.size, 0);
  api.configure({ ...options, pieceSet: "system_rund", defenseHighlightLineMaskBlurPx: 2 });
  for (const blackOrientation of [false, true]) {
    const roundMask = api.createHighlightLineMask(maskEntry, board, maskPosition, blackOrientation);
    const reusedRoundMask = api.createHighlightLineMask(maskEntry, board, maskPosition, blackOrientation);
    assert.equal(roundMask, reusedRoundMask);
    assert.equal(roundMask.blur.attributes.stdDeviation, "0.025 0.025");
    const circles = roundMask.mask.children[1].children;
    assert.equal(circles.length, 5, "System Rund masks every figure including the king, but not the pawn");
    for (const [row, col] of [[2, 4], [3, 2], [4, 4], [6, 2], [7, 4]]) {
      const circle = circles.find(shape => shape.attributes.cx === String(col + 0.5)
        && shape.attributes.cy === String(row + 0.5));
      assert.ok(circle);
      assert.equal(circle.attributes.r, String(5 / 14));
      assert.equal(circle.attributes.fill, "black");
      assert.equal(circle.attributes.transform, undefined);
    }
    api.configure({ ...options, pieceSet: "cage" });
    const cageMask = api.createHighlightLineMask(maskEntry, board, maskPosition, blackOrientation);
    assert.notEqual(cageMask, roundMask, "different figure sets must not share cached masks");
    api.releaseHighlightLineMask(maskEntry, cageMask);
    api.releaseHighlightLineMask(maskEntry, roundMask);
    api.releaseHighlightLineMask(maskEntry, reusedRoundMask);
    api.configure({ ...options, pieceSet: "system_rund", defenseHighlightLineMaskBlurPx: 2 });
  }
  assert.equal(maskDefs.children.length, 0);
  assert.equal(maskEntry.highlightLineMaskCache.size, 0);
  api.configure({ ...options, pieceSet: "cage" });
  const position = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const [row, col, type] of [[4, 4, "rook"], [5, 3, "pawn"], [6, 2, "bishop"], [7, 4, "rook"]]) {
    position[row][col] = { color: "w", type, element: { ...element(), style: { setProperty() {}, removeProperty() {} } } };
  }
  const entry = {
    hoveredSquare: { row: 4, col: 4 }, defenseHighlightRuns: [],
    defenseHighlightedPieces: new Set(), defensePlayedMoveKeys: new Set(), highlightLineDefs: element()
  };
  const parsed = { position, selected: null, blackOrientation: false };
  function update(time, preview = null, selected = null) {
    now = time;
    api.updateDefenseHighlight(board, entry, preview ? api.readDragPreview(preview) : { ...parsed, selected }, preview);
  }
  function frame(time) {
    now = time;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(time));
  }
  function preview(row, col, isHoverPreview = true) {
    const basePosition = position.map(rank => rank.map(piece => piece ? `w${piece.type === "pawn" ? "P" : piece.type === "bishop" ? "B" : "R"}` : null));
    const moved = basePosition.map(rank => [...rank]);
    moved[4][4] = null;
    moved[row][col] = "wR";
    return { source: { row: 4, col: 4 }, target: { row, col }, legal: true,
      blackOrientation: false, isHoverPreview, basePosition, position: moved };
  }
  const visible = line => line.path.parent && line.path.attributes.visibility === "visible"
    && Number(line.path.attributes["stroke-opacity"]) > 0;
  update(0);
  update(200);
  frame(216);
  const initial = entry.defenseHighlightRuns[0];
  const originalLines = [...initial.lines];
  assert.equal(originalLines[0].path.attributes.mask, `url(#${initial.lineMask.mask.id})`,
    "the mask is attached to the rendered line path");
  assert.equal(initial.lineGroup.attributes.mask, undefined, "the group itself is not the masked target");
  assert.ok(Number(originalLines[0].path.attributes["stroke-dasharray"].split(" ")[0]) > 0);
  frame(1320);
  assert.ok(originalLines.every(line => visible(line) && line.path.attributes["stroke-dasharray"] === "none"));

  update(1400, preview(4, 4));
  frame(1600);
  assert.ok(originalLines.every(line => visible(line) && !line.fadeOut), "selection must not start retracting held hover lines");
  update(1700, preview(3, 4));
  frame(1800);
  assert.ok(originalLines.every(visible), "old lines remain during the preview threshold");
  update(1900, preview(3, 4));
  assert.ok(originalLines.every(visible), "replacement is initially hidden, so the existing SVG paths must stay visible");
  assert.deepEqual({ ...entry.defenseLineHoldRoot }, { row: 3, col: 4 });
  const replacement = entry.defenseHighlightRuns.find(run => !run.retiring);
  assert.deepEqual({ ...replacement.root }, { row: 3, col: 4 });
  assert.match(replacement.lines[0].path.attributes.d, /^M 4\.5 3\.5 /);
  frame(1900);
  assert.ok(originalLines.every(visible));
  frame(1916);
  assert.ok(replacement.lines.every(visible));
  frame(2006);
  assert.ok(originalLines.every(line => visible(line) && Number(line.path.attributes["stroke-dashoffset"]) < 0));
  frame(2096);
  assert.ok(originalLines.every(line => !line.path.parent));
  frame(2810);
  assert.equal(replacement.lines[0].path.attributes["stroke-dasharray"], "none");

  update(2900, preview(2, 4));
  frame(3000);
  update(3010, preview(3, 4));
  frame(3110);
  assert.ok(replacement.lines.every(visible), "rapid target changes must not clear the held preview while waiting");
  update(3210, preview(3, 4));
  frame(3226);
  frame(4000);
  const beforeDrag = entry.defenseHighlightRuns.find(run => !run.retiring);
  dragging = true;
  update(4100, preview(4, 4, false));
  frame(4116);
  assert.ok(beforeDrag.lines.every(visible), "hover-to-drag must retain lines until all replacement depths are visible");
  frame(4326);
  assert.ok(beforeDrag.lines.every(visible));
  frame(4506);
  assert.ok(beforeDrag.lines.every(line => !line.path.parent));
  frame(5220);
  const dragged = entry.defenseHighlightRuns.find(run => !run.retiring);
  assert.ok(dragged.lines.every(visible));
  dragging = false;
  entry.hoveredSquare = null;
  update(5300);
  frame(5390);
  assert.ok(dragged.lines.every(line => visible(line) && Number(line.path.attributes["stroke-dashoffset"]) < 0));
  frame(5480);
  assert.equal(entry.defenseHighlightRuns.length, 0);
  assert.equal(entry.highlightLineSvg, null);

  api.clearDefenseHighlights(entry);
  entry.hoveredSquare = { row: 4, col: 4 };
  update(5600, preview(4, 4));
  frame(6720);
  assert.ok(entry.defenseHighlightRuns[0].lines.every(visible), "a selected figure also starts its own hover cascade");
  update(6800, preview(3, 4));
  update(7000, preview(3, 4));
  frame(7016);
  frame(7200);
  frame(7910);
  const targetLines = [...entry.defenseHighlightRuns.find(run => !run.retiring).lines];
  update(8000, preview(4, 4));
  frame(8016);
  assert.ok(targetLines.every(visible), "returning to the source keeps the preview until its replacement grows");
  frame(8226);
  frame(8406);
  frame(9120);
  const sourceRun = entry.defenseHighlightRuns.find(run => !run.retiring);
  assert.deepEqual({ ...sourceRun.root }, { row: 4, col: 4 });
  assert.ok(targetLines.every(line => !line.path.parent));
  entry.hoveredSquare = null;
  update(9200, null, { row: 4, col: 4 });
  frame(9290);
  assert.ok(sourceRun.lines.every(line => visible(line) && Number(line.path.attributes["stroke-dashoffset"]) < 0));
  frame(9380);
  assert.equal(entry.highlightLineSvg, null, "leaving a selected figure retracts without starting another cascade");

  api.clearDefenseHighlights(entry);
  api.configure({ ...options, highlightCascadeLinesHoldEnabled: false });
  entry.hoveredSquare = { row: 4, col: 4 };
  update(10000);
  update(10200);
  frame(10216);
  const transient = [...entry.defenseHighlightRuns[0].lines];
  frame(11320);
  assert.ok(transient.every(line => !line.path.parent), "hold disabled still removes the completed animation");
  assert.equal(entry.highlightLineSvg, null);

  for (const slowClick of [false, true]) {
    api.clearDefenseHighlights(entry);
    if (slowClick) update(12000, null, { row: 4, col: 4 });
    update(12016, preview(4, 4));
    assert.ok(entry.defenseHighlightRuns.length, "both quick and slow selection start the source preview without line holding");
    const selectedRun = entry.defenseHighlightRuns[0];
    update(12032, preview(4, 4));
    assert.equal(entry.defenseHighlightRuns[0], selectedRun, "remaining on the source must not restart the preview");
    frame(13200);
    assert.equal(entry.defenseHighlightRuns.length, 0);
    update(13216, preview(4, 4));
    assert.equal(entry.defenseHighlightRuns.length, 0, "completed source previews must not loop");
    update(13400, preview(3, 4));
    update(13600, preview(3, 4));
    frame(14800);
    update(14816, preview(4, 4));
    assert.ok(entry.defenseHighlightRuns.some(run => run.root.row === 4 && run.root.col === 4),
      "returning from a move destination starts the current figure's preview again");
  }
});

test("hover state follows scrolling, window exit and re-entry without pointer movement", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const listeners = {};
  let top = 0;
  const board = {
    closest: () => board, querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top, right: 800, bottom: top + 800, width: 800, height: 800 })
  };
  const context = vm.createContext({
    document: {
      addEventListener: (name, callback) => { listeners[name] = callback; },
      elementFromPoint: () => board
    },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    requestAnimationFrame: () => 1,
    clearTimeout() {}
  });
  vm.runInContext(readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8")
    .replace("  documentObserver = new MutationObserver", `
      globalThis.testing = { observedBoards };
      return;
      documentObserver = new MutationObserver`), context);
  const entry = {};
  context.testing.observedBoards.set(board, entry);
  const event = { clientX: 450, clientY: 450, target: board };
  listeners.pointermove(event);
  assert.deepEqual({ ...entry.hoveredSquare }, { row: 4, col: 4 });
  entry.previewPointerMotion = { smooth: true };
  top = -100;
  listeners.scroll();
  assert.deepEqual({ ...entry.hoveredSquare }, { row: 5, col: 4 }, "scrolling must recompute the square under the stationary pointer");
  assert.equal(entry.previewPointerMotion, null, "scrolling is not pointer anticipation");
  entry.defenseHoverStartedKey = "hover:5,4:wrook";
  listeners.pointerout({ relatedTarget: null });
  assert.equal(entry.hoveredSquare, null);
  assert.equal(entry.defenseHoverStartedKey, null);
  listeners.pointerover(event);
  assert.deepEqual({ ...entry.hoveredSquare }, { row: 5, col: 4 }, "re-entry must restore hover without pointermove");
  listeners.blur();
  assert.equal(entry.hoveredSquare, null);
  listeners.scroll();
  assert.equal(entry.hoveredSquare, null, "scrolling after blur must not restore stale hover");
});

test("hover anticipation waits for sustained motion and zero restores field animations", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const listeners = {};
  let now = 0;
  let targetCol = 1;
  const context = vm.createContext({
    document: { addEventListener: (name, callback) => { listeners[name] = callback; } },
    performance: { now: () => now },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    LichessThreatCoding: { getInteractionPreview: () => ({
      isHoverPreview: true, source: { row: 0, col: 0 }, target: { row: 0, col: targetCol }
    }) }
  });
  const source = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  vm.runInContext(source.replace("  documentObserver = new MutationObserver", `
    globalThis.testing = { observedBoards, getMovePreviewState, setMovePreviewTarget,
      configure(value) { settings = value; } };
    return;
    documentObserver = new MutationObserver`), context);
  const api = context.testing;
  const board = {
    contains: () => true, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 })
  };
  function runMotion(percent, interval = 16) {
    api.configure(settings.normalize({ movePreviewAnticipationPercent: percent }));
    const entry = { previewPieceSvg: {}, previewTargetKey: "0,0:0,1" };
    api.observedBoards.set(board, entry);
    let firstSmooth = null;
    for (let index = 0; index <= 30; index++) {
      now = index * interval;
      targetCol = index ? 2 : 1;
      listeners.pointermove({ target: board, clientX: 75 + now * 0.5, clientY: 50 });
      if (entry.previewPointerMotion.smooth && firstSmooth === null) firstSmooth = now;
    }
    return { entry, firstSmooth };
  }
  assert.equal(runMotion(100).firstSmooth, 48);
  assert.equal(runMotion(50).firstSmooth, 112);
  assert.equal(runMotion(50, 8).firstSmooth, 104);
  assert.equal(runMotion(10).firstSmooth, 192);
  assert.equal(runMotion(0).firstSmooth, null);

  const { entry } = runMotion(50);
  now += 16;
  listeners.pointermove({ target: board, clientX: 50, clientY: 50 });
  assert.equal(entry.previewPointerMotion.smooth, false);

  entry.previewTranslation = { x: 1, y: 0 };
  entry.previewOpacity = 1;
  entry.previewAnimation = {
    tracking: true, to: { x: 1, y: 0 }, source: { row: 0, col: 0 },
    lastTime: now - 16, velocity: { x: 0, y: 0 }, destinations: [{ x: 2, y: 0 }]
  };
  entry.previewPointerMotion = { smooth: true, time: now, x: 1.9, y: 0.5, vx: 0.01, vy: 0 };
  api.configure(settings.normalize({ movePreviewAnticipationPercent: 100 }));
  const original = api.getMovePreviewState(entry, now);
  assert.ok(Math.abs(original.x - (2 - 1.56 * Math.exp(-0.56))) < 1e-12);
  api.configure(settings.normalize({ movePreviewAnticipationPercent: 50 }));
  assert.ok(api.getMovePreviewState(entry, now).x < original.x);

  api.configure(settings.normalize({ movePreviewAnticipationPercent: 0 }));
  entry.previewTranslation = { x: 0.5, y: 0 };
  entry.previewSourceKey = "0,0";
  entry.previewTargetKey = "0,0:0,1";
  entry.previewPieceGroup = { setAttribute: () => {} };
  api.setMovePreviewTarget(board, entry,
    { source: { row: 0, col: 0 }, target: { row: 0, col: 1 } },
    { row: 0, col: 0 }, { row: 0, col: 1 });
  assert.equal(entry.previewAnimation?.tracking, undefined);
  assert.ok(entry.previewAnimation.duration >= 150 && entry.previewAnimation.duration <= 180);
});

test("OKLCH percentages, hue normalization and alpha survive conversion", () => {
  const color = colors.parse("oklch(50% 25% -30deg / 50%)");
  assert.deepEqual(color, { l: 0.5, c: 0.1, h: 330, alpha: 0.5 });
  assert.equal(colors.parse(colors.toOklch("#abc8")).alpha, Number((136 / 255).toFixed(10)));
  assert.equal(colors.toOklch("oklch(0.5 0.1 390)"), "oklch(0.5 0.1 30)");
  for (const value of [null, "", "red", "oklch(NaN 0 0)", "oklch(0.5 -1 0)", "oklch(1.1 0 0)", "oklch(0.5 0 0 / 2)", "oklch(0.5 0 1e999)"]) {
    assert.equal(colors.parse(value), null);
  }
});

test("gamut mapping reduces chroma without shifting lightness or hue", () => {
  const original = { l: 0.65, c: 0.4, h: 30, alpha: 1 };
  const mapped = colors.toGamut(original);
  assert.equal(mapped.l, original.l);
  assert.equal(mapped.h, original.h);
  assert.equal(mapped.alpha, original.alpha);
  assert.ok(mapped.c > 0 && mapped.c < original.c);
  assert.ok(colors.toRgb(mapped).every(channel => channel >= -0.0001 && channel <= 255.0001));
  const existing = colors.parse("#d1521d");
  assert.equal(colors.toGamut(existing), existing);
});

test("threat mixing retains equal perceptual board contrast for both player colors", () => {
  for (const theme of ["Light", "Dark"]) {
    const light = settings.defaults[`boardLight${theme}`];
    const dark = settings.defaults[`boardDark${theme}`];
    const originalContrast = colors.parse(light).l - colors.parse(dark).l;
    for (const threatMaxMixPercent of [0, 10, 30, 60, 100]) {
      const options = { ...settings.defaults, threatBlendMode: "oklab", threatMaxMixPercent };
      for (const strength of [0, 0.2, 1, 3, 5, 8]) {
        const amount = Math.min(strength / 5, 1) * threatMaxMixPercent / 100;
        for (const sign of [-1, 1]) {
          const mixedLight = colors.parse(threats.getOpacityColor(sign * strength, options, light));
          const mixedDark = colors.parse(threats.getOpacityColor(sign * strength, options, dark));
          assert.ok(Math.abs(mixedLight.l - mixedDark.l - originalContrast * (1 - amount)) < 0.000001,
            `${theme}, ${sign * strength}, ${threatMaxMixPercent}%`);
        }
      }
    }
  }
});

test("threat board base colors keep a1 dark in both themes", () => {
  const previousDocument = globalThis.document;
  try {
    for (const theme of ["light", "dark"]) {
      globalThis.document = {
        documentElement: { classList: { contains: name => name === "light" && theme === "light" } }
      };
      const options = settings.defaults;
      const themeName = theme === "light" ? "Light" : "Dark";
      const light = options[`boardLight${themeName}`];
      const dark = options[`boardDark${themeName}`];
      const assertBoardColor = (row, col, expected) => {
        const actual = threats.getBoardBaseColor(row, col, options);
        colors.toRgb(expected).forEach((channel, index) => assert.ok(Math.abs(actual[index] - channel) < 0.001));
      };
      assertBoardColor(7, 0, dark);
      assertBoardColor(7, 1, light);
      assertBoardColor(6, 0, light);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("threat mixing preserves endpoints and accepts RGB board colors", () => {
  const options = { ...settings.defaults, threatMaxMixPercent: 100 };
  for (const base of ["#424240", "#dedae6", "#12abef"]) {
    assert.equal(colors.toHex(threats.getOpacityColor(0, options, base)), base);
    assert.equal(colors.toHex(threats.getOpacityColor(3, { ...options, threatMaxMixPercent: 0 }, base)), base);
    for (const value of [-5, 5]) {
      const tint = value > 0 ? options.whitePieceColor : options.blackPieceColor;
      assert.equal(colors.toHex(threats.getOpacityColor(value, options, base)), colors.toHex(tint));
    }
    const rgb = colors.toRgb(base);
    const fromRgb = colors.toRgb(threats.getOpacityColor(2, options, rgb));
    const fromString = colors.toRgb(threats.getOpacityColor(2, options, base));
    fromRgb.forEach((channel, index) => assert.ok(Math.abs(channel - fromString[index]) < 0.001));
  }
});

test("saturated custom threat colors keep their intended lightness inside the RGB gamut", () => {
  const options = { ...settings.defaults, threatBlendMode: "oklab", whitePieceColor: "#00ff00", blackPieceColor: "#0000ff", threatMaxMixPercent: 60 };
  for (const base of ["#ff0000", "#ffff00", "#0000ff", "#ffffff", "#000000"]) {
    for (const value of [-5, -1, 1, 5]) {
      const tint = colors.parse(value > 0 ? options.whitePieceColor : options.blackPieceColor);
      const amount = Math.abs(value) / 5 * 0.6;
      const expectedLightness = colors.parse(base).l * (1 - amount) + tint.l * amount;
      const mixed = colors.parse(threats.getOpacityColor(value, options, base));
      assert.ok(Math.abs(mixed.l - expectedLightness) < 0.000001);
      assert.ok(colors.toRgb(mixed).every(channel => channel >= -0.001 && channel <= 255.001));
    }
  }
});

test("rasterized threat backgrounds retain balanced contrast within RGB8 precision", () => {
  for (const theme of ["Light", "Dark"]) {
    const options = settings.defaults;
    const originalContrast = colors.parse(options[`boardLight${theme}`]).l - colors.parse(options[`boardDark${theme}`]).l;
    const contrasts = [];
    for (const value of [-5, 5]) {
      const grid = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) =>
        colors.toRgb(threats.getOpacityColor(value, options, options[`board${(row + col) % 2 ? "Dark" : "Light"}${theme}`]))
      ));
      const pixels = threats.getThreatPixels(grid, 0);
      const light = colors.fromRgb([...pixels.slice((16 * 256 + 16) * 4, (16 * 256 + 16) * 4 + 3)]);
      const dark = colors.fromRgb([...pixels.slice((16 * 256 + 48) * 4, (16 * 256 + 48) * 4 + 3)]);
      const contrast = light.l - dark.l;
      assert.ok(Math.abs(contrast - originalContrast * (1 - options.threatMaxMixPercent / 100)) < 0.003);
      contrasts.push(contrast);
    }
    assert.ok(Math.abs(contrasts[0] - contrasts[1]) < 0.003);
  }
});

test("blend mode settings survive saving and reject unsupported values", () => {
  assert.equal(settings.normalize().threatBlendMode, "normal");
  for (const mode of ["oklab", "normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten", "difference"]) {
    const normalized = settings.normalize({ threatBlendMode: mode });
    assert.equal(normalized.threatBlendMode, mode);
    assert.equal(settings.normalize(JSON.parse(JSON.stringify(normalized))).threatBlendMode, mode);
  }
  for (const mode of [undefined, null, "", "invalid", "__proto__", "toString", 1, {}]) {
    const normalized = settings.normalize({ threatBlendMode: mode });
    assert.equal(normalized.threatBlendMode, settings.defaults.threatBlendMode);
    assert.equal(threats.getOpacityColor(3, normalized, "#424240"),
      threats.getOpacityColor(3, settings.defaults, "#424240"));
  }
});

test("standard blend modes follow sRGB formulas and apply strength after blending", () => {
  const base = [0.25, 0.75, 0.125].map(channel => channel * 255);
  const tint = colors.format(colors.fromRgb([0.75, 0.25, 0.75].map(channel => channel * 255)));
  const expected = {
    normal: [0.75, 0.25, 0.75],
    multiply: [0.1875, 0.1875, 0.09375],
    screen: [0.8125, 0.8125, 0.78125],
    overlay: [0.375, 0.625, 0.1875],
    "soft-light": [0.375, 0.65625, 0.234375],
    "hard-light": [0.625, 0.375, 0.5625],
    darken: [0.25, 0.25, 0.125],
    lighten: [0.75, 0.75, 0.75],
    difference: [0.5, 0.5, 0.625]
  };
  for (const [threatBlendMode, blended] of Object.entries(expected)) {
    for (const threatMaxMixPercent of [0, 30, 100]) {
      const options = { ...settings.defaults, threatBlendMode, threatMaxMixPercent, whitePieceColor: tint, blackPieceColor: tint };
      for (const strength of [0, 1, 5, 8]) {
        const amount = Math.min(strength / 5, 1) * threatMaxMixPercent / 100;
        for (const sign of [-1, 1]) {
          const result = colors.toRgb(threats.getOpacityColor(sign * strength, options, base));
          result.forEach((channel, index) => {
            const expectedChannel = base[index] + (blended[index] * 255 - base[index]) * amount;
            assert.ok(Math.abs(channel - expectedChannel) < 0.001, `${threatBlendMode}, ${sign * strength}, channel ${index}`);
          });
        }
      }
    }
  }
});

test("soft light uses the square root branch on bright backgrounds", () => {
  const gray = colors.format(colors.fromRgb([191.25, 191.25, 191.25]));
  const options = { ...settings.defaults, threatBlendMode: "soft-light", threatMaxMixPercent: 100, whitePieceColor: gray };
  const result = colors.toRgb(threats.getOpacityColor(5, options, gray));
  const expected = (0.75 + 0.5 * (Math.sqrt(0.75) - 0.75)) * 255;
  result.forEach(channel => assert.ok(Math.abs(channel - expected) < 0.001));
});

test("all blend modes produce finite in-gamut colors at black and white boundaries", () => {
  for (const threatBlendMode of ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten", "difference"]) {
    for (const base of ["#000000", "#ffffff", "#808080"]) {
      for (const tint of ["#000000", "#ffffff", "#808080"]) {
        const options = { ...settings.defaults, threatBlendMode, threatMaxMixPercent: 100, whitePieceColor: tint, blackPieceColor: tint };
        for (const value of [-5, 5]) {
          const channels = colors.toRgb(threats.getOpacityColor(value, options, base));
          assert.ok(channels.every(channel => Number.isFinite(channel) && channel >= -0.001 && channel <= 255.001));
          assert.equal(colors.toHex(threats.getOpacityColor(0, options, base)), base);
        }
      }
    }
  }
});

test("board SVG rendering preserves piece masks and round king fields", { skip: ![
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].some(path => path && require("node:fs").existsSync(path)) }, async t => {
  const { spawn } = require("node:child_process");
  const { createServer } = require("node:http");
  const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const root = __dirname;
  const chromePath = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].find(path => path && existsSync(path));
  const source = readFileSync(join(root, "selected-piece-wedge.js"), "utf8");
  const marker = "  documentObserver = new MutationObserver";
  assert.ok(source.includes(marker), "the production board logic exposes its renderer before installing observers");
  const testSource = source.replace(marker, `
    globalThis.testing = {
      readPosition,
      renderMoveOutline,
      renderMovePreviewPiece,
      clearMovePreviewPiece,
      createHighlightLineMask,
      updateDefenseHighlight,
      advanceDefenseCascade,
      renderThreatSegmentsInto,
      renderThreatArcs,
      clearDefenseHighlights,
      configure(value) { settings = value; },
    };
    return;
${marker}`);
  const requestedAssets = new Set();
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/extension.css"><style>
    * { box-sizing: border-box; }
    html, body { width: 512px; height: 512px; margin: 0; overflow: hidden; }
    .cg-wrap { position: relative; width: 512px; height: 512px; }
    cg-board { position: absolute; inset: 0; display: block; width: 512px; height: 512px; overflow: hidden; background: #dddddd; }
    square { position: absolute; z-index: 1; display: block; width: 12.5%; height: 12.5%; }
    piece { position: absolute; z-index: 2; display: block; width: 12.5%; height: 12.5%; }
    svg[data-lfs-board-overlay] { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }
  </style></head><body><div class="is2d"><div class="cg-wrap orientation-white"><cg-board>
    <square class="selected" style="left:50%;top:50%"></square>
    <piece class="white pawn" style="left:50%;top:50%"></piece>
    <piece class="white knight" style="left:62.5%;top:25%"></piece>
  </cg-board></div></div>
  <style>:root { --lfs-white-piece-color:#35608d; --lfs-black-piece-color:#35608d;
    --lfs-piece-wp:url('/cage/cage_p.svg'); --lfs-piece-wn:url('/cage/cage_n.svg'); }</style>
  <script>window.chrome = { runtime: { getURL: path => location.origin + '/' + path } };</script>
  <script src="/colors.js"></script><script src="/settings.js"></script><script src="/king-movement-fields.js"></script>
   <script src="/board-overlay.js"></script><script src="/highlight-line-preview.js"></script><script src="/threat-coding.js"></script><script src="/selected-piece-wedge.js"></script>
  </body></html>`;
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
      return;
    }
    if (["/board-overlay.js", "/highlight-line-preview.js", "/colors.js", "/settings.js", "/king-movement-fields.js", "/threat-coding.js"].includes(path)) {
      response.setHeader("Content-Type", "text/javascript; charset=utf-8");
      response.end(readFileSync(join(root, path.slice(1))));
      return;
    }
    if (path === "/extension.css") {
      response.setHeader("Content-Type", "text/css; charset=utf-8");
      response.end(readFileSync(join(root, path.slice(1))));
      return;
    }
    if (path === "/selected-piece-wedge.js") {
      response.setHeader("Content-Type", "text/javascript; charset=utf-8");
      response.end(testSource);
      return;
    }
    if (/^\/cage\/cage_[pnbrq]\.svg$/.test(path) || /^\/system_rund\/b[kqrbn]\.svg$/.test(path) || path === "/system_rund/bp_2.svg") {
      requestedAssets.add(path);
      response.setHeader("Content-Type", "image/svg+xml");
      response.end(readFileSync(join(root, path.slice(1))));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
  const profile = mkdtempSync(join(tmpdir(), "lfs-cage-mask-"));
  const debugPort = await new Promise((resolve, reject) => {
    const probe = require("node:net").createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
  let browser;
  let socket;
  try {
    browser = spawn(chromePath, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--no-sandbox",
      "--remote-allow-origins=*", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
      "--window-size=512,512", `http://127.0.0.1:${server.address().port}/`
    ], { stdio: "ignore" });
    const versionUrl = `http://127.0.0.1:${debugPort}/json/version`;
    let page;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (browser.exitCode !== null) throw new Error(`Chromium exited with ${browser.exitCode}`);
      try {
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json());
        page = targets.find(target => target.type === "page");
        if (page) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(page, `Chromium DevTools did not start at ${versionUrl}`);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let nextCommandId = 0;
    const pending = new Map();
    const runtimeErrors = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.text);
      if (!message.id) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextCommandId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (await evaluate("Boolean(window.testing)")) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(await evaluate("Boolean(window.testing)"), true, "the browser loaded the production renderer");
    await t.test("zen clocks follow both half-board contours and shrink along their paths", async () => {
      const contentSource = readFileSync(join(root, "content.js"), "utf8");
      const clockMarker = "  chrome.runtime.onMessage.addListener";
      assert.ok(contentSource.includes(clockMarker));
      await evaluate(contentSource.replace(clockMarker, `
        globalThis.clockTesting = {
          ensureZenClockOverlay, positionZenClock, updateZenClock,
          configure(value) { settings = normalize(value); },
          get rows() { return zenClockRows; }
        };
        return;
${clockMarker}`));
      for (const size of [512, 320]) for (const shape of ["round", "bevel", "square"]) {
        await send("Emulation.setDeviceMetricsOverride", { width: size + 100, height: size + 160, deviceScaleFactor: 1, mobile: size === 320 });
        const result = await evaluate(`(() => {
          document.documentElement.setAttribute('data-lfs-zen-mode', '');
          clockTesting.configure({ boardFieldShape: '${shape === "square" ? "round" : shape}', boardBevelEnabled: ${shape !== "square"},
            boardRoundPercent: 100, boardBevelPercent: 100, zenClockMarginPx: 4, zenClockLineThicknessPx: 6,
            zenClockShowTimeOnlyWhenLow: false });
          clockTesting.ensureZenClockOverlay();
          const overlay = document.querySelector('#lfs-zen-clock-overlay');
          overlay.style.setProperty('--lfs-zen-clock-line-thickness', '6px');
          overlay.style.setProperty('--lfs-zen-clock-font-size', '27px');
          const rect = { left: 50, top: 80, width: ${size}, height: ${size}, bottom: ${size + 80} };
          const results = ['top', 'bottom'].map(side => {
            const source = document.createElement('div');
            source.className = 'clock'; source.textContent = '1:00';
            clockTesting.updateZenClock(side, source, 0);
            clockTesting.positionZenClock(side, rect);
            const { bar, fill, warning, end, time, row } = clockTesting.rows[side];
            const total = fill.getTotalLength();
            const start = fill.getPointAtLength(0), finish = fill.getPointAtLength(total);
            const midpoint = fill.getPointAtLength(total / 2);
            source.textContent = '0:30'; clockTesting.updateZenClock(side, source, 1000);
            const half = fill.getAttribute('stroke-dasharray');
            source.classList.add('running'); clockTesting.updateZenClock(side, source, 1000);
            const runningVisible = getComputedStyle(end).display !== 'none';
            clockTesting.updateZenClock(side, source, 1500);
            const flowing = Number(fill.getAttribute('stroke-dasharray').split(' ')[0]) < 50;
            source.classList.remove('running'); source.textContent = '0:00'; clockTesting.updateZenClock(side, source, 2000);
            return { start: [start.x, start.y], finish: [finish.x, finish.y], middle: [midpoint.x, midpoint.y],
              rounded: fill.getAttribute('d').includes('A '), half, zero: fill.getAttribute('stroke-dasharray'),
              warning: warning.getAttribute('stroke-dasharray'), strokeWidth: getComputedStyle(fill).strokeWidth,
              fill: getComputedStyle(fill).fill, runningVisible, flowing,
              outside: side === 'top' ? row.getBoundingClientRect().bottom <= rect.top - 10 : row.getBoundingClientRect().top >= rect.bottom + 10,
              bar: [bar.getBoundingClientRect().left, bar.getBoundingClientRect().top] };
          });
          document.documentElement.removeAttribute('data-lfs-zen-mode');
          return results;
        })()`);
        for (const [index, clock] of result.entries()) {
          assert.deepEqual(clock.start, [3, size / 2 + 10]);
          assert.deepEqual(clock.finish, [size + 17, size / 2 + 10]);
          assert.ok(Math.abs(clock.middle[0] - (size / 2 + 10)) < 0.01);
          assert.ok(Math.abs(clock.middle[1] - (index === 0 ? 3 : size + 17)) < 0.01);
          assert.equal(clock.rounded, shape === "round");
          assert.equal(clock.half, "50 100");
          assert.equal(clock.zero, "0 100");
          assert.equal(clock.warning, "0 100");
          assert.equal(clock.strokeWidth, "6px");
          assert.equal(clock.fill, "none");
          assert.equal(clock.runningVisible, true);
          assert.equal(clock.flowing, true);
          assert.equal(clock.outside, true);
          assert.deepEqual(clock.bar, [40, 70]);
        }
      }
      await send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
      assert.deepEqual(runtimeErrors, []);
    });
    await t.test("rook outlines include occupied a6 destinations from a2 for moves and premoves", async () => {
      for (const destinationClass of ["move-dest", "premove-dest"]) {
        const result = await evaluate(`(() => {
          const board = document.querySelector('cg-board');
          const previous = board.innerHTML;
          const entry = {};
          testing.configure(LichessSettings.normalize({ enabled: true, moveIndicatorMode: 'outline', boardBevelEnabled: false }));
          board.innerHTML = '<square class="selected" style="left:0;top:75%"></square>'
            + '<piece class="white rook" style="left:0;top:75%"></piece>'
            + '<piece class="black pawn" style="left:0;top:25%"></piece>'
            + [2, 3, 4, 5].map(row => '<square class="${destinationClass}' + (row === 2 ? ' oc' : '')
              + '" style="left:0;top:' + row * 12.5 + '%"></square>').join('');
          testing.renderMoveOutline(board, entry, 'w');
          const path = entry.moveOutlineSvg?.querySelector('path[fill="none"]')?.getAttribute('d');
          board.innerHTML = previous;
          return path;
        })()`);
        assert.ok(result?.includes("M0 2L1 2"), `${destinationClass}: the outline must enclose the pawn on a6`);
        assert.ok(!result.includes("M0 3L1 3"), `${destinationClass}: no dividing edge below a6`);
        assert.ok(!result.includes("M0 1L1 1"), `${destinationClass}: no field beyond the capture`);
      }
    });
    const options = settings.normalize({
      pieceSet: "cage", highlightCascadesEnabled: true, defenseHighlightEnabled: true, attackHighlightEnabled: false,
      highlightCascadeLinesEnabled: true, highlightCascadeLinesHoldEnabled: true, defenseHighlightDepth: 2,
      defenseHighlightDurationMs: 700, defenseHighlightWaveIntervalMs: 210, defenseHighlightLineWidthPercent: 8,
      defenseHighlightLineLengthPercent: 100, defenseHighlightLineBlurPercent: 0,
      defenseHighlightLineMaskBlurPx: 1, defenseHighlightWhiteMixPercent: 0, whitePieceColor: "#ff00ff"
    });
    await t.test("threat wedges render in both roles at desktop and mobile sizes", async () => {
      for (const size of [512, 320]) {
        await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: size === 320 });
        const result = await evaluate(`(() => {
          testing.configure(LichessSettings.normalize({ pieceSet: "system_rund", threatWedgeLengthPercent: 20, threatWedgeWidthPercent: 12 }));
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 8 8");
          svg.style.cssText = "position:fixed;inset:0;width:${size}px;height:${size}px";
          document.body.append(svg);
          const segment = { target: { row: 3, col: 3 }, type: "rook", angle: 0, color: "#20cc60" };
          testing.renderThreatSegmentsInto(svg, [segment], [{ ...segment, angle: Math.PI }], "wedge", "wedge");
          const triangles = [...svg.querySelectorAll("polygon")].map(polygon => {
            const bounds = polygon.getBoundingClientRect();
            return { width: bounds.width, height: bounds.height, fill: polygon.getAttribute("fill"), points: polygon.points.length };
          });
          svg.remove();
          return triangles;
        })()`);
        assert.equal(result.length, 2);
        for (const triangle of result) {
          assert.equal(triangle.points, 3);
          assert.equal(triangle.fill, "#20cc60");
          assert.ok(Math.abs(triangle.width - size / 8 * 0.2) < 0.001);
          assert.ok(Math.abs(triangle.height - size / 8 * 0.12) < 0.001);
        }
      }
      await send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
    });
    await t.test("board highlights connect to the visible marker instead of the piece center", async () => {
      for (const size of [512, 320]) for (const mode of ["lines", "wedge", "segments", "square"]) for (const reverse of [false, true]) {
        await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: size === 320 });
        const result = await evaluate(`(() => {
          testing.configure(LichessSettings.normalize({ pieceSet: "system_rund", defenseHighlightDepth: 1,
            defenseHighlightEnabled: true, attackHighlightEnabled: false, threatDefenseDisplayMode: "${mode}",
            highlightCascadeReverseEnabled: ${reverse}, highlightCascadeLinesHoldEnabled: true }));
          const board = document.querySelector("cg-board");
          const parsed = testing.readPosition(board);
          const entry = { defensePlayedMoveKeys: new Set(), defenseHighlightedPieces: new Set(), hoveredSquare: { row: 4, col: 4 } };
          testing.updateDefenseHighlight(board, entry, parsed, null);
          testing.renderThreatArcs(board, entry, [], [{
            target: { row: 4, col: 4 }, source: { row: 2, col: 5 }, type: "pawn", sourceType: "knight",
            angle: Math.atan2(-2, 1), color: "#20cc60"
          }], [], "lines", "${mode}");
          const line = entry.defenseHighlightRuns[0].lines[0];
          const marker = entry.arcSvg.querySelector("polygon, path");
          let expected;
          if (marker.tagName === "polygon") {
            const [, left, right] = [...marker.points];
            expected = [(left.x + right.x) / 2, (left.y + right.y) / 2];
          } else if ("${mode}" === "segments") {
            const radius = Number(/A ([\\d.e+-]+)/.exec(marker.getAttribute("d"))[1]);
            const angle = Math.atan2(-2, 1);
            expected = [4.5 + Math.cos(angle) * radius, 4.5 + Math.sin(angle) * radius];
          } else if ("${mode}" === "square") {
            const actual = ${reverse} ? [line.toX, line.toY] : [line.fromX, line.fromY];
            if (!marker.isPointInStroke(new DOMPoint(actual[0] - 4.5, actual[1] - 4.5))) {
              throw new Error("The highlight endpoint does not touch the rendered square segment");
            }
            expected = actual;
          } else {
            const [, x, y] = /^M ([\\d.e+-]+) ([\\d.e+-]+)/.exec(marker.getAttribute("d"));
            expected = [Number(x), Number(y)];
          }
          const actual = ${reverse} ? [line.toX, line.toY] : [line.fromX, line.fromY];
          const result = { expected, actual, length: line.length, cap: line.path.getAttribute("stroke-linecap") };
          testing.clearDefenseHighlights(entry);
          entry.arcSvg.remove();
          return result;
        })()`);
        assert.ok(Math.hypot(result.actual[0] - result.expected[0], result.actual[1] - result.expected[1]) < 1e-6, JSON.stringify({ mode, reverse, ...result }));
        assert.ok(result.length > 0 && result.length < Math.sqrt(5));
        assert.equal(result.cap, "butt");
      }
      await send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
    });
    await t.test("Cage mask hides rendered board highlight lines inside the piece silhouette", async () => {
    const setup = await evaluate(`(() => {
      const board = document.querySelector("cg-board");
      const parsed = testing.readPosition(board);
      const position = parsed.position;
      if (position[4][4]?.type !== "pawn" || position[2][5]?.type !== "knight"
        || parsed.selected?.row !== 4 || parsed.selected?.col !== 4) throw new Error("board pieces or selection coordinates were not parsed as expected");
      const entry = { defensePlayedMoveKeys: new Set(), defenseHighlightedPieces: new Set(), hoveredSquare: { row: 4, col: 4 } };
      testing.configure(${JSON.stringify(options)});
      testing.updateDefenseHighlight(board, entry, parsed, null);
      const run = entry.defenseHighlightRuns[0];
      if (!run) throw new Error("selected-piece rendering did not create a highlight line");
      testing.advanceDefenseCascade(entry, run.startedAt + 300);
      if (entry.defenseHighlightFrame) cancelAnimationFrame(entry.defenseHighlightFrame);
      entry.defenseHighlightFrame = 0;
      const originalStacking = { svgZ: getComputedStyle(entry.highlightLineSvg).zIndex,
        svgBeforePiece: Boolean(entry.highlightLineSvg.compareDocumentPosition(board.querySelector("piece")) & Node.DOCUMENT_POSITION_FOLLOWING) };
      globalThis.testLineGroup = run.lineGroup;
      globalThis.testLineSvg = entry.highlightLineSvg;
      const maskPaths = [...run.lineMask.mask.querySelectorAll("path")].map(path => path.getAttribute("d"));
      return { lines: run.lines.length, pathMask: run.lines[0].path.getAttribute("mask"), maskId: run.lineMask.mask.id,
        maskPaths, blur: run.lineMask.blur.getAttribute("stdDeviation"),
        heldOpacity: run.lines[0].path.getAttribute("stroke-opacity"), originalStacking };
    })()`);
    assert.equal(setup.lines, 1);
    assert.equal(setup.pathMask, `url(#${setup.maskId})`);
    assert.equal(setup.maskPaths.length, 2);
    assert.equal(setup.heldOpacity, "0.8", "the held line keeps its configured starting opacity");
    await evaluate("new Promise(resolve => setTimeout(resolve, 300))");
    assert.ok(requestedAssets.has("/cage/cage_p.svg"));
    assert.ok(requestedAssets.has("/cage/cage_n.svg"));
    assert.equal(setup.originalStacking.svgBeforePiece, true, "the board SVG is placed beneath the actual Cage pieces");

    const captureSamples = async () => {
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      return evaluate(`new Promise(resolve => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          resolve([[288, 288], [352, 160], [320, 224]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3)));
        };
        image.src = ${JSON.stringify(`data:image/png;base64,${screenshot.data}`)};
      })`);
    };
    const [nativePawn, nativeKnight, nativeOutside] = await captureSamples();
    assert.ok(nativeOutside[0] > 180 && nativeOutside[2] > 180 && nativeOutside[1] < 80,
      `the line must remain visible in the board SVG outside pieces, got ${nativeOutside}`);
    await evaluate("testLineSvg.style.setProperty('z-index', '3', 'important')");
    await evaluate("testLineSvg.style.visibility = 'hidden'");
    const [pawnWithoutLine, knightWithoutLine] = await captureSamples();
    await evaluate("testLineSvg.style.visibility = 'visible'");
    const [insidePawn, insideKnight, outside] = await captureSamples();
    const pixelDifference = (left, right) => Math.max(...left.map((channel, index) => Math.abs(channel - right[index])));
    assert.ok(pixelDifference(nativePawn, pawnWithoutLine) <= 2,
      `the native board stacking must keep the line behind the pawn, got ${nativePawn} vs ${pawnWithoutLine}`);
    assert.ok(pixelDifference(nativeKnight, knightWithoutLine) <= 2,
      `the native board stacking must keep the line behind the knight, got ${nativeKnight} vs ${knightWithoutLine}`);
    assert.ok(pixelDifference(insidePawn, pawnWithoutLine) <= 2,
      `the mask must preserve rendered pawn pixels, got ${insidePawn} vs ${pawnWithoutLine}`);
    assert.ok(pixelDifference(insideKnight, knightWithoutLine) <= 2,
      `the mask must preserve rendered knight pixels, got ${insideKnight} vs ${knightWithoutLine}`);
    assert.ok(outside[0] > 180 && outside[2] > 180 && outside[1] < 80,
      `the same rendered SVG line must remain visible outside silhouettes, got ${outside}`);
    await evaluate("testLineGroup.querySelectorAll('[mask]').forEach(path => path.removeAttribute('mask'))");
    const [unmaskedPawn] = await captureSamples();
    assert.ok(unmaskedPawn[0] > 180 && unmaskedPawn[2] > 180 && unmaskedPawn[1] < 80,
      `the pixel check must detect the actual line when its mask is removed, got ${unmaskedPawn}`);
    assert.ok(setup.blur.includes("0.015625"), `configured pixel blur must reach the board SVG filter, got ${setup.blur}`);
    });

    await t.test("System Rund king sectors render at desktop and mobile sizes in both orientations", async () => {
    const kingOptions = settings.normalize({ pieceSet: "system_rund", kingMovementFieldsEnabled: true, whitePieceColor: "#ff00ff" });
    await evaluate(`(() => {
      document.body.dataset.board = "";
      const board = document.querySelector("cg-board");
      board.replaceChildren();
      for (const [type, key] of [["king", "e4"], ["pawn", "e5"]]) {
        const piece = document.createElement("piece");
        piece.className = "white " + type;
        piece.dataset.key = key;
        piece.style.left = "50%";
        piece.style.top = key === "e4" ? "50%" : "37.5%";
        board.append(piece);
      }
      document.documentElement.style.setProperty("--lfs-piece-wk", "url('/system_rund/bk.svg')");
      document.documentElement.style.setProperty("--lfs-piece-wp", "url('/system_rund/bp_2.svg')");
      document.documentElement.style.setProperty("--lfs-white-piece-color", "#ff00ff");
      LichessKingMovementFields.update(${JSON.stringify(kingOptions)});
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    for (const size of [512, 320]) for (const blackOrientation of [false, true]) {
      await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: size === 320 });
      const kingView = await evaluate(`(async () => {
        const board = document.querySelector("cg-board");
        const wrapper = board.closest(".cg-wrap");
        wrapper.className = "cg-wrap orientation-${blackOrientation ? "black" : "white"}";
        for (const node of [document.documentElement, document.body, wrapper, board]) {
          node.style.width = "${size}px"; node.style.height = "${size}px";
        }
        for (const piece of board.querySelectorAll("piece")) {
          piece.style.left = "${blackOrientation ? 37.5 : 50}%";
          piece.style.top = piece.classList.contains("king") ? "${blackOrientation ? 37.5 : 50}%" : "${blackOrientation ? 50 : 37.5}%";
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const svg = board.querySelector(".lfs-king-movement-fields");
        const rect = svg.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, paths: svg.querySelectorAll("path").length,
          d: svg.querySelector("path").getAttribute("d"), mask: getComputedStyle(svg.parentElement, "::before").maskImage };
      })()`);
      assert.equal(kingView.width, size / 8);
      assert.equal(kingView.paths, 1);
      assert.equal((kingView.d.match(/A/g) ?? []).length, 1);
      assert.ok(kingView.mask.includes("system_rund/bk.svg"), kingView.mask);
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const pixels = await evaluate(`new Promise(resolve => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          const centerX = ${kingView.left + kingView.width / 2};
          const centerY = ${kingView.top + kingView.width / 2};
          const offset = ${size} / 40;
          resolve([-offset, offset].map(dy => [...context.getImageData(centerX, centerY + dy, 1, 1).data].slice(0, 3)));
        };
        image.src = ${JSON.stringify(`data:image/png;base64,${screenshot.data}`)};
      })`);
      const blocked = pixels[blackOrientation ? 1 : 0];
      const open = pixels[blackOrientation ? 0 : 1];
      assert.ok(blocked[0] > 240 && blocked[1] < 20 && blocked[2] > 240, `blocked sector: ${blocked}, ${JSON.stringify(kingView)}`);
      assert.ok(open.every(channel => channel > 200 && channel < 235), `open sector: ${open}`);
    }
    assert.ok(requestedAssets.has("/system_rund/bk.svg"));
    assert.deepEqual(runtimeErrors, []);
    });
    await t.test("System Rund cage masks follow the king inner circle, not its bounding square", async () => {
      await send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(() => {
        LichessKingMovementFields.update({ enabled: false });
        const board = document.querySelector("cg-board");
        const wrapper = board.closest(".cg-wrap");
        for (const node of [document.documentElement, document.body, wrapper, board]) {
          node.style.width = "512px"; node.style.height = "512px";
        }
        board.replaceChildren();
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 8 8");
        svg.setAttribute("data-lfs-board-overlay", "");
        const defs = document.createElementNS(svg.namespaceURI, "defs"); svg.append(defs);
        const position = Array.from({ length: 8 }, () => Array(8).fill(null));
        position[3][3] = { color: "w", type: "queen" }; position[3][4] = { color: "b", type: "pawn" };
        testing.configure(LichessSettings.normalize({ pieceSet: "system_rund", defenseHighlightLineMaskBlurPx: 0 }));
        const mask = testing.createHighlightLineMask({ highlightLineDefs: defs }, board, position, false);
        const rect = document.createElementNS(svg.namespaceURI, "rect");
        rect.setAttribute("width", "8"); rect.setAttribute("height", "8"); rect.setAttribute("fill", "#f00000");
        rect.setAttribute("mask", "url(#" + mask.mask.id + ")"); svg.append(rect); board.append(svg);
      })()`);
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const pixels = await evaluate(`new Promise(resolve => {
        const image = new Image(); image.onload = () => {
          const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
          const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
          resolve([[3.5, 3.5], [3.8, 3.5], [3.8, 3.8], [4.5, 3.5]].map(([x, y]) =>
            [...context.getImageData(x * 64, y * 64, 1, 1).data].slice(0, 3)));
        }; image.src = ${JSON.stringify(`data:image/png;base64,${screenshot.data}`)};
      })`);
      assert.deepEqual(pixels, [[221, 221, 221], [221, 221, 221], [240, 0, 0], [240, 0, 0]]);
    });
    await t.test("hover previews animate after Chessground retains hidden selections and destinations", async () => {
      for (const size of [512, 320]) for (const blackOrientation of [false, true]) {
        await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: size === 320 });
        const result = await evaluate(`(async () => {
          const board = document.querySelector("cg-board");
          const wrapper = board.closest(".cg-wrap");
          wrapper.className = "cg-wrap orientation-${blackOrientation ? "black" : "white"}";
          for (const node of [document.documentElement, document.body, wrapper, board]) {
            node.style.width = "${size}px"; node.style.height = "${size}px";
          }
          const row = ${blackOrientation ? 3 : 4}, col = ${blackOrientation ? 4 : 3}, targetCol = ${blackOrientation ? 2 : 5};
          const at = (r, c) => 'transform:translate(' + c * 100 + '%,' + r * 100 + '%)';
          board.innerHTML = '<square class="selected" style="display:none;transform:translate(0%,0%)"></square>'
            + '<square class="last-move selected" style="' + at(row, col) + '"></square>'
            + '<square class="move-dest" style="display:none;transform:translate(100%,100%)"></square>'
            + '<square class="move-dest" style="' + at(row, targetCol) + '"></square>'
            + '<piece class="white rook" style="' + at(row, col) + '"></piece>';
          const rect = board.getBoundingClientRect();
          const preview = LichessThreatCoding.getInteractionPreview(board,
            rect.left + (targetCol + 0.5) * rect.width / 8, rect.top + (row + 0.5) * rect.height / 8);
          if (!preview) return { missing: true };
          testing.configure(LichessSettings.normalize({ enabled: true, pieceSet: "system_rund", disableAnimations: false,
            moveAnimationLichessSpeed: false, moveAnimationDuration: 100, moveAnimationTimeDistance: false }));
          const entry = {};
          testing.renderMovePreviewPiece(board, entry, preview);
          const started = Boolean(entry.previewAnimation);
          for (let frame = 0; frame < 90 && entry.previewAnimation; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          const result = { source: preview.source, target: preview.target, started, finished: !entry.previewAnimation,
            x: entry.previewTranslation.x, y: entry.previewTranslation.y, opacity: entry.previewOpacity };
          board.replaceChildren();
          return result;
        })()`);
        assert.deepEqual(result, { source: { row: 4, col: 3 }, target: { row: 4, col: 5 },
          started: true, finished: true, x: blackOrientation ? -2 : 2, y: 0, opacity: 1 });
      }
      assert.deepEqual(runtimeErrors, []);
    });
    await t.test("promotion previews cycle during hover and drag", async () => {
      for (const interaction of ["hover", "drag"]) {
        const result = await evaluate(`(async () => {
          const board = document.querySelector("cg-board");
          board.replaceChildren();
          const wrapper = board.closest(".cg-wrap");
          wrapper.className = "cg-wrap orientation-white";
          const basePosition = Array.from({ length: 8 }, () => Array(8).fill(""));
          basePosition[1][4] = "wP";
          const position = basePosition.map(rank => [...rank]);
          position[1][4] = "";
          position[0][4] = "wQ";
          const options = LichessSettings.normalize({ pieceSet: "system_rund", promotionPreviewIntervalMs: 100,
            movePreviewAnticipationPercent: 0, disableAnimations: false });
          testing.configure(options);
          const entry = {};
          testing.renderMovePreviewPiece(board, entry, { basePosition, position,
            source: { row: 1, col: 4 }, target: { row: 0, col: 4 }, blackOrientation: false, legal: true,
            isHoverPreview: ${interaction === "hover"}, isDragging: ${interaction === "drag"} });
          const initial = entry.previewPieceImage.getAttribute("href");
          await new Promise(resolve => setTimeout(resolve, 125));
          const next = entry.previewPieceImage.getAttribute("href");
          testing.clearMovePreviewPiece(board, entry);
          return { initial, next };
        })()`);
        assert.ok(result.initial.endsWith("system_rund/bq.svg"), `${interaction}: ${result.initial}`);
        assert.ok(result.next.endsWith("system_rund/br.svg"), `${interaction}: ${result.next}`);
      }
      assert.deepEqual(runtimeErrors, []);
    });
    await t.test("move previews recolor both sides, castling, captures and promotions", async () => {
      await send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
      for (const side of ["w", "b"]) for (const blackOrientation of [false, true]) {
        for (const move of ["capture", "castle", "promotion", "en-passant"]) {
          const previewCells = await evaluate(`(async () => {
            LichessKingMovementFields.update({ enabled: false });
            const board = document.querySelector("cg-board");
            const wrapper = board.closest(".cg-wrap");
            wrapper.className = "cg-wrap orientation-${blackOrientation ? "black" : "white"}";
            for (const node of [document.documentElement, document.body, wrapper, board]) {
              node.style.width = "512px"; node.style.height = "512px";
            }
            board.replaceChildren();
            const side = ${JSON.stringify(side)}, move = ${JSON.stringify(move)};
            const enemy = side === "w" ? "b" : "w";
            const basePosition = Array.from({ length: 8 }, () => Array(8).fill(""));
            const home = side === "w" ? 7 : 0;
            const source = move === "castle" ? { row: home, col: 4 }
              : move === "promotion" ? { row: side === "w" ? 1 : 6, col: 0 }
              : { row: side === "w" ? 3 : 4, col: 4 };
            const target = move === "castle" ? { row: home, col: 6 }
              : move === "promotion" ? { row: side === "w" ? 0 : 7, col: 0 }
              : { row: side === "w" ? 2 : 5, col: 3 };
            basePosition[source.row][source.col] = side + (move === "castle" ? "K" : move === "capture" ? "N" : "P");
            if (move === "castle") basePosition[home][7] = side + "R";
            if (move === "capture") basePosition[target.row][target.col] = enemy + "R";
            if (move === "en-passant") basePosition[source.row][target.col] = enemy + "P";
            const position = basePosition.map(rank => [...rank]);
            position[source.row][source.col] = "";
            position[target.row][target.col] = side + (move === "castle" ? "K" : move === "promotion" ? "Q" : move === "capture" ? "N" : "P");
            if (move === "castle") { position[home][7] = ""; position[home][5] = side + "R"; }
            if (move === "en-passant") position[source.row][target.col] = "";
            const options = LichessSettings.normalize({ pieceSet: "system_rund", disableAnimations: true,
              whitePieceColor: "#20cc60", blackPieceColor: "#c040a0", kingMovementFieldsEnabled: false });
            testing.configure(options);
            const entry = { defensePreviewMix: move === "capture" ? 0.5 : 0 };
            testing.renderMovePreviewPiece(board, entry, { basePosition, position, source, target,
              blackOrientation: ${blackOrientation}, isHoverPreview: true, legal: true });
            await Promise.all([...entry.previewPieceSvg.querySelectorAll("image")].map(image => new Promise((resolve, reject) => {
              const asset = new Image(); asset.onload = resolve; asset.onerror = reject; asset.src = image.getAttribute("href");
            })));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const screen = square => ${blackOrientation} ? { row: 7 - square.row, col: 7 - square.col } : square;
            return [{ ...screen(target), mix: entry.defensePreviewMix },
              ...(move === "castle" ? [{ ...screen({ row: home, col: 5 }), mix: 0 }] : [])];
          })()`);
          const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          const counts = await evaluate(`new Promise(resolve => {
            const image = new Image();
            image.onload = () => {
              const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
              const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
              const color = ${JSON.stringify(side === "w" ? [32, 204, 96] : [192, 64, 160])};
              resolve(${JSON.stringify(previewCells)}.map(cell => {
                const expected = color.map(channel => channel * (1 - cell.mix) + 255 * cell.mix);
                const data = context.getImageData(cell.col * 64, cell.row * 64, 64, 64).data;
                let count = 0;
                for (let index = 0; index < data.length; index += 4) {
                  if (expected.every((channel, offset) => Math.abs(data[index + offset] - channel) < 3)) count++;
                }
                return count;
              }));
            };
            image.src = ${JSON.stringify(`data:image/png;base64,${screenshot.data}`)};
          })`);
          assert.ok(counts.every(count => count > 30), `${side}/${blackOrientation}/${move}: ${counts}`);
        }
      }
      assert.deepEqual(runtimeErrors, []);
    });
    await t.test("captured pieces, promotion choices, pockets and editor pieces use the selected colors", async () => {
      const failures = await evaluate(`(() => {
        const root = document.documentElement;
        const options = LichessSettings.normalize({ pieceSet: "system_rund", whitePieceColor: "#20cc60", blackPieceColor: "#c040a0" });
        root.style.setProperty("--lfs-white-piece-color", options.whitePieceColor);
        root.style.setProperty("--lfs-black-piece-color", options.blackPieceColor);
        const types = { pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k" };
        for (const side of ["w", "b"]) for (const letter of Object.values(types)) {
          root.style.setProperty("--lfs-piece-" + side + letter, 'url("' + chrome.runtime.getURL(LichessSettings.getPieceAsset(options, side, letter)) + '")');
        }
        const sandbox = document.createElement("div"); document.body.append(sandbox);
        const failures = [];
        const context = document.createElement("canvas").getContext("2d");
        const check = (node, side, label) => {
          const style = getComputedStyle(node);
          context.clearRect(0, 0, 1, 1); context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
          const pixel = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
          const expected = side === "w" ? [32, 204, 96] : [192, 64, 160];
          if (pixel.some((channel, index) => Math.abs(channel - expected[index]) > 1)
            || !style.maskImage.includes("system_rund/")) failures.push(label + ": " + pixel + "/" + style.maskImage);
        };
        for (const layout of ["round__app", "analyse__board", "bot-game"]) for (const orientation of ["white", "black"]) {
          sandbox.innerHTML = '<div class="' + layout + '"><div class="main-board"><div class="cg-wrap orientation-' + orientation + '"></div></div><div class="material material-top"></div><div class="material material-bottom"></div></div>';
          if (layout === "analyse__board") sandbox.firstElementChild.prepend(sandbox.querySelector(".cg-wrap"));
          for (const placement of ["top", "bottom"]) for (const type of Object.keys(types)) {
            const node = document.createElement("mpiece"); node.className = type;
            sandbox.querySelector(".material-" + placement).append(node);
            check(node, (orientation === "white") === (placement === "top") ? "w" : "b", layout + "/" + orientation + "/" + placement + "/" + type);
          }
        }
        for (const markup of ['<div id="promotion-choice"></div>', '<div class="pocket"></div>',
          '<div class="board-editor"><div class="spare"></div></div>', '<div class="is2d"><div class="puzzle__feedback"></div></div>']) {
          sandbox.innerHTML = markup;
          const parent = sandbox.querySelector(".spare, .puzzle__feedback") ?? sandbox.firstElementChild;
          for (const side of ["w", "b"]) for (const type of Object.keys(types)) {
            const node = document.createElement("piece"); node.className = (side === "w" ? "white" : "black") + " " + type;
            parent.append(node); check(node, side, markup + "/" + side + "/" + type);
          }
        }
        sandbox.remove(); return failures;
      })()`);
      assert.deepEqual(failures, []);
    });
  } finally {
    socket?.close();
    if (browser && browser.exitCode === null) {
      browser.kill();
      await new Promise(resolve => browser.once("close", resolve));
    }
    server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
