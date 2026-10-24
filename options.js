(() => {
  const { defaults, normalize } = globalThis.LichessSettings;
  const controls = [...document.querySelectorAll("[data-setting]")];
  const curveTabs = [...document.querySelectorAll("[data-curve-tab]")];
  const threatDisplayGroups = [...document.querySelectorAll("[data-threat-display-group], [data-threat-display-label]")];
  const status = document.getElementById("save-status");
  let bounceCurveEditor = null;
  let activeCurveKey = "pieceBounceCurve";
  let currentSettings = normalize();
  globalThis.LichessSettings.bindFineInputs(controls);

  function showSettings(values) {
    const settings = normalize(values);
    currentSettings = settings;
    setCurveTab(activeCurveKey);
    updateLoopControls(settings.pieceBounceLoop);
    updateMoveSpeedControls(settings.moveAnimationLichessSpeed);
    updateDistanceFactorControls(settings.moveAnimationTimeDistance);
    updateIndicatorModeControls(settings.moveIndicatorMode);
    for (const control of controls) {
      const value = settings[control.dataset.setting];
      if (control.type === "checkbox") control.checked = value;
      else if (control.type === "color") control.value = globalThis.LichessColors.toHex(value);
      else control.value = value;
      updateOutput(control);
    }
    updateBoardFieldControls();
    updateThreatDisplayControls();
    updateCenterOutlineControls();
    updateEngineArrowOutlineControls(settings.engineArrowOutlineEnabled);
  }

  function updateOutput(control) {
    if (control.type !== "range") return;
    const output = control.closest("label").querySelector(`[data-value-for="${control.dataset.setting}"]`);
    if (!output) return;
    if (["threatMoveDepth", "defenseHighlightDepth", "wedgePotentialCutoffValue", "wedgePotentialPerPieceCount"].includes(control.dataset.setting)) {
      output.value = control.value;
      return;
    }
    if (control.dataset.setting.endsWith("Px")) {
      output.value = `${control.value} px`;
      return;
    }
    if (["wedgeOpacity", "movePreviewOriginOpacity"].includes(control.dataset.setting)) {
      output.value = `${Math.round(Number(control.value) * 100)}%`;
      return;
    }
    if (control.dataset.setting === "moveAnimationDuration") {
      output.value = `${control.value} ms`;
      return;
    }
    if (control.dataset.setting === "moveAnimationDistanceFactor") {
      output.value = `${Number(control.value).toFixed(2)}x`;
      return;
    }
    if (control.dataset.setting === "threatCenterHatchSpeed") {
      output.value = `${Number(control.value).toFixed(2)} Felder/s`;
      return;
    }
    if (["pieceBounceTiming", "pieceBounceDuration", "pieceBounceWiggleDuration", "defenseHighlightWaveIntervalMs", "defenseHighlightDurationMs", "defensePreviewThresholdMs"].includes(control.dataset.setting)) {
      output.value = `${control.value} ms`;
      return;
    }
    if (["pieceBounceWiggleAngle", "threatArcAngleDeg", "threatSquareAngleDeg", "threatCenterHatchAngleDeg"].includes(control.dataset.setting)) {
      output.value = `${control.value}°`;
      return;
    }
    if (["threatOwnSeeThrough", "threatOpponentSeeThrough", "threatDepthFactor", "threatArcRadius", "threatArcThickness", "segmentFigureMargin", "threatSquareRadius", "threatSquareThickness", "threatSquareFigureMargin", "threatLineRadius", "threatLineLength", "threatLineThickness", "threatLineGap", "threatLineFigureMargin", "threatLineCurvature"].includes(control.dataset.setting)) {
      output.value = `${Math.round(Number(control.value) * 100)}%`;
      return;
    }
    output.value = `${control.value}%`;
  }

  function saveControl(control) {
    const value = control.type === "checkbox" ? control.checked
      : control.type === "range" ? Number(control.value)
        : control.type === "color" ? globalThis.LichessColors.toOklch(control.value)
        : control.value;
    currentSettings[control.dataset.setting] = value;
    for (const other of controls) {
      if (other === control || other.dataset.setting !== control.dataset.setting) continue;
      other.value = control.value;
      updateOutput(other);
    }
    chrome.storage.local.set({ [control.dataset.setting]: value }, () => {
      status.textContent = "Einstellungen gespeichert";
    });
  }

  function saveBounceCurve(curve) {
    const value = normalize({ ...currentSettings, [activeCurveKey]: curve })[activeCurveKey];
    currentSettings[activeCurveKey] = value;
    chrome.storage.local.set({ [activeCurveKey]: value }, () => {
      status.textContent = "Einstellungen gespeichert";
    });
  }

  // Duration of the active curve's animation, used by the curve preview.
  function previewDuration() {
    const durationKeys = { pieceBounceCurve: "pieceBounceDuration", pieceBounceWiggleCurve: "pieceBounceWiggleDuration", moveAnimationCurve: "moveAnimationDuration" };
    if (activeCurveKey === "moveAnimationCurve" && currentSettings.moveAnimationLichessSpeed) return 250;
    return currentSettings[durationKeys[activeCurveKey]];
  }

  function previewPieceUrl(piece = "r", color = "w", settings = currentSettings) {
    const asset = globalThis.LichessSettings.getPieceAsset(settings, color, piece);
    return chrome.runtime.getURL(asset);
  }

  function setCurveTab(key) {
    if (!Array.isArray(defaults[key])) return;
    activeCurveKey = key;
    for (const tab of curveTabs) tab.setAttribute("aria-pressed", String(tab.dataset.curveTab === key));
    bounceCurveEditor?.setValue(currentSettings[key], defaults[key]);
  }

  function updateLoopControls(enabled) {
    for (const control of document.querySelectorAll("[data-loop-pause]")) control.hidden = !enabled;
  }

  function updateMoveSpeedControls(lichessSpeed) {
    for (const control of document.querySelectorAll("[data-own-speed]")) control.hidden = lichessSpeed;
  }

  function updateDistanceFactorControls(enabled) {
    for (const control of document.querySelectorAll("[data-distance-factor]")) control.hidden = !enabled;
  }

  function updateIndicatorModeControls(mode) {
    for (const control of document.querySelectorAll("[data-indicator-mode]")) control.hidden = control.dataset.indicatorMode !== mode;
  }

  function updateBoardFieldControls() {
    const enabled = document.querySelector('[data-setting="boardBevelEnabled"]').checked;
    const shape = document.querySelector('[data-setting="boardFieldShape"]').value;
    document.querySelector("[data-board-field-controls]").hidden = !enabled;
    for (const control of document.querySelectorAll("[data-board-field-shape]")) {
      control.hidden = !enabled || control.dataset.boardFieldShape !== shape;
    }
  }

  function updateEngineArrowOutlineControls(enabled) {
    document.querySelector("[data-engine-arrow-outline-controls]").hidden = !enabled;
  }

  function updateThreatDisplayControls() {
    const attackMode = document.querySelector('[data-setting="threatAttackDisplayMode"]').value;
    const defenseMode = document.querySelector('[data-setting="threatDefenseDisplayMode"]').value;
    const modeNames = { segments: "Kreissegment-Einstellungen", lines: "Linieneinstellungen", square: "Eckige Segment-Einstellungen", wedge: "Keil-Einstellungen" };
    for (const group of threatDisplayGroups) {
      const mode = group.dataset.threatDisplayGroup ?? group.dataset.threatDisplayLabel;
      if (group.dataset.threatDisplayLabel) {
        const roles = [attackMode === mode && "Angriff", defenseMode === mode && "Verteidigung"].filter(Boolean);
        group.textContent = `${roles.join(" + ")}: ${modeNames[mode]}`;
        group.hidden = !roles.length;
      } else {
        group.hidden = attackMode !== mode && defenseMode !== mode;
      }
    }
  }

  function updateCenterOutlineControls() {
    const style = document.querySelector('[data-setting="threatCenterOutlineStyle"]').value;
    for (const field of document.querySelectorAll("[data-center-outline-mode]")) {
      field.hidden = field.dataset.centerOutlineMode !== style;
    }
  }

  bounceCurveEditor = globalThis.LichessBezierEditor.mount(
    document.querySelector('[data-bezier-editor="pieceBounceCurve"]'),
    defaults.pieceBounceCurve,
    saveBounceCurve,
    previewDuration
  );
  const linePreview = globalThis.LichessHighlightLinePreview.mount(
    document.querySelector("[data-highlight-line-preview]"),
    () => currentSettings,
    previewPieceUrl,
    settings => ({ gap: settings.boardGapDark, light: settings.boardLightDark, dark: settings.boardDarkDark })
  );
  const lineSettingKeys = new Set([
    "defenseHighlightLineWidthPercent", "defenseHighlightLineLengthPercent",
    "defenseHighlightLineBlurPercent", "highlightLineOpacityPercent", "highlightLineDecayPercent",
    "highlightLineHoldStartOpacityPercent", "defenseHighlightLineMaskBlurPx"
  ]);
  for (const control of controls) {
    if (lineSettingKeys.has(control.dataset.setting)) control.addEventListener("change", () => linePreview.play());
  }
  for (const tab of curveTabs) tab.addEventListener("click", () => setCurveTab(tab.dataset.curveTab));

  for (const control of controls) {
    const eventName = control.type === "range" || control.type === "color" ? "input" : "change";
    control.addEventListener(eventName, () => {
      updateOutput(control);
      saveControl(control);
      if (control.dataset.setting === "pieceBounceLoop") updateLoopControls(control.checked);
      if (control.dataset.setting === "moveAnimationLichessSpeed") updateMoveSpeedControls(control.checked);
      if (control.dataset.setting === "moveAnimationTimeDistance") updateDistanceFactorControls(control.checked);
      if (["threatAttackDisplayMode", "threatDefenseDisplayMode"].includes(control.dataset.setting)) updateThreatDisplayControls();
      if (control.dataset.setting === "threatCenterOutlineStyle") updateCenterOutlineControls();
      if (control.dataset.setting === "engineArrowOutlineEnabled") updateEngineArrowOutlineControls(control.checked);
      if (control.dataset.setting === "moveIndicatorMode") updateIndicatorModeControls(control.value);
      if (["boardBevelEnabled", "boardFieldShape"].includes(control.dataset.setting)) updateBoardFieldControls();
      if (control.dataset.setting === "enabled") {
        document.body.classList.toggle("extension-disabled", !control.checked);
      }
    });
    if (control.type === "range") {
      control.addEventListener("change", () => {
        const curveForDuration = {
          pieceBounceDuration: "pieceBounceCurve",
          pieceBounceWiggleDuration: "pieceBounceWiggleCurve",
          moveAnimationDuration: "moveAnimationCurve"
        }[control.dataset.setting];
        if (!curveForDuration) return;
        setCurveTab(curveForDuration);
        bounceCurveEditor?.preview();
      });
    }
  }

  document.getElementById("reset-settings").addEventListener("click", () => {
    chrome.storage.local.set(defaults, () => {
      showSettings(defaults);
      document.body.classList.remove("extension-disabled");
      status.textContent = "Standardwerte wiederhergestellt";
    });
  });

  chrome.storage.local.get(null, values => {
    showSettings(values);
    document.body.classList.toggle("extension-disabled", !normalize(values).enabled);
    status.textContent = "Einstellungen gespeichert";
  });
})();
