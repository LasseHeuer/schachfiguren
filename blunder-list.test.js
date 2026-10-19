const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

function loadList(file, exports, extra = {}) {
  const assigned = [];
  const writes = [];
  const dispatched = [];
  const persisted = {};
  const locks = new Map();
  const context = vm.createContext({
    URLSearchParams, TextDecoder, Date, setTimeout, clearTimeout,
    document: {
      querySelector: () => ({ textContent: "Player", getAttribute: () => null }),
      addEventListener: () => {}, dispatchEvent: event => dispatched.push(event),
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
    location: { pathname: "/", search: "", hash: "", assign: url => assigned.push(url) },
    testPersisted: persisted,
    navigator: { locks: { request: (key, action) => {
      const lock = (locks.get(key) ?? Promise.resolve()).then(action);
      locks.set(key, lock);
      return lock;
    } } },
    chrome: { storage: { local: {
      get: (key, callback) => { callback?.(persisted); return Promise.resolve(persisted); },
      set: (value, callback) => { Object.assign(persisted, value); writes.push(value); callback?.(); return Promise.resolve(); },
    } } },
    ...extra,
  });
  vm.runInContext(readFileSync(join(__dirname, "puzzle-scheduler.js"), "utf8"), context);
  const source = readFileSync(join(__dirname, file), "utf8");
  vm.runInContext(source.replace("  chrome.storage.local.get(storageKey, stored => {", `
    globalThis.testing = { ${exports} };
    return;
    chrome.storage.local.get(storageKey, stored => {`), context);
  return { api: context.testing, assigned, writes, dispatched, context, persisted, settle: () => Promise.all(locks.values()) };
}

const game = {
  id: "abcdefgh", createdAt: 100,
  players: { white: { user: { id: "player", name: "Player" } }, black: { user: { id: "opponent", name: "Opponent" } } },
  analysis: [
    { judgment: { name: "Blunder" }, best: "e2e4", eval: 50 },
    { judgment: { name: "Blunder" }, best: "e7e5", eval: -250 },
    { judgment: { name: "Mistake" }, best: "g1f3", eval: -300 },
  ],
};

test("imports the player's blunders from positions near equality or better", () => {
  const { api } = loadList("blunder-list.js", "extractBlunders");
  const white = api.extractBlunders(game, "PLAYER");
  assert.equal(white.length, 1);
  assert.equal(white[0].id, "abcdefgh:1");
  assert.equal(white[0].best, "e2e4");
  assert.equal(white[0].opponent, "Opponent");
  assert.equal(api.extractBlunders(game, "opponent")[0].ply, 2);
  assert.equal(api.extractBlunders(game, "someone").length, 0);
  assert.equal(api.extractBlunders({ ...game, analysis: undefined }, "player").length, 0);
});

test("uses FEN turn and move number for games with a custom start", () => {
  const { api } = loadList("blunder-list.js", "extractBlunders");
  const custom = { ...game, initialFen: "8/8/8/8/8/8/k7/K7 b - - 0 12" };
  assert.equal(api.extractBlunders(custom, "opponent").length, 0);
  assert.equal(api.extractBlunders(custom, "player")[0].ply, 25);
});

test("excludes blunders played after the player's position was already lost", () => {
  const { api } = loadList("blunder-list.js", "extractBlunders");
  assert.equal(api.extractBlunders(game, "opponent").length, 1);
  assert.equal(api.extractBlunders({
    ...game,
    analysis: [{ ...game.analysis[0], eval: 200 }, ...game.analysis.slice(1)],
  }, "opponent").length, 0);
  assert.equal(api.extractBlunders({
    ...game,
    analysis: [{ ...game.analysis[0], eval: 100 }, ...game.analysis.slice(1)],
  }, "opponent").length, 1);
  assert.equal(api.extractBlunders({
    ...game,
    analysis: [{ ...game.analysis[0], eval: undefined }, ...game.analysis.slice(1)],
  }, "opponent").length, 0);
});

test("normalizes saved cards and removes invalid queue entries", () => {
  const { api } = loadList("blunder-list.js", "normalize, extractBlunders");
  const item = api.extractBlunders(game, "player")[0];
  const normalized = api.normalize({
    items: [item, item, { ...item, gameId: "invalid" }],
    activeQueue: [item.id, item.id, "missing"], activeIndex: 0,
  });
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.activeQueue.length, 1);
  assert.equal(normalized.activeIndex, 0);
  assert.equal(api.normalize({ ...normalized, activeIndex: -1 }).activeIndex, null);
});

test("prioritizes due reviews, schedules ratings and starts before the error", async () => {
  const { api, context, assigned, writes } = loadList("blunder-list.js", `
    dueItems, startQueue, extractBlunders,
    setData: value => { data = normalize(value); testPersisted[storageKey] = data; render = () => {}; }
  `);
  const item = api.extractBlunders(game, "player")[0];
  const due = { ...item, id: "ijklmnop:2", gameId: "ijklmnop", ply: 2, state: "review", dueAt: 1 };
  const future = { ...item, id: "qrstuvwx:3", gameId: "qrstuvwx", ply: 3, state: "review", dueAt: Date.now() + 86400000 };
  api.setData({ items: [item, future, due] });
  assert.equal(api.dueItems().length, 2);
  assert.equal(api.dueItems()[0].id, due.id);
  await api.startQueue([item.id]);
  assert.equal(assigned[0], "/abcdefgh/white?lfs-blunder=1#0");
  assert.equal(writes[0].lfsBlunderList.activeIndex, 0);
  for (const grade of [1, 2, 3, 4]) {
    const scheduled = context.LichessPuzzleScheduler.schedule(item, grade, 1000);
    assert.ok(scheduled.dueAt > 1000);
    assert.equal(scheduled.reps, 1);
    assert.equal(scheduled.id, item.id);
    assert.equal(scheduled.best, item.best);
  }
});

test("opening the Blunder button starts due positions directly, or the first saved one", async () => {
  const { api, assigned, persisted, settle } = loadList("blunder-list.js", `
    extractBlunders, openBlunders,
    setData: value => { data = normalize(value); testPersisted[storageKey] = data; render = () => {}; }
  `);
  const first = api.extractBlunders(game, "player")[0];
  const due = { ...first, id: "ijklmnop:2", gameId: "ijklmnop", ply: 2, state: "review", dueAt: 1 };
  const later = { ...first, id: "qrstuvwx:3", gameId: "qrstuvwx", ply: 3, state: "review", dueAt: Date.now() + 86400000 };
  api.setData({ items: [first, later, due] });
  api.openBlunders();
  await settle();
  assert.equal(assigned[0], "/ijklmnop/white?lfs-blunder=2#1");
  api.setData({ items: [first, later] });
  api.openBlunders();
  await settle();
  assert.equal(assigned[1], "/abcdefgh/white?lfs-blunder=1#0");
});

test("streamed synchronization preserves existing repetition progress and deduplicates", async () => {
  const content = `${JSON.stringify(game)}\n${JSON.stringify(game)}\n`;
  const chunks = [content.slice(0, 17), content.slice(17, 100), content.slice(100)];
  let url;
  const { api, writes } = loadList("blunder-list.js", `
    extractBlunders, importGames,
    setData: value => { data = normalize(value); testPersisted[storageKey] = data; render = () => {}; renderPage = () => {}; },
    getData: () => data
  `, {
    fetch: async request => {
      url = request;
      return {
        ok: true,
        body: { getReader: () => ({
          read: async () => chunks.length ? { value: Buffer.from(chunks.shift()), done: false } : { done: true },
          releaseLock: () => {},
        }) },
      };
    },
  });
  const item = { ...api.extractBlunders(game, "player")[0], state: "review", reps: 4, dueAt: 123456 };
  api.setData({ items: [item] });
  await api.importGames();
  assert.equal(api.getData().items.length, 1);
  assert.equal(api.getData().items[0].reps, 4);
  assert.equal(api.getData().items[0].dueAt, 123456);
  assert.ok(url.includes("analysed=true"));
  assert.ok(url.includes("ongoing=false"));
  assert.equal(writes.length, 1);
});

test("automatically imports recent games with an analysis overlap and records success", async () => {
  let request;
  let reads = 0;
  const { api, persisted } = loadList("blunder-list.js", `maybeAutoSync`, {
    fetch: async url => {
      request = url;
      return {
        ok: true,
        body: { getReader: () => ({
          read: async () => reads++ ? { done: true } : { value: Buffer.from(`${JSON.stringify(game)}\n`), done: false },
          releaseLock: () => {},
        }) },
      };
    },
  });
  await api.maybeAutoSync();
  const query = new URL(request, "https://lichess.org").searchParams;
  assert.equal(query.get("analysed"), "true");
  assert.equal(query.get("ongoing"), "false");
  assert.ok(Date.now() - Number(query.get("since")) <= 30 * 86400000 + 60000, request);
  assert.ok(persisted.lfsBlunderList.items.some(item => item.id === "abcdefgh:1"));
  assert.ok(Number.isFinite(persisted.lfsBlunderAutoSync.player));
});

test("skips automatic export when this account was checked recently", async () => {
  let requests = 0;
  const { api, persisted } = loadList("blunder-list.js", `maybeAutoSync`, {
    fetch: async () => { requests++; throw new Error("Should not fetch"); },
  });
  persisted.lfsBlunderAutoSync = { player: Date.now() };
  await api.maybeAutoSync();
  assert.equal(requests, 0);
});

test("excludes another account's positions from the list and training queue", () => {
  const { api } = loadList("blunder-list.js", `
    extractBlunders, ownItems, dueItems,
    setData: value => { data = normalize(value); }
  `);
  const own = api.extractBlunders(game, "player")[0];
  const other = api.extractBlunders(game, "opponent")[0];
  api.setData({ items: [own, other] });
  assert.equal(api.ownItems().length, 1);
  assert.equal(api.dueItems()[0].owner, "player");
});

test("serialized updates keep both a new position and a simultaneous rating", async () => {
  const { api, persisted, context } = loadList("blunder-list.js", `
    save, extractBlunders,
    setup: () => { render = () => {}; renderPage = () => {}; }
  `);
  api.setup();
  const card = api.extractBlunders(game, "player")[0];
  const added = { ...card, id: "ijklmnop:1", gameId: "ijklmnop" };
  persisted.lfsBlunderList = { items: [card], activeQueue: [], activeIndex: null };
  await Promise.all([
    api.save(current => ({ ...current, items: [...current.items, added] })),
    api.save(current => ({ ...current, items: current.items.map(item => item.id === card.id
      ? context.LichessPuzzleScheduler.schedule(item, 3, 1000) : item) })),
  ]);
  assert.equal(persisted.lfsBlunderList.items.length, 2);
  assert.equal(persisted.lfsBlunderList.items[0].reps, 1);
});

test("ratings are saved only once and sessions advance and finish", async () => {
  const { api, assigned, persisted, settle } = loadList("blunder-list.js", `
    extractBlunders,
    setup: value => {
      data = normalize(value); testPersisted[storageKey] = data;
      render = () => {}; renderPage = () => {}; exerciseState = "solved";
    },
    visit: item => { location.pathname = '/' + item.gameId + '/' + item.color; location.search = '?lfs-blunder=' + item.ply; },
    click: (action, grade) => toolbarClick({ target: { closest: () => ({ dataset: { action, grade } }) } })
  `);
  const first = api.extractBlunders(game, "player")[0];
  const second = { ...first, id: "ijklmnop:1", gameId: "ijklmnop" };
  api.setup({ items: [first, second], activeQueue: [first.id, second.id], activeIndex: 0 });
  api.visit(first);
  api.click("rate", "3");
  api.click("rate", "3");
  await settle();
  assert.equal(persisted.lfsBlunderList.items[0].reps, 1);
  api.click("next");
  await settle();
  assert.equal(assigned.at(-1), "/ijklmnop/white?lfs-blunder=1#0");
  api.visit(second);
  api.click("rate", "1");
  await settle();
  api.click("next");
  await settle();
  assert.equal(assigned.at(-1), "/#blunder-list");
  assert.equal(persisted.lfsBlunderList.activeQueue.length, 0);
  assert.equal(persisted.lfsBlunderList.activeIndex, null);
});

test("keeps imported positions when an export stream is interrupted", async () => {
  let reads = 0;
  const { api, writes } = loadList("blunder-list.js", `
    importGames,
    setup: () => { render = () => {}; renderPage = () => {}; },
    getData: () => data,
    getMessage: () => message
  `, {
    fetch: async () => ({
      ok: true,
      body: { getReader: () => ({
        read: async () => {
          if (reads++) throw new Error("connection interrupted");
          return { value: Buffer.from(`${JSON.stringify(game)}\n`), done: false };
        },
        releaseLock: () => {},
      }) },
    }),
  });
  api.setup();
  await api.importGames();
  assert.equal(api.getData().items.length, 1);
  assert.equal(writes.length, 1);
  assert.match(api.getMessage(), /Einlesen unterbrochen/);
});

test("playlist button starts a puzzle directly, prioritizing due cards", () => {
  const { api, assigned, context, dispatched } = loadList("puzzle-playlist.js", `
    ensureHomeClickHandler,
    setup: value => {
      playlist = normalizePlaylist(value);
      render = () => {};
      homePanel = { dataset: {}, addEventListener: (name, handler) => { globalThis.click = handler; } };
    }
  `);
  api.setup({ items: [
    { id: "Abc12", state: "new" },
    { id: "Def34", state: "review", dueAt: 1 },
  ] });
  api.ensureHomeClickHandler();
  context.click({ target: { closest: () => ({ dataset: { action: "open" } }) } });
  assert.equal(assigned[0], "/training/Def34");
  context.click({ target: { closest: () => ({ dataset: { action: "blunders" } }) } });
  assert.equal(dispatched.at(-1).type, "lfs-blunder-open");
});

test("playlist click still starts directly when all saved cards are scheduled for later", () => {
  const { api, assigned, context } = loadList("puzzle-playlist.js", `
    ensureHomeClickHandler,
    setup: () => {
      playlist = normalizePlaylist({ items: [{ id: "Abc12", state: "review", dueAt: Date.now() + 86400000 }] });
      render = () => {};
      homePanel = { dataset: {}, addEventListener: (name, handler) => { globalThis.click = handler; } };
    }
  `);
  api.setup();
  api.ensureHomeClickHandler();
  context.click({ target: { closest: () => ({ dataset: { action: "open" } }) } });
  assert.equal(assigned[0], "/training/Abc12");
});

function loadTraining() {
  const listeners = new Map();
  const states = [];
  let checkMove;
  let engineStarts = 0;
  const engineEnabled = () => true;
  const ctrl = {
    asyncReady: true, ongoing: false, path: "", node: { ply: 0 },
    data: { game: { id: "abcdefgh" } },
    chessground: { set: () => {} },
    autoplay: { stop: () => {} }, ceval: { reset: () => {} },
    cevalEnabled: engineEnabled, turnColor: () => "white",
    jumpToMain() { this.path = ""; this.node = { ply: 0 }; },
    userJump(path) { this.path = path; this.node = { ply: 0 }; },
    playUci(uci) { this.path = "aa"; this.node = { ply: 1, uci: uci === "e1g1" ? "e1h1" : uci }; },
    startCevalIfEnabled: () => engineStarts++, redraw: () => {},
  };
  const context = vm.createContext({
    URLSearchParams, console,
    location: { pathname: "/abcdefgh/white", search: "?lfs-blunder=1" },
    window: { site: { analysis: ctrl }, lichess: { events: { on: (name, fn) => { checkMove = fn; } } } },
    document: {
      addEventListener: (name, fn) => listeners.set(name, fn),
      dispatchEvent: event => states.push(JSON.parse(event.detail).status),
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: fn => fn(),
  });
  vm.runInContext(readFileSync(join(__dirname, "blunder-training-main.js"), "utf8"), context);
  const send = value => listeners.get("lfs-blunder-command")({ detail: JSON.stringify(value) });
  send({ action: "prepare", id: "abcdefgh:1", gameId: "abcdefgh", ply: 1, color: "white", best: "e1g1" });
  return { ctrl, send, states, check: () => checkMove(), engineEnabled, starts: () => engineStarts };
}

test("training resets wrong moves and accepts normalized castling without changing engine preferences", () => {
  const { ctrl, states, check, engineEnabled, starts } = loadTraining();
  assert.equal(states.at(-1), "ready");
  assert.equal(ctrl.cevalEnabled(), false);
  ctrl.playUci("a2a3");
  check();
  assert.equal(states.at(-1), "wrong");
  assert.equal(ctrl.path, "");
  ctrl.playUci("e1g1");
  check();
  assert.equal(states.at(-1), "solved");
  assert.equal(ctrl.cevalEnabled, engineEnabled);
  assert.equal(starts(), 1);
});

test("revealing the solution makes the exercise available for spaced-repetition rating", () => {
  const { send, states, ctrl } = loadTraining();
  send({ action: "reveal" });
  assert.equal(states.at(-1), "solved");
  assert.equal(ctrl.node.uci, "e1h1");
});
