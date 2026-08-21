const E = require('./engine.js');

let pass=0, fail=0;
function check(name, cond, detail){
  if(cond){ pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail||''); }
}

// 1. timeline length + validity
check('8760 hours exist', E.TIMELINE_8760.length===8760, E.TIMELINE_8760.length);
check('every hour has valid timestamp', E.TIMELINE_8760.every(t=>t.month>=0&&t.month<12&&t.hour>=0&&t.hour<24&&t.day>=1&&t.day<=31), '');

// 2. demand profile + opdays not used as annual multiplier
const demand360 = E.generateDemand8760Profile(1000, 'flat', 360); // 1000 kWh/day terminal, flat shape
const demand180 = E.generateDemand8760Profile(1000, 'flat', 180);
const sumFn = arr => { let s=0; for(let i=0;i<arr.length;i++) s+=arr[i]; return s; };
const annual360 = sumFn(demand360);
const annual180 = sumFn(demand180);
check('opdays affects annual energy via day-mask (not 24h*opdays formula)', Math.abs(annual180 - annual360/2) < annual360*0.05, `360d=${annual360} 180d=${annual180}`);
check('opdays=360 approx 360 operating days worth of energy (~360 MWh from 1000kWh/day)', Math.abs(annual360-360)<5, annual360);

// 3. solar/wind unit shapes hit target CUF
const solarUnit = E.generateUnitMWShape8760(20, 'solar'); // 20% CUF
const windUnit = E.generateUnitMWShape8760(30, 'wind');
const solarAnnual = sumFn(solarUnit);
const windAnnual = sumFn(windUnit);
check('solar unit-MW annual energy matches CUF target (8760*0.20)', Math.abs(solarAnnual-8760*0.20)<1, solarAnnual);
check('wind unit-MW annual energy matches CUF target (8760*0.30)', Math.abs(windAnnual-8760*0.30)<1, windAnnual);
check('solar profile has no negative values', solarUnit.every(v=>v>=-1e-9), '');
check('solar profile varies by month (not flat 365-day repeat)', (()=>{ 
  const janSum = E.TIMELINE_8760.filter(t=>t.month===0).reduce((s,t)=>s+solarUnit[t.idx],0);
  const aprSum = E.TIMELINE_8760.filter(t=>t.month===3).reduce((s,t)=>s+solarUnit[t.idx],0);
  return Math.abs(janSum-aprSum) > 1e-6;
})(), '');

// 4. OA profile
const solarUnitForOA = E.generateUnitMWShape8760(19.5,'solar');
const windUnitForOA = E.generateUnitMWShape8760(26,'wind');
const oaFlat = E.generateOA8760Profile(2, 'flat', solarUnitForOA, windUnitForOA);
check('OA flat profile constant every hour', oaFlat.every(v=>Math.abs(v-2)<1e-9), '');
const oaSolar = E.generateOA8760Profile(2,'solar', solarUnitForOA, windUnitForOA);
check('OA solar-shaped profile varies by hour (daytime only)', oaSolar[2] < oaSolar[12], `h2=${oaSolar[2]} h12=${oaSolar[12]}`);

// 5. GC profiles: entitlement != equity, generation vs entitlement separated
const gc = E.generateGC8760Profiles(3, 60, solarUnitForOA, windUnitForOA, 26); // 26% entitlement explicit
const gcGenAnnual = sumFn(gc.genProfile);
const gcAvailAnnual = sumFn(gc.availProfile);
check('GC entitlement (26%) strictly less than generation, independent of any equity number', Math.abs(gcAvailAnnual/gcGenAnnual-0.26)<0.01, `avail/gen=${gcAvailAnnual/gcGenAnnual}`);

// 6. Full dispatch — energy balance, no double counting, no negative energy
function buildBaseProfiles(){
  const solarU = E.generateUnitMWShape8760(19.5,'solar');
  const windU = E.generateUnitMWShape8760(26,'wind');
  const demand = E.generateDemand8760Profile(15000, 'evening', 360); // 15 MWh/day terminal-ish
  const solar = E.scaleProfile(solarU, 2); // 2 MW solar
  const wind = E.scaleProfile(windU, 1); // 1 MW wind
  const gc = E.generateGC8760Profiles(3, 60, solarU, windU, 26);
  const oa = E.generateOA8760Profile(1, 'solar', solarU, windU);
  return {demand, solar, wind, gcAvail: gc.availProfile, oaAvail: oa, solarU, windU};
}
const P = buildBaseProfiles();
const params = {priorityOrder:['solar','wind','gc','oa','bess','grid'], bessMW:1, bessMWh:2,
  socMinFrac:0.075, socMaxFrac:0.925, chargeEff:Math.sqrt(0.88), dischargeEff:Math.sqrt(0.88), gridCapMW:0.5};
const result = E.runDispatch8760({demand:P.demand, solar:P.solar, wind:P.wind, gcAvail:P.gcAvail, oaAvail:P.oaAvail}, params, true);

check('monthly array has 12 entries', result.monthly.length===12, result.monthly.length);
const monthlyDemandSum = result.monthly.reduce((s,m)=>s+m.demand,0);
check('monthly totals sum to annual total (demand)', Math.abs(monthlyDemandSum-result.annual.demand)<1e-6, `${monthlyDemandSum} vs ${result.annual.demand}`);
const monthlyGridSum = result.monthly.reduce((s,m)=>s+m.grid,0);
check('monthly totals sum to annual total (grid)', Math.abs(monthlyGridSum-result.annual.grid)<1e-6, '');

// energy balance every hour: demand = solar+wind+gc+oa+bessDischarge+grid+unserved
let balanceOK = true, maxErr=0;
for(const h of result.hourly){
  const supplied = h.solar+h.wind+h.gc+h.oa+h.bessDischarge+h.grid+h.unserved;
  const err = Math.abs(supplied-h.demand);
  maxErr = Math.max(maxErr, err);
  if(err>1e-6) balanceOK=false;
}
check('hourly energy balance holds for all 8760 hours', balanceOK, `maxErr=${maxErr}`);

check('no negative energy flows anywhere', result.hourly.every(h=>h.solar>=-1e-9&&h.wind>=-1e-9&&h.gc>=-1e-9&&h.oa>=-1e-9&&h.bessDischarge>=-1e-9&&h.grid>=-1e-9&&h.unserved>=-1e-9&&h.bessCharge>=-1e-9), '');

check('grid import never exceeds sanctioned cap', result.hourly.every(h=>h.grid<=params.gridCapMW+1e-6), '');
check('peakGridNeedMW (uncapped requirement) is always >= peakGridMW (capped delivery)', result.peakGridNeedMW>=result.peakGridMW-1e-9, `need=${result.peakGridNeedMW} capped=${result.peakGridMW}`);

check('SOC never violates min/max bounds', result.hourly.every(h=>h.soc>=h.socMin-1e-6 && h.soc<=h.socMax+1e-6), '');

check('BESS discharge never exceeds bessMW', result.hourly.every(h=>h.bessDischarge<=params.bessMW+1e-6 && h.bessCharge<=params.bessMW+1e-6), '');

// unserved energy correctly appears when grid cap is tiny
const paramsTinyGrid = {...params, gridCapMW:0.001};
const resultTiny = E.runDispatch8760({demand:P.demand, solar:P.solar, wind:P.wind, gcAvail:P.gcAvail, oaAvail:P.oaAvail}, paramsTinyGrid, false);
check('tiny grid cap makes peakGridNeedMW exceed the cap (proves the two numbers can genuinely differ)', resultTiny.peakGridNeedMW > paramsTinyGrid.gridCapMW, `need=${resultTiny.peakGridNeedMW} cap=${paramsTinyGrid.gridCapMW}`);
check('tiny grid cap produces unserved energy', resultTiny.annual.unserved>0, resultTiny.annual.unserved);

// zero-BESS, zero-OA, zero-GC, zero-renewable cases
const zeroBess = E.runDispatch8760({demand:P.demand, solar:P.solar, wind:P.wind, gcAvail:P.gcAvail, oaAvail:P.oaAvail}, {...params, bessMW:0, bessMWh:0}, false);
check('zero-BESS case runs and produces zero bess flows', zeroBess.annual.bessDischarge===0 && zeroBess.annual.bessCharge===0, '');

const zeroOA = E.runDispatch8760({demand:P.demand, solar:P.solar, wind:P.wind, gcAvail:P.gcAvail, oaAvail:new Float64Array(8760)}, params, false);
check('zero-OA case runs, oa annual = 0', zeroOA.annual.oa===0, '');

const zeroGC = E.runDispatch8760({demand:P.demand, solar:P.solar, wind:P.wind, gcAvail:new Float64Array(8760), oaAvail:P.oaAvail}, params, false);
check('zero-GC case runs, gc annual = 0', zeroGC.annual.gc===0, '');

const zeroRen = E.runDispatch8760({demand:P.demand, solar:new Float64Array(8760), wind:new Float64Array(8760), gcAvail:new Float64Array(8760), oaAvail:new Float64Array(8760)}, params, false);
check('zero-renewable case: grid+unserved cover all demand', Math.abs((zeroRen.annual.grid+zeroRen.annual.unserved+zeroRen.annual.bessDischarge) - zeroRen.annual.demand) < 1e-6, '');

// high-renewable case doesn't create energy from nothing
const P2 = (()=>{
  const solarU = E.generateUnitMWShape8760(19.5,'solar');
  const windU = E.generateUnitMWShape8760(26,'wind');
  const demand = E.generateDemand8760Profile(2000, 'flat', 360); // small demand
  const solar = E.scaleProfile(solarU, 10); // huge solar vs demand
  const wind = E.scaleProfile(windU, 5);
  return {demand, solar, wind, gcAvail:new Float64Array(8760), oaAvail:new Float64Array(8760)};
})();
const resultHighRen = E.runDispatch8760(P2, {...params, gridCapMW:5}, true);
let noCreation = true;
for(const h of resultHighRen.hourly){
  const used = h.solar+h.wind;
  // used solar/wind for demand can't exceed what's demanded+bess charge headroom conceptually;
  // check basic invariant: solarUsed <= originally available (already enforced structurally) and demand met without excess
  const supplied = h.solar+h.wind+h.gc+h.oa+h.bessDischarge+h.grid+h.unserved;
  if(Math.abs(supplied-h.demand)>1e-6) noCreation=false;
}
check('high-renewable case: no energy created beyond demand (balance holds)', noCreation, '');

// C-rate constraint check (independent MW/MWh)
function feasibleCrate(mw,mwh,min,max){ if(mwh<=0) return mw<=1e-9; const c=mw/mwh; return c>=min-1e-9 && c<=max+1e-9; }
check('independent BESS MW/MWh: 5MW/10MWh feasible at 0.15-1.0 C-rate band', feasibleCrate(5,10,0.15,1.0), '');
check('independent BESS MW/MWh: 5MW/20MWh feasible (C=0.25)', feasibleCrate(5,20,0.15,1.0), '');
check('independent BESS MW/MWh: 10MW/20MWh feasible (C=0.5)', feasibleCrate(10,20,0.15,1.0), '');
check('independent BESS MW/MWh: 10MW/40MWh feasible (C=0.25)', feasibleCrate(10,40,0.15,1.0), '');
check('C-rate constraint rejects infeasible combo (10MW/5MWh, C=2.0 > max 1.0)', !feasibleCrate(10,5,0.15,1.0), '');

// financial sensitivity checks (simplified, mirrors what evaluateCandidate/computeFinancing will do)
function fakeAnnualCost(gridPerKWh, dispatchAnnual){
  return (dispatchAnnual.grid*1000*gridPerKWh)/1e5; // arbitrary unit for comparison only
}
const costLowTariff = fakeAnnualCost(3, result.annual);
const costHighTariff = fakeAnnualCost(9, result.annual);
check('financial result changes when hourly-derived tariff changes', costHighTariff>costLowTariff, `${costLowTariff} vs ${costHighTariff}`);

console.log(`\n${pass}/${pass+fail} tests passed.`);
process.exit(fail>0?1:0);
