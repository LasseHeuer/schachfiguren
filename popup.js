(() => {
  const controls = [...document.querySelectorAll("[data-setting]")];
  const toggle = document.querySelector('[data-setting="enabled"]');
  const status = document.getElementById("page-status");
  const saveStatus = document.getElementById("save-status");
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const colorPicker = document.getElementById("color-picker");
  const colorPickerTitle = document.getElementById("color-picker-title");
  const colorPickerPreview = document.getElementById("color-picker-preview");
  const colorPickerHue = document.getElementById("color-picker-hue");
  const colorPickerSaturation = document.getElementById("color-picker-saturation");
  const colorPickerValue = document.getElementById("color-picker-value");
  const colorPickerSv = document.getElementById("color-picker-sv");
  const colorPickerSvThumb = document.getElementById("color-picker-sv-thumb");
  const colorInputs = controls.filter(control => control.type === "color");
  const colorPickerRanges = [colorPickerHue, colorPickerSaturation, colorPickerValue];
  const rangeTimers = new Map();
  let currentSettings = { ...globalThis.LichessSettings.defaults };
  let activeColorInput;
  globalThis.LichessSettings.bindFineInputs([...controls, ...colorPickerRanges]);

  function setTab(name, focus = false) {
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }
    for (const panel of document.querySelectorAll("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== name;
    }
  }

  function updateOutput(control) {
    if (control.type !== "range") return;
    const output = document.querySelector(`[data-value-for="${control.dataset.setting}"]`);
    if (output) output.value = `${control.value}%`;
  }

  function hexToHsv(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match) return [0, 0, 100];
    const [red, green, blue] = match[1].match(/../g).map(channel => parseInt(channel, 16) / 255);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;

    if (delta) {
      if (max === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (max === green) hue = 60 * ((blue - red) / delta + 2);
      else hue = 60 * ((red - green) / delta + 4);
      if (hue < 0) hue += 360;
    }

    return [hue, max ? delta / max * 100 : 0, max * 100];
  }

  function hsvToHex(hue, saturation, value) {
    const normalizedHue = ((hue % 360) + 360) % 360 / 60;
    const sat = saturation / 100;
    const val = value / 100;
    const chroma = val * sat;
    const second = chroma * (1 - Math.abs(normalizedHue % 2 - 1));
    const offset = val - chroma;
    const channels = normalizedHue < 1 ? [chroma, second, 0]
      : normalizedHue < 2 ? [second, chroma, 0]
        : normalizedHue < 3 ? [0, chroma, second]
          : normalizedHue < 4 ? [0, second, chroma]
            : normalizedHue < 5 ? [second, 0, chroma]
              : [chroma, 0, second];
    return `#${channels.map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("")}`;
  }

  function renderColorPicker(hue, saturation, value, color) {
    colorPickerPreview.value = color;
    colorPickerPreview.textContent = color;
    colorPickerPreview.style.backgroundColor = color;
    colorPickerPreview.style.color = value < 55 ? "#fff" : "#202620";
    colorPickerSv.style.backgroundColor = hsvToHex(hue, 100, 100);
    colorPickerSvThumb.style.left = `${saturation}%`;
    colorPickerSvThumb.style.top = `${100 - value}%`;
    document.getElementById("color-picker-hue-value").value = `${Math.round(hue)} deg`;
    document.getElementById("color-picker-saturation-value").value = `${Math.round(saturation)}%`;
    document.getElementById("color-picker-value-value").value = `${Math.round(value)}%`;
    colorPickerHue.style.setProperty("--picker-track", "linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)");
    colorPickerSaturation.style.setProperty("--picker-track", `linear-gradient(90deg, ${hsvToHex(hue, 0, value)}, ${hsvToHex(hue, 100, value)})`);
    colorPickerValue.style.setProperty("--picker-track", `linear-gradient(90deg, #000, ${hsvToHex(hue, saturation, 100)})`);
  }

  function showColorPicker(control) {
    activeColorInput = control;
    colorPickerTitle.textContent = control.closest("label")?.querySelector("span")?.textContent.trim() || "Farbe";
    const [hue, saturation, value] = hexToHsv(control.value);
    colorPickerHue.value = String(Math.round(hue) % 360);
    colorPickerSaturation.value = String(Math.round(saturation));
    colorPickerValue.value = String(Math.round(value));
    renderColorPicker(hue, saturation, value, control.value);
    colorPicker.hidden = false;
    colorPicker.scrollIntoView({ block: "nearest" });
  }

  function updateColorFromPicker() {
    if (!activeColorInput) return;
    const hue = Number(colorPickerHue.value);
    const saturation = Number(colorPickerSaturation.value);
    const value = Number(colorPickerValue.value);
    const color = hsvToHex(hue, saturation, value);
    renderColorPicker(hue, saturation, value, color);
    if (activeColorInput.value === color) return;
    activeColorInput.value = color;
    activeColorInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function hideColorPicker() {
    colorPicker.hidden = true;
    activeColorInput = undefined;
  }

  let svDrag;
  function updateColorFromSv(event) {
    if (!svDrag || event.pointerId !== svDrag.pointerId) return;
    const rect = colorPickerSv.getBoundingClientRect();
    let saturation;
    let value;
    if (svDrag.shiftKey) {
      saturation = svDrag.saturation + (event.clientX - svDrag.x) / rect.width * 25;
      value = svDrag.value - (event.clientY - svDrag.y) / rect.height * 25;
    } else {
      saturation = (event.clientX - rect.left) / rect.width * 100;
      value = (rect.bottom - event.clientY) / rect.height * 100;
    }
    colorPickerSaturation.value = String(Math.max(0, Math.min(100, Math.round(saturation))));
    colorPickerValue.value = String(Math.max(0, Math.min(100, Math.round(value))));
    updateColorFromPicker();
  }

  function showSettings(values) {
    const settings = globalThis.LichessSettings.normalize(values);
    currentSettings = settings;
    for (const control of controls) {
      const value = settings[control.dataset.setting];
      if (control.type === "checkbox") control.checked = value;
      else control.value = value;
      updateOutput(control);
    }
  }

  function saveControl(control) {
    const value = control.type === "checkbox" ? control.checked
      : control.type === "range" ? Number(control.value)
        : control.value;
    currentSettings[control.dataset.setting] = value;
    chrome.storage.local.set({ [control.dataset.setting]: value }, () => {
      saveStatus.textContent = "Gespeichert";
    });
  }

  function showPageStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (!tab?.url?.startsWith("https://lichess.org/")) {
        status.textContent = "Lichess in diesem Tab oeffnen";
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: "lfs-status" }, result => {
        if (chrome.runtime.lastError || !result) {
          status.textContent = "Nicht geladen. Erweiterung und Lichess-Seite neu laden.";
          return;
        }
        if (!result.ready) {
          status.textContent = "Wird geladen. Lichess-Seite neu laden, falls noetig.";
          return;
        }
        status.textContent = !toggle.checked
          ? "Anpassungen sind ausgeschaltet"
          : result.enabled && result.piecesLoaded
            ? result.boardPresent
              ? result.boardHeight === 0
                ? "Brett hat 0 Pixel Hoehe. Erweiterung neu laden."
                : result.pieceCount
                ? `Aktiv. Brett mit ${result.pieceCount} Figuren erkannt.`
                : "Brett erkannt, aber keine Figuren gefunden."
              : "Aktiv; auf dieser Seite kein Brett erkannt."
            : "Nicht aktiv. Lichess-Seite neu laden.";
      });
    });
  }

  for (const tab of tabs) tab.addEventListener("click", () => setTab(tab.dataset.tab));

  for (const input of colorInputs) {
    input.title = "Eigenen Farbpicker mit Farbton, Saettigung und Helligkeit oeffnen";
    input.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      showColorPicker(input);
    });
  }
  for (const control of colorPickerRanges) {
    control.addEventListener("input", updateColorFromPicker);
  }
  colorPickerSv.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    svDrag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      saturation: Number(colorPickerSaturation.value),
      value: Number(colorPickerValue.value),
      shiftKey: event.shiftKey
    };
    colorPickerSv.setPointerCapture(event.pointerId);
    updateColorFromSv(event);
  });
  colorPickerSv.addEventListener("pointermove", updateColorFromSv);
  colorPickerSv.addEventListener("pointerup", event => {
    if (!svDrag || event.pointerId !== svDrag.pointerId) return;
    updateColorFromSv(event);
    svDrag = undefined;
  });
  colorPickerSv.addEventListener("pointercancel", () => { svDrag = undefined; });
  document.getElementById("close-color-picker").addEventListener("click", hideColorPicker);
  document.addEventListener("pointerdown", event => {
    if (!colorPicker.hidden && !colorPicker.contains(event.target) && !colorInputs.includes(event.target)) hideColorPicker();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !colorPicker.hidden) hideColorPicker();
  });

  document.querySelector('[role="tablist"]').addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next].dataset.tab, true);
  });

  for (const control of controls) {
    if (control.type === "range") {
      control.addEventListener("input", () => {
        updateOutput(control);
        currentSettings[control.dataset.setting] = Number(control.value);
        clearTimeout(rangeTimers.get(control));
        rangeTimers.set(control, setTimeout(() => saveControl(control), 140));
      });
      control.addEventListener("change", () => {
        clearTimeout(rangeTimers.get(control));
        saveControl(control);
      });
    } else if (control.type === "color") {
      control.addEventListener("input", () => saveControl(control));
    } else {
      control.addEventListener("change", () => saveControl(control));
    }
  }

  document.getElementById("reset-settings").addEventListener("click", () => {
    hideColorPicker();
    chrome.storage.local.set(globalThis.LichessSettings.defaults, () => {
      showSettings(globalThis.LichessSettings.defaults);
      saveStatus.textContent = "Standardwerte geladen";
    });
  });

  document.getElementById("export-settings").addEventListener("click", () => {
    const contents = JSON.stringify({
      format: "lichess-figurensets-settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: globalThis.LichessSettings.normalize(currentSettings)
    }, null, 2);
    chrome.downloads.download({
      url: `data:application/json;charset=utf-8,${encodeURIComponent(contents)}`,
      filename: "lichess-figurensets-einstellungen.json",
      conflictAction: "uniquify",
      saveAs: true
    }, downloadId => {
      saveStatus.textContent = chrome.runtime.lastError || downloadId === undefined
        ? "Export fehlgeschlagen"
        : "Download gestartet";
    });
  });

  chrome.storage.local.get(globalThis.LichessSettings.defaults, values => {
    showSettings(values);
    showPageStatus();
  });
})();
