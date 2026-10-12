(() => {
  const defaults = Object.freeze({
    enabled: true,
    pieceSet: "system_eckig",
    complexPawn: true,
    boardLightLight: "#dedae6",
    boardDarkLight: "#d6dbd5",
    monochromeBoard: false,
    squareOutline: false,
    boardScalePercent: 83,
    boardVerticalOffset: 0,
    lastMoveLight: "#dae0d7",
    lastMoveLineWidth: 16,
    selectedLight: "#ffffff",
    checkSquareLight: "#e57373",
    engineArrowLight: "#4a4a4a",
    hoverMixLight: "#d4d2d2",
    boardLightDark: "#454541",
    boardDarkDark: "#434245",
    lastMoveDark: "#3d3842",
    selectedDark: "#252823",
    checkSquareDark: "#8c3434",
    engineArrowDark: "#000000",
    hoverMixDark: "#282727",
    markLastMove: true,
    idleMixPercent: 40,
    hoverMixPercent: 80,
    hoverDesaturation: 60,
    moveDotSize: 5,
    squareMoveDots: true,
    whitePieceColor: "#d1521d",
    blackPieceColor: "#2ba4d1",
    analysisGraphColors: true,
    showPlayTimeInHours: true,
    threatColoringEnabled: true,
    threatOwnSeeThrough: 0.8,
    threatOpponentSeeThrough: 0.25,
    threatMoveDepth: 3,
    threatDepthFactor: 0.2,
    threatMaxMixPercent: 40,
    threatGradientPercent: 0,
    threatColoringMode: "opacity",
    onlineIndicatorDark: "#7c9e4f",
    buttonBackgroundDark: "#333332",
    buttonBackgroundLight: "#bdbdbd",
    clockSize: 90,
    menuScalePercent: 90,
    pieceBounceEnabled: true,
    pieceBounceLoop: true,
    pieceBounceStyle: "wiggle-only",
    pieceBounceWiggleAngle: 8,
    pieceBounceTiming: 1100,
    pieceBounceDuration: 700,
    pieceBounceWiggleDuration: 550,
    pieceBounceCurve: [0.43205979291130514, 9.699530416395712, 0.43205979291130514, -119.63553915279083],
    pieceBounceWiggleCurve: [0.1681075096130371, -8.821559392769496, 0.634965942019508, -93.04401927854734],
    selectedPieceWedgeEnabled: true,
    selectedPieceWedgeOnlySelected: true,
    defenseCirclesEnabled: true,
    defenseLineAnimationDistancePercent: 4,
    defenseLineAnimationLoopMs: 1200,
    defenseLineAnimationOffsetMs: 80,
    defenseLineBaseWidthPx: 8.8,
    defenseLineCurve: [0.3917787642706008, 8.307138808892704, 0.830204827444894, -104.16703496108303],
    defenseLineEndOffset: 0.3,
    defenseLineGlowBlurPx: 9,
    defenseLineGlowWidthPx: 0,
    defenseLineStartOffset: 0.32,
    defenseLineTipWidthPx: 1.2,
    threatCountFontSizePx: 14,
    threatCountLabelsEnabled: true,
    threatCountOffsetRadius: 0.35,
    threatCountTextOutlineEnabled: false,
    threatPinnedOutlineDark: "#383838",
    threatPinnedOutlineLight: "#f0f0f0",
    threatPinnedOutlineWidth: 1.5,
    threatPinnedPieceBrightness: 27,
    threatPinnedPieceDesaturation: 38,
    threatAttackDisplayMode: "square",
    threatDefenseDisplayMode: "lines",
    moveDotsPlayerColor: true,
    wedgeBaseWidthPx: 14.4,
    wedgeTipWidthPx: 1.5,
    wedgeGlowWidthPx: 0,
    wedgeGlowBlurPx: 15.3,
    wedgeOpacity: 0.3,
    wedgePotentialEnabled: true,
    wedgePotentialStrategy: "all",
    wedgePotentialCutoffValue: 1,
    wedgePotentialPerPieceCount: 3,
    threatenedPieceOutlineEnabled: true,
    threatArcRadius: 0.45,
    threatArcThickness: 0.04,
    threatArcAngleDeg: 45,
    threatArcGapPercent: 13,
    threatArcRadialGapPercent: 50,
    segmentFigureMargin: 0.05,
    threatSquareRadius: 0.5,
    threatSquareThickness: 0.04,
    threatSquareAngleDeg: 45,
    threatSquareGapPercent: 17,
    threatSquareRadialGapPercent: 65,
    threatSquareFigureMargin: 0.05,
    threatLineRadius: 0.3,
    threatLineLength: 0.12,
    threatLineThickness: 0.035,
    threatLineGap: 0.04,
    threatLineGapPercent: 40,
    threatLineFigureMargin: 0.04,
    threatLineCurvature: 0.3,
    threatSquareCornerRadiusPercent: 10,
    threatCenterCircleEnabled: false,
    threatCenterCircleDiameterPercent: 3,
    threatCenterCircleThicknessPercent: 14,
    removeOutlines: true,
    removeGlows: true,
    removeGradients: true,
    removeShadows: true,
    removeRoundedCorners: true,
    disableAnimations: false,
    threatenedPieceOutlineWidthPx: 1.5
  });

  const ranges = {
    idleMixPercent: [0, 100],
    hoverMixPercent: [0, 100],
    hoverDesaturation: [0, 100],
    moveDotSize: [5, 50],
    lastMoveLineWidth: [1, 100],
    wedgeBaseWidthPx: [1, 20],
    wedgeTipWidthPx: [0.5, 10],
    wedgeGlowWidthPx: [0, 20],
    wedgeGlowBlurPx: [0, 18],
    wedgeOpacity: [0, 1],
    wedgePotentialCutoffValue: [1, 9],
    wedgePotentialPerPieceCount: [1, 5],
    threatArcRadius: [0.3, 0.7],
    threatArcThickness: [0.01, 0.08],
    threatArcAngleDeg: [10, 120],
    threatArcGapPercent: [0, 50],
    threatArcRadialGapPercent: [50, 200],
    segmentFigureMargin: [0, 0.2],
    threatSquareRadius: [0.3, 0.7],
    threatSquareThickness: [0.01, 0.08],
    threatSquareAngleDeg: [10, 120],
    threatSquareGapPercent: [0, 50],
    threatSquareRadialGapPercent: [0, 100],
    threatSquareFigureMargin: [0, 0.2],
    threatLineRadius: [0.1, 0.5],
    threatLineLength: [0, 0.3],
    threatLineThickness: [0.005, 0.1],
    threatLineGap: [0, 0.2],
    threatLineGapPercent: [0, 50],
    threatLineFigureMargin: [-0.1, 0.2],
    threatLineCurvature: [-0.5, 0.5],
    threatSquareCornerRadiusPercent: [0, 50],

    threatCenterCircleDiameterPercent: [0, 100],
    threatCenterCircleThicknessPercent: [0, 100],
    threatOwnSeeThrough: [0, 1],
    threatOpponentSeeThrough: [0, 1],
    threatMoveDepth: [1, 5],
    threatDepthFactor: [0, 1],
    threatMaxMixPercent: [0, 100],
    threatGradientPercent: [0, 100],
    pieceBounceWiggleAngle: [1, 30],
    pieceBounceTiming: [0, 5000],
    pieceBounceDuration: [200, 1500],
    pieceBounceWiggleDuration: [200, 1500]
  };
  const colors = Object.keys(defaults).filter(key => /Color|Light|Dark/.test(key) && typeof defaults[key] === "string");

  function normalize(values = {}) {
    const result = { ...defaults, ...values };
    if (!Object.prototype.hasOwnProperty.call(values, "defenseCirclesEnabled")) {
      result.defenseCirclesEnabled = values.defenseLinesEnabled ?? defaults.defenseCirclesEnabled;
    }
    for (const key of [
      "defenseLinesEnabled",
      "defenseLineLength",
      "defenseLineThicknessPx",
      "defenseLineDistance",
      "defenseLineOpacity",
      "defenseLineSegmentsEnabled",
      "defenseLineSegmentsSyncEnabled",
      "defenseLineSegmentRadius",
      "defenseLineSegmentThickness",
      "defenseLineSegmentAngleDeg",
      "defenseLineSegmentGapPercent",
      "defenseLineSegmentRadialGapPercent",
      "threatDisplayMode",
      "threatLineBoardEdgeMargin"
    ]) delete result[key];
    if (!Object.prototype.hasOwnProperty.call(values, "pieceBounceWiggleCurve")) {
      result.pieceBounceWiggleCurve = values.pieceBounceCurve ?? defaults.pieceBounceWiggleCurve;
    }

    if (!["system_pixel", "system_eckig", "rund", "rund_comic", "cage"].includes(result.pieceSet)) {
      result.pieceSet = defaults.pieceSet;
    }
    if (!["rotate-wiggle", "wiggle-only"].includes(result.pieceBounceStyle)) {
      result.pieceBounceStyle = defaults.pieceBounceStyle;
    }
    if (!["all", "waterfall"].includes(result.wedgePotentialStrategy)) {
      result.wedgePotentialStrategy = defaults.wedgePotentialStrategy;
    }
    const displayModes = ["segments", "lines", "square"];
    const legacyDisplayMode = displayModes.includes(values.threatDisplayMode) ? values.threatDisplayMode : defaults.threatAttackDisplayMode;
    for (const key of ["threatAttackDisplayMode", "threatDefenseDisplayMode"]) {
      result[key] = displayModes.includes(values[key]) ? values[key] : legacyDisplayMode;
    }
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = Number(result[key]);
      result[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : defaults[key];
    }
    for (const key of ["threatOwnSeeThrough", "threatOpponentSeeThrough", "threatDepthFactor"]) {
      result[key] = Number(result[key].toFixed(2));
    }
    result.threatMoveDepth = Math.round(result.threatMoveDepth);
    result.wedgePotentialCutoffValue = Math.round(result.wedgePotentialCutoffValue);
    result.wedgePotentialPerPieceCount = Math.round(result.wedgePotentialPerPieceCount);
    result.threatMaxMixPercent = Math.round(result.threatMaxMixPercent);
    result.threatGradientPercent = Math.round(result.threatGradientPercent);
    result.pieceBounceWiggleAngle = Math.round(result.pieceBounceWiggleAngle);
    result.threatCenterCircleDiameterPercent = Math.round(result.threatCenterCircleDiameterPercent);
    result.threatCenterCircleThicknessPercent = Math.round(result.threatCenterCircleThicknessPercent);
    result.lastMoveLineWidth = Math.round(result.lastMoveLineWidth);

    result.threatArcGapPercent = Math.round(result.threatArcGapPercent);
    result.threatArcRadialGapPercent = Math.round(result.threatArcRadialGapPercent);
    result.threatSquareAngleDeg = Math.round(result.threatSquareAngleDeg);
    result.threatSquareGapPercent = Math.round(result.threatSquareGapPercent);
    result.threatSquareRadialGapPercent = Math.round(result.threatSquareRadialGapPercent);
    result.threatLineGapPercent = Math.round(result.threatLineGapPercent);
    result.threatSquareCornerRadiusPercent = Math.round(result.threatSquareCornerRadiusPercent);

    result.pieceBounceTiming = Math.round(result.pieceBounceTiming / 50) * 50;
    result.pieceBounceDuration = Math.round(result.pieceBounceDuration / 50) * 50;
    result.pieceBounceWiggleDuration = Math.round(result.pieceBounceWiggleDuration / 50) * 50;
    for (const key of ["pieceBounceCurve", "pieceBounceWiggleCurve"]) {
      const curve = Array.isArray(result[key]) ? result[key].map(Number) : null;
      if (!curve || curve.length !== 4 || !curve.every(Number.isFinite)) {
        result[key] = [...defaults[key]];
      } else {
        result[key] = [
          Math.max(0, Math.min(1, curve[0])),
          Math.max(-200, Math.min(120, curve[1])),
          Math.max(0, Math.min(1, curve[2])),
          Math.max(-200, Math.min(120, curve[3]))
        ];
      }
    }

    for (const key of colors) {
      if (!/^#[0-9a-f]{6}$/i.test(result[key])) result[key] = defaults[key];
    }

    for (const key of [
      "enabled",
      "markLastMove",
      "squareMoveDots",
      "analysisGraphColors",
      "showPlayTimeInHours",
      "removeOutlines",
      "removeGlows",
      "removeGradients",
      "removeShadows",
      "removeRoundedCorners",
      "disableAnimations",
      "monochromeBoard",
      "squareOutline",
      "threatColoringEnabled",
      "pieceBounceEnabled",
      "pieceBounceLoop",
      "selectedPieceWedgeEnabled",
      "selectedPieceWedgeOnlySelected",
      "defenseCirclesEnabled",


      "moveDotsPlayerColor",
      "threatenedPieceOutlineEnabled",
      "threatCenterCircleEnabled",
      "wedgePotentialEnabled",
      "complexPawn"
    ]) {
      result[key] = Boolean(result[key]);
    }

    return result;
  }

  function bindFineInputs(controls) {
    for (const control of controls) {
      if (control.type !== "range") continue;
      const coarseStep = control.step || "1";
      const fineStep = Math.min(1, Number(coarseStep) || 1);
      const decimals = (String(fineStep).split(".")[1] || "").length;
      let drag;
      control.title = [control.title, "Shift + Ziehen bewegt den Wert viermal langsamer"].filter(Boolean).join(". ");
      const clearPointerFocus = () => control.classList.remove("fine-pointer-focused");
      control.addEventListener("blur", clearPointerFocus);
      control.addEventListener("keydown", clearPointerFocus);
      control.addEventListener("pointerdown", event => {
        if (!event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        control.classList.add("fine-dragging");
        control.step = fineStep < 1 ? "any" : "1";
        drag = {
          pointerId: event.pointerId,
          value: Number(control.value),
          x: event.clientX,
          width: Math.max(1, control.getBoundingClientRect().width),
          min: Number(control.min),
          max: Number(control.max),
          step: fineStep,
          decimals
        };
        control.setPointerCapture(event.pointerId);
      });
      const finishDrag = event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag = undefined;
        control.step = coarseStep;
        control.classList.remove("fine-dragging");
        control.classList.add("fine-pointer-focused");
        control.dispatchEvent(new Event("change", { bubbles: true }));
      };
      control.addEventListener("pointermove", event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const change = (event.clientX - drag.x) / drag.width * (drag.max - drag.min) * 0.25;
        const steppedValue = Math.round((drag.value + change) / drag.step) * drag.step;
        const nextValue = Number(Math.max(drag.min, Math.min(drag.max, steppedValue)).toFixed(drag.decimals));
        if (Number(control.value) === nextValue) return;
        control.value = String(nextValue);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
      control.addEventListener("pointerup", finishDrag);
      control.addEventListener("pointercancel", finishDrag);
    }
  }

  globalThis.LichessSettings = { defaults, normalize, bindFineInputs };
})();
