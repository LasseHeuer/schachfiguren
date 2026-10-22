(() => {
  const controls = [...document.querySelectorAll("[data-setting]")];
  const colors = globalThis.LichessColors;
  const soundCatalog = globalThis.LichessSoundCatalog;
  const soundSettingsKey = "soundSettings";
  const soundFilesKey = "lfsCustomSoundFiles";
  const soundFilePrefix = "lfsCustomSound:";
  const soundSettingsElement = document.getElementById("sound-settings");
  const soundFolderInput = document.getElementById("sound-folder-input");
  const soundFolderStatus = document.getElementById("sound-folder-status");
  const toggle = document.querySelector('[data-setting="enabled"]');
  const status = document.getElementById("page-status");
  const saveStatus = document.getElementById("save-status");
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const curveTabs = [...document.querySelectorAll("[data-curve-tab]")];
  const colorPicker = document.getElementById("color-picker");
  const colorPickerTitle = document.getElementById("color-picker-title");
  const colorPickerPreview = document.getElementById("color-picker-preview");
  const colorPickerHue = document.getElementById("color-picker-hue");
  const colorPickerSaturation = document.getElementById("color-picker-saturation");
  const colorPickerValue = document.getElementById("color-picker-value");
  const colorPickerSv = document.getElementById("color-picker-sv");
  const colorPickerSvThumb = document.getElementById("color-picker-sv-thumb");
  const colorPickerCanvas = document.getElementById("color-picker-cl-canvas");
  const colorInputs = controls.filter(control => control.type === "color");
  const colorPickerRanges = [colorPickerHue, colorPickerSaturation, colorPickerValue];
  const rangeTimers = new Map();
  let currentSettings = { ...globalThis.LichessSettings.defaults };
  let activeCurveKey = "pieceBounceCurve";
  let activeColorInput;
  let pickerColor;
  let fieldHue;
  let bounceCurveEditor = null;
  let currentSoundSettings = {};
  let customSoundNames = [];
  let pendingCustomSelection;
  let openSoundList;
  let previewAudio;
  const customSoundCache = new Map();
  globalThis.LichessSettings.bindFineInputs([...controls, ...colorPickerRanges]);

  const uiStateKey = "popupUiState";
  const detailsSections = [...document.querySelectorAll("details")];

  function loadUiState() {
    return JSON.parse(localStorage.getItem(uiStateKey)) ?? {};
  }

  function saveUiState(patch) {
    localStorage.setItem(uiStateKey, JSON.stringify({ ...loadUiState(), ...patch }));
  }

  function setTab(name, focus = false) {
    saveUiState({ tab: name });
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

  // Duplicated sections (attack and defense) each have their own output element, so all of them are updated.
  function updateOutput(control) {
    if (control.type !== "range") return;
    const text = formatOutput(control);
    for (const output of document.querySelectorAll(`[data-value-for="${control.dataset.setting}"]`)) output.value = text;
  }

  function formatOutput(control) {
    if (["threatMoveDepth", "defenseHighlightDepth", "wedgePotentialCutoffValue", "wedgePotentialPerPieceCount"].includes(control.dataset.setting)) {
      return control.value;
    }
    if (control.dataset.setting.endsWith("Px")) return `${control.value} px`;
    if (["wedgeOpacity", "movePreviewOriginOpacity"].includes(control.dataset.setting)) return `${Math.round(Number(control.value) * 100)}%`;
    if (control.dataset.setting === "moveAnimationDuration") return `${control.value} ms`;
    if (control.dataset.setting === "moveAnimationDistanceFactor") return `${Number(control.value).toFixed(2)}x`;
    if (control.dataset.setting === "zenClockBlinkFrequency") return `${Number(control.value).toFixed(1)} Hz`;
    if (control.dataset.setting === "threatCenterHatchSpeed") return `${Number(control.value).toFixed(2)} Felder/s`;
    if (["pieceBounceTiming", "pieceBounceDuration", "pieceBounceWiggleDuration", "defenseHighlightWaveIntervalMs", "defenseHighlightDurationMs", "defensePreviewThresholdMs"].includes(control.dataset.setting)) {
      return `${control.value} ms`;
    }
    if (["pieceBounceWiggleAngle", "threatArcAngleDeg", "threatSquareAngleDeg", "threatCenterHatchAngleDeg"].includes(control.dataset.setting)) {
      return `${control.value}°`;
    }
    if (["threatOwnSeeThrough", "threatOpponentSeeThrough", "threatDepthFactor", "threatArcRadius", "threatArcThickness", "segmentFigureMargin", "threatSquareRadius", "threatSquareThickness", "threatSquareFigureMargin", "threatLineRadius", "threatLineLength", "threatLineThickness", "threatLineGap", "threatLineFigureMargin", "threatLineCurvature"].includes(control.dataset.setting)) {
      return `${Math.round(Number(control.value) * 100)}%`;
    }
    return `${control.value}%`;
  }

  function renderColorField(hue) {
    const rect = colorPickerSv.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(2, Math.round(rect.width * scale));
    const height = Math.max(2, Math.round(rect.height * scale));
    if (fieldHue === hue && colorPickerCanvas.width === width && colorPickerCanvas.height === height) return;
    fieldHue = hue;
    colorPickerCanvas.width = width;
    colorPickerCanvas.height = height;
    const context = colorPickerCanvas.getContext("2d");
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const row = colors.toGamut({ l: 1 - y / (height - 1), c: 0.4, h: hue, alpha: 1 });
      for (let x = 0; x < width; x++) {
        // Use the entire available gamut at each lightness, without clipped plateaus.
        const rgb = colors.toRgb({ ...row, c: x / (width - 1) * row.c });
        const offset = (y * width + x) * 4;
        image.data[offset] = rgb[0];
        image.data[offset + 1] = rgb[1];
        image.data[offset + 2] = rgb[2];
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }

  function renderColorPicker(color = colors.format(pickerColor)) {
    const { h, c, l } = pickerColor;
    colorPickerHue.value = String(h);
    colorPickerValue.value = String(l * 100);
    colorPickerPreview.value = color;
    colorPickerPreview.textContent = `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
    colorPickerPreview.title = color;
    colorPickerPreview.style.backgroundColor = colors.format(colors.toGamut(pickerColor));
    colorPickerPreview.style.color = l < 0.6 ? "oklch(1 0 0)" : colors.toOklch("#202620");
    const maxChroma = colors.toGamut({ ...pickerColor, c: 0.4 }).c;
    colorPickerSaturation.max = String(Math.max(0.0001, maxChroma));
    colorPickerSaturation.value = String(c);
    colorPickerSvThumb.style.left = `${maxChroma > 0.000001 ? Math.min(c / maxChroma, 1) * 100 : 0}%`;
    colorPickerSvThumb.style.top = `${(1 - l) * 100}%`;
    document.getElementById("color-picker-hue-value").value = `${h.toFixed(1)}`;
    document.getElementById("color-picker-saturation-value").value = c.toFixed(4);
    document.getElementById("color-picker-value-value").value = `${(l * 100).toFixed(2)}%`;
    for (const [control, channel, maximum] of [[colorPickerHue, "h", 360], [colorPickerSaturation, "c", maxChroma], [colorPickerValue, "l", 1]]) {
      const count = channel === "h" ? 36 : channel === "c" ? 1 : 16;
      const stops = Array.from({ length: count + 1 }, (_, index) => {
        const sample = colors.toGamut({ ...(channel === "h" ? { l: 0.72, c: 0.12, h, alpha: 1 } : pickerColor), alpha: 1, [channel]: index / count * maximum });
        return `${colors.format(sample)} ${index / count * 100}%`;
      });
      control.style.setProperty("--picker-track", `linear-gradient(90deg in oklch, ${stops.join(", ")})`);
    }
    renderColorField(h);
  }

  function showColorPicker(control) {
    activeColorInput = control;
    colorPickerTitle.textContent = control.closest("label")?.querySelector("span")?.textContent.trim() || "Farbe";
    const color = currentSettings[control.dataset.setting];
    pickerColor = colors.parse(color);
    colorPicker.hidden = false;
    renderColorPicker(color);
  }

  function updateColorFromPicker() {
    if (!activeColorInput) return;
    pickerColor = colors.toGamut(pickerColor);
    const color = colors.format(pickerColor);
    renderColorPicker(color);
    if (currentSettings[activeColorInput.dataset.setting] === color) return;
    activeColorInput.value = colors.toHex(pickerColor);
    saveControl(activeColorInput, color);
  }

  function hideColorPicker() {
    colorPicker.hidden = true;
    activeColorInput = undefined;
  }

  let svDrag;
  function updateColorFromSv(event) {
    if (!svDrag || event.pointerId !== svDrag.pointerId) return;
    const rect = colorPickerSv.getBoundingClientRect();
    let fraction;
    let lightness;
    if (svDrag.shiftKey) {
      if (event.clientX === svDrag.x && event.clientY === svDrag.y) return;
      fraction = svDrag.fraction + (event.clientX - svDrag.x) / rect.width * 0.25;
      lightness = svDrag.lightness - (event.clientY - svDrag.y) / rect.height * 0.25;
    } else {
      fraction = (event.clientX - rect.left) / rect.width;
      lightness = (rect.bottom - event.clientY) / rect.height;
    }
    const row = colors.toGamut({ ...pickerColor, c: 0.4, l: Math.max(0, Math.min(1, lightness)) });
    pickerColor = { ...row, c: Math.max(0, Math.min(1, fraction)) * row.c };
    updateColorFromPicker();
  }

  function showSettings(values) {
    const settings = globalThis.LichessSettings.normalize(values);
    currentSettings = settings;
    setCurveTab(activeCurveKey);
    for (const control of controls) {
      const value = settings[control.dataset.setting];
      if (control.type === "checkbox") control.checked = value;
      else if (control.type === "color") control.value = colors.toHex(colors.toGamut(colors.parse(value)));
      else control.value = value;
      updateOutput(control);
    }
    updateThreatDisplayControls();
    updateDependentControls();
    bounceCurveEditor?.updatePreviewPieces();
  }

  function saveControl(control, color) {
    const value = control.type === "checkbox" ? control.checked
      : control.type === "range" ? Number(control.value)
        : control.type === "color" ? colors.toOklch(color ?? control.value)
          : control.value;
    currentSettings[control.dataset.setting] = value;
    syncDuplicateControls(control);
    chrome.storage.local.set({ [control.dataset.setting]: value }, () => {
      saveStatus.textContent = "Gespeichert";
    });
  }

  function saveBounceCurve(curve) {
    const value = globalThis.LichessSettings.normalize({ ...currentSettings, [activeCurveKey]: curve })[activeCurveKey];
    currentSettings[activeCurveKey] = value;
    chrome.storage.local.set({ [activeCurveKey]: value }, () => {
      saveStatus.textContent = "Gespeichert";
    });
  }

  // Duration of the active curve's animation, used by the curve preview.
  function previewDuration(distance = 1) {
    const durationKeys = { pieceBounceCurve: "pieceBounceDuration", pieceBounceWiggleCurve: "pieceBounceWiggleDuration", moveAnimationCurve: "moveAnimationDuration" };
    const baseDuration = activeCurveKey === "moveAnimationCurve" && currentSettings.moveAnimationLichessSpeed
      ? 250
      : currentSettings[durationKeys[activeCurveKey]];
    if (activeCurveKey !== "moveAnimationCurve" || !currentSettings.moveAnimationTimeDistance) return baseDuration;
    return baseDuration + distance * currentSettings.moveAnimationDistanceFactor * baseDuration;
  }

  function previewPieceUrl() {
    const asset = currentSettings.pieceSet === "cage" ? "cage/cage_r.svg" : `${currentSettings.pieceSet}/wr.svg`;
    return chrome.runtime.getURL(asset);
  }

  function setCurveTab(key) {
    if (!Array.isArray(globalThis.LichessSettings.defaults[key])) return;
    activeCurveKey = key;
    for (const tab of curveTabs) tab.setAttribute("aria-pressed", String(tab.dataset.curveTab === key));
    bounceCurveEditor?.setValue(currentSettings[key], globalThis.LichessSettings.defaults[key]);
  }

  // data-depends-on lists conditions separated by spaces: "name" needs a checked checkbox, "name=value" needs that select value.
  function isConditionMet(condition) {
    if (condition.startsWith("!")) return !isConditionMet(condition.slice(1));
    const [name, value] = condition.split("=");
    const control = document.querySelector(`[data-setting="${name}"]`);
    return value === undefined ? control.checked : control.value === value;
  }

  // Dropdowns and sliders are only shown while their conditions (data-depends-on) are met.
  function updateDependentControls() {
    for (const element of document.querySelectorAll("[data-depends-on]")) {
      element.hidden = !element.dataset.dependsOn.split(" ").every(isConditionMet);
    }
  }

  function customSoundStorageKey(name) {
    return `${soundFilePrefix}${name}`;
  }

  function readCustomSound(name) {
    if (customSoundCache.has(name)) return Promise.resolve(customSoundCache.get(name));
    return new Promise(resolve => {
      chrome.storage.local.get(customSoundStorageKey(name), values => {
        const dataUrl = values[customSoundStorageKey(name)] || (soundCatalog.customFiles.includes(name)
          ? chrome.runtime.getURL(`sounds/${encodeURIComponent(name)}`)
          : undefined);
        if (dataUrl) customSoundCache.set(name, dataUrl);
        resolve(dataUrl);
      });
    });
  }

  function previewWebsiteSound(event, source, volume) {
    return new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs[0];
        if (!tab?.url?.startsWith("https://lichess.org/")) {
          resolve(false);
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: "lfs-preview-sound", name: event.id, source, volume: Number(volume) }, response => {
          resolve(!chrome.runtime.lastError && response?.ok === true);
        });
      });
    });
  }

  async function previewSound(event, source, volume) {
    if (source !== "website" && !source.startsWith("custom:")) {
      if (await previewWebsiteSound(event, source, volume)) return;
      soundFolderStatus.textContent = "Soundpack-Vorschau ist nur auf einer geoeffneten Lichess-Seite moeglich.";
      return;
    }
    if (source === "website") {
      if (await previewWebsiteSound(event, source, volume)) return;
      soundFolderStatus.textContent = "Website-Soundvorschau ist nur auf einer geoeffneten Lichess-Seite moeglich.";
      return;
    }
    const url = await readCustomSound(source.slice("custom:".length));
    if (!url) {
      soundFolderStatus.textContent = "Ordner „sounds“ waehlen, um diese Datei zu laden und vorzuspielen.";
      return;
    }
    previewAudio?.pause();
    previewAudio = new Audio(url);
    previewAudio.volume = Math.max(0, Math.min(1, Number(volume) / 100));
    previewAudio.play().catch(() => {
      soundFolderStatus.textContent = "Soundvorschau konnte nicht abgespielt werden.";
    });
  }

  function renderSoundSettings() {
    openSoundList = undefined;
    soundSettingsElement.replaceChildren();
    for (const event of soundCatalog.events) {
      const setting = currentSoundSettings[event.key] ?? { source: "website", volume: 100 };
      const row = document.createElement("section");
      row.className = "sound-setting";
      const heading = document.createElement("h3");
      heading.textContent = event.label;
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "sound-select-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-label", `Sound fuer ${event.label}`);
      const options = document.createElement("div");
      options.className = "sound-option-list";
      options.id = `sound-options-${event.key}`;
      options.setAttribute("role", "listbox");
      options.hidden = true;
      trigger.setAttribute("aria-controls", options.id);
      const sourceOptions = [{ source: "website", label: "Lichess (aktuelle Auswahl)" }];
      const availablePacks = soundCatalog.packs.filter(pack => !event.packs || event.packs.includes(pack.id));
      for (const pack of availablePacks) sourceOptions.push({ source: `pack:${pack.id}`, label: pack.label });
      const selectedCustomNames = Object.values(currentSoundSettings)
        .map(value => value?.source)
        .filter(source => typeof source === "string" && source.startsWith("custom:"))
        .map(source => source.slice("custom:".length));
      const allCustomNames = [...new Set([...soundCatalog.customFiles, ...customSoundNames, ...selectedCustomNames])];
      for (const name of allCustomNames) sourceOptions.push({ source: `custom:${name}`, label: `Eigener Sound: ${name}` });
      let selectedSource = sourceOptions.find(option => option.source === setting.source) ?? sourceOptions[0];
      trigger.textContent = selectedSource.label;

      function closeOptions() {
        options.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        if (openSoundList === options) openSoundList = undefined;
      }

      trigger.addEventListener("click", () => {
        if (!options.hidden) {
          closeOptions();
          return;
        }
        if (openSoundList && openSoundList !== options) {
          openSoundList.hidden = true;
          openSoundList.previousElementSibling?.setAttribute("aria-expanded", "false");
        }
        options.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        openSoundList = options;
      });
      trigger.addEventListener("keydown", eventKey => {
        if (eventKey.key !== "ArrowDown" && eventKey.key !== "ArrowUp") return;
        eventKey.preventDefault();
        if (options.hidden) trigger.click();
        options.querySelector("button")?.focus();
      });
      for (const sourceOption of sourceOptions) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "sound-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(sourceOption.source === selectedSource.source));
        option.textContent = sourceOption.label;
        option.addEventListener("pointerenter", () => previewSound(event, sourceOption.source, volume.value));
        option.addEventListener("click", () => {
          if (sourceOption.source.startsWith("custom:") && !soundCatalog.customFiles.includes(sourceOption.source.slice("custom:".length)) && !customSoundNames.includes(sourceOption.source.slice("custom:".length))) {
            pendingCustomSelection = { eventKey: event.key, source: sourceOption.source };
            soundFolderStatus.textContent = "Waehle den Ordner „sounds“, um die eigene Datei zu laden.";
            closeOptions();
            soundFolderInput.click();
            return;
          }
          selectedSource = sourceOption;
          currentSoundSettings[event.key] = { source: sourceOption.source, volume: Number(volume.value) };
          currentSettings[soundSettingsKey] = currentSoundSettings;
          for (const sibling of options.querySelectorAll("[role=option]")) {
            sibling.setAttribute("aria-selected", String(sibling === option));
          }
          trigger.textContent = sourceOption.label;
          saveStatus.textContent = "";
          chrome.storage.local.set({ [soundSettingsKey]: currentSoundSettings }, () => {
            saveStatus.textContent = "Soundeinstellungen gespeichert";
          });
          closeOptions();
          trigger.focus();
        });
        option.addEventListener("keydown", eventKey => {
          if (eventKey.key === "Escape") {
            closeOptions();
            trigger.focus();
          }
        });
        options.append(option);
      }

      const volumeLabel = document.createElement("label");
      volumeLabel.className = "sound-volume";
      const volumeText = document.createElement("span");
      volumeText.textContent = "Lautstaerke";
      const volume = document.createElement("input");
      volume.type = "range";
      volume.min = "0";
      volume.max = "100";
      volume.step = "1";
      volume.value = String(Math.max(0, Math.min(100, Number(setting.volume ?? 100))));
      volume.setAttribute("aria-label", `Lautstaerke fuer ${event.label}`);
      const output = document.createElement("output");
      output.value = `${volume.value}%`;
      volumeLabel.append(volumeText, volume, output);
      row.append(heading, trigger, options, volumeLabel);

      const saveVolume = () => {
        currentSoundSettings[event.key] = { source: selectedSource.source, volume: Number(volume.value) };
        currentSettings[soundSettingsKey] = currentSoundSettings;
        chrome.storage.local.set({ [soundSettingsKey]: currentSoundSettings }, () => {
          saveStatus.textContent = "Soundeinstellungen gespeichert";
        });
      };
      volume.addEventListener("input", () => {
        output.value = `${volume.value}%`;
        saveVolume();
      });
      volume.addEventListener("change", () => previewSound(event, selectedSource.source, volume.value));
      soundSettingsElement.append(row);
    }
  }

  function readAudioFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result), { once: true });
      reader.addEventListener("error", () => reject(reader.error), { once: true });
      reader.readAsDataURL(file);
    });
  }

  async function importSoundFolder() {
    const files = [...soundFolderInput.files].filter(file => file.type.startsWith("audio/") || /\.(wav|mp3|ogg|opus|m4a|aac)$/i.test(file.name));
    if (!files.length) {
      soundFolderStatus.textContent = "Im ausgewaehlten Ordner wurden keine Audiodateien gefunden.";
      pendingCustomSelection = undefined;
      soundFolderInput.value = "";
      return;
    }
    soundFolderStatus.textContent = `${files.length} Sounddateien werden geladen …`;
    const storedFiles = {};
    const importedNames = new Set(customSoundNames);
    try {
      for (const file of files) {
        const relativeName = file.webkitRelativePath.split("/").slice(1).join("/") || file.name;
        storedFiles[customSoundStorageKey(relativeName)] = await readAudioFile(file);
        importedNames.add(relativeName);
      }
    } catch {
      soundFolderStatus.textContent = "Mindestens eine Sounddatei konnte nicht gelesen werden.";
      pendingCustomSelection = undefined;
      soundFolderInput.value = "";
      return;
    }
    storedFiles[soundFilesKey] = [...importedNames].sort((a, b) => a.localeCompare(b));
    chrome.storage.local.set(storedFiles, () => {
      if (chrome.runtime.lastError) {
        soundFolderStatus.textContent = "Sounddateien konnten nicht gespeichert werden.";
        pendingCustomSelection = undefined;
        soundFolderInput.value = "";
        return;
      }
      for (const file of files) {
        const relativeName = file.webkitRelativePath.split("/").slice(1).join("/") || file.name;
        customSoundCache.delete(relativeName);
      }
      customSoundNames = storedFiles[soundFilesKey];
      let importMessage = `${customSoundNames.length} eigene Sounddateien verfuegbar.`;
      if (pendingCustomSelection) {
        const fileName = pendingCustomSelection.source.slice("custom:".length);
        if (customSoundNames.includes(fileName)) {
          const current = currentSoundSettings[pendingCustomSelection.eventKey] ?? { volume: 100 };
          currentSoundSettings[pendingCustomSelection.eventKey] = { ...current, source: pendingCustomSelection.source };
          currentSettings[soundSettingsKey] = currentSoundSettings;
          chrome.storage.local.set({ [soundSettingsKey]: currentSoundSettings });
          importMessage = `„${fileName}“ wurde ausgewaehlt und geladen.`;
        } else {
          importMessage = `„${fileName}“ wurde im Ordner nicht gefunden.`;
        }
        pendingCustomSelection = undefined;
      }
      renderSoundSettings();
      soundFolderStatus.textContent = importMessage;
      soundFolderInput.value = "";
    });
  }

  function updateThreatDisplayControls() {
    for (const role of ["attack", "defense"]) {
      const mode = document.querySelector(`[data-setting="threat${role === "attack" ? "Attack" : "Defense"}DisplayMode"]`).value;
      for (const group of document.querySelectorAll(`[data-threat-role="${role}"] [data-threat-display-group], [data-threat-role="${role}"] [data-threat-display-label]`)) {
        group.hidden = (group.dataset.threatDisplayGroup ?? group.dataset.threatDisplayLabel) !== mode;
      }
    }
  }

  // Attack and defense sections each show their own sliders; equal settings are kept in sync.
  function syncDuplicateControls(control) {
    for (const other of controls) {
      if (other === control || other.dataset.setting !== control.dataset.setting) continue;
      if (other.type === "checkbox") other.checked = control.checked;
      else other.value = control.value;
      updateOutput(other);
    }
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

  document.addEventListener("pointerdown", event => {
    if (!openSoundList || openSoundList.parentElement.contains(event.target)) return;
    openSoundList.hidden = true;
    openSoundList.previousElementSibling?.setAttribute("aria-expanded", "false");
    openSoundList = undefined;
  });

  document.getElementById("sound-folder-button").addEventListener("click", () => soundFolderInput.click());
  soundFolderInput.addEventListener("change", importSoundFolder);

  for (const input of colorInputs) {
    input.title = "OKLCH-Farbpicker mit Farbton, Chroma und Helligkeit oeffnen";
    input.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      showColorPicker(input);
    });
  }
  for (const control of colorPickerRanges) {
    control.addEventListener("input", () => {
      if (!activeColorInput) return;
      const channel = control === colorPickerHue ? "h" : control === colorPickerSaturation ? "c" : "l";
      pickerColor = { ...pickerColor, [channel]: Number(control.value) / (channel === "l" ? 100 : 1) };
      updateColorFromPicker();
    });
  }
  colorPickerSv.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    svDrag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      fraction: Number.parseFloat(colorPickerSvThumb.style.left) / 100,
      lightness: pickerColor.l,
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
  colorPickerSv.addEventListener("keydown", event => {
    if (!activeColorInput || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.0025 : 0.01;
    const fraction = Number.parseFloat(colorPickerSvThumb.style.left) / 100;
    const row = colors.toGamut({ ...pickerColor, c: 0.4, l: Math.max(0, Math.min(1, pickerColor.l + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0))) });
    pickerColor = { ...row, c: Math.max(0, Math.min(1, fraction + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0))) * row.c };
    updateColorFromPicker();
  });
  document.getElementById("close-color-picker").addEventListener("click", hideColorPicker);
  window.addEventListener("resize", () => {
    if (!colorPicker.hidden) renderColorPicker();
  });
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

  bounceCurveEditor = globalThis.LichessBezierEditor.mount(
    document.querySelector('[data-bezier-editor="pieceBounceCurve"]'),
    currentSettings.pieceBounceCurve,
    saveBounceCurve,
    previewDuration,
    [1, 3, 7],
    previewPieceUrl
  );
  for (const tab of curveTabs) tab.addEventListener("click", () => setCurveTab(tab.dataset.curveTab));

  for (const control of controls) {
    if (control.type === "range") {
      control.addEventListener("input", () => {
        updateOutput(control);
        syncDuplicateControls(control);
        currentSettings[control.dataset.setting] = Number(control.value);
        clearTimeout(rangeTimers.get(control));
        rangeTimers.set(control, setTimeout(() => saveControl(control), 140));
      });
      control.addEventListener("change", () => {
        clearTimeout(rangeTimers.get(control));
        saveControl(control);
        const curveForDuration = {
          pieceBounceDuration: "pieceBounceCurve",
          pieceBounceWiggleDuration: "pieceBounceWiggleCurve",
          moveAnimationDuration: "moveAnimationCurve"
        }[control.dataset.setting];
        if (!curveForDuration) {
          if (control.dataset.setting === "moveAnimationDistanceFactor") bounceCurveEditor?.preview();
          return;
        }
        setCurveTab(curveForDuration);
        bounceCurveEditor?.preview();
      });
    } else if (control.type === "color") {
      control.addEventListener("input", () => saveControl(control));
      } else {
        control.addEventListener("change", () => {
          saveControl(control);
          if (["threatAttackDisplayMode", "threatDefenseDisplayMode"].includes(control.dataset.setting)) updateThreatDisplayControls();
          updateDependentControls();
          if (control.dataset.setting === "pieceSet") bounceCurveEditor?.updatePreviewPieces();
          if (["moveAnimationLichessSpeed", "moveAnimationTimeDistance"].includes(control.dataset.setting)) bounceCurveEditor?.preview();
        });
      }
  }

  document.getElementById("reset-settings").addEventListener("click", () => {
    hideColorPicker();
    chrome.storage.local.set(globalThis.LichessSettings.defaults, () => {
      currentSoundSettings = {};
      showSettings(globalThis.LichessSettings.defaults);
      renderSoundSettings();
      saveStatus.textContent = "Standardwerte geladen";
    });
  });

  function getSettingsExportContents() {
    return JSON.stringify({
      format: "lichess-figurensets-settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: globalThis.LichessSettings.normalize(currentSettings)
    }, null, 2);
  }

  document.getElementById("export-settings").addEventListener("click", () => {
    const contents = getSettingsExportContents();
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

  document.getElementById("copy-settings").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getSettingsExportContents());
      saveStatus.textContent = "Einstellungen kopiert";
    } catch {
      saveStatus.textContent = "Kopieren fehlgeschlagen";
    }
  });

  const uiState = loadUiState();
  if (tabs.some(tab => tab.dataset.tab === uiState.tab)) setTab(uiState.tab);
  for (const details of detailsSections) {
    const key = details.querySelector("summary")?.textContent.trim();
    if (!key) continue;
    details.open = Boolean(uiState.details?.[key]);
    details.addEventListener("toggle", () => {
      saveUiState({ details: { ...loadUiState().details, [key]: details.open } });
    });
  }

  const settingKeys = [...new Set([...Object.keys(globalThis.LichessSettings.defaults), soundFilesKey])];
  chrome.storage.local.get(settingKeys, values => {
    showSettings(values);
    currentSoundSettings = values[soundSettingsKey] && typeof values[soundSettingsKey] === "object" ? values[soundSettingsKey] : {};
    customSoundNames = Array.isArray(values[soundFilesKey]) ? values[soundFilesKey] : [];
    renderSoundSettings();
    if (customSoundNames.length) soundFolderStatus.textContent = `${customSoundNames.length} eigene Sounddateien verfuegbar.`;
    showPageStatus();
  });
})();
