/* ============================================================
   ENERGYNEX — DEFAULT STATE
   ============================================================ */
function defaultVehicles(){
  return [
    {name:"Passenger cars (4W)", vpd:180, spd:1.0, kwh:22},
    {name:"Electric buses",      vpd:12,  spd:1.0, kwh:140},
    {name:"E-freight / LCV-MCV", vpd:35,  spd:1.0, kwh:85},
    {name:"2W / 3W",             vpd:60,  spd:1.0, kwh:2.5},
  ];
}
function defaultProcState(){
  return {
    grid: { mode:'flat', slots:[{start:0,end:24,rate:null}], customCharges:[] },
    oa:   { mode:'flat', slots:[{start:0,end:24,rate:null}], customCharges:[] },
    gc:   { mode:'flat', slots:[{start:0,end:24,rate:null}], customCharges:[] },
  };
}
function defaultBessOp(){
  return {
    strategy: 'renewable', // renewable | mincost | peak | arbitrage | custom
    chargeSources: { solar:true, wind:true, grid:false, oa:false, gc:false },
    customWindows: { chargeHours:'', dischargeHours:'' }
  };
}
function defaultCandidate(){
  return { solarMW:0, windMW:0, oaMW:0, gcMW:0, bessMW:0, bessMWh:0 };
}
function defaultInputs(){
  return {
    // Site
    state:'Gujarat', archetype:'Highway / intercity hub', discom:'', voltage:'HT / 11kV',
    gridAllowed:true, g_sanc:2000, // kVA sanctioned
    g_upgrade_avail:false, g_upgrade_mw:1.0, g_upgrade_capex:0.6,
    // Demand shape
    opdays:350, shape:'daytime', growth:6,
    util_y1:35, util_rampyears:4, util_terminal:85, util_shape:'scurve',
    // Decision targets
    retarget:60, redef:'annual-energy', reliab:'standard', priority:'solar-wind-gc-oa-bess-grid',
    // Solar
    s_mw:0, s_cuf:19.5, s_capex:3.6, s_om:120, s_deg:0.5, s_life:25,
    // Wind
    w_mw:0, w_cuf:26, w_capex:6.2, w_om:180, w_deg:0.3, w_life:25,
    // Green OA
    oa_energy:3.4, oa_trans:0.15, oa_wheel:0.24, oa_css:1.33, oa_addl:0.76, oa_bank:1.50, oa_sldc:0.06,
    oa_loss:3.5, oa_tax:0, oa_mw:0, oa_shape:'solar', oa_min_mw:1.0,
    // Group Captive
    gc_mw:0, gc_equity:26, gc_selfcons:51, gc_myequity:26, gc_capex:4.2, gc_charges:1.35, gc_solarshare:70, gc_entitlement:100,
    // Conventional Grid
    g_energy:8.10, g_demand:420, g_fixed:0, g_tod:0.90, g_solardisc:0.0, g_excess_demand:600, g_fppca:0.35,
    g_conn_amort:0, g_tax:0,
    // Revenue / site capex
    e_price:14.5, e_fleetprice:11.5, e_fleetshare:35, e_greenprem:0.5,
    e_chargercapex:6.5, e_gridcapex:1.8, e_civilcapex:2.4, e_contg:8,
    // Finance
    f_debt:70, f_rate:10.5, f_tenor:10, f_hurdle:12, f_tax:25, f_dep:15, f_mindscr:1.15, f_targetirr:16,
    riskObjective:false, risk_lambda:0.5,
    p_base:50, p_downside:25, p_upside:15, p_stress:10,
    // BESS sizing + economics
    b_maxmwh:4, b_maxmw:2, b_cratemin:0.25, b_cratemax:1.0,
    b_capex:9.5, b_capex_mw:3.2, b_rte:88, b_soc:80,
    b_cycles:5000, b_deg:2.5, b_om:2.5, b_baasfixed:0, b_baasrate:0, b_baasesc:0,
    b_life:12, b_replcost:55, b_minusable:70,
    // Scenario tilts
    st_util:0, st_grid:0, st_bess:0, st_price:0, st_int:0, st_ren:0,
    // runtime state
    scenario:'base', vehicles: defaultVehicles(), procState: defaultProcState(), bessOp: defaultBessOp(),
  };
}
