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
  assert.equal(settings.defaults.boardCursorResponseMs, 135);
  assert.equal(settings.normalize({ boardCursorResponseMs: 999 }).boardCursorResponseMs, 280);
  assert.equal(settings.normalize({ boardCursorInsetPercent: -5 }).boardCursorInsetPercent, 0);
  assert.equal(settings.normalize({ boardCursorSpeedThresholdPxPerSecond: 3000 }).boardCursorSpeedThresholdPxPerSecond, 2000);
  assert.equal(settings.normalize({ boardCursorDiameterPx: 2 }).boardCursorDiameterPx, 4);
  assert.equal(settings.normalize({ boardCursorTrailTension: 120 }).boardCursorTrailTension, 100);
  assert.equal(settings.normalize({ boardCursorTrailLengthPx: -5 }).boardCursorTrailLengthPx, 0);
  assert.equal(settings.normalize({ boardCursorEnabled: 1 }).boardCursorEnabled, true);
  const cleaned = settings.normalize({ boardCursorAnticipationPercent: 22, boardCursorDiagonalPinchPercent: 42 });
  assert.equal("boardCursorAnticipationPercent" in cleaned, false);
  assert.equal("boardCursorDiagonalPinchPercent" in cleaned, false);

  const popup = readFileSync(join(__dirname, "popup.html"), "utf8");
  for (const key of [
    "boardCursorEnabled", "boardCursorColor", "boardCursorDiameterPx", "boardCursorWidthPx",
    "boardCursorOpacity", "boardCursorInsetPercent", "boardCursorSpeedThresholdPxPerSecond",
    "boardCursorResponseMs", "boardCursorTrailTension", "boardCursorTrailLengthPx", "boardCursorGlowPercent"
  ]) assert.match(popup, new RegExp(`data-setting="${key}"`));
  assert.doesNotMatch(popup, /boardCursorAnticipationPercent|boardCursorDiagonalPinchPercent/);
});

test("board cursor trails while moving, hides on piece drags and morphs into its hover field", () => {
  const frames = new Map();
  const documentListeners = new Map();
  let nextFrame = 0;

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
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 800 }; }
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
    boardCursorResponseMs: 135,
    boardCursorSpeedThresholdPxPerSecond: 500,
    boardCursorTrailTension: 55,
    boardCursorTrailLengthPx: 18,
    boardCursorGlowPercent: 55,
    boardBevelEnabled: true,
    boardFieldShape: "round",
    boardBevelPercent: 40,
    boardRoundPercent: 50
  };
  context.LichessBoardCursor.update(cursorSettings);

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
  assert.ok(Math.abs(Number(fieldStart[3]) - 4.75) < 0.001, "the idle cursor takes the field's configured rounding");

  move(464, 316, 1510);
  move(520, 316, 1526);
  tick(1526);
  assert.ok(outlineWidth() > 0.2, "fast movement eases the hover field back into a circle");

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
});
