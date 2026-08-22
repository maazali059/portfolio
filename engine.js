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

/* ---------------- HOURLY TARIFF BUILDER ----------------
   Converts a Flat or Time-of-Day tariff definition into an 8760-length
   ₹/kWh array so dispatch can use the ACTUAL applicable price for each
   hour, never an annual average. ToD pattern repeats identically every
   day (slots are hour-of-day, not date-specific) — this matches how
   DISCOM/OA/GC ToD tariffs are actually published.
   slots: [{start:0, end:6, rate:3.2}, ...] — start/end are hour-of-day
   integers 0-24, non-wrapping (a 22:00-02:00 slot must be entered as
   two slots: 22-24 and 0-2). Later slots overwrite earlier ones on
   overlap (last-write-wins), so the caller controls precedence. Hours
   not covered by any slot fall back to flatValue. */
function buildHourlyTariff(mode, flatValue, slots){
  const hourRate = new Array(24).fill(flatValue);
  if(mode==='tod' && Array.isArray(slots)){
    for(const slot of slots){
      const start = clamp(Math.round(slot.start),0,24);
      const end = clamp(Math.round(slot.end),0,24);
      for(let h=start; h<end; h++){ if(h>=0&&h<24) hourRate[h]=slot.rate; }
    }
  }
  const out = new Float64Array(HOURS_PER_YEAR);
  for(let h=0; h<HOURS_PER_YEAR; h++) out[h]=hourRate[TIMELINE_8760[h].hour];
  return out;
}

/* ---------------- BESS SCHEDULE (strategy -> which hours-of-day are
   used for economic Grid/OA/GC charging, and which hours discharge is
   restricted to) ----------------
   Computed ONCE per dispatch call (not per-hour) from the 24-hour ToD
   pattern, since tariffs are daily-periodic by construction above.
   This is a deterministic, explainable heuristic (cheapest N hours /
   priciest N hours, N sized off MWh/MW), consistent with the coarse
   grid-search style already used by the optimiser elsewhere in this
   model — NOT a full forward-looking stochastic optimisation. */
function computeBessSchedule(bessMW, bessMWh, tariffs, strategy, sources, customWindows, rte){
  if(strategy==='custom' && customWindows){
    return {
      chargeHours: new Set(customWindows.chargeHours||[]),
      dischargeRestrict: (customWindows.dischargeHours && customWindows.dischargeHours.length) ? new Set(customWindows.dischargeHours) : null
    };
  }
  if(!strategy || strategy==='renewable'){
    return {chargeHours:new Set(), dischargeRestrict:null}; // no Grid/OA/GC->BESS charging
  }
  // Two distinct price signals: which hours are cheap enough to CHARGE from
  // (gated by which sources are permitted to charge the battery) vs which
  // hours are expensive enough to justify DISCHARGING to avoid import (this
  // just needs to know the price of whatever would otherwise serve the load,
  // independent of whether that pathway is an allowed charge source).
  const priceAtCharge = h=>{
    let best = Infinity;
    if(sources && sources.grid && tariffs.grid) best = Math.min(best, tariffs.grid[h]);
    if(sources && sources.oa && tariffs.oa) best = Math.min(best, tariffs.oa[h]);
    if(sources && sources.gc && tariffs.gc) best = Math.min(best, tariffs.gc[h]);
    return best;
  };
  const priceAtDischarge = h=> tariffs.grid ? tariffs.grid[h] : Infinity; // grid is the last-resort source peak-shaving avoids; OA/GC are served ahead of BESS regardless of price
  const chargeHoursArr = Array.from({length:24},(_,h)=>({h, price:priceAtCharge(h)})).filter(x=>isFinite(x.price));
  const dischargeHoursArr = Array.from({length:24},(_,h)=>({h, price:priceAtDischarge(h)})).filter(x=>isFinite(x.price));
  if(chargeHoursArr.length===0 && dischargeHoursArr.length===0) return {chargeHours:new Set(), dischargeRestrict:null};
  const ascending = [...chargeHoursArr].sort((a,b)=>a.price-b.price);
  const descending = [...dischargeHoursArr].sort((a,b)=>b.price-a.price);
  const hoursToFill = bessMW>0 ? clamp(Math.ceil(bessMWh/bessMW),1,12) : 0;
  const cheapest = ascending.slice(0,hoursToFill);
  const priciest = descending.slice(0,hoursToFill);
  const avgCheap = cheapest.length ? cheapest.reduce((s,x)=>s+x.price,0)/cheapest.length : Infinity;
  const avgExpensive = priciest.length ? priciest.reduce((s,x)=>s+x.price,0)/priciest.length : 0;
  const effRte = rte>0 ? rte : 1;
  // worth charging only if the avoided peak cost clears round-trip losses
  // with a small margin — otherwise arbitrage would lose money after RTE.
  const worthwhile = cheapest.length>0 && avgExpensive > (avgCheap/effRte)*1.02;

  if(strategy==='mincost'){
    return {chargeHours: worthwhile ? new Set(cheapest.map(x=>x.h)) : new Set(), dischargeRestrict:null};
  }
  if(strategy==='peak'){
    return {chargeHours:new Set(), dischargeRestrict: priciest.length ? new Set(priciest.map(x=>x.h)) : null};
  }
  if(strategy==='arbitrage'){
    return {chargeHours: worthwhile ? new Set(cheapest.map(x=>x.h)) : new Set(), dischargeRestrict: priciest.length ? new Set(priciest.map(x=>x.h)) : null};
  }
  return {chargeHours:new Set(), dischargeRestrict:null};
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

  // Economic BESS scheduling (Grid/OA/GC charging + discharge windows).
  // Fully backward-compatible: if the caller doesn't pass bessChargeSources
  // (existing callers never do), schedule.chargeHours is empty and
  // dischargeRestrict is null, so behaviour is IDENTICAL to before.
  const rte = (params.chargeEff||1)*(params.dischargeEff||1);
  const schedule = computeBessSchedule(
    params.bessMW, params.bessMWh, params.tariffs||{}, params.bessStrategy,
    params.bessChargeSources, params.customWindows, rte
  );

  const tariffs = params.tariffs||{};
  const monthly = Array.from({length:12},()=>({
    demand:0, solar:0, wind:0, gc:0, oa:0, bessCharge:0, bessDischarge:0, grid:0, gridForBess:0, curtail:0, unserved:0,
    bessChargeRenewable:0, bessChargeGrid:0, bessChargeOA:0, bessChargeGC:0,
    gridEnergyCostRs:0, oaEnergyCostRs:0, gcEnergyCostRs:0, bessGridCostRs:0, bessOACostRs:0, bessGCCostRs:0
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
        const hourAllowed = !schedule.dischargeRestrict || schedule.dischargeRestrict.has(t.hour);
        if(hourAllowed){
          const maxDis = Math.max(0, Math.min(params.bessMW, (soc-socMin)*params.dischargeEff));
          const u = Math.min(maxDis, need);
          if(u>0){ bessDis+=u; need-=u; soc-=u/params.dischargeEff; }
        }
      }
    }
    // grid resolves last, hard-capped — track the UNCAPPED requirement too,
    // so any unserved energy can be explained honestly (peakGridMW itself is
    // always <= gridCapMW by construction and can never "exceed" it).
    peakGridNeedMW = Math.max(peakGridNeedMW, Math.max(need,0));
    gridUsed = Math.min(params.gridCapMW, Math.max(need,0));
    let unserved = Math.max(need-gridUsed, 0);

    // BESS charging pass 1: leftover OWNED renewable surplus (unchanged from
    // before), only if we did not already discharge this hour (no same-hour
    // charge+discharge).
    // BESS charging pass 1: leftover OWNED renewable surplus, gated by which
    // sources are actually permitted to charge the battery (solar/wind
    // toggles) — surplus from a disallowed source is curtailed, not forced
    // into the battery via the other allowed source's headroom.
    let bessChgRenewable=0, curtail=0;
    const chgSrc = params.bessChargeSources||{};
    const solarSurplus = (chgSrc.solar!==false) ? solarAvail : 0;
    const windSurplus = (chgSrc.wind!==false) ? windAvail : 0;
    const totalSurplus = solarAvail + windAvail;
    const chargeableSurplus = solarSurplus + windSurplus;
    if(bessDis<=1e-9 && chargeableSurplus>1e-9 && soc<socMax){
      const headroomMWh = (socMax-soc)/params.chargeEff;
      const maxChg = Math.min(params.bessMW, chargeableSurplus, headroomMWh);
      bessChgRenewable = Math.max(0,maxChg);
      soc += bessChgRenewable*params.chargeEff;
    }
    curtail = Math.max(totalSurplus-bessChgRenewable,0);

    // BESS charging pass 2: economic Grid/OA/GC charging, ONLY during the
    // strategy's chargeHours window (empty by default -> no effect on any
    // existing caller). Draws from whatever import capacity is left after
    // demand was served this hour: (gridCapMW - gridUsed) for grid, and the
    // leftover of the same OA/GC availability profile used for demand.
    // NOTE: gridUsed above is DEMAND-serving grid only, and stays that way —
    // it feeds the hourly energy-balance equation (demand = solar+wind+gc+
    // oa+bessDischarge+grid+unserved). Grid drawn to charge BESS is tracked
    // separately (gridForBess) and added back only when checking the
    // sanctioned import cap, never into the demand-balance `grid` field.
    let bessChgGrid=0, bessChgOA=0, bessChgGC=0, gridForBess=0;
    if(bessDis<=1e-9 && soc<socMax && schedule.chargeHours.has(t.hour) && params.bessChargeSources){
      const candidates=[];
      if(params.bessChargeSources.grid){
        const gridLeft = Math.max(0, params.gridCapMW-gridUsed);
        if(gridLeft>1e-9) candidates.push({src:'grid', avail:gridLeft, price:tariffs.grid?tariffs.grid[h]:Infinity});
      }
      if(params.bessChargeSources.oa && oaAv>1e-9) candidates.push({src:'oa', avail:oaAv, price:tariffs.oa?tariffs.oa[h]:Infinity});
      if(params.bessChargeSources.gc && gcAv>1e-9) candidates.push({src:'gc', avail:gcAv, price:tariffs.gc?tariffs.gc[h]:Infinity});
      candidates.sort((a,b)=>a.price-b.price);
      const headroomMWh = (socMax-soc)/params.chargeEff;
      let remaining = Math.max(0, Math.min(params.bessMW-bessChgRenewable, headroomMWh));
      for(const c of candidates){
        if(remaining<=1e-9) break;
        const u = Math.min(c.avail, remaining);
        if(u<=1e-9) continue;
        if(c.src==='grid'){ gridForBess+=u; bessChgGrid+=u; }
        else if(c.src==='oa'){ oaAv-=u; bessChgOA+=u; }
        else if(c.src==='gc'){ gcAv-=u; bessChgGC+=u; }
        soc += u*params.chargeEff;
        remaining -= u;
      }
    }
    const bessChg = bessChgRenewable+bessChgGrid+bessChgOA+bessChgGC;
    const gridTotalImport = gridUsed+gridForBess; // demand + BESS charging, for cap/peak/cost purposes

    peakGridMW = Math.max(peakGridMW, gridTotalImport);

    // Hourly-priced procurement cost: actual metered ₹, not an annual-average
    // proxy. Uses the same tariffs array the BESS scheduler consumed, so a
    // ToD/flat rate structure now changes the money, not just the schedule.
    const gRate = tariffs.grid ? tariffs.grid[h] : 0;
    const oRate = tariffs.oa ? tariffs.oa[h] : 0;
    const cRate2 = tariffs.gc ? tariffs.gc[h] : 0;
    const gridEnergyCostRs = gridUsed*1000*gRate;
    const bessGridCostRs = gridForBess*1000*gRate;
    const oaEnergyCostRs = oaUsed*1000*oRate;
    const bessOACostRs = bessChgOA*1000*oRate;
    const gcEnergyCostRs = gcUsed*1000*cRate2;
    const bessGCCostRs = bessChgGC*1000*cRate2;

    const m = t.month;
    monthly[m].demand += totalDemandThisHour;
    monthly[m].solar += solarUsed;
    monthly[m].wind += windUsed;
    monthly[m].gc += gcUsed;
    monthly[m].oa += oaUsed;
    monthly[m].bessCharge += bessChg;
    monthly[m].bessChargeRenewable += bessChgRenewable;
    monthly[m].bessChargeGrid += bessChgGrid;
    monthly[m].bessChargeOA += bessChgOA;
    monthly[m].bessChargeGC += bessChgGC;
    monthly[m].bessDischarge += bessDis;
    monthly[m].grid += gridUsed;
    monthly[m].gridForBess += gridForBess;
    monthly[m].curtail += curtail;
    monthly[m].unserved += unserved;
    monthly[m].gridEnergyCostRs += gridEnergyCostRs;
    monthly[m].oaEnergyCostRs += oaEnergyCostRs;
    monthly[m].gcEnergyCostRs += gcEnergyCostRs;
    monthly[m].bessGridCostRs += bessGridCostRs;
    monthly[m].bessOACostRs += bessOACostRs;
    monthly[m].bessGCCostRs += bessGCCostRs;

    if(collectHourly){
      hourly.push({idx:h, month:t.month, day:t.day, hour:t.hour,
        demand:totalDemandThisHour, solar:solarUsed, wind:windUsed, gc:gcUsed, oa:oaUsed,
        bessCharge:bessChg, bessChargeRenewable:bessChgRenewable, bessChargeGrid:bessChgGrid, bessChargeOA:bessChgOA, bessChargeGC:bessChgGC,
        bessDischarge:bessDis, grid:gridUsed, gridForBess, gridTotal:gridTotalImport, unserved, curtail, soc, socMin, socMax});
    }
  }

  const annual = monthly.reduce((s,m)=>({
    demand:s.demand+m.demand, solar:s.solar+m.solar, wind:s.wind+m.wind, gc:s.gc+m.gc, oa:s.oa+m.oa,
    bessCharge:s.bessCharge+m.bessCharge, bessDischarge:s.bessDischarge+m.bessDischarge,
    bessChargeRenewable:s.bessChargeRenewable+m.bessChargeRenewable, bessChargeGrid:s.bessChargeGrid+m.bessChargeGrid,
    bessChargeOA:s.bessChargeOA+m.bessChargeOA, bessChargeGC:s.bessChargeGC+m.bessChargeGC,
    grid:s.grid+m.grid, gridForBess:s.gridForBess+m.gridForBess, curtail:s.curtail+m.curtail, unserved:s.unserved+m.unserved,
    gridEnergyCostRs:s.gridEnergyCostRs+m.gridEnergyCostRs, oaEnergyCostRs:s.oaEnergyCostRs+m.oaEnergyCostRs,
    gcEnergyCostRs:s.gcEnergyCostRs+m.gcEnergyCostRs, bessGridCostRs:s.bessGridCostRs+m.bessGridCostRs,
    bessOACostRs:s.bessOACostRs+m.bessOACostRs, bessGCCostRs:s.bessGCCostRs+m.bessGCCostRs
  }), {demand:0,solar:0,wind:0,gc:0,oa:0,bessCharge:0,bessDischarge:0,bessChargeRenewable:0,bessChargeGrid:0,bessChargeOA:0,bessChargeGC:0,grid:0,gridForBess:0,curtail:0,unserved:0,
    gridEnergyCostRs:0,oaEnergyCostRs:0,gcEnergyCostRs:0,bessGridCostRs:0,bessOACostRs:0,bessGCCostRs:0});

  return {monthly, annual, peakGridMW, peakGridNeedMW, hourly};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clamp, generate8760Timeline, TIMELINE_8760, HOURS_PER_YEAR, operatingDayMask, shapeArray,
    generateDemand8760Profile, generateUnitMWShape8760, scaleProfile, addProfiles, constProfile,
    generateOA8760Profile, generateGC8760Profiles, runDispatch8760, SOLAR_SEASONAL_N, WIND_SEASONAL_N,
    buildHourlyTariff, computeBessSchedule
  };
}
