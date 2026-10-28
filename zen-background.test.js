const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./colors.js");
require("./settings.js");
require("./zen-background.js");

const { materialAdvantage } = globalThis.LichessZenBackground;

test("material advantage follows board orientation and defaults to a normal background", () => {
  assert.equal(materialAdvantage("", "", false), 0);
  assert.equal(materialAdvantage("+3", "", false), -3);
  assert.equal(materialAdvantage("+3", "", true), 3);
  assert.equal(materialAdvantage("", "+3", false), 3);
  assert.equal(materialAdvantage("+1000", "", true), 1000);
});

test("background settings keep a bounded advantage tint and default to a subtle mix", () => {
  const normalize = globalThis.LichessSettings.normalize;
  assert.equal(normalize({}).zenBackgroundTintPercent, 12);
  assert.equal(normalize({ zenBackgroundTintPercent: -10 }).zenBackgroundTintPercent, 0);
  assert.equal(normalize({ zenBackgroundTintPercent: 100 }).zenBackgroundTintPercent, 40);
  assert.equal(normalize({ zenBackgroundTintPercent: NaN }).zenBackgroundTintPercent, 12);
});

test("solid background updates only on state changes without animation frames", () => {
  const vm = require("node:vm");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  let zen = false, mutation, storageChange;
  const wrapper = {
    classList: { contains: value => value === "orientation-black" && blackAtBottom },
    matches: selector => selector === ".cg-wrap"
  };
  const board = { closest: () => root, querySelector: () => wrapper };
  const top = {
    nodeType: 1,
    classList: { contains: value => value === "material-top" },
    closest: selector => selector === ".material" ? top : null,
    textContent: ""
  };
  const bottom = {
    nodeType: 1,
    classList: { contains: value => value === "material-bottom" },
    closest: selector => selector === ".material" ? bottom : null,
    textContent: ""
  };
  const root = { querySelectorAll: () => [top, bottom] };
  let blackAtBottom = false;
  const background = { style: {}, setAttribute() {}, hidden: true };
  const document = {
    documentElement: { hasAttribute: () => zen, append() {} },
    querySelector: selector => selector === "[data-lfs-zen-board]" ? board : null,
    createElement: () => background
  };
  let scheduledFrames = 0;
  const context = vm.createContext({
    document, LichessSettings: globalThis.LichessSettings, LichessColors: globalThis.LichessColors,
    window: { addEventListener() {} },
    chrome: { storage: { local: { get: (_, callback) => callback({}) }, onChanged: { addListener: fn => { storageChange = fn; } } } },
    MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} },
    requestAnimationFrame() { scheduledFrames++; }
  });
  vm.runInContext(readFileSync(join(__dirname, "zen-background.js"), "utf8"), context);
  zen = true;
  mutation([{ target: document.documentElement, type: "attributes" }]);
  assert.equal(background.hidden, false);
  assert.equal(background.style.backgroundColor, "transparent");

  bottom.textContent = "+2";
  mutation([{ target: bottom, type: "characterData" }]);
  assert.equal(background.style.backgroundColor,
    `color-mix(in srgb, var(--c-bg-page, var(--c-bg, #fff)) 94%, ${globalThis.LichessSettings.defaults.whitePieceColor} 6%)`);

  blackAtBottom = true;
  top.textContent = "+2";
  bottom.textContent = "";
  wrapper.classList.contains = value => value === "orientation-black";
  mutation([{ target: wrapper, type: "attributes" }]);
  assert.equal(background.style.backgroundColor,
    `color-mix(in srgb, var(--c-bg-page, var(--c-bg, #fff)) 94%, ${globalThis.LichessSettings.defaults.blackPieceColor} 6%)`);

  storageChange({ zenBackgroundTintPercent: { newValue: 0 } }, "local");
  assert.equal(background.style.backgroundColor, "transparent");
  assert.equal(scheduledFrames, 0);
});

test("popup exposes only the solid-background toggle and tint slider", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const html = readFileSync(join(__dirname, "popup.html"), "utf8");
  assert.match(html, /data-setting="zenBackgroundEnabled"/);
  assert.match(html, /data-setting="zenBackgroundTintPercent"/);
  assert.match(html, /min="0" max="40" step="1" data-setting="zenBackgroundTintPercent"/);
  assert.doesNotMatch(html, /zenBackground(?:Pixel|Speed|Noise|Opacity|Blur)/);
});
