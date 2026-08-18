const DAY_LABELS = {
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
  sun: 'Domingo'
};

function normalizeDays(days) {
  const value = Array.isArray(days) ? days : (days ? [days] : []);
  return value.filter(day => DAY_LABELS[day]);
}

function buildWeeklySchedule({ targets, days, hoursPerDay }) {
  const studyDays = normalizeDays(days);
  const hours = Math.max(0.5, Math.min(12, Number(hoursPerDay) || 2));
  const totalWeeklyMinutes = Math.round(studyDays.length * hours * 60);

  if (studyDays.length === 0 || targets.length === 0) {
    return { studyDays, hoursPerDay: hours, totalWeeklyMinutes: 0, blocks: [], summary: [] };
  }

  const activeTargets = targets
    .filter(target => (target.progress || 0) < 100)
    .slice(0, Math.max(8, studyDays.length * 3));
  const scoreTotal = activeTargets.reduce((sum, target) => sum + Math.max(1, target.score || 1), 0) || 1;
  const blocks = [];

  for (const day of studyDays) {
    let remaining = Math.round(hours * 60);
    let cursor = blocks.length % activeTargets.length;

    while (remaining >= 30 && activeTargets.length > 0) {
      const target = activeTargets[cursor % activeTargets.length];
      const weightedMinutes = Math.round((Math.max(1, target.score || 1) / scoreTotal) * totalWeeklyMinutes);
      const suggested = Math.max(35, Math.min(90, weightedMinutes));
      const minutes = Math.min(remaining, suggested);

      blocks.push({
        day,
        dayLabel: DAY_LABELS[day],
        minutes,
        discipline: target.discipline,
        topic: target.topic,
        score: target.score,
        confidence: target.confidence,
        source: target.source,
        sourceUrl: target.sourceUrl,
        progress: target.progress || 0,
        tasks: [
          `Videoaula focada: ${target.topic}`,
          'Resumo de 8 a 12 linhas',
          'Questões reais da disciplina',
          'Registrar erros e atualizar progresso'
        ]
      });

      remaining -= minutes;
      cursor++;
    }
  }

  const summaryMap = new Map();
  for (const block of blocks) {
    const key = `${block.discipline}||${block.topic}`;
    const current = summaryMap.get(key) || { discipline: block.discipline, topic: block.topic, minutes: 0, score: block.score };
    current.minutes += block.minutes;
    summaryMap.set(key, current);
  }

  return {
    studyDays,
    hoursPerDay: hours,
    totalWeeklyMinutes,
    blocks,
    summary: [...summaryMap.values()].sort((a, b) => b.minutes - a.minutes)
  };
}

module.exports = { buildWeeklySchedule, DAY_LABELS };
