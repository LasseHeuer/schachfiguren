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
    document.documentElement.toggleAttribute("data-lfs-move-outline-mode", previewSettings.moveIndicatorMode === "outline");
    document.documentElement.toggleAttribute("data-lfs-square-move-dots", previewSettings.squareMoveDots);
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
      if (/^\/(system_rund|system_eckig|system_pixel|rund|rund_comic)\/[a-z0-9_]+\.svg$/.test(path) && existsSync(join(root, path.slice(1)))) {
        response.end(readFileSync(join(root, path.slice(1))));
        return;
      }
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
    const mouse = (type, x, y, button = "right", buttons = button === "right" ? 2 : 1, modifiers = 0) =>
      send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers });
    const drag = async (from, to, black = false, alt = false) => {
      const logical = key => ({ col: key.charCodeAt(0) - 97, row: 8 - Number(key[1]) });
      const screen = key => {
        const point = logical(key);
        if (black) { point.col = 7 - point.col; point.row = 7 - point.row; }
        return { x: (point.col + 0.5) * 64, y: (point.row + 0.5) * 64 };
      };
      const button = alt ? "left" : "right";
      const modifiers = alt ? 1 : 0;
      const start = screen(from), end = screen(to);
      await mouse("mousePressed", start.x, start.y, button, alt ? 1 : 2, modifiers);
      await mouse("mouseMoved", end.x, end.y, button, alt ? 1 : 2, modifiers);
      await mouse("mouseReleased", end.x, end.y, button, 0, modifiers);
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

    await t.test("Chromium paints drags above board overlays, including clipped edges and Zen", async t => {
      await send("Emulation.setDeviceMetricsOverride", { width: 640, height: 640, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(() => {
        document.body.style.cssText = 'width:640px;height:640px';
        document.querySelector('.main-board').style.margin = '48px';
        document.documentElement.style.setProperty('--lfs-white-piece-color', '#e03030');
        document.documentElement.style.setProperty('--lfs-black-piece-color', '#3030e0');
      })()`);
      for (const pieceSet of ["system_rund", "system_eckig", "system_pixel", "rund", "rund_comic"]) {
        for (const shape of ["square", "bevel", "round"]) {
          for (const zen of [false, true]) {
            const label = `${pieceSet}/${shape}/${zen ? "zen" : "normal"}`;
            await evaluate(`(() => {
              const root = document.documentElement;
              root.toggleAttribute('data-lfs-rund-comic', ${pieceSet === "rund_comic"});
              root.toggleAttribute('data-lfs-board-bevel', ${shape !== "square"});
              root.toggleAttribute('data-lfs-zen-mode', ${zen});
              root.style.setProperty('--lfs-board-outer-clip', ${JSON.stringify(shape === "round" ? "inset(0 round 28px)" : "polygon(5% 0,95% 0,100% 5%,100% 95%,95% 100%,5% 100%,0 95%,0 5%)")});
              for (const color of ['w', 'b']) for (const role of ['k', 'r']) {
                root.style.setProperty('--lfs-piece-' + color + role, 'url(/${pieceSet}/b' + role + '.svg)');
              }
              document.querySelector('.cg-wrap').toggleAttribute('data-lfs-zen-board', ${zen});
              document.querySelector('.cg-wrap').style.transform = ${JSON.stringify(zen ? "translate(3px, 4px)" : "none")};
              previewSettings.pieceSet = ${JSON.stringify(pieceSet)};
              LichessKingMovementFields.update(previewSettings);
              setBoardFen('7k/8/8/8/8/8/8/R3K3 w - - 0 1');
            })()`);
            await settle();
            const offset = zen ? { x: 51, y: 52 } : { x: 48, y: 48 };
            for (const role of ["king", "rook"]) {
              await mouse("mousePressed", offset.x + (role === "king" ? 288 : 32), offset.y + 480);
              for (const point of [{ x: offset.x + 288, y: offset.y + 416 }, { x: offset.x + 2, y: offset.y + 2 }]) {
                await mouse("mouseMoved", point.x, point.y);
                await settle();
                const result = await evaluate(`(() => {
                  const layer = document.querySelector('#lfs-move-preview-drag');
                  const piece = layer?.querySelector('piece');
                  if (!piece) return { missing: true };
                  // Temporarily enable hit testing on visual-only layers to measure paint order.
                  const nodes = [...document.querySelectorAll('.cg-wrap, .cg-wrap *')].filter(node => !node.matches('#lfs-move-preview-mix'));
                  const saved = nodes.map(node => [node, node.style.getPropertyValue('pointer-events'), node.style.getPropertyPriority('pointer-events')]);
                  for (const node of nodes) node.style.setProperty('pointer-events', 'auto', 'important');
                  const hit = document.elementFromPoint(${point.x}, ${point.y});
                  const outsideHit = document.elementFromPoint(${point.x - 12}, ${point.y});
                  const above = layer.contains(hit);
                  const outside = layer.contains(outsideHit);
                  for (const [node, value, priority] of saved) {
                    if (value) node.style.setProperty('pointer-events', value, priority);
                    else node.style.removeProperty('pointer-events');
                  }
                  const rect = piece.getBoundingClientRect();
                  const group = piece.querySelector('.lfs-king-movement-group');
                   return { above, outside, opacity: getComputedStyle(piece).opacity,
                     center: [rect.x + rect.width / 2, rect.y + rect.height / 2],
                     parentMask: getComputedStyle(piece).maskImage,
                    groupImage: group && getComputedStyle(group, '::before').backgroundImage,
                    groupMask: group && getComputedStyle(group, '::before').maskImage };
                })()`);
                assert.equal(result.above, true, `${label}/${role}: drag must paint above board and threat/king overlays`);
                assert.equal(result.outside, true, `${label}/${role}: drag must not be clipped at the board edge`);
                assert.equal(result.opacity, "1", `${label}/${role}: dragged pieces must remain fully opaque`);
                assert.deepEqual(result.center, [point.x, point.y], `${label}/${role}: pointer and figure stay aligned`);
                if (role === "king") {
                  assert.equal(result.parentMask, "none", `${label}: king sectors must not be masked by the parent`);
                  assert.notEqual(pieceSet === "rund_comic" ? result.groupImage : result.groupMask, "none", `${label}: king retains its actual figure`);
                }
              }
              await mouse("mouseReleased", offset.x + 2, offset.y + 2, "right", 0);
              await evaluate("window.dispatchEvent(new Event('blur')); LichessMovePreview.restore()");
              await settle();
            }
          }
        }
      }
      await t.test("black round king screenshot retains an open center instead of a solid blue disc", async () => {
        await evaluate(`(() => {
          document.documentElement.removeAttribute('data-lfs-rund-comic');
          document.documentElement.removeAttribute('data-lfs-zen-mode');
          document.documentElement.removeAttribute('data-lfs-board-bevel');
          document.querySelector('.cg-wrap').style.transform = 'none';
          document.querySelector('.cg-wrap').removeAttribute('data-lfs-zen-board');
          document.documentElement.style.setProperty('--lfs-piece-bk', 'url(/system_rund/bk.svg)');
          previewSettings.pieceSet = 'system_rund';
          LichessKingMovementFields.update(previewSettings);
          setBoardFen('8/8/8/8/4k3/8/8/4K3 b - - 0 1');
        })()`);
        await settle();
        const captureRing = async y => {
          const shot = await send('Page.captureScreenshot', {
            format: 'png', clip: { x: 304, y, width: 64, height: 64, scale: 1 }
          });
          return evaluate(`(async () => {
            const image = new Image();
            image.src = 'data:image/png;base64,${shot.data}';
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 64;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            return [...context.getImageData(59, 32, 1, 1).data];
          })()`);
        };
        const boardKingRing = await captureRing(304);
        await mouse('mousePressed', 336, 336);
        await mouse('mouseMoved', 336, 272);
        await settle();
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('#lfs-move-preview-drag .lfs-king-movement-group'), '::before').transform`), 'matrix(-1, 0, 0, -1, 0, 0)');
        const screenshot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 304, y: 240, width: 64, height: 64, scale: 1 } });
        const draggedPixels = await evaluate(`(async () => {
          const image = new Image();
          image.src = 'data:image/png;base64,${screenshot.data}';
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 64;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          return { center: [...context.getImageData(32, 32, 1, 1).data], ring: [...context.getImageData(59, 32, 1, 1).data] };
        })()`);
        assert.deepEqual(draggedPixels.ring, boardKingRing.slice(0, 3).map(channel => Math.round(channel * 0.8 + 255 * 0.2)).concat(255),
          'the dragged king and its movement fields must receive the configured white mix');
        assert.notDeepEqual(draggedPixels.center, draggedPixels.ring, 'the center must remain open, not become a solid blue circle');
        await mouse('mouseReleased', 336, 272, 'right', 0);
        await evaluate('LichessMovePreview.restore()');
        await evaluate(`(() => {
          document.documentElement.style.setProperty('--lfs-piece-wk', 'url(/system_rund/bk.svg)');
          previewSettings.pieceSet = 'system_rund';
          LichessKingMovementFields.update(previewSettings);
          const wrap = document.querySelector('.cg-wrap');
          wrap.classList.remove('orientation-black');
          wrap.classList.add('orientation-white');
          setBoardFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
        })()`);
        await settle();
        const boardWhiteRing = await captureRing(496);
        assert.deepEqual(boardWhiteRing, [224, 48, 48, 255], "the board king uses the fully opaque player color");
        await mouse('mousePressed', 336, 528, 'right', 2);
        await mouse('mouseMoved', 336, 464, 'right', 2);
        await settle();
        const draggedWhiteScreenshot = await send('Page.captureScreenshot', {
          format: 'png', clip: { x: 304, y: 432, width: 64, height: 64, scale: 1 }
        });
        const draggedWhiteRing = await evaluate(`(async () => {
          const image = new Image(); image.src = 'data:image/png;base64,${draggedWhiteScreenshot.data}'; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          return [...context.getImageData(59, 32, 1, 1).data];
        })()`);
        assert.deepEqual(draggedWhiteRing, boardWhiteRing.slice(0, 3).map(channel => Math.round(channel * 0.8 + 255 * 0.2)).concat(255),
          "the white king receives the configured board mix while right-dragging");
        await mouse('mouseReleased', 336, 464, 'right', 0);
        await evaluate('LichessMovePreview.restore()');
      });
      await evaluate(`(() => {
        for (const name of ['data-lfs-rund-comic', 'data-lfs-board-bevel', 'data-lfs-zen-mode']) document.documentElement.removeAttribute(name);
        document.querySelector('.cg-wrap').removeAttribute('data-lfs-zen-board');
        document.querySelector('.cg-wrap').style.removeProperty('transform');
        document.querySelector('.main-board').style.removeProperty('margin');
        document.body.style.cssText = '';
        previewSettings.pieceSet = LichessSettings.defaults.pieceSet;
        LichessKingMovementFields.update(previewSettings);
        setBoardFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      })()`);
      await send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
    });

    await t.test("all piece types stay fully opaque during right-click dragging", async () => {
      await evaluate("setBoardFen('7k/8/8/8/8/8/P7/RNBQK2R w - - 0 1')");
      await settle();
      const pieces = [
        { role: "king", from: [288, 480], to: [288, 416] },
        { role: "queen", from: [224, 480], to: [224, 416] },
        { role: "bishop", from: [160, 480], to: [96, 416] },
        { role: "knight", from: [96, 480], to: [160, 352] },
        { role: "rook", from: [480, 480], to: [480, 416] },
        { role: "pawn", from: [32, 416], to: [32, 352] }
      ];
      for (const { role, from, to } of pieces) {
        await mouse("mousePressed", ...from, "right", 2);
        await mouse("mouseMoved", ...to, "right", 2);
        await settle();
        const opacity = await evaluate(`(() => {
          const piece = document.querySelector('#lfs-move-preview-drag > piece.lfs-move-preview-drag-piece');
          return { role: piece?.classList.contains('${role}'), opacity: piece && getComputedStyle(piece).opacity,
            fields: piece?.querySelector('.lfs-king-movement-group') && getComputedStyle(piece.querySelector('.lfs-king-movement-group')).opacity };
        })()`);
        assert.equal(opacity.role, true, `${role} should be the dragged figure`);
        assert.equal(opacity.opacity, "1", `${role} should stay fully opaque`);
        if (role === "king") assert.equal(opacity.fields, "1", "king segments should stay fully opaque");
        await mouse("mouseReleased", ...to, "right", 0);
        await evaluate("LichessMovePreview.restore()");
        await settle();
      }
    });

    await t.test("opponent figures keep their rotation without king fields and 3D remains unchanged", async () => {
      await evaluate(`(() => {
        previewSettings.kingMovementFieldsEnabled = false;
        LichessKingMovementFields.update(previewSettings);
        setBoardFen('4k3/8/8/8/8/8/8/4K3 b - - 0 1');
      })()`);
      await settle();
      await mouse('mousePressed', 288, 32);
      await mouse('mouseMoved', 288, 96);
      await settle();
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('#lfs-move-preview-drag > piece'), '::before').transform`), 'matrix(-1, 0, 0, -1, 0, 0)');
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag .lfs-king-movement-group')"), null);
      await mouse('mouseReleased', 288, 96, 'right', 0);
      await evaluate(`(() => {
        LichessMovePreview.restore();
        document.querySelector('.is2d').className = 'is3d';
        previewSettings.kingMovementFieldsEnabled = true;
        LichessKingMovementFields.update(previewSettings);
        setBoardFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
      })()`);
      await settle();
      await mouse('mousePressed', 288, 480);
      await mouse('mouseMoved', 288, 416);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag, #lfs-move-preview, .lfs-king-movement-group')"), null,
        'the existing 2D-only preview must not replace native 3D figures');
      await mouse('mouseReleased', 288, 416, 'right', 0);
      await evaluate(`document.querySelector('.is3d').className = 'is2d'; setBoardFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')`);
      await settle();
    });

    await t.test("drag sequence, highlights, wheel and restore preserve the original board", async () => {
      await evaluate("(() => { const piece = document.querySelector('.main-board cg-board > piece.white.pawn[data-key=e2]'); piece.removeAttribute('data-key'); piece.style.left = '0%'; piece.style.top = '0%'; piece.style.transform = 'translate(400%, 600%)'; })()");
      await drag("e2", "e5");
      assert.equal(await evaluate("document.getElementById('lfs-move-preview')"), null);
      assert.equal(await evaluate("document.getElementById('lfs-move-preview-drag')"), null);

       await mouse("mousePressed", 288, 416, "left", 1, 1);
       await mouse("mouseMoved", 288, 288, "left", 1, 1);
       await settle();
       assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > piece')?.style.left"), "56.25%");
       assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > square.selected')"), null);
       await mouse("mouseReleased", 288, 288, "left", 0, 1);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.pawn[data-key=e4]')?.dataset.key"), "e4");
      assert.equal(await evaluate("document.querySelector('.main-board cg-board > piece.white.pawn') !== null"), true);
      await evaluate("LichessMovePreview.restore()");
      await settle();

      await mouse("mousePressed", 288, 416, "right", 2);
       await mouse("mouseMoved", 288, 288, "right", 2);
       await settle();
       assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > piece')?.style.left"), "56.25%");
       assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > square.selected')"), null);
       assert.equal(await evaluate("document.querySelectorAll('#lfs-move-preview-drag > square.move-dest').length"), 2);
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > svg[data-lfs-board-overlay] path[fill=none]') !== null"), true);
      assert.deepEqual(await evaluate(`(() => { const mix = document.querySelector('#lfs-move-preview-mix'); const style = getComputedStyle(mix); return { color: style.backgroundColor, opacity: style.opacity }; })()`), {
        color: "oklch(1 0 0)", opacity: "0.2"
      });
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
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.pawn[data-key=e4]')?.dataset.key"), "e4");
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

    await t.test("king movement fields follow a right-click king drag", async () => {
      await evaluate("document.documentElement.style.setProperty('--lfs-piece-wk', 'url(/white-king.svg)')");
      await evaluate("setBoardFen('7k/5r2/8/8/8/8/8/4K3 w - - 0 1')");
      await settle();
      await mouse("mousePressed", 288, 480, "right", 2);
      await settle();
      const initialPath = await evaluate("document.querySelector('#lfs-move-preview > piece.white.king[data-key=e1] .lfs-king-movement-fields path')?.getAttribute('d')");
      assert.ok(initialPath);
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > piece.white.king .lfs-king-movement-fields path')?.getAttribute('d')"), initialPath,
        "the dragged king keeps its sectors while the pointer is on its origin field");
      assert.deepEqual(await evaluate(`(() => {
        const preview = LichessThreatCoding.getInteractionPreview(document.querySelector('#lfs-move-preview'));
        return { source: [preview?.source.row, preview?.source.col], target: [preview?.target.row, preview?.target.col], legal: preview?.legal };
      })()`), { source: [7, 4], target: [7, 4], legal: false });
      await evaluate("window.previewPointerUpdates = 0; document.addEventListener('lfs-move-preview-pointermove', () => window.previewPointerUpdates++)");

      await mouse("mouseMoved", 288, 416, "right", 2);
      await settle();
      const draggedKing = await evaluate("document.querySelector('#lfs-move-preview > piece.white.king[data-key=e2] .lfs-king-movement-fields path')?.getAttribute('d')");
      assert.ok(draggedKing);
      assert.notEqual(draggedKing, initialPath, "king segments should reflect the dragged destination");
      assert.deepEqual(await evaluate(`(() => {
        const preview = LichessThreatCoding.getInteractionPreview(document.querySelector('#lfs-move-preview'));
        return { source: [preview?.source.row, preview?.source.col], target: [preview?.target.row, preview?.target.col], legal: preview?.legal };
      })()`), { source: [7, 4], target: [6, 4], legal: true });
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.white.king[data-key=e2]')).opacity"), "0");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > piece.white.king > span.lfs-king-movement-group > svg.lfs-king-movement-fields path')?.getAttribute('d')"), draggedKing);
      const dragFieldsStyle = await evaluate(`(() => {
        const group = document.querySelector('#lfs-move-preview-drag > piece.white.king > span.lfs-king-movement-group');
        const svg = group.querySelector('svg.lfs-king-movement-fields');
        const source = document.querySelector('.main-board cg-board > piece.white.king[data-key=e1]');
        const sourceGroup = source.querySelector(':scope > span.lfs-king-movement-group');
        const sourceSvg = sourceGroup.querySelector('svg.lfs-king-movement-fields');
        return { zIndex: getComputedStyle(svg).zIndex, mask: getComputedStyle(group, '::before').maskImage,
          shape: getComputedStyle(group, '::before').content, fill: getComputedStyle(svg.querySelector('path')).fill,
          dragOpacity: getComputedStyle(group, '::before').opacity, sourceOpacity: getComputedStyle(sourceGroup, '::before').opacity,
          dragColor: getComputedStyle(group, '::before').backgroundColor, sourceColor: getComputedStyle(sourceGroup, '::before').backgroundColor,
          dragPathOpacity: getComputedStyle(svg.querySelector('path')).opacity,
          sourcePathOpacity: getComputedStyle(sourceSvg.querySelector('path')).opacity };
      })()`);
      assert.equal(dragFieldsStyle.zIndex, "3");
      assert.notEqual(dragFieldsStyle.mask, "none");
      assert.equal(dragFieldsStyle.shape, '""');
      assert.notEqual(dragFieldsStyle.fill, "none");
      assert.equal(dragFieldsStyle.dragOpacity, dragFieldsStyle.sourceOpacity);
      assert.equal(dragFieldsStyle.dragColor, dragFieldsStyle.sourceColor);
      assert.equal(dragFieldsStyle.dragPathOpacity, dragFieldsStyle.sourcePathOpacity);

      await mouse("mouseMoved", 224, 480, "right", 2);
      await settle();
      const updatedKing = await evaluate("document.querySelector('#lfs-move-preview > piece.white.king[data-key=d1] .lfs-king-movement-fields path')?.getAttribute('d')");
      assert.ok(updatedKing);
      assert.notEqual(updatedKing, draggedKing, "king segments should update as the pointer enters another field");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > piece.white.king > span.lfs-king-movement-group > svg.lfs-king-movement-fields path')?.getAttribute('d')"), updatedKing);
      await mouse("mouseMoved", 226, 482, "right", 2);
      await mouse("mouseMoved", 230, 485, "right", 2);
      await settle();
      assert.equal(await evaluate("window.previewPointerUpdates"), 2, "updates are limited to changes between board fields");

      await mouse("mouseMoved", 288, 480, "right", 2);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > piece.white.king .lfs-king-movement-fields path')?.getAttribute('d')"), initialPath,
        "returning to the origin restores the king sectors");
      await mouse("mouseMoved", 290, 482, "right", 2);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview-drag > piece.white.king .lfs-king-movement-fields path')?.getAttribute('d')"), initialPath);
      await mouse("mouseMoved", 224, 480, "right", 2);
      await settle();

      await mouse("mouseReleased", 224, 480, "right", 0);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.king[data-key=d1] .lfs-king-movement-fields path')?.getAttribute('d')"), updatedKing);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.white.king[data-key=d1]')).opacity"), "1");
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
    });

    await t.test("king nodes and visible sectors stay stable over repeated moves and animation frames", async () => {
      await evaluate("setBoardFen('7k/5r2/8/8/8/8/8/4K3 w - - 0 1')");
      await settle();
      await mouse("mousePressed", 288, 480);
      await settle();
      await evaluate(`(() => {
        window.stableKings = [...document.querySelectorAll('#lfs-move-preview > piece.king, #lfs-move-preview-drag > piece.king')]
          .map(piece => ({ piece, group: piece.querySelector('.lfs-king-movement-group'),
            svg: piece.querySelector('.lfs-king-movement-fields'), path: piece.querySelector('.lfs-king-movement-fields path') }));
        const previewCarrier = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        previewCarrier.setAttribute('data-lfs-board-overlay', 'king-preview-stability-test');
        previewCarrier.setAttribute('viewBox', '0 0 8 8');
        previewCarrier.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        window.previewKingGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        previewCarrier.append(previewKingGroup);
        document.querySelector('#lfs-move-preview').append(previewCarrier);
        LichessKingMovementFields.renderPreview(previewKingGroup,
          LichessMovePreview.getDragPreviewState(document.querySelector('#lfs-move-preview')), null);
        const previewSvg = previewKingGroup.querySelector(':scope > svg.lfs-king-preview-fields');
        window.stablePreviewKingFields = { svg: previewSvg, path: previewSvg?.querySelector('path') };
        if (!stablePreviewKingFields.path) throw new Error('right-drag hover preview must render king fields');
        window.kingDetachments = 0;
        window.kingObserver = new MutationObserver(records => {
          for (const record of records) for (const removed of record.removedNodes) {
            const trackedNodeRemoved = stableKings.some(ref =>
              [ref.piece, ref.group, ref.svg, ref.path].some(node => node && (removed === node || removed.contains(node))))
              || [stablePreviewKingFields.svg, stablePreviewKingFields.path]
                .some(node => node && (removed === node || removed.contains(node)));
            if (trackedNodeRemoved) kingDetachments++;
          }
        });
        kingObserver.observe(document.querySelector('.cg-wrap'), { childList: true, subtree: true });
      })()`);
      for (let cycle = 0; cycle < 5; cycle++) {
        for (const [x, y] of [[288, 480], [288, 416], [224, 480], [288, 480]]) {
          for (let move = 0; move < 3; move++) {
            await mouse("mouseMoved", x + move, y + move);
            const result = await evaluate(`(async () => {
              const failures = [];
              for (let frame = 0; frame < 4; frame++) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                for (const ref of stableKings) {
                  if (!ref.piece.isConnected || ref.piece.querySelector('.lfs-king-movement-group') !== ref.group
                    || ref.group.querySelector('svg') !== ref.svg || ref.svg.querySelector('path') !== ref.path) failures.push('identity');
                }
                const previewFields = stablePreviewKingFields;
                LichessKingMovementFields.renderPreview(previewKingGroup,
                  LichessMovePreview.getDragPreviewState(document.querySelector('#lfs-move-preview')), null);
                if (!previewFields.svg.isConnected
                  || previewKingGroup.querySelector(':scope > svg.lfs-king-preview-fields') !== previewFields.svg
                  || previewFields.svg.querySelector('path') !== previewFields.path) failures.push('preview identity');
                const previewStyle = getComputedStyle(previewFields.path);
                if (previewStyle.visibility !== 'visible' || previewStyle.display === 'none' || previewStyle.fill === 'none'
                  || !previewFields.path.getBoundingClientRect().width) failures.push('preview visibility');
                const ref = stableKings.find(ref => ref.piece.closest('#lfs-move-preview-drag'));
                const preview = LichessMovePreview.getDragPreviewState(document.querySelector('#lfs-move-preview'));
                const oracle = document.createElement('piece');
                LichessKingMovementFields.renderDragPreview(oracle, preview.position, preview.target, preview.blackOrientation);
                if (ref.path.getAttribute('d') !== oracle.querySelector('path')?.getAttribute('d')) failures.push('segments');
                const style = getComputedStyle(ref.path);
                if (style.visibility !== 'visible' || style.display === 'none' || style.fill === 'none'
                  || Number(style.opacity) !== 1 || Number(getComputedStyle(ref.piece).opacity) !== 1
                  || !ref.path.getBoundingClientRect().width) failures.push('visibility');
              }
              return { failures, detachments: kingDetachments, kings: stableKings.length };
            })()`);
            assert.deepEqual(result, { failures: [], detachments: 0, kings: 3 }, `cycle ${cycle}, field ${x}/${y}, move ${move}`);
          }
        }
      }
      assert.equal(await evaluate("kingDetachments"), 0, "neither dragged nor interaction-preview king fields detach during updates");
      await evaluate("kingObserver.disconnect()");
      await mouse("mouseReleased", 288, 480, "right", 0);
      await evaluate("previewKingGroup.parentElement?.remove()");
      await evaluate("LichessMovePreview.restore()");
      await settle();
    });

    await t.test("wedge and last-move highlights follow the preview board during drag and hover", async () => {
      await evaluate("setBoardFen('4k3/8/p7/8/8/R7/8/R3K3 w - - 0 1')");
      await settle();
      await mouse("mousePressed", 32, 352, "right", 2);
      await settle();
      await evaluate("new Promise(resolve => setTimeout(resolve, 80))");
      const sourceLines = await evaluate("document.querySelectorAll('svg.lfs-threat-arc path').length");
      assert.ok(sourceLines >= 2, "the origin field should show attack and defense lines");
      assert.ok(await evaluate(`(() => {
        window.dragCascadeLines = [...document.querySelectorAll('#lfs-move-preview svg[data-lfs-board-overlay] g > path[stroke^="url(#lfs-highlight-line-"]')];
        window.detachedDragLines = 0;
        window.checkDragLines = event => {
          if (event.detail?.id === 'lfs-move-preview' && dragCascadeLines.some(path => !path.isConnected)) detachedDragLines++;
        };
        document.addEventListener('lfs-hover-preview-change', checkDragLines);
        return dragCascadeLines.length;
      })()`), "the test must exercise animated cascade lines, not static threat arcs");
      await mouse("mouseMoved", 32, 288, "right", 2);
      await settle();
      await evaluate("new Promise(resolve => setTimeout(resolve, 80))");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.rook[data-key=a4]') !== null"), true);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.white.rook[data-key=a4]')).opacity"), "0");
      assert.ok(await evaluate("document.querySelectorAll('#lfs-move-preview piece[data-lfs-defense-highlight]').length > 0"));
      const firstTargetLines = await evaluate("document.querySelectorAll('svg.lfs-threat-arc path').length");
      assert.ok(firstTargetLines >= 2, "attack and defense lines should persist on the first destination");
      assert.ok(await evaluate("document.querySelectorAll('#lfs-move-preview g > path[stroke^=\"url(#lfs-highlight-line-\"]').length"),
        "a field change must keep attack/defense cascade lines on the board");
      assert.equal(await evaluate("detachedDragLines"), 0, "rebuilding the board must not interrupt active lines before their renderer updates");
      await evaluate("dragCascadeLines = [...document.querySelectorAll('#lfs-move-preview g > path[stroke^=\"url(#lfs-highlight-line-\"]')]");
      assert.deepEqual(await evaluate(`(() => {
        const preview = LichessThreatCoding.getInteractionPreview(document.querySelector('#lfs-move-preview'));
        return { source: [preview?.source.row, preview?.source.col], target: [preview?.target.row, preview?.target.col], legal: preview?.legal };
      })()`), { source: [5, 0], target: [4, 0], legal: true });
      await mouse("mouseMoved", 32, 224, "right", 2);
      await settle();
      await evaluate("new Promise(resolve => setTimeout(resolve, 80))");
      assert.ok(await evaluate("document.querySelectorAll('svg.lfs-threat-arc path').length >= 2"),
        "attack and defense lines should persist when entering another destination");
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.rook[data-key=a5]') !== null"), true);
      assert.ok(await evaluate("document.querySelectorAll('#lfs-move-preview g > path[stroke^=\"url(#lfs-highlight-line-\"]').length"),
        "active cascade lines survive multiple field changes without another pointer move");
      assert.equal(await evaluate("detachedDragLines"), 0, "subsequent field changes also preserve active overlays");
      await evaluate("document.removeEventListener('lfs-hover-preview-change', checkDragLines)");

      await mouse("mouseReleased", 32, 224, "right", 0);
      await settle();
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#lfs-move-preview > piece.white.rook[data-key=a5]')).opacity"), "1");
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

    await t.test("right-click and Alt drags match left-click move-field indicators", async () => {
      const fen = "7k/8/3p4/8/4Q3/8/8/4R2K w - - 0 1";
      const source = { x: 288, y: 288 };
      const capture = async boardExpression => evaluate(`(() => {
        const board = ${boardExpression};
        const interaction = LichessThreatCoding.getInteractionPreview(board);
        const paths = [...board.querySelectorAll(':scope > svg.lfs-threat-arc path')]
          .map(path => path.getAttribute('stroke') + ':' + path.getAttribute('d')).sort();
        return { legalTargets: interaction?.legalTargets?.map(({ row, col }) => ({ row, col })) ?? null, paths };
      })()`);
      let legalTargets;
      const previewPaths = [];

      for (const { button, buttons, modifiers, label } of [
        { button: "right", buttons: 2, modifiers: 0, label: "right-click" },
        { button: "left", buttons: 1, modifiers: 1, label: "Alt" }
      ]) {
        await evaluate(`setBoardFen(${JSON.stringify(fen)})`);
        await settle();
        await mouse("mousePressed", source.x, source.y, button, buttons, modifiers);
        await settle();
        const preview = await capture("document.querySelector('#lfs-move-preview')");
        assert.ok(preview.legalTargets?.some(target => target.row === 3 && target.col === 4),
          `${label}: the e5 move field is included`);
        assert.ok(preview.paths.length >= 2, `${label}: attack and defense lines are rendered`);
        legalTargets ??= preview.legalTargets;
        previewPaths.push({ label, paths: preview.paths });
        await mouse("mouseReleased", source.x, source.y, button, 0, modifiers);
        await evaluate("LichessMovePreview.restore()");
        await settle();
      }

      await evaluate(`(() => {
        setBoardFen(${JSON.stringify(fen)});
        const board = document.querySelector('.cg-wrap > cg-board');
        for (const { row, col } of ${JSON.stringify(legalTargets)}) {
          const square = document.createElement('square');
          square.className = 'move-dest';
          square.style.left = (col * 12.5) + '%';
          square.style.top = (row * 12.5) + '%';
          board.append(square);
        }
      })()`);
      await settle();
      await mouse("mousePressed", source.x, source.y, "left", 1);
      await mouse("mouseMoved", source.x, source.y, "left", 1);
      await settle();
      const leftClick = await capture("document.querySelector('.cg-wrap > cg-board')");
      for (const preview of previewPaths) {
        assert.deepEqual(preview.paths, leftClick.paths, `${preview.label} should match left-click move-field indicators`);
      }
      await mouse("mouseReleased", source.x, source.y, "left", 0);
      await evaluate("LichessMovePreview.restore()");
      await settle();
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
      assert.deepEqual(await evaluate("[...document.querySelectorAll('#lfs-move-promotion-choice button piece')].map(piece => piece.classList[1])"), ["queen", "rook", "bishop", "knight"]);
      await mouse("mousePressed", 32, 224, "left", 1);
      await mouse("mouseReleased", 32, 224, "left", 0);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.knight[data-key=a8]') !== null"), true);
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();

      await evaluate("setBoardFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1')");
      await settle();
      await drag("a7", "a8", false, true);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('#lfs-move-promotion-choice button')].map(button => button.dataset.promotion)"), ["Q", "R", "B", "N"]);
      await mouse("mousePressed", 32, 32, "left", 1);
      await mouse("mouseReleased", 32, 32, "left", 0);
      await settle();
      assert.equal(await evaluate("document.querySelector('#lfs-move-preview > piece.white.queen[data-key=a8]') !== null"), true);
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
