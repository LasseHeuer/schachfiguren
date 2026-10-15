(() => {
  globalThis.LichessSoundCatalog = Object.freeze({
    packs: [
      { id: "standard", label: "Standard" },
      { id: "futuristic", label: "Futuristic" },
      { id: "lisp", label: "Lisp" },
      { id: "nes", label: "NES" },
      { id: "piano", label: "Piano" },
      { id: "robot", label: "Robot" },
      { id: "sfx", label: "SFX" },
      { id: "woodland", label: "Woodland" }
    ],
    customFiles: [
      "choose.wav",
      "death.wav",
      "energie_loop.wav",
      "loss.wav",
      "loss_01.wav",
      "loss_02.wav",
      "loss_03.wav",
      "loss_04.wav",
      "magic.wav",
      "set down.wav",
      "takes.wav",
      "win.wav"
    ],
    events: [
      ["genericNotify", "Allgemeine Benachrichtigung"],
      ["move", "Zug"],
      ["capture", "Schlag"],
      ["explosion", "Explosion"],
      ["lowTime", "Wenig Zeit"],
      ["victory", "Sieg"],
      ["defeat", "Niederlage"],
      ["draw", "Remis"],
      ["berserk", "Berserk"],
      ["check", "Schach"],
      ["checkmate", "Schachmatt"],
      ["newChallenge", "Neue Herausforderung"],
      ["newPM", "Neue Privatnachricht"],
      ["confirmation", "Bestaetigung"],
      ["error", "Fehler"],
      ["practiceComplete", "Uebung abgeschlossen", ["lisp"]],
      ["practiceWrong", "Uebungsfehler", []],
      ["tournament1st", "Turnier: 1. Platz"],
      ["tournament2nd", "Turnier: 2. Platz"],
      ["tournament3rd", "Turnier: 3. Platz"],
      ["tournamentOther", "Turnierergebnis"],
      ...Array.from({ length: 11 }, (_, count) => [`countDown${count}`, `Countdown ${count}`]),
      ["puzzleStormGood", "Puzzle Storm: richtig", ["lisp"]],
      ["puzzleStormEnd", "Puzzle Storm: Ende", ["lisp"]]
    ].map(([id, label, packs]) => ({ id, key: id.toLowerCase(), file: `${id[0].toUpperCase()}${id.slice(1)}`, label, packs }))
  });
})();
