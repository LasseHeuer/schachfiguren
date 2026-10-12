(() => {
  new MutationObserver(records => {
    for (const record of records) {
      const piece = record.target;
      if (piece.localName !== "piece" || piece.parentElement?.localName !== "cg-board") continue;

      const key = piece.classList.contains("anim") ? piece.cgKey : null;
      if (typeof key === "string") piece.setAttribute("data-lfs-move-key", key);
      else piece.removeAttribute("data-lfs-move-key");
    }
  }).observe(document, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true
  });
})();
