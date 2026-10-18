const audioPools = new Map();

function createAudio(url) {
  const audio = new Audio();
  audio.preload = "auto";
  audio.src = url;
  audio.load();
  return audio;
}

function getAudioPool(url) {
  let pool = audioPools.get(url);
  if (!pool) {
    pool = [createAudio(url)];
    audioPools.set(url, pool);
  }
  return pool;
}

function preloadSound(url) {
  const [audio] = getAudioPool(url);
  if (audio.readyState >= 2) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      audio.removeEventListener("canplay", finish);
      audio.removeEventListener("error", finish);
      resolve();
    };
    audio.addEventListener("canplay", finish);
    audio.addEventListener("error", finish);
    if (audio.readyState >= 2) finish();
  });
}

function playSound(url, volume) {
  const pool = getAudioPool(url);
  const audio = pool.find(candidate => candidate.paused) ?? createAudio(url);
  if (!pool.includes(audio)) pool.push(audio);
  audio.volume = Math.max(0, Math.min(1, volume));
  if (audio.ended) audio.currentTime = 0;

  return new Promise((resolve, reject) => {
    const finish = error => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onEnded = () => finish();
    const onError = () => finish(audio.error ?? new Error("Sound konnte nicht abgespielt werden"));
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    const playback = audio.play();
    playback?.catch(finish);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "lfs-offscreen-preload") {
    void preloadSound(message.url).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type !== "lfs-offscreen-play") return;
  void playSound(message.url, message.volume).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});
