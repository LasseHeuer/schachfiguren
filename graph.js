(() => {
  const descriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "fillStyle");
  if (!descriptor?.set || !descriptor.get) return;

  const graphCanvas = canvas => canvas.matches("#acpl-chart, #movetimes-chart, canvas.study__server-eval");
  const enabled = () => !document.documentElement?.hasAttribute("data-lfs-graph-colors-disabled");
  const curveColor = () => {
    const theme = document.body?.dataset.theme;
    const isLight = theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
      : theme ? theme.includes("light") : window.matchMedia("(prefers-color-scheme: light)").matches;
    return isLight ? "#000000" : "#ffffff";
  };
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

    const rootStyle = getComputedStyle(document.documentElement);
    const selected = isWhite || whiteClockFill
      ? rootStyle.getPropertyValue("--lfs-white-piece-color").trim() || "#d1521d"
      : rootStyle.getPropertyValue("--lfs-black-piece-color").trim() || "#2ba4d1";
    if (alpha === "1") return selected;
    const channels = selected.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
    return channels ? `rgba(${channels.slice(1).map(channel => parseInt(channel, 16)).join(",")},${alpha})` : selected;
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
