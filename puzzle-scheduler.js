(() => {
  const weights = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
  const day = 24 * 60 * 60 * 1000;
  const minute = 60 * 1000;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function initialDifficulty(rating) {
    return clamp(weights[4] - Math.exp(weights[5] * (rating - 1)) + 1, 1, 10);
  }

  function retrievability(elapsedDays, stability) {
    const factor = Math.pow(0.9, -1 / weights[20]) - 1;
    return Math.pow(1 + factor * elapsedDays / stability, -weights[20]);
  }

  function intervalDays(stability, retention = 0.9) {
    const factor = Math.pow(0.9, -1 / weights[20]) - 1;
    return stability / factor * (Math.pow(retention, -1 / weights[20]) - 1);
  }

  function schedule(card, rating, now = Date.now()) {
    const grade = clamp(Math.round(rating), 1, 4);
    const previousStability = Number(card.stability);
    const previousDifficulty = Number(card.difficulty);
    const hasMemory = Number.isFinite(previousStability) && previousStability > 0
      && Number.isFinite(previousDifficulty) && previousDifficulty > 0;
    const elapsedDays = hasMemory && Number.isFinite(card.lastReviewedAt)
      ? Math.max(0, (now - card.lastReviewedAt) / day)
      : 0;

    let stability;
    let difficulty;
    if (!hasMemory) {
      stability = weights[grade - 1];
      difficulty = initialDifficulty(grade);
    } else {
      const recall = retrievability(elapsedDays, previousStability);
      const nextDifficulty = previousDifficulty - weights[6] * (grade - 3) * (10 - previousDifficulty) / 9;
      difficulty = clamp(weights[7] * initialDifficulty(4) + (1 - weights[7]) * nextDifficulty, 1, 10);

      if (grade === 1) {
        stability = weights[11] * Math.pow(difficulty, -weights[12])
          * (Math.pow(previousStability + 1, weights[13]) - 1)
          * Math.exp(weights[14] * (1 - recall));
      } else if (elapsedDays < 1) {
        const increase = Math.exp(weights[17] * (grade - 3 + weights[18]))
          * Math.pow(previousStability, -weights[19]);
        stability = previousStability * Math.max(1, increase);
      } else {
        const difficultyFactor = 11 - difficulty;
        const stabilityFactor = Math.pow(previousStability, -weights[9]);
        const recallFactor = Math.exp(weights[10] * (1 - recall)) - 1;
        const ratingFactor = grade === 2 ? weights[15] : grade === 4 ? weights[16] : 1;
        stability = previousStability * (1 + Math.exp(weights[8]) * difficultyFactor * stabilityFactor * recallFactor * ratingFactor);
      }
    }

    stability = clamp(Number.isFinite(stability) ? stability : 0.1, 0.1, 3650);
    const delay = grade === 1 ? 10 * minute : clamp(intervalDays(stability), 10 / (24 * 60), 3650) * day;
    const isLearning = card.state === "new" || card.state === "learning" || !card.state;

    return {
      ...card,
      state: grade === 1 ? "learning" : "review",
      stability,
      difficulty,
      dueAt: now + delay,
      lastReviewedAt: now,
      lastRating: grade,
      reps: (Number.isInteger(card.reps) ? card.reps : 0) + 1,
      lapses: (Number.isInteger(card.lapses) ? card.lapses : 0) + (grade === 1 && !isLearning ? 1 : 0),
    };
  }

  globalThis.LichessPuzzleScheduler = { day, intervalDays, schedule };
})();
