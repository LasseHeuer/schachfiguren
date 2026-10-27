(() => {
  const channel = "lfs-move-preview-fen";
  let scheduled = false;
  let subscribedEvents = null;
  const mayHaveAnalysis = /^\/analysis(?:\/|$)/.test(location.pathname);

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
