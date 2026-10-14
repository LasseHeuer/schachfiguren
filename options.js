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
    for (const control of controls) {
      const value = settings[control.dataset.setting];
      if (control.type === "checkbox") control.checked = value;
      else control.value = value;
      updateOutput(control);
    }
    updateThreatDisplayControls();
    updateCenterOutlineControls();
    updateEngineArrowOutlineControls(settings.engineArrowOutlineEnabled);
  }

  function updateOutput(control) {
    if (control.type !== "range") return;
    const output = document.querySelector(`[data-value-for="${control.dataset.setting}"]`);
    if (!output) return;
    if (["threatMoveDepth", "wedgePotentialCutoffValue", "wedgePotentialPerPieceCount"].includes(control.dataset.setting)) {
      output.value = control.value;
      return;
    }
    if (control.dataset.setting.endsWith("Px")) {
      output.value = `${control.value} px`;
      return;
    }
    if (control.dataset.setting === "wedgeOpacity") {
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
    if (["pieceBounceTiming", "pieceBounceDuration", "pieceBounceWiggleDuration"].includes(control.dataset.setting)) {
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
        : control.value;
    currentSettings[control.dataset.setting] = value;
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

  function updateEngineArrowOutlineControls(enabled) {
    document.querySelector("[data-engine-arrow-outline-controls]").hidden = !enabled;
  }

  function updateThreatDisplayControls() {
    const attackMode = document.querySelector('[data-setting="threatAttackDisplayMode"]').value;
    const defenseMode = document.querySelector('[data-setting="threatDefenseDisplayMode"]').value;
    const modeNames = { segments: "Kreissegment-Einstellungen", lines: "Linieneinstellungen", square: "Eckige Segment-Einstellungen" };
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
