(() => {
  const { defaults, normalize } = globalThis.LichessSettings;
  const controls = [...document.querySelectorAll("[data-setting]")];
  const curveTabs = [...document.querySelectorAll("[data-curve-tab]")];
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
    for (const control of controls) {
      const value = settings[control.dataset.setting];
      if (control.type === "checkbox") control.checked = value;
      else control.value = value;
      updateOutput(control);
    }
  }

  function updateOutput(control) {
    if (control.type !== "range") return;
    const output = document.querySelector(`[data-value-for="${control.dataset.setting}"]`);
    if (!output) return;
    if (control.dataset.setting === "threatMoveDepth") {
      output.value = control.value;
      return;
    }
    if (["pieceBounceTiming", "pieceBounceDuration", "pieceBounceWiggleDuration"].includes(control.dataset.setting)) {
      output.value = `${control.value} ms`;
      return;
    }
    if (control.dataset.setting === "pieceBounceWiggleAngle") {
      output.value = `${control.value}°`;
      return;
    }
    if (["threatOwnSeeThrough", "threatOpponentSeeThrough", "threatDepthFactor"].includes(control.dataset.setting)) {
      output.value = `${Math.round(Number(control.value) * 100)}%`;
      return;
    }
    output.value = `${control.value}%`;
  }

  function saveControl(control) {
    const value = control.type === "checkbox" ? control.checked
      : control.type === "range" ? Number(control.value)
        : control.value;
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

  function setCurveTab(key) {
    if (!Array.isArray(defaults[key])) return;
    activeCurveKey = key;
    for (const tab of curveTabs) tab.setAttribute("aria-pressed", String(tab.dataset.curveTab === key));
    bounceCurveEditor?.setValue(currentSettings[key], defaults[key]);
  }

  function updateLoopControls(enabled) {
    for (const control of document.querySelectorAll("[data-loop-pause]")) control.hidden = !enabled;
  }

  bounceCurveEditor = globalThis.LichessBezierEditor.mount(
    document.querySelector('[data-bezier-editor="pieceBounceCurve"]'),
    defaults.pieceBounceCurve,
    saveBounceCurve
  );
  for (const tab of curveTabs) tab.addEventListener("click", () => setCurveTab(tab.dataset.curveTab));

  for (const control of controls) {
    const eventName = control.type === "range" || control.type === "color" ? "input" : "change";
    control.addEventListener(eventName, () => {
      updateOutput(control);
      saveControl(control);
      if (control.dataset.setting === "pieceBounceLoop") updateLoopControls(control.checked);
      if (control.dataset.setting === "enabled") {
        document.body.classList.toggle("extension-disabled", !control.checked);
      }
    });
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
