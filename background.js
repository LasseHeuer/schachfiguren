let offscreenCreation;

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!offscreenCreation) {
    offscreenCreation = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play pairing sounds to completion when Lichess navigates to a game."
    }).finally(() => {
      offscreenCreation = undefined;
    });
  }
  await offscreenCreation;
}

async function preloadSound(url) {
  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({ type: "lfs-offscreen-preload", url });
  } catch (error) {
    console.warn("Lichess-Sound konnte nicht vorgeladen werden", error);
  }
}

async function playSound(url, volume) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ type: "lfs-offscreen-play", url, volume });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "lfs-audio-preload") {
    void preloadSound(message.url).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type !== "lfs-audio-play") return;
  void playSound(message.url, message.volume).then(sendResponse, error => {
    console.warn("Lichess-Sound konnte nicht fortgesetzt werden", error);
    sendResponse({ ok: false });
  });
  return true;
});
