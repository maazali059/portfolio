/* ============================================================
   ENERGYNEX — APP CORE
   ============================================================ */
const STATE = {
  inp: defaultInputs(),
  candidate: defaultCandidate(),
  phase: 1, step: 'site', tab2: 'architecture',
  decisionResults: null,
  activeArchName: null,
  scenarios: [],
  dispatchDay: 172,
  editingScenarioId: null,
  vehAdvancedOpen:false,
};

/* ---------- dot/bracket path get/set, e.g. "inp.procState.grid.slots[1].rate" ---------- */
function pathParts(p){ return p.replace(/\[(\d+)\]/g,'.$1').split('.'); }
function getPath(obj, p){ return pathParts(p).reduce((o,k)=> (o==null?undefined:o[k]), obj); }
function setPath(obj, p, val){
  const parts = pathParts(p); const last = parts.pop();
  const target = parts.reduce((o,k)=> (o[k]==null? (o[k]={}) : o[k]), obj);
  target[last]=val;
}
function coerce(raw, type){
  if(type==='number') return raw===''? null : parseFloat(raw);
  if(type==='checkbox') return !!raw;
  return raw;
}

/* ---------- recompute pipeline (cheap enough to run on every render) ---------- */
function computeAll(){
  const inp = STATE.inp;
  const units = getUnitShapes(inp);
  const baseDemand = getBaseDemand8760(inp);
  const gridCapMW = gridCapacityMW(inp, inp.g_upgrade_avail);
  const ev = evaluateCandidateSteadyState(inp, units, baseDemand, STATE.candidate, gridCapMW);
  const finExact = computeExactMultiYearFinancing(inp, units, baseDemand, STATE.candidate, gridCapMW);
  return {units, baseDemand, gridCapMW, ev, finExact};
}

/* ---------- generic delegated event wiring (bind once) ---------- */
function initDelegation(){
  const root = document.getElementById('app'); // covers header, phase nav, summary bar AND mainContent
  const handle = (e, committing) => {
    const el = e.target.closest('[data-bind]');
    if(!el) return;
    const path = el.getAttribute('data-bind');
    const type = el.getAttribute('data-type') || (el.type==='checkbox'?'checkbox':el.tagName==='SELECT'?'select':el.type==='number'||el.type==='range'?'number':'text');
    let val = type==='checkbox' ? el.checked : el.value;
    val = coerce(val, type);
    setPath(STATE, path, val);
    const liveLabel = el.closest('label.field')?.querySelector('.fval');
    if(liveLabel && el.type==='range') liveLabel.textContent = el.getAttribute('data-suffix') ? val+el.getAttribute('data-suffix') : val;
    if(committing) rerenderCurrent();
  };
  root.addEventListener('input', e=>{
    const el = e.target.closest('[data-bind]');
    if(el && el.type==='range') handle(e, false);
  });
  root.addEventListener('change', e=> handle(e, true));
  root.addEventListener('click', e=>{
    const el = e.target.closest('[data-action]');
    if(!el) return;
    const attr = el.getAttribute('data-action');
    const idx = attr.indexOf(':');
    const fn = idx<0 ? attr : attr.slice(0,idx);
    const arg = idx<0 ? undefined : attr.slice(idx+1);
    if(typeof window[fn]==='function') window[fn](arg, el);
  });
}
let renderDebounce=null;
function rerenderCurrent(){
  clearTimeout(renderDebounce);
  renderDebounce = setTimeout(()=>{ render(); }, 0);
}

/* ---------- chrome: header + nav ---------- */
function renderHeader(){
  const ev = STATE._cache ? STATE._cache.ev : null;
  document.getElementById('appHeader').innerHTML = `
    <div class="brand" ${STATE.phase===2?'data-action="leavePhase2ToPhase1" style="cursor:pointer" title="Back to Phase 1 (will offer to save first)"':''}>
      <span class="brand-mark">${brandMark()}</span>
      ENERGYNEX <span class="brand-sub">Charging Infrastructure Energy &amp; Investment Planner</span>
    </div>
    <div class="spacer"></div>
    ${STATE.phase===2 && ev ? `
    <div class="headerStat"><div class="v">${fmt(ev.renShare,0)}%</div><div class="l">Renewable share</div></div>
    <div class="headerStat"><div class="v">₹${fmt(ev.landedCostPerKWh,2)}</div><div class="l">Landed ₹/kWh</div></div>
    ` : ''}
    <button class="btn ghost" data-action="resetApp">Reset</button>
  `;
}
function brandMark(){
  return `<svg viewBox="0 0 20 20"><polygon points="11,1 3,11 9,11 8,19 17,8 11,8" fill="var(--accent)"/></svg>`;
}

const PHASE1_STEPS = [
  {k:'site', n:1, label:'Site', sub:'Location & connection'},
  {k:'energy', n:2, label:'Energy', sub:'Load & targets'},
  {k:'decision', n:3, label:'Decision', sub:'Recommended architecture'},
];
function renderPhase1Nav(){
  const idx = PHASE1_STEPS.findIndex(s=>s.k===STATE.step);
  document.getElementById('phase1Nav').innerHTML = PHASE1_STEPS.map((s,i)=>`
    <div class="stepTab ${s.k===STATE.step?'active':''} ${i<idx?'done':''}" data-action="gotoStep:${s.k}">
      <span class="num">${i<idx?'✓':s.n}</span>
      <span><span class="label">${s.label}</span><br/><span class="sub">${s.sub}</span></span>
    </div>`).join('');
  document.getElementById('phase1Nav').classList.remove('hidden');
  document.getElementById('phase2Nav').classList.add('hidden');
  document.getElementById('archSummary').classList.add('hidden');
}
const PHASE2_TABS = [
  {k:'architecture', label:'Architecture'},
  {k:'dispatch', label:'Dispatch'},
  {k:'economics', label:'Economics'},
  {k:'finance', label:'Finance'},
  {k:'scenarios', label:'Scenarios'},
];
function renderPhase2Nav(){
  document.getElementById('phase2Nav').innerHTML = PHASE2_TABS.map(t=>`
    <div class="wsTab ${t.k===STATE.tab2?'active':''}" data-action="gotoTab2:${t.k}">${t.label}</div>`).join('')
    + `<div class="wsTab" style="margin-left:auto;color:var(--text-faint)" data-action="leavePhase2ToPhase1">← Back to Phase 1</div>`;
  document.getElementById('phase2Nav').classList.remove('hidden');
  document.getElementById('phase1Nav').classList.add('hidden');
  document.getElementById('archSummary').classList.remove('hidden');
}
function renderArchSummary(){
  const {ev, finExact} = STATE._cache;
  const name = architectureNameOf(ev);
  document.getElementById('archSummary').innerHTML = `
    <div class="archName" title="${name}">${name}</div>
    <div class="sumKpi"><div class="v">${fmt(ev.renShare,0)}%</div><div class="l">Renewable share</div></div>
    <div class="sumKpi"><div class="v">₹${fmt(ev.landedCostPerKWh,2)}</div><div class="l">Landed cost/kWh</div></div>
    <div class="sumKpi"><div class="v">${irrLabel(finExact.projectIRR)}</div><div class="l">Project IRR</div></div>
    <div class="sumKpi"><div class="v">${irrLabel(finExact.equityIRR)}</div><div class="l">Equity IRR</div></div>
    <div class="sumKpi"><div class="v">${isNaN(finExact.avgDSCR)?'—':fmt(finExact.avgDSCR,2)+'x'}</div><div class="l">Avg DSCR</div></div>
    <div class="scenarioPicker">
      <select data-bind="inp.scenario" data-type="select" style="width:auto;min-width:150px;">
        ${Object.entries(scenarioPresets).map(([k,v])=>`<option value="${k}" ${STATE.inp.scenario===k?'selected':''}>${v.label}</option>`).join('')}
      </select>
      <button class="btn sm" data-action="saveScenario">+ Save scenario</button>
    </div>
  `;
}

/* ---------- top-level render dispatcher ---------- */
function render(){
  STATE._cache = (STATE.phase===2) ? computeAll() : null;
  renderHeader();
  if(STATE.phase===1){
    renderPhase1Nav();
    const root = document.getElementById('mainContent');
    if(STATE.step==='site') root.innerHTML = viewSite();
    else if(STATE.step==='energy') root.innerHTML = viewEnergy();
    else root.innerHTML = viewDecision();
  } else {
    renderPhase2Nav();
    renderArchSummary();
    const root = document.getElementById('mainContent');
    if(STATE.tab2==='architecture') root.innerHTML = viewArchitecture();
    else if(STATE.tab2==='dispatch') root.innerHTML = viewDispatch();
    else if(STATE.tab2==='economics') root.innerHTML = viewEconomics();
    else if(STATE.tab2==='finance') root.innerHTML = viewFinance();
    else root.innerHTML = viewScenarios();
  }
}

/* ---------- nav actions ---------- */
function gotoStep(step){ STATE.phase=1; STATE.step = step; window.scrollTo(0,0); render(); }
function leavePhase2ToPhase1(){
  if(STATE.phase===2){
    const wantSave = confirm('Save this architecture as a scenario before returning to Phase 1?\n\nOK — save it, then go back\nCancel — go back without saving');
    if(wantSave){
      const {ev} = STATE._cache || computeAll();
      const name = prompt('Scenario name', architectureNameOf(ev)+' — '+scenarioPresets[STATE.inp.scenario].label);
      if(name) STATE.scenarios.push({ id:Date.now(), name, inp:JSON.parse(JSON.stringify(STATE.inp)), candidate:JSON.parse(JSON.stringify(STATE.candidate)), ts:new Date().toLocaleString('en-IN') });
    }
  }
  gotoStep('decision');
}
function gotoTab2(tab){ STATE.tab2 = tab; window.scrollTo(0,0); render(); }
function resetApp(){ if(!confirm('Reset all inputs and start over?')) return; Object.assign(STATE, {inp:defaultInputs(), candidate:defaultCandidate(), phase:1, step:'site', tab2:'architecture', decisionResults:null}); render(); }
function enterPhase2(fromCandidate){
  if(fromCandidate) STATE.candidate = {...fromCandidate};
  STATE.phase=2; STATE.tab2='architecture'; window.scrollTo(0,0); render();
}

document.addEventListener('DOMContentLoaded', ()=>{
  initDelegation();
  render();
});
