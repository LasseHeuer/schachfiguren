(() => {
  const descriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "fillStyle");
  if (!descriptor?.set || !descriptor.get) return;

  const graphCanvas = canvas => canvas.id === "acpl-chart" || canvas.id === "movetimes-chart"
    || canvas.matches?.("canvas.study__server-eval");
  const enabled = () => !document.documentElement?.hasAttribute("data-lfs-graph-colors-disabled");
  let cachedRootColors = null;
  let cachedCurveColor = null;
  const rootColors = () => {
    const disabled = document.documentElement?.hasAttribute("data-lfs-graph-colors-disabled");
    if (cachedRootColors && cachedRootColors.disabled === disabled) return cachedRootColors;
    const rootStyle = getComputedStyle(document.documentElement);
    cachedRootColors = {
      disabled,
      white: rootStyle.getPropertyValue("--lfs-white-piece-color").trim() || "oklch(0.5997409301 0.1721887956 40.1845294695)",
      black: rootStyle.getPropertyValue("--lfs-black-piece-color").trim() || "oklch(0.6742384272 0.1206555753 228.5101815779)"
    };
    return cachedRootColors;
  };
  const curveColor = () => {
    const theme = document.body?.dataset.theme ?? "";
    if (cachedCurveColor?.theme === theme) return cachedCurveColor.value;
    const isLight = theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
      : theme ? theme.includes("light") : window.matchMedia("(prefers-color-scheme: light)").matches;
    cachedCurveColor = { theme, value: isLight ? "oklch(0 0 0)" : "oklch(1 0 0)" };
    return cachedCurveColor.value;
  };
  new MutationObserver(() => {
    cachedRootColors = null;
    cachedCurveColor = null;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-lfs-graph-colors-disabled"] });
  const prototype = CanvasRenderingContext2D.prototype;
  const strokeDescriptor = Object.getOwnPropertyDescriptor(prototype, "strokeStyle");

  const playerColor = (color, moveTimes = false) => {
    if (typeof color !== "string") return null;
    color = color.toLowerCase().trim();
    const aliases = { white: "rgb(255 255 255)", black: "rgb(0 0 0)", "#fff": "rgb(255 255 255)", "#ffffff": "rgb(255 255 255)", "#000": "rgb(0 0 0)", "#000000": "rgb(0 0 0)" };
    if (moveTimes && color === "#838383") color = "white";
    if (moveTimes && ["#616161", "#3d3d3d"].includes(color)) color = "black";
    color = aliases[color] || color;

    const match = color.match(/^rgba?\((.*)\)$/i);
    if (!match) return null;

    const [red, green, blue, alpha = "1"] = match[1]
      .replace(/[,/]/g, " ")
      .trim()
      .split(/\s+/);
    const isWhite = Number(red) === 255 && Number(green) === 255 && Number(blue) === 255;
    const isBlack = Number(red) === 0 && Number(green) === 0 && Number(blue) === 0;
    const whiteClockFill = moveTimes && Number(red) === 153 && Number(green) === 153 && Number(blue) === 153;
    if (!isWhite && !isBlack && !whiteClockFill) return null;

    const colors = rootColors();
    const selected = isWhite || whiteClockFill ? colors.white : colors.black;
    if (alpha === "1") return selected;
    const opacity = alpha.endsWith("%") ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
    const oklchMatch = /^oklch\((.*)\)$/i.exec(selected);
    return oklchMatch && Number.isFinite(opacity)
      ? `oklch(${oklchMatch[1]} / ${Math.max(0, Math.min(1, opacity))})`
      : selected;
  };

  Object.defineProperty(CanvasRenderingContext2D.prototype, "fillStyle", {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      const color = enabled() && this.canvas && graphCanvas(this.canvas)
        ? playerColor(value, this.canvas.id === "movetimes-chart") : null;
      descriptor.set.call(this, color || value);
    }
  });

  if (!strokeDescriptor?.set || !strokeDescriptor.get) return;
  Object.defineProperty(prototype, "strokeStyle", {
    ...strokeDescriptor,
    set(value) {
      const moveTimes = enabled() && this.canvas?.id === "movetimes-chart";
      const isCurveLine = typeof value === "string" && value.toLowerCase() === "#3893e8";
      const color = moveTimes && isCurveLine
        ? curveColor()
        : moveTimes ? playerColor(value, true) : null;
      strokeDescriptor.set.call(this, color || value);
    }
  });
})();
