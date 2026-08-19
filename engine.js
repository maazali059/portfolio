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
    // so any unserved energy can be explained honestly (peakGridMW itself is
    // always <= gridCapMW by construction and can never "exceed" it).
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

module.exports = {
  clamp, generate8760Timeline, TIMELINE_8760, HOURS_PER_YEAR, operatingDayMask, shapeArray,
  generateDemand8760Profile, generateUnitMWShape8760, scaleProfile, addProfiles, constProfile,
  generateOA8760Profile, generateGC8760Profiles, runDispatch8760, SOLAR_SEASONAL_N, WIND_SEASONAL_N
};
