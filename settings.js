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
    boardTopGapPercent: 0,
    zenBoardUpPercent: 0,
    lastMoveLight: "#dae0d7",
    lastMoveLineWidth: 16,
    selectedLight: "#ffffff",
    checkSquareLight: "#e57373",
    engineArrowLight: "#4a4a4a",
    engineArrowOutlineEnabled: false,
    engineArrowOutlineWidthPercent: 3,
    engineArrowShaftWidthPercent: 36,
    engineArrowHeadSizePercent: 100,
    engineArrowStartOffsetPercent: 20,
    engineArrowEndOffsetPercent: 20,
    hoverMixLight: "#d4d2d2",
    boardLightDark: "#424240",
    boardDarkDark: "#3e3d40",
    lastMoveDark: "#2f2d30",
    selectedDark: "#252823",
    checkSquareDark: "#8c3434",
    engineArrowDark: "#000000",
    hoverMixDark: "#282727",
    markLastMove: true,
    idleMixPercent: 50,
    hoverMixPercent: 70,
    hoverDesaturation: 60,
    moveDotSize: 5,
    squareMoveDots: true,
    whitePieceColor: "#d1521d",
    blackPieceColor: "#2ba4d1",
    analysisGraphColors: true,
    showPlayTimeInHours: true,
    analysisEnabled: true,
    threatColoringEnabled: true,
    threatOwnSeeThrough: 0.8,
    threatOpponentSeeThrough: 0.25,
    threatMoveDepth: 3,
    threatDepthFactor: 0.2,
    threatMaxMixPercent: 30,
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
    pieceBounceWiggleDuration: 560,
    pieceBounceCurve: [0.4210072471981957, -2.351343756839282, 0.42685286204020184, -119.18385010540278],
    pieceBounceWiggleCurve: [0.22225404921032132, -6.491205018140321, 0.5963776452200753, -92.8899650019563],
    moveAnimationLichessSpeed: false,
    moveAnimationDuration: 200,
    moveAnimationTimeDistance: true,
    moveAnimationDistanceFactor: 0.15,
    moveAnimationCurve: [0.34793622153145926, -1.1229950096562262, 0.3128621464683896, -102.4430381342235],
    selectedPieceWedgeEnabled: true,
    selectedPieceWedgeOnlySelected: false,
    wedgeBasePiecePreviewEnabled: false,
    kingMovementFieldsEnabled: false,
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
    wedgeBaseWidthPercent: 20,
    wedgeTipWidthPercent: 3,
    wedgeGlowWidthPercent: 0,
    wedgeGlowBlurPercent: 30.6,
    wedgeOpacity: 0.3,
    wedgeStartOffsetPercent: 0,
    wedgeEndOffsetPercent: 0,
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
    threatSquareGapPercent: 12,
    threatSquareRadialGapPercent: 75,
    threatSquareFigureMargin: 0.05,
    threatLineRadius: 0.35,
    threatLineLength: 0.16,
    threatLineThickness: 0.035,
    threatLineGap: 0.03,
    threatLineGapPercent: 29,
    threatLineFigureMargin: 0.04,
    threatLineCurvature: 0.09,
    threatSquareCornerRadiusPercent: 10,
    threatCenterOutlineEnabled: true,
    threatCenterOutlineStyle: "hatching",
    threatCenterHatchExchangeFilterEnabled: true,
    threatCenterOutlineWidthPercent: 5,
    threatCenterOutlineOpacity: 100,
    threatCenterHatchSpacingPercent: 11,
    threatCenterHatchThicknessPercent: 3.75,
    threatCenterHatchAngleDeg: 90,
    threatCenterHatchSpeed: 0.12,
    removeOutlines: true,
    removeGlows: true,
    removeGradients: true,
    removeShadows: true,
    removeRoundedCorners: true,
    disableAnimations: false,
    threatenedPieceOutlineWidthPx: 1.5
  });

  const ranges = {
    boardTopGapPercent: [0, 30],
    zenBoardUpPercent: [0, 30],
    idleMixPercent: [0, 100],
    hoverMixPercent: [0, 100],
    hoverDesaturation: [0, 100],
    moveDotSize: [5, 50],
    lastMoveLineWidth: [1, 100],
    engineArrowOutlineWidthPercent: [1, 10],
    engineArrowShaftWidthPercent: [8, 60],
    engineArrowHeadSizePercent: [50, 200],
    engineArrowStartOffsetPercent: [0, 40],
    engineArrowEndOffsetPercent: [0, 40],
    wedgeBaseWidthPercent: [1, 50],
    wedgeTipWidthPercent: [0.5, 25],
    wedgeGlowWidthPercent: [0, 50],
    wedgeGlowBlurPercent: [0, 50],
    wedgeOpacity: [0, 1],
    wedgeStartOffsetPercent: [0, 50],
    wedgeEndOffsetPercent: [0, 50],
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

    threatCenterOutlineWidthPercent: [0, 20],
    threatCenterOutlineOpacity: [0, 100],
    threatCenterHatchSpacingPercent: [0.5, 40],
    threatCenterHatchThicknessPercent: [0.25, 20],
    threatCenterHatchAngleDeg: [0, 180],
    threatCenterHatchSpeed: [0, 1],
    threatOwnSeeThrough: [0, 1],
    threatOpponentSeeThrough: [0, 1],
    threatMoveDepth: [1, 5],
    threatDepthFactor: [0, 1],
    threatMaxMixPercent: [0, 100],
    threatGradientPercent: [0, 100],
    pieceBounceWiggleAngle: [1, 30],
    pieceBounceTiming: [0, 5000],
    pieceBounceDuration: [200, 1500],
    pieceBounceWiggleDuration: [200, 1500],
    moveAnimationDuration: [0, 500],
    moveAnimationDistanceFactor: [0, 1]
  };
  const colors = Object.keys(defaults).filter(key => /Color|Light|Dark/.test(key) && typeof defaults[key] === "string");

  function normalize(values = {}) {
    const result = { ...defaults, ...values };
    const legacyArrowOffset = Number(values.engineArrowCenterOffsetPercent);
    if (Number.isFinite(legacyArrowOffset)) {
      if (!Object.prototype.hasOwnProperty.call(values, "engineArrowStartOffsetPercent")) {
        result.engineArrowStartOffsetPercent = legacyArrowOffset;
      }
      if (!Object.prototype.hasOwnProperty.call(values, "engineArrowEndOffsetPercent")) {
        result.engineArrowEndOffsetPercent = legacyArrowOffset;
      }
    }
    delete result.engineArrowCenterOffsetPercent;
    for (const [percentKey, pixelKey] of [
      ["wedgeBaseWidthPercent", "wedgeBaseWidthPx"],
      ["wedgeTipWidthPercent", "wedgeTipWidthPx"],
      ["wedgeGlowWidthPercent", "wedgeGlowWidthPx"],
      ["wedgeGlowBlurPercent", "wedgeGlowBlurPx"]
    ]) {
      if (!Object.prototype.hasOwnProperty.call(values, percentKey) && Object.prototype.hasOwnProperty.call(values, pixelKey)) {
        result[percentKey] = Number(values[pixelKey]) * 2;
      }
      delete result[pixelKey];
    }
    if (!Object.prototype.hasOwnProperty.call(values, "threatCenterOutlineEnabled")) {
      result.threatCenterOutlineEnabled = values.threatCenterCircleEnabled ?? defaults.threatCenterOutlineEnabled;
    }
    delete result.threatCenterCircleEnabled;
    delete result.threatCenterCircleDiameterPercent;
    delete result.threatCenterCircleThicknessPercent;
    delete result.wedgePotentialWithoutSelection;
    delete result.wedgePotentialEnabled;
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
    if (result.threatCenterOutlineStyle === "crosshatch") result.threatCenterOutlineStyle = "hatching";
    if (!["outline", "hatching"].includes(result.threatCenterOutlineStyle)) {
      result.threatCenterOutlineStyle = defaults.threatCenterOutlineStyle;
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
    result.threatCenterHatchAngleDeg = Math.round(result.threatCenterHatchAngleDeg);
    result.threatCenterHatchSpeed = Number(result.threatCenterHatchSpeed.toFixed(2));
    result.threatCenterOutlineWidthPercent = Number(result.threatCenterOutlineWidthPercent.toFixed(1));
    result.engineArrowOutlineWidthPercent = Number(result.engineArrowOutlineWidthPercent.toFixed(1));
    result.engineArrowShaftWidthPercent = Number(result.engineArrowShaftWidthPercent.toFixed(1));
    result.engineArrowStartOffsetPercent = Math.round(result.engineArrowStartOffsetPercent);
    result.engineArrowEndOffsetPercent = Math.round(result.engineArrowEndOffsetPercent);
    result.lastMoveLineWidth = Math.round(result.lastMoveLineWidth);
    result.engineArrowHeadSizePercent = Math.round(result.engineArrowHeadSizePercent);

    result.threatArcGapPercent = Math.round(result.threatArcGapPercent);
    result.threatArcRadialGapPercent = Math.round(result.threatArcRadialGapPercent);
    result.threatSquareAngleDeg = Math.round(result.threatSquareAngleDeg);
    result.threatSquareGapPercent = Math.round(result.threatSquareGapPercent);
    result.threatSquareRadialGapPercent = Math.round(result.threatSquareRadialGapPercent);
    result.threatLineGapPercent = Math.round(result.threatLineGapPercent);
    result.threatSquareCornerRadiusPercent = Math.round(result.threatSquareCornerRadiusPercent);

    result.pieceBounceTiming = Math.round(result.pieceBounceTiming / 10) * 10;
    result.pieceBounceDuration = Math.round(result.pieceBounceDuration / 10) * 10;
    result.pieceBounceWiggleDuration = Math.round(result.pieceBounceWiggleDuration / 10) * 10;
    result.moveAnimationDuration = Math.round(result.moveAnimationDuration / 10) * 10;
    result.moveAnimationDistanceFactor = Number((Math.round(result.moveAnimationDistanceFactor / 0.05) * 0.05).toFixed(2));
    for (const key of ["pieceBounceCurve", "pieceBounceWiggleCurve", "moveAnimationCurve"]) {
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
      "engineArrowOutlineEnabled",
      "showPlayTimeInHours",
      "analysisEnabled",
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
      "wedgeBasePiecePreviewEnabled",
      "kingMovementFieldsEnabled",

      "defenseCirclesEnabled",


      "moveDotsPlayerColor",
      "threatenedPieceOutlineEnabled",
      "threatCenterOutlineEnabled",
      "threatCenterHatchExchangeFilterEnabled",
      "moveAnimationLichessSpeed",
      "moveAnimationTimeDistance",
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
