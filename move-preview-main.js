(() => {
  const channel = "lfs-move-preview-fen";
  let scheduled = false;
  let subscribedEvents = null;
  const mayHaveAnalysis = /^\/(?:analysis(?:\/|$)|(?:game\/)?[a-zA-Z0-9]{8}(?:\/|$))/.test(location.pathname);

  function publish() {
    const analysis = window.site?.analysis;
    const fen = analysis?.node?.fen;
    if (!analysis?.asyncReady || !analysis.chessground || typeof fen !== "string") return;
    window.postMessage({
      channel,
      fen,
      variant: analysis.data?.game?.variant?.key,
      identity: `${analysis.data?.game?.id ?? ""}:${analysis.path ?? ""}:${analysis.node?.ply ?? ""}`
    }, location.origin);
    const game = analysis.data?.game;
    const nodes = analysis.nodeList;
    const mainline = analysis.mainline;
    let clocks = null;
    if (game?.id && game.id !== "synthetic" && !analysis.ongoing && !analysis.study
      && Array.isArray(nodes) && nodes.length && Array.isArray(mainline)
      && mainline.slice(1).some(node => Number.isFinite(node.clock) && node.clock >= 0)
      && nodes.every((node, index) => node === mainline[index])) {
      const initial = Number.isFinite(nodes[0].clock) && nodes[0].clock >= 0 ? nodes[0].clock
        : Number.isFinite(analysis.data?.clock?.initial) && analysis.data.clock.initial >= 0 ? analysis.data.clock.initial * 100 : null;
      clocks = {};
      for (const [color, parity] of [["white", 1], ["black", 0]]) {
        const played = nodes.slice(1).filter(node => node.ply % 2 === parity);
        const remaining = played.length ? played.at(-1).clock : initial;
        const values = mainline.slice(1).filter(node => node.ply % 2 === parity)
          .map(node => node.clock).filter(value => Number.isFinite(value) && value >= 0);
        if (initial !== null) values.push(initial);
        if (Number.isFinite(remaining) && remaining >= 0 && values.length) {
          const maximum = Math.max(...values);
          clocks[color] = maximum > 0 ? Math.min(100, remaining / maximum * 100) : 0;
        }
      }
    }
    window.postMessage({ channel: "lfs-analysis-clocks", clocks }, location.origin);
  }

  function connect() {
    scheduled = false;
    const analysis = window.site?.analysis;
    if (analysis?.asyncReady && analysis.chessground) {
      publish();
      observer.disconnect();
    }
    const events = window.lichess?.events;
    if (events && events !== subscribedEvents && typeof events.on === "function") {
      subscribedEvents = events;
      events.on("analysis.change", publish);
      events.on("ply", publish);
    }
  }

  function scheduleConnect() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(connect);
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "lfs-move-preview-state-request") return;
    connect();
  });

  const observer = new MutationObserver(scheduleConnect);
  if (mayHaveAnalysis) observer.observe(document, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", scheduleConnect, { once: true });
  window.addEventListener("load", scheduleConnect, { once: true });
  scheduleConnect();
})();
