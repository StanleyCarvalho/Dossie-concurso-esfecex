process.env.DATABASE_URL=process.env.DATABASE_URL||'postgresql://test:test@localhost:5432/test';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildWeeklySchedule}=require('../src/services/scheduleEngine');

const targets=[
  {discipline:'Programação',topic:'Linguagem C',score:90},
  {discipline:'Língua Portuguesa',topic:'Interpretação de Textos',score:88},
  {discipline:'Redes de Computadores',topic:'TCP/IP',score:87},
  {discipline:'História',topic:'História do Brasil República',score:86},
  {discipline:'Geografia',topic:'Domínios Morfoclimáticos',score:85},
  {discipline:'Sistemas Operacionais',topic:'Linux',score:84},
  {discipline:'Banco de Dados',topic:'SQL',score:83},
  {discipline:'Arquitetura de Computadores',topic:'RAID',score:82},
  {discipline:'Gerência de Projetos',topic:'PMBOK',score:81},
  {discipline:'Engenharia de Software',topic:'UML',score:80}
];
function disciplines(schedule,day){return schedule.blocks.filter(b=>b.day===day).map(b=>b.discipline);}

test('distribui disciplinas conforme o planejamento semanal ESFCEx',()=>{
  const schedule=buildWeeklySchedule({targets,editalTopics:[],days:['mon','tue','wed','thu','fri','sat'],hoursPerDay:6,adaptiveSignals:[]});
  assert.deepEqual(disciplines(schedule,'mon'),['Programação','Língua Portuguesa']);
  assert.equal(disciplines(schedule,'tue')[0],'Redes de Computadores');
  assert.match(disciplines(schedule,'tue')[1],/História|Geografia/);
  assert.deepEqual(disciplines(schedule,'wed'),['Sistemas Operacionais','Banco de Dados']);
  assert.equal(disciplines(schedule,'thu')[0],'Programação');
  assert.equal(disciplines(schedule,'thu')[1],'Língua Portuguesa');
  assert.equal(disciplines(schedule,'fri')[0],'Arquitetura de Computadores');
  assert.match(disciplines(schedule,'fri')[1],/Gerência de Projetos|Engenharia de Software/);
});

test('cada bloco mantém 2h de estudo e 1h de questões',()=>{
  const schedule=buildWeeklySchedule({targets,editalTopics:[],days:['mon'],hoursPerDay:6,adaptiveSignals:[]});
  assert.equal(schedule.blocks.length,2);
  for(const block of schedule.blocks){assert.equal(block.minutes,180);assert.equal(block.studyMinutes,120);assert.equal(block.questionMinutes,60);}
});