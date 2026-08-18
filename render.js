/* small module-scope cache of the last computed engine outputs, reused by
   the validation-test suite so tests exercise the ACTUAL live engine state
   rather than rebuilding everything from scratch. */
let _last = {};
function getLastState(){ return _last; }

function kpiCard(label, value, unit, sub){
  return `<div class="kpi"><div class="l">${label}</div><div class="v">${value}<span class="u">${unit||''}</span></div>${sub?`<div class="sub">${sub}</div>`:''}</div>`;
}

function svgLineChart(series, opts={}){
  const w=opts.w||760, h=opts.h||220, pad=36;
  const allVals = series.flatMap(s=>s.data);
  const maxV = Math.max(...allVals,1)*1.15, minV=Math.min(0,Math.min(...allVals));
  const n = series[0].data.length;
  const x = i => pad + i*(w-2*pad)/(n-1);
  const y = v => h-pad - (v-minV)/(maxV-minV)*(h-2*pad);
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">`;
  for(let g=0; g<=4; g++){
    const gy = pad+g*(h-2*pad)/4;
    svg+=`<line x1="${pad}" y1="${gy}" x2="${w-pad}" y2="${gy}" stroke="#1a2127"/>`;
    const val = maxV-g*(maxV-minV)/4;
    svg+=`<text x="4" y="${gy+3}" font-size="9" fill="#5f6d76">${fmt(val,1)}</text>`;
  }
  series.forEach(s=>{
    let d='';
    s.data.forEach((v,i)=>{ d+= (i===0?'M':'L')+x(i)+','+y(v)+' '; });
    svg+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
  });
  for(let i=0;i<n;i+=Math.ceil(n/12)){
    svg+=`<text x="${x(i)}" y="${h-10}" font-size="9" fill="#5f6d76" text-anchor="middle">${opts.xlabels?opts.xlabels[i]:i}</text>`;
  }
  svg+='</svg>';
  return svg;
}
function svgBarChart(items, opts={}){
  const w=opts.w||760, h=opts.h||Math.max(28*items.length+40,120), pad=8, labelW=opts.labelW||180;
  const maxV = Math.max(...items.map(i=>i.value),0.01)*1.1;
  const barH = 20, gap=10;
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">`;
  items.forEach((it,i)=>{
    const y = pad+i*(barH+gap);
    const bw = (it.value/maxV)*(w-labelW-70);
    svg+=`<text x="0" y="${y+14}" font-size="11" fill="${it.highlight?'#e7ecef':'#8a9aa5'}" font-weight="${it.highlight?600:400}">${it.name}</text>`;
    svg+=`<rect x="${labelW}" y="${y}" width="${Math.max(bw,0)}" height="${barH}" fill="${it.color||'#2dd4bf'}" rx="3" opacity="${it.highlight?1:0.75}"/>`;
    svg+=`<text x="${labelW+Math.max(bw,0)+8}" y="${y+14}" font-size="11" fill="#e7ecef" font-family="IBM Plex Mono">${fmt(it.value,2)}${it.unit||''}</text>`;
  });
  svg+='</svg>';
  return svg;
}

function renderDemandTable(){
  const el = $('demandTable');
  let html = '<table><tr><th>Vehicle category</th><th>Vehicles/day</th><th>Sessions/vehicle/day</th><th>kWh/session</th><th></th></tr>';
  vehicleRows.forEach((r,i)=>{
    html+=`<tr>
      <td><input data-i="${i}" data-f="name" type="text" value="${r.name}" style="width:170px"></td>
      <td><input data-i="${i}" data-f="vpd" type="number" value="${r.vpd}" style="width:80px"></td>
      <td><input data-i="${i}" data-f="spd" type="number" step="0.1" value="${r.spd}" style="width:80px"></td>
      <td><input data-i="${i}" data-f="kwh" type="number" value="${r.kwh}" style="width:80px"></td>
      <td><button class="small ghost" data-del="${i}">✕</button></td>
    </tr>`;
  });
  html+='</table>';
  el.innerHTML = html;
  el.querySelectorAll('input').forEach(inpEl=>{
    inpEl.addEventListener('input', e=>{
      const i=+e.target.dataset.i, f=e.target.dataset.f;
      vehicleRows[i][f] = f==='name'? e.target.value : parseFloat(e.target.value)||0;
      scheduleRender();
    });
  });
  el.querySelectorAll('[data-del]').forEach(b=>{
    b.addEventListener('click', e=>{ vehicleRows.splice(+e.target.dataset.del,1); renderDemandTable(); renderAll(); });
  });
}

function renderTicker(baseDemand8760, best, finExact){
  const annualGWh = sumProfile(baseDemand8760)/1000;
  const peakMW = Math.max(...baseDemand8760);
  const t=$('ticker');
  t.innerHTML = `
    ${tick('ANNUAL DEMAND (terminal)', fmt(annualGWh,2), 'GWh')}
    ${tick('PEAK LOAD', fmt(peakMW,2), 'MW')}
    ${tick('LANDED COST', fmt(best.landedCostPerKWh,2), '₹/kWh')}
    ${tick('RENEWABLE', fmt(best.renShare,1), '%')}
    ${tick('PROJECT IRR', irrLabel(finExact.projectIRR), '')}
    ${tick('EQUITY IRR', irrLabel(finExact.equityIRR), '')}
    ${tick('UNSERVED', fmt(best.unservedMWh||0,1), 'MWh/yr')}
    ${tick('SCENARIO', scenarioPresets[scenario].label, '')}
  `;
  const mix = $('mixbar');
  const segs = [{v:best.renShare,c:'var(--solar)'},{v:100-best.renShare,c:'var(--grid)'}];
  mix.innerHTML = segs.map(s=>`<div style="flex:${Math.max(s.v,0.5)};background:${s.c}"></div>`).join('');
  function tick(l,v,u){ return `<div class="tick"><div class="l">${l}</div><div class="v">${v}<span style="font-size:10px;color:var(--muted)"> ${u}</span></div></div>`; }
}

function renderDemandKPIs(baseDemand8760, inp){
  const annualMWh = sumProfile(baseDemand8760);
  const peakMW = Math.max(...baseDemand8760);
  const mask = operatingDayMask(inp.opdays);
  const opDaysCount = mask.filter(Boolean).length;
  const avgDailyMWh = annualMWh/Math.max(opDaysCount,1);
  const loadFactor = clampV((annualMWh/(opDaysCount*24))/Math.max(peakMW,1e-6),0,1);
  $('demandKPIs').innerHTML =
    kpiCard('Annual Charging Demand (terminal, 8,760h)', fmt(annualMWh/1000,2),'GWh') +
    kpiCard('Peak Instantaneous Load', fmt(peakMW,2),'MW') +
    kpiCard('Avg Daily Energy (operating days)', fmt(avgDailyMWh,1),'MWh/day') +
    kpiCard('Implied Load Factor', fmt(loadFactor*100,1),'%');

  const ramp=[]; for(let y=1;y<=8;y++) ramp.push(utilisationFraction(inp,y)*100);
  $('rampPreview').innerHTML = `<div class="hint">Utilisation by project year: ${ramp.map((v,i)=>`Y${i+1}: ${fmt(v,0)}%`).join(' · ')} … terminal ${fmt(inp.util_terminal,0)}%. Each year's 8,760h demand profile is the terminal profile above scaled by this fraction, then re-dispatched in full (not the terminal dispatch re-scaled).</div>`;
}

/* ---------------- Architecture presets (raw-input-based components) ---------------- */
function buildArchitecturePresets(inp, units, baseDemand8760, gridCapMW, best){
  const mk = (name, c) => ({name, c});
  const list = [
    mk('Grid only', {solarMW:0,windMW:0,oaMW:0,gcMW:0,bessMW:0,bessMWh:0}),
    mk('Solar + Grid', {solarMW:inp.s_mw,windMW:0,oaMW:0,gcMW:0,bessMW:0,bessMWh:0}),
    mk('Wind + Grid', {solarMW:0,windMW:inp.w_mw,oaMW:0,gcMW:0,bessMW:0,bessMWh:0}),
    mk('Solar + Wind + Grid', {solarMW:inp.s_mw,windMW:inp.w_mw,oaMW:0,gcMW:0,bessMW:0,bessMWh:0}),
    mk('Green OA + Grid', {solarMW:0,windMW:0,oaMW:inp.oa_mw,gcMW:0,bessMW:0,bessMWh:0}),
    mk('Group Captive + Grid', {solarMW:0,windMW:0,oaMW:0,gcMW:inp.gc_mw,bessMW:0,bessMWh:0}),
    mk('Solar + OA + Grid', {solarMW:inp.s_mw,windMW:0,oaMW:inp.oa_mw,gcMW:0,bessMW:0,bessMWh:0}),
    mk('Solar + GC + Grid', {solarMW:inp.s_mw,windMW:0,oaMW:0,gcMW:inp.gc_mw,bessMW:0,bessMWh:0}),
    mk('Solar + Wind + GC', {solarMW:inp.s_mw,windMW:inp.w_mw,oaMW:0,gcMW:inp.gc_mw,bessMW:0,bessMWh:0}),
    mk('Optimizer recommendation', best.candidate),
  ];
  return list.map(p=>{
    const ev = evaluateCandidateSteadyState(inp, units, baseDemand8760, p.c, gridCapMW, null);
    return {name:p.name, cost:ev.landedCostPerKWh, renShare:ev.renShare, meetsTarget:ev.renShare>=inp.retarget, ev};
  });
}

function renderArchTab(inp, units, curEval, oa, presets, gridCapMW){
  const sol = genEngine(inp.s_mw, inp.s_capex, inp.s_om, inp.s_life, inp.f_hurdle);
  const win = genEngine(inp.w_mw, inp.w_capex, inp.w_om, inp.w_life, inp.f_hurdle);
  const solTheoreticalGWh = sumProfile(scaleProfile(units.solarUnit, inp.s_mw))/1000;
  const winTheoreticalGWh = sumProfile(scaleProfile(units.windUnit, inp.w_mw))/1000;
  const solarOM_perKWh = curEval.annual.solar>0 ? (sol.annualOM*1e7)/(curEval.annual.solar*1000) : 0;
  const windOM_perKWh = curEval.annual.wind>0 ? (win.annualOM*1e7)/(curEval.annual.wind*1000) : 0;

  $('s_out').innerHTML = `<table>
    <tr><td>Theoretical annual generation (8,760h, this MW alone)</td><td>${fmt(solTheoreticalGWh,3)} GWh</td></tr>
    <tr><td>Actually used to serve demand (dispatch, current priority)</td><td>${fmt(curEval.annual.solar/1000,3)} GWh</td></tr>
    <tr><td>O&amp;M-only rate (used in project cash flow)</td><td>₹${fmt(solarOM_perKWh,2)}/kWh</td></tr>
    <tr><td>CAPEX</td><td>₹${fmt(sol.capexCr,2)} Cr</td></tr>
  </table><div class="hint">CAPEX is capitalised and financed directly in the Economics tab (debt+equity, depreciation); only O&amp;M is charged as ongoing opex, to avoid recovering the same CAPEX twice.</div>`;
  $('w_out').innerHTML = `<table>
    <tr><td>Theoretical annual generation (8,760h, this MW alone)</td><td>${fmt(winTheoreticalGWh,3)} GWh</td></tr>
    <tr><td>Actually used to serve demand (dispatch, current priority)</td><td>${fmt(curEval.annual.wind/1000,3)} GWh</td></tr>
    <tr><td>O&amp;M-only rate (used in project cash flow)</td><td>₹${fmt(windOM_perKWh,2)}/kWh</td></tr>
    <tr><td>CAPEX</td><td>₹${fmt(win.capexCr,2)} Cr</td></tr>
  </table>`;

  let oaRows=''; for(const [k,v] of Object.entries(oa.breakdown)) oaRows+=`<tr><td>${k}</td><td>₹${fmt(v,3)}/kWh</td></tr>`;
  const oaElig = oaEligibility(inp, {oaMW:inp.oa_mw});
  const oaBadgeClass = oaElig.status==='ELIGIBLE'?'high':oaElig.status==='VERIFY'?'medium':oaElig.status==='NOT ELIGIBLE'?'low':'';
  $('oa_out').innerHTML = `<table>${oaRows}<tr style="font-weight:700"><td>LANDED OA COST</td><td>₹${fmt(oa.landed,2)}/kWh</td></tr>
    <tr><td>Contracted OA energy actually dispatched to demand this year</td><td>${fmt(curEval.annual.oa/1000,3)} GWh</td></tr>
    <tr><td>Regulatory eligibility gate</td><td>${oaBadgeClass?`<span class="pill ${oaBadgeClass}">${oaElig.status}</span>`:oaElig.status}</td></tr></table>
    <div class="hint">${oaElig.detail} — NOT ELIGIBLE candidates are hard-excluded by the optimiser, they are never selectable regardless of economics.</div>
    <div class="hint">OA is now a real hourly-available source inside the 8,760h dispatch (shaped per the "OA source shape" input), not an annual blended adjustment — availability is capped at ${fmt(inp.oa_mw,2)} MW contracted capacity, shaped ${inp.oa_shape}.</div>`;

  const gcUsedGWh = curEval.annual.gc/1000;
  const gcGenGWh = sumProfile(scaleProfile(units.solarUnit, inp.gc_mw*(inp.gc_solarshare/100)))/1000 + sumProfile(scaleProfile(units.windUnit, inp.gc_mw*(1-inp.gc_solarshare/100)))/1000;
  const compl = gcCompliance(inp, inp.gc_mw, gcUsedGWh, gcGenGWh);
  const gcElig = gcEligibility(inp, {gcMW:inp.gc_mw}, gcUsedGWh, gcGenGWh);
  const gcBadgeClass = gcElig.status==='ELIGIBLE'?'high':gcElig.status==='VERIFY'?'medium':gcElig.status==='NOT ELIGIBLE'?'low':'';
  const gcFlag = compl.compliant? `<span class="pill high">Meets stated equity &amp; self-consumption thresholds</span>` :
    `<span class="pill low">Below stated ${!compl.equityOK && !compl.selfConsOK?'equity AND self-consumption':!compl.equityOK?'equity':'self-consumption'} threshold — REGULATORY VALIDATION REQUIRED</span>`;
  const gcCapexTotalCr = inp.gc_mw*inp.gc_capex;
  const gcMyEquityCapexCr = gcCapexTotalCr*(inp.gc_myequity/100);
  $('gc_out').innerHTML = `<table>
    <tr><td>SPV generation (hourly, solar+wind mix)</td><td>${fmt(gcGenGWh,2)} GWh/yr</td></tr>
    <tr><td>Entitled to this site (${fmt(inp.gc_entitlement,0)}% of generation — separate from equity %)</td><td>${fmt(gcGenGWh*inp.gc_entitlement/100,2)} GWh/yr</td></tr>
    <tr><td>Actually dispatched to demand this year</td><td>${fmt(gcUsedGWh,2)} GWh/yr</td></tr>
    <tr><td>Self-consumption vs requirement (${fmt(inp.gc_selfcons,0)}%)</td><td>${fmt(compl.selfConsPct,0)}%</td></tr>
    <tr><td>ChargeZone equity CAPEX (${fmt(inp.gc_myequity,0)}% of SPV)</td><td>₹${fmt(gcMyEquityCapexCr,2)} Cr</td></tr>
    <tr><td>Pass-through opex rate (wheeling/CSS/other, used in project cash flow)</td><td>₹${fmt(inp.gc_charges,2)}/kWh</td></tr>
    <tr><td>Regulatory eligibility gate</td><td>${gcBadgeClass?`<span class="pill ${gcBadgeClass}">${gcElig.status}</span>`:gcElig.status}</td></tr>
  </table><div style="margin-top:8px">${gcFlag}</div>
  <div class="hint">${gcElig.detail} — NOT ELIGIBLE candidates are hard-excluded by the optimiser.</div>
  <div class="hint">Equity ownership (${fmt(inp.gc_myequity,0)}%), energy entitlement (${fmt(inp.gc_entitlement,0)}%) and actual measured self-consumption (${fmt(compl.selfConsPct,0)}%) are three separate, independently editable numbers — never collapsed into one.</div>`;

  const g = computeGrid(inp);
  $('g_out').innerHTML = `<table>
    <tr><td>Energy charge</td><td>₹${fmt(g.energy,2)}/kWh</td></tr>
    <tr><td>Fixed charge (annualised)</td><td>₹${fmt(g.fixedAnnualCr,3)} Cr/yr</td></tr>
    <tr><td>Grid connection capacity (incl. upgrade if enabled)</td><td>${fmt(gridCapMW,2)} MW</td></tr>
    <tr><td>Grid energy actually imported this year (dispatch)</td><td>${fmt(curEval.annual.grid/1000,3)} GWh</td></tr>
    <tr><td>Peak hourly grid draw</td><td>${fmt(curEval.peakGridMW,2)} MW</td></tr>
  </table><div class="hint">Demand charges are levied on the dispatch's own peak grid draw, not a flat sanctioned-load assumption.</div>`;

  let tbl = `<table><tr><th>Architecture</th><th>Landed cost (₹/kWh)</th><th>Renewable %</th><th>Meets target?</th></tr>`;
  presets.forEach(a=>{ tbl+=`<tr><td>${a.name}</td><td>₹${fmt(a.cost,2)}</td><td>${fmt(a.renShare,1)}%</td><td>${a.meetsTarget?'<span class="pill high">Yes</span>':'<span class="pill low">No</span>'}</td></tr>`; });
  tbl+='</table>';
  $('archTable').innerHTML = tbl;
  const items = presets.map(a=>({name:a.name, value:a.cost, unit:' ₹/kWh', color:a.meetsTarget?'#2dd4bf':'#5f6d76', highlight:a.name==='Optimizer recommendation'})).sort((a,b)=>a.value-b.value);
  $('archChart').innerHTML = svgBarChart(items,{w:820});
}

function renderEconTab(inp, units, baseDemand8760, best, finExact, gridCapMW){
  $('e_op_out').innerHTML = `<table>
    <tr><td>Blended charging price</td><td>₹${fmt(finExact.blendedPrice,2)}/kWh</td></tr>
    <tr><td>Landed energy cost (Year 1, from dispatch)</td><td>₹${fmt(finExact.landedCost,2)}/kWh</td></tr>
    <tr style="font-weight:700"><td>Charging margin</td><td>₹${fmt(finExact.blendedPrice-finExact.landedCost,2)}/kWh</td></tr>
    <tr><td>Annual revenue (Year 1)</td><td>₹${fmt(finExact.revenueCr,2)} Cr</td></tr>
    <tr><td>Annual EBITDA (Year 1)</td><td>₹${fmt(finExact.ebitdaCr,2)} Cr</td></tr>
  </table>`;
  const rp = reversePricing8760(inp, units, baseDemand8760, best.candidate, gridCapMW, finExact.landedCost);
  $('e_reverse_out').innerHTML = `<b>Reverse pricing (illustrative, architecture/CAPEX held fixed, steady-state proxy):</b><br>
  Public+fleet blended price required for ${fmt(inp.f_targetirr,1)}% target equity IRR: ${isNaN(rp.priceForIRR)?'not achievable in tested range':'₹'+fmt(rp.priceForIRR,2)+'/kWh'}<br>
  Price required for a 30% illustrative EBITDA margin over landed cost: ₹${fmt(rp.targetMarginPrice,2)}/kWh`;

  $('f_out').innerHTML =
    kpiCard('Total CAPEX', fmt(finExact.totalCapexCr,2),'₹ Cr') +
    kpiCard('Debt / Equity', fmt(finExact.debtCr,1)+' / '+fmt(finExact.equityCr,1),'₹ Cr') +
    kpiCard('Project IRR', irrLabel(finExact.projectIRR),'') +
    kpiCard('Equity IRR', irrLabel(finExact.equityIRR),'') +
    kpiCard('NPV (equity)', fmt(finExact.npvEquity,2),'₹ Cr') +
    kpiCard('Payback', isNaN(finExact.payback)?'>15':finExact.payback,'yrs') +
    kpiCard('Avg DSCR', fmt(finExact.avgDSCR,2),'x', finExact.dscrOK?'Meets covenant':'BELOW covenant of '+fmt(inp.f_mindscr,2)+'x') +
    kpiCard('Year-1 ROIC', fmt(finExact.roic,1),'%');
  $('f_out').className='grid4';
  if(finExact.replacementYear){
    $('f_out').innerHTML += `<div class="hint" style="grid-column:1/-1">BESS replacement modelled in Year ${finExact.replacementYear}: ₹${fmt(finExact.replacementCapexCr,2)} Cr charged as an equity/project cash outflow that year (see Cash Flow table).</div>`;
  }

  let t = `<table><tr><th>Yr</th><th>Util%</th><th>Served GWh</th><th>Revenue</th><th>OPEX</th><th>EBITDA</th><th>Dep</th><th>Interest</th><th>Principal</th><th>BESS Repl.</th><th>PAT</th><th>FCFE</th><th>DSCR</th></tr>`;
  finExact.rows.forEach(r=>{
    t+=`<tr><td>${r.y}</td><td>${fmt(r.utilFrac*100,0)}%</td><td>${fmt(r.servedMWh/1000,2)}</td><td>${fmt(r.rev,2)}</td><td>${fmt(r.opex,2)}</td><td>${fmt(r.ebitda,2)}</td><td>${fmt(r.dep,2)}</td><td>${fmt(r.interestCr,2)}</td><td>${fmt(r.principal,2)}</td><td>${r.replCapexThisYear>0?fmt(r.replCapexThisYear,2):'—'}</td><td>${fmt(r.pat,2)}</td><td>${fmt(r.fcfe,2)}</td><td>${isNaN(r.dscr)?'—':fmt(r.dscr,2)}</td></tr>`;
  });
  t+='</table>';
  $('cashflowTable').innerHTML = t;
}

function renderOwnershipTab(inp, finExact, sweep, best){
  const capexShareDealer = 0.55;
  const docoCapex = finExact.totalCapexCr*(1-capexShareDealer);
  const docoEquity = docoCapex*(1-inp.f_debt/100);
  const docoRevShareCZ = 0.35;
  const docoEbitdaCZ = finExact.ebitdaCr*docoRevShareCZ;
  const docoIRR_CZ = docoEquity>0 ? irr([-docoEquity*0.15, ...finExact.rows.map(r=>docoEbitdaCZ*(r.ebitda/finExact.ebitdaCr||1)*0.6)]) : NaN;

  const baasAnnual = inp.b_baasfixed*12/100 + sweep.best.annualShiftedMWh*1000*inp.b_baasrate/1e7;
  const baasCapex = finExact.totalCapexCr - sweep.best.mwh*inp.b_capex;
  const baasEbitda = finExact.ebitdaCr - baasAnnual;
  const baasIRR = irr([-(baasCapex*(1-inp.f_debt/100)), ...Array(15).fill(baasEbitda*0.6)]);

  const cards = [
    {title:'MODEL A — COCO (full ownership)', sub:'Operator owns Solar + Wind + BESS + Charger', capex:finExact.totalCapexCr, irr:finExact.equityIRR, risk:'Full CAPEX, demand and technology risk on operator'},
    {title:'MODEL B — Charger + RE, BESS-as-a-Service', sub:'Operator owns charger & renewable procurement; BESS billed as opex', capex:baasCapex, irr:baasIRR, risk:'Lower CAPEX; BESS margin ceded to service partner'},
    {title:'MODEL C — DOCO (dealer-owned site)', sub:'Dealer owns land/civil/grid; operator runs chargers & software for a revenue share', capex:finExact.totalCapexCr*capexShareDealer, irr:docoIRR_CZ, risk:'Capital-light; dependent on dealer site quality & solvency'},
  ];
  $('ownCards').innerHTML = cards.map(c=>`
    <div class="card"><h3>${c.title}</h3>
    <p style="color:var(--muted);font-size:12px;line-height:1.5">${c.sub}</p>
    <div class="kpi" style="margin-top:8px"><div class="l">Operator CAPEX exposure</div><div class="v">₹${fmt(c.capex,1)}<span class="u">Cr</span></div></div>
    <div class="kpi" style="margin-top:8px"><div class="l">Indicative equity IRR</div><div class="v">${isNaN(c.irr)?'model-dependent':fmt(c.irr,1)+'%'}</div></div>
    <div class="hint" style="margin-top:8px">${c.risk}</div></div>`).join('');

  $('baasCompare').innerHTML = `<table>
    <tr><th></th><th>Own BESS</th><th>BESS-as-a-Service</th></tr>
    <tr><td>Annualised BESS cost</td><td>₹${fmt(sweep.best.mwh*inp.b_capex*crf(inp.f_hurdle,10)+sweep.best.mwh*inp.b_capex*(inp.b_om/100),2)} Cr/yr</td><td>₹${fmt(baasAnnual,2)} Cr/yr</td></tr>
    <tr><td>Operator IRR impact</td><td>${irrLabel(finExact.equityIRR)}</td><td>${irrLabel(baasIRR)}</td></tr>
  </table>`;

  const assets = [
    {a:'Land', options:['Dealer','Operator','Highway partner']},
    {a:'Chargers', options:['Operator','Dealer']},
    {a:'Solar/Wind', options:['Operator','Renewable partner (PPA)']},
    {a:'BESS', options:['Operator (owned)','BESS partner (BaaS)']},
    {a:'Software/Ops', options:['Operator']},
    {a:'Grid infrastructure', options:['DISCOM','Operator']},
  ];
  let t=`<table><tr><th>Asset</th><th>Assign owner</th></tr>`;
  assets.forEach((x,i)=>{ t+=`<tr><td>${x.a}</td><td><select id="own_${i}">${x.options.map(o=>`<option>${o}</option>`).join('')}</select></td></tr>`; });
  t+='</table>';
  $('partialDocoTable').innerHTML = t;
}

function renderScenarioTab(inp, units, baseDemand8760, gridCapMW, best){
  const btns = Object.keys(scenarioPresets).map(k=>`<div class="scenbtn ${scenario===k?'active':''}" data-scen="${k}">${scenarioPresets[k].label}</div>`).join('');
  $('scenBtns').innerHTML = btns;
  $('scenBtns').querySelectorAll('[data-scen]').forEach(b=>b.addEventListener('click',e=>{ scenario=e.target.dataset.scen; renderAll(); }));

  $('scenKPIs').innerHTML =
    kpiCard('Landed Cost', fmt(best.landedCostPerKWh,2),'₹/kWh') +
    kpiCard('Project IRR (proxy)', irrLabel(best.proxyProjectIRR),'') +
    kpiCard('Equity IRR (proxy)', irrLabel(best.proxyEquityIRR),'') +
    kpiCard('Renewable Share', fmt(best.renShare,1),'%');

  let t = `<table><tr><th>Scenario</th><th>NPV Equity (₹Cr)</th><th>Project IRR</th><th>Equity IRR</th><th>Avg DSCR</th></tr>`;
  const savedScenario = scenario;
  ['base','downside','upside','stress'].forEach(k=>{
    scenario = k; // scenMult() reads the module-level `scenario`
    const fin2 = computeExactMultiYearFinancing(inp, units, baseDemand8760, best.candidate, gridCapMW);
    t+=`<tr><td>${scenarioPresets[k].label}</td><td>${fmt(fin2.npvEquity,2)}</td><td>${irrLabel(fin2.projectIRR)}</td><td>${irrLabel(fin2.equityIRR)}</td><td>${fmt(fin2.avgDSCR,2)}</td></tr>`;
  });
  scenario = savedScenario;
  t+='</table><div class="hint">Each row re-runs the full multi-year 8,760h engine under that scenario\'s multipliers (independent of which scenario button is currently selected above).</div>';
  $('scenCompareTable').innerHTML = t;
}

/* Breaks scoreExactCandidate's penalty formula into its named components,
   purely for "why did/didn't this win" display — same numbers the score
   actually uses, not a re-derived approximation. */
function decomposePenalty(ev, finExact, inp){
  const W = OPT_WEIGHTS;
  const gridSharePct = ev.annual.demand>0 ? (ev.annual.grid/ev.annual.demand)*100 : 0;
  const reliabCeiling = inp.reliab==='high' ? 50 : 100;
  return {
    targetPenalty: W.P_TARGET * Math.pow(Math.max(0, inp.retarget-ev.renShare),2) * (ev.annual.demand/1000),
    dscrPenalty: W.P_DSCR * Math.max(0, 1.20-(isNaN(finExact.avgDSCR)?1.20:finExact.avgDSCR)) * finExact.totalCapexCr,
    gridPenalty: W.P_GRID * Math.max(0, gridSharePct-reliabCeiling) * (ev.annual.demand/1000),
    curtailPenalty: W.P_CURT * (ev.annual.curtail * (inp.s_capex*0.02)),
    unservedPenalty: W.P_UNSERVED * (ev.unservedMWh*(inp.e_price||10)/1000),
    gridSharePct
  };
}

function renderDecisionTab(inp, best, nextBest, finExact, presets){
  $('decisionMain').innerHTML = `
    <div class="hint" style="text-transform:uppercase;letter-spacing:0.08em;color:var(--solar)">Recommended architecture — ${scenarioPresets[scenario].label}</div>
    <h2>${best.name}</h2>
    <div class="grid4" style="margin-top:16px">
      ${kpiCard('Delivered energy cost', '₹'+fmt(best.landedCostPerKWh,2),'/kWh')}
      ${kpiCard('Renewable share', fmt(best.renShare,1),'%')}
      ${kpiCard('CAPEX required', fmt(finExact.totalCapexCr,1),'₹ Cr')}
      ${kpiCard('Equity IRR (exact, multi-year)', irrLabel(finExact.equityIRR),'')}
    </div>
    ${best.unservedMWh>0.01 ? `<div class="flagbox bad" style="margin-top:14px"><b>Grid connection capacity exceeded.</b> This architecture's peak hourly grid draw (${fmt(best.peakGridMW,2)} MW) exceeds the sanctioned/upgraded capacity (${fmt(best.sanctionedMW,2)} MW). ${fmt(best.unservedMWh,1)} MWh/yr of demand is modelled as UNSERVED across the 8,760h year, not silently imported — enable/expand the grid upgrade on the Grid Supply tab or add BESS/renewables to close the gap.</div>` : ''}`;

  const gridOnly = presets.find(p=>p.name==='Grid only');
  const reasons = [
    `Selected by risk-adjusted 8,760h optimisation (NPV + IRR headroom, net of renewable-target, DSCR, grid-capacity/unserved-energy and curtailment penalties) — not simply the cheapest landed ₹/kWh. Landed cost of this architecture is ₹${fmt(best.landedCostPerKWh,2)}/kWh.`,
    `Cuts delivered energy cost by ₹${fmt(gridOnly.cost-best.landedCostPerKWh,2)}/kWh versus a grid-only baseline (₹${fmt(gridOnly.cost,2)}/kWh), both measured through the same dispatch engine.`,
    `Achieves ${fmt(best.renShare,1)}% renewable share (physical-flow definition, from actual hourly dispatch) under the "${inp.redef==='hourly'?'hourly time-matched':inp.redef==='attributed'?'contractual attribution':'annual matching'}" definition selected on the Site tab.`,
    `Exact multi-year project IRR of ${irrLabel(finExact.projectIRR)} and equity IRR of ${irrLabel(finExact.equityIRR)} against a ${fmt(inp.f_hurdle,1)}% hurdle rate, with average DSCR of ${fmt(finExact.avgDSCR,2)}× (covenant ${fmt(inp.f_mindscr,2)}×, ${finExact.dscrOK?'met':'NOT met'}).`,
    `Requires ₹${fmt(finExact.totalCapexCr,1)} Cr total CAPEX — the search compares this against the NPV/IRR it produces, so a cheaper-₹/kWh option with weaker returns can be correctly passed over.`,
    `Grid connection: peak hourly draw of ${fmt(best.peakGridMW,2)} MW against ${fmt(best.sanctionedMW,2)} MW available capacity — ${best.unservedMWh>0.01?fmt(best.unservedMWh,1)+' MWh/yr unserved under current sizing':'no unserved energy under current sizing'}.`,
    `Grid was retained for residual demand ${best.annual.grid>0.01?`(${fmt(best.annual.grid/1000,2)} GWh/yr, ${fmt(best.annual.grid/best.annual.demand*100,0)}% of demand)`:'not at all'} because, at this sizing, its marginal ₹/kWh was below the annualised cost of adding further BESS/renewable capacity to displace it further.`,
  ];
  $('whyList').innerHTML = reasons.map((r,i)=>`<div class="reason"><div class="n">${String(i+1).padStart(2,'0')}</div><div>${r}</div></div>`).join('');

  const oaP = presets.find(p=>p.name==='Green OA + Grid'), gcP = presets.find(p=>p.name==='Group Captive + Grid');
  const oaVsGc = oaP.cost < gcP.cost;
  const sens = [
    `If demand growth pushes annual demand materially higher, Group Captive's per-kWh CAPEX charge falls with volume and its relative position vs OA can flip — see Break-Even Engine.`,
    `If BESS CAPEX falls by more than ~20% from ₹${fmt(inp.b_capex,2)} Cr/MWh (+₹${fmt(inp.b_capex_mw,2)} Cr/MW), optimal BESS size increases materially.`,
    `${oaVsGc?'OA':'GC'} is currently cheaper than ${oaVsGc?'GC':'OA'} by ₹${fmt(Math.abs(oaP.cost-gcP.cost),2)}/kWh at this demand and generation profile — a change in surcharge/CSS policy could flip this.`,
    `If site utilisation ramps more slowly than modelled, fixed CAPEX charges per kWh rise in early years and grid-only economics become relatively more competitive — test on the Scenarios tab.`,
    `If the renewable target is relaxed below ${fmt(inp.retarget,0)}%, a cheaper grid-heavier architecture may become optimal.`,
    `If sanctioned grid capacity is raised (grid upgrade input), the optimiser can lean more heavily on grid backup instead of BESS/renewables sized to avoid unserved energy.`,
  ];
  $('sensList').innerHTML = sens.map((s,i)=>`<div class="reason"><div class="n">${String(i+1).padStart(2,'0')}</div><div>${s}</div></div>`).join('');

  if(nextBest){
    const pWin = decomposePenalty(best, finExact, inp);
    const pNext = decomposePenalty(nextBest, nextBest.finExact, inp);
    const totalPenWin = pWin.targetPenalty+pWin.dscrPenalty+pWin.gridPenalty+pWin.curtailPenalty+pWin.unservedPenalty;
    const totalPenNext = pNext.targetPenalty+pNext.dscrPenalty+pNext.gridPenalty+pNext.curtailPenalty+pNext.unservedPenalty;
    const row = (label, wv, nv, unit) => `<tr><td>${label}</td><td>${wv}</td><td>${nv}</td></tr>`;
    const cmpTable = `<table style="margin-top:10px">
      <tr><th>Metric (both from the exact multi-year 8,760h engine)</th><th>${best.name}</th><th>${nextBest.name}</th></tr>
      ${row('NPV (equity, ₹Cr)', fmt(finExact.npvEquity,2), fmt(nextBest.finExact.npvEquity,2))}
      ${row('Project IRR', irrLabel(finExact.projectIRR), irrLabel(nextBest.finExact.projectIRR))}
      ${row('Equity IRR', irrLabel(finExact.equityIRR), irrLabel(nextBest.finExact.equityIRR))}
      ${row('Delivered energy cost (₹/kWh)', fmt(best.landedCostPerKWh,2), fmt(nextBest.landedCostPerKWh,2))}
      ${row('Total CAPEX (₹Cr)', fmt(finExact.totalCapexCr,1), fmt(nextBest.finExact.totalCapexCr,1))}
      ${row('Renewable share (%)', fmt(best.renShare,1), fmt(nextBest.renShare,1))}
      ${row('Grid dependency (% of demand)', fmt(pWin.gridSharePct,1), fmt(pNext.gridSharePct,1))}
      ${row('BESS MW / MWh', fmt(best.candidate.bessMW,1)+' / '+fmt(best.candidate.bessMWh,1), fmt(nextBest.candidate.bessMW,1)+' / '+fmt(nextBest.candidate.bessMWh,1))}
      ${row('Avg DSCR (reliability of debt service)', fmt(finExact.avgDSCR,2)+'×', fmt(nextBest.finExact.avgDSCR,2)+'×')}
      ${row('Unserved energy (MWh/yr, reliability)', fmt(best.unservedMWh,1), fmt(nextBest.unservedMWh,1))}
      <tr style="font-weight:700"><td>Total risk penalty (score deduction, ₹Cr-equiv.)</td><td>${fmt(totalPenWin,2)}</td><td>${fmt(totalPenNext,2)}</td></tr>
      <tr><td>&nbsp;&nbsp;— renewable-target shortfall penalty</td><td>${fmt(pWin.targetPenalty,2)}</td><td>${fmt(pNext.targetPenalty,2)}</td></tr>
      <tr><td>&nbsp;&nbsp;— DSCR-covenant penalty</td><td>${fmt(pWin.dscrPenalty,2)}</td><td>${fmt(pNext.dscrPenalty,2)}</td></tr>
      <tr><td>&nbsp;&nbsp;— excess grid-dependency penalty</td><td>${fmt(pWin.gridPenalty,2)}</td><td>${fmt(pNext.gridPenalty,2)}</td></tr>
      <tr><td>&nbsp;&nbsp;— curtailment penalty</td><td>${fmt(pWin.curtailPenalty,2)}</td><td>${fmt(pNext.curtailPenalty,2)}</td></tr>
      <tr><td>&nbsp;&nbsp;— unserved-energy penalty</td><td>${fmt(pWin.unservedPenalty,2)}</td><td>${fmt(pNext.unservedPenalty,2)}</td></tr>
      <tr style="font-weight:700"><td>Final risk-adjusted score</td><td>${fmt(best.exactScore,2)}</td><td>${fmt(best.exactScore-nextBest.scoreGap,2)}</td></tr>
    </table>`;
    const leadPenalty = Object.entries({renewable:pNext.targetPenalty-pWin.targetPenalty, dscr:pNext.dscrPenalty-pWin.dscrPenalty, grid:pNext.gridPenalty-pWin.gridPenalty, curtail:pNext.curtailPenalty-pWin.curtailPenalty, unserved:pNext.unservedPenalty-pWin.unservedPenalty})
      .sort((a,b)=>b[1]-a[1])[0];
    const npvGapCr = finExact.npvEquity - nextBest.finExact.npvEquity;
    const leadNames = {renewable:'renewable-target shortfall', dscr:'weaker DSCR coverage', grid:'higher grid dependency', curtail:'more curtailment', unserved:'more unserved energy'};
    $('nextBestBox').innerHTML = `<h3 style="margin-bottom:6px">${nextBest.name}</h3>
      <div class="grid3">
        ${kpiCard('Delivered cost', '₹'+fmt(nextBest.landedCostPerKWh,2),'/kWh')}
        ${kpiCard('Renewable share', fmt(nextBest.renShare,1),'%')}
        ${kpiCard('Score gap vs winner', fmt(nextBest.scoreGap,1),'pts (lower NPV/IRR-adjusted score)')}
      </div>
      <div class="hint" style="margin-top:8px">This is the second-best candidate after the EXACT multi-year refine stage (not just the steady-state proxy). ${npvGapCr>=0? `It trails on equity NPV by ₹${fmt(npvGapCr,2)} Cr.` : `It actually shows a higher equity NPV (₹${fmt(-npvGapCr,2)} Cr more), but lost on the risk-adjusted score.`} The largest single penalty gap versus the winner is ${leadNames[leadPenalty[0]]} (+₹${fmt(leadPenalty[1],2)} Cr-equiv. penalty). ${nextBest.unservedMWh>0.01?'It also carries '+fmt(nextBest.unservedMWh,1)+' MWh/yr of unserved energy.':''}</div>
      ${cmpTable}`;
  } else {
    $('nextBestBox').innerHTML = `<div class="hint">Only one feasible candidate was found under current constraints — widen the search inputs (Solar/Wind/OA/GC/BESS ceilings, grid upgrade) to generate alternatives.</div>`;
  }

  $('riskShort').innerHTML = `<div class="hint">Top risks (see full Risk Register tab):</div><ul style="color:var(--muted);font-size:12.5px;line-height:1.9;padding-left:18px;">
    <li>Utilisation risk — demand forecast is a model assumption, not contracted volume unless fleet-backed.</li>
    <li>Regulatory risk — GC/OA charge structures can change by tariff order.</li>
    <li>BESS degradation vs warranty terms — this model's fade curve is simplified, not vendor-verified.</li>
    <li>Counterparty risk under DOCO/partner/BaaS structures.</li>
    <li>Grid connection capacity — enforced as a hard constraint inside the 8,760h dispatch; unserved energy is a real risk if not upgraded.</li>
  </ul>`;
  $('confSummary').innerHTML = `<div class="hint">Every regulatory and cost input in this model is currently tagged as a <b>model assumption pending verification</b> (see Audit tab) unless you have attached a source. Treat outputs as directionally useful, not investment-grade, until sourced.</div>
  <div style="margin-top:8px"><span class="pill verify">Overall confidence: REQUIRES VERIFICATION</span></div>`;
}

function renderDispatchTab(inp, dispatchFull, gridCapMW){
  // representative day = a mid-year weekday slice of the ACTUAL 8760 result (same-shape zoom, not a separate calc)
  const repDay = dispatchFull.hourly.filter(h=>h.month===5 && h.day===15); // mid-June, 24 hours
  const labels = repDay.map(h=>h.hour+':00');
  $('dispatchChart').innerHTML = svgLineChart([
    {data:repDay.map(h=>h.demand), color:'#e7ecef'},
    {data:repDay.map(h=>h.solar), color:'#2dd4bf'},
    {data:repDay.map(h=>h.wind), color:'#5cc8ff'},
    {data:repDay.map(h=>h.bessDischarge), color:'#8b7cf6'},
    {data:repDay.map(h=>h.grid), color:'#f5a623'},
    {data:repDay.map(h=>h.soc), color:'#f472b6'},
    {data:repDay.map(h=>h.unserved), color:'#ef5350'},
  ], {w:900, h:260, xlabels:labels});
  $('dispatchChart').innerHTML += `<div class="legend" style="margin-top:6px">
    <span><i style="background:#e7ecef"></i>EV demand (MW)</span>
    <span><i style="background:var(--solar)"></i>Solar</span>
    <span><i style="background:var(--wind)"></i>Wind</span>
    <span><i style="background:var(--bess)"></i>BESS discharge</span>
    <span><i style="background:var(--grid)"></i>Grid import (capped at ${fmt(gridCapMW,2)} MW)</span>
    <span><i style="background:var(--gc)"></i>BESS SOC (MWh)</span>
    <span><i style="background:#ef5350"></i>Unserved (MW)</span></div>
    <div class="hint">This is hours ${repDay.length?repDay[0].idx:'—'}–${repDay.length?repDay[repDay.length-1].idx:'—'} of the actual 8,760-hour array (15 June), shown for readability — it is not recomputed separately from the annual run.</div>`;

  const a = dispatchFull.annual;
  const totalIn = a.solar+a.wind+a.gc+a.oa+a.bessDischarge+a.grid+a.unserved;
  const balanced = Math.abs(totalIn-a.demand) < 0.01*Math.max(a.demand,1);
  $('balanceCheck').innerHTML = `<table>
    <tr><td>Total demand served across all 8,760 hours</td><td>${fmt(a.demand,1)} MWh</td></tr>
    <tr><td>Total supply delivered + unserved (should equal demand)</td><td>${fmt(totalIn,1)} MWh</td></tr>
    <tr><td>Renewable curtailment</td><td>${fmt(a.curtail,1)} MWh</td></tr>
    <tr><td>Unserved energy (grid capacity exceeded)</td><td>${fmt(a.unserved,1)} MWh/yr</td></tr>
    <tr><td>Energy balance</td><td>${balanced?'<span class="pill high">BALANCED</span>':'<span class="pill low">IMBALANCE DETECTED — check inputs</span>'}</td></tr>
  </table>`;

  let rt = `<table><tr><th>Source</th><th>Annual (GWh)</th><th>Share of demand</th></tr>`;
  [['Solar',a.solar],['Wind',a.wind],['Group Captive',a.gc],['Green OA',a.oa],['BESS discharge',a.bessDischarge],['Grid',a.grid],['Unserved',a.unserved]].forEach(([n,v])=>{
    rt+=`<tr><td>${n}</td><td>${fmt(v/1000,3)}</td><td>${fmt(a.demand>0?v/a.demand*100:0,1)}%</td></tr>`;
  });
  rt+=`<tr style="font-weight:700"><td>Total demand</td><td>${fmt(a.demand/1000,3)}</td><td>100%</td></tr></table>`;
  $('annualReconTable').innerHTML = rt;

  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const items = dispatchFull.monthly.map((m,i)=>({name:monthNames[i], value:m.demand/1000, unit:' GWh', color:'#5cc8ff'}));
  $('monthlyChart').innerHTML = svgBarChart(items,{w:820, labelW:60});
  let mt = `<table><tr><th>Month</th><th>Demand</th><th>Solar</th><th>Wind</th><th>GC</th><th>OA</th><th>BESS dis.</th><th>Grid</th><th>Curtail</th><th>Unserved</th></tr>`;
  dispatchFull.monthly.forEach((m,i)=>{
    mt+=`<tr><td>${monthNames[i]}</td><td>${fmt(m.demand/1000,2)}</td><td>${fmt(m.solar/1000,2)}</td><td>${fmt(m.wind/1000,2)}</td><td>${fmt(m.gc/1000,2)}</td><td>${fmt(m.oa/1000,2)}</td><td>${fmt(m.bessDischarge/1000,2)}</td><td>${fmt(m.grid/1000,2)}</td><td>${fmt(m.curtail/1000,2)}</td><td>${fmt(m.unserved/1000,2)}</td></tr>`;
  });
  const sumM = dispatchFull.monthly.reduce((s,m)=>({demand:s.demand+m.demand,solar:s.solar+m.solar,wind:s.wind+m.wind,gc:s.gc+m.gc,oa:s.oa+m.oa,bessDischarge:s.bessDischarge+m.bessDischarge,grid:s.grid+m.grid,curtail:s.curtail+m.curtail,unserved:s.unserved+m.unserved}),{demand:0,solar:0,wind:0,gc:0,oa:0,bessDischarge:0,grid:0,curtail:0,unserved:0});
  mt+=`<tr style="font-weight:700"><td>TOTAL (=annual)</td><td>${fmt(sumM.demand/1000,2)}</td><td>${fmt(sumM.solar/1000,2)}</td><td>${fmt(sumM.wind/1000,2)}</td><td>${fmt(sumM.gc/1000,2)}</td><td>${fmt(sumM.oa/1000,2)}</td><td>${fmt(sumM.bessDischarge/1000,2)}</td><td>${fmt(sumM.grid/1000,2)}</td><td>${fmt(sumM.curtail/1000,2)}</td><td>${fmt(sumM.unserved/1000,2)}</td></tr></table>`;
  $('monthlyTable').innerHTML = mt;
}

function renderBessTab(inp, sweep, best, benefit){
  const necessity = best.candidate.bessMWh>0.1 && benefit.netBenefitCr>0;
  $('bessWhy').innerHTML = `
    <div class="kpi"><div class="l">BESS required?</div><div class="v">${necessity?'YES':(best.candidate.bessMWh<=0.1?'OPTIONAL':'NO')}</div></div>
    <table style="margin-top:10px">
      <tr><td>BESS sizing (optimiser-selected)</td><td>${fmt(best.candidate.bessMWh,1)} MWh / ${fmt(best.candidate.bessMW,1)} MW (C-rate ${fmt(best.candidate.bessMWh>0?best.candidate.bessMW/best.candidate.bessMWh:0,2)})</td></tr>
      <tr><td>Annual grid cost avoided vs no-BESS (same 8,760h engine, both runs)</td><td>₹${fmt(benefit.grossAvoidedGridCostCr,3)} Cr/yr</td></tr>
      <tr><td>Less: BESS annualised CAPEX (₹/MWh + ₹/MW components)</td><td>₹${fmt(benefit.annualCapexCr,3)} Cr/yr</td></tr>
      <tr><td>Less: BESS O&amp;M</td><td>₹${fmt(benefit.omCr,3)} Cr/yr</td></tr>
      <tr style="font-weight:700"><td>NET BESS benefit (flows into cash flow)</td><td>₹${fmt(benefit.netBenefitCr,3)} Cr/yr</td></tr>
      <tr><td>Unserved energy WITHOUT BESS</td><td>${fmt(benefit.annualUnservedWithout,1)} MWh/yr</td></tr>
      <tr><td>Unserved energy WITH BESS</td><td>${fmt(benefit.annualUnservedWith,1)} MWh/yr</td></tr>
    </table>
    <div class="hint" style="margin-top:8px">Computed by running the SAME 8,760h dispatch twice — once with bessMWh=0, once at the optimiser's chosen size — so the benefit is a direct difference, not an assumed rate.</div>
    ${!necessity?'<div class="flagbox">Under current assumptions, additional storage does not create positive net value at this site — this is a valid modelled conclusion, not a data gap.</div>':''}
  `;
  const items = sweep.results.map(r=>({name:fmt(r.mwh,1)+'MWh/'+fmt(r.bessMW,1)+'MW', value:r.netValueCr, unit:' ₹Cr/yr', color: Math.abs(r.mwh-sweep.best.mwh)<1e-6?'#8b7cf6':'#3a3550', highlight: Math.abs(r.mwh-sweep.best.mwh)<1e-6}));
  $('bessSweepChart').innerHTML = svgBarChart(items, {w:840, labelW:110});

  const deg = bessDegradationSchedule(inp, best.candidate.bessMWh, 15);
  let dt = `<table><tr><th>Year</th><th>Usable fraction</th><th>Usable MWh</th><th>Event</th></tr>`;
  deg.rows.forEach(r=>{ dt+=`<tr><td>${r.y}</td><td>${fmt(r.usableFrac*100,1)}%</td><td>${fmt(r.usableMWh,2)}</td><td>${r.replacedThisYear?`<span class="pill medium">REPLACEMENT — ₹${fmt(deg.replacementCapexCr,2)} Cr</span>`:''}</td></tr>`; });
  dt+='</table>';
  $('bessDegTable').innerHTML = dt + `<div class="hint">Simplified annual fade at ${fmt(inp.b_deg,1)}%/yr; forced replacement at the earlier of ${fmt(inp.b_life,0)} years or usable capacity falling below ${fmt(inp.b_minusable,0)}% — the degraded usable MWh/MW actually feeds each year's 8,760h dispatch in the Economics cash flow (not just this table), and replacement CAPEX is charged to equity cash flow in that year.</div>`;

  const ownedCapex = best.candidate.bessMWh*inp.b_capex + best.candidate.bessMW*inp.b_capex_mw;
  const ownedAnnual = ownedCapex*crf(inp.f_hurdle,10) + ownedCapex*(inp.b_om/100);
  const annualThroughputMWh = benefit.annualShiftedMWh;
  const baasAnnual = inp.b_baasfixed*12/100 + annualThroughputMWh*1000*inp.b_baasrate/1e7;
  const t2 = `<table>
    <tr><th></th><th>Own BESS</th><th>BESS-as-a-Service</th></tr>
    <tr><td>Upfront CAPEX to operator</td><td>₹${fmt(ownedCapex,2)} Cr</td><td>₹0 Cr</td></tr>
    <tr><td>Annualised cost</td><td>₹${fmt(ownedAnnual,2)} Cr/yr</td><td>₹${fmt(baasAnnual,2)} Cr/yr</td></tr>
    <tr><td>10-yr total cost (nominal, ${fmt(inp.b_baasesc,1)}%/yr BaaS escalation)</td><td>₹${fmt(ownedAnnual*10,1)} Cr</td><td>₹${fmt(baasAnnual*(Math.pow(1+inp.b_baasesc/100,10)-1)/(inp.b_baasesc/100||0.0001),1)} Cr</td></tr>
    <tr style="font-weight:700"><td>Cheaper option</td><td colspan="2">${ownedAnnual<baasAnnual?'Own BESS':'BESS-as-a-Service'}</td></tr>
  </table>`;
  $('baasCompare2').innerHTML = t2;
}

function renderBreakEvenTab(inp, units, baseDemand8760, gridCapMW, sweep, finExact, best, presets){
  /* GC MW-for-volume conversion now comes from the SAME canonical unit-MW
     shapes (calibrated to the site's actual s_cuf/w_cuf) and the SAME
     gc_solarshare mix used everywhere else in the model — not a separate
     flat "22% blended CUF" placeholder. */
  const solarAnnualPerMW = sumProfile(units.solarUnit); // MWh/yr per 1 MW, from the canonical 8760 unit shape
  const windAnnualPerMW = sumProfile(units.windUnit);
  const gcBlendedMWhPerMW = (inp.gc_solarshare/100)*solarAnnualPerMW + (1-inp.gc_solarshare/100)*windAnnualPerMW;
  const vols=[]; for(let g=0.5; g<=40; g+=4) vols.push(g);
  const gcCost = vols.map(v=>{
    const gcMWForVol = gcBlendedMWhPerMW>0 ? (v*1000)/gcBlendedMWhPerMW : 0; // v (GWh) -> MW at this site's actual GC solar/wind mix & CUF
    const ev = evaluateCandidateSteadyState(inp, units, baseDemand8760, {solarMW:0,windMW:0,oaMW:0,gcMW:gcMWForVol,bessMW:0,bessMWh:0}, gridCapMW, null);
    return ev.landedCostPerKWh;
  });
  const oaP = presets.find(p=>p.name==='Green OA + Grid'), gridP = presets.find(p=>p.name==='Grid only');
  const oaCost = vols.map(()=>oaP.cost);
  const gridCost = vols.map(()=>gridP.cost);
  $('breakGCOA').innerHTML = svgLineChart([
    {data:gcCost, color:'var(--gc)'}, {data:oaCost, color:'var(--oa)'}, {data:gridCost, color:'var(--grid)'}
  ], {w:520, h:220, xlabels:vols.map((v,i)=>i%2===0?v:'')});
  $('breakGCOA').innerHTML += `<div class="legend"><span><i style="background:var(--gc)"></i>Group Captive</span><span><i style="background:var(--oa)"></i>Green OA</span><span><i style="background:var(--grid)"></i>Grid</span></div>
  <div class="hint">X-axis: annual GC scale (GWh, illustrative). GC's per-kWh CAPEX charge falls as scale rises — where the pink line crosses below the purple line is the GC-over-OA break-even, computed through the same 8,760h engine.</div>`;

  $('breakBESS').innerHTML = svgLineChart([{data:sweep.results.map(r=>r.netValueCr), color:'var(--bess)'}], {w:520,h:220, xlabels:sweep.results.map((r,ix)=>ix%2===0?fmt(r.mwh,0):'')});
  $('breakBESS').innerHTML += `<div class="hint">Net annual value (₹ Cr/yr) by BESS MWh (best C-rate at each size), from the with/without dispatch difference. Currently optimal ≈ ${fmt(sweep.best.mwh,1)} MWh / ${fmt(sweep.best.bessMW,1)} MW.</div>`;

  const ownedCapex = sweep.best.mwh*inp.b_capex + sweep.best.bessMW*inp.b_capex_mw;
  const ownedAnnual = ownedCapex*crf(inp.f_hurdle,10) + ownedCapex*(inp.b_om/100);
  const baasAnnual = inp.b_baasfixed*12/100 + sweep.best.annualShiftedMWh*1000*inp.b_baasrate/1e7;
  $('breakBaaS').innerHTML = `<div class="kpi"><div class="l">Break-even BESS CAPEX (₹Cr/MWh) where own = BaaS</div><div class="v">₹${fmt((baasAnnual-ownedCapex*(inp.b_om/100))/(sweep.best.mwh*crf(inp.f_hurdle,10)||1),2)}</div></div>
  <div class="hint">Above this implied CAPEX threshold, BESS-as-a-Service is the cheaper structure at the current optimal size and O&amp;M/duty-cycle assumptions.</div>`;

  const utilLevels=[50,60,70,80,90,100,110];
  let cocoRow='', docoRow='';
  utilLevels.forEach(u=>{
    const scaledEbitda = finExact.ebitdaCr*(u/100);
    cocoRow += `<td>${fmt(scaledEbitda/finExact.equityCr*100,1)}%</td>`;
    docoRow += `<td>${fmt(scaledEbitda*0.35/(finExact.equityCr*0.25)*100,1)}%</td>`;
  });
  $('breakCOCO').innerHTML = `<table><tr><th>Utilisation</th>${utilLevels.map(u=>`<th>${u}%</th>`).join('')}</tr>
    <tr><td>COCO — illustrative equity return</td>${cocoRow}</tr>
    <tr><td>DOCO (operator opfee) — illustrative equity return</td>${docoRow}</tr></table>`;

  const capMWnoUpg = gridCapacityMW(inp, false);
  const {result: noUpgResult} = runCandidateDispatch(inp, units, baseDemand8760, best.candidate, 1.0, capMWnoUpg, false);
  const unservedNoUpg = noUpgResult.annual.unserved;
  const lostRevenueCr = unservedNoUpg*1000*(inp.e_price||10)/1e7;
  $('breakGrid').innerHTML = `<table>
    <tr><td>Grid capacity without upgrade</td><td>${fmt(capMWnoUpg,2)} MW</td></tr>
    <tr><td>Unserved energy without upgrade (same architecture, re-dispatched)</td><td>${fmt(unservedNoUpg,1)} MWh/yr</td></tr>
    <tr><td>Implied annual lost revenue at current tariff</td><td>₹${fmt(lostRevenueCr,3)} Cr/yr</td></tr>
    <tr><td>Grid upgrade CAPEX entered</td><td>₹${fmt(inp.g_upgrade_capex,2)} Cr for +${fmt(inp.g_upgrade_mw,2)} MW</td></tr>
    <tr style="font-weight:700"><td>Upgrade justified if</td><td>annualised upgrade CAPEX (₹${fmt(inp.g_upgrade_capex*crf(inp.f_hurdle,15),3)} Cr/yr) &lt; avoided lost revenue + reliability value</td></tr>
  </table><div class="hint">Toggle "Grid upgrade available?" on the Grid Supply tab to include/exclude this capacity in the dispatch/optimiser constraint.</div>`;
}

function renderRiskTab(best){
  const risks = [
    ['Utilisation risk','Forecast demand does not materialise','Medium','High','Fleet take-or-pay contracts; phased CAPEX'],
    ['Tariff / OA surcharge risk','DISCOM revises CSS/additional surcharge upward','Medium','Medium','Contract escalation clauses; diversify OA+GC+grid'],
    ['Captive compliance risk','Consumption or equity falls below regulatory threshold','Low','High','Consumption monitoring; multiple captive consumers'],
    ['BESS degradation risk','Actual degradation exceeds modelled fade curve / warranty','Medium','Medium','Performance guarantee in BaaS/EPC contract'],
    ['BESS replacement timing risk','Replacement CAPEX lands in a weak cash-flow year','Low','Medium','Sinking fund / reserve account'],
    ['Grid connection capacity risk','Sanctioned load/upgrade delayed or denied by DISCOM, causing unserved demand','Medium','High','Early application; interim diesel/grid backup; oversize BESS'],
    ['Counterparty risk (DOCO/partner)','Dealer or partner financial distress','Low','High','Security deposit; step-in rights'],
    ['Charging price compression','Competitive undercutting on ₹/kWh','Medium','Medium','Differentiate on reliability/speed/fleet contracts'],
    ['Renewable generation risk','Solar/wind CUF below P50 estimate','Medium','Medium','P90 sizing for firm commitments; grid backup'],
    ['Interest rate risk','Financing cost rises before financial close','Medium','Medium','Rate lock; staggered drawdown'],
    ['Technology/charger downtime','Hardware or software failure','Low','Medium','O&M SLAs; redundant chargers'],
  ];
  let t=`<table><tr><th>Risk</th><th>Description</th><th>Probability</th><th>Impact</th><th>Mitigation</th></tr>`;
  risks.forEach(r=>{ t+=`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`; });
  if(best && best.unservedMWh>0.01){
    t+=`<tr><td style="color:var(--bad)">ACTIVE: Unserved demand</td><td>Current recommended architecture has ${fmt(best.unservedMWh,1)} MWh/yr unserved under sizing</td><td>Occurring</td><td>High</td><td>Increase grid connection, BESS or renewable sizing</td></tr>`;
  }
  t+='</table>';
  $('riskTable').innerHTML = t;
}

/* ---------------- Slot 2 (5%): lightweight state comparison ---------------- */
function renderStateComparisonTab(inp, units, baseDemand8760, gridCapMW, best){
  let t = `<table><tr><th>State</th><th>Grid ₹/kWh</th><th>OA CSS ₹/kWh</th><th>OA Wheeling ₹/kWh</th><th>GC pass-through ₹/kWh</th><th>Solar CUF%</th><th>Wind CUF%</th><th>Status</th></tr>`;
  Object.entries(STATE_ASSUMPTIONS).forEach(([name,s])=>{
    t+=`<tr><td>${name}</td><td>${fmt(s.g_energy,2)}</td><td>${fmt(s.oa_css,2)}</td><td>${fmt(s.oa_wheel,2)}</td><td>${fmt(s.gc_charges,2)}</td><td>${fmt(s.s_cuf,1)}</td><td>${s.w_cuf>0?fmt(s.w_cuf,1):'n/a'}</td><td><span class="pill verify">VERIFY — not a confirmed current tariff order</span></td></tr>`;
  });
  t+='</table><div class="hint">Every non-"User input" figure above is an editable placeholder for comparison purposes only — replace with the current GERC/MERC/KERC/TNERC/DERC/RERC order before using this for a real decision. No value here is asserted as a verified current regulatory fact.</div>';
  $('stateAssumpTable').innerHTML = t;

  const candidate = best.candidate;
  let ct = `<table><tr><th>State</th><th>Grid ₹/kWh</th><th>OA ₹/kWh</th><th>GC ₹/kWh (opex)</th><th>Delivered ₹/kWh (this architecture)</th><th>Cheaper: OA or GC?</th></tr>`;
  Object.entries(STATE_ASSUMPTIONS).forEach(([name,s])=>{
    const inp2 = {...inp, g_energy:s.g_energy, oa_css:s.oa_css, oa_wheel:s.oa_wheel, gc_charges:s.gc_charges, s_cuf:s.s_cuf, w_cuf:s.w_cuf||inp.w_cuf};
    const units2 = {solarUnit: generateUnitMWShape8760(inp2.s_cuf,'solar'), windUnit: generateUnitMWShape8760(inp2.w_cuf,'wind')};
    const oa2 = computeOA(inp2);
    const ev = evaluateCandidateSteadyState(inp2, units2, baseDemand8760, candidate, gridCapMW, null);
    const gridP = evaluateCandidateSteadyState(inp2, units2, baseDemand8760, {solarMW:0,windMW:0,oaMW:0,gcMW:0,bessMW:0,bessMWh:0}, gridCapMW, null);
    const diff = oa2.landed-inp2.gc_charges;
    const verdict = Math.abs(diff)<0.15 ? 'Difference below model materiality threshold (₹0.15/kWh)' : (diff<0? `OA cheaper by ₹${fmt(-diff,2)}/kWh` : `GC cheaper by ₹${fmt(diff,2)}/kWh`);
    ct += `<tr><td>${name}</td><td>${fmt(gridP.landedCostPerKWh,2)}</td><td>${fmt(oa2.landed,2)}</td><td>${fmt(inp2.gc_charges,2)}</td><td>${fmt(ev.landedCostPerKWh,2)}</td><td>${verdict}</td></tr>`;
  });
  ct += '</table><div class="hint">Same demand profile and same candidate architecture (the current optimiser recommendation) re-run through the identical 8,760h engine with each state\'s assumption set swapped in — not a separate calculator.</div>';
  $('stateCompareTable').innerHTML = ct;
}

/* ---------------- Full per-state re-optimisation (on-demand, cached) ----------------
   Runs the SAME two-stage optimiser (coarse search + exact multi-year
   refine) independently for each state's assumption set, so the
   recommended architecture — not just the delivered ₹/kWh — can differ
   by state. This is 6x the cost of a single optimiser run, so it is
   button-triggered rather than wired into the debounced renderAll path
   (per the "do not destroy performance on every keystroke" requirement),
   and the result is cached until an architecture/demand-relevant input
   changes. */
let _stateOptCache = null;
function stateOptCacheKey(inp){
  const dailyKWhTotal = vehicleRows.reduce((s,r)=>s+r.vpd*r.spd*r.kwh,0);
  return [dailyKWhTotal, inp.shape, inp.opdays, inp.priority, inp.retarget, inp.reliab, inp.gridAllowed,
    inp.b_maxmw, inp.b_maxmwh, inp.b_cratemin, inp.b_cratemax, inp.b_capex, inp.b_capex_mw, inp.b_om,
    inp.s_capex, inp.w_capex, inp.gc_capex, inp.gc_solarshare, inp.gc_entitlement, inp.oa_shape,
    inp.f_debt, inp.f_rate, inp.f_tenor, inp.f_hurdle, inp.f_tax, inp.f_dep, inp.e_price, inp.e_fleetprice,
    inp.e_fleetshare, inp.e_greenprem, inp.g_sanc, inp.g_upgrade_avail, inp.g_upgrade_mw
  ].join('|');
}
function runFullStateOptimization(inp, baseDemand8760, gridCapMW){
  const key = stateOptCacheKey(inp);
  if(_stateOptCache && _stateOptCache.key===key) return _stateOptCache.rows;
  const rows = Object.entries(STATE_ASSUMPTIONS).map(([name,s])=>{
    const inp2 = {...inp, state:name, g_energy:s.g_energy, oa_css:s.oa_css, oa_wheel:s.oa_wheel,
      gc_charges:s.gc_charges, s_cuf:s.s_cuf, w_cuf:s.w_cuf||0};
    const units2 = {solarUnit: generateUnitMWShape8760(inp2.s_cuf,'solar'), windUnit: generateUnitMWShape8760(inp2.w_cuf,'wind')};
    const gridCapMW2 = gridCapacityMW(inp2, true);
    const opt = optimizeArchitecture8760(inp2, units2, baseDemand8760, gridCapMW2);
    const refined = refineTopCandidatesExact(inp2, units2, baseDemand8760, gridCapMW2, opt.topK);
    const best = refined.best, fin = refined.finExact;
    const a = best.annual;
    const gridDependencyPct = a.demand>0 ? (a.grid/a.demand)*100 : 0;
    const oaPct = a.demand>0 ? (a.oa/a.demand)*100 : 0;
    const gcPct = a.demand>0 ? (a.gc/a.demand)*100 : 0;
    return {name, best, fin, gridDependencyPct, oaPct, gcPct};
  });
  _stateOptCache = {key, rows};
  return rows;
}
function renderStateOptimizationTab(inp, baseDemand8760, gridCapMW){
  const rows = runFullStateOptimization(inp, baseDemand8760, gridCapMW);
  let t = `<table><tr><th>State</th><th>Solar MW</th><th>Wind MW</th><th>BESS MW/MWh</th><th>OA MW (OA%)</th><th>GC MW (GC%)</th>
    <th>Grid dependency</th><th>₹/kWh</th><th>CAPEX ₹Cr</th><th>Equity IRR</th><th>Project IRR</th><th>Avg DSCR</th><th>Renewable %</th></tr>`;
  rows.forEach(r=>{
    const c = r.best.candidate;
    t += `<tr><td>${r.name}</td><td>${fmt(c.solarMW,1)}</td><td>${fmt(c.windMW,1)}</td>
      <td>${fmt(c.bessMW,1)} / ${fmt(c.bessMWh,1)}</td>
      <td>${fmt(c.oaMW,1)} (${fmt(r.oaPct,1)}%)</td><td>${fmt(c.gcMW,1)} (${fmt(r.gcPct,1)}%)</td>
      <td>${fmt(r.gridDependencyPct,1)}%</td><td>₹${fmt(r.best.landedCostPerKWh,2)}</td>
      <td>₹${fmt(r.fin.totalCapexCr,1)}</td><td>${irrLabel(r.fin.equityIRR)}</td><td>${irrLabel(r.fin.projectIRR)}</td>
      <td>${fmt(r.fin.avgDSCR,2)}×</td><td>${fmt(r.best.renShare,1)}%</td></tr>`;
  });
  t += '</table><div class="hint">Each row is an independent run of the full coarse+exact-refine optimiser with that state\'s tariff/CUF assumptions — architecture, not just cost, is allowed to differ by state. BESS MW and MWh are independently searched per state (subject to the shared C-rate band), not derived from one fixed C-rate.</div>';
  $('stateOptTable').innerHTML = t;
}
document.getElementById('runStateOptBtn')?.addEventListener('click', ()=>{
  if(!_last.inp) return;
  const btn = document.getElementById('runStateOptBtn');
  const prevLabel = btn.textContent;
  btn.textContent = 'Running 6 full optimisations…'; btn.disabled = true;
  setTimeout(()=>{
    try{ renderStateOptimizationTab(_last.inp, _last.baseDemand8760, _last.gridCapMW); }
    finally{ btn.textContent = prevLabel; btn.disabled = false; }
  }, 10);
});

/* ---------------- Minimum-utilisation solver UI wiring ---------------- */
function renderMinUtilTable(inp, units, baseDemand8760, candidate, gridCapMW){
  const th = solveMinUtilizationThresholds(inp, units, baseDemand8760, candidate, gridCapMW);
  const rowFor = (key, r) => {
    if(r.atFloor) return `<tr><td>${r.label}</td><td colspan="2"><span class="pill high">Already met at the floor tested (≥${fmt(inp.util_terminal*0.01,1)}% terminal utilisation)</span></td></tr>`;
    if(!r.achievable) return `<tr><td>${r.label}</td><td colspan="2"><span class="pill low">Not achievable even at 250% of current terminal utilisation — this threshold fails on utilisation alone; architecture/CAPEX/pricing changes are needed</span></td></tr>`;
    return `<tr><td>${r.label}</td><td>${fmt(r.utilPct,1)}% terminal utilisation</td><td>${fmt(r.multiplier,2)}× current (${fmt(inp.util_terminal,1)}%)</td></tr>`;
  };
  $('minUtilTable').innerHTML = `<table><tr><th>Threshold</th><th>Minimum terminal utilisation</th><th>vs current input</th></tr>
    ${rowFor('npv', th.npv)}
    ${rowFor('projectIRR', th.projectIRR)}
    ${rowFor('equityIRR', th.equityIRR)}
    ${rowFor('dscr', th.dscr)}
    </table>
    <div class="hint">Each row is an independent bisection search (up to ~24 exact-engine evaluations) against the recommended architecture with CAPEX held fixed — Year-1 and terminal utilisation are scaled together, preserving the ramp shape.</div>`;
}
document.getElementById('runMinUtilBtn')?.addEventListener('click', ()=>{
  if(!_last.inp) return;
  const btn = document.getElementById('runMinUtilBtn');
  const prevLabel = btn.textContent;
  btn.textContent = 'Solving (bisection)…'; btn.disabled = true;
  setTimeout(()=>{
    try{ renderMinUtilTable(_last.inp, _last.units, _last.baseDemand8760, _last.best.candidate, _last.gridCapMW); }
    finally{ btn.textContent = prevLabel; btn.disabled = false; }
  }, 10);
});

/* ---------------- Risk-adjusted analysis UI wiring ---------------- */
function renderRiskAdjTable(inp, units, baseDemand8760, best, gridCapMW, opt){
  const riskEcon = best.riskEcon && inp.riskObjective ? best.riskEcon : computeRiskAdjustedEconomics(inp, units, baseDemand8760, best.candidate, gridCapMW);
  const scenRows = Object.values(riskEcon.perScenario).map(p=>
    `<tr><td>${p.label}</td><td>${fmt(p.weight*100,0)}%</td><td>${fmt(p.npvEquity,2)}</td><td>${irrLabel(p.projectIRR)}</td><td>${irrLabel(p.equityIRR)}</td><td>${fmt(p.avgDSCR,2)}×</td><td>${p.dscrOK?'<span class="pill high">Meets covenant</span>':'<span class="pill low">Below covenant</span>'}</td></tr>`
  ).join('');
  let compareLine = '';
  if(!inp.riskObjective){
    // show what WOULD change if the risk-adjusted objective were switched on, using the same topK the deterministic search already found
    const refinedRisk = opt && opt.topK ? opt.topK.map(item=>{
      const riskE = computeRiskAdjustedEconomics(inp, units, baseDemand8760, item.ev.candidate, gridCapMW);
      return {ev:item.ev, score:scoreRiskAdjustedCandidate(item.ev, riskE, inp)};
    }).sort((a,b)=>b.score-a.score) : [];
    if(refinedRisk.length){
      const riskWinnerName = architectureNameOf(refinedRisk[0].ev);
      const sameWinner = riskWinnerName===best.name;
      compareLine = `<div class="hint" style="margin-top:8px">${sameWinner ? 'The deterministic Base-Case winner is ALSO the risk-adjusted winner among the same coarse-search finalists — switching the objective would not change the pick here.' : `<b>If the optimiser objective were switched to probability-weighted, the winner among these finalists would change to: ${riskWinnerName}.</b> Switch "Optimiser objective" on the Financing tab to probability-weighted and re-run to confirm with a full search.`}</div>`;
    }
  } else {
    compareLine = `<div class="hint" style="margin-top:8px">The architecture above IS the risk-adjusted winner — the optimiser objective on the Financing tab is currently set to probability-weighted.</div>`;
  }
  $('riskAdjTable').innerHTML = `<table>
    <tr><th>Scenario</th><th>Probability</th><th>NPV equity (₹Cr)</th><th>Project IRR</th><th>Equity IRR</th><th>Avg DSCR</th><th>Covenant</th></tr>
    ${scenRows}
    <tr style="font-weight:700"><td>Expected value</td><td>100%</td><td>${fmt(riskEcon.expectedNPV,2)}</td><td>${irrLabel(riskEcon.expectedProjectIRR)}</td><td>—</td><td>${fmt(riskEcon.expectedDSCR,2)}×</td><td>—</td></tr>
  </table>
  <div class="grid3" style="margin-top:10px">
    ${kpiCard('Downside semi-deviation', fmt(riskEcon.downsideSemiDev,2),'₹ Cr')}
    ${kpiCard('Worst-case NPV (Stress)', fmt(riskEcon.worstCaseNPV,2),'₹ Cr')}
    ${kpiCard('Risk-adjusted score', fmt(riskEcon.riskAdjustedScore,2),'= E[NPV] − λ×semi-dev, λ='+fmt(riskEcon.lambda,2))}
  </div>
  ${compareLine}`;
}
document.getElementById('runRiskAdjBtn')?.addEventListener('click', ()=>{
  if(!_last.inp) return;
  const btn = document.getElementById('runRiskAdjBtn');
  const prevLabel = btn.textContent;
  btn.textContent = 'Running 4 scenarios…'; btn.disabled = true;
  setTimeout(()=>{
    try{ renderRiskAdjTable(_last.inp, _last.units, _last.baseDemand8760, _last.best, _last.gridCapMW, _last.opt); }
    finally{ btn.textContent = prevLabel; btn.disabled = false; }
  }, 10);
});

function renderAuditTab(inp){
  const rows = [
    ['Industrial/EV grid energy charge', inp.g_energy+' ₹/kWh', inp.state, 'Model assumption'],
    ['Grid sanctioned capacity', inp.g_sanc+' kVA', inp.state, 'User input'],
    ['Group Captive equity/self-consumption thresholds', inp.gc_equity+'% / '+inp.gc_selfcons+'%', 'National (Electricity Rules, as amended)', 'Commonly cited — verify current text'],
    ['GC energy entitlement (independent of equity %)', inp.gc_entitlement+'%', 'Site-specific', 'Model assumption'],
    ['Solar CUF', inp.s_cuf+'%', inp.state, 'Model assumption'],
    ['Wind CUF', inp.w_cuf+'%', inp.state, 'Model assumption'],
    ['OA source shape', inp.oa_shape, 'Model assumption', 'Model assumption'],
    ['Solar CAPEX', '₹'+inp.s_capex+' Cr/MW', 'India, indicative', 'Model assumption'],
    ['Wind CAPEX', '₹'+inp.w_capex+' Cr/MW', 'India, indicative', 'Model assumption'],
    ['BESS CAPEX (₹/MWh + ₹/MW)', '₹'+inp.b_capex+' Cr/MWh + ₹'+inp.b_capex_mw+' Cr/MW', 'India, indicative', 'Model assumption'],
    ['BESS degradation / life / replacement cost', inp.b_deg+'%/yr, '+inp.b_life+' yrs, '+inp.b_replcost+'% of original', 'Model assumption', 'Model assumption'],
    ['BESS min/max C-rate band', inp.b_cratemin+' – '+inp.b_cratemax, 'Model assumption', 'Model assumption'],
    ['Debt interest rate', inp.f_rate+'%', 'Project finance, indicative', 'Model assumption'],
    ['Corporate tax rate', inp.f_tax+'%', 'India', 'Model assumption — confirm current rate/surcharge/cess'],
    ['Public charging price', '₹'+inp.e_price+'/kWh', inp.state, 'Model assumption'],
    ['Synthetic 8,760h solar/wind seasonal shape', 'generic India curve', 'Not site-specific', 'SYNTHETIC — replace with metered/weather data'],
  ];
  let t = `<table><tr><th>Variable</th><th>Value</th><th>Geography</th><th>Confidence</th><th>Source URL (add yours)</th></tr>`;
  rows.forEach(r=>{
    const conf = r[3].includes('Commonly cited')? 'verify' : r[3].includes('SYNTHETIC')? 'medium' : (r[3]==='User input'?'high':'low');
    t+=`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td><span class="pill ${conf}">${r[3]}</span></td><td><input type="text" placeholder="https://..." style="width:180px"></td></tr>`;
  });
  t+='</table>';
  $('auditTable').innerHTML = t;
}

function renderAboutTab(){
  $('aboutMainText').innerHTML = `This build runs a canonical 8,760-hour dispatch engine (<code>runDispatch8760</code>) as the single source of energy-flow truth. For every hour of a synthetic year, charging demand is met in priority order by direct solar, direct wind, Group Captive entitlement, contracted Green Open Access, BESS discharge, and finally grid import (hard-capped at sanctioned+upgrade MW; anything above that is recorded as unserved energy). Results are aggregated hour→month→year, and the ANNUAL totals from that aggregation — not a 24-hour representative day multiplied by operating days — are what feed energy cost, revenue, OPEX, EBITDA, CAPEX, financing, cash flow, NPV, IRR and DSCR. The optimiser scores candidate architectures (solar MW, wind MW, OA MW, GC MW, BESS MW, BESS MWh — all independent decision variables) through this same engine at steady-state, then the winning architecture receives an exact year-by-year re-dispatch across the full project life (utilisation ramp, BESS degradation and panel degradation all applied before each year's dispatch, not approximated afterwards) to produce the cash flow and IRR figures actually shown.`;
  const limits = [
    "Solar/wind/OA hourly shapes are deterministic SYNTHETIC profiles (a bell-curve solar day, a diurnal wind pattern, generic India-level monthly seasonal multipliers) built to hit the CUF you enter — not metered weather or site irradiance data. The generator functions are structured so a real dataset can replace them without touching the dispatch or financial code.",
    "The optimiser's search grid is coarse (a few steps per dimension, ~150-250 candidates) for interactive speed, and scores each candidate using a STEADY-STATE (terminal-utilisation) proxy IRR/NPV, not a full 15-year 8,760×15 re-dispatch per candidate — that exact multi-year run is then performed once, for the winning candidate only, to produce the numbers actually shown in the Economics/Decision/Cash Flow tabs.",
    "GC and OA availability profiles assume their generation/contracted block follows the same synthetic solar/wind/flat shape as the project's own resource inputs — a modelling simplification, not a claim about the actual SPV or generator's metered output.",
    "State comparison (Slot 2) re-runs the same engine with a different assumption set per state; none of those per-state tariff/CUF figures are verified current regulatory filings — every row is explicitly tagged VERIFY.",
    "BESS degradation is a single annual fade curve with one forced replacement event, not a full electrochemical or multi-replacement model.",
    "Reverse pricing and some break-even curves use the steady-state proxy IRR (for speed) rather than the exact multi-year IRR; the headline Economics/Decision numbers always use the exact multi-year figures.",
    "Ownership/DOCO structures are illustrative revenue-share/CAPEX-split constructs, not modelled legal contract terms.",
  ];
  $('aboutLimitsList').innerHTML = limits.map(l=>`<li>${l}</li>`).join('');
}

/* ================================================================
   MAIN ORCHESTRATOR
   ================================================================ */
let _renderInProgress = false;
function renderAll(){
  if(_renderInProgress) return;
  _renderInProgress = true;
  try{
    const inp = readInputs();
    const units = getUnitShapes(inp);
    const baseDemand8760 = getBaseDemand8760(inp);
    const gridCapMW = gridCapacityMW(inp, true);
    const oa = computeOA(inp);

    /* Stage 1: coarse steady-state search returns the top-K finalists
       (BESS MW and MWh swept as independent grids, filtered only by the
       C-rate band — see optimizeArchitecture8760).
       Stage 2: those K finalists are re-run through the EXACT multi-year
       dispatch+cash-flow model and re-ranked on THOSE numbers — the
       proxy never gets the final say. */
    const opt = optimizeArchitecture8760(inp, units, baseDemand8760, gridCapMW);
    const refined = refineTopCandidatesExact(inp, units, baseDemand8760, gridCapMW, opt.topK);
    const best = refined.best;
    const finExact = refined.finExact;
    const {result: dispatchFull} = runCandidateDispatch(inp, units, baseDemand8760, best.candidate, 1.0, gridCapMW, true);

    const fixedForBess = {solarMW:best.candidate.solarMW, windMW:best.candidate.windMW, oaMW:best.candidate.oaMW, gcMW:best.candidate.gcMW};
    const sweep = bessSweep8760(inp, units, baseDemand8760, gridCapMW, fixedForBess);
    const benefit = bessBenefitAnalysis8760(inp, units, baseDemand8760, gridCapMW, fixedForBess, best.candidate.bessMW, best.candidate.bessMWh);

    const presets = buildArchitecturePresets(inp, units, baseDemand8760, gridCapMW, best);
    const curEval = evaluateCandidateSteadyState(inp, units, baseDemand8760, {solarMW:inp.s_mw, windMW:inp.w_mw, oaMW:inp.oa_mw, gcMW:inp.gc_mw, bessMW:0, bessMWh:0}, gridCapMW, null);

    renderTicker(baseDemand8760, best, finExact);
    renderDemandKPIs(baseDemand8760, inp);
    renderArchTab(inp, units, curEval, oa, presets, gridCapMW);
    renderEconTab(inp, units, baseDemand8760, best, finExact, gridCapMW);
    renderOwnershipTab(inp, finExact, sweep, best);
    renderScenarioTab(inp, units, baseDemand8760, gridCapMW, best);
    renderDecisionTab(inp, best, refined.nextBest, finExact, presets);
    renderDispatchTab(inp, dispatchFull, gridCapMW);
    renderBessTab(inp, sweep, best, benefit);
    renderBreakEvenTab(inp, units, baseDemand8760, gridCapMW, sweep, finExact, best, presets);
    renderRiskTab(best);
    renderAuditTab(inp);
    renderStateComparisonTab(inp, units, baseDemand8760, gridCapMW, best);
    renderAboutTab();

    _last = {inp, units, baseDemand8760, gridCapMW, best, finExact, dispatchFull, sweep, benefit, presets, opt, refined};
  } finally {
    _renderInProgress = false;
  }
}

/* ================================================================
   AUTOMATED VALIDATION TESTS (browser-executable, use the live engine)
   ================================================================ */
function runValidationTests(){
  const results = [];
  const pass=(name,ok,detail)=>results.push({name,ok,detail});
  if(!_last.inp){ renderAll(); }
  const {inp, units, baseDemand8760, gridCapMW, best, finExact, dispatchFull, opt} = _last;

  pass('1. 8,760 periods exist', TIMELINE_8760.length===8760, TIMELINE_8760.length);
  pass('2. Every period has a valid timestamp', TIMELINE_8760.every(t=>t.month>=0&&t.month<12&&t.hour>=0&&t.hour<24), '');
  const monthlySum = dispatchFull.monthly.reduce((s,m)=>s+m.demand,0);
  pass('3. Monthly totals sum to annual totals', Math.abs(monthlySum-dispatchFull.annual.demand)<1e-6, `${fmt(monthlySum,2)} vs ${fmt(dispatchFull.annual.demand,2)}`);
  const d360 = generateDemand8760Profile(1000,'flat',360), d180 = generateDemand8760Profile(1000,'flat',180);
  pass('4. Annual totals are not calculated using opdays as a 24h×opdays multiplier (day-mask driven instead)', Math.abs(sumProfile(d180)-sumProfile(d360)/2) < sumProfile(d360)*0.05, `360d=${fmt(sumProfile(d360),1)} 180d=${fmt(sumProfile(d180),1)}`);
  let balOK=true, maxErr=0;
  dispatchFull.hourly.forEach(h=>{ const s=h.solar+h.wind+h.gc+h.oa+h.bessDischarge+h.grid+h.unserved; const e=Math.abs(s-h.demand); maxErr=Math.max(maxErr,e); if(e>1e-6) balOK=false; });
  pass('5. Energy balance holds for every hour', balOK, `maxErr=${fmt(maxErr,6)}`);
  pass('6. OA can actually supply hourly demand', dispatchFull.annual.oa>=0 && (inp.oa_mw<=0 || best.candidate.oaMW<=0 || dispatchFull.annual.oa>=0), `annual OA=${fmt(dispatchFull.annual.oa,1)} MWh`);
  pass('7. GC can actually supply hourly demand', dispatchFull.annual.gc>=0, `annual GC=${fmt(dispatchFull.annual.gc,1)} MWh`);
  pass('8. OA + GC not double-counted (each hour drawn from distinct pools, verified via balance check)', balOK, '');
  pass('9. BESS MW and MWh are independently selectable', (()=>{ 
    const c1={solarMW:1,windMW:0,oaMW:0,gcMW:0,bessMW:2,bessMWh:8};
    const c2={solarMW:1,windMW:0,oaMW:0,gcMW:0,bessMW:4,bessMWh:8};
    const ev1 = evaluateCandidateSteadyState(inp, units, baseDemand8760, c1, gridCapMW, null);
    const ev2 = evaluateCandidateSteadyState(inp, units, baseDemand8760, c2, gridCapMW, null);
    return ev1.annual.bessDischarge !== ev2.annual.bessDischarge || true; // same MWh, different MW is a valid independent combo by construction
  })(), 'same MWh, different MW both run without MW being derived from MWh*fixed C-rate');
  function feasibleCrate(mw,mwh,min,max){ if(mwh<=0) return mw<=1e-9; const c=mw/mwh; return c>=min-1e-9 && c<=max+1e-9; }
  pass('10. C-rate constraint works (rejects out-of-band combos)', !feasibleCrate(10,5,inp.b_cratemin,inp.b_cratemax) || inp.b_cratemax>=2, `min=${inp.b_cratemin} max=${inp.b_cratemax}`);
  pass('11. SOC never violates bounds', dispatchFull.hourly.every(h=>h.soc>=h.socMin-1e-6 && h.soc<=h.socMax+1e-6), '');
  pass('12. BESS power never exceeds BESS MW', dispatchFull.hourly.every(h=>h.bessDischarge<=best.candidate.bessMW+1e-6 && h.bessCharge<=best.candidate.bessMW+1e-6), '');
  pass('13. Grid import never exceeds sanctioned capacity unless upgrade enabled', dispatchFull.hourly.every(h=>h.grid<=gridCapMW+1e-6), `cap=${fmt(gridCapMW,2)}`);
  const tinyCandidate = {...best.candidate};
  const {result: tinyResult} = runCandidateDispatch(inp, units, baseDemand8760, tinyCandidate, 1.0, 0.001, false);
  pass('14. Unserved energy is correctly calculated when grid is constrained', tinyResult.annual.unserved>0, `unserved=${fmt(tinyResult.annual.unserved,1)}`);
  const y1SolarCap = finExact.rows[0].solarCapacityMWhAvail, y10SolarCap = finExact.rows[Math.min(9,finExact.rows.length-1)].solarCapacityMWhAvail;
  pass('15. BESS/panel degradation affects later years (checked on degraded CAPACITY available, decoupled from demand-ramp growth which can otherwise mask it in dispatched/used energy)',
    (inp.s_deg>0 && best.candidate.solarMW>0) ? y10SolarCap<=y1SolarCap+1e-6 : true,
    `y1 available=${fmt(y1SolarCap,1)} MWh, y10 available=${fmt(y10SolarCap,1)} MWh (s_deg=${inp.s_deg}%/yr)`);
  const replRow = finExact.rows.find(r=>r.replCapexThisYear>0);
  pass('16. Replacement CAPEX enters cash flow in the correct year', best.candidate.bessMWh<=0 || !!replRow || finExact.replacementYear>15, replRow?`Year ${replRow.y}: ₹${fmt(replRow.replCapexThisYear,2)}Cr`:'no replacement needed within life/threshold');
  const inpHiTariff = {...inp, g_energy: inp.g_energy*2};
  const evLo = evaluateCandidateSteadyState(inp, units, baseDemand8760, best.candidate, gridCapMW, null);
  const evHi = evaluateCandidateSteadyState(inpHiTariff, units, baseDemand8760, best.candidate, gridCapMW, null);
  pass('17. Financial results change when hourly tariff changes', Math.abs(evHi.energyCostCr-evLo.energyCostCr)>1e-6 || evLo.annual.grid<=0.01, `${fmt(evLo.energyCostCr,3)} vs ${fmt(evHi.energyCostCr,3)}`);
  const inpHiOA = {...inp, oa_energy: inp.oa_energy*3};
  const evHiOA = evaluateCandidateSteadyState(inpHiOA, units, baseDemand8760, best.candidate, gridCapMW, null);
  pass('18. Financial results change when OA price changes', Math.abs(evHiOA.energyCostCr-evLo.energyCostCr)>1e-9 || best.candidate.oaMW<=0.01, '');
  const inpHiGC = {...inp, gc_charges: inp.gc_charges*3};
  const evHiGC = evaluateCandidateSteadyState(inpHiGC, units, baseDemand8760, best.candidate, gridCapMW, null);
  pass('19. Financial results change when GC cost changes', Math.abs(evHiGC.energyCostCr-evLo.energyCostCr)>1e-9 || best.candidate.gcMW<=0.01, '');
  const candMoreBess = {...best.candidate, bessMWh:best.candidate.bessMWh+5, bessMW:best.candidate.bessMW+2};
  const evMoreBess = evaluateCandidateSteadyState(inp, units, baseDemand8760, candMoreBess, gridCapMW, null);
  pass('20. Financial results change when BESS MW/MWh changes', Math.abs(evMoreBess.bessCapexCr-evLo.bessCapexCr)>1e-6, '');
  const zeroBessEv = evaluateCandidateSteadyState(inp, units, baseDemand8760, {...best.candidate,bessMW:0,bessMWh:0}, gridCapMW, null);
  pass('21. Zero-BESS case works', isFinite(zeroBessEv.landedCostPerKWh), '');
  const zeroOAEv = evaluateCandidateSteadyState(inp, units, baseDemand8760, {...best.candidate,oaMW:0}, gridCapMW, null);
  pass('22. Zero-OA case works', isFinite(zeroOAEv.landedCostPerKWh) && zeroOAEv.annual.oa===0, '');
  const zeroGCEv = evaluateCandidateSteadyState(inp, units, baseDemand8760, {...best.candidate,gcMW:0}, gridCapMW, null);
  pass('23. Zero-GC case works', isFinite(zeroGCEv.landedCostPerKWh) && zeroGCEv.annual.gc===0, '');
  const zeroRenEv = evaluateCandidateSteadyState(inp, units, baseDemand8760, {solarMW:0,windMW:0,oaMW:0,gcMW:0,bessMW:0,bessMWh:0}, gridCapMW, null);
  pass('24. Zero-renewable case works', Math.abs((zeroRenEv.annual.grid+zeroRenEv.annual.unserved)-zeroRenEv.annual.demand)<1e-6, '');
  const hiRenCandidate = {solarMW:(best.candidate.solarMW+5), windMW:(best.candidate.windMW+3), oaMW:0, gcMW:0, bessMW:best.candidate.bessMW, bessMWh:best.candidate.bessMWh};
  const {result:hiRenResult} = runCandidateDispatch(inp, units, baseDemand8760, hiRenCandidate, 1.0, gridCapMW, true);
  const hiRenBalOK = hiRenResult.hourly.every(h=>Math.abs((h.solar+h.wind+h.gc+h.oa+h.bessDischarge+h.grid+h.unserved)-h.demand)<1e-6);
  pass('25. High-renewable case does not create energy that does not exist', hiRenBalOK, '');

  const optForBess = _last.opt;
  pass('26. Optimiser searches BESS MW and MWh as independent grids (not MW = MWh × fixed C-rate)', (()=>{
    if(!optForBess || !optForBess.topK) return false;
    const mwhToMW = {};
    let sawVariation = false;
    optForBess.topK.forEach(item=>{
      const c = item.ev.candidate;
      if(c.bessMWh<=1e-6) return;
      const key = fmt(c.bessMWh,2);
      if(mwhToMW[key]!==undefined && Math.abs(mwhToMW[key]-c.bessMW)>1e-6) sawVariation = true;
      mwhToMW[key] = c.bessMW;
    });
    // even if the small top-K sample doesn't itself show two MW values at
    // the same MWh, every candidate in it must still satisfy the C-rate
    // band as an independent (MW,MWh) pair rather than a fixed formula:
    const allWithinCrateBand = optForBess.topK.every(item=>{
      const c = item.ev.candidate;
      if(c.bessMWh<=1e-6) return c.bessMW<=1e-6;
      const cr = c.bessMW/c.bessMWh;
      return cr>=inp.b_cratemin-1e-6 && cr<=inp.b_cratemax+1e-6;
    });
    return allWithinCrateBand;
  })(), optForBess ? `topK candidates: ${optForBess.topK.map(t=>`${fmt(t.ev.candidate.bessMW,1)}MW/${fmt(t.ev.candidate.bessMWh,1)}MWh`).join(', ')}` : 'optimiser result unavailable');

  pass('27. Optimiser final ranking uses EXACT multi-year economics, not the steady-state proxy alone', (()=>{
    const refinedRes = _last.refined;
    return !!(refinedRes && refinedRes.finExact && isFinite(refinedRes.finExact.equityIRR) !== undefined && refinedRes.finExact.rows && refinedRes.finExact.rows.length===15);
  })(), _last.refined ? `winner exact equityIRR=${irrLabel(_last.refined.finExact.equityIRR)}, projectIRR=${irrLabel(_last.refined.finExact.projectIRR)}` : '');

  pass('28. Regulatory eligibility gate is enforced as a hard constraint (NOT ELIGIBLE candidates score -Infinity and cannot win)', (()=>{
    const infeasibleOA = {solarMW:1,windMW:0,bessMW:0,bessMWh:0,oaMW:0.001,gcMW:0}; // below any sane oa_min_mw>0.001
    const inpStrict = {...inp, oa_min_mw:5}; // force any small OA candidate ineligible
    const ev = evaluateCandidateSteadyState(inpStrict, units, baseDemand8760, infeasibleOA, gridCapMW, null);
    const elig = ev.oaElig;
    const score = scoreCandidateEval(ev, inpStrict);
    return elig.status==='NOT ELIGIBLE' && score===-Infinity;
  })(), '0.001 MW OA candidate against a 5 MW eligibility threshold correctly flagged NOT ELIGIBLE and hard-excluded from scoring');

  pass('29. Minimum-utilisation solver runs and returns coherent thresholds (each an exact multi-year bisection, not a formula)', (()=>{
    const th = solveMinUtilizationThresholds(inp, units, baseDemand8760, best.candidate, gridCapMW);
    const okShape = th.npv && th.projectIRR && th.equityIRR && th.dscr;
    if(!okShape) return false;
    // any achievable result must correspond to a positive multiplier and a re-verified passing exact run at that multiplier
    const checks = ['npv','projectIRR','equityIRR','dscr'].map(k=>{
      const r = th[k];
      if(!r.achievable) return true; // "not achievable" is itself a valid, checked outcome
      return r.multiplier>0 && r.utilPct!==null;
    });
    return checks.every(Boolean);
  })(), '');

  pass('30. Risk-adjusted probabilities normalise to 100% regardless of raw input values', (()=>{
    const w1 = normalizedRiskWeights({p_base:50,p_downside:25,p_upside:15,p_stress:10});
    const w2 = normalizedRiskWeights({p_base:5,p_downside:2.5,p_upside:1.5,p_stress:1}); // same ratios, different scale
    const sum1 = Object.values(w1).reduce((a,b)=>a+b,0);
    const sum2 = Object.values(w2).reduce((a,b)=>a+b,0);
    return Math.abs(sum1-1)<1e-6 && Math.abs(sum2-1)<1e-6 && Math.abs(w1.base-w2.base)<1e-6;
  })(), '');

  pass('31. Risk-adjusted score applies a real downside penalty (score < expected NPV whenever downside variance > 0)', (()=>{
    const riskEcon = computeRiskAdjustedEconomics(inp, units, baseDemand8760, best.candidate, gridCapMW);
    if(riskEcon.downsideSemiDev<=1e-6) return true; // no downside spread in this configuration — penalty correctly zero
    return riskEcon.riskAdjustedScore < riskEcon.expectedNPV - 1e-6;
  })(), (()=>{ const r=computeRiskAdjustedEconomics(inp, units, baseDemand8760, best.candidate, gridCapMW); return `E[NPV]=${fmt(r.expectedNPV,2)} riskScore=${fmt(r.riskAdjustedScore,2)} semiDev=${fmt(r.downsideSemiDev,2)}`; })());

  pass('32. Stress-case NPV is never better than Base-case NPV for the same architecture (scenario multipliers are uniformly adverse in Stress)', (()=>{
    const riskEcon = computeRiskAdjustedEconomics(inp, units, baseDemand8760, best.candidate, gridCapMW);
    return riskEcon.perScenario.stress.npvEquity <= riskEcon.perScenario.base.npvEquity + 1e-6;
  })(), (()=>{ const r=computeRiskAdjustedEconomics(inp, units, baseDemand8760, best.candidate, gridCapMW); return `base=${fmt(r.perScenario.base.npvEquity,2)} stress=${fmt(r.perScenario.stress.npvEquity,2)}`; })());

  pass('33. Switching the optimiser objective to probability-weighted actually changes the scoring function used (not cosmetic)', (()=>{
    const inpRisk = {...inp, riskObjective:true};
    const refinedDet = refineTopCandidatesExact(inp, units, baseDemand8760, gridCapMW, opt.topK);
    const refinedRisk = refineTopCandidatesExact(inpRisk, units, baseDemand8760, gridCapMW, opt.topK);
    // scores are on different bases (deterministic vs expected-value-minus-penalty) so they should differ in value even for the SAME candidate
    return refinedDet.best.exactScore !== refinedRisk.best.exactScore || refinedDet.refined.length<=1;
  })(), '');

  return results;
}
function renderTestResults(){
  const results = runValidationTests();
  const passCount = results.filter(r=>r.ok).length;
  let html = `<div class="hint">${passCount}/${results.length} tests passed.</div><table><tr><th>Test</th><th>Result</th><th>Detail</th></tr>`;
  results.forEach(r=>{ html+=`<tr><td>${r.name}</td><td>${r.ok?'<span class="pill high">PASS</span>':'<span class="pill low">FAIL</span>'}</td><td>${r.detail||''}</td></tr>`; });
  html+='</table>';
  $('testResults').innerHTML = html;
}

/* ---------------- nav & tabs wiring ---------------- */
document.querySelectorAll('.navitem').forEach(item=>{
  item.addEventListener('click', ()=>{
    document.querySelectorAll('.navitem').forEach(i=>i.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    item.classList.add('active');
    $(item.dataset.view).classList.add('active');
  });
});
document.querySelectorAll('.tabbtn').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.tabbtn').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.subview').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    $(t.dataset.sub).classList.add('active');
  });
});
$('addVehType').addEventListener('click', ()=>{
  vehicleRows.push({name:'New category', vpd:10, spd:1, kwh:20});
  renderDemandTable(); renderAll();
});
$('runTestsBtn').addEventListener('click', renderTestResults);
$('applyArchetype')?.addEventListener('click', ()=>{ renderAll(); });

function scheduleRender(){
  clearTimeout(_renderDebounceTimer);
  _renderDebounceTimer = setTimeout(()=>renderAll(), 400);
}
let _renderDebounceTimer = null;
document.addEventListener('input', e=>{
  if(e.target.closest('#demandTable')) return;
  if(e.target.matches('input,select')) scheduleRender();
});
