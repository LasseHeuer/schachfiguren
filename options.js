(() => {
  const { defaults, normalize } = globalThis.LichessSettings;
  const controls = [...document.querySelectorAll("[data-setting]")];
  const status = document.getElementById("save-status");
  globalThis.LichessSettings.bindFineInputs(controls);

  function showSettings(values) {
    const settings = normalize(values);
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

  for (const control of controls) {
    const eventName = control.type === "range" || control.type === "color" ? "input" : "change";
    control.addEventListener(eventName, () => {
      updateOutput(control);
      saveControl(control);
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

  chrome.storage.local.get(defaults, values => {
    showSettings(values);
    document.body.classList.toggle("extension-disabled", !normalize(values).enabled);
    status.textContent = "Einstellungen gespeichert";
  });
})();
