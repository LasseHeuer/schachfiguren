(() => {
  const defaults = Object.freeze({
    enabled: true,
    pieceSet: "system_pixel",
    boardLightLight: "#e9e8e8",
    boardDarkLight: "#d6ddd3",
    monochromeBoard: false,
    squareOutline: false,
    lastMoveLight: "#dae0d7",
    selectedLight: "#ffffff",
    checkSquareLight: "#e57373",
    engineArrowLight: "#15781b",
    hoverMixLight: "#d4d2d2",
    boardLightDark: "#454b3d",
    boardDarkDark: "#433e4c",
    lastMoveDark: "#2d2b2b",
    selectedDark: "#252823",
    checkSquareDark: "#8c3434",
    engineArrowDark: "#80b64c",
    hoverMixDark: "#282727",
    markLastMove: false,
    idleMixPercent: 55,
    hoverMixPercent: 80,
    hoverDesaturation: 60,
    moveDotSize: 10,
    squareMoveDots: false,
    whitePieceColor: "#d1521d",
    blackPieceColor: "#2ba4d1",
    analysisGraphColors: true,
    showPlayTimeInHours: true,
    threatColoringEnabled: false,
    threatOwnSeeThrough: 0.75,
    threatOpponentSeeThrough: 0.25,
    threatMoveDepth: 3,
    threatDepthFactor: 0.2,
    threatMaxMixPercent: 50,
    threatGradientPercent: 10,
    pieceBounceEnabled: true,
    pieceBounceTiming: 300,
    pieceBounceDuration: 600,
    removeOutlines: false,
    removeGlows: true,
    removeGradients: true,
    removeShadows: true,
    removeRoundedCorners: true,
    disableAnimations: false
  });

  const ranges = {
    idleMixPercent: [0, 100],
    hoverMixPercent: [0, 100],
    hoverDesaturation: [0, 100],
    moveDotSize: [5, 50],
    threatOwnSeeThrough: [0, 1],
    threatOpponentSeeThrough: [0, 1],
    threatMoveDepth: [1, 5],
    threatDepthFactor: [0, 1],
    threatMaxMixPercent: [0, 100],
    threatGradientPercent: [0, 100],
    pieceBounceTiming: [0, 2000],
    pieceBounceDuration: [200, 1500]
  };
  const colors = Object.keys(defaults).filter(key => /Color|Light|Dark/.test(key) && typeof defaults[key] === "string");

  function normalize(values = {}) {
    const result = { ...defaults, ...values };

    if (!["system_pixel", "system_eckig", "rund", "rund_comic"].includes(result.pieceSet)) {
      result.pieceSet = defaults.pieceSet;
    }
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = Number(result[key]);
      result[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : defaults[key];
    }
    for (const key of ["threatOwnSeeThrough", "threatOpponentSeeThrough", "threatDepthFactor"]) {
      result[key] = Number(result[key].toFixed(2));
    }
    result.threatMoveDepth = Math.round(result.threatMoveDepth);
    result.threatMaxMixPercent = Math.round(result.threatMaxMixPercent);
    result.threatGradientPercent = Math.round(result.threatGradientPercent);
    result.pieceBounceTiming = Math.round(result.pieceBounceTiming / 50) * 50;
    result.pieceBounceDuration = Math.round(result.pieceBounceDuration / 50) * 50;

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
      "pieceBounceEnabled"
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
