/* ============================================================
   ENERGYNEX — SVG CHART HELPERS
   Small, dependency-free chart builders returning raw SVG markup.
   ============================================================ */
const SRC_COLORS = { solar:'var(--c-solar)', wind:'var(--c-wind)', grid:'var(--c-grid)', oa:'var(--c-oa)', gc:'var(--c-gc)', bess:'var(--c-bess)', bessDischarge:'var(--c-bess)', bessCharge:'var(--c-bess)', load:'var(--c-load)', unserved:'var(--bad)', curtail:'#3A4A5A' };
const SRC_LABELS = { solar:'Solar', wind:'Wind', grid:'Grid', oa:'Green OA', gc:'Group Captive', bess:'BESS', bessDischarge:'BESS discharge', bessCharge:'BESS charge', load:'Load', unserved:'Unserved', curtail:'Curtailed' };

function svgEl(tag, attrs, children){
  let s = `<${tag} `;
  for(const k in attrs) s += `${k}="${attrs[k]}" `;
  s += children!=null ? `>${children}</${tag}>` : '/>';
  return s;
}
function niceMax(v){ if(v<=0) return 1; const p=Math.pow(10,Math.floor(Math.log10(v))); const n=v/p; const m = n<=1?1:n<=2?2:n<=5?5:10; return m*p; }

/* Horizontal stacked bar — used for candidate mix + landed cost buildup */
function hStackedBar(segments, width, height){
  const total = segments.reduce((s,x)=>s+Math.max(x.value,0),0) || 1;
  let x=0; let out='';
  segments.forEach(seg=>{
    const w = Math.max(seg.value,0)/total*width;
    if(w>0.3) out += svgEl('rect',{x:x.toFixed(1), y:0, width:w.toFixed(1), height, fill:seg.color, opacity:0.95});
    x+=w;
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${out}</svg>`;
}

/* Vertical grouped/stacked bar chart with axis */
function stackedBarChart(opts){
  const {categories, series, width=640, height=260, unit='', pad={t:14,r:14,b:34,l:46}} = opts;
  const plotW = width-pad.l-pad.r, plotH = height-pad.t-pad.b;
  const totals = categories.map((_,i)=> series.reduce((s,ser)=> s + Math.max(ser.data[i]||0,0), 0));
  const negTotals = categories.map((_,i)=> series.reduce((s,ser)=> s + Math.min(ser.data[i]||0,0), 0));
  const maxV = niceMax(Math.max(...totals,0.001));
  const minV = Math.min(0, ...negTotals);
  const range = maxV-minV;
  const y = v => pad.t + plotH - ((v-minV)/range)*plotH;
  const zeroY = y(0);
  const bw = plotW/categories.length;
  let bars=''; let axis='';
  // gridlines
  const steps=4;
  for(let i=0;i<=steps;i++){
    const v = minV + range*i/steps;
    const yy = y(v);
    axis += svgEl('line',{x1:pad.l,x2:width-pad.r,y1:yy.toFixed(1),y2:yy.toFixed(1),class:'gridLine'});
    axis += svgEl('text',{x:pad.l-6,y:(yy+3).toFixed(1),class:'axisLabel','text-anchor':'end'}, fmt(v,v>100?0:1));
  }
  categories.forEach((cat,i)=>{
    let posY=zeroY, negY=zeroY;
    const cx = pad.l + i*bw + bw*0.15;
    const cw = bw*0.7;
    series.forEach(ser=>{
      const v = ser.data[i]||0;
      if(v>=0){ const yy=y(v); bars += svgEl('rect',{x:cx.toFixed(1),y:yy.toFixed(1),width:cw.toFixed(1),height:(posY-yy).toFixed(1),fill:ser.color,opacity:0.95}); posY=yy; }
      else { const yy=y(v); bars += svgEl('rect',{x:cx.toFixed(1),y:negY.toFixed(1),width:cw.toFixed(1),height:(yy-negY).toFixed(1),fill:ser.color,opacity:0.95}); negY=yy; }
    });
    axis += svgEl('text',{x:(cx+cw/2).toFixed(1),y:height-pad.b+16,class:'axisLabel','text-anchor':'middle'}, cat);
  });
  axis += svgEl('line',{x1:pad.l,x2:width-pad.r,y1:zeroY.toFixed(1),y2:zeroY.toFixed(1),stroke:'var(--line)','stroke-width':1});
  return `<svg viewBox="0 0 ${width} ${height}">${axis}${bars}</svg>`;
}

/* Stacked area chart (hourly dispatch) with a load line overlay and optional SOC line on secondary axis */
function stackedAreaChart(opts){
  const {labels, series, loadLine, socLine, width=900, height=280, pad={t:14,r:44,b:26,l:44}} = opts;
  const n = labels.length;
  const plotW = width-pad.l-pad.r, plotH = height-pad.t-pad.b;
  const posTotals = labels.map((_,i)=> series.reduce((s,ser)=> s+Math.max(ser.data[i]||0,0),0));
  const negTotals = labels.map((_,i)=> series.reduce((s,ser)=> s+Math.min(ser.data[i]||0,0),0));
  const maxV = niceMax(Math.max(...posTotals, ...(loadLine?loadLine:[0]), 0.001));
  const minV = Math.min(0, ...negTotals);
  const range = maxV-minV;
  const y = v => pad.t + plotH - ((v-minV)/range)*plotH;
  const x = i => pad.l + (n<=1?0:(i/(n-1))*plotW);
  const zeroY = y(0);
  let axis='', areas='';
  const steps=4;
  for(let i=0;i<=steps;i++){
    const v = minV+range*i/steps; const yy=y(v);
    axis += svgEl('line',{x1:pad.l,x2:width-pad.r,y1:yy.toFixed(1),y2:yy.toFixed(1),class:'gridLine'});
    axis += svgEl('text',{x:pad.l-6,y:(yy+3).toFixed(1),class:'axisLabel','text-anchor':'end'}, fmt(v,0));
  }
  const xTickEvery = Math.max(1, Math.round(n/12));
  labels.forEach((lb,i)=>{ if(i%xTickEvery===0) axis += svgEl('text',{x:x(i).toFixed(1),y:height-pad.b+15,class:'axisLabel','text-anchor':'middle'}, lb); });
  // stacked positive
  let posAcc = new Array(n).fill(0), negAcc = new Array(n).fill(0);
  series.forEach(ser=>{
    let topPath='M', botPath='';
    const pts=[];
    for(let i=0;i<n;i++){
      const v = ser.data[i]||0;
      let y0,y1v;
      if(v>=0){ y0=posAcc[i]; posAcc[i]+=v; y1v=posAcc[i]; }
      else { y0=negAcc[i]; negAcc[i]+=v; y1v=negAcc[i]; }
      pts.push([x(i), y(y1v), y(y0)]);
    }
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} `;
    for(let i=1;i<n;i++) d += `L ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} `;
    for(let i=n-1;i>=0;i--) d += `L ${pts[i][0].toFixed(1)} ${pts[i][2].toFixed(1)} `;
    d += 'Z';
    areas += svgEl('path',{d, fill:ser.color, opacity:0.88});
  });
  axis += svgEl('line',{x1:pad.l,x2:width-pad.r,y1:zeroY.toFixed(1),y2:zeroY.toFixed(1),stroke:'var(--line)','stroke-width':1});
  let loadPath='';
  if(loadLine){
    let d = `M ${x(0).toFixed(1)} ${y(loadLine[0]).toFixed(1)} `;
    for(let i=1;i<n;i++) d += `L ${x(i).toFixed(1)} ${y(loadLine[i]).toFixed(1)} `;
    loadPath = svgEl('path',{d, fill:'none', stroke:'var(--c-load)','stroke-width':1.6,'stroke-dasharray':'2 3'});
  }
  let socPath='';
  if(socLine){
    const maxSOC=100;
    const ys = v => pad.t + plotH - (v/maxSOC)*plotH;
    let d = `M ${x(0).toFixed(1)} ${ys(socLine[0]).toFixed(1)} `;
    for(let i=1;i<n;i++) d += `L ${x(i).toFixed(1)} ${ys(socLine[i]).toFixed(1)} `;
    socPath = svgEl('path',{d, fill:'none', stroke:'var(--accent)','stroke-width':1.6});
    axis += svgEl('text',{x:width-pad.r+6,y:pad.t+4,class:'axisLabel'}, 'SOC%');
  }
  return `<svg viewBox="0 0 ${width} ${height}">${axis}${areas}${loadPath}${socPath}</svg>`;
}

/* Simple line chart, e.g. DSCR by year */
function lineChart(opts){
  const {labels, lines, width=900, height=240, pad={t:16,r:20,b:26,l:40}, refLine} = opts;
  const n = labels.length;
  const plotW=width-pad.l-pad.r, plotH=height-pad.t-pad.b;
  const allV = lines.flatMap(l=>l.data.filter(v=>isFinite(v)));
  let maxV = niceMax(Math.max(...allV, refLine||0, 0.001));
  let minV = Math.min(0, ...allV);
  const range = (maxV-minV)||1;
  const y = v => pad.t+plotH-((v-minV)/range)*plotH;
  const x = i => pad.l+(n<=1?0:(i/(n-1))*plotW);
  let axis='', paths='';
  for(let i=0;i<=4;i++){ const v=minV+range*i/4; const yy=y(v); axis+=svgEl('line',{x1:pad.l,x2:width-pad.r,y1:yy.toFixed(1),y2:yy.toFixed(1),class:'gridLine'}); axis+=svgEl('text',{x:pad.l-6,y:(yy+3).toFixed(1),class:'axisLabel','text-anchor':'end'},fmt(v,1)); }
  const xTickEvery = Math.max(1, Math.round(n/10));
  labels.forEach((lb,i)=>{ if(i%xTickEvery===0) axis+=svgEl('text',{x:x(i).toFixed(1),y:height-pad.b+15,class:'axisLabel','text-anchor':'middle'},lb); });
  if(refLine!=null){ const yy=y(refLine); axis+=svgEl('line',{x1:pad.l,x2:width-pad.r,y1:yy.toFixed(1),y2:yy.toFixed(1),stroke:'var(--warn)','stroke-width':1,'stroke-dasharray':'4 3'}); }
  lines.forEach(l=>{
    let d=''; let started=false;
    l.data.forEach((v,i)=>{ if(!isFinite(v)) { started=false; return;} d += (started?'L':'M')+` ${x(i).toFixed(1)} ${y(v).toFixed(1)} `; started=true; });
    paths += svgEl('path',{d, fill:'none', stroke:l.color, 'stroke-width':1.8});
  });
  return `<svg viewBox="0 0 ${width} ${height}">${axis}${paths}</svg>`;
}

/* Donut for renewable share etc */
function donut(pct, color, size=86, stroke=9){
  const r=(size-stroke)/2, c=2*Math.PI*r;
  const off = c*(1-clampV(pct,0,100)/100);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>
    <text x="50%" y="53%" text-anchor="middle" font-family="var(--font-mono)" font-size="16" fill="var(--text)">${fmt(pct,0)}%</text>
  </svg>`;
}

/* Single-line energy-flow schematic: sources -> BESS -> Load, with a Grid backup edge.
   Widths encode annual GWh. */
function flowSchematic(ev, width=920, height=300){
  const a = ev.annual;
  const nodes = {
    solar:{x:70,y:40,label:'SOLAR',v:a.solar,color:'var(--c-solar)'},
    wind:{x:70,y:100,label:'WIND',v:a.wind,color:'var(--c-wind)'},
    oa:{x:70,y:160,label:'GREEN OA',v:a.oa,color:'var(--c-oa)'},
    gc:{x:70,y:220,label:'GROUP CAPTIVE',v:a.gc,color:'var(--c-gc)'},
    grid:{x:70,y:280,label:'GRID',v:a.grid,color:'var(--c-grid)'},
    bess:{x:width*0.52,y:150,label:'BESS',v:Math.max(a.bessCharge,a.bessDischarge),color:'var(--c-bess)'},
    load:{x:width-90,y:150,label:'CHARGING LOAD',v:a.demand,color:'var(--c-load)'},
  };
  const maxFlow = Math.max(a.solar,a.wind,a.oa,a.gc,a.grid,a.demand,1);
  const wScale = v => 1.2+(Math.max(v,0)/maxFlow)*9;
  let edges='', labels='';
  const path = (x1,y1,x2,y2)=>`M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`;
  // direct-to-load sources (solar/wind assumed able to feed load directly per priority; oa/gc/grid feed load directly too)
  ['solar','wind','oa','gc','grid'].forEach(k=>{
    const n = nodes[k];
    if(n.v>0.01){
      edges += svgEl('path',{d:path(n.x+46,n.y,nodes.load.x-16,nodes.load.y), class:'flowEdge dash', stroke:n.color, 'stroke-width':wScale(n.v).toFixed(1)});
    }
  });
  // BESS charge/discharge
  if(a.bessCharge>0.01){
    edges += svgEl('path',{d:path(nodes.solar.x+46, nodes.solar.y+8, nodes.bess.x-14, nodes.bess.y-18), class:'flowEdge dash', stroke:'var(--c-bess)', 'stroke-width':wScale(a.bessCharge*0.6).toFixed(1)});
  }
  if(a.bessDischarge>0.01){
    edges += svgEl('path',{d:path(nodes.bess.x+16, nodes.bess.y, nodes.load.x-16, nodes.load.y+20), class:'flowEdge dash', stroke:'var(--c-bess)', 'stroke-width':wScale(a.bessDischarge).toFixed(1)});
  }
  Object.entries(nodes).forEach(([k,n])=>{
    if(k==='bess'){
      labels += `<g class="flowNode"><rect x="${n.x-30}" y="${n.y-20}" width="60" height="40" rx="4" fill="var(--panel-2)" stroke="${n.color}"/>
      <text x="${n.x}" y="${n.y-4}" text-anchor="middle" class="lbl">${n.label}</text>
      <text x="${n.x}" y="${n.y+13}" text-anchor="middle">${fmt(n.v/1000,1)} GWh</text></g>`;
    } else if(k==='load'){
      labels += `<g class="flowNode"><rect x="${n.x-10}" y="${n.y-46}" width="70" height="92" rx="4" fill="var(--panel-2)" stroke="${n.color}"/>
      <text x="${n.x+25}" y="${n.y-30}" text-anchor="middle" class="lbl">${n.label}</text>
      <text x="${n.x+25}" y="${n.y-6}" text-anchor="middle">${fmt(n.v/1000,1)} GWh</text>
      <text x="${n.x+25}" y="${n.y+10}" text-anchor="middle" class="lbl" fill="${a.unserved>0.01?'var(--bad)':'var(--text-faint)'}">unserved</text>
      <text x="${n.x+25}" y="${n.y+24}" text-anchor="middle" fill="${a.unserved>0.01?'var(--bad)':'var(--text-faint)'}">${fmt(a.unserved/1000,2)} GWh</text></g>`;
    } else {
      labels += `<g class="flowNode"><circle cx="${n.x}" cy="${n.y}" r="26" fill="var(--panel-2)" stroke="${n.color}"/>
      <text x="${n.x}" y="${n.y-3}" text-anchor="middle" class="lbl">${n.label}</text>
      <text x="${n.x}" y="${n.y+12}" text-anchor="middle">${fmt(n.v/1000,1)}</text></g>`;
    }
  });
  return `<svg viewBox="0 0 ${width} ${height}">${edges}${labels}</svg>`;
}
