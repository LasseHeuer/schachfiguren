const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");

const root = __dirname;
const chromePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].find(path => path && existsSync(path));

test("right-click move preview stays visual and restores the live board", {
  skip: !chromePath
}, async t => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/extension.css"><style>
    * { box-sizing: border-box; }
    html, body { width: 512px; height: 512px; margin: 0; overflow: hidden; }
    .main-board, .is2d, .cg-wrap { position: relative; width: 512px; height: 512px; }
    cg-board { position: absolute; inset: 0; display: block; width: 512px; height: 512px; overflow: hidden; }
    piece, square { position: absolute; display: block; width: 12.5%; height: 12.5%; }
    piece { z-index: 2; }
  </style>
  <script id="page-init-data" type="application/json">{"cfg":{"data":{"game":{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","variant":{"key":"standard"}}}}}</script>
  <script>window.chrome = { runtime: { getURL: path => location.origin + "/" + path } };</script>
  <script src="/colors.js"></script><script src="/settings.js"></script>
  <script src="/board-overlay.js"></script><script src="/move-preview-board.js"></script><script src="/move-preview.js"></script>
  <script src="/highlight-line-preview.js"></script><script src="/threat-coding.js"></script><script src="/king-movement-fields.js"></script>
  <script src="/selected-piece-wedge.js"></script><script src="/last-move-line.js"></script>
  </head><body data-board><div class="main-board analyse__board"><div class="is2d"><div class="cg-wrap orientation-white">
  <cg-board class="turn-white"></cg-board></div></div></div>
  <script>
    const board = document.querySelector("cg-board");
    const files = "abcdefgh";
    const names = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
    window.setBoardFen = (fen, showTurn = true) => {
      board.replaceChildren();
      const [placement, turn] = fen.split(/\\s+/);
      board.className = showTurn ? "turn-" + (turn === "w" ? "white" : "black") : "";
      for (const [row, rank] of placement.split("/").entries()) {
        let col = 0;
        for (const token of rank) {
          if (/^[1-8]$/.test(token)) { col += Number(token); continue; }
        const piece = document.createElement("piece");
        piece.className = (token === token.toUpperCase() ? "white" : "black") + " " + names[token.toLowerCase()];
        piece.dataset.key = files[col] + (8 - row);
        piece.style.left = (col * 12.5) + "%";
        piece.style.top = (row * 12.5) + "%";
        board.append(piece);
        col++;
        }
      }
      let pageData = document.getElementById("page-init-data");
      if (!pageData) {
        pageData = document.createElement("script");
        pageData.id = "page-init-data";
        pageData.type = "application/json";
        document.head.append(pageData);
      }
      pageData.textContent = JSON.stringify({ cfg: { data: { game: { fen, variant: { key: "standard" } } } } });
    };
    window.setBoardFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    window.previewSettings = LichessSettings.normalize({
      ...LichessSettings.defaults,
      enabled: true,
      userArrowMode: "rightClickPreview",
      whitePieceColor: "#e03030",
      blackPieceColor: "#3030e0",
      threatColoringEnabled: true,
      kingMovementFieldsEnabled: true,
      markLastMove: true,
      highlightCascadesEnabled: true,
      defenseHighlightEnabled: true,
      attackHighlightEnabled: true,
      defensePreviewThresholdMs: 0,
      highlightCascadeLinesEnabled: true
    });
    LichessMovePreview.update(previewSettings);
    LichessThreatCoding.update(previewSettings);
    LichessKingMovementFields.update(previewSettings);
    LichessSelectedPieceWedge.update(previewSettings);
    LichessLastMoveLine.update(previewSettings);
    window.bubbledRightPresses = 0;
    document.addEventListener("pointerdown", event => {
      if (event.button === 2) window.bubbledRightPresses++;
    });
  </script></body></html>`;
  const observerHtml = html
    .replace('  <script src="/highlight-line-preview.js"></script><script src="/threat-coding.js"></script><script src="/king-movement-fields.js"></script>\n  <script src="/selected-piece-wedge.js"></script><script src="/last-move-line.js"></script>', "")
    .replace("    LichessThreatCoding.update(previewSettings);\n    LichessKingMovementFields.update(previewSettings);\n    LichessSelectedPieceWedge.update(previewSettings);\n    LichessLastMoveLine.update(previewSettings);\n", "");

  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/" || path === "/observer") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(path === "/observer" ? observerHtml : html);
      return;
    }
    const file = path.slice(1);
    if (path.endsWith(".svg")) {
      response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 10 10 L 90 90"/></svg>');
      return;
    }
    if (["extension.css", "colors.js", "settings.js", "board-overlay.js", "move-preview-board.js", "move-preview.js", "highlight-line-preview.js", "threat-coding.js", "king-movement-fields.js", "selected-piece-wedge.js", "last-move-line.js"].includes(file)) {
      response.setHeader("Content-Type", file.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
      response.end(readFileSync(join(root, file)));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
  const profile = mkdtempSync(join(tmpdir(), "lfs-move-preview-"));
  const debugPort = await new Promise((resolve, reject) => {
    const probe = require("node:net").createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
  let browser;
  let socket;
  try {
    browser = spawn(chromePath, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--no-sandbox",
      "--remote-allow-origins=*", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
      "--window-size=512,512", `http://127.0.0.1:${server.address().port}/`
    ], { stdio: "ignore" });
    let page;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (browser.exitCode !== null) throw new Error(`Chromium exited with ${browser.exitCode}`);
      try {
        page = (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json())).find(target => target.type === "page");
        if (page) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(page, "Chromium DevTools did not start");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    const runtimeErrors = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        runtimeErrors.push(details.exception?.description ?? details.text);
      }
      if (!message.id) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const mouse = (type, x, y, button = "right", buttons = button === "right" ? 2 : 1) =>
      send("Input.dispatchMouseEvent", { type, x, y, button, buttons });
    const drag = async (from, to, black = false) => {
      const logical = key => ({ col: key.charCodeAt(0) - 97, row: 8 - Number(key[1]) });
      const screen = key => {
        const point = logical(key);
        if (black) { point.col = 7 - point.col; point.row = 7 - point.row; }
        return { x: (point.col + 0.5) * 64, y: (point.row + 0.5) * 64 };
      };
      const start = screen(from), end = screen(to);
      await mouse("mousePressed", start.x, start.y, "right", 2);
      await mouse("mouseMoved", end.x, end.y, "right", 2);
      await mouse("mouseReleased", end.x, end.y, "right", 0);
      await settle();
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate("Boolean(window.LichessMovePreview && window.LichessThreatCoding && window.LichessKingMovementFields && window.LichessSelectedPieceWedge && window.LichessLastMoveLine)")) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(await evaluate("Boolean(window.LichessMovePreview)"), true);

    await t.test("drag sequence, highlights, wheel and restore preserve the original board", async () => {
      await evaluate("(() => { const piece = document.querySelector('.main-board cg-board > piece.white.pawn[data-key=e2]'); piece.removeAttribute('data-key'); piece.style.left = '0%'; piece.style.top = '0%'; piece.style.transform = 'translate(400%, 600%)'; })()");
      await drag("e2", "e5");
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
      assert.equal(await evaluate("document.getElementById('lfs-move-preview-drag')"), null);

      await mouse("mousePressed", 288, 416, "right", 2);
      await mouse("mouseMoved", 288, 288, "right", 2);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > piece')?.style.left"), "56.25%");
      assert.match(await evaluate("document.querySelector('#lfs-move-preview-drag > svg.lfs-move-preview-drag-paths path')?.getAttribute('d')"), /L 56\.25 56\.25$/);
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > svg.lfs-move-preview-drag-paths path').getAttribute('stroke-linecap')"), "butt");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > square.valid-drop-target')"), null);
      assert.equal(await evaluate("document.querySelectorAll('#lfs-move-preview > square.last-move').length"), 2);
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview svg[data-lfs-board-overlay=between-pieces]') !== null"), true);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.lfs-move-preview-candidate-piece')).opacity"), "0");
      assert.equal(await evaluate("document.querySelectorAll('#lfs-move-preview .lfs-move-preview-paths path').length"), 0);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview svg.lfs-last-move-outline')).opacity"), "0");
      await mouse("mouseReleased", 288, 288, "right", 0);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.pawn')?.dataset.key"), "e4");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.white.pawn[data-key=e4]')).opacity"), "1");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview').hasAttribute('data-lfs-threat-board')"), true);
      assert.ok(await evaluate("document.querySelectorAll('#lfs-move-preview [data-lfs-king-movement-fields]').length > 0"));
      assert.equal(await evaluate("[...document.querySelectorAll('.main-board cg-board > piece.white.pawn')].some(piece => piece.style.transform.includes('400%'))"), true);

      await drag("e7", "e5");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.black.pawn[data-key=e5]') !== null"), true);
      assert.equal(await evaluate("document.querySelectorAll('#lfs-move-preview .lfs-move-preview-paths path').length"), 2);
      assert.deepEqual(await evaluate("({ colors: [...document.querySelectorAll('#lfs-move-preview .lfs-move-preview-paths path')].map(path => path.getAttribute('stroke')), expected: [previewSettings.whitePieceColor, previewSettings.blackPieceColor] })"), {
        colors: await evaluate("[...document.querySelectorAll('#lfs-move-preview .lfs-move-preview-paths path')].map(path => path.getAttribute('stroke'))"),
        expected: await evaluate("[previewSettings.whitePieceColor, previewSettings.blackPieceColor]")
      });
      assert.equal(await evaluate("document.querySelector('.main-board cg-board > piece.black.pawn[data-key=e7]') !== null"), true);
      await evaluate("Object.assign(previewSettings, { userArrowDashed: true, userArrowWidthPercent: 6, userArrowOpacity: 60, userArrowDashLengthPercent: 10, userArrowDashGapPercent: 5 }); LichessMovePreview.update(previewSettings)");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview .lfs-move-preview-paths path').getAttribute('stroke-width')"), "0.75");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview .lfs-move-preview-paths path').getAttribute('stroke-dasharray')"), "1.25 0.625");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview .lfs-move-preview-paths path').getAttribute('stroke-opacity')"), "0.6");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview .lfs-move-preview-paths path').getAttribute('stroke-linecap')"), "butt");
      assert.equal(await evaluate("[...document.querySelectorAll('#lfs-move-preview .lfs-move-preview-paths path')].every(path => !path.hasAttribute('marker-end'))"), true);

      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 288, y: 288, deltaX: 0, deltaY: -120 });
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.black.pawn[data-key=e7]') !== null"), true);
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 288, y: 288, deltaX: 0, deltaY: 120 });
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.black.pawn[data-key=e5]') !== null"), true);

      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
      assert.equal(await evaluate("[...document.querySelectorAll('.main-board cg-board > piece.white.pawn')].some(piece => piece.style.transform.includes('400%'))"), true);
      assert.equal(await evaluate("document.querySelector('.main-board cg-board > piece.black.pawn[data-key=e7]') !== null"), true);
      await evaluate("Object.assign(previewSettings, { userArrowDashed: false, userArrowWidthPercent: 3, userArrowOpacity: 100, userArrowDashLengthPercent: 5, userArrowDashGapPercent: 3 }); LichessMovePreview.update(previewSettings)");
    });

    await t.test("drag hides only its candidate until a legal drop commits it", async () => {
      await evaluate("setBoardFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')");
      await settle();
      await drag("e2", "e4");
      assert.equal(await evaluate("document.querySelectorAll('#lfs-move-preview .lfs-move-preview-paths path').length"), 1);

      await mouse("mousePressed", 288, 96, "right", 2);
      await mouse("mouseMoved", 288, 224, "right", 2);
      await settle();
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.black.pawn[data-key=e5]')).opacity"), "0");
      assert.equal(await evaluate("document.querySelectorAll('#lfs-move-preview .lfs-move-preview-paths path').length"), 1);
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > piece.black.pawn') !== null"), true);
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > svg.lfs-move-preview-drag-paths path') !== null"), true);
      await mouse("mouseReleased", 288, 224, "right", 0);
      await settle();
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.black.pawn[data-key=e5]')).opacity"), "1");
      assert.equal(await evaluate("document.querySelectorAll('#lfs-move-preview .lfs-move-preview-paths path').length"), 2);
      assert.equal(await evaluate("document.getElementById('lfs-move-preview-drag')"), null);

      await mouse("mousePressed", 288, 288, "right", 2);
      await mouse("mouseMoved", 288, 224, "right", 2);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > square.valid-drop-target')"), null);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.white.pawn[data-key=e4]')).opacity"), "0");
      await mouse("mouseReleased", 288, 224, "right", 0);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.pawn[data-key=e4]') !== null"), true);
      assert.equal(await evaluate("document.querySelectorAll('#lfs-move-preview .lfs-move-preview-paths path').length"), 2);
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
    });

    await t.test("wedge and last-move highlights follow the preview board during drag and hover", async () => {
      await evaluate("setBoardFen('4k3/8/8/8/8/R7/8/R3K3 w - - 0 1')");
      await settle();
      await mouse("mousePressed", 32, 480, "right", 2);
      await mouse("mouseMoved", 32, 416, "right", 2);
      await settle();
      await evaluate("new Promise(resolve => setTimeout(resolve, 80))");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.rook[data-key=a2]') !== null"), true);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.white.rook[data-key=a2]')).opacity"), "0");
      assert.ok(await evaluate("document.querySelectorAll('#lfs-move-preview piece[data-lfs-defense-highlight]').length > 0"));
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview svg[data-lfs-board-overlay=between-pieces]') !== null"), true);

      await mouse("mouseReleased", 32, 416, "right", 0);
      await settle();
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.white.rook[data-key=a2]')).opacity"), "1");
      await mouse("mouseMoved", 96, 416, "left", 0);
      await mouse("mouseMoved", 34, 416, "left", 0);
      await settle();
      await evaluate("new Promise(resolve => setTimeout(resolve, 80))");
      assert.ok(await evaluate("document.querySelectorAll('#lfs-move-preview piece[data-lfs-defense-highlight]').length > 0"));
      await mouse("mousePressed", 32, 480, "left", 1);
      await mouse("mouseReleased", 32, 480, "left", 0);
      await settle();
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
    });

    await t.test("page FEN supplies the black turn when the board has no turn class", async () => {
      await evaluate("setBoardFen('4k3/8/8/8/8/4p3/8/4K3 b - - 0 1', false)");
      await settle();
      await drag("e3", "e2");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.black.pawn[data-key=e2]') !== null"), true);
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
    });

    await t.test("promotion offers and applies underpromotion", async () => {
      await evaluate("setBoardFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1')");
      await settle();
      await drag("a7", "a8");
      assert.deepEqual(await evaluate("[...document.querySelectorAll('#lfs-move-promotion-choice button')].map(button => button.dataset.promotion)"), ["Q", "R", "B", "N"]);
      await mouse("mousePressed", 160, 25, "left", 1);
      await mouse("mouseReleased", 160, 25, "left", 0);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.knight[data-key=a8]') !== null"), true);
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
    });

    await t.test("complete FEN rights allow castling without turn classes", async () => {
      await evaluate("setBoardFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', false)");
      await settle();
      await drag("e1", "e3");
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
      await evaluate("document.getElementById('page-init-data').remove()");
      await drag("e1", "g1");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.king[data-key=g1]') !== null"), true);
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.rook[data-key=f1]') !== null"), true);
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
    });

    await t.test("last-move geometry recovers en passant without a full FEN", async () => {
      await evaluate(`(() => {
        setBoardFen('4k3/8/8/3pP3/8/8/8/4K3 w - - 0 2', false);
        const board = document.querySelector('cg-board');
        for (const transform of ['translate(300%, 100%)', 'translate(300%, 300%)']) {
          const square = document.createElement('square');
          square.className = 'last-move';
          square.style.transform = transform;
          board.append(square);
        }
        document.getElementById('page-init-data').remove();
      })()`);
      await drag("e5", "d6");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.pawn[data-key=d6]') !== null"), true);
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.black.pawn[data-key=d5]')"), null);
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
    });

    await t.test("same-piece turns share a configurable rounded path", async () => {
      await evaluate("setBoardFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1')");
      await settle();
      await drag("a1", "a2");
      await drag("e8", "e7");
      await drag("a2", "d2");
      const whitePath = "document.querySelector('#lfs-move-preview path[data-piece-color=w]')";
      assert.match(await evaluate(`${whitePath}.getAttribute('d')`), / Q /);
      await evaluate("previewSettings.userArrowCornerRadiusPercent = 0; LichessMovePreview.update(previewSettings)");
      assert.doesNotMatch(await evaluate(`${whitePath}.getAttribute('d')`), / Q /);
      await evaluate("previewSettings.userArrowCornerRadiusPercent = 100; LichessMovePreview.update(previewSettings)");
      assert.match(await evaluate(`${whitePath}.getAttribute('d')`), / Q /);
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
      await evaluate("previewSettings.userArrowCornerRadiusPercent = 25; LichessMovePreview.update(previewSettings)");
    });

    await t.test("board changes and setting changes discard stale previews", async () => {
      await evaluate("setBoardFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')");
      await settle();
      await drag("e2", "e4");
      assert.equal(await evaluate("Boolean(document.getElementById('lfs-move-preview'))"), true);
      await evaluate("setBoardFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')");
      await settle();
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
      assert.equal(await evaluate("document.querySelector('.main-board cg-board > piece.white.pawn[data-key=e4]') !== null"), true);

      await evaluate("setBoardFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')");
      await settle();
      await drag("e2", "e4");
      await evaluate("previewSettings.userArrowMode = 'normal'; LichessMovePreview.update(previewSettings)");
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
      await evaluate("previewSettings.userArrowMode = 'rightClickPreview'; LichessMovePreview.update(previewSettings)");
    });

    await t.test("animated piece style writes skip snapshots but real position changes still restore", async () => {
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/observer` });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate("Boolean(window.LichessMovePreview)")) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await evaluate("setBoardFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')");
      await settle();
      await drag("e2", "e4");
      const animationReads = await evaluate(`(async () => {
        const board = document.querySelector('.main-board cg-board');
        const originalRect = board.getBoundingClientRect.bind(board);
        const pawn = board.querySelector('piece.white.pawn[data-key=e2]');
        board.getBoundingClientRect = () => { window.previewBoardRectReads++; return originalRect(); };
        const results = {};
        for (const motionClass of ['anim', 'dragging']) {
          window.previewBoardRectReads = 0;
          pawn.classList.add(motionClass);
          for (let frame = 0; frame < 5; frame++) {
            pawn.style.transform = 'translate(' + frame * 10 + '%, 600%)';
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          results[motionClass] = { during: window.previewBoardRectReads };
          pawn.classList.remove(motionClass);
          await new Promise(resolve => requestAnimationFrame(resolve));
          results[motionClass].settled = window.previewBoardRectReads;
        }
        return results;
      })()`);
      for (const motionClass of ["anim", "dragging"]) {
        assert.equal(animationReads[motionClass].during, 0);
        assert.ok(animationReads[motionClass].settled > 0);
      }
      assert.equal(await evaluate("Boolean(document.getElementById('lfs-move-preview'))"), true);

      await evaluate("window.previewBoardRectReads = 0; setBoardFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')");
      await settle();
      assert.ok(await evaluate("window.previewBoardRectReads > 0"));
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
    });

    await t.test("losing window focus does not reset a completed preview", async () => {
      await evaluate("setBoardFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')");
      await settle();
      await drag("e2", "e4");
      await evaluate("window.dispatchEvent(new Event('blur'))");
      assert.equal(await evaluate("Boolean(document.getElementById('lfs-move-preview'))"), true);
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
    });

    await t.test("black orientation works and normal arrow mode receives right-click input", async () => {
      await evaluate("setBoardFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')");
      await settle();
      await evaluate("document.querySelector('.cg-wrap').classList.replace('orientation-white', 'orientation-black')");
      await settle();
      await drag("e2", "e4", true);
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.pawn[data-key=e4]')?.style.left"), "37.5%");
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();

      await evaluate("previewSettings.userArrowMode = 'normal'; LichessMovePreview.update(previewSettings)");
      await drag("e2", "e4", true);
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
      assert.equal(await evaluate("window.bubbledRightPresses > 0"), true);
    });

    assert.deepEqual(runtimeErrors, []);
  } finally {
    socket?.close();
    if (browser && browser.exitCode === null) {
      await new Promise(resolve => {
        browser.once("exit", resolve);
        browser.kill();
      });
    }
    await new Promise(resolve => server.close(resolve));
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
