(() => {
  if (location.pathname !== '/plano-estudos') return;

  const pct = value => `${Math.max(0, Math.min(100, Number(value || 0)))}%`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  async function toggleOverdue(id, button) {
    button.disabled = true;
    try {
      const response = await fetch(`/plano-estudos/checklist/${id}`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({completed:true})
      });
      const data = await response.json();
      if (data.ok) location.reload();
    } finally { button.disabled = false; }
  }

  function explainSchedule() {
    document.querySelectorAll('.schedule-block').forEach(block => {
      if (block.querySelector('.recommendation-reason')) return;
      const tags = block.querySelector('.tags-line')?.textContent || '';
      const topic = block.querySelector('.topic-line')?.textContent?.trim() || 'este assunto';
      const exec = Number((tags.match(/exec\.\s*(\d+)%/i)||[])[1]);
      const accuracy = Number((tags.match(/acertos\s*(\d+)%/i)||[])[1]);
      const reasons=[];
      if (Number.isFinite(exec) && exec < 70) reasons.push(`execução recente baixa (${exec}%)`);
      if (Number.isFinite(accuracy) && accuracy < 70) reasons.push(`acurácia baixa nas questões (${accuracy}%)`);
      if (/EDITAL/i.test(tags)) reasons.push('conteúdo obrigatório do edital');
      if (!reasons.length) reasons.push('recorrência histórica e posição atual no ciclo');
      const p=document.createElement('p');
      p.className='recommendation-reason';
      p.innerHTML=`<strong>Por que estudar ${esc(topic)}:</strong> ${reasons.map(esc).join(' + ')}.`;
      block.querySelector('div:last-child')?.appendChild(p);
    });
  }

  async function loadMomentum() {
    explainSchedule();
    try {
      const response = await fetch('/api/plano-estudos/momentum', {headers:{Accept:'application/json'}});
      if (!response.ok) return;
      const {momentum, overdue=[]} = await response.json();
      const planner=document.querySelector('.planner-card');
      if (!planner || document.querySelector('[data-study-momentum]')) return;

      const delta=Number(momentum.delta||0);
      const section=document.createElement('section');
      section.className='section-gap';
      section.dataset.studyMomentum='1';
      section.innerHTML=`
        <div class="section-title-row"><div><span class="eyebrow">Evolução semanal</span><h2>Ritmo e recuperação</h2></div><span class="muted small">A semana seguinte usa estes sinais para se recalibrar</span></div>
        <div class="momentum-grid">
          <article class="card momentum-card"><span class="eyebrow">Semana atual</span><strong>${pct(momentum.currentRate)}</strong><p>${momentum.current_done||0}/${momentum.current_planned||0} etapas concluídas</p></article>
          <article class="card momentum-card"><span class="eyebrow">Comparação</span><strong class="${delta>=0?'trend-up':'trend-down'}">${delta>=0?'+':''}${delta} p.p.</strong><p>vs. ${pct(momentum.previousRate)} na semana anterior</p></article>
          <article class="card momentum-card"><span class="eyebrow">Sequência</span><strong>${Number(momentum.streak||0)} dia(s)</strong><p>dias consecutivos com estudo registrado</p></article>
          <article class="card momentum-card"><span class="eyebrow">Recuperação</span><strong>${Number(momentum.overdue||0)}</strong><p>etapas atrasadas que reforçam a próxima agenda</p></article>
        </div>
        ${overdue.length ? `<div class="card overdue-card"><div class="section-title-row"><div><span class="eyebrow">Fila de recuperação</span><h3>Pendências mais antigas</h3></div><span class="tag">${overdue.length} exibidas</span></div><div class="overdue-list">${overdue.map(item=>`<article class="overdue-item"><div><strong>${esc(item.microtopic)}</strong><span>${esc(item.discipline)} · ${esc(item.topic)} · ${esc(item.task_type)} · ${esc(item.study_date)}</span></div><div class="overdue-actions">${item.resource_url?`<a href="${esc(item.resource_url)}" target="_blank" rel="noopener">Material ↗</a>`:''}<button class="btn secondary" type="button" data-overdue-id="${item.id}">Concluir</button></div></article>`).join('')}</div></div>` : ''}
      `;
      planner.parentNode.insertBefore(section, planner);
      section.querySelectorAll('[data-overdue-id]').forEach(btn=>btn.addEventListener('click',()=>toggleOverdue(btn.dataset.overdueId,btn)));
    } catch (_) {}
  }

  loadMomentum();
})();
