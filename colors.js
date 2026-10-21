(() => {
  const number = "[+-]?(?:\\d*\\.)?\\d+(?:e[+-]?\\d+)?";
  const oklchPattern = new RegExp(`^oklch\\(\\s*(${number})(%?)\\s+(${number})(%?)\\s+(${number})(?:deg)?(?:\\s*\\/\\s*(${number})(%?))?\\s*\\)$`, "i");

  function fromRgb(channels, alpha = 1) {
    const [r, g, b] = channels.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    // Ottosson's D65 linear-sRGB -> Oklab transform, followed by polar coordinates.
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lightness = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const blue = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    const neutral = channels[0] === channels[1] && channels[1] === channels[2];
    return {
      l: neutral ? Math.cbrt(r) : lightness,
      c: neutral ? 0 : Math.hypot(a, blue),
      h: neutral ? 0 : (Math.atan2(blue, a) * 180 / Math.PI + 360) % 360,
      alpha
    };
  }

  function parse(value) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(text);
    if (hex) {
      const expanded = hex[1].length <= 4 ? [...hex[1]].map(char => char + char).join("") : hex[1];
      const channels = expanded.match(/../g).map(channel => parseInt(channel, 16));
      return fromRgb(channels.slice(0, 3), channels.length === 4 ? channels[3] / 255 : 1);
    }
    const match = oklchPattern.exec(text);
    if (!match) return null;
    const color = {
      l: Number(match[1]) / (match[2] ? 100 : 1),
      c: Number(match[3]) * (match[4] ? 0.004 : 1),
      h: ((Number(match[5]) % 360) + 360) % 360,
      alpha: match[6] === undefined ? 1 : Number(match[6]) / (match[7] ? 100 : 1)
    };
    if (!Object.values(color).every(Number.isFinite) || color.l < 0 || color.l > 1 || color.c < 0 || color.alpha < 0 || color.alpha > 1) return null;
    return color;
  }

  function format({ l, c, h, alpha = 1 }) {
    const decimal = value => Number(value.toFixed(10));
    return `oklch(${decimal(l)} ${decimal(c)} ${decimal(h)}${alpha === 1 ? "" : ` / ${decimal(alpha)}`})`;
  }

  function toOklch(value) {
    const color = parse(value);
    return color ? format(color) : null;
  }

  function toRgb(value) {
    const color = typeof value === "string" ? parse(value) : value;
    if (!color) return null;
    const a = color.c * Math.cos(color.h * Math.PI / 180);
    const b = color.c * Math.sin(color.h * Math.PI / 180);
    const l = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (color.l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ].map(channel => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055) * 255);
  }

  function toHex(value) {
    const channels = toRgb(value);
    if (!channels) return null;
    return `#${channels.map(channel => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0")).join("")}`;
  }

  function toGamut(color) {
    const inGamut = candidate => toRgb(candidate).every(channel => channel >= -0.0001 && channel <= 255.0001);
    if (inGamut(color)) return color;
    let low = 0;
    let high = color.c;
    for (let i = 0; i < 24; i++) {
      const c = (low + high) / 2;
      if (inGamut({ ...color, c })) low = c;
      else high = c;
    }
    return { ...color, c: low };
  }

  globalThis.LichessColors = { fromRgb, parse, format, toOklch, toRgb, toHex, toGamut };
})();
