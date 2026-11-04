const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
require("./colors.js");
require("./settings.js");

test("board cursor settings are normalized and exposed in the popup", () => {
  const settings = globalThis.LichessSettings;
  assert.equal(settings.defaults.boardCursorEnabled, false);
  assert.equal(settings.defaults.boardCursorDiameterPx, 14);
  assert.equal(settings.defaults.boardCursorTrailTension, 55);
  assert.equal(settings.defaults.boardCursorResponseMs, 280);
  assert.deepEqual(settings.defaults.boardCursorCurve, [0.25, 0, 0.25, -90]);
  assert.deepEqual(settings.normalize({ boardCursorCurve: [2, -300, -1, 200] }).boardCursorCurve, [1, -200, 0, 120]);
  assert.equal(settings.defaults.boardCursorRoundnessPercent, 60);
  assert.equal(settings.normalize({ boardCursorResponseMs: 1200 }).boardCursorResponseMs, 1000);
  assert.equal(settings.normalize({ boardCursorRoundnessPercent: -5 }).boardCursorRoundnessPercent, 0);
  assert.equal(settings.normalize({ boardCursorInsetPercent: -5 }).boardCursorInsetPercent, 0);
  assert.equal(settings.defaults.boardCursorSpeedThresholdPxPerSecond, 400);
  assert.equal(settings.normalize({ boardCursorSpeedThresholdPxPerSecond: 0 }).boardCursorSpeedThresholdPxPerSecond, 0);
  assert.equal(settings.normalize({ boardCursorSpeedThresholdPxPerSecond: 500 }).boardCursorSpeedThresholdPxPerSecond, 400);
  assert.equal(settings.normalize({ boardCursorDiameterPx: 0 }).boardCursorDiameterPx, 0);
  assert.equal(settings.normalize({ boardCursorDiameterPx: 101 }).boardCursorDiameterPx, 100);
  assert.equal(settings.normalize({ boardCursorTrailTension: 120 }).boardCursorTrailTension, 100);
  assert.equal(settings.normalize({ boardCursorTrailLengthPx: -5 }).boardCursorTrailLengthPx, 0);
  assert.equal(settings.normalize({ boardCursorEnabled: 1 }).boardCursorEnabled, true);
  assert.equal(settings.defaults.boardCursorHighlightGapsEnabled, true);
  assert.equal(settings.defaults.boardCursorHighlightGapWidthPx, 4);
  assert.equal(settings.normalize({ boardCursorHighlightGapsEnabled: 0 }).boardCursorHighlightGapsEnabled, false);
  assert.equal(settings.normalize({ boardCursorHighlightGapWidthPx: 50 }).boardCursorHighlightGapWidthPx, 20);
  const cleaned = settings.normalize({ boardCursorAnticipationPercent: 22, boardCursorDiagonalPinchPercent: 42 });
  assert.equal("boardCursorAnticipationPercent" in cleaned, false);
  assert.equal("boardCursorDiagonalPinchPercent" in cleaned, false);

  const popup = readFileSync(join(__dirname, "popup.html"), "utf8");
  for (const key of [
    "boardCursorEnabled", "boardCursorColor", "boardCursorDiameterPx", "boardCursorWidthPx",
    "boardCursorOpacity", "boardCursorInsetPercent", "boardCursorHighlightGapsEnabled", "boardCursorHighlightGapWidthPx",
    "boardCursorSpeedThresholdPxPerSecond",
    "boardCursorResponseMs", "boardCursorRoundnessPercent", "boardCursorTrailTension", "boardCursorTrailLengthPx", "boardCursorGlowPercent"
  ]) assert.match(popup, new RegExp(`data-setting="${key}"`));
  assert.match(popup, /<input type="range" min="0" max="400" step="50" data-setting="boardCursorSpeedThresholdPxPerSecond">/);
  assert.match(popup, /<input type="range" min="0" max="100" step="1" data-setting="boardCursorDiameterPx">/);
  assert.match(popup, /Kreisdurchmesser \(% der Feldgröße\)/);
  assert.match(popup, /data-bezier-editor="boardCursorCurve"/);
  assert.doesNotMatch(popup, /boardCursorAnticipationPercent|boardCursorDiagonalPinchPercent/);
});

test("board cursor trails while moving, hides on piece drags and morphs into its hover field", () => {
  const frames = new Map();
  const documentListeners = new Map();
  let nextFrame = 0;
  let boardSize = 800;

  class Element {
    constructor(name, parent = null) {
      this.name = name;
      this.parentElement = parent;
      this.children = [];
      this.attributes = new Map();
      this.style = { setProperty() {} };
      this.classNames = new Set();
      this.classList = { add: name => this.classNames.add(name) };
      this.id = "";
    }
    closest(selector) {
      if (selector === "piece") {
        for (let element = this; element; element = element.parentElement) {
          if (element.name === "piece") return element;
        }
        return null;
      }
      if (!selector.includes("cg-board")) return null;
      for (let element = this; element; element = element.parentElement) {
        if (element.name === "cg-board") return element;
      }
      return null;
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
      }
    }
    replaceChildren(...nodes) {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      this.append(...nodes);
    }
    querySelectorAll(selector) {
      return selector === 'svg[data-lfs-highlight-lines] path[data-lfs-highlight-line]' ? (this.highlightPaths ?? []) : [];
    }
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter(node => node !== this);
      this.parentElement = null;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    contains(node) {
      for (let element = node; element; element = element.parentElement) {
        if (element === this) return true;
      }
      return false;
    }
    toggleAttribute(name, value) {
      if (value) this.attributes.set(name, "");
      else this.attributes.delete(name);
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: boardSize, height: boardSize }; }
  }

  const board = new Element("cg-board");
  const square = new Element("square", board);
  const piece = new Element("piece", board);
  const document = {
    hidden: false,
    documentElement: new Element("html"),
    createElementNS(_namespace, name) { return new Element(name); },
    addEventListener(name, listener) { documentListeners.set(name, listener); }
  };
  const context = vm.createContext({
    Element,
    document,
    window: { addEventListener() {} },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  vm.runInContext(readFileSync(join(__dirname, "board-hover-cursor.js"), "utf8"), context);
  const cursorSettings = {
    enabled: true,
    boardCursorEnabled: true,
    boardCursorColor: "#55ddaa",
    boardCursorDiameterPx: 16,
    boardCursorWidthPx: 2.5,
    boardCursorOpacity: 90,
    boardCursorInsetPercent: 4,
    boardCursorHighlightGapsEnabled: true,
    boardCursorHighlightGapWidthPx: 4,
    boardCursorResponseMs: 135,
    boardCursorCurve: [0.25, 0, 0.25, -90],
    boardCursorRoundnessPercent: 50,
    boardCursorSpeedThresholdPxPerSecond: 400,
    boardCursorTrailTension: 55,
    boardCursorTrailLengthPx: 18,
    boardCursorGlowPercent: 55,
    boardBevelEnabled: true,
    boardFieldShape: "bevel",
    boardBevelPercent: 40,
    boardRoundPercent: 50
  };
  context.LichessBoardCursor.update(cursorSettings);
  const highlightLine = new Element("path");
  highlightLine.setAttribute("d", "M1 1L7 7");
  highlightLine.setAttribute("stroke-width", "0.02");
  highlightLine.setAttribute("stroke-dasharray", "none");
  highlightLine.setAttribute("stroke-opacity", "0.2");
  board.highlightPaths = [highlightLine];

  const move = (clientX, clientY, timeStamp, target = square) => documentListeners.get("pointermove")({
    pointerType: "mouse", target, clientX, clientY, timeStamp
  });
  const tick = timestamp => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(timestamp);
  };
  const outline = () => {
    const path = board.children[0].children[1].getAttribute("d");
    return path;
  };
  const outlineWidth = () => {
    const match = /^M([\d.-]+) [\d.-]+L([\d.-]+) [\d.-]+/.exec(outline());
    return Math.abs(Number(match[2]) - Number(match[1]));
  };

  move(250, 250, 16);
  tick(16);
  const cursor = board.children[0];
  assert.equal(cursor.children[0].getAttribute("mask"), "url(#lfs-board-cursor-highlight-gap-mask)");
  assert.equal(cursor.children[3].children[0].children.length, 2, "the mask contains the highlight line crossing the cursor");
  const gap = cursor.children[3].children[0].children[1];
  assert.equal(gap.getAttribute("stroke-width"), "8.5");
  assert.equal(gap.getAttribute("stroke-opacity"), "1", "even a translucent highlight creates a fully transparent cursor gap");
  assert.equal(gap.getAttribute("opacity"), "1");
  cursorSettings.boardCursorHighlightGapsEnabled = false;
  context.LichessBoardCursor.update(cursorSettings);
  tick(16);
  assert.equal(cursor.children[0].getAttribute("mask"), null, "the checkbox restores an uninterrupted outline");
  assert.equal(cursor.children[3].children[0].children.length, 0);
  cursorSettings.boardCursorHighlightGapsEnabled = true;
  context.LichessBoardCursor.update(cursorSettings);
  tick(16);
  cursorSettings.boardCursorTrailLengthPx = 0;
  context.LichessBoardCursor.update(cursorSettings);
  move(400, 300, 32);
  tick(32);
  assert.match(outline(), /^M4 2\.92L4 2\.92/, "the moving circle stays centered under the pointer");

  cursorSettings.boardCursorTrailLengthPx = 18;
  context.LichessBoardCursor.update(cursorSettings);
  for (let index = 1; index <= 8; index++) {
    const time = 32 + index * 16;
    move(400 + index * 8, 300 + index * 2, time);
    tick(time + 16);
  }
  const deformedPath = outline();
  cursorSettings.boardCursorTrailTension = 100;
  context.LichessBoardCursor.update(cursorSettings);
  tick(176);
  assert.notEqual(outline(), deformedPath, "the tension control changes the tail shape");
  cursorSettings.boardCursorTrailTension = 55;
  cursorSettings.boardCursorTrailLengthPx = 0;
  context.LichessBoardCursor.update(cursorSettings);
  tick(176);
  assert.notEqual(outline(), deformedPath, "the length control changes the rearward bulge");
  cursorSettings.boardCursorTrailLengthPx = 18;
  context.LichessBoardCursor.update(cursorSettings);
  for (let time = 192; time <= 1500; time += 16) tick(time);
  const fieldStart = /^M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)/.exec(outline());
  assert.ok(Math.abs(Number(fieldStart[1]) - 4.25) < 0.001);
  assert.ok(Math.abs(Number(fieldStart[2]) - 3.04) < 0.001);
  assert.ok(Math.abs(Number(fieldStart[3]) - 4.75) < 0.001, "the idle cursor uses its configured corner rounding");
  const roundedFieldPath = outline();
  assert.match(roundedFieldPath, /C/, "the cursor has rounded corners independently of the board shape");
  cursorSettings.boardCursorRoundnessPercent = 100;
  context.LichessBoardCursor.update(cursorSettings);
  tick(1500);
  assert.notEqual(outline(), roundedFieldPath, "the cursor rounding control changes the field outline");
  cursorSettings.boardCursorRoundnessPercent = 50;
  context.LichessBoardCursor.update(cursorSettings);
  tick(1500);

  move(464, 316, 1510);
  move(520, 316, 1526);
  tick(1526);
  assert.ok(outlineWidth() > 0.2, "fast movement eases the hover field back into a circle");

  for (let time = 1542; time <= 4500; time += 16) tick(time);
  cursorSettings.boardCursorResponseMs = 1000;
  cursorSettings.boardCursorCurve = [0.8, 0, 1, -90];
  context.LichessBoardCursor.update(cursorSettings);
  move(610, 316, 5000);
  for (let time = 5000; time <= 5500; time += 16) tick(time);
  const transitionStart = /^M([\d.-]+) /.exec(outline());
  const fieldCenter = Number(transitionStart[1]) + 0.25;
  assert.ok(fieldCenter > 5.55 && fieldCenter < 5.85, "the configured easing controls progress during the transition duration");

  documentListeners.get("pointerout")({ target: square, relatedTarget: new Element("body") });
  assert.equal(board.children.length, 0);
  assert.equal(board.attributes.has("data-lfs-board-cursor-board"), false);

  for (const [button, pointerId] of [[0, 1], [2, 2]]) {
    documentListeners.get("pointerdown")({ button, pointerId, target: piece, clientX: 464, clientY: 316 });
    move(470, 316, 1520 + pointerId * 16, piece);
    assert.equal(board.children.length, 0, `${button === 0 ? "left" : "right"}-button piece drags hide the outline`);
    documentListeners.get("pointerup")({
      pointerId, pointerType: "mouse", target: piece, clientX: 470, clientY: 316,
      timeStamp: 1540 + pointerId * 16
    });
    move(470, 316, 1600 + pointerId * 16);
    tick(1700 + pointerId * 16);
    assert.equal(board.children.length, 1, "the cursor returns after the piece drag ends");
    documentListeners.get("pointerout")({ target: square, relatedTarget: new Element("body") });
  }

  boardSize = 400;
  move(200, 200, 6000);
  tick(6000);
  assert.match(outline(), /^M4 3\.92L4 3\.92/, "the circle diameter scales as a percentage of the field size");
  documentListeners.get("pointerout")({ target: square, relatedTarget: new Element("body") });

  cursorSettings.boardCursorSpeedThresholdPxPerSecond = 0;
  context.LichessBoardCursor.update(cursorSettings);
  move(200, 200, 6016);
  tick(6016);
  assert.doesNotMatch(outline(), /NaN|Infinity/, "a zero movement threshold keeps the cursor geometry valid");
  documentListeners.get("pointerout")({ target: square, relatedTarget: new Element("body") });
});
