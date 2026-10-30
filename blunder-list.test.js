const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
require("./settings.js");

function loadList(file, exports, extra = {}) {
  const assigned = [];
  const writes = [];
  const dispatched = [];
  const persisted = {};
  const session = new Map();
  const rootAttributes = new Set();
  const locks = new Map();
  const context = vm.createContext({
    URLSearchParams, TextDecoder, Date, setTimeout, clearTimeout,
    LichessSettings: globalThis.LichessSettings,
    fetch: async () => ({ ok: true, text: async () => "" }),
    document: {
      documentElement: {
        hasAttribute: name => rootAttributes.has(name),
        setAttribute: name => rootAttributes.add(name),
        removeAttribute: name => rootAttributes.delete(name),
      },
      querySelector: () => ({ textContent: "Player", getAttribute: () => null }),
      addEventListener: () => {}, dispatchEvent: event => dispatched.push(event),
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
    location: { pathname: "/", search: "", hash: "", assign: url => assigned.push(url) },
    sessionStorage: {
      getItem: key => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, String(value)),
      removeItem: key => session.delete(key),
    },
    testPersisted: persisted,
    testSession: session,
    navigator: { locks: { request: (key, action) => {
      const lock = (locks.get(key) ?? Promise.resolve()).then(action);
      locks.set(key, lock);
      return lock;
    } } },
    chrome: {
      runtime: { getURL: path => path },
      storage: { local: {
        get: (key, callback) => { callback?.(persisted); return Promise.resolve(persisted); },
        set: (value, callback) => { Object.assign(persisted, value); writes.push(value); callback?.(); return Promise.resolve(); },
      } },
    },
    ...extra,
  });
  vm.runInContext(readFileSync(join(__dirname, "puzzle-scheduler.js"), "utf8"), context);
  const source = readFileSync(join(__dirname, file), "utf8");
  vm.runInContext(source.replace(/  chrome\.storage\.local\.get\([^)]*, stored => \{/, `
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
  const item = { ...api.extractBlunders(game, "player")[0], lastRating: 4, stability: 12, reps: 3 };
  const normalized = api.normalize({
    items: [item, item, { ...item, gameId: "invalid" }],
    activeQueue: [item.id, item.id, "missing"], activeIndex: 0,
  });
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.activeQueue.length, 1);
  assert.equal(normalized.activeIndex, 0);
  assert.equal(normalized.items[0].lastRating, 0);
  assert.equal(normalized.items[0].stability, 12);
  assert.equal(normalized.ratingScaleVersion, 2);
  assert.equal(api.normalize({ ...normalized, activeIndex: -1 }).activeIndex, null);
});

test("maps old ratings to the easy-to-again slider scale and preserves progress", () => {
  const { api } = loadList("puzzle-playlist.js", "normalizePlaylist");
  const normalized = api.normalizePlaylist({ items: [
    { id: "Abc12", lastRating: 4, reps: 3, stability: 12, dueAt: 123456 },
    { id: "Def34", lastRating: 3 },
    { id: "Ghi56", lastRating: 2 },
    { id: "Jkl78", lastRating: 1 },
  ] });
  assert.deepEqual(Array.from(normalized.items, item => item.lastRating), [0, 1 / 3, 2 / 3, 1]);
  assert.equal(normalized.items[0].reps, 3);
  assert.equal(normalized.items[0].stability, 12);
  assert.equal(normalized.items[0].dueAt, 123456);
  assert.equal(normalized.ratingScaleVersion, 2);
});

test("keeps no more than the 500 most recent blunders", () => {
  const { api } = loadList("blunder-list.js", "normalize");
  const items = Array.from({ length: 501 }, (_, index) => {
    const gameId = String(index + 1).padStart(8, "0");
    return { id: `${gameId}:1`, gameId, ply: 1, color: "white", playedAt: index + 1 };
  });
  const normalized = api.normalize({ items, activeQueue: [items[0].id], activeIndex: 0 });
  assert.equal(normalized.items.length, 500);
  assert.equal(normalized.items[0].gameId, "00000501");
  assert.deepEqual(Array.from(normalized.activeQueue), []);
  assert.equal(normalized.activeIndex, null);
});

test("prioritizes due reviews, schedules ratings and starts before the error", async () => {
  const { api, context, assigned, writes } = loadList("blunder-list.js", `
    dueItems, startQueue, extractBlunders,
    setData: value => { data = normalize(value); testPersisted[storageKey] = data; render = () => {}; },
    getData: () => data
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
  assert.equal(api.getData().items.find(entry => entry.id === item.id).attempts, 1);
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
  await api.openBlunders();
  await settle();
  assert.equal(assigned[0], "/ijklmnop/white?lfs-blunder=2#1");
  api.setData({ items: [first, later] });
  await api.openBlunders();
  await settle();
  assert.equal(assigned[1], "/abcdefgh/white?lfs-blunder=1#0");
});

test("training excludes positions from the latest ten Lichess games", async () => {
  const games = Array.from({ length: 12 }, (_, index) => ({
    ...game,
    id: String(index + 1).padStart(8, "0"),
    createdAt: 1200 - index,
  }));
  const latest = games.slice(0, 10).map(({ id }) => JSON.stringify({ id })).join("\n");
  let request;
  const { api, assigned, settle } = loadList("blunder-list.js", `
    extractBlunders, openBlunders,
    setData: value => { data = normalize(value); testPersisted[storageKey] = data; render = () => {}; },
    getData: () => data
  `, {
    fetch: async url => {
      request = url;
      return { ok: true, text: async () => latest };
    },
  });
  api.setData({ items: games.map(item => api.extractBlunders(item, "player")[0]) });
  await api.openBlunders();
  await settle();
  assert.equal(new URL(request, "https://lichess.org").searchParams.get("max"), "10");
  assert.deepEqual(assigned, [`/${games[10].id}/white?lfs-blunder=1#0`]);
  assert.equal(api.getData().activeQueue.length, 2);
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
  assert.equal(writes.length, 0);
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
    click: action => toolbarClick({ target: { closest: () => ({ dataset: { action } }) } }),
    change: value => toolbarChange({ target: { closest: () => ({ dataset: { action: "rate" }, value }) } })
  `);
  const first = api.extractBlunders(game, "player")[0];
  const second = { ...first, id: "ijklmnop:1", gameId: "ijklmnop" };
  api.setup({ items: [first, second], activeQueue: [first.id, second.id], activeIndex: 0 });
  api.visit(first);
  api.change("0.5");
  api.change("0.5");
  await settle();
  assert.equal(persisted.lfsBlunderList.items[0].reps, 1);
  api.click("next");
  await settle();
  assert.equal(assigned.at(-1), "/ijklmnop/white?lfs-blunder=1#0");
  assert.equal(persisted.lfsBlunderList.items[1].attempts, 1);
  api.visit(second);
  api.change("1");
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

test("stops importing after 500 new blunders", async () => {
  let cancelled = 0;
  const content = Array.from({ length: 501 }, (_, index) => JSON.stringify({
    ...game,
    id: String(index + 1).padStart(8, "0"),
    createdAt: 100000 - index,
  })).join("\n") + "\n";
  const { api } = loadList("blunder-list.js", `
    importGames,
    getData: () => data,
    getMessage: () => message
  `, {
    fetch: async () => ({
      ok: true,
      body: { getReader: () => ({
        read: async () => ({ value: Buffer.from(content), done: false }),
        cancel: async () => { cancelled++; },
        releaseLock: () => {},
      }) },
    }),
  });
  await api.importGames();
  assert.equal(api.getData().items.length, 500);
  assert.equal(cancelled, 1);
  assert.match(api.getMessage(), /500/);
});

test("playlist button starts a puzzle directly, prioritizing due cards", () => {
  const { api, assigned, context, dispatched } = loadList("puzzle-playlist.js", `
    ensureHomeClickHandler,
    getPlaylist: () => playlist,
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
  assert.equal(api.getPlaylist().items.find(item => item.id === "Def34").attempts, 1);
  context.click({ target: { closest: () => ({ dataset: { action: "blunders" } }) } });
  assert.equal(dispatched.at(-1).type, "lfs-blunder-open");
});

test("slider ratings produce distinct intervals across the easy-to-again range", () => {
  const { context } = loadList("puzzle-playlist.js", "");
  const card = { id: "Abc12", state: "new" };
  const scheduler = context.LichessPuzzleScheduler;
  const easy = scheduler.scheduleEase(card, 0, 1000);
  const middle = scheduler.scheduleEase(card, 0.5, 1000);
  const hard = scheduler.scheduleEase(card, 1, 1000);
  const capped = scheduler.scheduleEase(card, 0.5, 1000, 0.5);
  const oldEasy = scheduler.schedule(card, 4, 1000);
  const oldAgain = scheduler.schedule(card, 1, 1000);
  const matureEasy = scheduler.scheduleEase({
    state: "review", stability: 30, difficulty: 5, reps: 5, lastReviewedAt: 1000 - 30 * scheduler.day,
  }, 0, 1000);
  assert.ok(easy.stability > middle.stability && middle.stability > hard.stability);
  assert.ok(easy.dueAt > middle.dueAt && middle.dueAt > hard.dueAt);
  assert.equal(easy.dueAt, oldEasy.dueAt);
  assert.equal(hard.dueAt, oldAgain.dueAt);
  assert.equal(hard.state, "learning");
  assert.ok(matureEasy.dueAt - 1000 > 30 * scheduler.day);
  assert.equal(middle.lastRating, 0.5);
  assert.equal(capped.lastRating, 1);
  assert.equal(capped.state, "learning");
  assert.equal(scheduler.normalizeRating(4, 1), 0);
  assert.equal(scheduler.normalizeRating(3, 1), 1 / 3);
  assert.equal(scheduler.normalizeRating(2, 1), 2 / 3);
  assert.equal(scheduler.normalizeRating(0.25, 2), 0.25);
});

test("releasing the playlist rating slider saves the rating and continues the queue", () => {
  const document = listDocument();
  const parent = document.createElement("section");
  document.querySelector = selector => selector === ".puzzle__session" ? parent
    : selector === ".puzzle__feedback.after" ? {} : {};
  const { api, assigned, persisted } = loadList("puzzle-playlist.js", `
    renderPuzzleToolbar,
    setup: value => {
      playlist = normalizePlaylist(value);
      render = () => {};
      puzzleId = () => "Abc12";
    },
    getToolbar: () => puzzleToolbar
  `, { document });
  api.setup({ items: [{ id: "Abc12" }, { id: "Def34" }], activeQueue: ["Abc12", "Def34"], activeIndex: 0 });
  api.renderPuzzleToolbar();
  api.getToolbar().listeners.change({ target: { closest: () => ({ dataset: { action: "rate" }, value: "0.37" }) } });
  assert.equal(assigned.at(-1), "/training/Def34");
  assert.equal(persisted.lfsPuzzlePlaylist.items[0].lastRating, 0.37);
  assert.equal(persisted.lfsPuzzlePlaylist.activeIndex, 1);
});

test("home playlist button shows the number of new and due puzzles", () => {
  const document = listDocument();
  const { api } = loadList("puzzle-playlist.js", `
    renderHomePanel,
    setup: value => {
      playlist = normalizePlaylist(value);
      homePanel ??= document.createElement("section");
    },
    getPanel: () => homePanel
  `, { document });
  api.setup({ items: [{ id: "Abc12", state: "new" }] });
  api.renderHomePanel();
  const panel = api.getPanel();
  assert.equal(panel.children[0].textContent, "Rätsel-Playlist (1)");

  api.setup({ items: [{ id: "Abc12", state: "new" }, { id: "Def34", state: "review", dueAt: 1 }] });
  api.renderHomePanel();
  assert.equal(panel.children[0].textContent, "Rätsel-Playlist (2)");
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

test("playlist continuation preserves zen mode when moving to the next puzzle", async () => {
  const { api, assigned, context, settle } = loadList("puzzle-playlist.js", `
    continuePlaylist,
    setup: value => { playlist = normalizePlaylist(value); render = () => {}; },
    enableZen: () => document.documentElement.setAttribute("data-lfs-zen-mode", ""),
    getPlaylist: () => playlist
  `);
  api.setup({ items: [{ id: "Abc12" }, { id: "Def34" }], activeQueue: ["Abc12", "Def34"], activeIndex: 0 });
  api.enableZen();
  api.continuePlaylist("Abc12");
  await settle();
  assert.equal(assigned.at(-1), "/training/Def34");
  assert.equal(context.testSession.get("lfsPuzzlePlaylistZenMode"), "true");
  assert.equal(api.getPlaylist().activeIndex, 1);
});

test("playlist restores zen mode before the next puzzle renders", () => {
  const attributes = new Set();
  let markerRemoved = false;
  loadList("puzzle-playlist.js", "", {
    document: { documentElement: { setAttribute: name => attributes.add(name) } },
    sessionStorage: {
      getItem: key => key === "lfsPuzzlePlaylistZenMode" && !markerRemoved ? "true" : null,
      removeItem: () => { markerRemoved = true; },
    },
  });
  assert.ok(attributes.has("data-lfs-zen-mode"));
  assert.ok(attributes.has("data-lfs-zen-restore-pending"));
  assert.equal(markerRemoved, true);
});

test("removing the active puzzle keeps native continuation in the playlist", () => {
  const { api, assigned, persisted } = loadList("puzzle-playlist.js", `
    removePlaylistItem, handleNativePuzzleContinue,
    setup: value => { playlist = normalizePlaylist(value); render = () => {}; puzzleId = () => "Def34"; },
    reload: () => { playlist = normalizePlaylist(testPersisted[storageKey]); },
    getPlaylist: () => playlist
  `);
  api.setup({ items: ["Abc12", "Def34", "Ghi56", "Jkl78"], activeQueue: ["Abc12", "Def34", "Ghi56", "Jkl78"], activeIndex: 1 });
  api.removePlaylistItem("Def34");
  api.removePlaylistItem("Abc12");
  api.removePlaylistItem("Ghi56");
  api.reload();
  assert.deepEqual(Array.from(api.getPlaylist().activeQueue), ["Def34", "Jkl78"]);
  assert.equal(api.getPlaylist().activeIndex, 0);
  assert.equal(api.getPlaylist().items.some(item => item.id === "Def34"), false);
  let prevented = false;
  let stopped = false;
  api.handleNativePuzzleContinue({
    target: { closest: () => ({}) },
    preventDefault: () => { prevented = true; },
    stopImmediatePropagation: () => { stopped = true; }
  });
  assert.ok(prevented && stopped);
  assert.equal(assigned.at(-1), "/training/Jkl78");
  assert.equal(persisted.lfsPuzzlePlaylist.items[0].attempts, 1);
  assert.deepEqual(Array.from(persisted.lfsPuzzlePlaylist.activeQueue), ["Jkl78"]);
  assert.equal(persisted.lfsPuzzlePlaylist.activeIndex, 0);
});

test("removing the last active puzzle finishes the playlist session", () => {
  const { api, assigned, persisted } = loadList("puzzle-playlist.js", `
    removePlaylistItem, handleNativePuzzleContinue,
    setup: value => { playlist = normalizePlaylist(value); render = () => {}; puzzleId = () => "Abc12"; }
  `);
  api.setup({ items: ["Abc12"], activeQueue: ["Abc12"], activeIndex: 0 });
  api.removePlaylistItem("Abc12");
  api.handleNativePuzzleContinue({ target: { closest: () => ({}) }, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(assigned.at(-1), "/#puzzle-playlist");
  assert.equal(persisted.lfsPuzzlePlaylist.activeIndex, null);
  assert.equal(persisted.lfsPuzzlePlaylist.activeQueue.length, 0);
});

function listDocument() {
  const createElement = tag => ({
    tagName: tag, children: [], dataset: {}, attributes: {}, listeners: {}, style: { setProperty(name, value) { this[name] = value; } }, className: "", textContent: "",
    classList: { add() {} },
    get lastElementChild() { return this.children.at(-1); },
    append(...children) {
      this.children.push(...children);
      children.forEach(child => { child.parentElement = this; });
    },
    prepend(...children) {
      this.children.unshift(...children);
      children.forEach(child => { child.parentElement = this; });
    },
    insertBefore(child, sibling) {
      this.children.splice(this.children.indexOf(sibling), 0, child);
      child.parentElement = this;
    },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    querySelector(selector) {
      const action = selector.match(/data-action="([^"]+)"/)?.[1];
      return this.children.find(child => child.dataset.action === action) ?? null;
    },
  });
  return {
    createElement,
    querySelector: () => ({ textContent: "Player", getAttribute: () => null }),
    addEventListener() {},
  };
}

test("playlist renders compact rows with individual scores and actions above the scroll list", () => {
  const document = listDocument();
  const { api } = loadList("puzzle-playlist.js", `
    renderPlaylistPage,
    setup: () => {
      playlist = normalizePlaylist({ items: [{ id: "Abc12", state: "review", reps: 2, attempts: 3 }] });
      playlistPage = document.createElement("section");
    },
    getPage: () => playlistPage
  `, { document });
  api.setup();
  api.renderPlaylistPage();
  const page = api.getPage();
  assert.equal(page.children[0].children[1].children[0].textContent, "2 / 3");
  assert.equal(page.children[2].className, "lfs-playlist-page-actions");
  const list = page.children[3];
  assert.equal(list.className, "lfs-playlist-list");
  assert.equal(list.tabIndex, 0);
  assert.equal(list.children[0].children[2].textContent, "2 / 3");
  assert.equal(list.children[0].children[3].attributes["aria-label"], "Rätsel 1 aus Playlist entfernen");
});

test("adding a solved puzzle to the playlist replaces the add button with only the rating slider", () => {
  const document = listDocument();
  const parent = document.createElement("section");
  document.querySelector = selector => selector === ".puzzle__session" ? parent : {};
  const { api } = loadList("puzzle-playlist.js", `
    renderPuzzleToolbar, toggleSavedPuzzle,
    setup: () => {
      puzzleId = () => "Abc12";
      playlist = normalizePlaylist({ items: [] });
      render = () => {};
    },
    getToolbar: () => puzzleToolbar
  `, { document });
  api.setup();
  api.renderPuzzleToolbar();
  const toolbar = api.getToolbar();
  assert.equal(toolbar.children.length, 1);
  const addButton = toolbar.children[0];
  assert.equal(addButton.textContent, "Zu Playlist hinzufügen");

  api.toggleSavedPuzzle({ currentTarget: addButton });
  api.renderPuzzleToolbar();
  assert.equal(toolbar.children.length, 1);
  const ratings = toolbar.children[0];
  assert.equal(ratings.children.length, 3);
  assert.deepEqual(Array.from(ratings.children.slice(0, 3), control => control.textContent), ["Einfach", "", "Schwer"]);
  assert.equal(ratings.children[1].type, "range");
  assert.equal(ratings.children[1].min, "0");
  assert.equal(ratings.children[1].max, "1");
  assert.equal(ratings.children[1].step, "any");
  assert.equal(ratings.children[1].style["--lfs-review-max-position"], "100%");
  assert.equal(ratings.children[1].style["--lfs-review-value"], "50%");
  assert.equal(ratings.children[1].style["--lfs-review-thumb-image"], 'url("system_rund/bq.svg")');
  assert.equal(ratings.querySelector('[data-action="menu-save"]'), null);
});

test("solved blunder exercises show the same easy-to-again rating slider", () => {
  const document = listDocument();
  const parent = document.createElement("section");
  document.documentElement = { setAttribute() {}, removeAttribute() {} };
  document.querySelector = selector => selector === "#user_tag" ? { textContent: "Player", getAttribute: () => null }
    : selector === ".analyse__tools" ? parent : null;
  const { api } = loadList("blunder-list.js", `
    renderToolbar, extractBlunders,
    setup: item => {
      data = normalize({ items: [item], activeQueue: [item.id], activeIndex: 0 });
      exerciseState = "solved";
      location.pathname = "/" + item.gameId + "/" + item.color;
      location.search = "?lfs-blunder=" + item.ply;
    },
    getToolbar: () => toolbar
  `, { document });
  const item = { ...api.extractBlunders(game, "player")[0], owner: "player" };
  api.setup(item);
  api.renderToolbar();
  const ratings = api.getToolbar().children[0];
  assert.equal(ratings.children.length, 3);
  assert.deepEqual(Array.from(ratings.children.slice(0, 3), control => control.textContent), ["Einfach", "", "Schwer"]);
  assert.equal(ratings.children[1].type, "range");
  assert.equal(ratings.children[1].min, "0");
  assert.equal(ratings.children[1].max, "1");
  assert.equal(ratings.children[1].step, "any");
  assert.equal(ratings.children[1].style["--lfs-review-thumb-image"], 'url("system_rund/bq.svg")');
});

test("blunder overview shows total and individual scores in keyboard-scrollable rows", () => {
  const document = listDocument();
  const { api } = loadList("blunder-list.js", `
    renderPage, extractBlunders,
    setup: item => { data = normalize({ items: [item] }); page = document.createElement("section"); },
    getPage: () => page
  `, { document });
  api.setup({ ...api.extractBlunders(game, "player")[0], reps: 1, attempts: 2 });
  api.renderPage();
  const page = api.getPage();
  assert.equal(page.children[0].children[1].children[0].textContent, "1 / 2");
  const list = page.children.at(-1);
  assert.equal(list.tabIndex, 0);
  assert.equal(list.children[0].children[2].textContent, "1 / 2");
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
