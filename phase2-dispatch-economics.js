/* ============================================================
   PHASE 2 — DISPATCH
   ============================================================ */
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getHourlyResult(){
  const inp = STATE.inp, {units, baseDemand, gridCapMW} = STATE._cache;
  const {result} = runCandidateDispatch(inp, units, baseDemand, STATE.candidate, 1.0, gridCapMW, true);
  return result;
}
function viewDispatch(){
  const inp = STATE.inp, c = STATE.candidate;
  const result = getHourlyResult();
  const dayIdx = clampV(STATE.dispatchDay, 0, 364);
  const dayHours = result.hourly.slice(dayIdx*24, dayIdx*24+24);
  const labels = dayHours.map(h=>String(h.hour).padStart(2,'0'));
  const series = [
    {name:'solar', data:dayHours.map(h=>h.solar), color:'var(--c-solar)'},
    {name:'wind', data:dayHours.map(h=>h.wind), color:'var(--c-wind)'},
    {name:'gc', data:dayHours.map(h=>h.gc), color:'var(--c-gc)'},
    {name:'oa', data:dayHours.map(h=>h.oa), color:'var(--c-oa)'},
    {name:'bessDischarge', data:dayHours.map(h=>h.bessDischarge), color:'var(--c-bess)'},
    {name:'grid', data:dayHours.map(h=>h.grid), color:'var(--c-grid)'},
    {name:'bessCharge(-)', data:dayHours.map(h=>-h.bessCharge), color:'#B0405C'},
  ];
  const loadLine = dayHours.map(h=>h.demand);
  const socLine = c.bessMWh>0 ? dayHours.map(h=>h.soc/c.bessMWh*100) : null;
  const monthlySeries = [
    {name:'Solar', data:result.monthly.map(m=>m.solar/1000), color:'var(--c-solar)'},
    {name:'Wind', data:result.monthly.map(m=>m.wind/1000), color:'var(--c-wind)'},
    {name:'GC', data:result.monthly.map(m=>m.gc/1000), color:'var(--c-gc)'},
    {name:'OA', data:result.monthly.map(m=>m.oa/1000), color:'var(--c-oa)'},
    {name:'BESS', data:result.monthly.map(m=>m.bessDischarge/1000), color:'var(--c-bess)'},
    {name:'Grid', data:result.monthly.map(m=>m.grid/1000), color:'var(--c-grid)'},
  ];
  const dayDate = new Date(2025,0,1); dayDate.setDate(dayDate.getDate()+dayIdx);
  const totalCycles = c.bessMWh>0 ? (result.annual.bessDischarge/c.bessMWh).toFixed(0) : '—';
  return `
  <h2 class="sectionTitle">Dispatch</h2>
  <p class="sectionDesc">Hour-by-hour resolution of the full 8,760-hour simulation. Move through the year to see how load is met by Solar → Wind → Grid → BESS, and how the battery is charged and discharged across the day.</p>
  <div class="card">
    <div class="cardHead"><h3>Day view — ${MONTH_NAMES[dayDate.getMonth()]} ${dayDate.getDate()}</h3><span class="hint">Day ${dayIdx+1} of 365</span></div>
    <input type="range" min="0" max="364" value="${dayIdx}" data-bind="dispatchDay" data-type="number"/>
    <div class="chartWrap" style="margin-top:10px;">${stackedAreaChart({labels, series, loadLine, socLine, height:300})}</div>
    <div class="candLegend" style="margin-top:8px;">
      <span><span class="dot" style="background:var(--c-load)"></span> Load (dashed)</span>
      ${socLine?`<span><span class="dot" style="background:var(--accent)"></span> BESS SOC % (right axis)</span>`:''}
      ${['solar','wind','gc','oa','bessDischarge','grid'].map(k=>`<span><span class="dot" style="background:${SRC_COLORS[k]}"></span> ${SRC_LABELS[k]}</span>`).join('')}
      <span><span class="dot" style="background:#B0405C"></span> BESS charging (below axis)</span>
    </div>
  </div>
  <div class="cols2" style="margin-top:18px;">
    <div class="card">
      <div class="cardHead"><h3>Monthly energy balance</h3><span class="hint">GWh</span></div>
      <div class="chartWrap">${stackedBarChart({categories:MONTH_NAMES, series:monthlySeries, height:260})}</div>
    </div>
    <div class="viewGrid">
      <div class="colsAuto">
        <div class="kpi"><div class="kv">${fmt(result.peakGridMW,2)}<span class="unit">MW</span></div><div class="kl">Peak grid draw</div></div>
        <div class="kpi ${result.annual.unserved>0.1?'bad':'good'}"><div class="kv">${fmt(result.annual.unserved,1)}<span class="unit">MWh</span></div><div class="kl">Annual unserved</div></div>
        <div class="kpi ${result.annual.curtail>10?'warn':''}"><div class="kv">${fmt(result.annual.curtail,1)}<span class="unit">MWh</span></div><div class="kl">Annual curtailed</div></div>
        <div class="kpi"><div class="kv">${totalCycles}</div><div class="kl">BESS cycles / year</div></div>
        <div class="kpi"><div class="kv">${fmt(result.annual.bessChargeRenewable,0)}<span class="unit">MWh</span></div><div class="kl">BESS charged from RE</div></div>
        <div class="kpi"><div class="kv">${fmt(result.annual.bessChargeGrid+result.annual.bessChargeOA+result.annual.bessChargeGC,0)}<span class="unit">MWh</span></div><div class="kl">BESS charged from Grid/OA/GC</div></div>
      </div>
      <div class="card">
        <div class="cardHead"><h3>Jump to</h3></div>
        <div class="row">
          <button class="btn sm" data-action="jumpDay:15">Mid-Jan</button>
          <button class="btn sm" data-action="jumpDay:105">Mid-Apr</button>
          <button class="btn sm" data-action="jumpDay:196">Mid-Jul</button>
          <button class="btn sm" data-action="jumpDay:288">Mid-Oct</button>
        </div>
      </div>
    </div>
  </div>
  `;
}
function jumpDay(d){ STATE.dispatchDay = +d; render(); }

/* ============================================================
   PHASE 2 — ECONOMICS
   ============================================================ */
function viewEconomics(){
  const inp = STATE.inp, {ev} = STATE._cache;
  const grid = ev.gridFull, gc = ev.gcFull;
  const oaBreak = computeOA(inp).breakdown;
  const gcBreak = gc.breakdown;
  return `
  <h2 class="sectionTitle">Economics</h2>
  <p class="sectionDesc">Landed-cost build-up for each procurement pathway actually used by this architecture, plus the blended cost of energy delivered to the charging load.</p>
  <div class="colsAuto" style="margin-bottom:18px;">
    <div class="kpi"><div class="kv">₹${fmt(ev.landedCostPerKWh,2)}</div><div class="kl">Blended landed cost /kWh (opex only)</div></div>
    <div class="kpi"><div class="kv">₹${fmt(ev.fullyLoadedCostPerKWh,2)}</div><div class="kl">Fully-loaded cost /kWh (incl. capex annuity)</div></div>
    <div class="kpi"><div class="kv">₹${fmt(ev.blendedPrice,2)}</div><div class="kl">Blended charging tariff /kWh</div></div>
    <div class="kpi ${ev.ebitdaCr>=0?'good':'bad'}"><div class="kv">₹${fmt(ev.ebitdaCr,2)}<span class="unit">Cr</span></div><div class="kl">Year-1 EBITDA</div></div>
  </div>
  <div class="viewGrid">
    <div class="card">
      <div class="cardHead"><h3>Grid — landed cost build-up</h3><span class="hint">₹/kWh, effective blended rate</span></div>
      ${pathwayBuildupRows([
        ['Base energy charge', grid.baseEnergyRate],
        ['ToD adjustment (net)', grid.touAdj],
        ['FPPCA / fuel surcharge', grid.fppcaRate],
        ['Demand + fixed charges (allocated)', grid.demandFixedPerKWh],
        ['Connectivity amortisation', grid.connAmortRate],
        ['Custom charges', grid.customChargeRate],
      ], grid.effectivePerKWh)}
      <p style="font-size:10.5px;color:var(--text-faint);margin-top:8px;">${grid.allocationNote}</p>
    </div>
    <div class="card">
      <div class="cardHead"><h3>Green Open Access — landed cost build-up</h3></div>
      ${pathwayBuildupRows(Object.entries(oaBreak), computeOA(inp).landed)}
    </div>
    <div class="card">
      <div class="cardHead"><h3>Group Captive — fully-loaded delivered cost</h3><span class="hint">${gc.captiveOK?'Captive benefit applied':'Captive benefit NOT applied'}</span></div>
      ${pathwayBuildupRows(Object.entries(gcBreak), gc.deliveredPerKWh)}
      <p style="font-size:10.5px;color:var(--text-faint);margin-top:8px;">${gc.note}</p>
    </div>
    <div class="cols2">
      <div class="card">
        <div class="cardHead"><h3>Solar — fully-loaded cost</h3></div>
        <div class="kpi"><div class="kv">₹${fmt(ev.solarFullPerKWh,2)}</div><div class="kl">₹/kWh, capex annuity + O&amp;M</div></div>
      </div>
      <div class="card">
        <div class="cardHead"><h3>Wind — fully-loaded cost</h3></div>
        <div class="kpi"><div class="kv">₹${fmt(ev.windFullPerKWh,2)}</div><div class="kl">₹/kWh, capex annuity + O&amp;M</div></div>
      </div>
    </div>
    <div class="card">
      <div class="cardHead"><h3>Pathway comparison</h3><span class="hint">₹/kWh, fully-loaded where applicable</span></div>
      <div class="chartWrap">${stackedBarChart({
        categories:['Solar','Wind','Grid','Open Access','Group Captive','Blended'],
        series:[{name:'Cost',data:[ev.solarFullPerKWh, ev.windFullPerKWh, grid.effectivePerKWh, computeOA(inp).landed, gc.deliveredPerKWh, ev.fullyLoadedCostPerKWh],
          color:'var(--accent)'}], height:220})}</div>
    </div>
  </div>
  `;
}
function pathwayBuildupRows(entries, total){
  return `<table class="dataTable">${entries.map(([label,val])=>`<tr><td>${label}</td><td class="num">${fmt(val,3)}</td></tr>`).join('')}
  <tr><td style="color:var(--text);font-weight:600;">Effective / delivered rate</td><td class="num" style="color:var(--accent);font-weight:600;">₹${fmt(total,2)}</td></tr></table>`;
}
