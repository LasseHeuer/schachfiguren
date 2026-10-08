// ==UserScript==
// @name         Lichess Analysegraph-Farben
// @namespace    https://github.com/openstyles/stylus
// @version      1.0.2
// @description  Verwendet im Analysegraphen die eingestellten Spielerfarben ohne Transparenz.
// @match        https://lichess.org/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// ==/UserScript==

(() => {
  const descriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'fillStyle');
  if (!descriptor?.set || !descriptor.get) return;

  const graphCanvas = canvas => canvas.matches('#acpl-chart, canvas.study__server-eval');

  const playerColor = color => {
    if (typeof color !== 'string') return null;

    const match = color.match(/^rgba?\((.*)\)$/i);
    if (!match) return null;

    const [red, green, blue] = match[1]
      .replace(/[,/]/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map(Number);
    const rootStyle = getComputedStyle(document.documentElement);
    if (red === 255 && green === 255 && blue === 255) {
      return rootStyle.getPropertyValue('--white-piece-color').trim() || '#d1521d';
    }
    if (red === 0 && green === 0 && blue === 0) {
      return rootStyle.getPropertyValue('--black-piece-color').trim() || '#2ba4d1';
    }
    return null;
  };

  Object.defineProperty(CanvasRenderingContext2D.prototype, 'fillStyle', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      const color = this.canvas && graphCanvas(this.canvas) ? playerColor(value) : null;
      descriptor.set.call(this, color || value);
    },
  });
})();
