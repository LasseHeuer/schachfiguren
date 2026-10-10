(() => {
  const namespace = "http://www.w3.org/2000/svg";
  const defaultCurve = [0.18, 8, 0.68, -108];
  const bounds = { left: 12, top: 12, right: 348, bottom: 208 };
  const minCurveValue = -200;
  const maxCurveValue = 120;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function progressFromCurveValue(value) {
    return value / -90 * 100;
  }

  function curveValueFromProgress(progress) {
    return progress / 100 * -90;
  }

  const minProgress = progressFromCurveValue(maxCurveValue);
  const maxProgress = progressFromCurveValue(minCurveValue);

  function progressRange(curve) {
    const values = [0, 100, progressFromCurveValue(curve[1]), progressFromCurveValue(curve[3])];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max(6, (max - min) * 0.12);
    return { min: min - padding, max: max + padding };
  }

  function normalizeCurve(value) {
    if (!Array.isArray(value) || value.length !== 4 || !value.map(Number).every(Number.isFinite)) {
      return [...defaultCurve];
    }
    const handle1Time = clamp(Number(value[0]), 0, 1);
    return [
      handle1Time,
      clamp(Number(value[1]), minCurveValue, maxCurveValue),
      clamp(Number(value[2]), 0, 1),
      clamp(Number(value[3]), minCurveValue, maxCurveValue)
    ];
  }

  function svgElement(name, attributes = {}, text = "") {
    const element = document.createElementNS(namespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text) element.textContent = text;
    return element;
  }

  function mount(container, initialValue, onChange) {
    if (!container) return { setValue() {} };

    let curve = normalizeCurve(initialValue);
    let resetCurve = normalizeCurve(initialValue);
    let visibleProgress = progressRange(curve);
    let draggedHandle = null;
    let pointerId = null;

    const svg = svgElement("svg", {
      viewBox: "0 0 360 220",
      role: "group",
      "aria-label": "Bézier-Kurve des Animationsfortschritts",
      preserveAspectRatio: "xMidYMid meet"
    });
    svg.append(svgElement("rect", { x: 0, y: 0, width: 360, height: 220, rx: 0, class: "bezier-background" }));

    const outLine = svgElement("line", { class: "bezier-handle-line" });
    const inLine = svgElement("line", { class: "bezier-handle-line" });
    const curvePath = svgElement("path", { class: "bezier-curve" });
    const startPoint = svgElement("circle", { class: "bezier-keyframe", r: 4.5 });
    const endPoint = svgElement("circle", { class: "bezier-keyframe", r: 4.5 });
    const outHandle = svgElement("circle", {
      class: "bezier-handle bezier-handle-out",
      r: 7,
      tabindex: 0,
      role: "slider",
      "aria-label": "Griff am Anfang der Kurve: Zeit und Fortschritt ändern",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-orientation": "horizontal",
      "data-handle": "out"
    });
    const inHandle = svgElement("circle", {
      class: "bezier-handle bezier-handle-in",
      r: 7,
      tabindex: 0,
      role: "slider",
      "aria-label": "Griff am Ende der Kurve: Zeit und Fortschritt ändern",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-orientation": "horizontal",
      "data-handle": "in"
    });
    svg.append(outLine, inLine, curvePath, startPoint, endPoint, outHandle, inHandle);
    container.replaceChildren(svg);

    function toPoint(time, curveValue) {
      const progress = progressFromCurveValue(curveValue);
      return {
        x: bounds.left + time * (bounds.right - bounds.left),
        y: bounds.bottom - ((progress - visibleProgress.min) / (visibleProgress.max - visibleProgress.min)) * (bounds.bottom - bounds.top)
      };
    }

    function fromPointer(event) {
      const matrix = svg.getScreenCTM();
      if (matrix) {
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const local = point.matrixTransform(matrix.inverse());
        return { x: local.x, y: local.y };
      }
      const rect = svg.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / rect.width * 360, y: (event.clientY - rect.top) / rect.height * 220 };
    }

    function render() {
      const start = toPoint(0, 0);
      const first = toPoint(curve[0], curve[1]);
      const second = toPoint(curve[2], curve[3]);
      const end = toPoint(1, -90);
      outLine.setAttribute("x1", start.x);
      outLine.setAttribute("y1", start.y);
      outLine.setAttribute("x2", first.x);
      outLine.setAttribute("y2", first.y);
      inLine.setAttribute("x1", end.x);
      inLine.setAttribute("y1", end.y);
      inLine.setAttribute("x2", second.x);
      inLine.setAttribute("y2", second.y);
      curvePath.setAttribute("d", `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}`);
      startPoint.setAttribute("cx", start.x);
      startPoint.setAttribute("cy", start.y);
      endPoint.setAttribute("cx", end.x);
      endPoint.setAttribute("cy", end.y);
      outHandle.setAttribute("cx", first.x);
      outHandle.setAttribute("cy", first.y);
      inHandle.setAttribute("cx", second.x);
      inHandle.setAttribute("cy", second.y);
      outHandle.setAttribute("aria-valuenow", Math.round(curve[0] * 100));
      inHandle.setAttribute("aria-valuenow", Math.round(curve[2] * 100));
      outHandle.setAttribute("aria-valuetext", `${Math.round(curve[0] * 100)} % Zeit, ${Math.round(progressFromCurveValue(curve[1]))} % Fortschritt`);
      inHandle.setAttribute("aria-valuetext", `${Math.round(curve[2] * 100)} % Zeit, ${Math.round(progressFromCurveValue(curve[3]))} % Fortschritt`);
    }

    function updateFromPointer(event) {
      const point = fromPointer(event);
      const time = clamp((point.x - bounds.left) / (bounds.right - bounds.left), 0, 1);
      const progress = clamp(
        visibleProgress.max - ((point.y - bounds.top) / (bounds.bottom - bounds.top)) * (visibleProgress.max - visibleProgress.min),
        minProgress,
        maxProgress
      );
      const curveValue = curveValueFromProgress(progress);
      if (draggedHandle === "out") {
        curve = [time, curveValue, curve[2], curve[3]];
      } else {
        curve = [curve[0], curve[1], time, curveValue];
      }
      render();
    }

    function commit() {
      visibleProgress = progressRange(curve);
      render();
      onChange?.([...curve]);
    }

    svg.addEventListener("pointerdown", event => {
      const handle = event.target.closest?.("[data-handle]");
      if (!handle || event.button !== 0) return;
      event.preventDefault();
      draggedHandle = handle.dataset.handle;
      pointerId = event.pointerId;
      svg.setPointerCapture(pointerId);
      updateFromPointer(event);
    });
    svg.addEventListener("pointermove", event => {
      if (draggedHandle && event.pointerId === pointerId) updateFromPointer(event);
    });
    svg.addEventListener("pointerup", event => {
      if (!draggedHandle || event.pointerId !== pointerId) return;
      updateFromPointer(event);
      draggedHandle = null;
      pointerId = null;
      commit();
    });
    svg.addEventListener("pointercancel", event => {
      if (!draggedHandle || event.pointerId !== pointerId) return;
      draggedHandle = null;
      pointerId = null;
      commit();
    });
    for (const handle of [outHandle, inHandle]) {
      handle.addEventListener("keydown", event => {
        if (!event.key.startsWith("Arrow")) return;
        event.preventDefault();
        const index = handle.dataset.handle === "out" ? 0 : 2;
        const step = event.shiftKey ? 5 : 1;
        let [time1, curveValue1, time2, curveValue2] = curve;
        let progress1 = progressFromCurveValue(curveValue1);
        let progress2 = progressFromCurveValue(curveValue2);
        if (event.key === "ArrowLeft") index === 0 ? time1 -= step / 100 : time2 -= step / 100;
        if (event.key === "ArrowRight") index === 0 ? time1 += step / 100 : time2 += step / 100;
        if (event.key === "ArrowUp") index === 0 ? progress1 += step : progress2 += step;
        if (event.key === "ArrowDown") index === 0 ? progress1 -= step : progress2 -= step;
        time1 = clamp(time1, 0, 1);
        time2 = clamp(time2, 0, 1);
        progress1 = clamp(progress1, minProgress, maxProgress);
        progress2 = clamp(progress2, minProgress, maxProgress);
        curve = [time1, curveValueFromProgress(progress1), time2, curveValueFromProgress(progress2)];
        commit();
      });
    }

    const reset = container.parentElement?.querySelector("[data-bezier-reset]");
    reset?.addEventListener("click", () => {
      curve = [...resetCurve];
      commit();
    });
    render();
    return {
      setValue(value, newResetCurve = resetCurve) {
        curve = normalizeCurve(value);
        resetCurve = normalizeCurve(newResetCurve);
        visibleProgress = progressRange(curve);
        render();
      }
    };
  }

  globalThis.LichessBezierEditor = { mount, normalizeCurve, defaultCurve: [...defaultCurve] };
})();
