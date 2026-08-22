/* ============================================================
   ENERGYNEX — CALCULATION LAYER
   DOM-free port of edhara.js's compute functions. Formulas are
   preserved as-is; only the input plumbing changes: instead of
   reading global DOM fields via readInputs(), everything here
   takes an explicit `inp` state object (see defaultInputs()).
   ============================================================ */
const fmt = (n, d=2) => { if(!isFinite(n)) return "—"; return Number(n).toLocaleString('en-IN',{maximumFractionDigits:d,minimumFractionDigits:0}); };
const clampV = clamp; // alias, engine.js already defines `clamp`

/* ---------------- scenario presets ---------------- */
const scenarioPresets = {
  base:     {util:1.00, grid:1.00, bess:1.00, price:1.00, interest:0,   ren:1.00, label:"Base Case"},
  downside: {util:0.80, grid:1.05, bess:1.10, price:0.92, interest:100, ren:0.90, label:"Downside"},
  upside:   {util:1.20, grid:0.97, bess:0.90, price:1.08, interest:-50, ren:1.05, label:"Upside"},
  stress:   {util:0.70, grid:1.30, bess:1.25, price:0.85, interest:300, ren:0.85, label:"Stress Case"},
};
function scenMult(inp){
  const p = scenarioPresets[inp.scenario] || scenarioPresets.base;
  return {
    util:   p.util   * (1+(inp.st_util||0)/100),
    grid:   p.grid   * (1+(inp.st_grid||0)/100),
    bess:   p.bess   * (1+(inp.st_bess||0)/100),
    price:  p.price  * (1+(inp.st_price||0)/100),
    interest: p.interest + (inp.st_int||0),
    ren:    p.ren    * (1+(inp.st_ren||0)/100),
  };
}

/* ---------------- indicative state benchmarks (editable starting points) ---------------- */
const STATE_BENCHMARKS = {
  "Gujarat":      {g_energy:8.10, oa_css:1.33, oa_wheel:0.24, oa_addl:0.76, oa_bank:1.50, gc_charges:1.35, s_cuf:19.5, w_cuf:26.0},
  "Rajasthan":    {g_energy:6.90, oa_css:1.35, oa_wheel:0.70, oa_addl:0.40, oa_bank:1.10, gc_charges:1.20, s_cuf:21.5, w_cuf:22.0},
  "Maharashtra":  {g_energy:8.10, oa_css:1.55, oa_wheel:1.05, oa_addl:0.50, oa_bank:1.20, gc_charges:1.75, s_cuf:18.5, w_cuf:20.0},
  "Karnataka":    {g_energy:7.60, oa_css:1.40, oa_wheel:0.95, oa_addl:0.45, oa_bank:1.15, gc_charges:1.60, s_cuf:18.0, w_cuf:24.0},
  "Tamil Nadu":   {g_energy:7.80, oa_css:1.20, oa_wheel:0.90, oa_addl:0.40, oa_bank:1.10, gc_charges:1.55, s_cuf:17.5, w_cuf:28.0},
  "Delhi":        {g_energy:8.40, oa_css:1.65, oa_wheel:1.15, oa_addl:0.55, oa_bank:1.25, gc_charges:1.85, s_cuf:17.0, w_cuf:0.0},
  "Uttar Pradesh":{g_energy:7.20, oa_css:1.30, oa_wheel:0.85, oa_addl:0.40, oa_bank:1.10, gc_charges:1.45, s_cuf:17.8, w_cuf:15.0},
  "Telangana":    {g_energy:7.90, oa_css:1.35, oa_wheel:0.90, oa_addl:0.45, oa_bank:1.15, gc_charges:1.55, s_cuf:18.8, w_cuf:16.0},
};

/* ---------------- finance primitives ---------------- */
function crf(ratePct, years){ const r=ratePct/100; if(r===0) return 1/years; return r*Math.pow(1+r,years)/(Math.pow(1+r,years)-1); }
function npv(ratePct, flows){ const r=ratePct/100; return flows.reduce((s,cf,t)=>s+cf/Math.pow(1+r,t),0); }
function irrLabel(v){ if(isNaN(v)) return '—'; if(!isFinite(v)) return '>2000%'; return fmt(v,1)+'%'; }
function irr(flows){
  let lo=-0.99, hi=20.0;
  const f = r => flows.reduce((s,cf,t)=>s+cf/Math.pow(1+r,t),0);
  let flo=f(lo), fhi=f(hi);
  if(isNaN(flo)||isNaN(fhi)) return NaN;
  if(flo*fhi>0) return flo>0 ? Infinity : NaN;
  for(let i=0;i<100;i++){
    const mid=(lo+hi)/2, fm=f(mid);
    if(Math.abs(fm)<1e-6) return mid*100;
    if(flo*fm<0){ hi=mid; fhi=fm; } else { lo=mid; flo=fm; }
  }
  return ((lo+hi)/2)*100;
}
function genEngine(mw, capexCrPerMW, omLakhPerMW, life, hurdlePct){
  const capexCr = mw*capexCrPerMW;
  const annualCapexCharge = capexCr>0 ? capexCr*crf(hurdlePct,life) : 0;
  const annualOM = mw*omLakhPerMW/100;
  return {capexCr, annualCapexCharge, annualOM};
}

/* ---------------- misc helpers ---------------- */
function priorityArrayFrom(key){
  if(key==='solar-wind-oa-gc-bess-grid') return ['solar','wind','oa','gc','bess','grid'];
  if(key==='solar-wind-bess-gc-oa-grid') return ['solar','wind','bess','gc','oa','grid'];
  return ['solar','wind','gc','oa','bess','grid'];
}
function utilisationFraction(inp, year){
  const y1 = clampV(inp.util_y1,0,1000)/100, term = clampV(inp.util_terminal,0,1000)/100;
  const rampY = Math.max(inp.util_rampyears,1);
  if(year>=rampY) return term;
  const t = (year-1)/rampY;
  if(inp.util_shape==='scurve'){ const s=t*t*(3-2*t); return y1+(term-y1)*s; }
  return y1 + (term-y1)*t;
}
function parseHourList(str){
  if(!str) return [];
  return String(str).split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isFinite(n)&&n>=0&&n<24);
}
function customChargeSum(list){ return (list||[]).reduce((s,c)=>s+(parseFloat(c.value)||0),0); }

/* ---------------- procurement pathways: OA / Grid / GC ---------------- */
function computeOA(inp){
  const base = inp.oa_energy+inp.oa_trans+inp.oa_wheel+inp.oa_css+inp.oa_addl+inp.oa_bank+inp.oa_sldc+inp.oa_tax;
  const landed0 = base/(1-inp.oa_loss/100);
  const extra = customChargeSum(inp.procState.oa.customCharges);
  const landed = extra===0 ? landed0 : landed0 + extra/(1-inp.oa_loss/100);
  return {landed, breakdown:{
    "PPA / energy":inp.oa_energy,"Transmission":inp.oa_trans,"Wheeling":inp.oa_wheel,"Cross-subsidy surcharge":inp.oa_css,
    "Additional surcharge":inp.oa_addl,"Banking":inp.oa_bank,"SLDC/scheduling":inp.oa_sldc,"Taxes/levies":inp.oa_tax,
    "Loss add-on":landed0-base, ...(extra? {"Custom charges":extra/(1-inp.oa_loss/100)}:{})
  }};
}
function gridCapacityMW(inp, includeUpgrade){
  const base = inp.g_sanc/1000;
  if(includeUpgrade && inp.g_upgrade_avail) return base+inp.g_upgrade_mw;
  return base;
}
function computeGridCostEngine(inp, gridMWhAnnual, peakGridMW){
  const m = scenMult(inp);
  const hourWeights = shapeArray(inp.shape);
  const PEAK_HOURS = [7,8,9,10,18,19,20,21];
  const SOLAR_HOURS = [11,12,13,14,15,16];
  let peakW=0, solarW=0;
  PEAK_HOURS.forEach(h=>peakW+=hourWeights[h]);
  SOLAR_HOURS.forEach(h=>solarW+=hourWeights[h]);
  const baseEnergyRate = inp.g_energy*m.grid;
  const touAdj = peakW*(inp.g_tod||0) - solarW*(inp.g_solardisc||0);
  const fppcaRate = (inp.g_fppca||0)*m.grid;
  const effectiveEnergyRate = (baseEnergyRate+touAdj+fppcaRate)*(1+inp.g_tax/100);
  const sanctionedMW = (inp.g_sanc||0)/1000;
  const billableKVA = Math.max(peakGridMW,0)*1000;
  const normalKVA = Math.min(billableKVA, sanctionedMW*1000);
  const excessKVA = Math.max(billableKVA-sanctionedMW*1000, 0);
  const demandChargeAnnualCr = (inp.g_demand*normalKVA*12)/1e7;
  const excessDemandChargeAnnualCr = (inp.g_excess_demand*excessKVA*12)/1e7;
  const fixedAnnualCr = (inp.g_fixed*12)/1e7;
  const extra = customChargeSum(inp.procState.grid.customCharges);
  const demandFixedPerKWh = gridMWhAnnual>0 ? ((demandChargeAnnualCr+excessDemandChargeAnnualCr+fixedAnnualCr)*1e7*(1+inp.g_tax/100))/(gridMWhAnnual*1e6) : 0;
  const connAmortRate = inp.g_conn_amort||0;
  const effectivePerKWh = effectiveEnergyRate+demandFixedPerKWh+connAmortRate+extra;
  const totalAnnualCostCr = (effectivePerKWh*gridMWhAnnual*1000)/1e7;
  return {
    baseEnergyRate, touAdj, fppcaRate, effectiveEnergyRate, demandChargeAnnualCr, excessDemandChargeAnnualCr, excessKVA, fixedAnnualCr,
    connAmortRate, customChargeRate:extra, demandFixedPerKWh, effectivePerKWh, totalAnnualCostCr, peakHourWeight:peakW, solarHourWeight:solarW,
    allocationNote:'Demand + excess-demand + fixed charges are apportioned over this architecture\'s own annual grid-import energy from the dispatch. ToU peak/solar-hour incidence uses the site\'s demand SHAPE as an hour-weighting proxy, not a full hour-by-hour ToU billing pass — a model allocation assumption, not a regulatory fact.'
  };
}
function gridRatePerKWh(inp, gridMWhAnnual, peakGridMW){ return computeGridCostEngine(inp, gridMWhAnnual, peakGridMW).effectivePerKWh; }
function gcCompliance(inp, gcMW, gcAnnualUsedGWh, gcAnnualGenGWh){
  const equityOK = inp.gc_myequity>=inp.gc_equity;
  const selfConsPct = gcAnnualGenGWh>0 ? clampV((gcAnnualUsedGWh/gcAnnualGenGWh)*100,0,999) : 0;
  const selfConsOK = selfConsPct>=inp.gc_selfcons;
  return {equityOK, selfConsOK, compliant:equityOK&&selfConsOK, selfConsPct};
}
function oaEligibility(inp, candidate){
  if(candidate.oaMW<=1e-6) return {status:'N/A', detail:'No Open Access capacity proposed for this candidate'};
  if(inp.oa_min_mw<=1e-6) return {status:'VERIFY', detail:'No minimum-capacity threshold configured — set the threshold or confirm eligibility manually against the state open-access regulation'};
  if(candidate.oaMW < inp.oa_min_mw) return {status:'NOT ELIGIBLE', detail:`${fmt(candidate.oaMW,2)} MW is below the configured minimum eligible OA capacity of ${fmt(inp.oa_min_mw,2)} MW`};
  return {status:'ELIGIBLE', detail:`${fmt(candidate.oaMW,2)} MW meets the configured ${fmt(inp.oa_min_mw,2)} MW minimum-capacity threshold. Voltage-level / consumer-category / distance criteria are not modeled and still require confirmation.`};
}
function gcEligibility(inp, candidate, gcAnnualUsedMWh, gcAnnualGenMWh){
  if(candidate.gcMW<=1e-6) return {status:'N/A', detail:'No Group Captive capacity proposed for this candidate', compliant:true, selfConsPct:0};
  const compl = gcCompliance(inp, candidate.gcMW, gcAnnualUsedMWh, gcAnnualGenMWh);
  if(!compl.equityOK) return {status:'NOT ELIGIBLE', detail:`Equity stake ${fmt(inp.gc_myequity,1)}% is below the configured minimum captive-consumer equity threshold of ${fmt(inp.gc_equity,1)}%`, compliant:false, selfConsPct:compl.selfConsPct};
  if(!compl.selfConsOK) return {status:'NOT ELIGIBLE', detail:`Actual self-consumption ${fmt(compl.selfConsPct,1)}% (from dispatch) is below the configured minimum of ${fmt(inp.gc_selfcons,1)}%`, compliant:false, selfConsPct:compl.selfConsPct};
  return {status:'ELIGIBLE', detail:`Equity ${fmt(inp.gc_myequity,1)}%≥${fmt(inp.gc_equity,1)}% and self-consumption ${fmt(compl.selfConsPct,1)}%≥${fmt(inp.gc_selfcons,1)}% both meet the configured thresholds. Confirm threshold values against the current Electricity Rules.`, compliant:true, selfConsPct:compl.selfConsPct};
}
function computeGCFullyLoaded(inp, gcMW, gcConsumedMWh, gcElig){
  const life = (inp.s_life*(inp.gc_solarshare/100) + inp.w_life*(1-inp.gc_solarshare/100)) || 25;
  const omBlendLakhPerMW = (inp.s_om*(inp.gc_solarshare/100) + inp.w_om*(1-inp.gc_solarshare/100));
  const gcCapexTotalCr = gcMW*inp.gc_capex;
  const myShare = clampV(inp.gc_myequity,0,100)/100;
  const gcMyCapexCr = gcCapexTotalCr*myShare;
  const capexAnnualCr = gcMyCapexCr>0 ? gcMyCapexCr*crf(inp.f_hurdle, life) : 0;
  const omAnnualCr = gcMW*myShare*omBlendLakhPerMW/100;
  const captiveOK = !!(gcElig && gcElig.compliant);
  const cssApplied = captiveOK ? 0 : inp.oa_css;
  const addlApplied = captiveOK ? 0 : inp.oa_addl;
  const gcMWh = Math.max(gcConsumedMWh,0);
  const capexPerKWh = gcMWh>1e-6 ? (capexAnnualCr*1e7)/(gcMWh*1000) : 0;
  const omPerKWh = gcMWh>1e-6 ? (omAnnualCr*1e7)/(gcMWh*1000) : 0;
  const extra = customChargeSum(inp.procState.gc.customCharges);
  const variableBase = inp.oa_wheel + inp.oa_bank + inp.oa_sldc + inp.gc_charges + cssApplied + addlApplied;
  const variableLanded = variableBase/(1-inp.oa_loss/100);
  const lossAddOn = variableLanded-variableBase;
  const customLanded = extra>0 ? extra/(1-inp.oa_loss/100) : 0;
  const deliveredPerKWh = capexPerKWh+omPerKWh+variableLanded+customLanded;
  return {
    captiveOK, capexAnnualCr, omAnnualCr, capexPerKWh, omPerKWh, variableLanded, deliveredPerKWh,
    breakdown:{
      "Generation CAPEX (annualised, equity share)":capexPerKWh, "O&M (equity share)":omPerKWh,
      "Wheeling":inp.oa_wheel, "Banking":inp.oa_bank, "SLDC/scheduling":inp.oa_sldc,
      "GC variable/pass-through charges":inp.gc_charges,
      "Cross-subsidy surcharge":cssApplied, "Additional surcharge":addlApplied,
      "Loss add-on":lossAddOn, ...(customLanded? {"Custom charges":customLanded}:{})
    },
    note: captiveOK
      ? 'Captive benefit assumed: CSS/Additional Surcharge waived — the eligibility gate (equity ≥ threshold AND self-consumption ≥ threshold, checked against ACTUAL dispatch) is currently met.'
      : 'Captive benefit NOT available: CSS/Additional Surcharge applied because the captive-eligibility gate is not currently met.'
  };
}

/* ---------------- hourly tariff build (for BESS scheduling + ToD display) ---------------- */
function computeFlatBaseline(inp, key){
  if(key==='grid') return inp.g_energy*scenMult(inp).grid;
  if(key==='oa')   return computeOA(inp).landed;
  if(key==='gc')   return inp.gc_charges;
  return 0;
}
function buildAllTariffs(inp){
  const tariffs = {};
  ['grid','oa','gc'].forEach(key=>{
    const cfg = inp.procState[key];
    const baseline = computeFlatBaseline(inp, key);
    const slots = (cfg.slots||[]).map(sl=>({start:sl.start, end:sl.end, rate:(sl.rate==null||sl.rate==='')?baseline:parseFloat(sl.rate)}));
    tariffs[key] = buildHourlyTariff(cfg.mode, baseline, slots);
  });
  return tariffs;
}

/* ---------------- demand / RE unit shapes ---------------- */
function getUnitShapes(inp){
  const solarUnit = generateUnitMWShape8760(inp.s_cuf,'solar');
  const windUnit = generateUnitMWShape8760(inp.w_cuf,'wind');
  return {solarUnit, windUnit};
}
function getBaseDemand8760(inp){
  const dailyKWhTotal = inp.vehicles.reduce((s,r)=>s+r.vpd*r.spd*r.kwh,0);
  return generateDemand8760Profile(dailyKWhTotal, inp.shape, inp.opdays);
}
function mulScalar(profile, k){ const out=new Float64Array(profile.length); for(let i=0;i<profile.length;i++) out[i]=profile[i]*k; return out; }
function sumProfile(p){ let s=0; for(let i=0;i<p.length;i++) s+=p[i]; return s; }

function buildCandidateProfiles(inp, units, baseDemand8760, candidate, utilFrac){
  const m = scenMult(inp);
  const demand = utilFrac===1 ? baseDemand8760 : mulScalar(baseDemand8760, utilFrac);
  const solar = mulScalar(scaleProfile(units.solarUnit, candidate.solarMW), m.ren);
  const wind = mulScalar(scaleProfile(units.windUnit, candidate.windMW), m.ren);
  const oaAvail = generateOA8760Profile(candidate.oaMW, inp.oa_shape, units.solarUnit, units.windUnit);
  const gc = generateGC8760Profiles(candidate.gcMW, inp.gc_solarshare, units.solarUnit, units.windUnit, inp.gc_entitlement);
  return {demand, solar, wind, gcAvail:gc.availProfile, oaAvail, gcGenProfile:gc.genProfile};
}
function dispatchParamsFor(inp, candidate, gridCapMW){
  const bandHalfGapPct = (100-inp.b_soc)/2/100;
  const chargeEff = Math.sqrt(inp.b_rte/100), dischargeEff = chargeEff;
  const tariffs = buildAllTariffs(inp);
  return {
    priorityOrder: priorityArrayFrom(inp.priority),
    bessMW: candidate.bessMW, bessMWh: candidate.bessMWh,
    socMinFrac: bandHalfGapPct, socMaxFrac: 1-bandHalfGapPct,
    chargeEff, dischargeEff, gridCapMW, tariffs,
    bessStrategy: inp.bessOp.strategy, bessChargeSources: inp.bessOp.chargeSources,
    customWindows: { chargeHours: parseHourList(inp.bessOp.customWindows.chargeHours), dischargeHours: parseHourList(inp.bessOp.customWindows.dischargeHours) }
  };
}
function runCandidateDispatch(inp, units, baseDemand8760, candidate, utilFrac, gridCapMW, collectHourly){
  const profiles = buildCandidateProfiles(inp, units, baseDemand8760, candidate, utilFrac);
  const params = dispatchParamsFor(inp, candidate, gridCapMW);
  const result = runDispatch8760(profiles, params, collectHourly);
  return {result, profiles};
}

/* ---------------- steady-state single-year evaluation ---------------- */
function evaluateCandidateSteadyState(inp, units, baseDemand8760, candidate, gridCapMW){
  const {result, profiles} = runCandidateDispatch(inp, units, baseDemand8760, candidate, 1.0, gridCapMW, false);
  const a = result.annual;
  const servedMWh = a.demand - a.unserved;
  const renShare = a.demand>0 ? ((a.solar+a.wind+a.gc+a.oa+a.bessDischarge)/a.demand)*100 : 0;
  const gcGenAnnualMWh = sumProfile(profiles.gcGenProfile);
  const sol = genEngine(candidate.solarMW, inp.s_capex, inp.s_om, inp.s_life, inp.f_hurdle);
  const win = genEngine(candidate.windMW, inp.w_capex, inp.w_om, inp.w_life, inp.f_hurdle);
  const gcCapexTotalCr = candidate.gcMW*inp.gc_capex;
  const gcMyEquityCapexCr = gcCapexTotalCr*(inp.gc_myequity/100);
  const oa = computeOA(inp);
  const gridRate = gridRatePerKWh(inp, a.grid, result.peakGridMW);
  const solarOM_perKWh = a.solar>0 ? (sol.annualOM*1e7)/(a.solar*1000) : 0;
  const windOM_perKWh = a.wind>0 ? (win.annualOM*1e7)/(a.wind*1000) : 0;
  const gcOpexRate = inp.gc_charges;
  const oaRate = oa.landed;
  const energyCostCr = (a.solar*solarOM_perKWh + a.wind*windOM_perKWh + a.gc*gcOpexRate + a.oa*oaRate + a.grid*gridRate)*1000/1e7;
  const m = scenMult(inp);
  const bessCapexCr = candidate.bessMWh*inp.b_capex*m.bess + candidate.bessMW*inp.b_capex_mw*m.bess;
  const bessAnnualCr = bessCapexCr*crf(inp.f_hurdle,10) + bessCapexCr*(inp.b_om/100);
  const siteCapexCr = inp.e_chargercapex+inp.e_gridcapex+inp.e_civilcapex+(inp.g_upgrade_avail?inp.g_upgrade_capex:0);
  const renCapexCr = sol.capexCr+win.capexCr+gcMyEquityCapexCr;
  const totalCapexCr = (renCapexCr+bessCapexCr+siteCapexCr)*(1+inp.e_contg/100);
  const blendedPrice = (inp.e_price*(1-inp.e_fleetshare/100)+inp.e_fleetprice*(inp.e_fleetshare/100)+inp.e_greenprem)*m.price;
  const revenueCr = servedMWh*1000*blendedPrice/1e7;
  const omTotalCr = sol.annualOM+win.annualOM+bessAnnualCr+(siteCapexCr*0.03);
  const ebitdaCr = revenueCr - energyCostCr - omTotalCr;
  const landedCostPerKWh = servedMWh>0 ? (energyCostCr*1e7)/(servedMWh*1000) : 0;
  const debtCr = totalCapexCr*inp.f_debt/100, equityCr = totalCapexCr-debtCr;
  const rate = inp.f_rate + m.interest/100;
  const emiAnnualCr = debtCr>0 ? debtCr*crf(rate, inp.f_tenor) : 0;
  const interestY1 = debtCr*rate/100;
  const depY1 = totalCapexCr*inp.f_dep/100;
  const pbt = ebitdaCr-depY1-interestY1;
  const tax = Math.max(pbt,0)*inp.f_tax/100;
  const patY1 = pbt-tax;
  const proxyFlows = [-equityCr]; for(let y=1;y<=15;y++) proxyFlows.push(patY1+depY1-(emiAnnualCr-interestY1));
  const proxyEquityIRR = irr(proxyFlows);
  const proxyProjectFlows = [-totalCapexCr, ...Array(15).fill(ebitdaCr*(1-inp.f_tax/100)+depY1*inp.f_tax/100)];
  const proxyProjectIRR = irr(proxyProjectFlows);
  const proxyNPV = npv(inp.f_hurdle, proxyFlows);
  const dscrY1 = (interestY1+(emiAnnualCr-interestY1))>0 ? ebitdaCr/(interestY1+(emiAnnualCr-interestY1)) : NaN;
  const oaElig = oaEligibility(inp, candidate);
  const gcElig = gcEligibility(inp, candidate, a.gc, gcGenAnnualMWh);
  const gridFull = computeGridCostEngine(inp, a.grid, result.peakGridMW);
  const gcFull = computeGCFullyLoaded(inp, candidate.gcMW, a.gc, gcElig);
  const solarFullPerKWh = a.solar>0 ? solarOM_perKWh + (sol.annualCapexCharge*1e7)/(a.solar*1000) : 0;
  const windFullPerKWh = a.wind>0 ? windOM_perKWh + (win.annualCapexCharge*1e7)/(a.wind*1000) : 0;
  const fullyLoadedCostCr = (a.solar*solarFullPerKWh + a.wind*windFullPerKWh + a.gc*gcFull.deliveredPerKWh + a.oa*oa.landed + a.grid*gridFull.effectivePerKWh)*1000/1e7;
  const fullyLoadedCostPerKWh = servedMWh>0 ? (fullyLoadedCostCr*1e7)/(servedMWh*1000) : 0;
  return {
    candidate, annual:a, servedMWh, renShare, unservedMWh:a.unserved, peakGridMW:result.peakGridMW, peakGridNeedMW:result.peakGridNeedMW,
    sanctionedMW:gridCapMW, totalCapexCr, equityCr, debtCr, revenueCr, energyCostCr, omTotalCr, ebitdaCr,
    landedCostPerKWh, proxyEquityIRR, proxyProjectIRR, proxyNPV, dscrY1,
    gcMyEquityCapexCr, gcCapexTotalCr, bessCapexCr, blendedPrice, gcGenAnnualMWh, oaElig, gcElig,
    oaLandedPerKWh: oa.landed, gridFull, gcFull, solarFullPerKWh, windFullPerKWh, fullyLoadedCostPerKWh
  };
}
function architectureNameOf(ev){
  const c = ev.candidate; const parts=[];
  if(c.solarMW>0.01) parts.push(`${fmt(c.solarMW,1)} MW Solar`);
  if(c.windMW>0.01) parts.push(`${fmt(c.windMW,1)} MW Wind`);
  if(c.oaMW>0.01) parts.push(`${fmt(c.oaMW,1)} MW Green OA`);
  if(c.gcMW>0.01) parts.push(`${fmt(c.gcMW,1)} MW Group Captive`);
  if(c.bessMWh>0.01) parts.push(`${fmt(c.bessMWh,1)} MWh / ${fmt(c.bessMW,1)} MW BESS`);
  if(ev.annual.grid>0.01) parts.push('Grid backup');
  return parts.length? parts.join(' + ') : 'Grid only';
}

/* ---------------- BESS degradation + 15-yr exact financing ---------------- */
function bessDegradationSchedule(inp, bessMWh, years){
  const rows = []; let usableFrac=1.0, replaced=false, replacementYear=null;
  for(let y=1;y<=years;y++){
    usableFrac *= (1-inp.b_deg/100);
    const life_exceeded = y>=inp.b_life;
    const below_min = usableFrac*100 < inp.b_minusable;
    if(!replaced && (life_exceeded||below_min)){ replaced=true; replacementYear=y; usableFrac=1.0; }
    rows.push({y, usableFrac, usableMWh:bessMWh*usableFrac, replacedThisYear:replacementYear===y});
  }
  const replacementCapexCr = bessMWh*inp.b_capex*(inp.b_replcost/100);
  return {rows, replacementYear, replacementCapexCr};
}
function computeExactMultiYearFinancing(inp, units, baseDemand8760, candidate, gridCapMW){
  const m = scenMult(inp);
  const life=15;
  const sol = genEngine(candidate.solarMW, inp.s_capex, inp.s_om, inp.s_life, inp.f_hurdle);
  const win = genEngine(candidate.windMW, inp.w_capex, inp.w_om, inp.w_life, inp.f_hurdle);
  const gcCapexTotalCr = candidate.gcMW*inp.gc_capex;
  const gcMyEquityCapexCr = gcCapexTotalCr*(inp.gc_myequity/100);
  const oa = computeOA(inp);
  const siteCapexCr = inp.e_chargercapex+inp.e_gridcapex+inp.e_civilcapex+(inp.g_upgrade_avail?inp.g_upgrade_capex:0);
  const bessCapexCr = candidate.bessMWh*inp.b_capex*m.bess + candidate.bessMW*inp.b_capex_mw*m.bess;
  const renCapexCr = sol.capexCr+win.capexCr+gcMyEquityCapexCr;
  const totalCapexCr = (renCapexCr+bessCapexCr+siteCapexCr)*(1+inp.e_contg/100);
  const debtCr = totalCapexCr*inp.f_debt/100;
  const equityCr = totalCapexCr-debtCr;
  const rate = inp.f_rate + m.interest/100;
  const emiAnnualCr = debtCr>0 ? debtCr*crf(rate, inp.f_tenor) : 0;
  const blendedPrice = (inp.e_price*(1-inp.e_fleetshare/100)+inp.e_fleetprice*(inp.e_fleetshare/100)+inp.e_greenprem)*m.price;
  const degSched = bessDegradationSchedule(inp, candidate.bessMWh, life);
  const oaRate = oa.landed;
  const gcOpexRate = inp.gc_charges;
  let bookValue = totalCapexCr, debtBal = debtCr;
  const flowsEquity=[-equityCr]; const yearRows=[];
  for(let y=1;y<=life;y++){
    const utilFrac = clampV(utilisationFraction(inp, y)*m.util, 0, 3);
    const solDegFactor = Math.pow(1-inp.s_deg/100, y-1);
    const winDegFactor = Math.pow(1-inp.w_deg/100, y-1);
    const bessUsableFrac = degSched.rows[y-1].usableFrac;
    const yUnits = {solarUnit: units.solarUnit, windUnit: units.windUnit};
    const yCandidate = { solarMW: candidate.solarMW*solDegFactor, windMW: candidate.windMW*winDegFactor,
      bessMW: candidate.bessMW*bessUsableFrac, bessMWh: candidate.bessMWh*bessUsableFrac, oaMW: candidate.oaMW, gcMW: candidate.gcMW };
    const {result} = runCandidateDispatch(inp, yUnits, baseDemand8760, yCandidate, utilFrac, gridCapMW, false);
    const a = result.annual;
    const servedMWh = a.demand - a.unserved;
    const solarOM_perKWh = a.solar>0 ? (sol.annualOM*1e7)/(a.solar*1000) : 0;
    const windOM_perKWh = a.wind>0 ? (win.annualOM*1e7)/(a.wind*1000) : 0;
    const gridRate = gridRatePerKWh(inp, a.grid, result.peakGridMW);
    const energyCostCr = (a.solar*solarOM_perKWh + a.wind*windOM_perKWh + a.gc*gcOpexRate + a.oa*oaRate + a.grid*gridRate)*1000/1e7;
    const rev = servedMWh*1000*blendedPrice/1e7 * Math.pow(1+inp.growth/100, Math.min(y-1,0));
    const bessOMCr = bessCapexCr*(inp.b_om/100);
    const siteOMCr = siteCapexCr*0.03;
    const opex = energyCostCr + sol.annualOM + win.annualOM + bessOMCr + siteOMCr;
    const ebitda = rev-opex;
    const dep = y<=life ? bookValue*inp.f_dep/100 : 0; bookValue-=dep;
    const interestCr = y<=inp.f_tenor ? debtBal*rate/100 : 0;
    const principal = y<=inp.f_tenor ? Math.max(emiAnnualCr-interestCr,0) : 0;
    debtBal = Math.max(debtBal-principal,0);
    const replCapexThisYear = degSched.replacementYear===y ? degSched.replacementCapexCr : 0;
    const pbt = ebitda-dep-interestCr;
    const tax = Math.max(pbt,0)*inp.f_tax/100;
    const pat = pbt-tax;
    const fcfe = pat+dep-principal-replCapexThisYear;
    flowsEquity.push(fcfe);
    const dscr = (interestCr+principal)>0 ? ebitda/(interestCr+principal) : NaN;
    yearRows.push({y, rev, opex, ebitda, dep, interestCr, principal, pat, fcfe, dscr, debtBal, replCapexThisYear,
      utilFrac, servedMWh, annual:a, energyCostCr, landedCostPerKWh: servedMWh>0 ? (energyCostCr*1e7)/(servedMWh*1000):0,
      solDegFactor, winDegFactor, bessUsableFrac});
  }
  const projectFlows = [-totalCapexCr, ...yearRows.map(r=>r.ebitda*(1-inp.f_tax/100)+r.dep*inp.f_tax/100-r.replCapexThisYear)];
  const equityIRR = irr(flowsEquity);
  const projectIRR = irr(projectFlows);
  const npvEquity = npv(inp.f_hurdle, flowsEquity);
  let cum=-equityCr, payback=NaN;
  for(let y=1;y<yearRows.length;y++){ cum+=yearRows[y].fcfe; if(cum>=0 && isNaN(payback)) payback=y; }
  if(isNaN(payback) && yearRows.length){ cum=-equityCr+yearRows[0].fcfe; if(cum>=0) payback=1; }
  const avgDSCR = yearRows.filter(r=>!isNaN(r.dscr)).reduce((s,r,_,a)=>s+r.dscr/a.length,0);
  const roic = totalCapexCr>0 ? (yearRows[0].ebitda/totalCapexCr)*100 : 0;
  const dscrOK = avgDSCR>=inp.f_mindscr;
  return {totalCapexCr, debtCr, equityCr, revenueCr:yearRows[0].rev, opexCr:yearRows[0].opex, ebitdaCr:yearRows[0].ebitda,
    equityIRR, projectIRR, npvEquity, payback, avgDSCR, roic, rows:yearRows, blendedPrice,
    landedCost:yearRows[0].landedCostPerKWh, dscrOK, replacementYear:degSched.replacementYear, replacementCapexCr:degSched.replacementCapexCr,
    gcMyEquityCapexCr, bessCapexCr, siteCapexCr, renCapexCr};
}

/* ---------------- coarse-to-exact architecture optimizer ---------------- */
const OPT_WEIGHTS = { LAMBDA_IRR:0.5, P_TARGET:0.02, P_DSCR:5, P_GRID:0.01, P_CURT:1.0, P_UNSERVED:2.0 };
function scoreCandidateEval(ev, inp){
  if(inp.gridAllowed===false && ev.annual.grid>0.01) return -Infinity;
  if(ev.oaElig.status==='NOT ELIGIBLE') return -Infinity;
  if(ev.gcElig.status==='NOT ELIGIBLE') return -Infinity;
  const W = OPT_WEIGHTS;
  const gridSharePct = ev.annual.demand>0 ? (ev.annual.grid/ev.annual.demand)*100 : 0;
  const reliabCeiling = inp.reliab==='high' ? 50 : 100;
  const penalty =
      W.P_TARGET * Math.pow(Math.max(0, inp.retarget-ev.renShare),2) * (ev.annual.demand/1000)
    + W.P_DSCR * Math.max(0, 1.20-(isNaN(ev.dscrY1)?1.20:ev.dscrY1)) * ev.totalCapexCr
    + W.P_GRID * Math.max(0, gridSharePct-reliabCeiling) * (ev.annual.demand/1000)
    + W.P_CURT * (ev.annual.curtail * (inp.s_capex*0.02))
    + W.P_UNSERVED * (ev.unservedMWh*(inp.e_price||10)/1000);
  const irrHeadroom = isFinite(ev.proxyProjectIRR) ? W.LAMBDA_IRR*Math.max(0,ev.proxyProjectIRR-inp.f_hurdle)*ev.totalCapexCr/100 : 0;
  const npvTerm = isFinite(ev.proxyNPV) ? ev.proxyNPV : -1e9;
  return npvTerm + irrHeadroom - penalty;
}
function scoreExactCandidate(ev, finExact, inp){
  if(inp.gridAllowed===false && ev.annual.grid>0.01) return -Infinity;
  if(ev.oaElig.status==='NOT ELIGIBLE') return -Infinity;
  if(ev.gcElig.status==='NOT ELIGIBLE') return -Infinity;
  const W = OPT_WEIGHTS;
  const gridSharePct = ev.annual.demand>0 ? (ev.annual.grid/ev.annual.demand)*100 : 0;
  const reliabCeiling = inp.reliab==='high' ? 50 : 100;
  const penalty =
      W.P_TARGET * Math.pow(Math.max(0, inp.retarget-ev.renShare),2) * (ev.annual.demand/1000)
    + W.P_DSCR * Math.max(0, 1.20-(isNaN(finExact.avgDSCR)?1.20:finExact.avgDSCR)) * finExact.totalCapexCr
    + W.P_GRID * Math.max(0, gridSharePct-reliabCeiling) * (ev.annual.demand/1000)
    + W.P_CURT * (ev.annual.curtail * (inp.s_capex*0.02))
    + W.P_UNSERVED * (ev.unservedMWh*(inp.e_price||10)/1000);
  const irrHeadroom = isFinite(finExact.projectIRR) ? W.LAMBDA_IRR*Math.max(0,finExact.projectIRR-inp.f_hurdle)*finExact.totalCapexCr/100 : 0;
  const npvTerm = isFinite(finExact.npvEquity) ? finExact.npvEquity : -1e9;
  return npvTerm + irrHeadroom - penalty;
}
function optimizeArchitecture(inp, units, baseDemand8760, gridCapMW, topKCount){
  const steps = (max,n) => { if(n<=1) return [max]; const arr=[]; for(let i=0;i<n;i++) arr.push(max*i/(n-1)); return arr; };
  const annualDemandGWh = sumProfile(baseDemand8760)/1000;
  const solarCeilMW = Math.max(inp.s_mw, annualDemandGWh>0 ? (annualDemandGWh*1000)/(8760*(inp.s_cuf/100)) : 0, 0.5);
  const windCeilMW  = Math.max(inp.w_mw, inp.w_cuf>0 ? (annualDemandGWh*1000)/(8760*(inp.w_cuf/100)) : 0, 0);
  const gcCeilMW    = Math.max(inp.gc_mw, 0.5);
  const oaCeilMW    = Math.max(inp.oa_mw, (annualDemandGWh*1000)/8760, 0.5);
  const solarOpts = steps(solarCeilMW, 3), windOpts = steps(windCeilMW, 2), oaOpts = steps(oaCeilMW, 2), gcOpts = steps(gcCeilMW, 2);
  const bessMWOpts  = steps(Math.max(inp.b_maxmw,0), 3);
  const bessMWhOpts = steps(Math.max(inp.b_maxmwh,0), 3);
  const bessCombos = [];
  for(const bessMWh of bessMWhOpts) for(const bessMW of bessMWOpts){
    if(bessMWh<=1e-6 && bessMW<=1e-6){ bessCombos.push({bessMW:0, bessMWh:0}); continue; }
    if(bessMWh<=1e-6 || bessMW<=1e-6) continue;
    const crate = bessMW/bessMWh;
    if(crate < inp.b_cratemin-1e-9 || crate > inp.b_cratemax+1e-9) continue;
    bessCombos.push({bessMW, bessMWh});
  }
  if(bessCombos.length===0) bessCombos.push({bessMW:0, bessMWh:0});
  const seenZero = bessCombos.filter(c=>c.bessMW<=1e-9&&c.bessMWh<=1e-9).length;
  const bessCombosFinal = seenZero<=1 ? bessCombos : [bessCombos.find(c=>c.bessMW<=1e-9&&c.bessMWh<=1e-9), ...bessCombos.filter(c=>!(c.bessMW<=1e-9&&c.bessMWh<=1e-9))];
  const topK = [];
  const considerForTopK = (ev, score) => { topK.push({ev, score}); topK.sort((a,b)=>b.score-a.score); if(topK.length>topKCount) topK.length = topKCount; };
  for(const solarMW of solarOpts) for(const windMW of windOpts) for(const oaMW of oaOpts) for(const gcMW of gcOpts) for(const bc of bessCombosFinal){
    const candidate = {solarMW, windMW, bessMW:bc.bessMW, bessMWh:bc.bessMWh, oaMW, gcMW};
    const ev = evaluateCandidateSteadyState(inp, units, baseDemand8760, candidate, gridCapMW);
    considerForTopK(ev, scoreCandidateEval(ev, inp));
  }
  if(topK.length===0){
    const zeroEv = evaluateCandidateSteadyState(inp, units, baseDemand8760, {solarMW:0,windMW:0,bessMW:0,bessMWh:0,oaMW:0,gcMW:0}, gridCapMW);
    topK.push({ev:zeroEv, score:scoreCandidateEval(zeroEv, inp)});
  }
  const refined = topK.map(item=>{
    const finExact = computeExactMultiYearFinancing(inp, units, baseDemand8760, item.ev.candidate, gridCapMW);
    const exactScore = scoreExactCandidate(item.ev, finExact, inp);
    return {ev:item.ev, coarseScore:item.score, finExact, exactScore};
  });
  refined.sort((a,b)=>b.exactScore-a.exactScore);
  return refined.map(r=>({ name:architectureNameOf(r.ev), ev:r.ev, finExact:r.finExact, score:r.exactScore }));
}

/* ---------------- BESS value sweep (Architecture / Economics helper) ---------------- */
function bessSweep8760(inp, units, baseDemand8760, gridCapMW, fixedCandidate){
  const mwhSteps = (()=>{ const arr=[]; const step=Math.max(inp.b_maxmwh/8,0.5); for(let v=0; v<=inp.b_maxmwh+1e-9; v+=step) arr.push(v); return arr; })();
  const crateOpts = [inp.b_cratemin, (inp.b_cratemin+inp.b_cratemax)/2, inp.b_cratemax];
  const results = [];
  const withoutCandidate = {...fixedCandidate, bessMW:0, bessMWh:0};
  const {result: withoutR} = runCandidateDispatch(inp, units, baseDemand8760, withoutCandidate, 1.0, gridCapMW, false);
  const gridRateWithout = gridRatePerKWh(inp, withoutR.annual.grid, withoutR.peakGridMW);
  const annualGridCostWithoutCr = withoutR.annual.grid*1000*gridRateWithout/1e7;
  mwhSteps.forEach(mwh=>{
    let bestForMWh=null;
    const crateList = mwh<=1e-6 ? [0] : crateOpts;
    crateList.forEach(crate=>{
      const bessMW = mwh<=1e-6? 0 : clampV(mwh*crate,0,inp.b_maxmw);
      const cand = {...fixedCandidate, bessMW, bessMWh:mwh};
      const {result} = runCandidateDispatch(inp, units, baseDemand8760, cand, 1.0, gridCapMW, false);
      const gridRate = gridRatePerKWh(inp, result.annual.grid, result.peakGridMW);
      const annualGridCostWithCr = result.annual.grid*1000*gridRate/1e7;
      const grossAvoidedCr = annualGridCostWithoutCr-annualGridCostWithCr;
      const capexCr = mwh*inp.b_capex*scenMult(inp).bess + bessMW*inp.b_capex_mw*scenMult(inp).bess;
      const annualCapexCr = capexCr*crf(inp.f_hurdle,10);
      const omCr = capexCr*(inp.b_om/100);
      const netValueCr = grossAvoidedCr-annualCapexCr-omCr;
      if(!bestForMWh || netValueCr>bestForMWh.netValueCr) bestForMWh = {mwh, bessMW, grossValueCr:grossAvoidedCr, annualCapexCr:annualCapexCr+omCr, netValueCr, annualShiftedMWh:result.annual.bessDischarge, unservedWith:result.annual.unserved};
    });
    results.push(bestForMWh);
  });
  let best = results[0]; results.forEach(r=>{ if(r.netValueCr>best.netValueCr) best=r; });
  return {results, best, withoutAnnual:withoutR.annual, annualGridCostWithoutCr};
}
