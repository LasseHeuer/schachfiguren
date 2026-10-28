(() => {
  function materialAdvantage(topText, bottomText, blackAtBottom) {
    const score = text => Number(String(text ?? "").match(/\+\s*(\d+)/)?.[1] ?? 0);
    const top = score(topText);
    const bottom = score(bottomText);
    return blackAtBottom ? top - bottom : bottom - top;
  }

  globalThis.LichessZenBackground = { materialAdvantage };
  if (typeof document === "undefined" || typeof chrome === "undefined" || !chrome.storage) return;

  const keys = ["enabled", "whitePieceColor", "blackPieceColor", "zenBackgroundEnabled", "zenBackgroundTintPercent"];
  let values = {};
  let settings = globalThis.LichessSettings.normalize(values);
  let background;

  function updateMaterial() {
    const board = document.querySelector("[data-lfs-zen-board]");
    const root = board?.closest(".round__app, .analyse__board, .analyse, .bot-game, .puzzle, .study__main, .study, main") ?? board?.parentElement;
    const materials = root ? [...root.querySelectorAll(".material")] : [];
    const top = materials.find(element => element.classList.contains("material-top")) ?? materials[0];
    const bottom = materials.find(element => element.classList.contains("material-bottom")) ?? materials.find(element => element !== top);
    const blackAtBottom = board?.querySelector(".cg-wrap")?.classList.contains("orientation-black")
      ?? board?.classList.contains("orientation-black") ?? false;
    const advantage = materialAdvantage(top?.textContent, bottom?.textContent, blackAtBottom);
    if (!advantage || !settings.zenBackgroundTintPercent) {
      background.style.backgroundColor = "transparent";
      return;
    }
    const playerColor = advantage > 0
      ? blackAtBottom ? settings.blackPieceColor : settings.whitePieceColor
      : blackAtBottom ? settings.whitePieceColor : settings.blackPieceColor;
    const ratio = Math.min(1, Math.abs(advantage) / 4);
    const mix = settings.zenBackgroundTintPercent * ratio;
    background.style.backgroundColor = `color-mix(in srgb, var(--c-bg-page, var(--c-bg, #fff)) ${100 - mix}%, ${playerColor} ${mix}%)`;
  }

  function sync() {
    if (!settings.enabled || !settings.zenBackgroundEnabled || !document.documentElement.hasAttribute("data-lfs-zen-mode")) {
      if (background) background.hidden = true;
      return;
    }
    if (!background) {
      background = document.createElement("div");
      background.id = "lfs-zen-background";
      background.setAttribute("aria-hidden", "true");
      document.documentElement.append(background);
    }
    background.hidden = false;
    updateMaterial();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !keys.some(key => key in changes)) return;
    for (const key of keys) if (key in changes) values[key] = changes[key].newValue;
    settings = globalThis.LichessSettings.normalize(values);
    sync();
  });
  chrome.storage.local.get(keys, stored => {
    values = { ...stored, ...values };
    settings = globalThis.LichessSettings.normalize(values);
    sync();
  });
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target === document.documentElement && record.type === "attributes"
      || record.target.nodeType === 1 && record.target.closest?.(".material")
      || record.target.parentElement?.closest(".material")
      || record.type === "attributes" && record.target.matches?.(".cg-wrap")
      || record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
        && (node.matches(".material, [data-lfs-zen-board]") || node.querySelector(".material, [data-lfs-zen-board]"))))) sync();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-lfs-zen-mode", "class"], childList: true, characterData: true, subtree: true });
})();
