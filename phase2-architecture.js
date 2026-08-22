/* ============================================================
   PHASE 2 — ARCHITECTURE
   ============================================================ */
function viewArchitecture(){
  const inp = STATE.inp, c = STATE.candidate, {ev} = STATE._cache;
  return `
  <h2 class="sectionTitle">Architecture</h2>
  <p class="sectionDesc">Construct the source mix. Adjust capacities and procurement terms — the flow diagram and KPIs recompute from the full 8,760-hour dispatch on every change.</p>
  <div class="card" style="margin-bottom:18px;">
    <div class="cardHead"><h3>Annual energy flow</h3><span class="hint">GWh/year, steady-state at terminal utilisation</span></div>
    <div class="chartWrap">${flowSchematic(ev)}</div>
    <div class="colsAuto" style="margin-top:14px;">
      <div class="kpi ${ev.renShare>=inp.retarget?'good':'warn'}"><div class="kv">${fmt(ev.renShare,0)}<span class="unit">%</span></div><div class="kl">Renewable share</div><div class="ksub">target ${inp.retarget}%</div></div>
      <div class="kpi"><div class="kv">${fmt(ev.annual.demand>0?(ev.annual.grid/ev.annual.demand*100):0,0)}<span class="unit">%</span></div><div class="kl">Grid dependency</div></div>
      <div class="kpi ${ev.annual.curtail>1?'warn':''}"><div class="kv">${fmt(ev.annual.curtail,1)}<span class="unit">MWh</span></div><div class="kl">Curtailed RE</div></div>
      <div class="kpi ${ev.unservedMWh>0.1?'bad':'good'}"><div class="kv">${fmt(ev.unservedMWh,2)}<span class="unit">MWh</span></div><div class="kl">Unserved energy</div></div>
      <div class="kpi"><div class="kv">₹${fmt(ev.landedCostPerKWh,2)}</div><div class="kl">Landed cost /kWh</div></div>
      <div class="kpi"><div class="kv">${fmt(ev.peakGridMW,2)}<span class="unit">MW</span></div><div class="kl">Peak grid draw</div><div class="ksub">sanctioned ${fmt(ev.sanctionedMW,2)} MW</div></div>
    </div>
  </div>

  <div class="cols2">
    <div class="viewGrid">
      <div class="card">
        <div class="cardHead"><h3>Generation &amp; storage capacity</h3></div>
        ${capField('Solar PV','candidate.solarMW',c.solarMW,0,20,0.1,'MW')}
        ${capField('Wind','candidate.windMW',c.windMW,0,20,0.1,'MW')}
        ${capField('Green Open Access','candidate.oaMW',c.oaMW,0,20,0.1,'MW')}
        ${capField('Group Captive','candidate.gcMW',c.gcMW,0,20,0.1,'MW')}
        <div class="row">
          ${capField('BESS power','candidate.bessMW',c.bessMW,0,10,0.1,'MW')}
          ${capField('BESS energy','candidate.bessMWh',c.bessMWh,0,30,0.1,'MWh')}
        </div>
        <div class="pill ${bessCrateOK(c)?'good':'bad'}">C-rate ${c.bessMWh>0?fmt(c.bessMW/c.bessMWh,2):'—'} (allowed ${fmt(inp.b_cratemin,2)}–${fmt(inp.b_cratemax,2)})</div>
        <details class="advanced">
          <summary>Group Captive terms</summary>
          <div class="row" style="margin-top:10px;">
            <label class="field"><div class="flabel"><span>My equity stake</span><span class="fval">${inp.gc_myequity}%</span></div><input type="range" min="0" max="100" value="${inp.gc_myequity}" data-bind="inp.gc_myequity"/></label>
            <label class="field"><div class="flabel"><span>Solar share of GC plant</span><span class="fval">${inp.gc_solarshare}%</span></div><input type="range" min="0" max="100" value="${inp.gc_solarshare}" data-bind="inp.gc_solarshare"/></label>
          </div>
          <div class="pill ${ev.gcElig.status==='ELIGIBLE'?'good':ev.gcElig.status==='N/A'?'':'bad'}">${ev.gcElig.status}: ${ev.gcElig.detail}</div>
        </details>
        <details class="advanced"><summary>Open Access eligibility</summary>
          <p style="font-size:11.5px;color:var(--text-dim);margin-top:8px;">${ev.oaElig.detail}</p>
        </details>
      </div>

      <div class="card">
        <div class="cardHead"><h3>BESS operating strategy</h3></div>
        <label class="field"><div class="flabel"><span>Strategy</span></div>
          <select data-bind="inp.bessOp.strategy" data-type="select">
            <option value="renewable" ${inp.bessOp.strategy==='renewable'?'selected':''}>Renewable-only charging (solar/wind → BESS → load)</option>
            <option value="mincost" ${inp.bessOp.strategy==='mincost'?'selected':''}>Minimum-cost — charge from cheapest available hours</option>
            <option value="peak" ${inp.bessOp.strategy==='peak'?'selected':''}>Peak shaving — discharge only above a load threshold</option>
            <option value="arbitrage" ${inp.bessOp.strategy==='arbitrage'?'selected':''}>Tariff arbitrage — charge cheap ToD hours, discharge expensive hours</option>
            <option value="custom" ${inp.bessOp.strategy==='custom'?'selected':''}>Custom charge/discharge windows</option>
          </select>
        </label>
        <div class="cardHead" style="margin-top:6px;margin-bottom:6px;"><h3 style="font-size:10.5px;">Permitted charge sources</h3></div>
        <div class="row">
          ${['solar','wind','grid','oa','gc'].map(s=>`<label class="checkRow"><input type="checkbox" data-bind="inp.bessOp.chargeSources.${s}" data-type="checkbox" ${inp.bessOp.chargeSources[s]?'checked':''}/> ${SRC_LABELS[s]}</label>`).join('')}
        </div>
        ${inp.bessOp.strategy==='custom'?`
        <div class="row" style="margin-top:10px;">
          <label class="field"><div class="flabel"><span>Charge hours (comma list, 0–23)</span></div><input type="text" placeholder="e.g. 11,12,13,14,15" value="${inp.bessOp.customWindows.chargeHours}" data-bind="inp.bessOp.customWindows.chargeHours" data-type="text"/></label>
          <label class="field"><div class="flabel"><span>Discharge hours</span></div><input type="text" placeholder="e.g. 18,19,20,21" value="${inp.bessOp.customWindows.dischargeHours}" data-bind="inp.bessOp.customWindows.dischargeHours" data-type="text"/></label>
        </div>`:''}
        <p style="font-size:11px;color:var(--text-faint);margin-top:10px;">Solar and wind never charge the load directly when a strategy routes them through BESS first — dispatch enforces the priority order set in Phase 1 (${priorityArrayFrom(inp.priority).join(' → ')}).</p>
        <details class="advanced"><summary>Battery technical assumptions</summary>
          <div class="row" style="margin-top:10px;">
            <label class="field"><div class="flabel"><span>Round-trip efficiency</span><span class="fval">${inp.b_rte}%</span></div><input type="range" min="70" max="98" value="${inp.b_rte}" data-bind="inp.b_rte"/></label>
            <label class="field"><div class="flabel"><span>Usable SOC band</span><span class="fval">${inp.b_soc}%</span></div><input type="range" min="50" max="100" value="${inp.b_soc}" data-bind="inp.b_soc"/></label>
          </div>
          <div class="row">
            <label class="field"><div class="flabel"><span>Annual degradation</span><span class="fval">${inp.b_deg}%</span></div><input type="range" min="0" max="8" step="0.1" value="${inp.b_deg}" data-bind="inp.b_deg"/></label>
            <label class="field"><div class="flabel"><span>Replacement at year</span><span class="fval">${inp.b_life}</span></div><input type="range" min="5" max="15" value="${inp.b_life}" data-bind="inp.b_life"/></label>
          </div>
        </details>
      </div>
    </div>

    <div class="viewGrid">
      ${procurementCard('grid','Conventional Grid', inp)}
      ${procurementCard('oa','Open Access', inp)}
      ${procurementCard('gc','Group Captive', inp)}
    </div>
  </div>
  `;
}
function capField(label, bindPath, val, min, max, step, unit){
  return `<label class="field"><div class="flabel"><span>${label}</span><span class="fval">${fmt(val,1)} ${unit}</span></div>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-bind="${bindPath}"/></label>`;
}
function bessCrateOK(c){ if(c.bessMWh<=0) return true; const cr = c.bessMW/c.bessMWh; return cr>=STATE.inp.b_cratemin-1e-9 && cr<=STATE.inp.b_cratemax+1e-9; }

function procurementCard(key, label, inp){
  const cfg = inp.procState[key];
  const baseline = computeFlatBaseline(inp, key);
  return `
  <div class="card">
    <div class="cardHead"><h3>${label} tariff</h3><span class="hint">₹/kWh</span></div>
    <div class="toggleGroup" style="margin-bottom:12px;">
      <button class="${cfg.mode==='flat'?'active':''}" data-action="setTariffMode:${key}:flat">Flat</button>
      <button class="${cfg.mode==='tod'?'active':''}" data-action="setTariffMode:${key}:tod">Time-of-Day</button>
    </div>
    ${key==='grid'? gridChargesEditor(inp) : key==='oa' ? oaChargesEditor(inp) : gcChargesEditor(inp)}
    ${cfg.mode==='tod' ? todSlotEditor(key, cfg, baseline) : ''}
    <details class="advanced"><summary>Custom additional charges (₹/kWh)</summary>
      ${(cfg.customCharges||[]).map((cc,i)=>`
        <div class="rowCard"><input type="text" placeholder="Label" value="${cc.label||''}" data-bind="inp.procState.${key}.customCharges[${i}].label" data-type="text"/>
        <input class="rc-num" type="number" step="0.01" value="${cc.value||0}" data-bind="inp.procState.${key}.customCharges[${i}].value" data-type="number"/>
        <button class="btn ghost sm" data-action="removeCharge:${key}:${i}">✕</button></div>`).join('')}
      <button class="btn sm" style="margin-top:8px;" data-action="addCharge:${key}">+ Add charge (enter 0 if not applicable)</button>
    </details>
  </div>`;
}
function gridChargesEditor(inp){
  return `
  <div class="row"><label class="field"><div class="flabel"><span>Energy charge</span><span class="fval">₹${fmt(inp.g_energy,2)}</span></div><input type="range" min="0" max="15" step="0.05" value="${inp.g_energy}" data-bind="inp.g_energy"/></label>
  <label class="field"><div class="flabel"><span>Demand charge</span><span class="fval">₹${fmt(inp.g_demand,0)}/kVA/mo</span></div><input type="range" min="0" max="1000" step="10" value="${inp.g_demand}" data-bind="inp.g_demand"/></label></div>
  <div class="row"><label class="field"><div class="flabel"><span>Fixed charge</span><span class="fval">₹${fmt(inp.g_fixed,0)}/mo</span></div><input type="range" min="0" max="50000" step="500" value="${inp.g_fixed}" data-bind="inp.g_fixed"/></label>
  <label class="field"><div class="flabel"><span>Excess-demand penalty</span><span class="fval">₹${fmt(inp.g_excess_demand,0)}/kVA</span></div><input type="range" min="0" max="2000" step="10" value="${inp.g_excess_demand}" data-bind="inp.g_excess_demand"/></label></div>
  <div class="row"><label class="field"><div class="flabel"><span>ToD peak surcharge</span><span class="fval">₹${fmt(inp.g_tod,2)}</span></div><input type="range" min="0" max="3" step="0.05" value="${inp.g_tod}" data-bind="inp.g_tod"/></label>
  <label class="field"><div class="flabel"><span>ToD solar-hour rebate</span><span class="fval">₹${fmt(inp.g_solardisc,2)}</span></div><input type="range" min="0" max="3" step="0.05" value="${inp.g_solardisc}" data-bind="inp.g_solardisc"/></label></div>
  <details class="advanced"><summary>FPPCA, taxes &amp; connectivity amortisation</summary>
    <div class="row" style="margin-top:8px;">
      <label class="field"><div class="flabel"><span>FPPCA / fuel surcharge</span><span class="fval">₹${fmt(inp.g_fppca,2)}</span></div><input type="range" min="0" max="2" step="0.05" value="${inp.g_fppca}" data-bind="inp.g_fppca"/></label>
      <label class="field"><div class="flabel"><span>Electricity tax</span><span class="fval">${fmt(inp.g_tax,1)}%</span></div><input type="range" min="0" max="30" step="0.5" value="${inp.g_tax}" data-bind="inp.g_tax"/></label>
    </div>
  </details>`;
}
function oaChargesEditor(inp){
  const fields = [['oa_energy','PPA / energy',0,15,0.05],['oa_trans','Transmission',0,2,0.02],['oa_wheel','Wheeling',0,2,0.02],
    ['oa_css','Cross-subsidy surcharge',0,3,0.02],['oa_addl','Additional surcharge',0,3,0.02],['oa_bank','Banking',0,3,0.02],['oa_sldc','SLDC/scheduling',0,1,0.01]];
  return `<div class="row" style="flex-wrap:wrap;">${fields.map(([k,l,mn,mx,st])=>`
    <label class="field" style="min-width:150px;"><div class="flabel"><span>${l}</span><span class="fval">₹${fmt(inp[k],2)}</span></div><input type="range" min="${mn}" max="${mx}" step="${st}" value="${inp[k]}" data-bind="inp.${k}"/></label>`).join('')}</div>
  <div class="row"><label class="field"><div class="flabel"><span>Transmission &amp; distribution loss add-on</span><span class="fval">${fmt(inp.oa_loss,1)}%</span></div><input type="range" min="0" max="15" step="0.1" value="${inp.oa_loss}" data-bind="inp.oa_loss"/></label>
  <label class="field"><div class="flabel"><span>Min. eligible OA capacity</span><span class="fval">${fmt(inp.oa_min_mw,2)} MW</span></div><input type="range" min="0" max="5" step="0.1" value="${inp.oa_min_mw}" data-bind="inp.oa_min_mw"/></label></div>`;
}
function gcChargesEditor(inp){
  return `<div class="row"><label class="field"><div class="flabel"><span>GC variable / pass-through</span><span class="fval">₹${fmt(inp.gc_charges,2)}</span></div><input type="range" min="0" max="5" step="0.02" value="${inp.gc_charges}" data-bind="inp.gc_charges"/></label>
  <label class="field"><div class="flabel"><span>Min. equity threshold</span><span class="fval">${inp.gc_equity}%</span></div><input type="range" min="0" max="51" value="${inp.gc_equity}" data-bind="inp.gc_equity"/></label></div>
  <label class="field"><div class="flabel"><span>Min. self-consumption threshold</span><span class="fval">${inp.gc_selfcons}%</span></div><input type="range" min="0" max="100" value="${inp.gc_selfcons}" data-bind="inp.gc_selfcons"/></label>`;
}
function todSlotEditor(key, cfg, baseline){
  return `<table class="dataTable" style="margin-top:8px;"><thead><tr><th>Start</th><th>End</th><th class="num">Rate ₹/kWh</th><th></th></tr></thead><tbody>
    ${cfg.slots.map((sl,i)=>`<tr><td><input type="number" min="0" max="24" value="${sl.start}" data-bind="inp.procState.${key}.slots[${i}].start" data-type="number"/></td>
    <td><input type="number" min="0" max="24" value="${sl.end}" data-bind="inp.procState.${key}.slots[${i}].end" data-type="number"/></td>
    <td class="num"><input type="number" step="0.05" value="${sl.rate==null?'':sl.rate}" placeholder="${fmt(baseline,2)}" data-bind="inp.procState.${key}.slots[${i}].rate" data-type="number"/></td>
    <td><button class="btn ghost sm" data-action="removeSlot:${key}:${i}">✕</button></td></tr>`).join('')}
  </tbody></table>
  <button class="btn sm" style="margin-top:8px;" data-action="addSlot:${key}">+ Add time slot</button>`;
}
function setTariffMode(arg){ const [key,mode]=arg.split(':'); STATE.inp.procState[key].mode=mode; render(); }
function addSlot(key){ STATE.inp.procState[key].slots.push({start:0,end:6,rate:null}); render(); }
function removeSlot(arg){ const [key,i]=arg.split(':'); STATE.inp.procState[key].slots.splice(+i,1); render(); }
function addCharge(key){ STATE.inp.procState[key].customCharges.push({label:'', value:0}); render(); }
function removeCharge(arg){ const [key,i]=arg.split(':'); STATE.inp.procState[key].customCharges.splice(+i,1); render(); }
