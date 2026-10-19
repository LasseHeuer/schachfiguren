(() => {
  const gameId = location.pathname.match(/^\/([a-zA-Z0-9]{8})\/(white|black)$/)?.[1];
  const ply = Number(new URLSearchParams(location.search).get("lfs-blunder"));
  if (!gameId || !Number.isInteger(ply) || ply < 1) return;
  const id = `${gameId}:${ply}`;
  let item;
  let ctrl;
  let initialPath;
  let expectedUci;
  let originalCevalEnabled;
  let status = "loading";
  let checking = false;
  let queued = false;

  function report(next) {
    status = next;
    document.dispatchEvent(new CustomEvent("lfs-blunder-state", { detail: JSON.stringify({ id, status }) }));
  }

  function restoreEngine() {
    if (!ctrl || !originalCevalEnabled) return;
    ctrl.cevalEnabled = originalCevalEnabled;
    originalCevalEnabled = null;
    ctrl.startCevalIfEnabled();
  }

  function prepare() {
    if (ctrl || !item) return;
    const analysis = window.site?.analysis;
    if (!analysis?.asyncReady || !analysis.chessground) return;
    if (analysis.ongoing || analysis.data.game.id !== gameId) {
      report("error");
      observer.disconnect();
      return;
    }
    ctrl = analysis;
    observer.disconnect();
    try {
      if (ctrl.practice) ctrl.togglePractice(false);
      if (ctrl.retro) ctrl.toggleRetro();
      ctrl.autoplay.stop();
      originalCevalEnabled = ctrl.cevalEnabled;
      // Suppress hints for this exercise without changing saved engine preferences.
      ctrl.cevalEnabled = () => false;
      ctrl.ceval.reset();
      ctrl.jumpToMain(ply - 1);
      if (ctrl.node.ply !== ply - 1 || ctrl.turnColor() !== item.color) throw new Error("Invalid position");
      initialPath = ctrl.path;
      const best = item.best || ctrl.mainline.find(node => node.ply === ply)?.eval?.best;
      if (typeof best !== "string" || !/^(?:[a-h][1-8][a-h][1-8][qrbn]?|[PNBRQK]@[a-h][1-8])$/.test(best)) {
        throw new Error("Missing solution");
      }
      // Let Lichess normalize castling, promotions and variant moves itself.
      ctrl.playUci(best);
      if (ctrl.node.ply !== ply) throw new Error("Invalid solution");
      expectedUci = ctrl.node.uci;
      ctrl.userJump(initialPath);
      ctrl.chessground.set({ orientation: item.color });
      ctrl.redraw();
      window.lichess.events.on("analysis.change", checkMove);
      report("ready");
    } catch (error) {
      console.warn("Lichess Blunder-Training:", error);
      restoreEngine();
      report("error");
    }
  }

  function checkMove() {
    if (!ctrl || checking || !["ready", "wrong"].includes(status) || ctrl.path === initialPath) return;
    checking = true;
    try {
      if (ctrl.path.startsWith(initialPath) && ctrl.path.length === initialPath.length + 2
        && ctrl.node.ply === ply && ctrl.node.uci === expectedUci) {
        report("solved");
        restoreEngine();
      } else {
        ctrl.userJump(initialPath);
        ctrl.redraw();
        report("wrong");
      }
    } finally {
      checking = false;
    }
  }

  document.addEventListener("lfs-blunder-command", event => {
    let command;
    try { command = JSON.parse(event.detail); } catch { return; }
    if (command.action === "prepare" && command.id === id && command.gameId === gameId && command.ply === ply) {
      item = command;
      prepare();
    } else if (command.action === "reveal" && ctrl && ["ready", "wrong"].includes(status)) {
      checking = true;
      try {
        ctrl.userJump(initialPath);
        ctrl.playUci(expectedUci);
        ctrl.redraw();
        report("solved");
        restoreEngine();
      } finally {
        checking = false;
      }
    }
  });
  const observer = new MutationObserver(() => {
    if (queued || ctrl) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!item) report("request");
      prepare();
    });
  });
  observer.observe(document, { childList: true, subtree: true });
  report("request");
})();
