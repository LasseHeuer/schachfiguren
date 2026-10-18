(() => {
  const channel = "lfs-sound-settings";
  const patchedSounds = new WeakSet();
  let soundSettings = {};
  let customFiles = {};
  let playbackId = 0;

  const pageTransitionSounds = ["genericNotify"];

  function absoluteSoundUrl(url) {
    if (!url || /^(?:data:|chrome-extension:)/i.test(url)) return url;
    return new URL(url, location.href).href;
  }

  function soundUrl(sound, name) {
    const source = soundSettings[String(name).toLowerCase()]?.source || "website";
    if (source.startsWith("custom:")) return absoluteSoundUrl(customFiles[source.slice("custom:".length)]);
    if (source.startsWith("pack:")) {
      const pack = source.slice("pack:".length);
      const file = `${String(name)[0].toUpperCase()}${String(name).slice(1)}.mp3`;
      return absoluteSoundUrl(sound.url(`${pack}/${file}`));
    }
    return absoluteSoundUrl(sound.resolvePath(name));
  }

  function preloadPageTransitionSounds(sound) {
    for (const name of pageTransitionSounds) {
      const url = soundUrl(sound, name);
      if (url) window.postMessage({ channel: "lfs-audio-preload", url }, location.origin);
    }
  }

  function playAcrossNavigation(url, volume) {
    const id = `lfs-audio-${Date.now()}-${++playbackId}`;
    return new Promise(resolve => {
      const onResult = event => {
        if (event.source !== window || event.origin !== location.origin
          || event.data?.channel !== "lfs-audio-result" || event.data.id !== id) return;
        window.removeEventListener("message", onResult);
        resolve(event.data.ok === true);
      };
      window.addEventListener("message", onResult);
      window.postMessage({ channel: "lfs-audio-play", id, url, volume }, location.origin);
    });
  }

  function isPageTransitionSound(name) {
    return String(name).toLowerCase() === "genericnotify";
  }

  function dataUrlBytes(dataUrl) {
    const match = /^data:[^,]*;base64,([\s\S]*)$/.exec(dataUrl);
    if (!match) throw new Error("Unbekanntes Audiodatenformat");
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function dataUrlHash(dataUrl) {
    let hash = 2166136261;
    for (let index = 0; index < dataUrl.length; index++) hash = Math.imul(hash ^ dataUrl.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16);
  }

  function makeSound(context, buffer) {
    let audioContext;
    let gain;
    const result = {
      play(volume = 1) {
        gain.gain.setValueAtTime(volume, audioContext.currentTime);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        return new Promise(resolve => {
          source.onended = () => {
            source.disconnect();
            resolve();
          };
          source.start(0);
        });
      },
      rewire(nextContext) {
        gain?.disconnect();
        audioContext = nextContext;
        gain = audioContext.createGain();
        gain.connect(audioContext.destination);
      }
    };
    result.rewire(context);
    return result;
  }

  async function loadCustomSound(sound, name, fileName, dataUrl) {
    if (dataUrl.startsWith("chrome-extension://")) {
      await sound.load(name, dataUrl);
      return;
    }
    const cacheKey = `lfs-custom:${fileName}:${dataUrl.length}:${dataUrlHash(dataUrl)}`;
    let customSound = sound.sounds.get(cacheKey);
    if (!customSound) {
      const context = await sound.ctxPromise;
      const buffer = await context.decodeAudioData(dataUrlBytes(dataUrl));
      customSound = makeSound(context, buffer);
      sound.sounds.set(cacheKey, customSound);
    }
    sound.paths.set(name, cacheKey);
  }

  function playOverride(sound, originalPlay, name, volume) {
    const previousTheme = sound.theme;
    if (previousTheme === "silent") sound.theme = "standard";
    try {
      return originalPlay.call(sound, name, volume);
    } finally {
      sound.theme = previousTheme;
    }
  }

  function installSoundHook(sound) {
    if (!sound || patchedSounds.has(sound) || typeof sound.play !== "function") return;
    patchedSounds.add(sound);
    const originalPlay = sound.play;
    const originalMove = sound.move;

    sound.play = async function (name, volume = 1) {
      const setting = soundSettings[String(name).toLowerCase()];
      const multiplier = Math.max(0, Math.min(1, Number(setting?.volume ?? 100) / 100));
      const source = setting?.source || "website";
      const overrideName = `lfs:${name}:${source}`;

      if (isPageTransitionSound(name)) {
        const url = soundUrl(this, name);
        const masterVolume = Number(this.getVolume?.() ?? 1);
        if (url && masterVolume > 0 && multiplier > 0) {
          const played = await playAcrossNavigation(url, masterVolume * volume * multiplier);
          if (played) return;
        }
      }

      if (source.startsWith("custom:")) {
        const fileName = source.slice("custom:".length);
        const dataUrl = Object.hasOwn(customFiles, fileName) ? customFiles[fileName] : undefined;
        if (dataUrl) {
          try {
            await loadCustomSound(this, overrideName, fileName, dataUrl);
            return await playOverride(this, originalPlay, overrideName, volume * multiplier);
          } catch (error) {
            console.warn("Eigener Lichess-Sound konnte nicht geladen werden", error);
          }
        }
      } else if (source.startsWith("pack:")) {
        const pack = source.slice("pack:".length);
        const file = `${String(name)[0].toUpperCase()}${String(name).slice(1)}.mp3`;
        const path = this.url(`${pack}/${file}`);
        try {
          await this.load(overrideName, path);
          return await playOverride(this, originalPlay, overrideName, volume * multiplier);
        } catch (error) {
          console.warn(`Lichess-Soundpack ${pack} konnte nicht geladen werden`, error);
        }
      }

      return originalPlay.call(this, name, volume * multiplier);
    };

    if (typeof originalMove === "function") {
      sound.move = function (options) {
        if (this.theme !== "music" || options?.filter === "game") return originalMove.call(this, options);
        const eventNames = options?.name
          ? [options.name]
          : [options?.san?.includes("x") ? "capture" : "move"];
        if (!options?.name && options?.san?.includes("#")) eventNames.push("checkmate");
        else if (!options?.name && options?.san?.includes("+")) eventNames.push("check");

        const overrides = eventNames.filter(name => {
          const setting = soundSettings[String(name).toLowerCase()];
          return setting?.source && setting.source !== "website";
        });
        if (overrides.length) return Promise.all(overrides.map(name => this.play(name, options?.volume ?? 1)));

        const setting = soundSettings[String(eventNames[0]).toLowerCase()];
        const multiplier = Math.max(0, Math.min(1, Number(setting?.volume ?? 100) / 100));
        return originalMove.call(this, { ...options, volume: (options?.volume ?? 1) * multiplier });
      };
    }
    preloadPageTransitionSounds(sound);
  }

  function observeSite(site) {
    if (!site || typeof site !== "object") return;
    if (site.sound) installSoundHook(site.sound);
    const descriptor = Object.getOwnPropertyDescriptor(site, "sound");
    if (descriptor && !descriptor.configurable) return;

    let sound = descriptor?.get ? descriptor.get.call(site) : descriptor?.value;
    Object.defineProperty(site, "sound", {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: descriptor?.get ? () => descriptor.get.call(site) : () => sound,
      set(value) {
        if (descriptor?.set) descriptor.set.call(site, value);
        else sound = value;
        installSoundHook(value);
      }
    });
  }

  const siteDescriptor = Object.getOwnPropertyDescriptor(window, "site");
  if (!siteDescriptor || siteDescriptor.configurable) {
    let site = window.site;
    Object.defineProperty(window, "site", {
      configurable: true,
      enumerable: siteDescriptor?.enumerable ?? true,
      get: siteDescriptor?.get ? () => siteDescriptor.get.call(window) : () => site,
      set(value) {
        if (siteDescriptor?.set) siteDescriptor.set.call(window, value);
        else site = value;
        observeSite(value);
      }
    });
  }
  observeSite(window.site);

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.channel === channel) {
      soundSettings = event.data.settings && typeof event.data.settings === "object" ? event.data.settings : {};
      customFiles = { ...customFiles, ...(event.data.files && typeof event.data.files === "object" ? event.data.files : {}) };
      if (window.site?.sound) preloadPageTransitionSounds(window.site.sound);
    } else if (event.data?.channel === "lfs-sound-preview" && typeof event.data.name === "string") {
      const sound = window.site?.sound;
      if (!sound?.play) return;
      const key = event.data.name.toLowerCase();
      const settings = soundSettings;
      soundSettings = {
        ...settings,
        [key]: { source: event.data.source || "website", volume: event.data.volume ?? 100 }
      };
      const previousTheme = sound.theme;
      if (event.data.source?.startsWith("pack:") && sound.theme === "silent") sound.theme = "standard";
      const playback = sound.play(event.data.name);
      soundSettings = settings;
      const restoreTheme = () => {
        sound.theme = previousTheme;
      };
      Promise.resolve(playback).then(restoreTheme, restoreTheme);
    }
  });
})();
