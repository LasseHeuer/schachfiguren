const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./colors.js");
require("./settings.js");
require("./threat-coding.js");
const colors = globalThis.LichessColors;
const settings = globalThis.LichessSettings;
const threats = globalThis.LichessThreatCoding;

const previousColors = {
  boardLightLight: "#dedae6", boardDarkLight: "#d6dbd5", lastMoveLight: "#dae0d7",
  selectedLight: "#ffffff", checkSquareLight: "#e57373", engineArrowLight: "#4a4a4a",
  hoverMixLight: "#d4d2d2", boardLightDark: "#424240", boardDarkDark: "#3e3d40",
  lastMoveDark: "#2f2d30", selectedDark: "#252823", checkSquareDark: "#8c3434",
  engineArrowDark: "#000000", hoverMixDark: "#282727", whitePieceColor: "#d1521d",
  blackPieceColor: "#2ba4d1", primaryButtonColor: "#3692e7", onlineIndicatorLight: "#7c9e4f", onlineIndicatorDark: "#7c9e4f", buttonBackgroundDark: "#333332",
  buttonBackgroundLight: "#bdbdbd", threatPinnedOutlineDark: "#383838", threatPinnedOutlineLight: "#f0f0f0"
};

test("board bevel defaults and limits preserve the existing board until enabled", () => {
  const defaults = settings.normalize();
  assert.equal(defaults.boardBevelEnabled, false);
  assert.equal(defaults.boardBevelPercent, 30);
  assert.equal(settings.normalize({ boardBevelPercent: -10 }).boardBevelPercent, 0);
  assert.equal(settings.normalize({ boardBevelPercent: 120 }).boardBevelPercent, 100);
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

test("all previous defaults and saved custom colors retain their appearance", () => {
  const migrated = settings.normalize(previousColors);
  for (const [key, hex] of Object.entries(previousColors)) {
    assert.ok(settings.defaults[key].startsWith("oklch("), key);
    assert.equal(colors.toHex(settings.defaults[key]), hex, key);
    assert.equal(colors.toHex(migrated[key]), hex, key);
    assert.equal(settings.normalize(migrated)[key], migrated[key], key);
    assert.equal(colors.toHex(settings.normalize({ [key]: "#12abef" })[key]), "#12abef", key);
    assert.equal(settings.normalize({ [key]: "invalid" })[key], settings.defaults[key], key);
  }
});

test("hover preview corridor width and origin opacity retain saved values and valid limits", () => {
  assert.equal(settings.normalize().movePreviewCorridorWidthPercent, 100);
  for (const [saved, expected] of [[0, 0], [60, 60], [150, 150], [-5, 0], [250, 200], ["invalid", 100]]) {
    const normalized = settings.normalize({ movePreviewCorridorWidthPercent: saved });
    assert.equal(normalized.movePreviewCorridorWidthPercent, expected);
    assert.equal(settings.normalize(normalized).movePreviewCorridorWidthPercent, expected);
  }
  for (const opacity of [0, 0.25, 1]) {
    assert.equal(settings.normalize({ movePreviewOriginOpacity: opacity }).movePreviewOriginOpacity, opacity);
  }
});

test("hover preview anticipation preserves the existing default and clamps saved values", () => {
  assert.equal(settings.normalize().movePreviewAnticipationPercent, 100);
  for (const [saved, expected] of [[0, 0], [35, 35], [100, 100], [-5, 0], [150, 100], ["invalid", 100]]) {
    const normalized = settings.normalize({ movePreviewAnticipationPercent: saved });
    assert.equal(normalized.movePreviewAnticipationPercent, expected);
    assert.equal(settings.normalize(normalized).movePreviewAnticipationPercent, expected);
  }
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
  api.configure(settings.normalize());
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
  assert.ok(entry.previewAnimation.duration >= 200 && entry.previewAnimation.duration <= 230);
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
      const options = { ...settings.defaults, threatMaxMixPercent };
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
  const options = { ...settings.defaults, whitePieceColor: "#00ff00", blackPieceColor: "#0000ff", threatMaxMixPercent: 60 };
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
  for (const mode of ["oklab", "normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten", "difference"]) {
    const normalized = settings.normalize({ threatBlendMode: mode });
    assert.equal(normalized.threatBlendMode, mode);
    assert.equal(settings.normalize(JSON.parse(JSON.stringify(normalized))).threatBlendMode, mode);
  }
  for (const mode of [undefined, null, "", "invalid", "__proto__", "toString", 1, {}]) {
    assert.equal(settings.normalize({ threatBlendMode: mode }).threatBlendMode, "oklab");
    assert.equal(threats.getOpacityColor(3, { ...settings.defaults, threatBlendMode: mode }, "#424240"),
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
