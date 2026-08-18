/* ============================================================
   E-DHARA ENGINE — application layer
   Consumes the canonical 8760-hour engine (engine functions below,
   identical to /engine.js, inlined for a single self-contained file).
   Nothing here should be read as a verified current regulatory or
   company fact unless a source has been attached in the Audit tab.
   ============================================================ */

/* ---- ENGINE CORE (see engine.js for the Node-tested standalone copy) ---- */
__ENGINE_CORE__

/* ================================================================
   APPLICATION LAYER
   ================================================================ */
const $ = id => document.getElementById(id);
const fmt = (n, d=2) => { if(!isFinite(n)) return "—"; return Number(n).toLocaleString('en-IN',{maximumFractionDigits:d,minimumFractionDigits:0}); };
const clampV = (v,a,b)=>Math.max(a,Math.min(b,v));
function mulScalar(profile, k){ const out=new Float64Array(profile.length); for(let i=0;i<profile.length;i++) out[i]=profile[i]*k; return out; }
function sumProfile(p){ let s=0; for(let i=0;i<p.length;i++) s+=p[i]; return s; }

/* ---------------- state ---------------- */
let vehicleRows = [
  {name:"Passenger cars (4W)", vpd:180, spd:1.0, kwh:22},
  {name:"Electric buses",      vpd:12,  spd:1.0, kwh:140},
  {name:"E-freight / LCV-MCV", vpd:35,  spd:1.0, kwh:85},
  {name:"2W / 3W",             vpd:60,  spd:1.0, kwh:2.5},
];
let scenario = "base";
const scenarioPresets = {
  base:     {util:1.00, grid:1.00, bess:1.00, price:1.00, interest:0,   ren:1.00, label:"Base Case"},
  downside: {util:0.80, grid:1.05, bess:1.10, price:0.92, interest:100, ren:0.90, label:"Downside"},
  upside:   {util:1.20, grid:0.97, bess:0.90, price:1.08, interest:-50, ren:1.05, label:"Upside"},
  stress:   {util:0.70, grid:1.30, bess:1.25, price:0.85, interest:300, ren:0.85, label:"Stress Case"},
};
const STATE_ASSUMPTIONS = {
  "Gujarat":     {g_energy:7.20, oa_css:1.10, oa_wheel:0.85, gc_charges:1.35, s_cuf:19.5, w_cuf:26, verified:false},
  "Rajasthan":   {g_energy:6.90, oa_css:1.35, oa_wheel:0.70, gc_charges:1.20, s_cuf:21.5, w_cuf:22, verified:false},
  "Maharashtra": {g_energy:8.10, oa_css:1.55, oa_wheel:1.05, gc_charges:1.75, s_cuf:18.5, w_cuf:20, verified:false},
  "Karnataka":   {g_energy:7.60, oa_css:1.40, oa_wheel:0.95, gc_charges:1.60, s_cuf:18.0, w_cuf:24, verified:false},
  "Tamil Nadu":  {g_energy:7.80, oa_css:1.20, oa_wheel:0.90, gc_charges:1.55, s_cuf:17.5, w_cuf:28, verified:false},
  "Delhi":       {g_energy:8.40, oa_css:1.65, oa_wheel:1.15, gc_charges:1.85, s_cuf:17.0, w_cuf:0,  verified:false},
};

/* ---------------- finance helpers ---------------- */
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

/* ---------------- read inputs ---------------- */
function readInputs(){
  const v = id => parseFloat($(id).value)||0;
  const s = id => $(id).value;
  return {
    state:s('in_state'), archetype:s('in_archetype'), discom:s('in_discom'), voltage:s('in_voltage'),
    gridAllowed: s('in_gridallowed')==='1', retarget:v('in_retarget'), redef:s('in_redef'), reliab:s('in_reliab'),
    opdays:v('in_opdays'), growth:v('in_growth'), shape:s('in_shape'),
    util_y1:v('in_util_y1'), util_rampyears:v('in_util_rampyears'), util_terminal:v('in_util_terminal'), util_shape:s('in_util_shape'),
    priority:s('in_priority'),
    s_mw:v('s_mw'), s_cuf:v('s_cuf'), s_capex:v('s_capex'), s_om:v('s_om'), s_deg:v('s_deg'), s_life:v('s_life'),
    w_mw:v('w_mw'), w_cuf:v('w_cuf'), w_capex:v('w_capex'), w_om:v('w_om'), w_deg:v('w_deg'), w_life:v('w_life'),
    oa_energy:v('oa_energy'), oa_trans:v('oa_trans'), oa_wheel:v('oa_wheel'), oa_css:v('oa_css'), oa_addl:v('oa_addl'),
    oa_bank:v('oa_bank'), oa_sldc:v('oa_sldc'), oa_loss:v('oa_loss'), oa_tax:v('oa_tax'), oa_mw:v('oa_mw'), oa_shape:s('oa_shape'), oa_min_mw:v('oa_min_mw'),
    gc_mw:v('gc_mw'), gc_equity:v('gc_equity'), gc_selfcons:v('gc_selfcons'), gc_myequity:v('gc_myequity'),
    gc_capex:v('gc_capex'), gc_charges:v('gc_charges'), gc_solarshare:v('gc_solarshare'), gc_entitlement:v('gc_entitlement'),
    g_energy:v('g_energy'), g_demand:v('g_demand'), g_fixed:v('g_fixed'), g_tod:v('g_tod'), g_tax:v('g_tax'), g_sanc:v('g_sanc'),
    g_upgrade_avail: s('g_upgrade_avail')==='1', g_upgrade_mw:v('g_upgrade_mw'), g_upgrade_capex:v('g_upgrade_capex'),
    e_price:v('e_price'), e_fleetprice:v('e_fleetprice'), e_fleetshare:v('e_fleetshare'), e_greenprem:v('e_greenprem'),
    e_chargercapex:v('e_chargercapex'), e_gridcapex:v('e_gridcapex'), e_civilcapex:v('e_civilcapex'), e_contg:v('e_contg'),
    f_debt:v('f_debt'), f_rate:v('f_rate'), f_tenor:v('f_tenor'), f_hurdle:v('f_hurdle'), f_tax:v('f_tax'), f_dep:v('f_dep'),
    f_mindscr:v('f_mindscr'), f_targetirr:v('f_targetirr'),
    riskObjective: s('in_riskobjective')==='1', risk_lambda:v('risk_lambda'),
    p_base:v('p_base'), p_downside:v('p_downside'), p_upside:v('p_upside'), p_stress:v('p_stress'),
    b_maxmwh:v('b_maxmwh'), b_maxmw:v('b_maxmw'), b_crate:v('b_crate'), b_cratemin:v('b_cratemin'), b_cratemax:v('b_cratemax'),
    b_capex:v('b_capex'), b_capex_mw:v('b_capex_mw'), b_rte:v('b_rte'), b_soc:v('b_soc'),
    b_cycles:v('b_cycles'), b_deg:v('b_deg'), b_om:v('b_om'), b_baasfixed:v('b_baasfixed'), b_baasrate:v('b_baasrate'), b_baasesc:v('b_baasesc'),
    b_life:v('b_life'), b_replcost:v('b_replcost'), b_minusable:v('b_minusable'),
    st_util:v('st_util'), st_grid:v('st_grid'), st_bess:v('st_bess'), st_price:v('st_price'), st_int:v('st_int'), st_ren:v('st_ren'),
  };
}
function scenMultFor(name){
  const p = scenarioPresets[name];
  const inp = readInputs();
  return {
    util:   p.util   * (1+inp.st_util/100),
    grid:   p.grid   * (1+inp.st_grid/100),
    bess:   p.bess   * (1+inp.st_bess/100),
    price:  p.price  * (1+inp.st_price/100),
    interest: p.interest + inp.st_int,
    ren:    p.ren    * (1+inp.st_ren/100),
  };
}
function scenMult(){ return scenMultFor(scenario); }

function priorityArrayFrom(key){
  if(key==='solar-wind-oa-gc-bess-grid') return ['solar','wind','oa','gc','bess','grid'];
  if(key==='solar-wind-bess-gc-oa-grid') return ['solar','wind','bess','gc','oa','grid'];
  return ['solar','wind','gc','oa','bess','grid'];
}

/* ---------------- utilisation ramp (feeds the 8760 demand scalar per year) ---------------- */
function utilisationFraction(inp, year){
  const y1 = clampV(inp.util_y1,0,1000)/100, term = clampV(inp.util_terminal,0,1000)/100;
  const rampY = Math.max(inp.util_rampyears,1);
  if(year>=rampY) return term;
  const t = (year-1)/rampY; // 0 at year1 start
  if(inp.util_shape==='scurve'){
    const s = t*t*(3-2*t);
    return y1 + (term-y1)*s;
  }
  return y1 + (term-y1)*(t);
}

/* ---------------- static (non-hourly) source economics: CAPEX/OM rates, landed OA/GC benchmark ----------------
   genEngine now returns ONLY the CAPEX annuity + O&M rate references. Actual
   annual generation volumes come from the 8760 dispatch, not from this
   function, avoiding two different "how much energy did solar produce"
   answers existing in the model at once. */
function genEngine(mw, capexCrPerMW, omLakhPerMW, life, hurdlePct){
  const capexCr = mw*capexCrPerMW;
  const annualCapexCharge = capexCr>0 ? capexCr*crf(hurdlePct,life) : 0;
  const annualOM = mw*omLakhPerMW/100; // Lakh -> Cr
  return {capexCr, annualCapexCharge, annualOM};
}
function computeOA(inp){
  const base = inp.oa_energy+inp.oa_trans+inp.oa_wheel+inp.oa_css+inp.oa_addl+inp.oa_bank+inp.oa_sldc+inp.oa_tax;
  const landed = base/(1-inp.oa_loss/100);
  return {landed, breakdown:{
    "PPA / energy":inp.oa_energy,"Transmission":inp.oa_trans,"Wheeling":inp.oa_wheel,"Cross-subsidy surcharge":inp.oa_css,
    "Additional surcharge":inp.oa_addl,"Banking":inp.oa_bank,"SLDC/scheduling":inp.oa_sldc,"Taxes/levies":inp.oa_tax,
    "Loss add-on":landed-base}};
}
function computeGrid(inp){
  const m = scenMult();
  const energy = inp.g_energy*m.grid;
  const demandChargeAnnualCr = (inp.g_demand*inp.g_sanc*12)/1e7;
  const fixedAnnualCr = (inp.g_fixed*12)/1e7;
  return {energy, demandChargeAnnualCr, fixedAnnualCr, tod:inp.g_tod, tax:inp.g_tax};
}
function gridCapacityMW(inp, includeUpgrade){
  const base = inp.g_sanc/1000;
  if(includeUpgrade && inp.g_upgrade_avail) return base+inp.g_upgrade_mw;
  return base;
}
/* Grid ₹/kWh rate applied to actual grid MWh delivered by the dispatch (energy
   charge + ToD approximation + fixed/demand charges apportioned over the
   dispatch's OWN grid volume, not a separately-assumed annual figure). */
function gridRatePerKWh(inp, gridMWhAnnual, peakGridMW){
  const g = computeGrid(inp);
  const demandChargeCr = (inp.g_demand*Math.max(peakGridMW,0)*1000*12)/1e7; // ₹/kVA/month * peak kVA (approx kW≈kVA) *12
  const fixedCr = g.fixedAnnualCr;
  const perKWhFromFixedDemand = gridMWhAnnual>0 ? ((demandChargeCr+fixedCr)*1e7)/(gridMWhAnnual*1e6) : 0;
  const base = g.energy + g.tod*0.3 + perKWhFromFixedDemand;
  return base*(1+inp.g_tax/100);
}

/* ---------------- GC compliance (equity/self-consumption thresholds, unchanged concept) ---------------- */
function gcCompliance(inp, gcMW, gcAnnualUsedGWh, gcAnnualGenGWh){
  const equityOK = inp.gc_myequity>=inp.gc_equity;
  const selfConsPct = gcAnnualGenGWh>0 ? clampV((gcAnnualUsedGWh/gcAnnualGenGWh)*100,0,999) : 0;
  const selfConsOK = selfConsPct>=inp.gc_selfcons;
  return {equityOK, selfConsOK, compliant:equityOK&&selfConsOK, selfConsPct};
}

/* ================================================================
   REGULATORY ELIGIBILITY GATE (OA + GC)
   Every OA/GC candidate is classified ELIGIBLE / VERIFY / NOT ELIGIBLE.
   NOT ELIGIBLE is a HARD constraint enforced in the optimiser's scoring
   functions (returns -Infinity, same mechanism already used for
   "grid not allowed"). ELIGIBLE/VERIFY are both allowed through — the
   distinction is informational (VERIFY = passes the model's threshold
   but that threshold itself is not a confirmed current regulatory
   number, so a human must still check it). No specific state DISCOM
   number is asserted as fact; oa_min_mw is a user-editable, VERIFY-
   tagged input, and the GC equity/self-consumption thresholds are the
   same commonly-cited (not asserted-current) inputs already used
   elsewhere in the model (gc_equity, gc_selfcons).
   ================================================================ */
function oaEligibility(inp, candidate){
  if(candidate.oaMW<=1e-6) return {status:'N/A', detail:'No OA capacity proposed for this candidate'};
  if(inp.oa_min_mw<=1e-6) return {status:'VERIFY', detail:'No minimum-capacity threshold configured (0 MW) — eligibility cannot be automatically determined; set the threshold or confirm eligibility manually against the state open-access regulation'};
  if(candidate.oaMW < inp.oa_min_mw) return {status:'NOT ELIGIBLE', detail:`${fmt(candidate.oaMW,2)} MW is below the configured minimum eligible OA capacity of ${fmt(inp.oa_min_mw,2)} MW`};
  return {status:'ELIGIBLE', detail:`${fmt(candidate.oaMW,2)} MW meets the configured ${fmt(inp.oa_min_mw,2)} MW minimum-capacity threshold. This checks capacity only — the threshold value itself, plus voltage-level/consumer-category/distance-based criteria not modeled here, still require confirmation against the current state/DISCOM open-access regulations.`};
}
function gcEligibility(inp, candidate, gcAnnualUsedMWh, gcAnnualGenMWh){
  if(candidate.gcMW<=1e-6) return {status:'N/A', detail:'No Group Captive capacity proposed for this candidate', compliant:true, selfConsPct:0};
  const compl = gcCompliance(inp, candidate.gcMW, gcAnnualUsedMWh, gcAnnualGenMWh);
  if(!compl.equityOK) return {status:'NOT ELIGIBLE', detail:`ChargeZone equity stake ${fmt(inp.gc_myequity,1)}% is below the configured minimum captive-consumer equity threshold of ${fmt(inp.gc_equity,1)}%`, compliant:false, selfConsPct:compl.selfConsPct};
  if(!compl.selfConsOK) return {status:'NOT ELIGIBLE', detail:`Actual self-consumption ${fmt(compl.selfConsPct,1)}% (from the dispatch, not the entitlement setting) is below the configured minimum of ${fmt(inp.gc_selfcons,1)}%`, compliant:false, selfConsPct:compl.selfConsPct};
  return {status:'ELIGIBLE', detail:`Equity ${fmt(inp.gc_myequity,1)}%≥${fmt(inp.gc_equity,1)}% and self-consumption ${fmt(compl.selfConsPct,1)}%≥${fmt(inp.gc_selfcons,1)}% both meet the configured thresholds. The threshold VALUES (26%/51%-style figures) are commonly-cited under the captive generation framework but not asserted here as confirmed current rule text — confirm against the current Electricity Rules and any state-commission interpretation.`, compliant:true, selfConsPct:compl.selfConsPct};
}

/* ================================================================
   CANDIDATE ARCHITECTURE: build 8760 profiles + run dispatch
   This is the ONE function used by the optimizer, the display tabs,
   and the BESS sweep. No parallel "annual GWh matching" shortcut.
   ================================================================ */
let _cache = {}; // per-renderAll cache of expensive, input-dependent-only-on-CUF profiles
function getUnitShapes(inp){
  const key = inp.s_cuf+'|'+inp.w_cuf;
  if(_cache.unitKey===key) return _cache.units;
  const solarUnit = generateUnitMWShape8760(inp.s_cuf,'solar');
  const windUnit = generateUnitMWShape8760(inp.w_cuf,'wind');
  _cache.unitKey = key; _cache.units = {solarUnit, windUnit};
  return _cache.units;
}
function getBaseDemand8760(inp){
  const dailyKWhTotal = vehicleRows.reduce((s,r)=>s+r.vpd*r.spd*r.kwh,0);
  const key = dailyKWhTotal+'|'+inp.shape+'|'+inp.opdays;
  if(_cache.demandKey===key) return _cache.baseDemand;
  const base = generateDemand8760Profile(dailyKWhTotal, inp.shape, inp.opdays);
  _cache.demandKey=key; _cache.baseDemand=base;
  return base;
}

/* candidate = {solarMW, windMW, bessMW, bessMWh, oaMW, gcMW}; utilFrac scales demand
   (1.0 = terminal/steady-state, used by optimizer & display tabs). */
function buildCandidateProfiles(inp, units, baseDemand8760, candidate, utilFrac){
  const m = scenMult();
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
  return {
    priorityOrder: priorityArrayFrom(inp.priority),
    bessMW: candidate.bessMW, bessMWh: candidate.bessMWh,
    socMinFrac: bandHalfGapPct, socMaxFrac: 1-bandHalfGapPct,
    chargeEff, dischargeEff, gridCapMW
  };
}

/* ---------------- single-hour-profile-set full-year dispatch wrapper ---------------- */
function runCandidateDispatch(inp, units, baseDemand8760, candidate, utilFrac, gridCapMW, collectHourly){
  const profiles = buildCandidateProfiles(inp, units, baseDemand8760, candidate, utilFrac);
  const params = dispatchParamsFor(inp, candidate, gridCapMW);
  const result = runDispatch8760(profiles, params, collectHourly);
  return {result, profiles};
}

/* ================================================================
   STEADY-STATE ECONOMICS FOR A CANDIDATE (used by optimizer scoring
   and by the display/comparison tabs). Runs ONE 8760 dispatch at
   utilFrac=1.0 (terminal demand) — NOT a proxy for the exact
   multi-year cash flow, which is computed separately (see
   computeExactMultiYearFinancing) for the SELECTED winning
   architecture only, to keep the search over many candidates fast.
   ================================================================ */
function evaluateCandidateSteadyState(inp, units, baseDemand8760, candidate, gridCapMW, comps){
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

  // O&M-only rates for owned assets (CAPEX capitalised & financed separately —
  // see AUDIT note: never use a CAPEX-inclusive LCOE as opex here, that would
  // double-count the same CAPEX that is also in totalCapexCr below).
  const solarOM_perKWh = a.solar>0 ? (sol.annualOM*1e7)/(a.solar*1000) : 0;
  const windOM_perKWh = a.wind>0 ? (win.annualOM*1e7)/(a.wind*1000) : 0;
  const gcOpexRate = inp.gc_charges; // pass-through wheeling/CSS only, no capex
  const oaRate = oa.landed; // all-in (OA has no separate project capex)

  const energyCostCr = (a.solar*solarOM_perKWh + a.wind*windOM_perKWh + a.gc*gcOpexRate + a.oa*oaRate + a.grid*gridRate)*1000/1e7;
  const bessCapexCr = candidate.bessMWh*inp.b_capex*scenMult().bess + candidate.bessMW*inp.b_capex_mw*scenMult().bess;
  const bessAnnualCr = bessCapexCr*crf(inp.f_hurdle,10) + bessCapexCr*(inp.b_om/100);

  const siteCapexCr = inp.e_chargercapex+inp.e_gridcapex+inp.e_civilcapex+(inp.g_upgrade_avail?inp.g_upgrade_capex:0);
  const renCapexCr = sol.capexCr+win.capexCr+gcMyEquityCapexCr;
  const totalCapexCr = (renCapexCr+bessCapexCr+siteCapexCr)*(1+inp.e_contg/100);

  const blendedPrice = (inp.e_price*(1-inp.e_fleetshare/100)+inp.e_fleetprice*(inp.e_fleetshare/100)+inp.e_greenprem)*scenMult().price;
  const revenueCr = servedMWh*1000*blendedPrice/1e7;
  const omTotalCr = sol.annualOM+win.annualOM+bessAnnualCr+(siteCapexCr*0.03);
  const ebitdaCr = revenueCr - energyCostCr - omTotalCr;

  const landedCostPerKWh = a.demand>0 ? (energyCostCr*1e7)/(a.demand*1000) : 0;

  // quick-proxy IRR/NPV for SCORING/RANKING only (steady-state, single-year
  // annuity approximation of the ramp) — the exact multi-year cash flow for
  // the winning candidate is computed separately with a real per-year 8760 run.
  const debtCr = totalCapexCr*inp.f_debt/100, equityCr = totalCapexCr-debtCr;
  const rate = inp.f_rate + scenMult().interest/100;
  const emiAnnualCr = debtCr>0 ? debtCr*crf(rate, inp.f_tenor) : 0;
  const interestY1 = debtCr*rate/100;
  const depY1 = totalCapexCr*inp.f_dep/100;
  const pbt = ebitdaCr-depY1-interestY1;
  const tax = Math.max(pbt,0)*inp.f_tax/100;
  const patY1 = pbt-tax;
  const proxyFlows = [-equityCr];
  for(let y=1;y<=15;y++) proxyFlows.push(patY1+depY1-(emiAnnualCr-interestY1));
  const proxyEquityIRR = irr(proxyFlows);
  const proxyProjectFlows = [-totalCapexCr, ...Array(15).fill(ebitdaCr*(1-inp.f_tax/100)+depY1*inp.f_tax/100)];
  const proxyProjectIRR = irr(proxyProjectFlows);
  const proxyNPV = npv(inp.f_hurdle, proxyFlows);
  const dscrY1 = (interestY1+(emiAnnualCr-interestY1))>0 ? ebitdaCr/(interestY1+(emiAnnualCr-interestY1)) : NaN;

  const oaElig = oaEligibility(inp, candidate);
  const gcElig = gcEligibility(inp, candidate, a.gc, gcGenAnnualMWh);

  return {
    candidate, annual:a, servedMWh, renShare, unservedMWh:a.unserved, peakGridMW:result.peakGridMW,
    sanctionedMW:gridCapMW, totalCapexCr, equityCr, debtCr, revenueCr, energyCostCr, omTotalCr, ebitdaCr,
    landedCostPerKWh, proxyEquityIRR, proxyProjectIRR, proxyNPV, dscrY1,
    gcMyEquityCapexCr, gcCapexTotalCr, bessCapexCr, blendedPrice,
    gcGenAnnualMWh, oaElig, gcElig
  };
}

/* ================================================================
   OPTIMIZER — evaluates candidates through the SAME canonical 8760
   engine (via evaluateCandidateSteadyState). Coarse grid + reused
   cached unit shapes/demand profile keeps this fast (~1-3ms per
   candidate dispatch; a few hundred candidates stays sub-second).

   TWO-STAGE SEARCH (coarse -> refine), per the requirement that the
   optimiser's final ranking must use EXACT multi-year economics, not
   just the steady-state proxy, without re-running a full 15-year
   dispatch for every candidate in the grid (that would be hundreds of
   candidates x 15 years x 8760h and would destroy interactivity):

   Stage 1 (this function): scores ALL candidates with the fast
   steady-state proxy (evaluateCandidateSteadyState + proxy IRR/NPV),
   and returns the top-K by that proxy score, not just the single
   winner.

   Stage 2 (refineTopCandidatesExact, below): re-scores ONLY those top-K
   candidates using the REAL exact multi-year dispatch + cash flow
   (computeExactMultiYearFinancing — a true year-by-year 8760 re-run
   with utilisation ramp, panel/BESS degradation and replacement CAPEX
   applied). The candidate that wins after Stage 2 is the one whose
   numbers are actually shown — the proxy is only ever used to shortlist,
   never to make the final call.
   ================================================================ */
const OPT_WEIGHTS = { LAMBDA_IRR:0.5, P_TARGET:0.02, P_DSCR:5, P_GRID:0.01, P_GC:0.10, P_CURT:1.0, P_UNSERVED:2.0 };
const OPT_TOPK = 6; // number of coarse-stage finalists carried into the exact multi-year refine stage

function scoreCandidateEval(ev, inp){
  if(inp.gridAllowed===false && ev.annual.grid>0.01) return -Infinity;
  if(ev.oaElig.status==='NOT ELIGIBLE') return -Infinity;
  if(ev.gcElig.status==='NOT ELIGIBLE') return -Infinity;
  const W = OPT_WEIGHTS;
  const gridSharePct = ev.annual.demand>0 ? (ev.annual.grid/ev.annual.demand)*100 : 0;
  const reliabCeiling = inp.reliab==='high' ? 50 : 100;
  const curtailMWh = ev.annual.curtail;

  const penalty =
      W.P_TARGET * Math.pow(Math.max(0, inp.retarget-ev.renShare),2) * (ev.annual.demand/1000)
    + W.P_DSCR * Math.max(0, 1.20-(isNaN(ev.dscrY1)?1.20:ev.dscrY1)) * ev.totalCapexCr
    + W.P_GRID * Math.max(0, gridSharePct-reliabCeiling) * (ev.annual.demand/1000)
    + W.P_CURT * (curtailMWh * (inp.s_capex*0.02))
    + W.P_UNSERVED * (ev.unservedMWh*(inp.e_price||10)/1000);

  const irrHeadroom = isFinite(ev.proxyProjectIRR) ? W.LAMBDA_IRR*Math.max(0,ev.proxyProjectIRR-inp.f_hurdle)*ev.totalCapexCr/100 : 0;
  const npvTerm = isFinite(ev.proxyNPV) ? ev.proxyNPV : -1e9;
  return npvTerm + irrHeadroom - penalty;
}

/* Same penalty structure as scoreCandidateEval, but the NPV/IRR/DSCR
   terms come from the EXACT multi-year run (finExact), not the
   single-year proxy. This is the score that actually decides the
   winner in Stage 2. */
function scoreExactCandidate(ev, finExact, inp){
  if(inp.gridAllowed===false && ev.annual.grid>0.01) return -Infinity;
  if(ev.oaElig.status==='NOT ELIGIBLE') return -Infinity;
  if(ev.gcElig.status==='NOT ELIGIBLE') return -Infinity;
  const W = OPT_WEIGHTS;
  const gridSharePct = ev.annual.demand>0 ? (ev.annual.grid/ev.annual.demand)*100 : 0;
  const reliabCeiling = inp.reliab==='high' ? 50 : 100;
  const curtailMWh = ev.annual.curtail;

  const penalty =
      W.P_TARGET * Math.pow(Math.max(0, inp.retarget-ev.renShare),2) * (ev.annual.demand/1000)
    + W.P_DSCR * Math.max(0, 1.20-(isNaN(finExact.avgDSCR)?1.20:finExact.avgDSCR)) * finExact.totalCapexCr
    + W.P_GRID * Math.max(0, gridSharePct-reliabCeiling) * (ev.annual.demand/1000)
    + W.P_CURT * (curtailMWh * (inp.s_capex*0.02))
    + W.P_UNSERVED * (ev.unservedMWh*(inp.e_price||10)/1000);

  const irrHeadroom = isFinite(finExact.projectIRR) ? W.LAMBDA_IRR*Math.max(0,finExact.projectIRR-inp.f_hurdle)*finExact.totalCapexCr/100 : 0;
  const npvTerm = isFinite(finExact.npvEquity) ? finExact.npvEquity : -1e9;
  return npvTerm + irrHeadroom - penalty;
}

function architectureNameOf(ev){
  const c = ev.candidate; const parts=[];
  if(c.solarMW>0.01) parts.push(`${fmt(c.solarMW,1)}MW Solar`);
  if(c.windMW>0.01) parts.push(`${fmt(c.windMW,1)}MW Wind`);
  if(c.oaMW>0.01) parts.push(`${fmt(c.oaMW,1)}MW Green OA`);
  if(c.gcMW>0.01) parts.push(`${fmt(c.gcMW,1)}MW Group Captive`);
  if(c.bessMWh>0.01) parts.push(`${fmt(c.bessMWh,1)}MWh / ${fmt(c.bessMW,1)}MW BESS`);
  if(ev.annual.grid>0.01) parts.push('Grid backup');
  return parts.length? parts.join(' + ') : 'Grid only';
}

function optimizeArchitecture8760(inp, units, baseDemand8760, gridCapMW, comps){
  const steps = (max,n) => { if(n<=1) return [max]; const arr=[]; for(let i=0;i<n;i++) arr.push(max*i/(n-1)); return arr; };
  const annualDemandGWh = sumProfile(baseDemand8760)/1000;
  const solarCeilMW = Math.max(inp.s_mw, annualDemandGWh>0 ? (annualDemandGWh*1000)/(8760*(inp.s_cuf/100)) : 0, 0.5);
  const windCeilMW  = Math.max(inp.w_mw, inp.w_cuf>0 ? (annualDemandGWh*1000)/(8760*(inp.w_cuf/100)) : 0, 0);
  const gcCeilMW    = Math.max(inp.gc_mw, 0.5);
  const oaCeilMW    = Math.max(inp.oa_mw, (annualDemandGWh*1000)/8760, 0.5);

  const solarOpts = steps(solarCeilMW, 3);
  const windOpts  = steps(windCeilMW, 2);
  const oaOpts    = steps(oaCeilMW, 2);
  const gcOpts    = steps(gcCeilMW, 2);

  /* BESS MW and BESS MWh are independent decision variables, each swept
     on its own grid (NOT bessMW = bessMWh*crate). C-rate is a derived,
     CONSTRAINT-CHECKED consequence: any (MW,MWh) combo is only kept as
     a candidate if MW/MWh falls within [b_cratemin, b_cratemax]. This
     is what makes 5MW/10MWh, 5MW/20MWh, 10MW/20MWh, 10MW/40MWh all
     independently reachable (and reachable at different scores) rather
     than one MW value being forced by a single fixed C-rate per MWh step. */
  const bessMWOpts  = steps(Math.max(inp.b_maxmw,0), 4);
  const bessMWhOpts = steps(Math.max(inp.b_maxmwh,0), 4);
  const bessCombos = [];
  for(const bessMWh of bessMWhOpts){
    for(const bessMW of bessMWOpts){
      if(bessMWh<=1e-6 && bessMW<=1e-6){ bessCombos.push({bessMW:0, bessMWh:0}); continue; }
      if(bessMWh<=1e-6 || bessMW<=1e-6) continue; // energy with no power, or power with no energy: not a real BESS
      const crate = bessMW/bessMWh;
      if(crate < inp.b_cratemin-1e-9 || crate > inp.b_cratemax+1e-9) continue; // outside configured C-rate band
      bessCombos.push({bessMW, bessMWh});
    }
  }
  if(bessCombos.length===0) bessCombos.push({bessMW:0, bessMWh:0});
  // de-duplicate (0,0) which can appear once already from the loop above
  const seenZero = bessCombos.filter(c=>c.bessMW<=1e-9&&c.bessMWh<=1e-9).length;
  const bessCombosFinal = seenZero<=1 ? bessCombos : [bessCombos.find(c=>c.bessMW<=1e-9&&c.bessMWh<=1e-9), ...bessCombos.filter(c=>!(c.bessMW<=1e-9&&c.bessMWh<=1e-9))];

  // top-K min-heap-ish tracking (K small, linear insert is fine)
  const topK = [];
  const considerForTopK = (ev, score) => {
    topK.push({ev, score});
    topK.sort((a,b)=>b.score-a.score);
    if(topK.length>OPT_TOPK) topK.length = OPT_TOPK;
  };

  let evaluatedCount = 0;
  for(const solarMW of solarOpts)
  for(const windMW of windOpts)
  for(const oaMW of oaOpts)
  for(const gcMW of gcOpts)
  for(const bc of bessCombosFinal){
    const candidate = {solarMW, windMW, bessMW:bc.bessMW, bessMWh:bc.bessMWh, oaMW, gcMW};
    const ev = evaluateCandidateSteadyState(inp, units, baseDemand8760, candidate, gridCapMW, comps);
    const score = scoreCandidateEval(ev, inp);
    evaluatedCount++;
    considerForTopK(ev, score);
  }
  if(topK.length===0){
    const zeroEv = evaluateCandidateSteadyState(inp, units, baseDemand8760, {solarMW:0,windMW:0,bessMW:0,bessMWh:0,oaMW:0,gcMW:0}, gridCapMW, comps);
    topK.push({ev:zeroEv, score:scoreCandidateEval(zeroEv, inp)});
  }
  return {topK, evaluatedCount};
}

/* ================================================================
   RISK-ADJUSTED ECONOMICS (Base / Downside / Upside / Stress)
   Reuses the SAME 4 scenario multiplier sets already defined in
   scenarioPresets (util/grid/bess/price/interest/ren) and the SAME
   computeExactMultiYearFinancing engine — this is not a separate
   simplified risk model. Adds: user-configurable probabilities per
   scenario (normalised to sum to 1), expected NPV, a downside
   semi-deviation risk penalty (only scenarios BELOW the expected value
   count against the score — upside variance is not penalised), and a
   configurable risk-aversion multiplier λ.
   ================================================================ */
function normalizedRiskWeights(inp){
  const raw = {base:Math.max(inp.p_base,0), downside:Math.max(inp.p_downside,0), upside:Math.max(inp.p_upside,0), stress:Math.max(inp.p_stress,0)};
  const sum = Object.values(raw).reduce((a,b)=>a+b,0);
  if(sum<=0) return {base:0.5, downside:0.25, upside:0.15, stress:0.10};
  const out={}; for(const k in raw) out[k]=raw[k]/sum; return out;
}
function computeRiskAdjustedEconomics(inp, units, baseDemand8760, candidate, gridCapMW){
  const savedScenario = scenario;
  const weights = normalizedRiskWeights(inp);
  const perScenario = {};
  try{
    for(const k of Object.keys(scenarioPresets)){
      scenario = k;
      const fin = computeExactMultiYearFinancing(inp, units, baseDemand8760, candidate, gridCapMW);
      perScenario[k] = {key:k, label:scenarioPresets[k].label, weight:weights[k], npvEquity:fin.npvEquity,
        projectIRR:fin.projectIRR, equityIRR:fin.equityIRR, avgDSCR:fin.avgDSCR, dscrOK:fin.dscrOK, totalCapexCr:fin.totalCapexCr};
    }
  } finally { scenario = savedScenario; }
  const scenList = Object.values(perScenario);
  const expectedNPV = scenList.reduce((s,p)=>s+p.weight*p.npvEquity,0);
  const expectedProjectIRR = scenList.reduce((s,p)=> s+p.weight*(isFinite(p.projectIRR)?p.projectIRR:0), 0);
  const expectedDSCR = scenList.reduce((s,p)=> s+p.weight*(isFinite(p.avgDSCR)?p.avgDSCR:0), 0);
  // downside SEMI-deviation: only scenarios below the expected value count against the score
  const downsideVar = scenList.reduce((s,p)=> s + p.weight*Math.pow(Math.min(0, p.npvEquity-expectedNPV),2), 0);
  const downsideSemiDev = Math.sqrt(downsideVar);
  const worstCaseNPV = Math.min(...scenList.map(p=>p.npvEquity));
  const worstCaseDSCR = Math.min(...scenList.map(p=>isFinite(p.avgDSCR)?p.avgDSCR:0));
  const lambda = isFinite(inp.risk_lambda) ? inp.risk_lambda : 0.5;
  const riskAdjustedScore = expectedNPV - lambda*downsideSemiDev;
  return {perScenario, weights, expectedNPV, expectedProjectIRR, expectedDSCR, downsideSemiDev, worstCaseNPV, worstCaseDSCR, riskAdjustedScore, lambda};
}

/* Same penalty structure as scoreExactCandidate, but the NPV/DSCR terms
   come from the PROBABILITY-WEIGHTED risk-adjusted economics (expected
   NPV net of a downside-risk penalty; DSCR penalty uses the WORST-CASE
   scenario DSCR, not the base case) — this is what actually changes
   which architecture the optimiser picks when the risk-adjusted
   objective is selected. */
function scoreRiskAdjustedCandidate(ev, riskEcon, inp){
  if(inp.gridAllowed===false && ev.annual.grid>0.01) return -Infinity;
  if(ev.oaElig.status==='NOT ELIGIBLE') return -Infinity;
  if(ev.gcElig.status==='NOT ELIGIBLE') return -Infinity;
  const W = OPT_WEIGHTS;
  const gridSharePct = ev.annual.demand>0 ? (ev.annual.grid/ev.annual.demand)*100 : 0;
  const reliabCeiling = inp.reliab==='high' ? 50 : 100;
  const curtailMWh = ev.annual.curtail;

  const penalty =
      W.P_TARGET * Math.pow(Math.max(0, inp.retarget-ev.renShare),2) * (ev.annual.demand/1000)
    + W.P_DSCR * Math.max(0, 1.20-riskEcon.worstCaseDSCR) * riskEcon.perScenario.base.totalCapexCr
    + W.P_GRID * Math.max(0, gridSharePct-reliabCeiling) * (ev.annual.demand/1000)
    + W.P_CURT * (curtailMWh * (inp.s_capex*0.02))
    + W.P_UNSERVED * (ev.unservedMWh*(inp.e_price||10)/1000);

  const irrHeadroom = isFinite(riskEcon.expectedProjectIRR) ? W.LAMBDA_IRR*Math.max(0,riskEcon.expectedProjectIRR-inp.f_hurdle)*riskEcon.perScenario.base.totalCapexCr/100 : 0;
  const npvTerm = isFinite(riskEcon.riskAdjustedScore) ? riskEcon.riskAdjustedScore : -1e9;
  return npvTerm + irrHeadroom - penalty;
}

/* Stage 2: re-run EXACT multi-year financing (real 8760xN-year dispatch,
   utilisation ramp, degradation, replacement CAPEX) for each of the
   coarse-stage top-K finalists, then re-rank by the exact score. The
   candidate returned as `best` is the one whose EXACT numbers are what
   gets displayed everywhere downstream (Economics/Decision/Cash Flow) —
   never the steady-state proxy's pick if the exact numbers disagree.

   If inp.riskObjective is set, the re-ranking uses the PROBABILITY-
   WEIGHTED risk-adjusted score (Base/Downside/Upside/Stress, see
   computeRiskAdjustedEconomics) instead of the deterministic Base-Case
   score — so the risk-adjusted objective can genuinely change which
   architecture wins, not just annotate the winner after the fact. */
function refineTopCandidatesExact(inp, units, baseDemand8760, gridCapMW, topK){
  const refined = topK.map(item=>{
    const finExact = computeExactMultiYearFinancing(inp, units, baseDemand8760, item.ev.candidate, gridCapMW);
    if(inp.riskObjective){
      const riskEcon = computeRiskAdjustedEconomics(inp, units, baseDemand8760, item.ev.candidate, gridCapMW);
      const exactScore = scoreRiskAdjustedCandidate(item.ev, riskEcon, inp);
      return {ev:item.ev, coarseScore:item.score, finExact, riskEcon, exactScore};
    }
    const exactScore = scoreExactCandidate(item.ev, finExact, inp);
    return {ev:item.ev, coarseScore:item.score, finExact, riskEcon:null, exactScore};
  });
  refined.sort((a,b)=>b.exactScore-a.exactScore);
  const winner = refined[0];
  const runnerUp = refined[1] || null;

  const best = {name:architectureNameOf(winner.ev), ...winner.ev, meetsTarget: winner.ev.renShare>=inp.retarget, exactScore:winner.exactScore, riskEcon:winner.riskEcon};
  const nextBest = runnerUp ? {name:architectureNameOf(runnerUp.ev), ...runnerUp.ev, scoreGap:winner.exactScore-runnerUp.exactScore, finExact:runnerUp.finExact, riskEcon:runnerUp.riskEcon} : null;
  return {best, nextBest, finExact:winner.finExact, refined, reranked: refined.length>1 && refined[0].coarseScore !== Math.max(...topK.map(t=>t.score)) ? false : (topK[0] && topK[0].ev!==winner.ev)};
}

/* ================================================================
   EXACT MULTI-YEAR FINANCING for the SELECTED architecture.
   Runs a REAL 8760 dispatch for EACH project year (utilisation ramp +
   BESS degradation + panel degradation all applied to that year's
   profiles before dispatch — not a growth-factor multiplier on a
   single dispatch result).
   ================================================================ */
function bessDegradationSchedule(inp, bessMWh, years){
  const rows = [];
  let usableFrac = 1.0, replaced=false, replacementYear=null;
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
  const m = scenMult();
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
  const flowsEquity=[-equityCr];
  const yearRows=[];
  for(let y=1;y<=life;y++){
    const utilFrac = clampV(utilisationFraction(inp, y)*m.util, 0, 3);
    const solDegFactor = Math.pow(1-inp.s_deg/100, y-1);
    const winDegFactor = Math.pow(1-inp.w_deg/100, y-1);
    const bessUsableFrac = degSched.rows[y-1].usableFrac;

    const yUnits = {solarUnit: units.solarUnit, windUnit: units.windUnit}; // shape unchanged, magnitude via candidate*deg below
    const yCandidate = {
      solarMW: candidate.solarMW*solDegFactor, windMW: candidate.windMW*winDegFactor,
      bessMW: candidate.bessMW*bessUsableFrac, bessMWh: candidate.bessMWh*bessUsableFrac,
      oaMW: candidate.oaMW, gcMW: candidate.gcMW
    };
    const {result} = runCandidateDispatch(inp, yUnits, baseDemand8760, yCandidate, utilFrac, gridCapMW, false);
    const a = result.annual;
    const servedMWh = a.demand - a.unserved;

    const solarOM_perKWh = a.solar>0 ? (sol.annualOM*1e7)/(a.solar*1000) : 0;
    const windOM_perKWh = a.wind>0 ? (win.annualOM*1e7)/(a.wind*1000) : 0;
    const gridRate = gridRatePerKWh(inp, a.grid, result.peakGridMW);
    const energyCostCr = (a.solar*solarOM_perKWh + a.wind*windOM_perKWh + a.gc*gcOpexRate + a.oa*oaRate + a.grid*gridRate)*1000/1e7;

    const rev = servedMWh*1000*blendedPrice/1e7 * Math.pow(1+inp.growth/100, Math.min(y-1,0)); // growth already embedded via utilisation ramp; kept =1 multiplier to avoid double-counting growth
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
      utilFrac, servedMWh, annual:a, energyCostCr, landedCostPerKWh: a.demand>0 ? (energyCostCr*1e7)/(a.demand*1000):0,
      solDegFactor, winDegFactor, bessUsableFrac,
      solarCapacityMWhAvail: sumProfile(scaleProfile(yUnits.solarUnit, yCandidate.solarMW))});
  }
  const projectFlows = [-totalCapexCr, ...yearRows.map(r=>r.ebitda*(1-inp.f_tax/100)+r.dep*inp.f_tax/100-r.replCapexThisYear)];
  const equityIRR = irr(flowsEquity);
  const projectIRR = irr(projectFlows);
  const npvEquity = npv(inp.f_hurdle, flowsEquity);
  let cum=-equityCr, payback=NaN;
  for(let y=1;y<yearRows.length;y++){ cum+=yearRows[y].fcfe; if(cum>=0 && isNaN(payback)) payback=y; }
  const avgDSCR = yearRows.filter(r=>!isNaN(r.dscr)).reduce((s,r,_,a)=>s+r.dscr/a.length,0);
  const roic = totalCapexCr>0 ? (yearRows[0].ebitda/totalCapexCr)*100 : 0;
  const dscrOK = avgDSCR>=inp.f_mindscr;

  return {totalCapexCr, debtCr, equityCr, revenueCr:yearRows[0].rev, opexCr:yearRows[0].opex, ebitdaCr:yearRows[0].ebitda,
    equityIRR, projectIRR, npvEquity, payback, avgDSCR, roic, rows:yearRows, blendedPrice,
    landedCost:yearRows[0].landedCostPerKWh, dscrOK, replacementYear:degSched.replacementYear, replacementCapexCr:degSched.replacementCapexCr,
    gcMyEquityCapexCr, bessCapexCr};
}

/* ================================================================
   MINIMUM-UTILISATION SOLVER
   For a FIXED architecture/CAPEX, scales the utilisation ramp (Year-1
   and terminal %, same ratio preserved) by a single multiplier and
   bisection-searches for the lowest terminal utilisation at which each
   threshold is still met. Every trial point is a REAL exact multi-year
   8,760h run (computeExactMultiYearFinancing) — not a shortcut formula
   or linear approximation.
   ================================================================ */
function evalAtUtilMultiplier(inp, units, baseDemand8760, candidate, gridCapMW, m){
  const inp2 = {...inp, util_y1: inp.util_y1*m, util_terminal: inp.util_terminal*m};
  return computeExactMultiYearFinancing(inp2, units, baseDemand8760, candidate, gridCapMW);
}
function bisectMinUtilMultiplier(inp, units, baseDemand8760, candidate, gridCapMW, meetsFn){
  const lo0=0.01, hi0=2.5;
  const finLo = evalAtUtilMultiplier(inp, units, baseDemand8760, candidate, gridCapMW, lo0);
  if(meetsFn(finLo)) return {multiplier:lo0, achievable:true, atFloor:true};
  const finHi = evalAtUtilMultiplier(inp, units, baseDemand8760, candidate, gridCapMW, hi0);
  if(!meetsFn(finHi)) return {multiplier:null, achievable:false, atFloor:false};
  let lo=lo0, hi=hi0;
  for(let i=0;i<22;i++){
    const mid=(lo+hi)/2;
    const finMid = evalAtUtilMultiplier(inp, units, baseDemand8760, candidate, gridCapMW, mid);
    if(meetsFn(finMid)) hi=mid; else lo=mid;
  }
  return {multiplier:hi, achievable:true, atFloor:false};
}
function solveMinUtilizationThresholds(inp, units, baseDemand8760, candidate, gridCapMW){
  const npvRes    = bisectMinUtilMultiplier(inp, units, baseDemand8760, candidate, gridCapMW, f=>isFinite(f.npvEquity) && f.npvEquity>=0);
  const pirrRes   = bisectMinUtilMultiplier(inp, units, baseDemand8760, candidate, gridCapMW, f=>isFinite(f.projectIRR) && f.projectIRR>=inp.f_hurdle);
  const eirrRes   = bisectMinUtilMultiplier(inp, units, baseDemand8760, candidate, gridCapMW, f=>isFinite(f.equityIRR) && f.equityIRR>=inp.f_hurdle);
  const dscrRes   = bisectMinUtilMultiplier(inp, units, baseDemand8760, candidate, gridCapMW, f=>isFinite(f.avgDSCR) && f.avgDSCR>=inp.f_mindscr);
  const toUtilPct = r => r.achievable ? clampV(inp.util_terminal*r.multiplier,0,300) : null;
  return {
    npv:        {label:'NPV break-even (equity NPV ≥ 0)',                utilPct:toUtilPct(npvRes),  ...npvRes},
    projectIRR: {label:`Project IRR ≥ hurdle (${fmt(inp.f_hurdle,1)}%)`, utilPct:toUtilPct(pirrRes), ...pirrRes},
    equityIRR:  {label:`Equity IRR ≥ hurdle (${fmt(inp.f_hurdle,1)}%)`,  utilPct:toUtilPct(eirrRes), ...eirrRes},
    dscr:       {label:`DSCR ≥ covenant (${fmt(inp.f_mindscr,2)}×)`,     utilPct:toUtilPct(dscrRes), ...dscrRes},
  };
}



/* ================================================================
   BESS VALUE STACK — same integrated engine, WITH vs WITHOUT BESS,
   at steady-state, MW×MWh grid sweep (independent variables).
   ================================================================ */
function bessSweep8760(inp, units, baseDemand8760, gridCapMW, fixedCandidate){
  const mwhSteps = (()=>{ const arr=[]; const step=Math.max(inp.b_maxmwh/8,0.5); for(let v=0;v<=inp.b_maxmwh+1e-9;v+=step) arr.push(v); return arr; })();
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
      const capexCr = mwh*inp.b_capex*scenMult().bess + bessMW*inp.b_capex_mw*scenMult().bess;
      const annualCapexCr = capexCr*crf(inp.f_hurdle,10);
      const omCr = capexCr*(inp.b_om/100);
      const netValueCr = grossAvoidedCr-annualCapexCr-omCr;
      if(!bestForMWh || netValueCr>bestForMWh.netValueCr) bestForMWh = {mwh, bessMW, grossValueCr:grossAvoidedCr, annualCapexCr:annualCapexCr+omCr, netValueCr, annualShiftedMWh:result.annual.bessDischarge, unservedWith:result.annual.unserved};
    });
    results.push(bestForMWh);
  });
  let best = results[0];
  results.forEach(r=>{ if(r.netValueCr>best.netValueCr) best=r; });
  return {results, best, withoutAnnual:withoutR.annual, annualGridCostWithoutCr};
}
function bessBenefitAnalysis8760(inp, units, baseDemand8760, gridCapMW, fixedCandidate, bessMW, bessMWh){
  const withoutCandidate = {...fixedCandidate, bessMW:0, bessMWh:0};
  const withCandidate = {...fixedCandidate, bessMW, bessMWh};
  const {result:withoutR} = runCandidateDispatch(inp, units, baseDemand8760, withoutCandidate, 1.0, gridCapMW, false);
  const {result:withR} = runCandidateDispatch(inp, units, baseDemand8760, withCandidate, 1.0, gridCapMW, false);
  const gridRateWithout = gridRatePerKWh(inp, withoutR.annual.grid, withoutR.peakGridMW);
  const gridRateWith = gridRatePerKWh(inp, withR.annual.grid, withR.peakGridMW);
  const annualGridCostWithoutCr = withoutR.annual.grid*1000*gridRateWithout/1e7;
  const annualGridCostWithCr = withR.annual.grid*1000*gridRateWith/1e7;
  const grossAvoidedGridCostCr = annualGridCostWithoutCr-annualGridCostWithCr;
  const capexCr = bessMWh*inp.b_capex*scenMult().bess + bessMW*inp.b_capex_mw*scenMult().bess;
  const annualCapexCr = capexCr*crf(inp.f_hurdle,10);
  const omCr = capexCr*(inp.b_om/100);
  const netBenefitCr = grossAvoidedGridCostCr-annualCapexCr-omCr;
  return {grossAvoidedGridCostCr, annualCapexCr, omCr, netBenefitCr,
    annualShiftedMWh:withR.annual.bessDischarge, annualUnservedWith:withR.annual.unserved, annualUnservedWithout:withoutR.annual.unserved,
    withAnnual:withR.annual, withoutAnnual:withoutR.annual};
}

/* ================================================================
   REVERSE PRICING (holds architecture/CAPEX fixed, solves price)
   ================================================================ */
function reversePricing8760(inp, units, baseDemand8760, candidate, gridCapMW, landedCost){
  const targetIRR = inp.f_targetirr;
  const {result} = runCandidateDispatch(inp, units, baseDemand8760, candidate, 1.0, gridCapMW, false);
  const servedMWh = result.annual.demand-result.annual.unserved;
  const priceForIRR = (()=>{
    let lo=0.3, hi=5.0;
    const test = mult => {
      const inp2 = {...inp, e_price:inp.e_price*mult, e_fleetprice:inp.e_fleetprice*mult};
      const ev = evaluateCandidateSteadyState(inp2, units, baseDemand8760, candidate, gridCapMW, null);
      return ev.proxyEquityIRR;
    };
    let flo=test(lo), fhi=test(hi);
    if(isNaN(flo)||isNaN(fhi)) return NaN;
    for(let i=0;i<40;i++){
      const mid=(lo+hi)/2, fm=test(mid);
      if(Math.abs(fm-targetIRR)<0.05) return inp.e_price*mid;
      if(fm<targetIRR) lo=mid; else hi=mid;
    }
    return inp.e_price*((lo+hi)/2);
  })();
  const targetMarginPrice = landedCost/(1-0.30);
  return {priceForIRR, targetMarginPrice};
}

/* ================================================================
   RENDER FUNCTIONS
   ================================================================ */
__RENDER_FUNCTIONS__

/* ---------------- init ---------------- */
renderDemandTable();
renderAll();
renderTestResults();
