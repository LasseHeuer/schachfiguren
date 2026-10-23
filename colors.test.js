const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./colors.js");
require("./settings.js");
require("./threat-coding.js");
require("./highlight-line-preview.js");
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

test("board bevel defaults and limits", () => {
  const defaults = settings.normalize();
  assert.equal(defaults.boardBevelEnabled, true);
  assert.equal(defaults.boardBevelPercent, 40);
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
    assert.deepEqual(writes, ["gradientTransform", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity"]);
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
    globalThis.threatTesting = { getLogicalSquare };
    globalThis.LichessThreatCoding = {`), context);
  const previewSource = readFileSync(join(__dirname, "selected-piece-wedge.js"), "utf8");
  vm.runInContext(previewSource.replace("  documentObserver = new MutationObserver", `
    globalThis.previewTesting = { getPieceScreenSquare };
    return;
    documentObserver = new MutationObserver`), context);
  const board = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 80 }) };
  const animationKeyPiece = isAnimating => ({
    classList: { contains: name => name === "anim" && isAnimating },
    dataset: {},
    getAttribute: name => name === "data-lfs-move-key" ? "h8" : null,
    getBoundingClientRect: () => ({ left: 30, top: 20, width: 10, height: 10 })
  });
  for (const [isAnimating, expected] of [[false, { row: 2, col: 3 }], [true, { row: 0, col: 7 }]]) {
    const piece = animationKeyPiece(isAnimating);
    assert.deepEqual({ ...context.threatTesting.getLogicalSquare(piece, board, false) }, expected);
    assert.deepEqual({ ...context.previewTesting.getPieceScreenSquare(piece, board, false) }, expected);
  }
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

test("Cage mask hides rendered board highlight lines inside the piece silhouette", { skip: ![
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].some(path => path && require("node:fs").existsSync(path)) }, async () => {
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
      updateDefenseHighlight,
      advanceDefenseCascade,
      configure(value) { settings = value; },
    };
    return;
${marker}`);
  const requestedAssets = new Set();
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/extension.css"><style>
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
  <script src="/board-overlay.js"></script><script src="/highlight-line-preview.js"></script><script src="/selected-piece-wedge.js"></script>
  </body></html>`;
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
      return;
    }
    if (path === "/board-overlay.js" || path === "/highlight-line-preview.js") {
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
    if (/^\/cage\/cage_[pnbrq]\.svg$/.test(path)) {
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
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
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
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (await evaluate("Boolean(window.testing)")) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(await evaluate("Boolean(window.testing)"), true, "the browser loaded the production renderer");
    const options = settings.normalize({
      pieceSet: "cage", highlightCascadesEnabled: true, defenseHighlightEnabled: true, attackHighlightEnabled: false,
      highlightCascadeLinesEnabled: true, highlightCascadeLinesHoldEnabled: true, defenseHighlightDepth: 2,
      defenseHighlightDurationMs: 700, defenseHighlightWaveIntervalMs: 210, defenseHighlightLineWidthPercent: 8,
      defenseHighlightLineLengthPercent: 100, defenseHighlightLineBlurPercent: 0,
      defenseHighlightLineMaskBlurPx: 1, defenseHighlightWhiteMixPercent: 0, whitePieceColor: "#ff00ff"
    });
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
    await evaluate("testLineGroup.removeAttribute('mask')");
    const [unmaskedPawn] = await captureSamples();
    assert.ok(unmaskedPawn[0] > 180 && unmaskedPawn[2] > 180 && unmaskedPawn[1] < 80,
      `the pixel check must detect the actual line when its mask is removed, got ${unmaskedPawn}`);
    assert.ok(setup.blur.includes("0.015625"), `configured pixel blur must reach the board SVG filter, got ${setup.blur}`);
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
