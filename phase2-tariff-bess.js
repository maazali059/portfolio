/* ================================================================
   ENERGYNEX — PHASE 2 WIRING: ToD Tariffs + BESS Charging Sources/Strategy
   ================================================================
   Load order:  engine.js is NOT loaded in-browser (it's inlined at the
   top of edhara.js — see edhara.js's own header comment). Load this
   file AFTER edhara.js and AFTER phase.js:

     <script src="edhara.js"></script>
     <script src="phase.js"></script>
     <script src="phase2-tariff-bess.js"></script>

   WHAT THIS FILE DOES AND DOES NOT DO
   ------------------------------------------------------------------
   It does NOT redefine, copy, or duplicate runDispatch8760,
   computeBessSchedule, buildHourlyTariff, the optimiser, or the
   financing engine. Those already exist in edhara.js (inlined from
   engine.js) and are already verified (55/55 in test_engine.js).

   The actual gap: edhara.js's dispatchParamsFor() builds the params
   object passed into runDispatch8760() but never sets `tariffs`,
   `bessStrategy`, `bessChargeSources`, or `customWindows` — so
   computeBessSchedule() always falls through to its `renewable`
   default branch, and the economic Grid/OA/GC -> BESS charging pass
   inside runDispatch8760 (which is fully implemented and tested)
   never actually fires. This file closes that gap by WRAPPING the
   existing global `dispatchParamsFor` function — capturing its
   original output and adding the four missing fields on top — so
   every existing caller (optimizer, exact multi-year financing, BESS
   sweep, reverse pricing, etc.) gets ToD/strategy-aware dispatch for
   free, with zero duplication.

   It also wraps computeOA / computeGridCostEngine / computeGCFullyLoaded
   to fold in user-defined "custom charges" (Architecture spec section
   "CUSTOM CHARGES") without touching those functions' original bodies.

   BACKWARD COMPATIBILITY: with no procurement/BESS UI touched, the
   defaults below (`mode:'flat'`, `customCharges:[]`, `strategy:
   'renewable'`) reproduce EXACTLY the previous behaviour bit-for-bit —
   flat tariffs, no custom charges, BESS charges only from owned
   renewable surplus. Nothing changes until the user actually opens
   the new panels this file injects and changes a setting.
   ================================================================ */
(function(){
  'use strict';
  if (typeof window === 'undefined') return; // guard against accidental Node include
  const $ = id => document.getElementById(id);

  /* ================================================================
     1. STATE — procurement tariff config + BESS operating config.
        Lives here (not read via readInputs()/DOM ids) specifically so
        no HTML file changes are required: every control this file
        injects writes directly into these objects, then calls the
        existing global scheduleRender()/renderAll().
     ================================================================ */
  const PROC_KEYS = ['grid','oa','gc'];
  const procState = {
    grid: { mode:'flat', slots:[ {start:0,end:24,rate:null} ], customCharges:[] },
    oa:   { mode:'flat', slots:[ {start:0,end:24,rate:null} ], customCharges:[] },
    gc:   { mode:'flat', slots:[ {start:0,end:24,rate:null} ], customCharges:[] },
  };
  const bessOpState = {
    strategy: 'renewable', // renewable | mincost | peak | arbitrage | custom
    chargeSources: { solar:true, wind:true, grid:false, oa:false, gc:false },
    customWindows: { chargeHours:'', dischargeHours:'' } // comma-separated hour lists, parsed at read time
  };

  function parseHourList(str){
    if(!str) return [];
    return String(str).split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isFinite(n) && n>=0 && n<24);
  }
  function customChargeSum(list){
    return (list||[]).reduce((s,c)=> s + (parseFloat(c.value)||0), 0);
  }

  /* ================================================================
     2. TARIFF BUILD — reuses the engine's own buildHourlyTariff (from
        edhara.js's inlined engine core) so 'flat' vs 'tod' hour-mapping
        is identical to the tested logic, never re-implemented here.
        Flat baseline for each pathway is the SAME number edhara.js's
        existing cost-stack functions already compute, so the dispatch
        tariff and the displayed landed-cost figure never disagree.
        Cached per render (procState + baseline change) — this is called
        from inside dispatchParamsFor, which can run hundreds of times
        per optimiser search, so rebuilding three 8760-length arrays on
        every call would be a real performance regression.
     ================================================================ */
  let _tariffCache = { key:null, tariffs:null };
  function computeFlatBaseline(inp, key){
    // Same functions/fields edhara.js already uses for each pathway's
    // headline ₹/kWh — reused, not recalculated.
    if(key==='grid') return inp.g_energy; // matches computeGridCostEngine's baseEnergyRate input
    if(key==='oa')   return computeOA(inp).landed; // full landed OA stack (post custom-charge wrap, see below)
    if(key==='gc')   return inp.gc_charges; // matches the existing gcOpexRate usage in evaluateCandidateSteadyState
    return 0;
  }
  function buildAllTariffs(inp){
    const cacheKey = JSON.stringify({
      p: procState, g:inp.g_energy, oa:[inp.oa_energy,inp.oa_trans,inp.oa_wheel,inp.oa_css,inp.oa_addl,inp.oa_bank,inp.oa_sldc,inp.oa_tax,inp.oa_loss], gc:inp.gc_charges
    });
    if(_tariffCache.key===cacheKey) return _tariffCache.tariffs;
    const tariffs = {};
    PROC_KEYS.forEach(key=>{
      const cfg = procState[key];
      const baseline = computeFlatBaseline(inp, key);
      // per-slot null rate means "use the computed baseline for this slot"
      const slots = (cfg.slots||[]).map(sl => ({ start:sl.start, end:sl.end, rate: (sl.rate==null || sl.rate==='') ? baseline : parseFloat(sl.rate) }));
      tariffs[key] = buildHourlyTariff(cfg.mode, baseline, slots);
    });
    _tariffCache = { key:cacheKey, tariffs };
    return tariffs;
  }

  /* ================================================================
     3. WRAP dispatchParamsFor — the single integration point used by
        every dispatch call in the file (optimizer, exact multi-year
        financing, BESS sweep, reverse pricing, dispatch tab). Adding
        the four fields here means every one of those callers gets
        ToD/strategy-aware BESS dispatch with no other edit anywhere.
     ================================================================ */
  const _origDispatchParamsFor = dispatchParamsFor;
  dispatchParamsFor = function(inp, candidate, gridCapMW){
    const base = _origDispatchParamsFor(inp, candidate, gridCapMW);
    base.tariffs = buildAllTariffs(inp);
    base.bessStrategy = bessOpState.strategy;
    base.bessChargeSources = bessOpState.chargeSources;
    base.customWindows = {
      chargeHours: parseHourList(bessOpState.customWindows.chargeHours),
      dischargeHours: parseHourList(bessOpState.customWindows.dischargeHours)
    };
    return base;
  };

  /* ================================================================
     4. WRAP the three cost-stack functions to fold in user-defined
        custom charges, additively — original computation untouched,
        custom-charge total simply added on top of what was already
        the accepted total for that pathway.
     ================================================================ */
  const _origComputeOA = computeOA;
  computeOA = function(inp){
    const r = _origComputeOA(inp);
    const extra = customChargeSum(procState.oa.customCharges);
    if(extra===0) return r;
    const landed = r.landed + extra/(1-inp.oa_loss/100);
    return { landed, breakdown: { ...r.breakdown, "Custom charges": extra } };
  };

  const _origComputeGridCostEngine = computeGridCostEngine;
  computeGridCostEngine = function(inp, gridMWhAnnual, peakGridMW){
    const r = _origComputeGridCostEngine(inp, gridMWhAnnual, peakGridMW);
    const extra = customChargeSum(procState.grid.customCharges);
    if(extra===0) return r;
    return { ...r, customChargeRate: extra, effectivePerKWh: r.effectivePerKWh + extra,
      totalAnnualCostCr: r.totalAnnualCostCr + (extra*gridMWhAnnual*1000)/1e7 };
  };

  const _origComputeGCFullyLoaded = computeGCFullyLoaded;
  computeGCFullyLoaded = function(inp, gcMW, gcConsumedMWh, gcElig){
    const r = _origComputeGCFullyLoaded(inp, gcMW, gcConsumedMWh, gcElig);
    const extra = customChargeSum(procState.gc.customCharges);
    if(extra===0) return r;
    const lossAdj = extra/(1-inp.oa_loss/100);
    return { ...r, deliveredPerKWh: r.deliveredPerKWh + lossAdj,
      breakdown: { ...r.breakdown, "Custom charges (site-specific)": lossAdj } };
  };

  /* ================================================================
     5. UI — self-built panels, no HTML file dependency. Injected once
        (idempotent), synced on every 'energynex:rendered' event that
        phase.js already dispatches after each renderAll(). Falls back
        to appending into #main if the expected phase.js containers
        (#s-grid / #s-oa / #s-gc / #v-bess) aren't present yet.
     ================================================================ */
  function ce(tag, cls, html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; }

  function slotRowHTML(key, sl, i){
    return `<div class="p2slotrow" style="display:flex;gap:6px;align-items:center;margin:4px 0;">
      <input type="number" min="0" max="24" value="${sl.start}" data-p2="${key}" data-i="${i}" data-f="start" style="width:56px" title="Start hour"> :00 –
      <input type="number" min="0" max="24" value="${sl.end}" data-p2="${key}" data-i="${i}" data-f="end" style="width:56px" title="End hour"> :00
      <input type="number" step="0.01" placeholder="baseline" value="${sl.rate==null?'':sl.rate}" data-p2="${key}" data-i="${i}" data-f="rate" style="width:80px" title="₹/kWh (blank = use baseline)">₹/kWh
      <button type="button" class="small ghost" data-p2del="${key}" data-i="${i}">✕</button>
    </div>`;
  }
  function chargeRowHTML(key, c, i){
    return `<div class="p2chargerow" style="display:flex;gap:6px;align-items:center;margin:4px 0;">
      <input type="text" placeholder="Charge name" value="${c.name||''}" data-p2c="${key}" data-i="${i}" data-f="name" style="width:160px">
      <input type="number" step="0.01" placeholder="₹/kWh" value="${c.value==null?'':c.value}" data-p2c="${key}" data-i="${i}" data-f="value" style="width:90px">₹/kWh
      <button type="button" class="small ghost" data-p2cdel="${key}" data-i="${i}">✕</button>
    </div>`;
  }
  function renderProcPanel(key, label){
    const cfg = procState[key];
    const wrap = ce('div','p2panel card');
    wrap.dataset.p2panel = key;
    wrap.style.marginTop = '14px';
    wrap.innerHTML = `<h4 style="margin:0 0 8px">${label} — Tariff Engine</h4>
      <div style="display:flex;gap:14px;margin-bottom:8px;font-size:12.5px;">
        <label><input type="radio" name="p2mode_${key}" value="flat" ${cfg.mode==='flat'?'checked':''}> Flat Tariff</label>
        <label><input type="radio" name="p2mode_${key}" value="tod" ${cfg.mode==='tod'?'checked':''}> Time-of-Day Tariff</label>
      </div>
      <div class="p2slots" style="display:${cfg.mode==='tod'?'block':'none'}">
        <div data-p2slotlist="${key}"></div>
        <button type="button" class="small ghost" data-p2addslot="${key}">+ Add time slot</button>
        <div class="hint" style="margin-top:4px">Blank ₹/kWh in a slot = use the pathway's computed baseline rate for that slot. Slots are hour-of-day (0–24), non-wrapping — enter a 22:00–02:00 window as two slots. These hourly rates feed the actual 8,760h dispatch (BESS charge/discharge timing), not just a display average.</div>
      </div>
      <h5 style="margin:12px 0 4px">Custom charges</h5>
      <div data-p2chargelist="${key}"></div>
      <button type="button" class="small ghost" data-p2addcharge="${key}">+ Add charge</button>
      <div class="hint" style="margin-top:4px">Each added here flows into the landed/fully-loaded ₹/kWh for ${label} exactly like the existing named charges — set to 0 or leave empty to have no effect.</div>`;
    return wrap;
  }
  function syncSlotList(key){
    const host = document.querySelector(`[data-p2slotlist="${key}"]`);
    if(!host) return;
    host.innerHTML = procState[key].slots.map((sl,i)=>slotRowHTML(key,sl,i)).join('');
  }
  function syncChargeList(key){
    const host = document.querySelector(`[data-p2chargelist="${key}"]`);
    if(!host) return;
    host.innerHTML = procState[key].customCharges.map((c,i)=>chargeRowHTML(key,c,i)).join('');
  }

  function renderBessOpPanel(){
    const wrap = ce('div','p2panel card');
    wrap.dataset.p2panel = 'bessop';
    wrap.style.marginTop = '14px';
    const src = bessOpState.chargeSources;
    wrap.innerHTML = `<h4 style="margin:0 0 8px">BESS — Charging Sources &amp; Operating Strategy</h4>
      <div style="font-size:12.5px;margin-bottom:6px">Charging sources</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12.5px;margin-bottom:10px;">
        <label><input type="checkbox" data-p2src="solar" ${src.solar?'checked':''}> Solar</label>
        <label><input type="checkbox" data-p2src="wind" ${src.wind?'checked':''}> Wind</label>
        <label><input type="checkbox" data-p2src="grid" ${src.grid?'checked':''}> Conventional Grid</label>
        <label><input type="checkbox" data-p2src="oa" ${src.oa?'checked':''}> Green OA</label>
        <label><input type="checkbox" data-p2src="gc" ${src.gc?'checked':''}> Group Captive</label>
      </div>
      <div style="font-size:12.5px;margin-bottom:6px">Strategy</div>
      <div style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;">
        ${['renewable','mincost','peak','arbitrage','custom'].map(s=>{
          const labels = {renewable:'Renewable Priority (owned surplus only — default, matches prior behaviour)', mincost:'Minimum Cost', peak:'Peak Avoidance', arbitrage:'Renewable + Arbitrage', custom:'Custom windows'};
          return `<label><input type="radio" name="p2strategy" value="${s}" ${bessOpState.strategy===s?'checked':''}> ${labels[s]}</label>`;
        }).join('')}
      </div>
      <div class="p2customwin" style="display:${bessOpState.strategy==='custom'?'block':'none'};margin-top:8px;">
        <label style="font-size:12.5px;">Charge hours (comma-separated, 0–23): <input type="text" id="p2customCharge" value="${bessOpState.customWindows.chargeHours}" style="width:160px"></label><br>
        <label style="font-size:12.5px;">Discharge hours (comma-separated, 0–23): <input type="text" id="p2customDischarge" value="${bessOpState.customWindows.dischargeHours}" style="width:160px"></label>
      </div>
      <div class="hint" style="margin-top:8px">Reuses the existing engine's computeBessSchedule/runDispatch8760 exactly — this panel only sets which strategy/sources are passed in. Grid/OA/GC charging only ever draws from headroom left after that hour's demand is served, hard-capped at BESS MW/MWh and the grid connection cap, identical to the tested behaviour in test_engine.js.</div>`;
    return wrap;
  }

  function findHost(candidates){
    for(const id of candidates){ const el = $(id); if(el) return el; }
    return $('main');
  }

  let _built = false;
  function buildPanels(){
    if(_built) return;
    if(!(typeof dispatchParamsFor==='function' && typeof buildHourlyTariff==='function')) return; // edhara.js not ready yet
    const gridHost = findHost(['s-grid','g_out']);
    const oaHost   = findHost(['s-oa','oa_out']);
    const gcHost   = findHost(['s-gc','gc_out']);
    const bessHost = findHost(['v-bess']);
    if(gridHost) gridHost.appendChild(renderProcPanel('grid','Conventional Grid'));
    if(oaHost)   oaHost.appendChild(renderProcPanel('oa','Green Open Access'));
    if(gcHost)   gcHost.appendChild(renderProcPanel('gc','Group Captive'));
    if(bessHost) bessHost.appendChild(renderBessOpPanel());
    PROC_KEYS.forEach(k=>{ syncSlotList(k); syncChargeList(k); });
    wireEvents();
    _built = true;
  }

  function wireEvents(){
    document.addEventListener('change', e=>{
      const t = e.target;
      // tariff mode
      if(t.name && t.name.startsWith('p2mode_')){
        const key = t.name.replace('p2mode_','');
        procState[key].mode = t.value;
        const panel = t.closest('.p2panel');
        if(panel) panel.querySelector('.p2slots').style.display = t.value==='tod' ? 'block' : 'none';
        window.renderAll && window.renderAll();
        return;
      }
      // slot field edit
      if(t.dataset.p2){
        const key=t.dataset.p2, i=+t.dataset.i, f=t.dataset.f;
        const sl = procState[key].slots[i];
        if(f==='rate') sl.rate = t.value==='' ? null : parseFloat(t.value);
        else sl[f] = parseInt(t.value,10)||0;
        window.renderAll && window.renderAll();
        return;
      }
      // custom charge field edit
      if(t.dataset.p2c){
        const key=t.dataset.p2c, i=+t.dataset.i, f=t.dataset.f;
        const c = procState[key].customCharges[i];
        c[f] = f==='value' ? (parseFloat(t.value)||0) : t.value;
        window.renderAll && window.renderAll();
        return;
      }
      // BESS charge source checkbox
      if(t.dataset.p2src){
        bessOpState.chargeSources[t.dataset.p2src] = t.checked;
        window.renderAll && window.renderAll();
        return;
      }
      // BESS strategy radio
      if(t.name==='p2strategy'){
        bessOpState.strategy = t.value;
        const panel = t.closest('.p2panel');
        if(panel) panel.querySelector('.p2customwin').style.display = t.value==='custom' ? 'block' : 'none';
        window.renderAll && window.renderAll();
        return;
      }
      if(t.id==='p2customCharge'){ bessOpState.customWindows.chargeHours = t.value; window.renderAll && window.renderAll(); return; }
      if(t.id==='p2customDischarge'){ bessOpState.customWindows.dischargeHours = t.value; window.renderAll && window.renderAll(); return; }
    });
    document.addEventListener('click', e=>{
      const t = e.target;
      if(t.dataset.p2addslot){
        procState[t.dataset.p2addslot].slots.push({start:0,end:1,rate:null});
        syncSlotList(t.dataset.p2addslot);
        window.renderAll && window.renderAll();
      }
      if(t.dataset.p2del!=null && t.dataset.p2del!==''){
        const key=t.dataset.p2del, i=+t.dataset.i;
        procState[key].slots.splice(i,1);
        syncSlotList(key);
        window.renderAll && window.renderAll();
      }
      if(t.dataset.p2addcharge){
        procState[t.dataset.p2addcharge].customCharges.push({name:'', value:0});
        syncChargeList(t.dataset.p2addcharge);
      }
      if(t.dataset.p2cdel!=null && t.dataset.p2cdel!==''){
        const key=t.dataset.p2cdel, i=+t.dataset.i;
        procState[key].customCharges.splice(i,1);
        syncChargeList(key);
        window.renderAll && window.renderAll();
      }
    });
  }

  document.addEventListener('energynex:rendered', buildPanels);
  document.addEventListener('DOMContentLoaded', buildPanels);
  buildPanels(); // in case both edhara.js and phase.js already ran before this script executed

  // exposed for debugging / potential Scenario-builder reuse (Phase 2 §5)
  window.ENERGYNEX_PROC_STATE = procState;
  window.ENERGYNEX_BESS_OP_STATE = bessOpState;
})();
