/* ================================================================
   ENERGYNEX — PHASE LAYER (presentation-only, additive)
   ================================================================
   Loaded AFTER edhara.js. This file defines NO new calculations.
   It only:
     (a) relocates existing DOM nodes (same element ids) into a
         simplified 2-phase flow, so readInputs()/renderAll() in
         edhara.js keep reading/writing the exact same elements;
     (b) adds thin UI (sliders, cards, nav) that call EXISTING
         functions already defined in edhara.js: renderAll(),
         getLastState(), evaluateCandidateSteadyState(),
         computeExactMultiYearFinancing(), fmt(), irrLabel().
   If a Phase 1 interaction has no existing engine function behind
   it, it is not built here — see chat notes on the OA/GC ceiling
   gap (represented honestly, not faked with a new toggle).
   ================================================================ */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  function ce(tag, cls, html){ const e = document.createElement(tag); if(cls) e.className = cls; if(html != null) e.innerHTML = html; return e; }
  function moveInto(target, elOrId){
    const node = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if(node) target.appendChild(node);
    return node;
  }
  // move the smallest sane wrapper (closest div ancestor that is a direct
  // child of a .row / .card) for a field id, so label+input travel together
  function fieldWrap(id){
    const input = $(id);
    if(!input) return null;
    return input.closest('label') ? input.parentElement : input.parentElement;
  }

  /* ================================================================
     0. CSS — additive only
     ================================================================ */
  const style = document.createElement('style');
  style.textContent = `
    #sidebar{display:none !important;}
    #main{
    grid-column:1 / 3;
    grid-row:2;
    margin-left:0 !important;
    min-width:0;
    }
    .ctxbar{display:flex;align-items:center;gap:10px;padding:10px 24px;background:#0d1116;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--muted);flex-wrap:wrap;}
    .ctxbar b{color:var(--text);}
    .ctxbar .sep{color:var(--line);}
    .p1bar{display:flex;align-items:center;gap:0;padding:14px 24px;background:var(--panel);border-bottom:1px solid var(--line);}
    .p1step{display:flex;align-items:center;gap:9px;padding:8px 16px;border-radius:20px;cursor:pointer;font-size:13px;color:var(--muted);font-weight:600;}
    .p1step .n{width:24px;height:24px;border-radius:50%;background:var(--panel2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:11.5px;font-family:'IBM Plex Mono';flex:0 0 auto;}
    .p1step.active{color:var(--text);}
    .p1step.active .n{background:var(--solar);color:#04201c;border-color:var(--solar);}
    .p1step.done .n{background:var(--good);color:#04201c;border-color:var(--good);}
    .p1sep{width:28px;height:1px;background:var(--line);flex:0 0 auto;}
    .p1deepdivelink{margin-left:auto;font-size:12px;color:var(--solar);cursor:pointer;text-decoration:underline;}
    .ddbar{display:flex;gap:4px;flex-wrap:wrap;padding:10px 24px;background:var(--panel);border-bottom:1px solid var(--line);}
    .ddtab{padding:7px 14px;border-radius:8px;font-size:12.5px;color:var(--muted);cursor:pointer;border:1px solid transparent;}
    .ddtab.active{color:var(--text);background:var(--panel2);border-color:var(--line);font-weight:600;}
    .ddback{padding:7px 14px;font-size:12.5px;color:var(--solar);cursor:pointer;}
    details.advdetails{margin-top:6px;border:1px dashed var(--line);border-radius:8px;padding:10px 12px;}
    details.advdetails summary{cursor:pointer;font-size:12.5px;color:var(--solar);font-weight:600;}
    details.advdetails[open] summary{margin-bottom:10px;}
    .procgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
    .procgrid .pcard{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px;}
    .procgrid .pcard h4{margin:0 0 8px;font-size:13px;color:var(--text);}
    .assetgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px;}
    .assetgrid .acard{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px;}
    .assetgrid .acard h4{margin:0 0 8px;font-size:13px;color:var(--text);}
    .goBadge{display:inline-block;padding:8px 20px;border-radius:8px;font-size:20px;font-weight:800;letter-spacing:1px;margin-bottom:14px;}
    .goBadge.GO{background:#0a1b14;color:var(--good);border:1px solid #123326;}
    .goBadge.REVIEW{background:#1b160a;color:#f0cd8a;border:1px solid #3a2f1a;}
    .goBadge.NOGO{background:#1b0a0a;color:#ff9b95;border:1px solid #3a1a1a;}
    .challengecard .slrow{display:grid;grid-template-columns:200px 1fr 70px;align-items:center;gap:10px;margin:10px 0;}
    .challengecard input[type=range]{width:100%;}
    .challengeresult{margin-top:14px;padding:12px;border-radius:8px;background:var(--panel2);border:1px solid var(--line);font-size:13px;}
    @media (max-width:900px){ .procgrid,.assetgrid{grid-template-columns:1fr;} .challengecard .slrow{grid-template-columns:1fr;} }
  `;
  document.head.appendChild(style);

  /* ================================================================
     1. Kill the old guided-flow layer's leftovers (old 7-step bar,
        Soon-modal wall). Deep Dive is now fully real, nothing "Soon".
     ================================================================ */
  document.querySelectorAll('.navitem-soon').forEach(n=>n.remove());
  const soonOverlay = $('soonModalOverlay'); if(soonOverlay) soonOverlay.remove();
  const oldProgressBar = $('progressBar'); if(oldProgressBar) oldProgressBar.remove();
  const oldDirtyBanner = $('dirtyBanner'); if(oldDirtyBanner) oldDirtyBanner.remove();
  const sidebar = $('sidebar'); if(sidebar) sidebar.style.display = 'none';

  const main = $('main');

  /* ================================================================
     2. Context bar + Phase-1 stepper (inserted at top of #main)
     ================================================================ */
  const ctxBar = ce('div', 'ctxbar');
  ctxBar.id = 'ctxBar';
  const p1Bar = ce('div', 'p1bar');
  p1Bar.id = 'p1Bar';
  main.insertBefore(p1Bar, main.firstChild);
  main.insertBefore(ctxBar, main.firstChild);

  const P1_STEPS = [
    {id:'v-location',  label:'01 Site',     n:1},
    {id:'v-objective', label:'02 Energy',   n:2},
    {id:'v-decision',  label:'03 Decision', n:3},
  ];
  function renderP1Bar(activeId){
    const activeIdx = P1_STEPS.findIndex(s=>s.id===activeId);
    p1Bar.innerHTML = P1_STEPS.map((s,i)=>
      `<div class="p1step ${s.id===activeId?'active':''} ${activeIdx>i?'done':''}" data-go="${s.id}"><span class="n">${activeIdx>i?'\u2713':s.n}</span><span>${s.label}</span></div>` +
      (i<P1_STEPS.length-1?'<div class="p1sep"></div>':'')
    ).join('') + `<div class="p1deepdivelink" id="deepDiveLink">Show me exactly how you got there \u2192</div>`;
    p1Bar.querySelectorAll('.p1step').forEach(elx=>{
      elx.addEventListener('click', ()=> showView(elx.dataset.go));
    });
    $('deepDiveLink').addEventListener('click', enterDeepDive);
  }

  function updateCtxBar(){
    let inp = {};
    try{ inp = getLastState().inp || {}; }catch(e){}
    const state = inp.state || '\u2014';
    const archMap = {lowutil:'Low-utilisation charger', urbanhpc:'Urban HPC hub', highway:'Highway HPC hub', fleet:'Fleet depot', etruck:'Electric truck hub', ebus:'Electric bus depot'};
    const archetype = archMap[inp.archetype] || inp.archetype || '\u2014';
    let demandGWh = '\u2014';
    try{
      const bd = getLastState().baseDemand8760;
      if(bd){ let s=0; for(let i=0;i<bd.length;i++) s+=bd[i]; demandGWh = (s/1000).toFixed(2)+' GWh'; }
    }catch(e){}
    ctxBar.innerHTML = `<b>ENERGYNEX</b><span class="sep">\u00b7</span><span>${state}</span><span class="sep">\u00b7</span><span>${archetype}</span><span class="sep">\u00b7</span><span>${demandGWh} terminal demand</span>`;
  }

  /* ================================================================
     3. View switching (reuses the exact .view/.active convention
        edhara.js already uses — no change to its own logic needed)
     ================================================================ */
  let deepDiveMode = false;
  function showView(id){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    const t = $(id);
    if(t) t.classList.add('active');
    if(P1_STEPS.some(s=>s.id===id)){
      deepDiveMode = false;
      p1Bar.style.display = 'flex';
      ddBar.style.display = 'none';
      renderP1Bar(id);
    }
    window.scrollTo(0,0);
  }

  /* ================================================================
     4. SITE screen — repurpose v-location; pull in the essential
        Charging Demand fields from v-demand; everything else goes
        behind "Advanced site assumptions".
     ================================================================ */
  (function buildSiteScreen(){
    const vLoc = $('v-location');
    const vDem = $('v-demand');
    if(!vLoc || !vDem) return;

    const head = vLoc.querySelector('.viewhead h1');
    if(head) head.textContent = '01 \u00b7 Site';
    const headP = vLoc.querySelector('.viewhead p');
    if(headP) headP.textContent = 'Tell us where this site is and what type of charging location you are evaluating. Every downstream calculation is derived from this page onward — nothing is decided in advance.';

    // Essentials container, inserted right after the viewhead
    const essentials = ce('div', 'card');
    essentials.innerHTML = '<h3>Site Essentials</h3>';
    vLoc.querySelector('.viewhead').after(essentials);

    // Locate existing pieces inside v-location's "Location" card
    const locCard = Array.from(vLoc.querySelectorAll('.card')).find(c => c.querySelector('#in_state'));
    const caseStudyCard = $('caseStudyCard');
    let discomVoltageRow = null, flagboxHint = null, essentialRow = null, applyBtnRow = null, applyHint = null;
    if(locCard){
      const rows = locCard.querySelectorAll('.row');
      essentialRow = rows[0] || null;              // state + archetype
      discomVoltageRow = rows[1] || null;           // discom + voltage
      applyBtnRow = locCard.querySelector('.btnrow');
      // the hint right after applyBtnRow (archetype-defaults hint) vs the
      // trailing flagbox — grab both hints inside locCard, first is the
      // archetype hint, the .flagbox at the end is the regulatory note
      const hints = locCard.querySelectorAll('.hint');
      applyHint = hints[0] || null;
      flagboxHint = locCard.querySelector('.flagbox');
    }

    if(essentialRow) essentials.appendChild(essentialRow);
    if(applyBtnRow) essentials.appendChild(applyBtnRow);
    if(applyHint) essentials.appendChild(applyHint);

    // Demand table (vehicle categories) — the real demand input, shown in full
    const demandCard = ce('div','card');
    demandCard.innerHTML = '<h3>Charging Demand</h3>';
    const demandTableDiv = $('demandTable');
    const addVehBtn = $('addVehType');
    if(demandTableDiv) demandCard.appendChild(demandTableDiv);
    if(addVehBtn) demandCard.appendChild(addVehBtn);

    // opdays + growth (essential) split out from opdays/growth/shape row; shape -> advanced
    const demRows = vDem.querySelectorAll('.row');
    const opGrowShapeRow = demRows[0] || null; // opdays, growth, shape
    let shapeField = null;
    if(opGrowShapeRow){
      const kids = Array.from(opGrowShapeRow.children);
      shapeField = kids.find(k => k.querySelector('#in_shape'));
      const essentialWrap = ce('div','row');
      kids.forEach(k=>{ if(k !== shapeField) essentialWrap.appendChild(k); });
      demandCard.appendChild(essentialWrap);
    }
    essentials.after(demandCard);

    // demand KPIs (auto-computed feedback) shown right under demand card
    const demandKPIs = $('demandKPIs');
    if(demandKPIs) demandCard.after(demandKPIs);

    // ---- Advanced site assumptions ----
    const adv = ce('details','advdetails');
    adv.innerHTML = '<summary>Advanced site assumptions \u25b8</summary>';
    const advBody = ce('div');
    adv.appendChild(advBody);
    (demandKPIs || demandCard).after(adv);

    if(caseStudyCard) caseStudyCard.remove(); // Site screen is user-entered inputs only, no example loader
    if(discomVoltageRow) advBody.appendChild(discomVoltageRow);
    if(flagboxHint) advBody.appendChild(flagboxHint);
    // locCard is now an empty shell (its content all moved above) — drop it
    if(locCard) locCard.remove();
    if(shapeField){
      const shapeRow = ce('div','row');
      shapeRow.appendChild(shapeField);
      advBody.appendChild(shapeRow);
    }
    // Utilisation ramp card (whole)
    const rampCard = Array.from(vDem.querySelectorAll('.card')).find(c=>c.querySelector('#in_util_y1'));
    if(rampCard) advBody.appendChild(rampCard);

    // leftover v-demand shell is now empty — keep it out of the flow permanently
    vDem.classList.add('view');
    vDem.style.display = 'none';
    vDem.removeAttribute('id'); // free the id; nothing references v-demand as a container anymore
  })();

  /* ================================================================
     5. ENERGY screen — repurpose v-objective; add Power Procurement
        + On-Site Assets cards (mirrored, NOT duplicated calculation
        state — mirrors sync to the real fields already in v-arch /
        v-bess so Deep Dive keeps showing the same values).
     ================================================================ */
  function mirrorField(realId, mirrorInput){
    const real = $(realId);
    if(!real) return;
    mirrorInput.value = real.value;
    let syncing = false;
    mirrorInput.addEventListener('input', ()=>{
      if(syncing) return; syncing = true;
      real.value = mirrorInput.value;
      real.dispatchEvent(new Event('input', {bubbles:true}));
      syncing = false;
    });
    real.addEventListener('input', ()=>{
      if(syncing) return; syncing = true;
      mirrorInput.value = real.value;
      syncing = false;
    });
  }
  function mirrorSelect(realId, mirrorSelectEl){
    const real = $(realId);
    if(!real) return;
    mirrorSelectEl.value = real.value;
    let syncing = false;
    mirrorSelectEl.addEventListener('change', ()=>{
      if(syncing) return; syncing = true;
      real.value = mirrorSelectEl.value;
      real.dispatchEvent(new Event('input', {bubbles:true}));
      syncing = false;
    });
    real.addEventListener('input', ()=>{
      if(syncing) return; syncing = true;
      mirrorSelectEl.value = real.value;
      syncing = false;
    });
  }

  (function buildEnergyScreen(){
    const vObj = $('v-objective');
    if(!vObj) return;
    const head = vObj.querySelector('.viewhead h1');
    if(head) head.textContent = '02 \u00b7 Energy';
    const headP = vObj.querySelector('.viewhead p');
    if(headP) headP.textContent = 'What are we trying to achieve, and which power sources should ENERGYNEX consider? Procurement pathways (Grid / Green OA / Group Captive) are how you buy power; on-site assets (Solar / Wind / BESS) are what you build — the engine optimises how they combine.';

    // Move in_gridallowed out of the Objective card's first row into a new
    // "Power Procurement" card, alongside OA/GC ceiling mirrors.
    const objCard = vObj.querySelector('.card');
    const gridWrap = $('in_gridallowed') ? $('in_gridallowed').parentElement : null;

    const procCard = ce('div','card');
    procCard.innerHTML = '<h3>Power Procurement Options Considered</h3>';
    const procGrid = ce('div','procgrid');
    procCard.appendChild(procGrid);

    const gridPCard = ce('div','pcard');
    gridPCard.innerHTML = '<h4>\u2611 Grid</h4>';
    if(gridWrap) gridPCard.appendChild(gridWrap);
    procGrid.appendChild(gridPCard);

    const oaPCard = ce('div','pcard');
    const oaCheckWrap = ce('label',null,'<input type="checkbox" id="p1_oa_check"> Green OA');
    oaCheckWrap.style.fontWeight = '700'; oaCheckWrap.style.fontSize = '13px'; oaCheckWrap.style.color = 'var(--text)'; oaCheckWrap.style.display='block'; oaCheckWrap.style.marginBottom='8px';
    oaPCard.appendChild(oaCheckWrap);
    const oaMirrorLabel = ce('label',null,'Ceiling (MW)'); oaMirrorLabel.style.fontSize='11px';
    oaPCard.appendChild(oaMirrorLabel);
    const oaMirror = ce('input'); oaMirror.type='number'; oaMirror.step='0.1';
    oaPCard.appendChild(oaMirror);
    procGrid.appendChild(oaPCard);

    const gcPCard = ce('div','pcard');
    const gcCheckWrap = ce('label',null,'<input type="checkbox" id="p1_gc_check"> Group Captive');
    gcCheckWrap.style.fontWeight = '700'; gcCheckWrap.style.fontSize = '13px'; gcCheckWrap.style.color = 'var(--text)'; gcCheckWrap.style.display='block'; gcCheckWrap.style.marginBottom='8px';
    gcPCard.appendChild(gcCheckWrap);
    const gcMirrorLabel = ce('label',null,'Ceiling (MW)'); gcMirrorLabel.style.fontSize='11px';
    gcPCard.appendChild(gcMirrorLabel);
    const gcMirror = ce('input'); gcMirror.type='number'; gcMirror.step='0.1';
    gcPCard.appendChild(gcMirror);
    procGrid.appendChild(gcPCard);

    const procNote = ce('p','hint');
    procNote.style.marginTop = '10px';
    procNote.innerHTML = 'OA and GC are currently evaluated by the optimiser subject to their capacity ceilings below \u2014 unchecking sets that ceiling to 0, but the engine\u2019s search still allows a small minimum (\u2264 0.5 MW or the site\u2019s average demand) so it is not a strict on/off switch. A genuine hard include/exclude control would be a real optimiser change, not a UI change \u2014 tell us if you want that built.';
    procCard.appendChild(procNote);

    objCard.after(procCard);

    // On-Site / Integrated Assets card
    const assetCard = ce('div','card');
    assetCard.innerHTML = '<h3>On-Site / Integrated Assets</h3><p class="hint" style="margin-top:0;">What are you allowing ENERGYNEX to consider building on site? Just the ceilings the optimiser searches within \u2014 CAPEX, O&amp;M, degradation, lifetime and financing assumptions for each stay in Deep Dive \u2192 Architecture.</p>';
    const assetGrid = ce('div','assetgrid');
    assetCard.appendChild(assetGrid);

    const solarACard = ce('div','acard');
    solarACard.innerHTML = '<h4>Solar (MW)</h4>';
    const solarMirror = ce('input'); solarMirror.type='number'; solarMirror.step='0.1';
    solarACard.appendChild(solarMirror);
    assetGrid.appendChild(solarACard);

    const windACard = ce('div','acard');
    windACard.innerHTML = '<h4>Wind (MW)</h4>';
    const windMirror = ce('input'); windMirror.type='number'; windMirror.step='0.1';
    windACard.appendChild(windMirror);
    assetGrid.appendChild(windACard);

    const bessACard = ce('div','acard');
    bessACard.innerHTML = '<h4>BESS ceiling</h4><label style="font-size:11px;">Max MWh to evaluate</label>';
    const bessMWhMirror = ce('input'); bessMWhMirror.type='number';
    bessACard.appendChild(bessMWhMirror);
    const bessMWLabel = ce('label',null,'Max MW to evaluate'); bessMWLabel.style.fontSize='11px'; bessMWLabel.style.marginTop='6px'; bessMWLabel.style.display='block';
    bessACard.appendChild(bessMWLabel);
    const bessMWMirror = ce('input'); bessMWMirror.type='number';
    bessACard.appendChild(bessMWMirror);
    assetGrid.appendChild(bessACard);

    procCard.after(assetCard);

    mirrorField('oa_mw', oaMirror);
    mirrorField('gc_mw', gcMirror);
    mirrorField('s_mw', solarMirror);
    mirrorField('w_mw', windMirror);
    mirrorField('b_maxmwh', bessMWhMirror);
    mirrorField('b_maxmw', bessMWMirror);

    // Checkbox <-> real ceiling field. Checked = ceiling restored to its
    // last non-zero value (or a sensible default if it was never set).
    // Unchecked = real field set to 0. This drives the ACTUAL oa_mw/gc_mw
    // inputs the optimiser reads — not a separate, fake on/off flag.
    function wireProcCheckbox(checkboxId, realId, mirrorInput, fallback){
      const cb = $(checkboxId), real = $(realId);
      if(!cb || !real) return;
      let lastNonZero = (+real.value)>0 ? +real.value : fallback;
      cb.checked = (+real.value) > 0;
      mirrorInput.disabled = !cb.checked;
      cb.addEventListener('change', ()=>{
        if(cb.checked){
          real.value = lastNonZero>0 ? lastNonZero : fallback;
        } else {
          if((+real.value)>0) lastNonZero = +real.value;
          real.value = 0;
        }
        mirrorInput.value = real.value;
        mirrorInput.disabled = !cb.checked;
        real.dispatchEvent(new Event('input', {bubbles:true}));
      });
      real.addEventListener('input', ()=>{
        cb.checked = (+real.value) > 0;
        mirrorInput.disabled = !cb.checked;
      });
    }
    wireProcCheckbox('p1_oa_check', 'oa_mw', oaMirror, 2);
    wireProcCheckbox('p1_gc_check', 'gc_mw', gcMirror, 2);

    // "Let ENERGYNEX optimise" — calls the SAME renderAll() edhara.js already
    // debounces on every input change; this just forces it immediately and
    // navigates to the Decision screen.
    const optBtn = ce('button','run-btn','Let ENERGYNEX optimise the combination \u2192');
    optBtn.style.marginTop = '14px';
    optBtn.addEventListener('click', ()=>{
      renderAll();
      showView('v-decision');
    });
    assetCard.after(optBtn);
  })();

  /* ================================================================
     6. DECISION screen — trim v-decision to the Phase-1 hero content,
        move the exploratory tools (Min-Util Solver, Risk-Adjusted
        Analysis, Key Risks/Data Confidence) into Deep Dive -> Risk,
        add a GO/REVIEW/NO-GO badge and a "Challenge this decision"
        panel that re-calls existing engine functions with a
        perturbed input clone (best.candidate held fixed).
     ================================================================ */
  let riskExtrasHost = null; // filled in once v-risk is set up below
  let fullDetailHost = null; // original decisionMain/diagCard/why-sens/nextBest, moved to Deep Dive
  (function buildDecisionScreen(){
    const vDec = $('v-decision');
    if(!vDec) return;

    const minUtilCard = $('runMinUtilBtn') ? $('runMinUtilBtn').closest('.card') : null;
    const riskAdjCard = $('runRiskAdjBtn') ? $('runRiskAdjBtn').closest('.card') : null;
    const riskDataGrid = $('riskShort') ? $('riskShort').closest('.grid2') : null;

    riskExtrasHost = ce('div');
    if(minUtilCard) riskExtrasHost.appendChild(minUtilCard);
    if(riskAdjCard) riskExtrasHost.appendChild(riskAdjCard);
    if(riskDataGrid) riskExtrasHost.appendChild(riskDataGrid);

    // The original decisionMain / diagCard / why-sens grid2 / nextBestBox
    // are still rendered by edhara.js exactly as before (same numbers) —
    // we just relocate the full detail into Deep Dive -> Risk, and build a
    // tight hero summary (below) as the Phase-1 Decision screen itself.
    const decisionMainEl = $('decisionMain');
    const diagCard = $('diagCard');
    const whySensGrid = $('whyList') ? $('whyList').closest('.grid2') : null;
    const nextBestBox = $('nextBestBox');
    const nextBestCard = nextBestBox ? nextBestBox.closest('.card') : null;
    fullDetailHost = ce('div');
    const fdLabel = ce('div','viewhead','<h3 style="margin-top:20px;">Full Decision Detail</h3><p>Same numbers as the Decision screen\u2019s hero summary \u2014 the complete reasoning, return diagnostics and next-best comparison behind it.</p>');
    fullDetailHost.appendChild(fdLabel);
    if(decisionMainEl) fullDetailHost.appendChild(decisionMainEl);
    if(diagCard) fullDetailHost.appendChild(diagCard);
    if(whySensGrid) fullDetailHost.appendChild(whySensGrid);
    if(nextBestCard) fullDetailHost.appendChild(nextBestCard);

    // ---- Hero: verdict + architecture + 5 headline stats ----
    const hero = ce('div','card');
    hero.id = 'decisionHero';
    vDec.appendChild(hero);

    // ---- Why? (short, composed from the same computed values only) ----
    const whyCard = ce('div','card');
    whyCard.id = 'decisionWhy';
    whyCard.innerHTML = '<h3>Why?</h3><div id="decisionWhyList"></div>';
    vDec.appendChild(whyCard);

    // ---- What could change the decision? (auto-computed at fixed presets,
    // using the exact same engine call as the manual sliders below) ----
    const whatCard = ce('div','card');
    whatCard.id = 'decisionWhat';
    whatCard.innerHTML = '<h3>What Could Change The Decision?</h3><div id="decisionWhatList">Computing\u2026</div>';
    vDec.appendChild(whatCard);

    const ddLink = ce('div');
    ddLink.style.cssText = 'text-align:center;margin:18px 0;';
    ddLink.innerHTML = '<span style="color:var(--solar);cursor:pointer;text-decoration:underline;font-size:13.5px;" id="heroDeepDiveLink">Show me exactly how you got here \u2192</span>';
    vDec.appendChild(ddLink);

    // ---- Optional: test your own scenario (de-emphasised, kept for
    // interactivity — same engine call as the auto "what could change") ----
    const challengeCard = ce('div','card challengecard');
    challengeCard.id = 'challengeCard';
    challengeCard.style.cssText = 'opacity:0.92;';
    challengeCard.innerHTML = `<h3 style="font-size:14px;">Or Test Your Own Scenario</h3>
      <p class="hint" style="margin-top:0;">Holds the recommended architecture fixed and re-runs the exact same multi-year 8,760h financing engine with one assumption moved at a time.</p>
      <div class="slrow"><label>Utilisation (vs current plan)</label><input type="range" id="chal_util" min="35" max="150" value="100"><span id="chal_util_v">100%</span></div>
      <div class="slrow"><label>Electricity/grid cost (vs current)</label><input type="range" id="chal_grid" min="50" max="200" value="100"><span id="chal_grid_v">100%</span></div>
      <div class="slrow"><label>CAPEX (vs current)</label><input type="range" id="chal_capex" min="70" max="160" value="100"><span id="chal_capex_v">100%</span></div>
      <div class="slrow"><label>Charging price (vs current)</label><input type="range" id="chal_price" min="60" max="150" value="100"><span id="chal_price_v">100%</span></div>
      <div class="challengeresult" id="challengeResult"></div>`;
    vDec.appendChild(challengeCard);

    // ---- shared engine call: perturb inp, hold candidate fixed ----
    function perturbedFinancing(state, {util=100, grid=100, capex=100, price=100}){
      const inp2 = Object.assign({}, state.inp);
      inp2.util_y1 = state.inp.util_y1 * (util/100);
      inp2.util_terminal = state.inp.util_terminal * (util/100);
      inp2.g_energy = state.inp.g_energy * (grid/100);
      inp2.s_capex = state.inp.s_capex * (capex/100);
      inp2.w_capex = state.inp.w_capex * (capex/100);
      inp2.gc_capex = state.inp.gc_capex * (capex/100);
      inp2.b_capex = state.inp.b_capex * (capex/100);
      inp2.b_capex_mw = state.inp.b_capex_mw * (capex/100);
      inp2.e_chargercapex = state.inp.e_chargercapex * (capex/100);
      inp2.e_gridcapex = state.inp.e_gridcapex * (capex/100);
      inp2.e_civilcapex = state.inp.e_civilcapex * (capex/100);
      inp2.e_price = state.inp.e_price * (price/100);
      inp2.e_fleetprice = state.inp.e_fleetprice * (price/100);
      const fin2 = computeExactMultiYearFinancing(inp2, state.units, state.baseDemand8760, state.best.candidate, state.gridCapMW);
      const meetsIRR = isFinite(fin2.equityIRR) && fin2.equityIRR >= inp2.f_hurdle;
      const meetsDSCR = !!fin2.dscrOK;
      const verdict = (meetsIRR && meetsDSCR) ? 'GO' : ((meetsIRR || meetsDSCR) ? 'REVIEW' : 'NO-GO');
      return {inp2, fin2, verdict};
    }

    function recomputeChallenge(){
      let state;
      try{ state = getLastState(); }catch(e){ return; }
      if(!state || !state.best) return;
      const util = +$('chal_util').value, grid = +$('chal_grid').value, capex = +$('chal_capex').value, price = +$('chal_price').value;
      $('chal_util_v').textContent = util+'%';
      $('chal_grid_v').textContent = grid+'%';
      $('chal_capex_v').textContent = capex+'%';
      $('chal_price_v').textContent = price+'%';
      let r;
      try{ r = perturbedFinancing(state, {util,grid,capex,price}); }
      catch(e){ $('challengeResult').innerHTML = 'Could not re-run this combination.'; return; }
      const verdictClass = r.verdict==='GO'?'GO':(r.verdict==='REVIEW'?'REVIEW':'NOGO');
      $('challengeResult').innerHTML = `<span class="goBadge ${verdictClass}" style="font-size:14px;padding:4px 12px;">${r.verdict}</span>
        &nbsp; Equity IRR: <b>${irrLabel(r.fin2.equityIRR)}</b> (hurdle ${fmt(r.inp2.f_hurdle,1)}%) &nbsp;|&nbsp; Avg DSCR: <b>${fmt(r.fin2.avgDSCR,2)}\u00d7</b> (covenant ${fmt(r.inp2.f_mindscr,2)}\u00d7)`;
    }
    ['chal_util','chal_grid','chal_capex','chal_price'].forEach(id=>{
      $(id).addEventListener('input', recomputeChallenge);
    });

    function renderHeroAndWhy(){
      let state;
      try{ state = getLastState(); }catch(e){ return; }
      if(!state || !state.best || !state.finExact || !state.inp) return;
      const best = state.best, finExact = state.finExact, inp = state.inp;
      const meetsIRR = isFinite(finExact.equityIRR) && finExact.equityIRR >= inp.f_hurdle;
      const meetsDSCR = !!finExact.dscrOK;
      const verdict = (meetsIRR && meetsDSCR) ? 'GO' : ((meetsIRR || meetsDSCR) ? 'REVIEW' : 'NO-GO');
      const verdictClass = verdict==='GO'?'GO':(verdict==='REVIEW'?'REVIEW':'NOGO');
      let archName = '\u2014';
      try{ archName = architectureNameOf(best); }catch(e){}

      hero.innerHTML = `
        <span class="goBadge ${verdictClass}">${verdict}</span>
        <div class="hint" style="text-transform:uppercase;letter-spacing:0.08em;color:var(--solar);margin-top:12px;">Recommended</div>
        <h2 style="margin:4px 0 16px;">${archName}</h2>
        <div class="grid4">
          ${kpiCard('Delivered energy cost','\u20b9'+fmt(best.landedCostPerKWh,2),'/kWh')}
          ${kpiCard('Project IRR', irrLabel(finExact.projectIRR),'')}
          ${kpiCard('Equity IRR', irrLabel(finExact.equityIRR),'')}
          ${kpiCard('CAPEX required', fmt(finExact.totalCapexCr,1),'\u20b9 Cr')}
        </div>
        <div class="grid4" style="margin-top:10px;">
          ${kpiCard('Renewable share', fmt(best.renShare,1),'%')}
          ${kpiCard('Grid dependency', fmt(best.annual.demand>0?(best.annual.grid/best.annual.demand*100):0,1),'%')}
          ${kpiCard('Unserved energy', fmt(best.unservedMWh,1),'MWh/yr')}
          ${kpiCard('DSCR', fmt(finExact.avgDSCR,2),'\u00d7')}
        </div>`;

      const gridDepPct = best.annual.demand>0 ? (best.annual.grid/best.annual.demand*100) : 0;
      const whyBullets = [
        `Lowest viable delivered energy cost among the architectures the optimiser evaluated \u2014 \u20b9${fmt(best.landedCostPerKWh,2)}/kWh.`,
        `${best.renShare>=inp.retarget ? 'Meets' : 'Falls short of'} the ${fmt(inp.retarget,0)}% renewable objective at ${fmt(best.renShare,1)}% renewable share.`,
        `${best.unservedMWh<=0.01 ? 'Maintains full reliability \u2014 no unserved energy under current sizing.' : `Grid dependency ${fmt(gridDepPct,1)}%, with ${fmt(best.unservedMWh,1)} MWh/yr unserved \u2014 see What Could Change below.`}`,
        `Equity IRR ${irrLabel(finExact.equityIRR)} against a ${fmt(inp.f_hurdle,1)}% hurdle, DSCR ${fmt(finExact.avgDSCR,2)}\u00d7 (covenant ${fmt(inp.f_mindscr,2)}\u00d7, ${finExact.dscrOK?'met':'NOT met'}).`,
      ];
      $('decisionWhyList').innerHTML = whyBullets.map((b,i)=>`<div class="reason"><div class="n">${String(i+1).padStart(2,'0')}</div><div>${b}</div></div>`).join('');

      // "What could change the decision?" — 3 fixed presets, same engine call
      let whatHtml = '';
      try{
        const presets = [
          {label:'Utilisation \u219320%', p:{util:80}},
          {label:'CAPEX \u219120%', p:{capex:120}},
          {label:'Electricity/grid cost \u219150%', p:{grid:150}},
        ];
        whatHtml = presets.map(pr=>{
          const r = perturbedFinancing(state, pr.p);
          const vClass = r.verdict==='GO'?'GO':(r.verdict==='REVIEW'?'REVIEW':'NOGO');
          return `<div class="reason"><div class="n">\u2192</div><div>${pr.label} <span class="goBadge ${vClass}" style="font-size:11px;padding:2px 8px;margin-left:4px;">${r.verdict}</span> (Equity IRR ${irrLabel(r.fin2.equityIRR)})</div></div>`;
        }).join('');
      }catch(e){ whatHtml = '<div class="hint">Could not compute sensitivity presets.</div>'; }
      $('decisionWhatList').innerHTML = whatHtml;
    }

    $('heroDeepDiveLink')?.addEventListener('click', enterDeepDive);
    document.addEventListener('energynex:rendered', ()=>{ renderHeroAndWhy(); recomputeChallenge(); });
    setTimeout(()=>{ renderHeroAndWhy(); recomputeChallenge(); }, 300);
  })();
  // (superseded old updateGoNoGoBadge removed — the verdict badge now
  // renders inline as part of renderHeroAndWhy() above, same source data)

  /* ================================================================
     7. DEEP DIVE — horizontal 9-tab subnav wrapping the existing,
        already-complete views. No calculation content is touched;
        only container/tab plumbing around existing subviews.
     ================================================================ */
  const ddBar = ce('div','ddbar');
  ddBar.id = 'ddBar';
  ddBar.style.display = 'none';
  $('p1Bar').after(ddBar);

  function buildTabbedWrapper(wrapperId, title, desc, tabs){
    // tabs: [{label, node}] where node is an existing element to host as a subview
    const wrap = ce('div','view');
    wrap.id = wrapperId;
    const vh = ce('div','viewhead', `<h1>${title}</h1><p>${desc}</p>`);
    wrap.appendChild(vh);
    const tabbar = ce('div','tabs');
    wrap.appendChild(tabbar);
    tabs.forEach((t,i)=>{
      const btn = ce('div','tabbtn'+(i===0?' active':''), t.label);
      btn.dataset.sub = wrapperId+'-sub'+i;
      tabbar.appendChild(btn);
      if(t.node){
        // strip 'view' in case this node was originally a top-level .view
        // (v-bess/v-econ/v-own/v-break) — leaving it on would make the
        // top-level nav's ".view.active" reset sweep also blank this
        // subview out from under its own tab bar.
        t.node.classList.remove('view');
        t.node.classList.add('subview');
        if(i===0) t.node.classList.add('active'); else t.node.classList.remove('active');
        t.node.id = wrapperId+'-sub'+i;
        wrap.appendChild(t.node);
      }
      btn.addEventListener('click', ()=>{
        tabbar.querySelectorAll('.tabbtn').forEach(b=>b.classList.remove('active'));
        wrap.querySelectorAll('.subview').forEach(s=>s.classList.remove('active'));
        btn.classList.add('active');
        $(btn.dataset.sub).classList.add('active');
      });
    });
    main.appendChild(wrap);
    return wrap;
  }

  let ddBuilt = false;
  function buildDeepDive(){
    if(ddBuilt) return; ddBuilt = true;
    const vArch = $('v-arch');

    // ---- Architecture: Solar | Wind | BESS ----
    const sSolar = $('s-solar'), sWind = $('s-wind');
    const vBess = $('v-bess');
    if(vBess){ vBess.querySelector('.viewhead')?.remove(); }
    buildTabbedWrapper('v-p2-architecture', 'Architecture', 'Physical generation and storage assets available to this site \u2014 sizing, technical specs and alternatives, all costed on the same 8,760h basis.',
      [{label:'Solar', node:sSolar}, {label:'Wind', node:sWind}, {label:'BESS', node:vBess}]);

    // ---- Economics: Green OA | Group Captive | Grid | Comparison ----
    const sOA = $('s-oa'), sGC = $('s-gc'), sGrid = $('s-grid'), sCompare = $('s-compare');
    buildTabbedWrapper('v-p2-economics', 'Economics', 'The complete component stack behind every ₹/kWh figure \u2014 value, source, effective date and verification status for each line, nothing collapsed into a single blended number.',
      [{label:'Green OA', node:sOA}, {label:'Group Captive', node:sGC}, {label:'Grid', node:sGrid}, {label:'Comparison', node:sCompare}]);

    // v-arch shell now empty — remove from flow
    if(vArch){ vArch.style.display='none'; vArch.classList.remove('view'); vArch.removeAttribute('id'); }

    // ---- Finance: Revenue & Financing | Ownership | Break-Even ----
    const vEcon = $('v-econ'), vOwn = $('v-own'), vBreak = $('v-break');
    if(vEcon) vEcon.querySelector('.viewhead')?.remove();
    if(vOwn) vOwn.querySelector('.viewhead')?.remove();
    if(vBreak) vBreak.querySelector('.viewhead')?.remove();
    buildTabbedWrapper('v-p2-finance', 'Finance', 'Revenue, CAPEX, financing structure, ownership models and the exact multi-year cash-flow / IRR / DSCR chain behind the headline numbers.',
      [{label:'Revenue & Financing', node:vEcon}, {label:'Ownership Models', node:vOwn}, {label:'Break-Even', node:vBreak}]);

    // ---- Risk: existing v-risk + the 3 blocks moved out of Decision ----
    const vRisk = $('v-risk');
    if(vRisk && riskExtrasHost){
      const label = ce('div','viewhead','<h3 style="margin-top:20px;">Decision Stress-Testing</h3><p>These tools were moved here from the Decision screen to keep the headline recommendation uncluttered \u2014 same engine, same numbers.</p>');
      vRisk.appendChild(label);
      vRisk.appendChild(riskExtrasHost);
    }
    if(vRisk && fullDetailHost){
      vRisk.appendChild(fullDetailHost);
    }

    // ---- Dispatch, Scenarios, States, Audit, Methodology: used as-is ----
  }

  const DD_TABS = [
    {id:'v-p2-architecture', label:'Architecture'},
    {id:'v-dispatch',        label:'Dispatch'},
    {id:'v-p2-economics',    label:'Economics'},
    {id:'v-p2-finance',      label:'Finance'},
    {id:'v-scen',            label:'Scenarios'},
    {id:'v-risk',            label:'Risk'},
    {id:'v-states',          label:'States'},
    {id:'v-audit',           label:'Audit'},
    {id:'v-about',           label:'Methodology'},
  ];
  function renderDDBar(activeId){
    ddBar.innerHTML = `<div class="ddback" id="ddBackLink">\u2190 Decision</div>` +
      DD_TABS.map(t=>`<div class="ddtab ${t.id===activeId?'active':''}" data-go="${t.id}">${t.label}</div>`).join('');
    ddBar.querySelectorAll('.ddtab').forEach(elx=>{
      elx.addEventListener('click', ()=>{ enterDeepDive(); showDDView(elx.dataset.go); });
    });
    $('ddBackLink').addEventListener('click', ()=> showView('v-decision'));
  }
  function showDDView(id){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    const t = $(id);
    if(t) t.classList.add('active');
    renderDDBar(id);
    window.scrollTo(0,0);
  }
  function enterDeepDive(){
    buildDeepDive();
    deepDiveMode = true;
    p1Bar.style.display = 'none';
    ddBar.style.display = 'flex';
    if(!document.querySelector('#v-p2-architecture')) return;
    const current = document.querySelector('#main > .view.active');
    const alreadyDD = current && DD_TABS.some(t=>t.id===current.id);
    showDDView(alreadyDD ? current.id : 'v-p2-architecture');
  }

  /* ================================================================
     8. Hook into edhara.js's render cycle without touching it: wrap
        the existing global renderAll so we get a callback after every
        recompute (updates context bar, GO/NO-GO badge, challenge panel).
     ================================================================ */
  const _origRenderAll = window.renderAll;
  window.renderAll = function(){
    _origRenderAll.apply(this, arguments);
    updateCtxBar();
    document.dispatchEvent(new Event('energynex:rendered'));
  };

  /* ================================================================
     9. Init — land on Site screen
     ================================================================ */
  showView('v-location');
  updateCtxBar();
  setTimeout(()=>{ updateCtxBar(); }, 300);
})();
