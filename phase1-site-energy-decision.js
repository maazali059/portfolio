/* ============================================================
   PHASE 1 — SITE / ENERGY / DECISION
   ============================================================ */
function viewSite(){
  const inp = STATE.inp;
  const states = Object.keys(STATE_BENCHMARKS);
  return `
  <h2 class="sectionTitle">01 · Site</h2>
  <p class="sectionDesc">Establish the site's location, grid connection, and procurement context. State benchmarks pre-fill indicative tariff and resource-quality assumptions — every field remains editable in later steps.</p>
  <div class="cols2">
    <div class="card">
      <div class="cardHead"><h3>Location &amp; archetype</h3></div>
      <label class="field"><div class="flabel"><span>State</span></div>
        <select data-bind="inp.state" data-type="select" data-action-onchange="">
          ${states.map(s=>`<option value="${s}" ${inp.state===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </label>
      <div class="row">
        <label class="field"><div class="flabel"><span>Site archetype</span></div>
          <select data-bind="inp.archetype" data-type="select">
            ${['Highway / intercity hub','Urban fleet depot','Bus depot','Logistics / freight hub','Retail / mall charging'].map(a=>`<option ${inp.archetype===a?'selected':''}>${a}</option>`).join('')}
          </select>
        </label>
        <label class="field"><div class="flabel"><span>Connection voltage</span></div>
          <select data-bind="inp.voltage" data-type="select">
            ${['LT','HT / 11kV','33kV','EHT / 66kV+'].map(a=>`<option ${inp.voltage===a?'selected':''}>${a}</option>`).join('')}
          </select>
        </label>
      </div>
      <button class="btn sm" data-action="applyStateBenchmark">Apply ${inp.state} benchmark tariffs &amp; CUF ↴</button>
      <p style="font-size:11px;color:var(--text-faint);margin-top:8px;">Indicative values for a quick start — not a regulatory quote. Refine energy charges, surcharges and CUF directly in Architecture once the shell is built.</p>
    </div>
    <div class="card">
      <div class="cardHead"><h3>Grid connection</h3></div>
      <div class="checkRow" style="margin-bottom:12px;"><input type="checkbox" data-bind="inp.gridAllowed" data-type="checkbox" ${inp.gridAllowed?'checked':''}/> Grid import permitted as a fallback source</div>
      <label class="field"><div class="flabel"><span>Sanctioned load</span><span class="fval">${fmt(inp.g_sanc,0)} kVA</span></div>
        <input type="range" min="100" max="20000" step="50" value="${inp.g_sanc}" data-bind="inp.g_sanc"/>
      </label>
      <label class="field"><div class="flabel"><span>≈ contract demand</span></div>
        <div class="mono" style="color:var(--text-dim);">${fmt(inp.g_sanc/1000,2)} MW</div>
      </label>
      <div class="checkRow" style="margin:10px 0;"><input type="checkbox" data-bind="inp.g_upgrade_avail" data-type="checkbox" ${inp.g_upgrade_avail?'checked':''}/> Capacity upgrade available if needed</div>
      ${inp.g_upgrade_avail?`
      <div class="row">
        <label class="field"><div class="flabel"><span>Upgrade size</span><span class="fval">${fmt(inp.g_upgrade_mw,2)} MW</span></div>
          <input type="range" min="0" max="10" step="0.1" value="${inp.g_upgrade_mw}" data-bind="inp.g_upgrade_mw"/></label>
        <label class="field"><div class="flabel"><span>Upgrade CAPEX</span><span class="fval">₹${fmt(inp.g_upgrade_capex,2)} Cr/MW</span></div>
          <input type="range" min="0" max="3" step="0.05" value="${inp.g_upgrade_capex}" data-bind="inp.g_upgrade_capex"/></label>
      </div>`:''}
    </div>
  </div>
  <div class="stepFooter"><span></span><button class="btn primary" data-action="gotoStep:energy">Continue to Energy →</button></div>
  `;
}
function applyStateBenchmark(){
  const b = STATE_BENCHMARKS[STATE.inp.state]; if(!b) return;
  Object.assign(STATE.inp, {g_energy:b.g_energy, oa_css:b.oa_css, oa_wheel:b.oa_wheel, oa_addl:b.oa_addl, oa_bank:b.oa_bank, gc_charges:b.gc_charges, s_cuf:b.s_cuf, w_cuf:b.w_cuf});
  render();
}

function viewEnergy(){
  const inp = STATE.inp;
  const dailyKWh = inp.vehicles.reduce((s,r)=>s+r.vpd*r.spd*r.kwh,0);
  const annualGWh = dailyKWh*inp.opdays/1e6;
  return `
  <h2 class="sectionTitle">02 · Energy</h2>
  <p class="sectionDesc">Define the charging load — vehicle mix, operating pattern and demand shape — and set the renewable-energy ambition that will steer architecture selection.</p>
  <div class="cols2">
    <div class="card">
      <div class="cardHead"><h3>Vehicle / session mix</h3><span class="hint">Vehicles/day × sessions/day × kWh/session</span></div>
      ${inp.vehicles.map((v,i)=>`
        <div class="rowCard">
          <input class="rc-name" type="text" value="${v.name}" data-bind="inp.vehicles[${i}].name" data-type="text"/>
          <input class="rc-num" type="number" value="${v.vpd}" data-bind="inp.vehicles[${i}].vpd" data-type="number" title="vehicles/day"/>
          <input class="rc-num" type="number" step="0.1" value="${v.spd}" data-bind="inp.vehicles[${i}].spd" data-type="number" title="sessions/vehicle/day"/>
          <input class="rc-num" type="number" step="0.5" value="${v.kwh}" data-bind="inp.vehicles[${i}].kwh" data-type="number" title="kWh/session"/>
          <span class="mono" style="width:70px;text-align:right;color:var(--text-dim);">${fmt(v.vpd*v.spd*v.kwh,0)} kWh</span>
          <button class="btn ghost sm" data-action="removeVehicle:${i}">✕</button>
        </div>`).join('')}
      <button class="btn sm" style="margin-top:10px;" data-action="addVehicle">+ Add segment</button>
      <div class="cols3" style="margin-top:16px;">
        <div class="kpi"><div class="kv">${fmt(dailyKWh/1000,1)}<span class="unit">MWh</span></div><div class="kl">Daily energy</div></div>
        <div class="kpi"><div class="kv">${fmt(annualGWh,2)}<span class="unit">GWh</span></div><div class="kl">Annual energy (Y1 basis)</div></div>
        <div class="kpi"><div class="kv">${fmt(dailyKWh/1000/18,2)}<span class="unit">MW</span></div><div class="kl">≈ avg 18h load</div></div>
      </div>
    </div>
    <div class="card">
      <div class="cardHead"><h3>Operating pattern</h3></div>
      <label class="field"><div class="flabel"><span>Operating days / year</span><span class="fval">${inp.opdays}</span></div>
        <input type="range" min="200" max="365" step="1" value="${inp.opdays}" data-bind="inp.opdays"/></label>
      <label class="field"><div class="flabel"><span>Demand shape</span></div>
        <select data-bind="inp.shape" data-type="select">
          <option value="flat" ${inp.shape==='flat'?'selected':''}>Flat / round-the-clock</option>
          <option value="daytime" ${inp.shape==='daytime'?'selected':''}>Daytime-weighted</option>
          <option value="evening" ${inp.shape==='evening'?'selected':''}>Evening peak</option>
          <option value="night" ${inp.shape==='night'?'selected':''}>Overnight-weighted</option>
        </select></label>
      <label class="field"><div class="flabel"><span>Annual demand growth</span><span class="fval">${fmt(inp.growth,1)}%</span></div>
        <input type="range" min="0" max="20" step="0.5" value="${inp.growth}" data-bind="inp.growth"/></label>
      <details class="advanced">
        <summary>Utilisation ramp assumptions</summary>
        <div class="row" style="margin-top:10px;">
          <label class="field"><div class="flabel"><span>Year-1 utilisation</span><span class="fval">${inp.util_y1}%</span></div>
            <input type="range" min="5" max="100" value="${inp.util_y1}" data-bind="inp.util_y1"/></label>
          <label class="field"><div class="flabel"><span>Terminal utilisation</span><span class="fval">${inp.util_terminal}%</span></div>
            <input type="range" min="20" max="100" value="${inp.util_terminal}" data-bind="inp.util_terminal"/></label>
        </div>
        <div class="row">
          <label class="field"><div class="flabel"><span>Ramp years</span><span class="fval">${inp.util_rampyears}</span></div>
            <input type="range" min="1" max="8" value="${inp.util_rampyears}" data-bind="inp.util_rampyears"/></label>
          <label class="field"><div class="flabel"><span>Ramp shape</span></div>
            <select data-bind="inp.util_shape" data-type="select">
              <option value="linear" ${inp.util_shape==='linear'?'selected':''}>Linear</option>
              <option value="scurve" ${inp.util_shape==='scurve'?'selected':''}>S-curve</option>
            </select></label>
        </div>
      </details>
    </div>
  </div>
  <div class="card" style="margin-top:18px;">
    <div class="cardHead"><h3>Decision targets</h3></div>
    <div class="cols3">
      <label class="field"><div class="flabel"><span>Renewable energy target</span><span class="fval">${inp.retarget}%</span></div>
        <input type="range" min="0" max="100" value="${inp.retarget}" data-bind="inp.retarget"/></label>
      <label class="field"><div class="flabel"><span>Reliability preference</span></div>
        <select data-bind="inp.reliab" data-type="select">
          <option value="standard" ${inp.reliab==='standard'?'selected':''}>Standard — grid backup unconstrained</option>
          <option value="high" ${inp.reliab==='high'?'selected':''}>High — cap grid share ≤ 50%</option>
        </select></label>
      <label class="field"><div class="flabel"><span>Dispatch priority order</span></div>
        <select data-bind="inp.priority" data-type="select">
          <option value="solar-wind-gc-oa-bess-grid" ${inp.priority==='solar-wind-gc-oa-bess-grid'?'selected':''}>Solar → Wind → GC → OA → BESS → Grid</option>
          <option value="solar-wind-oa-gc-bess-grid" ${inp.priority==='solar-wind-oa-gc-bess-grid'?'selected':''}>Solar → Wind → OA → GC → BESS → Grid</option>
          <option value="solar-wind-bess-gc-oa-grid" ${inp.priority==='solar-wind-bess-gc-oa-grid'?'selected':''}>Solar → Wind → BESS → GC → OA → Grid</option>
        </select></label>
    </div>
  </div>
  <div class="stepFooter">
    <button class="btn" data-action="gotoStep:site">← Back to Site</button>
    <button class="btn primary" data-action="gotoStep:decision">Continue to Decision →</button>
  </div>
  `;
}
function addVehicle(){ STATE.inp.vehicles.push({name:'New segment', vpd:10, spd:1, kwh:20}); render(); }
function removeVehicle(i){ STATE.inp.vehicles.splice(+i,1); render(); }

/* ---------------- Decision step: run optimizer, show top candidates ---------------- */
function viewDecision(){
  const inp = STATE.inp;
  if(!STATE.decisionResults){
    return `
    <h2 class="sectionTitle">03 · Decision</h2>
    <p class="sectionDesc">ENERGYNEX will search combinations of Solar, Wind, Green OA, Group Captive and BESS against your renewable target, reliability preference and financing thresholds, then rank them on 15-year equity NPV and IRR.</p>
    <div class="card emptyState">
      <div class="big">⚙</div>
      <p>Ready to evaluate architectures for this site against a ${inp.retarget}% renewable target.</p>
      <button class="btn primary" data-action="runOptimizer">Find best architecture</button>
      <p style="margin-top:14px;"><a href="#" data-action="skipToManual">Skip — build an architecture manually →</a></p>
    </div>`;
  }
  const results = STATE.decisionResults;
  const maxCap = Math.max(...results.map(r=> r.ev.candidate.solarMW+r.ev.candidate.windMW+r.ev.candidate.oaMW+r.ev.candidate.gcMW+r.ev.candidate.bessMW), 1);
  return `
  <h2 class="sectionTitle">03 · Decision</h2>
  <p class="sectionDesc">Top-ranked architectures for this site, evaluated on 15-year equity NPV at your ${fmt(inp.f_hurdle,1)}% hurdle rate, subject to the ${inp.retarget}% renewable target and ${inp.reliab==='high'?'high-reliability grid cap':'standard reliability'} constraint.</p>
  <div class="colsAuto">
    ${results.map((r,i)=>candidateCard(r,i)).join('')}
  </div>
  <div class="stepFooter">
    <button class="btn" data-action="gotoStep:energy">← Back to Energy</button>
    <span><a href="#" data-action="skipToManual">Build manually instead →</a></span>
  </div>
  `;
}
function candidateCard(r,i){
  const c = r.ev.candidate; const a = r.ev.annual;
  const mix = [
    {k:'solar',v:a.solar},{k:'wind',v:a.wind},{k:'oa',v:a.oa},{k:'gc',v:a.gc},{k:'bess',v:a.bessDischarge},{k:'grid',v:a.grid}
  ].filter(x=>x.v>0.01);
  const total = mix.reduce((s,x)=>s+x.v,0)||1;
  return `
  <div class="candCard ${i===0?'best':''}">
    <span class="rank">${i===0?'RECOMMENDED':'#'+(i+1)}</span>
    <h4>${r.name}</h4>
    <div class="candMix">${mix.map(x=>`<span style="width:${(x.v/total*100).toFixed(1)}%;background:${SRC_COLORS[x.k]}"></span>`).join('')}</div>
    <div class="candLegend">${mix.map(x=>`<span><span class="dot" style="background:${SRC_COLORS[x.k]}"></span> ${SRC_LABELS[x.k]} ${fmt(x.v/total*100,0)}%</span>`).join('')}</div>
    <div class="candKpis">
      <div><div class="v">${fmt(r.ev.renShare,0)}%</div><div class="l">Renewable share</div></div>
      <div><div class="v">₹${fmt(r.ev.landedCostPerKWh,2)}</div><div class="l">Landed ₹/kWh</div></div>
      <div><div class="v">${irrLabel(r.finExact.projectIRR)}</div><div class="l">Project IRR</div></div>
      <div><div class="v">${irrLabel(r.finExact.equityIRR)}</div><div class="l">Equity IRR</div></div>
      <div><div class="v">${isNaN(r.finExact.payback)?'—':fmt(r.finExact.payback,1)+'y'}</div><div class="l">Payback</div></div>
      <div><div class="v">${isNaN(r.finExact.avgDSCR)?'—':fmt(r.finExact.avgDSCR,2)+'x'}</div><div class="l">Avg DSCR</div></div>
    </div>
    <div style="font-size:10.5px;color:var(--text-faint);">CAPEX ₹${fmt(r.finExact.totalCapexCr,1)} Cr · ${c.solarMW>0.01?`Solar ${fmt(c.solarMW,1)}MW `:''}${c.windMW>0.01?`Wind ${fmt(c.windMW,1)}MW `:''}${c.oaMW>0.01?`OA ${fmt(c.oaMW,1)}MW `:''}${c.gcMW>0.01?`GC ${fmt(c.gcMW,1)}MW `:''}${c.bessMWh>0.01?`BESS ${fmt(c.bessMWh,1)}MWh`:''}</div>
    <button class="btn primary sm" data-action="selectCandidate:${i}">Select &amp; open workspace →</button>
  </div>`;
}
function runOptimizer(){
  const inp = STATE.inp;
  const units = getUnitShapes(inp);
  const baseDemand = getBaseDemand8760(inp);
  const gridCapMW = gridCapacityMW(inp, inp.g_upgrade_avail);
  STATE.decisionResults = optimizeArchitecture(inp, units, baseDemand, gridCapMW, 5);
  render();
}
function selectCandidate(i){ enterPhase2(STATE.decisionResults[+i].ev.candidate); }
function skipToManual(){ enterPhase2(defaultCandidate()); }
