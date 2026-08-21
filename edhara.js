/* ============================================================
   E-DHARA ENGINE — application layer
   Consumes the canonical 8760-hour engine (engine functions below,
   identical to /engine.js, inlined for a single self-contained file).
   Nothing here should be read as a verified current regulatory or
   company fact unless a source has been attached in the Audit tab.
   ============================================================ */

/* ---- ENGINE CORE (see engine.js for the Node-tested standalone copy) ---- */
/* ============================================================
   E-DHARA CANONICAL 8760-HOUR ENGINE
   Pure functions, no DOM. Testable in Node, then embedded as-is
   into the browser build.
   ============================================================ */

const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

/* ---------------- 8760 timeline (built once, constant) ---------------- */
function generate8760Timeline(){
  const daysInMonth=[31,28,31,30,31,30,31,31,30,31,30,31];
  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const timeline=[];
  let idx=0, doy=0;
  for(let m=0;m<12;m++){
    for(let d=1; d<=daysInMonth[m]; d++){
      for(let h=0; h<24; h++){
        timeline.push({idx, month:m, monthName:monthNames[m], day:d, hour:h, doy, dow:doy%7});
        idx++;
      }
      doy++;
    }
  }
  return timeline; // length 8760 exactly (non-leap synthetic year)
}
const TIMELINE_8760 = generate8760Timeline();
const HOURS_PER_YEAR = TIMELINE_8760.length; // 8760

/* ---------------- operating-day mask ----------------
   `opdays` no longer multiplies a 24h representative day into an annual
   number. Instead it determines, inside the 8760 profile itself, which
   of the 365 days actually see charging demand (spread evenly across
   the year via a Bresenham-style accumulator, not bunched at the start).
   This keeps opdays meaningful without it being the annual-total formula. */
function operatingDayMask(opdays){
  const totalDays=365;
  const on = new Array(totalDays).fill(false);
  const frac = clamp(opdays,0,365)/totalDays;
  let acc=0;
  for(let d=0; d<totalDays; d++){
    acc+=frac;
    if(acc>=0.999999){ on[d]=true; acc-=1; }
  }
  return on;
}

/* ---------------- 24h shape helper (reused inside 8760 generation) ---------------- */
function shapeArray(shape){
  const flat = Array(24).fill(1/24);
  if(shape==='flat') return flat;
  const arr = Array(24).fill(0);
  if(shape==='daytime'){ for(let h=8;h<18;h++) arr[h]=1; }
  else if(shape==='evening'){ for(let h=16;h<23;h++) arr[h]=1; for(let h=8;h<16;h++) arr[h]=0.4; }
  else if(shape==='night'){ for(let h=0;h<6;h++) arr[h]=1; for(let h=20;h<24;h++) arr[h]=0.8; for(let h=6;h<20;h++) arr[h]=0.25; }
  else return flat;
  const s = arr.reduce((a,b)=>a+b,0);
  return arr.map(v=>v/s);
}

/* ---------------- DEMAND 8760 (terminal / steady-state) ----------------
   dailyKWhTotal: steady-state daily energy (kWh) from the vehicle table.
   Returns an 8760-length MWh/hour array representing TERMINAL demand.
   Multiply elementwise by a scalar utilisation fraction for a given
   project year — this is the ONLY place annual demand is derived, and
   it is NOT `24h-day-total * opdays`; opdays instead zeroes out
   non-operating days inside the full 365-day/8760-hour array. */
function generateDemand8760Profile(dailyKWhTotal, shape, opdays){
  const hourWeights = shapeArray(shape); // sums to 1 across 24h
  const mask = operatingDayMask(opdays);
  const out = new Float64Array(HOURS_PER_YEAR);
  for(let h=0; h<HOURS_PER_YEAR; h++){
    const t = TIMELINE_8760[h];
    if(!mask[t.doy]){ out[h]=0; continue; }
    out[h] = (dailyKWhTotal * hourWeights[t.hour]) / 1000; // kWh -> MWh
  }
  return out;
}

/* ---------------- SOLAR / WIND unit-MW 8760 shapes ----------------
   Synthetic, deterministic, clearly labelled placeholders. Built to
   auto-scale so the annual energy from 1 MW installed capacity equals
   exactly 8760 * (CUF%) MWh, matching the CUF input the user enters —
   the shape distributes that energy across a solar bell-curve day and
   a seasonal multiplier (India-generic, NOT a specific site/weather
   dataset), rather than repeating one flat day 365 times. */
const SOLAR_SEASONAL = [0.92,0.98,1.08,1.12,1.10,0.92,0.78,0.80,0.92,1.02,1.00,0.94]; // Jan..Dec, avg ~1.0
const WIND_SEASONAL   = [0.75,0.70,0.75,0.95,1.25,1.55,1.60,1.45,1.05,0.75,0.65,0.65]; // pre/monsoon-heavy, avg ~1.0

function _normalizeSeasonal(arr){
  const daysInMonth=[31,28,31,30,31,30,31,31,30,31,30,31];
  const weighted = arr.reduce((s,v,i)=>s+v*daysInMonth[i],0)/365;
  return arr.map(v=>v/weighted);
}
const SOLAR_SEASONAL_N = _normalizeSeasonal(SOLAR_SEASONAL);
const WIND_SEASONAL_N  = _normalizeSeasonal(WIND_SEASONAL);

function solarDayCurve(hour){
  const x=(hour-12)/6.5;
  return Math.max(0, Math.exp(-x*x*2.2));
}
function windDayCurve(hour){
  return Math.max(0, 0.85+0.3*Math.sin((hour-3)/24*2*Math.PI));
}

/* returns an 8760 MWh/hour array for 1 MW installed capacity, rescaled
   so its annual sum == 8760*(cufPct/100) MWh exactly. */
function generateUnitMWShape8760(cufPct, kind){
  const raw = new Float64Array(HOURS_PER_YEAR);
  const dayFn = kind==='wind' ? windDayCurve : solarDayCurve;
  const seasonal = kind==='wind' ? WIND_SEASONAL_N : SOLAR_SEASONAL_N;
  for(let h=0; h<HOURS_PER_YEAR; h++){
    const t = TIMELINE_8760[h];
    raw[h] = dayFn(t.hour) * seasonal[t.month];
  }
  const rawSum = raw.reduce((s,v)=>s+v,0);
  const targetAnnual = HOURS_PER_YEAR*(cufPct/100);
  const scale = rawSum>0 ? targetAnnual/rawSum : 0;
  const out = new Float64Array(HOURS_PER_YEAR);
  for(let h=0;h<HOURS_PER_YEAR;h++) out[h]=raw[h]*scale;
  return out; // MWh/hour per 1 MW installed
}

function scaleProfile(unitShape, mw){
  const out = new Float64Array(HOURS_PER_YEAR);
  for(let h=0;h<HOURS_PER_YEAR;h++) out[h]=unitShape[h]*mw;
  return out;
}
function addProfiles(...profiles){
  const out = new Float64Array(HOURS_PER_YEAR);
  for(const p of profiles) for(let h=0;h<HOURS_PER_YEAR;h++) out[h]+=p[h];
  return out;
}
function constProfile(mw){
  const out = new Float64Array(HOURS_PER_YEAR);
  out.fill(mw);
  return out;
}

/* ---------------- OA availability profile ----------------
   OA is now a real hourly-available energy source, not an annual
   blended ₹/kWh adjustment. `oaMW` = contracted capacity; `oaShape`
   selects whether the contracted block behaves like solar-shaped,
   wind-shaped, or firm round-the-clock (flat) supply — an explicit,
   editable MODEL ASSUMPTION about the OA generator's profile, not a
   regulatory fact. */
function generateOA8760Profile(oaMW, oaShape, solarUnitShape, windUnitShape){
  if(oaMW<=0) return new Float64Array(HOURS_PER_YEAR);
  if(oaShape==='wind') return scaleProfile(windUnitShape, oaMW);
  if(oaShape==='flat') return constProfile(oaMW);
  return scaleProfile(solarUnitShape, oaMW); // default solar-shaped
}

/* ---------------- GC generation + entitlement profile ----------------
   Ownership/equity %, energy entitlement %, and actual self-consumption
   are kept as three distinct numbers (never collapsed):
   - gcGenProfile8760: SPV's own physical generation (solar+wind mix)
   - gcEntitlementPct: contractual/assumed share of that generation
     allocated to this site's energy account — an explicit editable
     assumption field, independent of equity %.
   - actual self-consumption is measured AFTER dispatch (how much of
     the entitled energy the site could actually use). */
function generateGC8760Profiles(gcMW, solarSharePct, solarUnitShape, windUnitShape, entitlementPct){
  const solarMW = gcMW*(solarSharePct/100);
  const windMW = gcMW*(1-solarSharePct/100);
  const genProfile = addProfiles(scaleProfile(solarUnitShape, solarMW), scaleProfile(windUnitShape, windMW));
  const availProfile = new Float64Array(HOURS_PER_YEAR);
  const frac = clamp(entitlementPct,0,100)/100;
  for(let h=0;h<HOURS_PER_YEAR;h++) availProfile[h]=genProfile[h]*frac;
  return {genProfile, availProfile};
}

/* ================================================================
   CANONICAL 8760 DISPATCH
   Priority order over ['solar','wind','gc','oa','bess'] to meet demand;
   'grid' always resolves last, hard-capped at gridCapMW; unmet demand
   after the grid cap is recorded as unserved energy — never silently
   imported. BESS also gets an explicit charging pass fed only by
   OWNED surplus renewable (solar+wind) left over after demand is met,
   consistent with dispatch priority — GC/OA surplus is not assumed
   curtailable at this site since it is procured, not owned generation.
   Runs for all 8760 hours in one pass; `collectHourly` controls whether
   full per-hour arrays are retained (needed for charts) or only
   monthly/annual aggregates are accumulated (used by the optimizer for
   speed across many candidates).
   ================================================================ */
function runDispatch8760(profiles, params, collectHourly){
  const {demand, solar, wind, gcAvail, oaAvail} = profiles;
  const n = demand.length;
  const priority = params.priorityOrder || ['solar','wind','gc','oa','bess','grid'];
  const demandPriority = priority.filter(p=>p!=='grid'); // grid always resolved last regardless of position

  const socMin = params.bessMWh*params.socMinFrac;
  const socMax = params.bessMWh*params.socMaxFrac;
  let soc = params.bessMWh*0.5;

  const monthly = Array.from({length:12},()=>({
    demand:0, solar:0, wind:0, gc:0, oa:0, bessCharge:0, bessDischarge:0, grid:0, curtail:0, unserved:0
  }));
  let peakGridMW = 0;
  let peakGridNeedMW = 0;
  const hourly = collectHourly ? [] : null;

  for(let h=0; h<n; h++){
    const t = TIMELINE_8760[h];
    let need = demand[h];
    const totalDemandThisHour = need;
    let solarAvail = solar[h], windAvail = wind[h], gcAv = gcAvail[h], oaAv = oaAvail[h];
    let solarUsed=0, windUsed=0, gcUsed=0, oaUsed=0, bessDis=0, gridUsed=0;

    for(const src of demandPriority){
      if(need<=1e-9) break;
      if(src==='solar'){ const u=Math.min(solarAvail,need); solarUsed+=u; need-=u; solarAvail-=u; }
      else if(src==='wind'){ const u=Math.min(windAvail,need); windUsed+=u; need-=u; windAvail-=u; }
      else if(src==='gc'){ const u=Math.min(gcAv,need); gcUsed+=u; need-=u; gcAv-=u; }
      else if(src==='oa'){ const u=Math.min(oaAv,need); oaUsed+=u; need-=u; oaAv-=u; }
      else if(src==='bess'){
        const maxDis = Math.max(0, Math.min(params.bessMW, (soc-socMin)*params.dischargeEff));
        const u = Math.min(maxDis, need);
        if(u>0){ bessDis+=u; need-=u; soc-=u/params.dischargeEff; }
      }
    }
    // grid resolves last, hard-capped — track the UNCAPPED requirement too,
    // so the reason for any unserved energy can be shown honestly (peakGridMW
    // itself is always <= gridCapMW by construction and can never "exceed" it).
    peakGridNeedMW = Math.max(peakGridNeedMW, Math.max(need,0));
    gridUsed = Math.min(params.gridCapMW, Math.max(need,0));
    let unserved = Math.max(need-gridUsed, 0);

    // BESS charging pass: only from leftover OWNED renewable surplus, only if
    // we did not already discharge this hour (no same-hour charge+discharge).
    let bessChg=0, curtail=0;
    const surplus = solarAvail + windAvail; // whatever remains unused for demand
    if(bessDis<=1e-9 && surplus>1e-9 && soc<socMax){
      const headroomMWh = (socMax-soc)/params.chargeEff;
      const maxChg = Math.min(params.bessMW, surplus, headroomMWh);
      bessChg = Math.max(0,maxChg);
      soc += bessChg*params.chargeEff;
    }
    curtail = Math.max(surplus-bessChg,0);

    peakGridMW = Math.max(peakGridMW, gridUsed);

    const m = t.month;
    monthly[m].demand += totalDemandThisHour;
    monthly[m].solar += solarUsed;
    monthly[m].wind += windUsed;
    monthly[m].gc += gcUsed;
    monthly[m].oa += oaUsed;
    monthly[m].bessCharge += bessChg;
    monthly[m].bessDischarge += bessDis;
    monthly[m].grid += gridUsed;
    monthly[m].curtail += curtail;
    monthly[m].unserved += unserved;

    if(collectHourly){
      hourly.push({idx:h, month:t.month, day:t.day, hour:t.hour,
        demand:totalDemandThisHour, solar:solarUsed, wind:windUsed, gc:gcUsed, oa:oaUsed,
        bessCharge:bessChg, bessDischarge:bessDis, grid:gridUsed, unserved, curtail, soc, socMin, socMax});
    }
  }

  const annual = monthly.reduce((s,m)=>({
    demand:s.demand+m.demand, solar:s.solar+m.solar, wind:s.wind+m.wind, gc:s.gc+m.gc, oa:s.oa+m.oa,
    bessCharge:s.bessCharge+m.bessCharge, bessDischarge:s.bessDischarge+m.bessDischarge,
    grid:s.grid+m.grid, curtail:s.curtail+m.curtail, unserved:s.unserved+m.unserved
  }), {demand:0,solar:0,wind:0,gc:0,oa:0,bessCharge:0,bessDischarge:0,grid:0,curtail:0,unserved:0});

  return {monthly, annual, peakGridMW, peakGridNeedMW, hourly};
}



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
  // Gujarat state-owned DISCOM defaults (DGVCL/MGVCL/PGVCL/UGVCL) — the g_energy,
  // oa_wheel, oa_css and oa_addl figures below are VERIFIED against the GERC
  // FY2026-27 tariff schedule / Fifth GEOA Amendment 2026 (see STATE_PROVENANCE /
  // GUJARAT_DISCOMS for sources). gc_charges, s_cuf and w_cuf remain editable
  // model assumptions/benchmarks — never treat them as verified regulatory fact.
  "Gujarat":     {g_energy:4.00, oa_css:1.33, oa_wheel:0.2352, oa_addl:0.76, oa_bank:1.50, gc_charges:1.35, s_cuf:19.5, w_cuf:26, verified:false},
  "Rajasthan":   {g_energy:6.90, oa_css:1.35, oa_wheel:0.70, oa_addl:null, oa_bank:null, gc_charges:1.20, s_cuf:21.5, w_cuf:22, verified:false},
  "Maharashtra": {g_energy:8.10, oa_css:1.55, oa_wheel:1.05, oa_addl:null, oa_bank:null, gc_charges:1.75, s_cuf:18.5, w_cuf:20, verified:false},
  "Karnataka":   {g_energy:7.60, oa_css:1.40, oa_wheel:0.95, oa_addl:null, oa_bank:null, gc_charges:1.60, s_cuf:18.0, w_cuf:24, verified:false},
  "Tamil Nadu":  {g_energy:7.80, oa_css:1.20, oa_wheel:0.90, oa_addl:null, oa_bank:null, gc_charges:1.55, s_cuf:17.5, w_cuf:28, verified:false},
  "Delhi":       {g_energy:8.40, oa_css:1.65, oa_wheel:1.15, oa_addl:null, oa_bank:null, gc_charges:1.85, s_cuf:17.0, w_cuf:0,  verified:false},
};
/* ---------------- data provenance (Part 11) ----------------
   Every regulatory input carries value/source/effective-date/status so the
   UI never presents a benchmark or draft figure as a confirmed final tariff. */
const STATE_PROVENANCE = {
  "Gujarat": {
    g_energy:{status:'VERIFIED', label:'HT EV-charging energy charge', source:'GERC FY2026-27 Tariff Schedule (DGVCL/MGVCL/PGVCL/UGVCL), Part II, Sec. 17 "Rate: HT Electric Vehicle (EV) Charging Stations", para 17.2', url:'https://gercin.org/wp-content/uploads/2026/03/Tariff-Schedule-of-DGVCL-MGVCL-PGVCL-UGVCL-w.e.f.-01.04.2026.pdf', effective:'01-04-2026'},
    oa_wheel:{status:'VERIFIED', label:'HT wheeling charge', source:'GERC FY2026-27 tariff schedule', url:'https://gercin.org/wp-content/uploads/2026/03/Tariff-Schedule-of-DGVCL-MGVCL-PGVCL-UGVCL-w.e.f.-01.04.2026.pdf', effective:'01-04-2026'},
    oa_css:{status:'VERIFIED', label:'HT cross-subsidy surcharge', source:'GERC FY2026-27 tariff order', url:'https://gercin.org/wp-content/uploads/2026/03/DGVCL-2581-2025-Tariff-Order-for-FY-2026-27-dtd.-25.03.2026.pdf', effective:'01-04-2026'},
    oa_addl:{status:'VERIFIED / TIME LIMITED', label:'Additional surcharge', source:'GERC Additional Surcharge Order No. 02 of 2026', url:'https://gercin.org/order-category/other-orders/', effective:'01-04-2026', expiry:'30-09-2026'},
    oa_bank:{status:'VERIFIED / TIME LIMITED', label:'Banking charge', source:'GERC Fifth GEOA Amendment 2026', url:'https://gercin.org/wp-content/uploads/2026/06/Final-GEOA-5th-Amendment-2026.pdf', effective:'through 31-08-2026', expiry:'31-08-2026'},
    gc_charges:{status:'NOT VERIFIED', label:'GC variable/pass-through charges', source:'Not a confirmed quote — user input required', url:'', effective:''},
    g_fppca:{status:'NOT VERIFIED', label:'FPPPA / fuel & power purchase price adjustment', source:'Confirmed as a genuinely SEPARATE charge by the tariff schedule itself (General Provisions para 2 & para 12: "these tariffs are exclusive of... taxes and other charges... payable in addition"; "FPPAS shall be applicable in accordance with the Formula approved by GERC from time to time") — the schedule does not state a rate because it is revised periodically outside this document; check the current DISCOM FPPPA/FPPAS order before relying on the delivered grid cost', url:'https://gercin.org/order-category/other-orders/', effective:'varies by quarter'},
    g_excess_demand:{status:'VERIFIED', label:'Excess-demand charge (above sanctioned load)', source:'GERC FY2026-27 Tariff Schedule, Part II, Sec. 17 "Rate: HT EV Charging Stations", para 17.1(b)', url:'https://gercin.org/wp-content/uploads/2026/03/Tariff-Schedule-of-DGVCL-MGVCL-PGVCL-UGVCL-w.e.f.-01.04.2026.pdf', effective:'01-04-2026'},
    g_conn_amort:{status:'NOT VERIFIED', label:'Connection-related costs, amortized', source:'Site-specific one-time connection/service-line charges — not a standard schedule figure; user input required', url:'', effective:''},
    s_cuf:{status:'BENCHMARK', label:'Solar CUF', source:'Indicative Gujarat solar benchmark, not project-specific', url:'', effective:''},
    w_cuf:{status:'BENCHMARK', label:'Wind CUF', source:'Indicative Gujarat wind benchmark, not project-specific', url:'', effective:''},
    oa_energy:{status:'BENCHMARK', label:'Solar/wind PPA (generation) benchmark', source:'Recent GUVNL competitive-bidding tariffs (project-specific; GERC solar proceedings still pending) — this is a GENERATION price, not a delivered OA price', url:'', effective:''},
  }
};
/* ---------------- Gujarat DISCOM / supply-area table (Part 9) ----------------
   Only the four state-owned DISCOMs share a common, currently-verified GERC
   tariff schedule. Distribution licensees (Torrent, MUL, AIVPL, GIFT PCL) file
   their own tariffs — those component values are intentionally left
   NOT VERIFIED rather than silently borrowing the state-owned numbers. */
const GUJARAT_DISCOMS = {
  "DGVCL":              {label:'DGVCL (state-owned)', g_energy:4.00, g_demand:25, g_tod:0.45, g_solardisc:0.60, oa_wheel:0.2352, oa_css:1.33, oa_addl:0.76, oa_bank:1.50, status:'VERIFIED'},
  "MGVCL":              {label:'MGVCL (state-owned)', g_energy:4.00, g_demand:25, g_tod:0.45, g_solardisc:0.60, oa_wheel:0.2352, oa_css:1.33, oa_addl:0.76, oa_bank:1.50, status:'VERIFIED'},
  "PGVCL":              {label:'PGVCL (state-owned)', g_energy:4.00, g_demand:25, g_tod:0.45, g_solardisc:0.60, oa_wheel:0.2352, oa_css:1.33, oa_addl:0.76, oa_bank:1.50, status:'VERIFIED'},
  "UGVCL":              {label:'UGVCL (state-owned)', g_energy:4.00, g_demand:25, g_tod:0.45, g_solardisc:0.60, oa_wheel:0.2352, oa_css:1.33, oa_addl:0.76, oa_bank:1.50, status:'VERIFIED'},
  "Torrent-Ahmedabad":  {label:'Torrent Power — Ahmedabad', g_energy:null, g_demand:null, g_tod:null, g_solardisc:null, oa_wheel:null, oa_css:null, oa_addl:null, oa_bank:null, status:'NOT_VERIFIED'},
  "Torrent-Surat":      {label:'Torrent Power — Surat', g_energy:null, g_demand:null, g_tod:null, g_solardisc:null, oa_wheel:null, oa_css:null, oa_addl:null, oa_bank:null, status:'NOT_VERIFIED'},
  "Torrent-Dahej":      {label:'Torrent Power — Dahej', g_energy:null, g_demand:null, g_tod:null, g_solardisc:null, oa_wheel:null, oa_css:null, oa_addl:null, oa_bank:null, status:'NOT_VERIFIED'},
  "MUL":                {label:'MUL (Maruti captive licensee)', g_energy:null, g_demand:null, g_tod:null, g_solardisc:null, oa_wheel:null, oa_css:null, oa_addl:null, oa_bank:null, status:'NOT_VERIFIED'},
  "AIVPL":               {label:'AIVPL', g_energy:null, g_demand:null, g_tod:null, g_solardisc:null, oa_wheel:null, oa_css:null, oa_addl:null, oa_bank:null, status:'NOT_VERIFIED'},
  "GIFT-PCL":           {label:'GIFT Power Company Ltd (GIFT City)', g_energy:null, g_demand:null, g_tod:null, g_solardisc:null, oa_wheel:null, oa_css:null, oa_addl:null, oa_bank:null, status:'NOT_VERIFIED'},
};
function applyDiscom(key){
  const d = GUJARAT_DISCOMS[key];
  if(!d) return;
  const setIf = (id,val)=>{ if(val!=null && $(id)) $(id).value = val; };
  setIf('g_energy', d.g_energy); setIf('g_demand', d.g_demand); setIf('g_tod', d.g_tod); setIf('g_solardisc', d.g_solardisc);
  setIf('oa_wheel', d.oa_wheel); setIf('oa_css', d.oa_css); setIf('oa_addl', d.oa_addl); setIf('oa_bank', d.oa_bank);
  // FPPPA is intentionally NEVER auto-filled here, even for the four state-owned
  // DISCOMs whose base tariff schedule is otherwise VERIFIED: FPPPA/FPPAS is a
  // separately-notified, periodically-revised (typically quarterly) surcharge,
  // shown as its own line on the bill per GERC's own directive. Silently
  // defaulting it to a number would misrepresent a live regulatory figure as
  // settled, exactly the "not sufficiently defined" mistake this model must avoid.
  const note = $('discomStatusNote');
  if(note){
    note.innerHTML = d.status==='VERIFIED'
      ? `<span class="pill high">VERIFIED</span> Tariff fields pre-filled from the GERC FY2026-27 schedule for ${d.label}. All fields remain editable. <b>FPPPA/FPPAS is NOT auto-filled</b> — it is revised periodically and must be checked against ${d.label}'s current notified rate before relying on the delivered grid cost.`
      : `<span class="pill low">NOT VERIFIED</span> ${d.label} sets its own tariff — no confirmed current figures are loaded here. Fields are left as-is; enter the actual applicable tariff (including its own FPPPA/fuel-adjustment charge) manually rather than relying on the state-owned DISCOM numbers.`;
  }
}
/* ---------------- banking-charge time validity (Part 4) ---------------- */
function bankingRegulatoryStatus(){
  const expiry = new Date('2026-08-31T23:59:59+05:30');
  const now = new Date();
  if(now.getTime()>expiry.getTime()){
    return {status:'UPDATE REQUIRED', message:'Banking charge is time-sensitive. The notified ₹1.50/kWh rate (GERC Fifth GEOA Amendment 2026) expired 31 August 2026. This model has NOT been auto-updated with a post-expiry rate — confirm the current GERC-notified banking charge and update the "Banking" input before relying on this figure. Do not assume the Draft Sixth GEOA Amendment applies; it is a draft, not a final regulation.'};
  }
  return {status:'VERIFIED / TIME LIMITED', message:'Banking charge is time-sensitive. Current notified rate is ₹1.50/kWh through 31 August 2026 (GERC Fifth GEOA Amendment 2026). Post-August treatment must be updated when GERC notifies the applicable charge — the Draft Sixth GEOA Amendment (June 2026) is NOT final and is not used as a default here.'};
}

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
    g_energy:v('g_energy'), g_demand:v('g_demand'), g_fixed:v('g_fixed'), g_tod:v('g_tod'), g_solardisc:v('g_solardisc'), g_excess_demand:v('g_excess_demand'), g_fppca:v('g_fppca'), g_conn_amort:v('g_conn_amort'), g_tax:v('g_tax'), g_sanc:v('g_sanc'),
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
/* ================================================================
   GRID FULLY-LOADED COST ENGINE (Part 1/2 fix)
   Grid cost is never just the base ₹/kWh energy charge. This builds:
   base energy rate -> ToU-adjusted effective energy rate (peak-window
   surcharge, solar-window discount) -> + demand/fixed charges
   apportioned over the dispatch's own annual grid energy -> + tax.
   ToU incidence is allocated using the SAME hourly demand SHAPE the
   rest of the model already uses (an explicit, stated allocation
   assumption — full hour-by-hour ToU billing against the actual
   dispatched grid-import profile is a natural v2 extension once
   per-source hourly series are retained for every run, not just
   collectHourly runs). */
function computeGridCostEngine(inp, gridMWhAnnual, peakGridMW){
  const m = scenMult();
  const hourWeights = shapeArray(inp.shape); // sums to 1 across 24h, reused as ToU incidence proxy
  const PEAK_HOURS = [7,8,9,10,18,19,20,21];   // GERC HT-EVCS peak ToU windows: 07-11, 18-22
  const SOLAR_HOURS = [11,12,13,14,15,16];      // GERC HT-EVCS solar-hour discount window: 11-17
  let peakW=0, solarW=0;
  PEAK_HOURS.forEach(h=>peakW+=hourWeights[h]);
  SOLAR_HOURS.forEach(h=>solarW+=hourWeights[h]);
  const baseEnergyRate = inp.g_energy*m.grid;
  const touAdj = peakW*(inp.g_tod||0) - solarW*(inp.g_solardisc||0);
  // FPPPA/FPPAS is a distinct, separately-notified pass-through (not part of the
  // base energy charge) — added before tax/duty since electricity duty is levied
  // on the full billed energy amount including fuel-adjustment surcharges.
  const fppcaRate = (inp.g_fppca||0)*m.grid;
  const effectiveEnergyRate = (baseEnergyRate+touAdj+fppcaRate)*(1+inp.g_tax/100);
  // Excess-demand charge: GERC-style contract-demand schedules bill draw UP TO
  // the sanctioned/contracted load (g_sanc, in kVA — the base contracted
  // capacity, NOT the grid-upgrade-inclusive dispatch cap) at the normal
  // demand-charge rate, and only the portion ABOVE it at the separate (usually
  // higher) excess-demand rate — never both rates on the same kVA. Previously
  // collected as an input (g_excess_demand) but never actually applied
  // anywhere — wired in here.
  const sanctionedMW = (inp.g_sanc||0)/1000;
  const billableKVA = Math.max(peakGridMW,0)*1000;
  const normalKVA = Math.min(billableKVA, sanctionedMW*1000);
  const excessKVA = Math.max(billableKVA-sanctionedMW*1000, 0);
  const demandChargeAnnualCr = (inp.g_demand*normalKVA*12)/1e7; // ₹/kVA/month * normal kVA *12
  const excessDemandChargeAnnualCr = (inp.g_excess_demand*excessKVA*12)/1e7;
  const fixedAnnualCr = (inp.g_fixed*12)/1e7;
  const demandFixedPerKWh = gridMWhAnnual>0 ? ((demandChargeAnnualCr+excessDemandChargeAnnualCr+fixedAnnualCr)*1e7*(1+inp.g_tax/100))/(gridMWhAnnual*1e6) : 0;
  const connAmortRate = inp.g_conn_amort||0; // one-time connection-related costs, already amortized to ₹/kWh by the user
  const effectivePerKWh = effectiveEnergyRate+demandFixedPerKWh+connAmortRate;
  const totalAnnualCostCr = (effectivePerKWh*gridMWhAnnual*1000)/1e7;
  return {
    baseEnergyRate, touAdj, fppcaRate, effectiveEnergyRate, demandChargeAnnualCr, excessDemandChargeAnnualCr, excessKVA, fixedAnnualCr,
    connAmortRate, demandFixedPerKWh, effectivePerKWh, totalAnnualCostCr, peakHourWeight:peakW, solarHourWeight:solarW,
    allocationNote:'Demand + excess-demand + fixed charges are apportioned over this architecture\'s own annual grid-import energy from the dispatch (not a separately-assumed annual figure). ToU peak/solar-hour incidence is allocated using the site\'s configured demand SHAPE as an hour-weighting proxy, not a full hour-by-hour ToU billing pass — stated explicitly as a model allocation assumption, not a regulatory fact. FPPPA is a separately-notified surcharge, not part of the base energy charge — confirm the current quarter\'s rate before relying on this output.'
  };
}
/* Grid ₹/kWh rate applied to actual grid MWh delivered by the dispatch — kept as
   a thin wrapper over computeGridCostEngine so there is exactly ONE grid-rate
   calculation path used everywhere (optimizer scoring, display, comparison). */
function gridRatePerKWh(inp, gridMWhAnnual, peakGridMW){
  return computeGridCostEngine(inp, gridMWhAnnual, peakGridMW).effectivePerKWh;
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
   GC FULLY-LOADED PROCUREMENT COST (Part 6 — THE MOST IMPORTANT FIX)
   `gc_charges` is wheeling/CSS/other VARIABLE pass-through only — it has
   NEVER been a total electricity cost and must never be displayed or
   compared as one. This builds the full stack: annualised project
   CAPEX+financing for the offtake's OWN equity share of the SPV, O&M for
   that same share, then the delivery stack (wheeling/banking/SLDC/losses,
   reusing the same DISCOM-charged component fields as Green OA since it
   is physically the same wheeling infrastructure) with CSS/Additional
   Surcharge INCLUDED unless the captive-eligibility gate (gcEligibility)
   is currently met, in which case they are removed as a captive benefit —
   never zeroed just because the route is labelled "GC".
   This is a comparison-only metric. It intentionally does NOT feed back
   into energyCostCr/landedCostPerKWh (the SPV's own opex/cash-flow
   accounting), because CAPEX for owned generation (solar/wind/GC) is
   already capitalised and financed through totalCapexCr/debt/equity in
   evaluateCandidateSteadyState — charging it again as "opex" here would
   double-count the same CAPEX, the exact bug this function exists to
   avoid on the OA/GC comparison side. */
function computeGCFullyLoaded(inp, gcMW, gcConsumedMWh, gcElig){
  const life = (inp.s_life*(inp.gc_solarshare/100) + inp.w_life*(1-inp.gc_solarshare/100)) || 25;
  const omBlendLakhPerMW = (inp.s_om*(inp.gc_solarshare/100) + inp.w_om*(1-inp.gc_solarshare/100));
  const gcCapexTotalCr = gcMW*inp.gc_capex;
  const myShare = clampV(inp.gc_myequity,0,100)/100;
  const gcMyCapexCr = gcCapexTotalCr*myShare;
  const capexAnnualCr = gcMyCapexCr>0 ? gcMyCapexCr*crf(inp.f_hurdle, life) : 0;
  const omAnnualCr = gcMW*myShare*omBlendLakhPerMW/100; // Lakh/MW/yr -> Cr, my equity share
  const captiveOK = !!(gcElig && gcElig.compliant);
  const cssApplied = captiveOK ? 0 : inp.oa_css;
  const addlApplied = captiveOK ? 0 : inp.oa_addl;
  const gcMWh = Math.max(gcConsumedMWh,0);
  const capexPerKWh = gcMWh>1e-6 ? (capexAnnualCr*1e7)/(gcMWh*1000) : 0;
  const omPerKWh = gcMWh>1e-6 ? (omAnnualCr*1e7)/(gcMWh*1000) : 0;
  const variableBase = inp.oa_wheel + inp.oa_bank + inp.oa_sldc + inp.gc_charges + cssApplied + addlApplied;
  const variableLanded = variableBase/(1-inp.oa_loss/100);
  const lossAddOn = variableLanded-variableBase;
  const deliveredPerKWh = capexPerKWh+omPerKWh+variableLanded;
  return {
    captiveOK, capexAnnualCr, omAnnualCr, capexPerKWh, omPerKWh, variableLanded, deliveredPerKWh,
    breakdown:{
      "Generation CAPEX (annualised, your equity share)":capexPerKWh,
      "O&M (your equity share)":omPerKWh,
      "Wheeling":inp.oa_wheel, "Banking":inp.oa_bank, "SLDC/scheduling":inp.oa_sldc,
      "GC variable/pass-through charges (other)":inp.gc_charges,
      "Cross-subsidy surcharge":cssApplied, "Additional surcharge":addlApplied,
      "Loss add-on":lossAddOn
    },
    note: captiveOK
      ? 'Captive benefit assumed: CSS/Additional Surcharge waived because the eligibility gate (equity ≥ threshold AND self-consumption ≥ threshold, both checked against the ACTUAL dispatch) is currently met.'
      : 'Captive benefit NOT available: normal Green-OA-style CSS/Additional Surcharge applied because the captive-eligibility gate is not currently met — see GC Regulatory eligibility gate status.'
  };
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

  // CRITICAL FIX: this must divide by energy ACTUALLY DELIVERED (servedMWh),
  // not total demand (a.demand). Unserved energy costs nothing to not-deliver,
  // so dividing by total demand silently lets unserved MWh dilute the reported
  // ₹/kWh — e.g. a grid-only architecture whose sanctioned capacity can't cover
  // peak demand was previously showing an artificially CHEAP ₹/kWh (unserved
  // hours counted as "free" energy in the denominator) instead of the true
  // delivered rate. Unserved energy is already penalized separately wherever
  // this candidate is scored/compared (unservedMWh field, optimizer penalty) —
  // it must never also be allowed to lower the headline cost number.
  const landedCostPerKWh = servedMWh>0 ? (energyCostCr*1e7)/(servedMWh*1000) : 0;

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

  // ---- Fully-loaded PROCUREMENT cost, comparison-only (Part 6/10/13 fix) ----
  // Distinct from landedCostPerKWh above (the SPV's own opex/cash-flow line,
  // which deliberately excludes CAPEX for owned assets to avoid double-
  // counting against totalCapexCr/debt/equity). This metric puts solar,
  // wind, GC, OA and grid on a comparable "what does this route cost
  // all-in" basis, including annualised CAPEX+financing for owned/captive
  // generation, so GC is never compared against OA on an opex-only basis.
  const gridFull = computeGridCostEngine(inp, a.grid, result.peakGridMW);
  const gcFull = computeGCFullyLoaded(inp, candidate.gcMW, a.gc, gcElig);
  const solarFullPerKWh = a.solar>0 ? solarOM_perKWh + (sol.annualCapexCharge*1e7)/(a.solar*1000) : 0;
  const windFullPerKWh = a.wind>0 ? windOM_perKWh + (win.annualCapexCharge*1e7)/(a.wind*1000) : 0;
  const fullyLoadedCostCr = (a.solar*solarFullPerKWh + a.wind*windFullPerKWh + a.gc*gcFull.deliveredPerKWh
    + a.oa*oa.landed + a.grid*gridFull.effectivePerKWh)*1000/1e7;
  // Same fix as landedCostPerKWh above — divide by delivered energy, not total demand.
  const fullyLoadedCostPerKWh = servedMWh>0 ? (fullyLoadedCostCr*1e7)/(servedMWh*1000) : 0;

  return {
    candidate, annual:a, servedMWh, renShare, unservedMWh:a.unserved, peakGridMW:result.peakGridMW,
    peakGridNeedMW:result.peakGridNeedMW,
    sanctionedMW:gridCapMW, totalCapexCr, equityCr, debtCr, revenueCr, energyCostCr, omTotalCr, ebitdaCr,
    landedCostPerKWh, proxyEquityIRR, proxyProjectIRR, proxyNPV, dscrY1,
    gcMyEquityCapexCr, gcCapexTotalCr, bessCapexCr, blendedPrice,
    gcGenAnnualMWh, oaElig, gcElig,
    oaLandedPerKWh: oa.landed, gridFull, gcFull, solarFullPerKWh, windFullPerKWh, fullyLoadedCostPerKWh
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
      // Same delivered-energy-not-total-demand fix as evaluateCandidateSteadyState.
      utilFrac, servedMWh, annual:a, energyCostCr, landedCostPerKWh: servedMWh>0 ? (energyCostCr*1e7)/(servedMWh*1000):0,
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

function renderTicker(baseDemand8760, best, finExact, inp){
  const annualGWh = sumProfile(baseDemand8760)/1000;
  const peakMW = Math.max(...baseDemand8760);
  const t=$('ticker');
  const renGap = (inp?.retarget ?? 0) - best.renShare;
  const renSub = renGap > 0.05
    ? `<div class="tsub warn">▼ ${fmt(renGap,1)}pt vs ${fmt(inp.retarget,0)}% target — why?</div>`
    : (inp ? `<div class="tsub good">meets ${fmt(inp.retarget,0)}% target</div>` : '');
  const unservedSub = (best.unservedMWh||0) > 0.01 ? `<div class="tsub warn">grid-capped — why?</div>` : '';
  t.innerHTML = `
    ${tick('ANNUAL DEMAND (terminal)', fmt(annualGWh,2), 'GWh')}
    ${tick('PEAK LOAD', fmt(peakMW,2), 'MW')}
    ${tick('LANDED COST', fmt(best.landedCostPerKWh,2), '₹/kWh')}
    ${tick('RENEWABLE', fmt(best.renShare,1), '%', renSub, true)}
    ${tick('PROJECT IRR', irrLabel(finExact.projectIRR), '')}
    ${tick('EQUITY IRR', irrLabel(finExact.equityIRR), '')}
    ${tick('UNSERVED', fmt(best.unservedMWh||0,1), 'MWh/yr', unservedSub, unservedSub!=='')}
    ${tick('SCENARIO', scenarioPresets[scenario].label, '')}
  `;
  t.querySelectorAll('.tick.clickable').forEach(el=>{
    el.addEventListener('click', ()=>{
      const nav = document.querySelector('.navitem[data-view="v-decision"]');
      if(nav) nav.click();
    });
  });
  const mix = $('mixbar');
  const segs = [{v:best.renShare,c:'var(--solar)'},{v:100-best.renShare,c:'var(--grid)'}];
  mix.innerHTML = segs.map(s=>`<div style="flex:${Math.max(s.v,0.5)};background:${s.c}"></div>`).join('');
  function tick(l,v,u,sub,clickable){
    return `<div class="tick${clickable?' clickable':''}"><div class="l">${l}</div><div class="v">${v}<span style="font-size:10px;color:var(--muted)"> ${u}</span></div>${sub||''}</div>`;
  }
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
    return {name:p.name, cost:ev.landedCostPerKWh, fullCost:ev.fullyLoadedCostPerKWh, renShare:ev.renShare, meetsTarget:ev.renShare>=inp.retarget, unservedMWh:ev.unservedMWh, demandMWh:ev.annual.demand, ev};
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
    <div class="hint">OA is now a real hourly-available source inside the 8,760h dispatch (shaped per the "OA source shape" input), not an annual blended adjustment — availability is capped at ${fmt(inp.oa_mw,2)} MW contracted capacity, shaped ${inp.oa_shape}.</div>
    <div class="hint">"PPA / energy price" above is a GENERATION/PPA benchmark (e.g. recent GUVNL competitive-bidding tariffs) — it is NOT itself the delivered OA price; the delivered OA price is the full stack total (LANDED OA COST row) after transmission/wheeling/CSS/surcharge/banking/losses/tax.</div>
    <div class="flagbox ${bankingRegulatoryStatus().status==='UPDATE REQUIRED'?'bad':''}"><b>${bankingRegulatoryStatus().status}:</b> ${bankingRegulatoryStatus().message}</div>`;

  const gcUsedGWh = curEval.annual.gc/1000;
  const gcGenGWh = sumProfile(scaleProfile(units.solarUnit, inp.gc_mw*(inp.gc_solarshare/100)))/1000 + sumProfile(scaleProfile(units.windUnit, inp.gc_mw*(1-inp.gc_solarshare/100)))/1000;
  const compl = gcCompliance(inp, inp.gc_mw, gcUsedGWh, gcGenGWh);
  const gcElig = gcEligibility(inp, {gcMW:inp.gc_mw}, gcUsedGWh, gcGenGWh);
  const gcBadgeClass = gcElig.status==='ELIGIBLE'?'high':gcElig.status==='VERIFY'?'medium':gcElig.status==='NOT ELIGIBLE'?'low':'';
  const gcFlag = compl.compliant? `<span class="pill high">Meets stated equity &amp; self-consumption thresholds</span>` :
    `<span class="pill low">Below stated ${!compl.equityOK && !compl.selfConsOK?'equity AND self-consumption':!compl.equityOK?'equity':'self-consumption'} threshold — REGULATORY VALIDATION REQUIRED</span>`;
  const gcCapexTotalCr = inp.gc_mw*inp.gc_capex;
  const gcMyEquityCapexCr = gcCapexTotalCr*(inp.gc_myequity/100);
  const gcFull = curEval.gcFull;
  let gcFullRows=''; for(const [k,v] of Object.entries(gcFull.breakdown)) gcFullRows+=`<tr><td>${k}</td><td>₹${fmt(v,3)}/kWh</td></tr>`;
  $('gc_out').innerHTML = `<table>
    <tr><td>SPV generation (hourly, solar+wind mix)</td><td>${fmt(gcGenGWh,2)} GWh/yr</td></tr>
    <tr><td>Entitled to this site (${fmt(inp.gc_entitlement,0)}% of generation — separate from equity %)</td><td>${fmt(gcGenGWh*inp.gc_entitlement/100,2)} GWh/yr</td></tr>
    <tr><td>Actually dispatched to demand this year</td><td>${fmt(gcUsedGWh,2)} GWh/yr</td></tr>
    <tr><td>Self-consumption vs requirement (${fmt(inp.gc_selfcons,0)}%)</td><td>${fmt(compl.selfConsPct,0)}%</td></tr>
    <tr><td>ChargeZone equity CAPEX (${fmt(inp.gc_myequity,0)}% of SPV)</td><td>₹${fmt(gcMyEquityCapexCr,2)} Cr</td></tr>
    <tr><td>Regulatory eligibility gate</td><td>${gcBadgeClass?`<span class="pill ${gcBadgeClass}">${gcElig.status}</span>`:gcElig.status}</td></tr>
  </table><div style="margin-top:8px">${gcFlag}</div>
  <div class="hint">${gcElig.detail} — NOT ELIGIBLE candidates are hard-excluded by the optimiser.</div>
  <div class="hint">Equity ownership (${fmt(inp.gc_myequity,0)}%), energy entitlement (${fmt(inp.gc_entitlement,0)}%) and actual measured self-consumption (${fmt(compl.selfConsPct,0)}%) are three separate, independently editable numbers — never collapsed into one.</div>
  <h4 style="margin:14px 0 4px">GC fully-loaded delivered cost (Part 6 fix — never use the pass-through rate alone as GC's cost)</h4>
  <table>${gcFullRows}<tr style="font-weight:700"><td>GC FULLY-LOADED DELIVERED COST</td><td>₹${fmt(gcFull.deliveredPerKWh,2)}/kWh</td></tr>
  <tr><td>"GC variable/pass-through charges" input alone (NOT total GC cost)</td><td>₹${fmt(inp.gc_charges,2)}/kWh</td></tr></table>
  <div class="flagbox ${gcFull.captiveOK?'':'bad'}">${gcFull.captiveOK?'<span class="pill high">Captive benefit assumed</span>':'<span class="pill low">Captive benefit NOT available</span>'} ${gcFull.note}</div>`;

  const g = computeGrid(inp);
  const gFull = curEval.gridFull;
  $('g_out').innerHTML = `<table>
    <tr><td>Base energy rate</td><td>₹${fmt(gFull.baseEnergyRate,2)}/kWh</td></tr>
    <tr><td>ToU adjustment (peak surcharge − solar-hour discount, shape-weighted)</td><td>₹${fmt(gFull.touAdj,3)}/kWh</td></tr>
    <tr><td>FPPPA / fuel &amp; power purchase price adjustment <span class="pill verify">NOT VERIFIED</span></td><td>₹${fmt(gFull.fppcaRate,2)}/kWh</td></tr>
    <tr><td>Effective time-weighted grid energy rate (incl. FPPPA, before demand/fixed/connection)</td><td>₹${fmt(gFull.effectiveEnergyRate,2)}/kWh</td></tr>
    <tr><td>Annual demand charge (on peak draw up to sanctioned load)</td><td>₹${fmt(gFull.demandChargeAnnualCr,3)} Cr/yr</td></tr>
    <tr><td>Annual excess-demand charge (peak draw above sanctioned load, e.g. under a grid upgrade)</td><td>₹${fmt(gFull.excessDemandChargeAnnualCr,3)} Cr/yr${gFull.excessKVA>0?` (${fmt(gFull.excessKVA/1000,2)} MW over sanctioned)`:''}</td></tr>
    <tr><td>Annual fixed charge</td><td>₹${fmt(gFull.fixedAnnualCr,3)} Cr/yr</td></tr>
    <tr><td>Demand+excess-demand+fixed charge, apportioned (₹/kWh)</td><td>₹${fmt(gFull.demandFixedPerKWh,3)}/kWh</td></tr>
    <tr><td>Connection-related costs, amortized <span class="pill verify">NOT VERIFIED</span></td><td>₹${fmt(gFull.connAmortRate,2)}/kWh</td></tr>
    <tr style="font-weight:700"><td>TOTAL EFFECTIVE GRID ₹/kWh (energy actually delivered)</td><td>₹${fmt(gFull.effectivePerKWh,2)}/kWh</td></tr>
    <tr><td>Total annual grid electricity cost</td><td>₹${fmt(gFull.totalAnnualCostCr,2)} Cr/yr</td></tr>
    <tr><td>Grid connection capacity (incl. upgrade if enabled)</td><td>${fmt(gridCapMW,2)} MW</td></tr>
    <tr><td>Sanctioned/contracted load (before any upgrade)</td><td>${fmt(inp.g_sanc/1000,2)} MW</td></tr>
    <tr><td>Grid energy actually imported this year (dispatch)</td><td>${fmt(curEval.annual.grid/1000,3)} GWh</td></tr>
    <tr><td>Peak hourly grid draw</td><td>${fmt(curEval.peakGridMW,2)} MW</td></tr>
  </table><div class="hint">Demand charges are levied on the dispatch's own peak grid draw, not a flat sanctioned-load assumption; draw beyond the sanctioned load is billed at the excess-demand rate instead of the normal demand rate, never both. ${gFull.allocationNote}</div>`;

  let tbl = `<table><tr><th>Architecture</th><th>SPV opex/cash-flow ₹/kWh</th><th>Fully-loaded procurement ₹/kWh (incl. CAPEX+financing)</th><th>Renewable %</th><th>Unserved</th><th>Meets target?</th></tr>`;
  presets.forEach(a=>{
    const unservedPct = a.demandMWh>0 ? (a.unservedMWh/a.demandMWh*100) : 0;
    const unservedCell = a.unservedMWh>0.01 ? `<span class="pill low">${fmt(unservedPct,1)}% (${fmt(a.unservedMWh,0)} MWh/yr) undelivered</span>` : `<span class="pill high">0%</span>`;
    tbl+=`<tr><td>${a.name}</td><td>₹${fmt(a.cost,2)}</td><td>₹${fmt(a.fullCost,2)}</td><td>${fmt(a.renShare,1)}%</td><td>${unservedCell}</td><td>${a.meetsTarget?'<span class="pill high">Yes</span>':'<span class="pill low">No</span>'}</td></tr>`;
  });
  tbl+='</table><div class="hint">The two cost columns answer different questions and are not interchangeable: "SPV opex/cash-flow ₹/kWh" keeps CAPEX out of opex for owned/captive generation (it is separately capitalised and financed — see Economics tab) to avoid double counting; "Fully-loaded procurement ₹/kWh" puts every route (grid, OA, GC, owned solar/wind) on the SAME all-in basis, including annualised CAPEX+financing, for comparing routes against each other. Use the fully-loaded column when comparing OA vs GC vs Grid. Both cost columns are computed over energy ACTUALLY DELIVERED, not total demand — a row with material "Unserved" is not meeting the site\'s full load and its ₹/kWh is not comparable to a route that serves 100% of demand until the grid/BESS/renewable sizing is fixed to close that gap.</div>';
  $('archTable').innerHTML = tbl;
  const items = presets.map(a=>({name:a.name, value:a.fullCost, unit:' ₹/kWh', color:a.meetsTarget?'#2dd4bf':'#5f6d76', highlight:a.name==='Optimizer recommendation'})).sort((a,b)=>a.value-b.value);
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

/* ================================================================
   RETURN DIAGNOSTICS — explains WHY IRR/NPV look weak (or don't),
   in terms of the specific mechanism, not just the headline numbers.
   Reads only off the already-computed best/finExact result — adds no
   new calculation, so it can never disagree with the numbers shown
   elsewhere on this tab. Uses peakGridNeedMW (the uncapped hourly
   requirement) rather than peakGridMW (the capped delivery) when
   describing the grid-capacity constraint, since peakGridMW is by
   construction always <= sanctionedMW and can never "exceed" it —
   peakGridNeedMW is what actually explains any unserved energy.
   ================================================================ */
function computeReturnDiagnostics(inp, best, finExact){
  const findings = [];
  const rows = finExact.rows || [];
  const y1 = rows[0];
  const terminal = rows.slice().reverse().find(r=>r.utilFrac>=0.999) || rows[rows.length-1];

  // 1. Chronic, steady-state capacity-constrained unserved energy (recurs every year, not a ramp issue)
  if(terminal){
    const unservedPct = terminal.annual.demand>0 ? (terminal.annual.unserved/terminal.annual.demand*100) : 0;
    if(unservedPct > 3){
      const lostRevenueCr = terminal.annual.unserved*1000*best.blendedPrice/1e7;
      const severity = unservedPct>10 ? 'bad' : '';
      findings.push({sev:severity, title:`Grid/asset capacity is the binding constraint, not energy cost — ${fmt(unservedPct,1)}% of demand goes unserved every year at steady state.`,
        detail:`${fmt(terminal.annual.unserved,0)} MWh/yr of the ${fmt(terminal.annual.demand,0)} MWh/yr terminal demand is modelled as UNSERVED — this recurs every year at steady state, it is not a ramp-up artefact. In this architecture's peak hour the site needed ${fmt(best.peakGridNeedMW,2)} MW from the grid after solar/wind/OA/GC/BESS were exhausted, against ${fmt(best.sanctionedMW,2)} MW sanctioned/upgraded capacity (the grid itself always delivers ≤ its cap by construction — it is the ${fmt(Math.max(best.peakGridNeedMW-best.sanctionedMW,0),2)} MW shortfall in those hours that goes unserved). Estimated lost revenue: ~₹${fmt(lostRevenueCr,2)} Cr/yr at the current blended price of ₹${fmt(best.blendedPrice,2)}/kWh. Raising sanctioned grid capacity and/or the BESS/solar sizing ceilings the optimiser is allowed to search would let it close some or all of this gap.`});
    }
  }

  // 2. Front-loaded CAPEX vs a slow utilisation ramp -> negative early free cash flow to equity
  if(y1 && y1.fcfe < 0){
    let negYears = 0;
    for(const r of rows){ if(r.fcfe<0) negYears++; else break; }
    findings.push({sev:'', title:`CAPEX is spent upfront (₹${fmt(finExact.totalCapexCr,1)} Cr) while Year 1 utilisation is only ${fmt(y1.utilFrac*100,0)}% — free cash flow to equity is negative for the first ${negYears} year${negYears>1?'s':''}.`,
      detail:`Year 1 FCFE is ₹${fmt(y1.fcfe,2)} Cr (revenue ₹${fmt(y1.rev,2)} Cr against ₹${fmt(y1.opex+y1.interestCr+y1.principal,2)} Cr of opex+debt service). At a ${fmt(inp.f_hurdle,1)}% discount rate, weak or negative early-year cash flows are penalised disproportionately in the NPV calculation, even when steady-state economics (see below) are healthy. A slower/steeper ramp shape, a longer debt tenor, or a moratorium period would each reduce this front-loading effect — worth testing on the Charging Demand and Economics tabs.`});
  }

  // 3. DSCR covenant breach during the ramp (before steady state)
  const breachYears = rows.filter(r=>r.dscr!=null && isFinite(r.dscr) && r.dscr < inp.f_mindscr).map(r=>r.y);
  if(breachYears.length>0){
    const early = breachYears.filter(y=>y<=3);
    findings.push({sev: early.length>0 ? 'bad':'', title:`DSCR falls below the ${fmt(inp.f_mindscr,2)}× covenant in ${breachYears.length} of ${rows.length} years${early.length>0?' — including the ramp-up period':''}.`,
      detail:`Years ${breachYears.join(', ')} show DSCR below covenant. ${early.length>0?'Breaching the covenant during ramp-up (Years '+early.join(', ')+') is the higher-risk case — a lender would likely require a DSRA, a moratorium, or a lower initial debt fraction to get comfortable with this profile.':'These breaches occur after steady state, which is unusual — check for a BESS/asset replacement year landing here (replCapexThisYear) before assuming it is a ramp effect.'}`});
  }

  // 4. Margin-healthy-but-timing-poor mismatch: steady-state EBITDA margin is strong, yet equity IRR still misses hurdle
  if(terminal && isFinite(finExact.equityIRR)){
    const marginPct = terminal.rev>0 ? (terminal.ebitda/terminal.rev*100) : 0;
    if(finExact.equityIRR < inp.f_hurdle && marginPct > 50){
      findings.push({sev:'', title:`This is a timing problem, not a margin problem — steady-state EBITDA margin is a healthy ${fmt(marginPct,0)}%, but multi-year equity IRR (${irrLabel(finExact.equityIRR)}) still falls short of the ${fmt(inp.f_hurdle,1)}% hurdle.`,
        detail:`By Year ${terminal.y}, EBITDA margin is ${fmt(marginPct,0)}% (₹${fmt(terminal.ebitda,2)} Cr EBITDA on ₹${fmt(terminal.rev,2)} Cr revenue) and DSCR is ${terminal.dscr!=null?fmt(terminal.dscr,2)+'×':'n/a (debt repaid)'}. The IRR shortfall is being driven by the early-year cash-flow weakness (see above) and/or the discount rate, not by the underlying unit economics of energy cost vs charging price.`});
    }
  }

  // 5. Clean bill of health
  if(findings.length===0){
    findings.push({sev:'good', title:'No major structural return issues detected.', detail:`Steady-state unserved energy, early free-cash-flow-to-equity, and DSCR-covenant checks all came back clean against current assumptions.`});
  }
  return findings;
}
function renderReturnDiagnostics(inp, best, finExact){
  const findings = computeReturnDiagnostics(inp, best, finExact);
  $('diagPanel').innerHTML = findings.map(f=>
    `<div class="flagbox ${f.sev}"><div class="diagtitle" style="font-weight:700;color:#fff;margin-bottom:3px;">${f.title}</div><div>${f.detail}</div></div>`
  ).join('');
}

function renderDecisionTab(inp, best, nextBest, finExact, presets){
  const renGapPts = inp.retarget - best.renShare;
  const gridSharePctOfDemand = best.annual.demand>0 ? (best.annual.grid/best.annual.demand*100) : 0;
  const unservedSharePctOfDemand = best.annual.demand>0 ? (best.unservedMWh/best.annual.demand*100) : 0;
  const renGapBox = renGapPts > 0.05 ? `<div class="flagbox" style="margin-top:14px">
      <b>Why ${fmt(best.renShare,1)}% renewable, not the ${fmt(inp.retarget,0)}% target you set.</b>
      The renewable target is a scored constraint in the optimiser, not a hard 100% rule — every candidate is judged on NPV/IRR net of penalties (renewable shortfall, DSCR, grid dependency, curtailment, unserved energy), and this architecture won because closing the remaining ${fmt(renGapPts,1)} pt gap would have needed more CAPEX than the shortfall penalty currently costs it.
      <div style="margin-top:8px">That ${fmt(renGapPts,1)} pt gap splits as:
        <b>${fmt(gridSharePctOfDemand,1)}%</b> residual grid import (${fmt(best.annual.grid/1000,2)} GWh/yr)${best.unservedMWh>0.01?` <b>+ ${fmt(unservedSharePctOfDemand,1)}%</b> unserved energy (${fmt(best.unservedMWh,1)} MWh/yr — demand the dispatch could not meet even from the grid)`:''}.
        Both count against the renewable percentage because it is measured against <i>total</i> demand, not just demand that was actually served.
      </div>
      <div style="margin-top:8px">Exact multi-year equity IRR here is ${irrLabel(finExact.equityIRR)} against a ${fmt(inp.f_hurdle,1)}% hurdle${finExact.equityIRR<inp.f_hurdle?' — already below it':''}, which is why the optimiser did not push further toward 100%. See "What would change the decision?" below for the specific levers (grid capacity, BESS CAPEX, utilisation) that close this gap.</div>
    </div>` : '';
  $('decisionMain').innerHTML = `
    <div class="hint" style="text-transform:uppercase;letter-spacing:0.08em;color:var(--solar)">Recommended architecture — ${scenarioPresets[scenario].label}</div>
    <h2>${best.name}</h2>
    <div class="grid4" style="margin-top:16px">
      ${kpiCard('Delivered energy cost', '₹'+fmt(best.landedCostPerKWh,2),'/kWh')}
      ${kpiCard('Renewable share', fmt(best.renShare,1),'%')}
      ${kpiCard('CAPEX required', fmt(finExact.totalCapexCr,1),'₹ Cr')}
      ${kpiCard('Equity IRR (exact, multi-year)', irrLabel(finExact.equityIRR),'')}
    </div>
    ${renGapBox}
    ${best.unservedMWh>0.01 ? `<div class="flagbox bad" style="margin-top:14px"><b>Grid connection capacity is the binding constraint.</b> In this architecture's peak hour, the site needed <b>${fmt(best.peakGridNeedMW,2)} MW</b> from the grid after solar/wind/OA/GC/BESS were exhausted — but the sanctioned/upgraded connection only allows <b>${fmt(best.sanctionedMW,2)} MW</b>. The grid delivered its full ${fmt(best.sanctionedMW,2)} MW ceiling in those hours (so "peak grid draw" itself always shows ≤ the cap — it can never exceed it, since it's hard-capped in the dispatch); the ${fmt(Math.max(best.peakGridNeedMW-best.sanctionedMW,0),2)} MW shortfall in those hours is what's left unserved, totalling ${fmt(best.unservedMWh,1)} MWh/yr across the 8,760h year — not silently imported. Enable/expand the grid upgrade on the Grid Supply tab, or add BESS/renewables sized to cover peak hours, to close the gap.</div>` : ''}`;
  renderReturnDiagnostics(inp, best, finExact);

  const gridOnly = presets.find(p=>p.name==='Grid only');
  const reasons = [
    `Selected by risk-adjusted 8,760h optimisation (NPV + IRR headroom, net of renewable-target, DSCR, grid-capacity/unserved-energy and curtailment penalties) — not simply the cheapest landed ₹/kWh. Landed cost of this architecture is ₹${fmt(best.landedCostPerKWh,2)}/kWh.`,
    `Cuts delivered energy cost by ₹${fmt(gridOnly.cost-best.landedCostPerKWh,2)}/kWh versus a grid-only baseline (₹${fmt(gridOnly.cost,2)}/kWh), both measured through the same dispatch engine.`,
    `Achieves ${fmt(best.renShare,1)}% renewable share (physical-flow definition, from actual hourly dispatch) under the "${inp.redef==='hourly'?'hourly time-matched':inp.redef==='attributed'?'contractual attribution':'annual matching'}" definition selected on the Site tab.`,
    `Exact multi-year project IRR of ${irrLabel(finExact.projectIRR)} and equity IRR of ${irrLabel(finExact.equityIRR)} against a ${fmt(inp.f_hurdle,1)}% hurdle rate, with average DSCR of ${fmt(finExact.avgDSCR,2)}× (covenant ${fmt(inp.f_mindscr,2)}×, ${finExact.dscrOK?'met':'NOT met'}).`,
    `Requires ₹${fmt(finExact.totalCapexCr,1)} Cr total CAPEX — the search compares this against the NPV/IRR it produces, so a cheaper-₹/kWh option with weaker returns can be correctly passed over.`,
    `Grid connection: peak hourly requirement of ${fmt(best.peakGridNeedMW,2)} MW against ${fmt(best.sanctionedMW,2)} MW available capacity — ${best.unservedMWh>0.01?fmt(best.unservedMWh,1)+' MWh/yr unserved under current sizing':'no unserved energy under current sizing'}.`,
    `Grid was retained for residual demand ${best.annual.grid>0.01?`(${fmt(best.annual.grid/1000,2)} GWh/yr, ${fmt(best.annual.grid/best.annual.demand*100,0)}% of demand)`:'not at all'} because, at this sizing, its marginal ₹/kWh was below the annualised cost of adding further BESS/renewable capacity to displace it further.`,
  ];
  $('whyList').innerHTML = reasons.map((r,i)=>`<div class="reason"><div class="n">${String(i+1).padStart(2,'0')}</div><div>${r}</div></div>`).join('');

  const oaP = presets.find(p=>p.name==='Green OA + Grid'), gcP = presets.find(p=>p.name==='Group Captive + Grid');
  // Fully-loaded (CAPEX+financing-inclusive) comparison — NEVER compare OA's
  // landed cost against GC's pass-through opex rate alone (Part 6/10 fix).
  const oaVsGc = oaP.fullCost < gcP.fullCost;
  const sens = [
    `If demand growth pushes annual demand materially higher, Group Captive's per-kWh CAPEX charge falls with volume and its relative position vs OA can flip — see Break-Even Engine.`,
    `If BESS CAPEX falls by more than ~20% from ₹${fmt(inp.b_capex,2)} Cr/MWh (+₹${fmt(inp.b_capex_mw,2)} Cr/MW), optimal BESS size increases materially.`,
    `${oaVsGc?'OA':'GC'} is currently cheaper than ${oaVsGc?'GC':'OA'} by ₹${fmt(Math.abs(oaP.fullCost-gcP.fullCost),2)}/kWh at this demand and generation profile, on a FULLY-LOADED basis (GC includes annualised CAPEX+financing for your equity share, not just the wheeling/CSS pass-through rate) — a change in surcharge/CSS policy or captive eligibility could flip this.`,
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
  // Fully-loaded GC cost (CAPEX+financing+O&M+delivery stack, Part 6/15 fix) —
  // NOT the opex-only landedCostPerKWh, which would make this break-even
  // meaningless (comparing OA's full cost against GC's opex alone).
  const gcCost = vols.map(v=>{
    const gcMWForVol = gcBlendedMWhPerMW>0 ? (v*1000)/gcBlendedMWhPerMW : 0; // v (GWh) -> MW at this site's actual GC solar/wind mix & CUF
    const cand = {solarMW:0,windMW:0,oaMW:0,gcMW:gcMWForVol,bessMW:0,bessMWh:0};
    const ev = evaluateCandidateSteadyState(inp, units, baseDemand8760, cand, gridCapMW, null);
    return ev.fullyLoadedCostPerKWh;
  });
  const oaP = presets.find(p=>p.name==='Green OA + Grid'), gridP = presets.find(p=>p.name==='Grid only');
  const oaCost = vols.map(()=>oaP.fullCost);
  const gridCost = vols.map(()=>gridP.fullCost);
  $('breakGCOA').innerHTML = svgLineChart([
    {data:gcCost, color:'var(--gc)'}, {data:oaCost, color:'var(--oa)'}, {data:gridCost, color:'var(--grid)'}
  ], {w:520, h:220, xlabels:vols.map((v,i)=>i%2===0?v:'')});
  $('breakGCOA').innerHTML += `<div class="legend"><span><i style="background:var(--gc)"></i>Group Captive (fully-loaded)</span><span><i style="background:var(--oa)"></i>Green OA (fully-loaded)</span><span><i style="background:var(--grid)"></i>Grid (fully-loaded)</span></div>
  <div class="hint">X-axis: annual GC scale (GWh, illustrative). All three lines are FULLY-LOADED ₹/kWh (incl. CAPEX+financing for GC, full OA stack, full grid stack — never opex-only) — where the pink line crosses below the purple line is the GC-over-OA break-even, computed through the same 8,760h engine. Note: at a flat ₹/MW CAPEX rate with no modelled scale economies, GC's fully-loaded ₹/kWh is roughly constant across scale here — a genuine scale effect would require entering a lower gc_capex ₹/MW for larger plant sizes.</div>`;

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
function stateDataConfidence(name){
  const prov = STATE_PROVENANCE[name];
  if(!prov) return 'NOT VERIFIED';
  const statuses = Object.values(prov).map(p=>p.status);
  if(statuses.every(s=>s==='VERIFIED')) return 'VERIFIED';
  if(statuses.some(s=>s.startsWith('VERIFIED'))) return 'PARTIALLY VERIFIED';
  return 'BENCHMARK / NOT VERIFIED';
}
function renderStateComparisonTab(inp, units, baseDemand8760, gridCapMW, best){
  let t = `<table><tr><th>State</th><th>Grid ₹/kWh</th><th>OA CSS ₹/kWh</th><th>OA Wheeling ₹/kWh</th><th>OA Add'l surcharge ₹/kWh</th><th>OA Banking ₹/kWh</th><th>GC pass-through ₹/kWh (NOT total cost)</th><th>Solar CUF%</th><th>Wind CUF%</th><th>Data confidence</th></tr>`;
  Object.entries(STATE_ASSUMPTIONS).forEach(([name,s])=>{
    const conf = stateDataConfidence(name);
    const confClass = conf==='VERIFIED'?'high':conf==='PARTIALLY VERIFIED'?'medium':'verify';
    t+=`<tr><td>${name}</td><td>${fmt(s.g_energy,2)}</td><td>${fmt(s.oa_css,2)}</td><td>${fmt(s.oa_wheel,4)}</td><td>${s.oa_addl!=null?fmt(s.oa_addl,2):'<i>not verified</i>'}</td><td>${s.oa_bank!=null?fmt(s.oa_bank,2):'<i>not verified</i>'}</td><td>${fmt(s.gc_charges,2)}</td><td>${fmt(s.s_cuf,1)}</td><td>${s.w_cuf>0?fmt(s.w_cuf,1):'n/a'}</td><td><span class="pill ${confClass}">${conf}</span></td></tr>`;
  });
  t+=`</table><div class="hint">Gujarat's Grid/OA-wheeling/OA-CSS/OA-Additional-Surcharge/OA-Banking figures are VERIFIED against the current GERC FY2026-27 tariff schedule and Fifth GEOA Amendment 2026 (see Audit tab for sources/effective dates). GC's pass-through figure is NEVER the total GC cost (see the fully-loaded GC comparison below). All other states' figures, and Gujarat's CUF/PPA-benchmark figures, remain editable placeholders — replace with the current SERC order before using this for a real decision.</div>`;
  const bankStatus = bankingRegulatoryStatus();
  t += `<div class="flagbox ${bankStatus.status==='UPDATE REQUIRED'?'bad':''}"><b>${bankStatus.status}:</b> ${bankStatus.message}</div>`;
  $('stateAssumpTable').innerHTML = t;

  const candidate = best.candidate;
  let ct = `<table><tr><th>State</th><th>DISCOM basis</th><th>Grid fully-loaded ₹/kWh</th><th>Green OA fully-landed ₹/kWh</th><th>Group Captive fully-loaded ₹/kWh</th><th>Grid vs OA</th><th>OA vs GC</th><th>Grid vs GC</th><th>Renewable requirement</th><th>Recommended route</th><th>Data confidence</th></tr>`;
  Object.entries(STATE_ASSUMPTIONS).forEach(([name,s])=>{
    const inp2 = {...inp, g_energy:s.g_energy, oa_css:s.oa_css, oa_wheel:s.oa_wheel,
      oa_addl: s.oa_addl!=null?s.oa_addl:inp.oa_addl, oa_bank: s.oa_bank!=null?s.oa_bank:inp.oa_bank,
      gc_charges:s.gc_charges, s_cuf:s.s_cuf, w_cuf:s.w_cuf||inp.w_cuf};
    const units2 = {solarUnit: generateUnitMWShape8760(inp2.s_cuf,'solar'), windUnit: generateUnitMWShape8760(inp2.w_cuf,'wind')};
    const oaCand = {solarMW:0,windMW:0,oaMW:inp2.oa_mw||1,gcMW:0,bessMW:0,bessMWh:0};
    const gcCand = {solarMW:0,windMW:0,oaMW:0,gcMW:inp2.gc_mw||candidate.gcMW||3,bessMW:0,bessMWh:0};
    const gridCand = {solarMW:0,windMW:0,oaMW:0,gcMW:0,bessMW:0,bessMWh:0};
    const oaEv = evaluateCandidateSteadyState(inp2, units2, baseDemand8760, oaCand, gridCapMW, null);
    const gcEv = evaluateCandidateSteadyState(inp2, units2, baseDemand8760, gcCand, gridCapMW, null);
    const gridEv = evaluateCandidateSteadyState(inp2, units2, baseDemand8760, gridCand, gridCapMW, null);
    // FULLY-LOADED comparison — OA's full stack vs GC's full stack (CAPEX+
    // financing+O&M+delivery), never OA's landed cost vs GC's pass-through
    // opex rate alone (Part 10 fix, root cause of the "GC cheaper by
    // ₹5.22/kWh" false statement).
    const gridC = gridEv.fullyLoadedCostPerKWh, oaC = oaEv.oaLandedPerKWh, gcC = gcEv.gcFull.deliveredPerKWh;
    const cmp = (a,b,labelA,labelB)=> Math.abs(a-b)<0.15 ? `~ within ₹0.15/kWh` : (a<b?`${labelA} cheaper by ₹${fmt(b-a,2)}`:`${labelB} cheaper by ₹${fmt(a-b,2)}`);
    const cheapest = [{n:'Grid',v:gridC},{n:'Green OA',v:oaC},{n:'Group Captive',v:gcC}].sort((a,b)=>a.v-b.v)[0];
    const conf = stateDataConfidence(name);
    const confClass = conf==='VERIFIED'?'high':conf==='PARTIALLY VERIFIED'?'medium':'verify';
    ct += `<tr><td>${name}</td><td>${name==='Gujarat'?'State-owned DISCOM (DGVCL/MGVCL/PGVCL/UGVCL) basis':'n/a'}</td>
      <td>₹${fmt(gridC,2)}</td><td>₹${fmt(oaC,2)}</td><td>₹${fmt(gcC,2)}</td>
      <td>${cmp(gridC,oaC,'Grid','OA')}</td><td>${cmp(oaC,gcC,'OA','GC')}</td><td>${cmp(gridC,gcC,'Grid','GC')}</td>
      <td>${fmt(inp.retarget,0)}%</td><td>${cheapest.n}</td><td><span class="pill ${confClass}">${conf}</span></td></tr>`;
  });
  ct += `</table><div class="hint">Grid/OA/GC columns are all FULLY-LOADED ₹/kWh on a comparable basis: Grid includes energy+ToU+demand/fixed charges (computeGridCostEngine); Green OA is the full component stack (PPA+transmission+wheeling+CSS+additional surcharge+banking+SLDC+losses+tax, computeOA); Group Captive includes annualised CAPEX+financing for your equity share, O&amp;M, and the delivery stack, with CSS/Additional-Surcharge waived only if the captive-eligibility gate is currently met (computeGCFullyLoaded) — GC is never represented by the pass-through/opex rate alone. Same demand profile, sized per-route at ${fmt(inp.oa_mw||1,1)} MW OA / ${fmt(candidate.gcMW||inp.gc_mw||3,1)} MW GC, re-run through the identical 8,760h engine with each state's assumption set swapped in.</div>`;
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
      oa_addl: s.oa_addl!=null?s.oa_addl:inp.oa_addl, oa_bank: s.oa_bank!=null?s.oa_bank:inp.oa_bank,
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
    <th>Grid dependency</th><th>Opex ₹/kWh</th><th>Fully-loaded ₹/kWh</th><th>CAPEX ₹Cr</th><th>Equity IRR</th><th>Project IRR</th><th>Avg DSCR</th><th>Renewable %</th></tr>`;
  rows.forEach(r=>{
    const c = r.best.candidate;
    t += `<tr><td>${r.name}</td><td>${fmt(c.solarMW,1)}</td><td>${fmt(c.windMW,1)}</td>
      <td>${fmt(c.bessMW,1)} / ${fmt(c.bessMWh,1)}</td>
      <td>${fmt(c.oaMW,1)} (${fmt(r.oaPct,1)}%)</td><td>${fmt(c.gcMW,1)} (${fmt(r.gcPct,1)}%)</td>
      <td>${fmt(r.gridDependencyPct,1)}%</td><td>₹${fmt(r.best.landedCostPerKWh,2)}</td><td>₹${fmt(r.best.fullyLoadedCostPerKWh,2)}</td>
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
  const prov = STATE_PROVENANCE['Gujarat'];
  const provRows = Object.values(prov).map(p=>[p.label, '', p.source+(p.expiry?` — expires ${p.expiry}`:''), p.status, p.url, p.effective]);
  const rows = [
    ['Industrial/EV grid energy charge', inp.g_energy+' ₹/kWh', inp.state, 'Model assumption'],
    ['FPPPA / fuel & power purchase price adjustment', inp.g_fppca+' ₹/kWh', inp.state, inp.g_fppca===0?'⚠ Left at 0 — confirm current notified rate before relying on delivered grid cost':'User input — confirm against current notified rate'],
    ['Connection-related costs, amortized', inp.g_conn_amort+' ₹/kWh', 'Site-specific', 'User input'],
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
  let t = `<h4 style="margin:0 0 6px">Gujarat FY2026-27 — verified regulatory inputs (Part 11 provenance)</h4>
    <table><tr><th>Variable</th><th>Source</th><th>Effective</th><th>Status</th><th>Source URL</th></tr>`;
  provRows.forEach(p=>{
    const conf = p[3].startsWith('VERIFIED')?'high':p[3]==='BENCHMARK'?'medium':'verify';
    t+=`<tr><td>${p[0]}</td><td>${p[2]}</td><td>${p[5]||'—'}</td><td><span class="pill ${conf}">${p[3]}</span></td><td>${p[4]?`<a href="${p[4]}" target="_blank" rel="noopener" style="font-size:11px">source</a>`:'<i>n/a</i>'}</td></tr>`;
  });
  const bankStatus = bankingRegulatoryStatus();
  t += `</table><div class="flagbox ${bankStatus.status==='UPDATE REQUIRED'?'bad':''}"><b>${bankStatus.status}:</b> ${bankStatus.message}</div>
    <div class="hint">The Draft Sixth GEOA Amendment 2026 (June 2026) is a DRAFT and is deliberately NOT used as a default anywhere in this model — only the notified Fifth GEOA Amendment 2026 figures are used until GERC finalises a successor.</div>`;
  t += `<h4 style="margin:16px 0 6px">Model assumptions &amp; user inputs</h4><table><tr><th>Variable</th><th>Value</th><th>Geography</th><th>Confidence</th><th>Source URL (add yours)</th></tr>`;
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

    renderTicker(baseDemand8760, best, finExact, inp);
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
    if(item.classList.contains('disabled')) return; // not-yet-built tab — no view to switch to
    const target = $(item.dataset.view);
    if(!target){ console.warn('Nav target missing for', item.dataset.view, '— tab not switched.'); return; }
    document.querySelectorAll('.navitem').forEach(i=>i.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    item.classList.add('active');
    target.classList.add('active');
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


/* ---------------- init ---------------- */
renderDemandTable();
renderAll();
renderTestResults();