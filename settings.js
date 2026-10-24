(() => {
  const defaults = Object.freeze({
    enabled: true,
    pieceSet: "system_eckig",
    complexPawn: true,
    boardLightLight: "oklch(0.8950392819 0.0167676465 301.1914565362)",
    boardGapLight: "oklch(0.845 0 0)",
    boardDarkLight: "oklch(0.885873322 0.0097293256 140.5143546829)",
    monochromeBoard: false,
    squareOutline: false,
    boardBevelEnabled: true,
    boardFieldShape: "bevel",
    boardBevelPercent: 40,
    boardRoundPercent: 0,
    boardScalePercent: 83,
    boardVerticalOffset: 0,
    boardTopGapPercent: 8,
    zenBoardUpPercent: 4,
    zenClockFontSizePx: 27,
    zenClockMarginPx: 0,
    zenClockLineThicknessPx: 3,
    zenClockLineGapPx: 11,
    zenClockBlinkFrequency: 1,
    zenClockWarningThresholdPercent: 20,
    zenClockActiveEndSizePercent: 3,
    zenClockActiveEndBlendPercent: 27,
    zenClockShowTimeOnlyWhenLow: true,
    lastMoveLight: "oklch(0.8995751716 0.0137046779 134.9026614921)",
    lastMoveLineWidth: 20,
    selectedLight: "oklch(1 0 0)",
    checkSquareLight: "oklch(0.6875468257 0.1419550249 21.4565765629)",
    engineArrowLight: "oklch(0.409120004 0 0)",
    engineArrowOutlineEnabled: true,
    engineArrowOpacity: 100,
    engineArrowOutlineWidthPercent: 6.5,
    engineArrowShaftWidthPercent: 27,
    engineArrowHeadSizePercent: 90,
    engineArrowStartOffsetPercent: 28,
    engineArrowEndOffsetPercent: 0,
    soundSettings: {
      berserk: { source: "website", volume: 76 },
      capture: { source: "custom:set down.wav", volume: 38 },
      check: { source: "pack:futuristic", volume: 91 },
      checkmate: { source: "custom:death.wav", volume: 71 },
      confirmation: { source: "website", volume: 72 },
      defeat: { source: "custom:loss_02.wav", volume: 100 },
      draw: { source: "pack:futuristic", volume: 80 },
      error: { source: "website", volume: 88 },
      explosion: { source: "website", volume: 70 },
      genericnotify: { source: "custom:magic.wav", volume: 47 },
      lowtime: { source: "custom:loss_03.wav", volume: 77 },
      move: { source: "custom:choose.wav", volume: 100 },
      newchallenge: { source: "website", volume: 91 },
      newpm: { source: "website", volume: 89 },
      practicecomplete: { source: "website", volume: 100 },
      practicewrong: { source: "website", volume: 100 },
      victory: { source: "custom:win.wav", volume: 98 }
    },
    hoverMixLight: "oklch(0.8653569657 0.0022022331 17.2009230703)",
    boardLightDark: "oklch(0.3904343341 0.0006124816 300.7)",
    boardGapDark: "oklch(0.3736 0 0)",
    boardDarkDark: "oklch(0.3578244807 0 146.3)",
    lastMoveDark: "oklch(0.300397087 0.0060154475 314.7294762347)",
    selectedDark: "oklch(0.2719585799 0.0100275903 132.64018331)",
    checkSquareDark: "oklch(0.4502720372 0.1203487855 23.2354759329)",
    engineArrowDark: "oklch(0 0 0)",
    hoverMixDark: "oklch(0.2737978582 0.0014714673 17.2471480169)",
    markLastMove: true,
    idleMixPercent: 50,
    hoverMixPercent: 50,
    hoverDesaturation: 60,
    moveDotSize: 7,
    squareMoveDots: true,
    moveIndicatorMode: "outline",
    moveOutlineWidthPx: 2,
    moveOutlineColor: "oklch(0.7426203222 0 250.107923237)",
    moveGlowOpacity: 34,
    moveGlowRadiusPercent: 10,
    whitePieceColor: "oklch(0.5997409301 0.1721887956 40.1845294695)",
    blackPieceColor: "oklch(0.6742384272 0.1206555753 228.5101815779)",
    analysisGraphColors: true,
    showPlayTimeInHours: true,
    analysisEnabled: true,
    threatColoringEnabled: true,
    threatOwnSeeThrough: 0.8,
    threatOpponentSeeThrough: 0.25,
    threatMoveDepth: 3,
    threatDepthFactor: 0.2,
    threatPieceValueInfluencePercent: 100,
    threatMaxMixPercent: 20,
    threatBlendMode: "normal",
    threatGradientPercent: 0,
    threatColoringMode: "opacity",
    primaryButtonColor: "oklch(0.3186928234 0 315)",
    onlineIndicatorLight: "oklch(0.6554420197 0.1136350274 128.3610368503)",
    onlineIndicatorDark: "oklch(0.4817419714 0.0748867945 128.3610368503)",
    buttonBackgroundDark: "oklch(0.2860830892 0 106.4974103352)",
    buttonBackgroundLight: "oklch(0.7983723788 0 0)",
    clockSize: 90,
    menuScalePercent: 90,
    pieceBounceEnabled: true,
    pieceBounceLoop: false,
    pieceBounceStyle: "wiggle-only",
    pieceBounceWiggleAngle: 5,
    pieceBounceTiming: 1100,
    pieceBounceDuration: 700,
    pieceBounceWiggleDuration: 500,
    pieceBounceCurve: [0.4210072471981957, -2.351343756839282, 0.5466893968128023, -100.85583445469412],
    pieceBounceWiggleCurve: [0.19302565710885183, -14.182400356993378, 0.628528912862142, -88.51132028846204],
    moveAnimationLichessSpeed: false,
    moveAnimationDuration: 150,
    movePreviewOriginOpacity: 0.1,
    movePreviewCorridorWidthPercent: 185,
    movePreviewAnticipationPercent: 40,
    moveAnimationTimeDistance: true,
    moveAnimationDistanceFactor: 0.1,
    moveAnimationCurve: [0.2514824867248535, -17.537492682009336, 0.7542110624767485, -85.1984053942622],
    selectedPieceWedgeEnabled: false,
    selectedPieceWedgeOnlySelected: false,
    wedgeBasePiecePreviewEnabled: true,
    kingMovementFieldsEnabled: true,
    defenseCirclesEnabled: true,
    highlightCascadesEnabled: true,
    defenseHighlightEnabled: true,
    attackHighlightEnabled: true,
    highlightCascadeLinesEnabled: true,
    highlightCascadeLinesHoldEnabled: false,
    highlightCascadeReverseEnabled: false,
    defenseHighlightDepth: 3,
    defenseHighlightWaveIntervalMs: 210,
    defenseHighlightDurationMs: 700,
    defenseHighlightWaveDecayPercent: 20,
    defenseHighlightWhiteMixPercent: 35,
    defensePreviewThresholdMs: 200,
    defenseHighlightLineWidthPercent: 0.5,
    defenseHighlightLineLengthPercent: 70,
    defenseHighlightLineBlurPercent: 20,
    highlightLineOpacityPercent: 100,
    highlightLineDecayPercent: 20,
    highlightLineHoldStartOpacityPercent: 80,
    defenseHighlightLineMaskBlurPx: 1,
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
    threatPinnedOutlineDark: "oklch(0.3406970569 0 0)",
    threatPinnedOutlineLight: "oklch(0.9551400503 0 0)",
    threatPinnedOutlineWidth: 1.5,
    threatPinnedPieceBrightness: 27,
    threatPinnedPieceDesaturation: 38,
    threatAttackDisplayMode: "square",
    threatDefenseDisplayMode: "lines",
    moveDotsPlayerColor: true,
    wedgeBaseWidthPercent: 16.7,
    wedgeTipWidthPercent: 3,
    wedgeGlowWidthPercent: 0,
    wedgeGlowBlurPercent: 30.6,
    wedgeOpacity: 0.16,
    wedgeStartOffsetPercent: 0,
    wedgeEndOffsetPercent: 33,
    wedgePotentialStrategy: "all",
    wedgePotentialCutoffValue: 1,
    wedgePotentialPerPieceCount: 3,
    threatenedPieceOutlineEnabled: true,
    threatMoveFieldDisplayMode: "lines",
    threatArcRadius: 0.45,
    threatArcThickness: 0.04,
    threatArcAngleDeg: 45,
    threatArcGapPercent: 13,
    threatArcRadialGapPercent: 50,
    segmentFigureMargin: 0.05,
    threatSquareRadius: 0.5,
    threatSquareThickness: 0.04,
    threatSquareAngleDeg: 60,
    threatSquareGapPercent: 12,
    threatSquareRadialGapPercent: 75,
    threatSquareFigureMargin: 0.05,
    threatMoveFieldRadius: 0.35,
    threatLineRadius: 0.35,
    threatLineLength: 0.16,
    threatWedgeLengthPercent: 16,
    threatWedgeWidthPercent: 10,
    threatLineThickness: 0.035,
    threatLineGap: 0.03,
    threatLineGapPercent: 29,
    threatLineFigureMargin: 0.04,
    threatLineCurvature: 0.09,
    threatSquareCornerRadiusPercent: 6,
    threatCenterOutlineEnabled: true,
    threatCenterOutlineStyle: "hatching",
    threatCenterHatchExchangeFilterEnabled: true,
    threatCenterHatchOnlySelectedCanCapture: false,
    threatCenterOutlineWidthPercent: 4.5,
    threatCenterOutlineOpacity: 50,
    threatCenterHatchSpacingPercent: 8,
    threatCenterHatchThicknessPercent: 4.25,
    threatCenterHatchAngleDeg: 102,
    threatCenterHatchSpeed: 0.1,
    removeOutlines: true,
    removeGlows: true,
    removeGradients: true,
    removeShadows: true,
    removeRoundedCorners: true,
    disableAnimations: false,
    threatenedPieceOutlineWidthPx: 1.5
  });
  const colors = Object.keys(defaults).filter(key => /Color|Light|Dark/.test(key) && typeof defaults[key] === "string");

  const ranges = {
    boardBevelPercent: [0, 100],
    boardRoundPercent: [0, 100],
    boardTopGapPercent: [0, 30],
    zenBoardUpPercent: [0, 30],
    zenClockFontSizePx: [16, 80],
    zenClockMarginPx: [0, 48],
    zenClockLineThicknessPx: [1, 10],
    zenClockLineGapPx: [0, 24],
    zenClockBlinkFrequency: [0.5, 5],
    zenClockWarningThresholdPercent: [1, 100],
    zenClockActiveEndSizePercent: [1, 30],
    zenClockActiveEndBlendPercent: [0, 50],
    idleMixPercent: [0, 100],
    hoverMixPercent: [0, 100],
    hoverDesaturation: [0, 100],
    moveDotSize: [5, 50],
    moveOutlineWidthPx: [0, 10],
    moveGlowOpacity: [0, 100],
    moveGlowRadiusPercent: [0, 50],
    lastMoveLineWidth: [1, 100],
    engineArrowOutlineWidthPercent: [1, 10],
    engineArrowOpacity: [0, 100],
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
    threatMoveFieldRadius: [0.1, 0.7],
    threatLineRadius: [0.1, 0.5],
    threatLineLength: [0, 0.3],
    threatWedgeLengthPercent: [1, 30],
    threatWedgeWidthPercent: [1, 30],
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
    defenseHighlightDepth: [1, 6],
    defenseHighlightWaveIntervalMs: [0, 1000],
    defenseHighlightDurationMs: [100, 2000],
    defenseHighlightWaveDecayPercent: [0, 50],
    defenseHighlightWhiteMixPercent: [0, 100],
    defensePreviewThresholdMs: [0, 2000],
    defenseHighlightLineWidthPercent: [0.2, 8],
    defenseHighlightLineLengthPercent: [1, 100],
    defenseHighlightLineBlurPercent: [0, 50],
    highlightLineOpacityPercent: [0, 100],
    highlightLineDecayPercent: [0, 50],
    highlightLineHoldStartOpacityPercent: [0, 100],
    defenseHighlightLineMaskBlurPx: [0, 10],
    threatOwnSeeThrough: [0, 1],
    threatOpponentSeeThrough: [0, 1],
    threatMoveDepth: [1, 5],
    threatDepthFactor: [0, 1],
    threatPieceValueInfluencePercent: [0, 100],
    threatMaxMixPercent: [0, 100],
    threatGradientPercent: [0, 100],
    pieceBounceWiggleAngle: [1, 30],
    pieceBounceTiming: [0, 5000],
    pieceBounceDuration: [200, 1500],
    pieceBounceWiggleDuration: [200, 1500],
    moveAnimationDuration: [0, 500],
    movePreviewOriginOpacity: [0, 1],
    movePreviewCorridorWidthPercent: [0, 200],
    movePreviewAnticipationPercent: [0, 100],
    moveAnimationDistanceFactor: [0, 1]
  };

  function normalize(values = {}) {
    const result = { ...defaults, ...values };
    delete result.highlightLineDurationMs;
    delete result.highlightLineArrivalLeadPercent;
    delete result.highlightLineEaseInPercent;
    delete result.highlightLineEaseOutPercent;
    if (!Object.prototype.hasOwnProperty.call(values, "highlightLineDecayPercent")
      && Object.prototype.hasOwnProperty.call(values, "defenseHighlightWaveDecayPercent")) {
      result.highlightLineDecayPercent = values.defenseHighlightWaveDecayPercent;
    }
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

    if (!["system_pixel", "system_eckig", "system_rund", "rund", "rund_comic", "cage"].includes(result.pieceSet)) {
      result.pieceSet = defaults.pieceSet;
    }
    if (!["bevel", "round"].includes(result.boardFieldShape)) {
      result.boardFieldShape = defaults.boardFieldShape;
    }
    if (!["rotate-wiggle", "wiggle-only"].includes(result.pieceBounceStyle)) {
      result.pieceBounceStyle = defaults.pieceBounceStyle;
    }
    if (!["oklab", "normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten", "difference"].includes(result.threatBlendMode)) {
      result.threatBlendMode = defaults.threatBlendMode;
    }
    if (!["dots", "outline"].includes(result.moveIndicatorMode)) {
      result.moveIndicatorMode = defaults.moveIndicatorMode;
    }
    if (!["all", "waterfall"].includes(result.wedgePotentialStrategy)) {
      result.wedgePotentialStrategy = defaults.wedgePotentialStrategy;
    }
    if (result.threatCenterOutlineStyle === "crosshatch") result.threatCenterOutlineStyle = "hatching";
    if (!["outline", "hatching"].includes(result.threatCenterOutlineStyle)) {
      result.threatCenterOutlineStyle = defaults.threatCenterOutlineStyle;
    }
    if (!["both", "lines", "hatch", "none"].includes(result.threatMoveFieldDisplayMode)) {
      result.threatMoveFieldDisplayMode = defaults.threatMoveFieldDisplayMode;
    }
    const displayModes = ["segments", "lines", "square", "wedge"];
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
    result.threatPieceValueInfluencePercent = Math.round(result.threatPieceValueInfluencePercent);
    result.wedgePotentialCutoffValue = Math.round(result.wedgePotentialCutoffValue);
    result.wedgePotentialPerPieceCount = Math.round(result.wedgePotentialPerPieceCount);
    result.threatMaxMixPercent = Math.round(result.threatMaxMixPercent);
    result.threatGradientPercent = Math.round(result.threatGradientPercent);
    result.pieceBounceWiggleAngle = Math.round(result.pieceBounceWiggleAngle);
    result.threatCenterHatchAngleDeg = Math.round(result.threatCenterHatchAngleDeg);
    result.threatCenterHatchSpeed = Number(result.threatCenterHatchSpeed.toFixed(2));
    result.defenseHighlightDepth = Math.round(result.defenseHighlightDepth);
    result.defenseHighlightWaveDecayPercent = Math.round(result.defenseHighlightWaveDecayPercent);
    result.highlightLineOpacityPercent = Math.round(result.highlightLineOpacityPercent);
    result.highlightLineDecayPercent = Math.round(result.highlightLineDecayPercent);
    result.highlightLineHoldStartOpacityPercent = Math.round(result.highlightLineHoldStartOpacityPercent);
    result.defenseHighlightLineMaskBlurPx = Number(result.defenseHighlightLineMaskBlurPx.toFixed(1));
    for (const key of ["defenseHighlightWaveIntervalMs", "defenseHighlightDurationMs", "defensePreviewThresholdMs"]) {
      result[key] = Math.round(result[key] / 10) * 10;
    }
    result.defenseHighlightWhiteMixPercent = Math.round(result.defenseHighlightWhiteMixPercent);
    result.threatCenterOutlineWidthPercent = Number(result.threatCenterOutlineWidthPercent.toFixed(1));
    result.engineArrowOutlineWidthPercent = Number(result.engineArrowOutlineWidthPercent.toFixed(1));
    result.engineArrowShaftWidthPercent = Number(result.engineArrowShaftWidthPercent.toFixed(1));
    result.engineArrowStartOffsetPercent = Math.round(result.engineArrowStartOffsetPercent);
    result.engineArrowEndOffsetPercent = Math.round(result.engineArrowEndOffsetPercent);
    result.lastMoveLineWidth = Math.round(result.lastMoveLineWidth);
    for (const key of ["zenClockFontSizePx", "zenClockMarginPx", "zenClockLineThicknessPx", "zenClockLineGapPx", "zenClockWarningThresholdPercent", "zenClockActiveEndSizePercent", "zenClockActiveEndBlendPercent"]) {
      result[key] = Math.round(result[key]);
    }
    result.zenClockBlinkFrequency = Number(result.zenClockBlinkFrequency.toFixed(1));
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
      const color = globalThis.LichessColors.parse(result[key]);
      result[key] = color && color.alpha === 1 ? globalThis.LichessColors.format(color) : defaults[key];
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
      "boardBevelEnabled",
      "threatColoringEnabled",
      "pieceBounceEnabled",
      "pieceBounceLoop",
      "selectedPieceWedgeEnabled",
      "selectedPieceWedgeOnlySelected",
      "wedgeBasePiecePreviewEnabled",
      "kingMovementFieldsEnabled",

      "defenseCirclesEnabled",
      "highlightCascadesEnabled",
      "defenseHighlightEnabled",
      "attackHighlightEnabled",
      "highlightCascadeLinesEnabled",
      "highlightCascadeLinesHoldEnabled",
      "highlightCascadeReverseEnabled",


      "moveDotsPlayerColor",
      "threatenedPieceOutlineEnabled",
      "threatCenterOutlineEnabled",
      "threatCenterHatchExchangeFilterEnabled",
      "threatCenterHatchOnlySelectedCanCapture",
      "moveAnimationLichessSpeed",
      "moveAnimationTimeDistance",
      "complexPawn",
      "zenClockShowTimeOnlyWhenLow"
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

  function getPieceAsset(settings, color, letter) {
    const { pieceSet, complexPawn } = settings;
    if (pieceSet === "cage") return `cage/cage_${letter}.svg`;
    // System Rund shares one shape per piece between both colors.
    if (pieceSet === "system_rund") return `${pieceSet}/b${letter}${letter === "p" ? "_2" : ""}.svg`;
    const suffix = letter === "p" && complexPawn && ["system_pixel", "system_eckig"].includes(pieceSet) ? "_2" : "";
    return `${pieceSet}/${color}${letter}${suffix}.svg`;
  }

  globalThis.LichessSettings = { defaults, normalize, bindFineInputs, getPieceAsset };
})();
