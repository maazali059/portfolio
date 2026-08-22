/* ============================================================
   PHASE 2 — FINANCE
   ============================================================ */
function viewFinance(){
  const inp = STATE.inp, {ev, finExact:f} = STATE._cache;
  const capexParts = [
    ['Solar', ev.candidate.solarMW>0? genEngine(ev.candidate.solarMW, inp.s_capex,0,1,0).capexCr:0, 'var(--c-solar)'],
    ['Wind', ev.candidate.windMW>0? genEngine(ev.candidate.windMW, inp.w_capex,0,1,0).capexCr:0, 'var(--c-wind)'],
    ['Group Captive (equity)', f.gcMyEquityCapexCr, 'var(--c-gc)'],
    ['BESS', f.bessCapexCr, 'var(--c-bess)'],
    ['Site / charger / grid connection', f.siteCapexCr, 'var(--text-dim)'],
  ];
  const years = f.rows.map(r=>'Y'+r.y);
  const revOpexSeries = [
    {name:'Revenue', data:f.rows.map(r=>r.rev), color:'var(--good)'},
    {name:'Opex', data:f.rows.map(r=>-r.opex), color:'var(--bad)'},
  ];
  const dscrLine = [{name:'DSCR', data:f.rows.map(r=>r.dscr), color:'var(--accent)'}];
  return `
  <h2 class="sectionTitle">Finance</h2>
  <p class="sectionDesc">CAPEX, financing structure and 15-year cash flow for the selected architecture at ${inp.f_debt}% debt / ${100-inp.f_debt}% equity, ${fmt(inp.f_rate,1)}% cost of debt over ${inp.f_tenor} years.</p>
  <div class="colsAuto" style="margin-bottom:18px;">
    <div class="kpi"><div class="kv">₹${fmt(f.totalCapexCr,1)}<span class="unit">Cr</span></div><div class="kl">Total CAPEX</div></div>
    <div class="kpi"><div class="kv">${irrLabel(f.projectIRR)}</div><div class="kl">Project IRR</div><div class="ksub">hurdle ${fmt(inp.f_hurdle,1)}%</div></div>
    <div class="kpi ${f.equityIRR>=inp.f_targetirr?'good':'warn'}"><div class="kv">${irrLabel(f.equityIRR)}</div><div class="kl">Equity IRR</div><div class="ksub">target ${fmt(inp.f_targetirr,1)}%</div></div>
    <div class="kpi"><div class="kv">₹${fmt(f.npvEquity,1)}<span class="unit">Cr</span></div><div class="kl">Equity NPV</div></div>
    <div class="kpi"><div class="kv">${isNaN(f.payback)?'—':fmt(f.payback,1)+'y'}</div><div class="kl">Equity payback</div></div>
    <div class="kpi ${f.dscrOK?'good':'bad'}"><div class="kv">${isNaN(f.avgDSCR)?'—':fmt(f.avgDSCR,2)+'x'}</div><div class="kl">Average DSCR</div><div class="ksub">min covenant ${fmt(inp.f_mindscr,2)}x</div></div>
  </div>
  <div class="cols2">
    <div class="card">
      <div class="cardHead"><h3>CAPEX breakdown</h3><span class="hint">₹ Cr</span></div>
      <div class="chartWrap">${stackedBarChart({categories:['Total'], series:capexParts.map(([n,v,c])=>({name:n,data:[v],color:c})), height:220})}</div>
      <div class="candLegend" style="margin-top:8px;">${capexParts.map(([n,v,c])=>`<span><span class="dot" style="background:${c}"></span> ${n}: ₹${fmt(v,1)} Cr</span>`).join('')}</div>
    </div>
    <div class="card">
      <div class="cardHead"><h3>Financing structure</h3></div>
      <table class="dataTable">
        <tr><td>Debt (${inp.f_debt}%)</td><td class="num">₹${fmt(f.debtCr,1)} Cr</td></tr>
        <tr><td>Equity (${100-inp.f_debt}%)</td><td class="num">₹${fmt(f.equityCr,1)} Cr</td></tr>
        <tr><td>Cost of debt</td><td class="num">${fmt(inp.f_rate,2)}%</td></tr>
        <tr><td>Tenor</td><td class="num">${inp.f_tenor} yrs</td></tr>
        <tr><td>Depreciation rate</td><td class="num">${fmt(inp.f_dep,1)}%</td></tr>
        <tr><td>Tax rate</td><td class="num">${fmt(inp.f_tax,1)}%</td></tr>
        ${f.replacementYear?`<tr><td>BESS replacement</td><td class="num">Year ${f.replacementYear}, ₹${fmt(f.replacementCapexCr,2)} Cr</td></tr>`:''}
      </table>
      <details class="advanced" style="margin-top:10px;"><summary>Financing assumptions</summary>
        <div class="row" style="margin-top:10px;">
          <label class="field"><div class="flabel"><span>Debt share</span><span class="fval">${inp.f_debt}%</span></div><input type="range" min="0" max="90" value="${inp.f_debt}" data-bind="inp.f_debt"/></label>
          <label class="field"><div class="flabel"><span>Cost of debt</span><span class="fval">${fmt(inp.f_rate,1)}%</span></div><input type="range" min="5" max="18" step="0.1" value="${inp.f_rate}" data-bind="inp.f_rate"/></label>
        </div>
        <div class="row">
          <label class="field"><div class="flabel"><span>Hurdle rate</span><span class="fval">${fmt(inp.f_hurdle,1)}%</span></div><input type="range" min="5" max="25" step="0.5" value="${inp.f_hurdle}" data-bind="inp.f_hurdle"/></label>
          <label class="field"><div class="flabel"><span>Min DSCR covenant</span><span class="fval">${fmt(inp.f_mindscr,2)}x</span></div><input type="range" min="1" max="2" step="0.05" value="${inp.f_mindscr}" data-bind="inp.f_mindscr"/></label>
        </div>
      </details>
    </div>
  </div>
  <div class="card" style="margin-top:18px;">
    <div class="cardHead"><h3>Revenue vs Opex — 15 years</h3><span class="hint">₹ Cr</span></div>
    <div class="chartWrap">${stackedBarChart({categories:years, series:revOpexSeries, height:240})}</div>
  </div>
  <div class="card" style="margin-top:18px;">
    <div class="cardHead"><h3>DSCR by year</h3><span class="hint">covenant line at ${fmt(inp.f_mindscr,2)}x</span></div>
    <div class="chartWrap">${lineChart({labels:years, lines:dscrLine, refLine:inp.f_mindscr, height:220})}</div>
  </div>
  <details class="advanced" style="margin-top:14px;"><summary>Full 15-year cash flow table</summary>
    <table class="dataTable" style="margin-top:10px;">
      <thead><tr><th>Year</th><th class="num">Util%</th><th class="num">Revenue</th><th class="num">Opex</th><th class="num">EBITDA</th><th class="num">Interest</th><th class="num">Principal</th><th class="num">PAT</th><th class="num">FCFE</th><th class="num">DSCR</th></tr></thead>
      <tbody>${f.rows.map(r=>`<tr><td>${r.y}</td><td class="num">${fmt(r.utilFrac*100,0)}%</td><td class="num">${fmt(r.rev,2)}</td><td class="num">${fmt(r.opex,2)}</td><td class="num">${fmt(r.ebitda,2)}</td><td class="num">${fmt(r.interestCr,2)}</td><td class="num">${fmt(r.principal,2)}</td><td class="num">${fmt(r.pat,2)}</td><td class="num">${fmt(r.fcfe,2)}</td><td class="num">${isNaN(r.dscr)?'—':fmt(r.dscr,2)}</td></tr>`).join('')}</tbody>
    </table>
  </details>
  `;
}

/* ============================================================
   PHASE 2 — SCENARIOS
   ============================================================ */
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
function saveScenario(){
  const {ev, finExact} = STATE._cache;
  const name = prompt('Scenario name', architectureNameOf(ev)+' — '+scenarioPresets[STATE.inp.scenario].label);
  if(!name) return;
  STATE.scenarios.push({ id:Date.now(), name, inp:deepClone(STATE.inp), candidate:deepClone(STATE.candidate), ev, finExact, ts:new Date().toLocaleString('en-IN') });
  if(STATE.tab2!=='scenarios') { STATE.tab2='scenarios'; }
  render();
}
function loadScenario(id){
  const s = STATE.scenarios.find(x=>x.id===+id); if(!s) return;
  STATE.inp = deepClone(s.inp); STATE.candidate = deepClone(s.candidate); STATE.editingScenarioId = s.id;
  STATE.tab2='architecture'; render();
}
function duplicateScenario(id){
  const s = STATE.scenarios.find(x=>x.id===+id); if(!s) return;
  const copy = { id:Date.now(), name:s.name+' (copy)', inp:deepClone(s.inp), candidate:deepClone(s.candidate), ev:s.ev, finExact:s.finExact, ts:new Date().toLocaleString('en-IN') };
  STATE.scenarios.push(copy);
  loadScenario(copy.id);
}
function deleteScenario(id){ STATE.scenarios = STATE.scenarios.filter(x=>x.id!==+id); render(); }

function viewScenarios(){
  const list = STATE.scenarios;
  const {ev, finExact} = STATE._cache;
  const current = {id:'current', name:'Current (unsaved) — '+architectureNameOf(ev), ev, finExact, ts:'now'};
  const all = [current, ...list];
  const maxNPV = Math.max(...all.map(s=>isFinite(s.finExact.npvEquity)?s.finExact.npvEquity:0), 1);
  return `
  <h2 class="sectionTitle">Scenarios</h2>
  <p class="sectionDesc">Duplicate the current architecture, change assumptions in the Architecture tab, save again, and compare side-by-side on renewable share, landed cost and returns.</p>
  ${list.length===0 ? `<div class="card emptyState"><div class="big">⎘</div><p>No saved scenarios yet. Use <strong>+ Save scenario</strong> in the top bar to snapshot the current architecture, then adjust assumptions and save again to compare.</p></div>` : ''}
  <div class="card">
    <div class="cardHead"><h3>Comparison</h3></div>
    <table class="dataTable">
      <thead><tr><th>Scenario</th><th class="num">Ren. share</th><th class="num">Landed ₹/kWh</th><th class="num">CAPEX Cr</th><th class="num">Project IRR</th><th class="num">Equity IRR</th><th class="num">NPV Cr</th><th class="num">DSCR</th><th class="num">Payback</th><th></th></tr></thead>
      <tbody>
      ${all.map(s=>`
        <tr class="scenRow ${STATE.editingScenarioId===s.id?'active':''}">
          <td>${s.name}<br/><span style="font-size:10px;color:var(--text-faint)">${s.ts}</span></td>
          <td class="num">${fmt(s.ev.renShare,0)}%</td>
          <td class="num">₹${fmt(s.ev.landedCostPerKWh,2)}</td>
          <td class="num">${fmt(s.finExact.totalCapexCr,1)}</td>
          <td class="num">${irrLabel(s.finExact.projectIRR)}</td>
          <td class="num">${irrLabel(s.finExact.equityIRR)}</td>
          <td class="num">${fmt(s.finExact.npvEquity,1)}</td>
          <td class="num">${isNaN(s.finExact.avgDSCR)?'—':fmt(s.finExact.avgDSCR,2)+'x'}</td>
          <td class="num">${isNaN(s.finExact.payback)?'—':fmt(s.finExact.payback,1)+'y'}</td>
          <td>${s.id!=='current'?`<button class="btn ghost sm" data-action="loadScenario:${s.id}">Edit</button><button class="btn ghost sm" data-action="duplicateScenario:${s.id}">Copy</button><button class="btn ghost sm" data-action="deleteScenario:${s.id}">✕</button>`:''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  ${all.length>1?`
  <div class="card" style="margin-top:18px;">
    <div class="cardHead"><h3>Equity NPV comparison</h3><span class="hint">₹ Cr</span></div>
    <div class="chartWrap">${stackedBarChart({categories:all.map(s=>s.name.length>18?s.name.slice(0,16)+'…':s.name), series:[{name:'NPV',data:all.map(s=>isFinite(s.finExact.npvEquity)?s.finExact.npvEquity:0),color:'var(--accent)'}], height:240})}</div>
  </div>`:''}
  `;
}
