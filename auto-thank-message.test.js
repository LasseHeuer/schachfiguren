const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
require("./colors.js");
require("./settings.js");

const MESSAGE = "Thank you for the game. Well played.";

function loadModule({
  result = "1-0",
  color = "white",
  spectator = false,
  gameId = "abcdefgh",
  inputValue = "",
  inputDisabled = false,
  pluginEnabled = true,
  autoEnabled = true,
  rootDisabled = false,
  botGame = false,
  roundApp = true,
  tabActive = true,
  sessionSent = false,
  mainOk = true,
  removePageDataAfterLoad = false,
  pathname = `/${gameId}`,
} = {}) {
  const session = new Map();
  if (sessionSent) session.set(`lfsAutoThankSent:${gameId}:${result}`, "sent");
  const resultEl = { textContent: result };
  const input = {
    value: inputValue,
    disabled: inputDisabled,
    events: [],
    focus() {},
    dispatchEvent(event) { this.events.push(event); return true; },
  };
  let tabIsActive = tabActive;
  const tab = {
    clicked: false,
    classList: { contains: name => name === "mchat__tab-active" && tabIsActive },
    click() { this.clicked = true; tabIsActive = true; },
  };
  let pageData = {
    textContent: JSON.stringify({
      cfg: { data: { game: { id: gameId }, player: { color, spectator } } },
    }),
  };
  const document = {
    documentElement: { hasAttribute: name => name === "data-lfs-disabled" && rootDisabled },
    querySelector(selector) {
      if (selector === "#page-init-data") return pageData;
      if (selector === ".bot-game") return botGame ? {} : null;
      if (selector === ".round__app") return roundApp ? {} : null;
      if (selector === ".round__app .result-wrap .result") return result ? resultEl : null;
      if (selector === ".round__app input.mchat__say") return input;
      if (selector === ".round__side input.mchat__say") return null;
      if (selector === ".round__app .mchat__tab.discussion") return tab;
      if (selector === ".round__side .mchat__tab.discussion") return null;
      return null;
    },
  };
  const listeners = {};
  const windowStub = {
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    emit(data) {
      for (const fn of listeners.message ?? []) fn({ source: windowStub, origin: "https://lichess.org", data });
    },
    postMessage(data) {
      // Simuliert die Main-World (auto-thank-message-main.js).
      if (data.channel === "lfs-auto-thank-post") {
        if (mainOk) {
          input.value = data.text;
          input.events.push({ type: "keydown", key: "Enter" });
        }
        windowStub.emit({ channel: "lfs-auto-thank-posted", id: data.id, ok: mainOk });
      }
    },
  };
  class Event {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
  }
  class KeyboardEvent extends Event {
    constructor(type, options = {}) { super(type, options); this.key = options.key; }
  }
  const location = { pathname, origin: "https://lichess.org" };
  const context = vm.createContext({
    document,
    window: windowStub,
    location,
    Event,
    KeyboardEvent,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => undefined,
    clearTimeout: () => {},
    sessionStorage: {
      getItem: key => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, String(value)),
    },
  });
  vm.runInContext(readFileSync(join(__dirname, "auto-thank-message.js"), "utf8"), context);
  if (removePageDataAfterLoad) pageData = null;
  const api = context.LichessAutoThankMessage;
  api.update({ enabled: pluginEnabled, autoThankMessageEnabled: autoEnabled });
  return { api, input, tab, session };
}

test("sieg, niederlage und remis posten die nachricht im chat", async () => {
  const win = loadModule({ result: "1-0", color: "white" });
  assert.equal(win.api.MESSAGE, MESSAGE);
  assert.equal(await win.api.check(), true);
  assert.equal(win.input.value, MESSAGE);
  assert.ok(win.input.events.some(event => event.type === "keydown" && event.key === "Enter"));

  const lose = loadModule({ result: "0-1", color: "white" });
  assert.equal(await lose.api.check(), true);
  assert.equal(lose.input.value, MESSAGE);

  const blackWin = loadModule({ result: "0-1", color: "black" });
  assert.equal(await blackWin.api.check(), true);
  assert.equal(blackWin.input.value, MESSAGE);

  const draw = loadModule({ result: "½-½", color: "white" });
  assert.equal(await draw.api.check(), true);
  assert.equal(draw.input.value, MESSAGE);
});

test("laufende partie, zuschauen und botspiel posten nicht", async () => {
  assert.equal(await loadModule({ result: "", color: "white" }).api.check(), false);
  assert.equal(await loadModule({ result: "1-0", color: "white", spectator: true }).api.check(), false);
  assert.equal(await loadModule({ result: "1-0", color: "white", botGame: true }).api.check(), false);
  assert.equal(await loadModule({ result: "1-0", color: "white", roundApp: false }).api.check(), false);
});

test("nachricht wird nur einmal pro partie gepostet und bei fehlschlag nicht als gesendet markiert", async () => {
  const { api } = loadModule({ result: "1-0", color: "white" });
  assert.equal(await api.check(), true);
  assert.equal(await api.check(), false);
  assert.equal(await loadModule({ result: "1-0", color: "white", sessionSent: true }).api.check(), false);
  const failed = loadModule({ result: "1-0", color: "white", mainOk: false });
  assert.equal(await failed.api.check(), false);
  assert.equal(failed.session.has(`lfsAutoThankSent:abcdefgh:1-0`), false);
});

test("eingabe mit entwurf, deaktiviertes eingabefeld und abgeschaltete einstellung posten nicht", async () => {
  const draft = loadModule({ result: "1-0", color: "white", inputValue: "Hallo" });
  assert.equal(await draft.api.check(), false);
  assert.equal(draft.input.value, "Hallo");

  assert.equal(await loadModule({ result: "1-0", color: "white", inputDisabled: true }).api.check(), false);
  assert.equal(await loadModule({ result: "1-0", color: "white", autoEnabled: false }).api.check(), false);
  assert.equal(await loadModule({ result: "1-0", color: "white", pluginEnabled: false }).api.check(), false);
  assert.equal(await loadModule({ result: "1-0", color: "white", rootDisabled: true }).api.check(), false);
});

test("inaktiver chat-tab wird aktiviert und die nachricht gepostet", async () => {
  const { api, input, tab } = loadModule({ result: "1-0", color: "black", tabActive: false });
  assert.equal(await api.check(), true);
  assert.equal(tab.clicked, true);
  assert.equal(input.value, MESSAGE);
});

test("funktioniert auch nachdem lichess page-init-data entfernt hat", async () => {
  const removed = loadModule({ result: "1-0", color: "white", removePageDataAfterLoad: true });
  assert.equal(await removed.api.check(), true);
  assert.equal(removed.input.value, MESSAGE);
});

test("einstellung ist standardmaessig aktiv und in popup, optionen und manifest verdrahtet", () => {
  const settings = globalThis.LichessSettings;
  assert.equal(settings.defaults.autoThankMessageEnabled, true);
  assert.equal(settings.normalize({}).autoThankMessageEnabled, true);
  assert.equal(settings.normalize({ autoThankMessageEnabled: 0 }).autoThankMessageEnabled, false);

  const popup = readFileSync(join(__dirname, "popup.html"), "utf8");
  const options = readFileSync(join(__dirname, "options.html"), "utf8");
  const manifest = readFileSync(join(__dirname, "manifest.json"), "utf8");
  const content = readFileSync(join(__dirname, "content.js"), "utf8");
  assert.match(popup, /data-setting="autoThankMessageEnabled"/);
  assert.match(options, /data-setting="autoThankMessageEnabled"/);
  assert.ok(manifest.indexOf("auto-thank-message.js") > -1);
  assert.ok(manifest.indexOf("auto-thank-message.js") < manifest.indexOf('"content.js"'));
  assert.match(manifest, /"auto-thank-message-main\.js"/);
  assert.match(content, /globalThis\.LichessAutoThankMessage\?\.\update\(settings\)/);
});
