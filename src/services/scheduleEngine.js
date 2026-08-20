const DAY_LABELS = {
  mon: 'Segunda', tue: 'Terça', wed: 'Quarta', thu: 'Quinta', fri: 'Sexta', sat: 'Sábado', sun: 'Domingo'
};

function normalizeDays(days) {
  const value = Array.isArray(days) ? days : (days ? [days] : []);
  return value.filter(day => DAY_LABELS[day]);
}

function norm(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function topicKey(discipline, topic) {
  return `${norm(discipline)}||${norm(topic)}`;
}

function buildStudyQueue({ targets = [], editalTopics = [] }) {
  const byKey = new Map();
  for (const target of targets) {
    const key = topicKey(target.discipline, target.topic);
    byKey.set(key, {
      ...target,
      sourceType: 'historico',
      priority: Number(target.score || target.priority_score || 50),
      editalRequired: false
    });
  }

  for (const item of editalTopics) {
    const key = topicKey(item.discipline, item.topic);
    const existing = byKey.get(key);
    if (existing) {
      existing.editalRequired = true;
      existing.sourceType = 'edital+historico';
      existing.priority = Math.min(100, Math.max(existing.priority, 65 + (Number(item.weight || 1) * 10)));
      existing.editalReference = item.reference_text || item.subtopic || null;
    } else {
      byKey.set(key, {
        discipline: item.discipline,
        topic: item.topic,
        progress: 0,
        score: 60 + (Number(item.weight || 1) * 10),
        priority: 60 + (Number(item.weight || 1) * 10),
        confidence: 'EDITAL',
        sourceType: 'edital',
        editalRequired: true,
        editalReference: item.reference_text || item.subtopic || null,
        source: 'Conteúdo oficial do edital',
        sourceUrl: `/treino?discipline=${encodeURIComponent(item.discipline)}&topic=${encodeURIComponent(item.topic)}`,
        checklist: []
      });
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const aDone = Number(a.progress || 0) >= 100 ? 1 : 0;
    const bDone = Number(b.progress || 0) >= 100 ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.editalRequired !== b.editalRequired) return a.editalRequired ? -1 : 1;
    return Number(b.priority || 0) - Number(a.priority || 0);
  });
}

function buildDailyTasks(target, minutes) {
  const learning = Math.max(20, Math.round(minutes * 0.48));
  const questions = Math.max(15, Math.round(minutes * 0.32));
  const review = Math.max(10, minutes - learning - questions);
  return [
    `Teoria/videoaula focada em ${target.topic} (${learning} min)`,
    `Resolver questões do assunto (${questions} min)`,
    `Corrigir erros + revisão ativa (${review} min)`,
    'Registrar progresso e erros na plataforma'
  ];
}

function buildWeeklySchedule({ targets = [], editalTopics = [], days, hoursPerDay }) {
  const studyDays = normalizeDays(days);
  const hours = Math.max(0.5, Math.min(12, Number(hoursPerDay) || 2));
  const totalWeeklyMinutes = Math.round(studyDays.length * hours * 60);
  const queue = buildStudyQueue({ targets, editalTopics });
  const pending = queue.filter(item => Number(item.progress || 0) < 100);

  const totalEdital = queue.filter(item => item.editalRequired).length;
  const editalDone = queue.filter(item => item.editalRequired && Number(item.progress || 0) >= 100).length;
  const editalCoverage = totalEdital ? Math.round((editalDone / totalEdital) * 100) : 0;

  if (!studyDays.length || !pending.length) {
    return { studyDays, hoursPerDay: hours, totalWeeklyMinutes: 0, blocks: [], summary: [], queue, totalEdital, editalDone, editalCoverage, weeksToCover: 0 };
  }

  const minBlock = 35;
  const maxBlock = 90;
  const maxBlocks = Math.max(studyDays.length, Math.floor(totalWeeklyMinutes / minBlock));
  const weekTargets = pending.slice(0, maxBlocks);
  const blocks = [];
  let cursor = 0;

  for (const day of studyDays) {
    let remaining = Math.round(hours * 60);
    let slotsLeft = Math.max(1, Math.ceil((weekTargets.length - cursor) / Math.max(1, studyDays.length - studyDays.indexOf(day))));

    while (remaining >= minBlock && cursor < weekTargets.length) {
      const target = weekTargets[cursor++];
      const ideal = Math.round(remaining / slotsLeft);
      const minutes = Math.max(minBlock, Math.min(maxBlock, ideal, remaining));
      blocks.push({
        day,
        dayLabel: DAY_LABELS[day],
        minutes,
        discipline: target.discipline,
        topic: target.topic,
        score: target.priority || target.score || 50,
        confidence: target.confidence || (target.editalRequired ? 'EDITAL' : 'HISTÓRICO'),
        source: target.source || 'Material focado do assunto',
        sourceUrl: target.sourceUrl || `/treino?discipline=${encodeURIComponent(target.discipline)}&topic=${encodeURIComponent(target.topic)}`,
        progress: Number(target.progress || 0),
        editalRequired: !!target.editalRequired,
        sourceType: target.sourceType,
        tasks: buildDailyTasks(target, minutes)
      });
      remaining -= minutes;
      slotsLeft = Math.max(1, slotsLeft - 1);
    }
  }

  const summaryMap = new Map();
  for (const block of blocks) {
    const key = topicKey(block.discipline, block.topic);
    const current = summaryMap.get(key) || { discipline: block.discipline, topic: block.topic, minutes: 0, score: block.score, editalRequired: block.editalRequired };
    current.minutes += block.minutes;
    summaryMap.set(key, current);
  }

  const capacityPerWeek = Math.max(1, blocks.length);
  const weeksToCover = Math.ceil(pending.length / capacityPerWeek);

  return {
    studyDays,
    hoursPerDay: hours,
    totalWeeklyMinutes,
    blocks,
    summary: [...summaryMap.values()].sort((a, b) => b.minutes - a.minutes),
    queue,
    totalEdital,
    editalDone,
    editalCoverage,
    weeksToCover,
    pendingTopics: pending.length,
    scheduledTopics: new Set(blocks.map(b => topicKey(b.discipline, b.topic))).size
  };
}

module.exports = { buildWeeklySchedule, buildStudyQueue, DAY_LABELS };
