/* ====================================================
   WGF Financial Dashboard — app.js  (v3 — CRUD)
   ==================================================== */

'use strict';
Chart.register(ChartDataLabels);

// ─── Configuração ────────────────────────────────────────────
const CFG = {
  SHEET_ID:   '1p9NxED9vqmhIP8jW6BGzrXxAoOeK3xpZDXJZL-JNU4A',
  SHEET_NAME: 'Base_de_Dados',
  REFRESH_MS:  2 * 60 * 1000,
  PAGE_SIZE:   50,
};
const SALDO_KEY = 'wgf_saldo_atual';

// ▶ PREENCHA aqui a URL gerada após publicar o Apps Script:
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxr4_ltbE6Q5WN43UGGCTeII-rLYVgT-MHU7UnHiJB0JEOUDTio3fiIUUOYcbrGA37T/exec';

// ─── Paleta (tema claro) ─────────────────────────────────────
const C = {
  green:    '#16A34A',
  greenA:   'rgba(22,163,74,0.80)',
  red:      '#DC2626',
  redA:     'rgba(220,38,38,0.80)',
  gold:     '#B07020',
  goldA:    'rgba(176,112,32,0.80)',
  navy:     '#1B3A6B',
  blue:     '#2563EB',
  txtMuted: '#4A6080',
  lbl:      '#0D2348',   // rótulos de dados nos gráficos (escuro p/ fundo claro)
  grid:     'rgba(13,35,72,0.07)',
  macro: [
    'rgba(176,112,32,0.85)', 'rgba(22,163,74,0.80)',
    'rgba(220,38,38,0.75)',  'rgba(37,99,235,0.80)',
    'rgba(124,58,237,0.80)', 'rgba(13,148,136,0.80)',
    'rgba(234,88,12,0.80)',  'rgba(219,39,119,0.80)',
    'rgba(202,138,4,0.80)',  'rgba(71,85,105,0.80)',
  ],
};

// ─── Formatadores ────────────────────────────────────────────
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate  = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
const fmtMonth = d => d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
const capitalize = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const dateToInput = d => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
const fmtK = v => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return 'R$' + (v/1_000_000).toFixed(1).replace('.',',') + 'M';
  if (a >= 1_000)     return 'R$' + (v/1_000).toFixed(0) + 'k';
  return 'R$' + Math.round(v).toLocaleString('pt-BR');
};

// ─── Estado ──────────────────────────────────────────────────
const ST = {
  rawData: [], filteredData: [], tableData: [],
  charts: {}, sortCol: 'date', sortAsc: true,
  page: 1, tblSearch: '',
  saldoAtual: parseFloat(localStorage.getItem(SALDO_KEY)) || 0,
  filters: {
    dateFrom: '', dateTo: '', fluxo: 'all',
    status: new Set(), macrocategoria: new Set(),
    categoria: new Set(), fornecedor: new Set(), metodo: new Set(),
  },
};
let PENDING_DELETE_ID = null;

// ─── Carga de dados ──────────────────────────────────────────
async function loadData() {
  showLoading(true); setBtnSpinning(true);
  try {
    ST.rawData = await fetchSheet();
    populateFilters();
    applyFilters();
    document.getElementById('last-updated').textContent =
      new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    showError(e.message || 'Falha ao carregar dados.');
  } finally {
    showLoading(false); setBtnSpinning(false);
  }
}

async function fetchSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${CFG.SHEET_ID}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(CFG.SHEET_NAME)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erro HTTP ${res.status}. Verifique permissões da planilha.`);
  return parseGviz(await res.text());
}

function parseGviz(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('Resposta inválida da planilha.');
  const json = JSON.parse(text.slice(s, e + 1));
  if (json.status === 'error') throw new Error(json.errors?.[0]?.detailed_message || 'Erro da planilha.');
  const { rows } = json.table || {};
  if (!rows?.length) return [];
  return rows.filter(r => r?.c).map(r => {
    const c = r.c;
    const date = parseGvizDate(c[0]?.v);
    if (!date || isNaN(date)) return null;
    const valor = typeof c[6]?.v === 'number' ? c[6].v : parseFloat(String(c[6]?.v ?? '0').replace(',','.')) || 0;
    return {
      date, dateStr: fmtDate(date),
      monthKey: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,
      monthLabel: capitalize(fmtMonth(date)),
      descricao: gStr(c[1]), fornecedor: gStr(c[2]),
      categoria: gStr(c[3]), metodo: gStr(c[4]),
      fluxo: gStr(c[5]), valor,
      status: gStr(c[7]), macrocategoria: gStr(c[8]),
      id: parseInt(c[9]?.v) || 0,  // coluna J — ID único
    };
  }).filter(Boolean).sort((a,b) => a.date - b.date);
}

function parseGvizDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && v.startsWith('Date(')) {
    const m = v.match(/Date\((\d+),(\d+),(\d+)\)/);
    if (m) return new Date(+m[1], +m[2], +m[3]);
  }
  return null;
}
const gStr = cell => cell?.v != null ? String(cell.v).trim() : '';

// ─── Filtros ─────────────────────────────────────────────────
function populateFilters() {
  const d = ST.rawData;
  const status = new Set(), macros = new Set(), cats = new Set(), fornecs = new Set(), metodos = new Set();
  let minDate = null, maxDate = null;
  for (const r of d) {
    if (r.status) status.add(r.status);
    if (r.macrocategoria) macros.add(r.macrocategoria);
    if (r.categoria) cats.add(r.categoria);
    if (r.fornecedor) fornecs.add(r.fornecedor);
    if (r.metodo) metodos.add(r.metodo);
    if (!minDate || r.date < minDate) minDate = r.date;
    if (!maxDate || r.date > maxDate) maxDate = r.date;
  }
  const dFrom = document.getElementById('date-from');
  const dTo   = document.getElementById('date-to');
  if (minDate && !ST.filters.dateFrom) { const v = `${minDate.getFullYear()}-${String(minDate.getMonth()+1).padStart(2,'0')}`; dFrom.value = v; ST.filters.dateFrom = v; }
  if (maxDate && !ST.filters.dateTo)   { const v = `${maxDate.getFullYear()}-${String(maxDate.getMonth()+1).padStart(2,'0')}`; dTo.value   = v; ST.filters.dateTo   = v; }
  renderCBGroup('status-filter',    [...status].sort(),  ST.filters.status);
  renderCBGroup('macro-filter',     [...macros].sort(),  ST.filters.macrocategoria);
  renderCBGroup('categoria-filter', [...cats].sort(),    ST.filters.categoria);
  renderCBGroup('fornecedor-filter',[...fornecs].sort(), ST.filters.fornecedor);
  renderCBGroup('metodo-filter',    [...metodos].sort(), ST.filters.metodo);
}

function renderCBGroup(id, options, selectedSet) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = options.map(opt => `
    <label class="cb-label ${selectedSet.has(opt)?'active':''}" title="${esc(opt)}">
      <input type="checkbox" value="${esc(opt)}" ${selectedSet.has(opt)?'checked':''} onchange="onCBChange('${id}',this)" />
      <span class="checkmark"></span>
      <span class="cb-text">${esc(opt||'(vazio)')}</span>
    </label>`).join('');
}

function onCBChange(groupId, cb) {
  const map = { 'status-filter':'status','macro-filter':'macrocategoria','categoria-filter':'categoria','fornecedor-filter':'fornecedor','metodo-filter':'metodo' };
  const set = ST.filters[map[groupId]];
  if (!set) return;
  cb.checked ? set.add(cb.value) : set.delete(cb.value);
  cb.closest('.cb-label').classList.toggle('active', cb.checked);
  ST.page = 1; applyFilters();
}

function filterSearch(input, groupId) {
  const t = input.value.toLowerCase();
  document.querySelectorAll(`#${groupId} .cb-label`).forEach(l =>
    l.style.display = l.querySelector('.cb-text').textContent.toLowerCase().includes(t) ? '' : 'none');
}

function setFluxo(val) {
  ST.filters.fluxo = val;
  ['all','Entrada','Saída'].forEach(f => {
    const id = f==='all'?'fluxo-all':f==='Entrada'?'fluxo-entrada':'fluxo-saida';
    document.getElementById(id)?.classList.toggle('active', f===val);
  });
  ST.page = 1; applyFilters();
}

function updateDateFilter() {
  ST.filters.dateFrom = document.getElementById('date-from').value;
  ST.filters.dateTo   = document.getElementById('date-to').value;
  ST.page = 1; applyFilters();
}

function clearAllFilters() {
  const f = ST.filters;
  f.dateFrom=''; f.dateTo=''; f.fluxo='all';
  [f.status, f.macrocategoria, f.categoria, f.fornecedor, f.metodo].forEach(s => s.clear());
  ST.tblSearch=''; ST.page=1;
  document.getElementById('date-from').value='';
  document.getElementById('date-to').value='';
  const ts = document.getElementById('tbl-search'); if (ts) ts.value='';
  setFluxo('all'); populateFilters(); applyFilters();
}

// ─── Motor de filtros ─────────────────────────────────────────
function applyFilters() {
  const f = ST.filters;
  let d = ST.rawData;
  if (f.dateFrom) { const [fy,fm]=f.dateFrom.split('-').map(Number); d=d.filter(r=>{const y=r.date.getFullYear(),m=r.date.getMonth()+1; return y>fy||(y===fy&&m>=fm);}); }
  if (f.dateTo)   { const [ty,tm]=f.dateTo.split('-').map(Number);   d=d.filter(r=>{const y=r.date.getFullYear(),m=r.date.getMonth()+1; return y<ty||(y===ty&&m<=tm);}); }
  if (f.fluxo!=='all')       d=d.filter(r=>r.fluxo===f.fluxo);
  if (f.status.size)         d=d.filter(r=>f.status.has(r.status));
  if (f.macrocategoria.size) d=d.filter(r=>f.macrocategoria.has(r.macrocategoria));
  if (f.categoria.size)      d=d.filter(r=>f.categoria.has(r.categoria));
  if (f.fornecedor.size)     d=d.filter(r=>f.fornecedor.has(r.fornecedor));
  if (f.metodo.size)         d=d.filter(r=>f.metodo.has(r.metodo));
  ST.filteredData = d;
  updateKPIs(); updateCharts(); renderTable();
}

// ─── KPIs ─────────────────────────────────────────────────────
function updateKPIs() {
  const d = ST.filteredData;
  const ent = d.filter(r=>r.fluxo==='Entrada'), sai = d.filter(r=>r.fluxo==='Saída');
  const tRec=ent.reduce((s,r)=>s+r.valor,0), tDesp=sai.reduce((s,r)=>s+r.valor,0), tRes=tRec-tDesp;
  const saldoProj = ST.saldoAtual + tRes;
  set('k-receitas',BRL.format(tRec)); set('k-receitas-n',`${ent.length} lançamento${ent.length!==1?'s':''}`);
  set('k-despesas',BRL.format(tDesp)); set('k-despesas-n',`${sai.length} lançamento${sai.length!==1?'s':''}`);
  set('k-resultado',BRL.format(Math.abs(tRes))); set('k-total',d.length.toLocaleString('pt-BR'));
  const kRes=document.getElementById('k-resultado');
  if (kRes) kRes.style.color = tRes>=0?C.green:C.red;
  set('k-resultado-label',tRes>=0?'↑ Superávit no período':'↓ Déficit no período');
  const kProj=document.getElementById('k-saldo-proj');
  if (kProj){ kProj.textContent=BRL.format(saldoProj); kProj.style.color=saldoProj>=0?C.green:C.red; }
}

function updateSaldoAtual() {
  ST.saldoAtual = parseFloat(document.getElementById('saldo-input')?.value.replace(',','.')) || 0;
  localStorage.setItem(SALDO_KEY, ST.saldoAtual);
  updateKPIs(); buildMonthly();
}

// ─── Gráficos ─────────────────────────────────────────────────
function updateCharts() { buildMonthly(); buildMacro(); buildSuppliers(); buildClients(); buildCategoryPivot(); }

const dlBar = { // rótulos para barras verticais — âncora no topo
  anchor:'end', align:'end',
  formatter: v => v>0?fmtK(v):'',
  color: C.lbl,
  font:{ family:'Inter', size:9, weight:'600' },
};
const dlHbar = { // rótulos para barras horizontais — âncora na extremidade
  anchor:'end', align:'end',
  formatter: v => fmtK(v),
  color: C.lbl,
  font:{ family:'Inter', size:9, weight:'600' },
  clip: false,
};
const tooltip = {
  backgroundColor:'rgba(13,35,72,0.92)',
  titleColor: C.gold, bodyColor:'#E0E8F0',
  borderColor:'rgba(176,112,32,0.30)', borderWidth:1, padding:12,
};

function buildMonthly() {
  const byMonth={};
  for (const r of ST.filteredData) {
    if (!byMonth[r.monthKey]) byMonth[r.monthKey]={label:r.monthLabel,ent:0,sai:0};
    if (r.fluxo==='Entrada') byMonth[r.monthKey].ent+=r.valor;
    else if (r.fluxo==='Saída') byMonth[r.monthKey].sai+=r.valor;
  }
  const sorted=Object.entries(byMonth).sort(([a],[b])=>a.localeCompare(b));
  const labels=sorted.map(([,v])=>capitalize(v.label));
  const ents=sorted.map(([,v])=>v.ent), sais=sorted.map(([,v])=>v.sai);
  let cum=ST.saldoAtual;
  const saldoCum=sorted.map(([,v])=>{cum+=v.ent-v.sai; return cum;});
  destroyChart('monthly');
  const ctx=document.getElementById('c-monthly'); if (!ctx) return;
  ST.charts.monthly=new Chart(ctx,{
    type:'bar',
    data:{ labels, datasets:[
      { label:'Receitas', data:ents, backgroundColor:C.greenA, borderColor:C.green, borderWidth:1, borderRadius:5, order:2, datalabels:dlBar },
      { label:'Despesas', data:sais, backgroundColor:C.redA,   borderColor:C.red,   borderWidth:1, borderRadius:5, order:2, datalabels:dlBar },
      { label:'Saldo Acumulado', data:saldoCum, type:'line',
        borderColor:C.gold, backgroundColor:'rgba(176,112,32,0.07)', borderWidth:2.5,
        pointBackgroundColor:C.gold, pointBorderColor:'#fff', pointBorderWidth:2, pointRadius:5,
        fill:true, tension:0.4, order:1, yAxisID:'y',
        datalabels:{ anchor:'top', align:'top', formatter:fmtK, color:C.gold, font:{family:'Inter',size:9,weight:'700'}, padding:{bottom:4} },
      },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      layout:{ padding:{top:28} },
      plugins:{ legend:{labels:{color:C.txtMuted,font:{family:'Inter',size:11},usePointStyle:true,padding:14}},
        tooltip:{ ...tooltip, callbacks:{label:ctx=>` ${ctx.dataset.label}: ${BRL.format(ctx.raw)}`} },
        datalabels:{display:true},
      },
      scales:{
        x:{ ticks:{color:C.txtMuted,font:{family:'Inter',size:11}}, grid:{color:C.grid} },
        y:{ ticks:{color:C.txtMuted,font:{family:'Inter',size:11},callback:v=>fmtK(v)}, grid:{color:C.grid} },
      },
    },
  });

  // Preencher a Tabela de Dados do Fluxo Mensal
  const tbodyTblMonth = document.getElementById('tbl-monthly-data');
  if (tbodyTblMonth) {
    if (labels.length === 0) {
      tbodyTblMonth.innerHTML = '<tr><td style="text-align:center;padding:20px;color:var(--txt-faint)">Sem dados no período.</td></tr>';
    } else {
      let theadHtml = `<thead><tr><th>Mês</th>${labels.map(l => `<th>${l}</th>`).join('')}</tr></thead>`;
      let entHtml = `<tr><td>Entradas (Receitas)</td>${ents.map(v => `<td class="val-pos">${BRL.format(v)}</td>`).join('')}</tr>`;
      let saiHtml = `<tr><td>Saídas (Despesas)</td>${sais.map(v => `<td class="val-neg">${BRL.format(v)}</td>`).join('')}</tr>`;
      let resHtml = `<tr><td>Resultado do Mês</td>${ents.map((v, i) => { const r = v - sais[i]; return `<td class="${r >= 0 ? 'val-pos' : 'val-neg'}">${BRL.format(r)}</td>`; }).join('')}</tr>`;
      let cumHtml = `<tfoot><tr><td>Saldo Acumulado</td>${saldoCum.map(v => `<td class="${v >= 0 ? 'val-pos' : 'val-neg'}">${BRL.format(v)}</td>`).join('')}</tr></tfoot>`;
      tbodyTblMonth.innerHTML = theadHtml + '<tbody>' + entHtml + saiHtml + resHtml + '</tbody>' + cumHtml;
    }
  }
}

function buildMacro() {
  const saidas=ST.filteredData.filter(r=>r.fluxo==='Saída');
  const byMac={}; for (const r of saidas){ const k=r.macrocategoria||'Sem classificação'; byMac[k]=(byMac[k]||0)+r.valor; }
  const sorted=Object.entries(byMac).sort(([,a],[,b])=>b-a);
  const total=sorted.reduce((s,[,v])=>s+v,0);
  destroyChart('macro');
  const ctx=document.getElementById('c-macro'); if (!ctx) return;
  ST.charts.macro=new Chart(ctx,{
    type:'doughnut',
    data:{ labels:sorted.map(([k])=>k), datasets:[{ data:sorted.map(([,v])=>v),
      backgroundColor:C.macro, borderColor:'#fff', borderWidth:3, hoverOffset:10 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'58%', layout:{padding:20},
      plugins:{
        legend:{position:'bottom',labels:{color:C.txtMuted,font:{family:'Inter',size:10},padding:10,usePointStyle:true,boxWidth:8}},
        tooltip:{...tooltip, callbacks:{label:ctx=>` ${ctx.label}: ${BRL.format(ctx.raw)} (${total>0?((ctx.raw/total)*100).toFixed(1):0}%)`}},
        datalabels:{ display:ctx=>(ctx.dataset.data[ctx.dataIndex]/total)>=0.03,
          formatter:v=>((v/total)*100).toFixed(1)+'%',
          color:'#fff', font:{family:'Inter',size:10,weight:'700'},
          textStrokeColor:'rgba(0,0,0,0.35)', textStrokeWidth:3,
        },
      },
    },
  });
}

function buildSuppliers() {
  const saidas=ST.filteredData.filter(r=>r.fluxo==='Saída');
  const bySup={}; for (const r of saidas){ const k=r.fornecedor||'Vazio'; bySup[k]=(bySup[k]||0)+r.valor; }
  const top10=Object.entries(bySup).sort(([,a],[,b])=>b-a).slice(0,10).reverse();
  destroyChart('suppliers');
  const ctx=document.getElementById('c-suppliers'); if (!ctx) return;
  ST.charts.suppliers=new Chart(ctx,{
    type:'bar',
    data:{ labels:top10.map(([k])=>k.length>22?k.slice(0,22)+'…':k),
      datasets:[{ data:top10.map(([,v])=>v), backgroundColor:C.redA, borderColor:C.red, borderWidth:1, borderRadius:4, datalabels:dlHbar }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, layout:{padding:{right:64}},
      plugins:{ legend:{display:false},
        tooltip:{...tooltip, callbacks:{label:ctx=>` ${BRL.format(ctx.raw)}`, title:items=>top10[items[0].dataIndex]?.[0]||items[0].label}},
        datalabels:{display:true},
      },
      scales:{
        x:{ ticks:{color:C.txtMuted,font:{family:'Inter',size:10},callback:v=>fmtK(v)}, grid:{color:C.grid} },
        y:{ ticks:{color:C.txtMuted,font:{family:'Inter',size:10}}, grid:{display:false} },
      },
    },
  });
}

function buildClients() {
  const entradas=ST.filteredData.filter(r=>r.fluxo==='Entrada');
  const byCli={}; for (const r of entradas){ const k=r.fornecedor||'Vazio'; byCli[k]=(byCli[k]||0)+r.valor; }
  const top10=Object.entries(byCli).sort(([,a],[,b])=>b-a).slice(0,10).reverse();
  destroyChart('clients');
  const ctx=document.getElementById('c-clients'); if (!ctx) return;
  if (!top10.length){ ctx.parentElement.innerHTML='<p style="color:var(--txt-faint);text-align:center;padding:40px">Sem receitas no período</p>'; return; }
  ST.charts.clients=new Chart(ctx,{
    type:'bar',
    data:{ labels:top10.map(([k])=>k.length>22?k.slice(0,22)+'…':k),
      datasets:[{ data:top10.map(([,v])=>v), backgroundColor:C.greenA, borderColor:C.green, borderWidth:1, borderRadius:4, datalabels:dlHbar }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, layout:{padding:{right:64}},
      plugins:{ legend:{display:false},
        tooltip:{...tooltip, callbacks:{label:ctx=>` ${BRL.format(ctx.raw)}`, title:items=>top10[items[0].dataIndex]?.[0]||items[0].label}},
        datalabels:{display:true},
      },
      scales:{
        x:{ ticks:{color:C.txtMuted,font:{family:'Inter',size:10},callback:v=>fmtK(v)}, grid:{color:C.grid} },
        y:{ ticks:{color:C.txtMuted,font:{family:'Inter',size:10}}, grid:{display:false} },
      },
    },
  });
}

function buildCategoryPivot() {
  const saidas = ST.filteredData.filter(r => r.fluxo === 'Saída');
  const tbl = document.getElementById('tbl-category-pivot');
  if (!tbl) return;

  if (!saidas.length) {
    tbl.innerHTML = '<tr><td style="text-align:center;padding:20px;color:var(--txt-faint)">Nenhuma despesa no período selecionado.</td></tr>';
    return;
  }
  
  const monthsSet = new Set();
  for (const r of saidas) monthsSet.add(r.monthKey);
  const monthKeys = [...monthsSet].sort();
  const monthLabels = {};
  for (const r of saidas) { monthLabels[r.monthKey] = capitalize(r.monthLabel); }

  const byCat = {};
  for (const r of saidas) {
    const cat = r.categoria || 'Sem categoria';
    if (!byCat[cat]) { byCat[cat] = { total: 0 }; monthKeys.forEach(m => byCat[cat][m] = 0); }
    byCat[cat][r.monthKey] += r.valor;
    byCat[cat].total += r.valor;
  }

  const sortedCats = Object.keys(byCat).sort((a, b) => byCat[b].total - byCat[a].total);

  const monthTotals = {};
  monthKeys.forEach(m => monthTotals[m] = 0);
  let grandTotal = 0;
  for (const cat of sortedCats) {
    for (const m of monthKeys) { monthTotals[m] += byCat[cat][m]; }
    grandTotal += byCat[cat].total;
  }

  // Encontrar o maior valor individual para a escala do mapa de calor (gradiente)
  let maxVal = 0;
  for (const cat of sortedCats) {
    for (const m of monthKeys) {
      if (byCat[cat][m] > maxVal) maxVal = byCat[cat][m];
    }
  }

  const thead = `<thead><tr>
    <th>Categoria</th>
    ${monthKeys.map(m => `<th>${monthLabels[m]}</th>`).join('')}
  </tr></thead>`;

  const tbody = `<tbody>${sortedCats.map(cat => `<tr>
    <td>${esc(cat)}</td>
    ${monthKeys.map(m => {
      const val = byCat[cat][m];
      if (val === 0) return `<td><span style="color:var(--txt-faint);">-</span></td>`;
      // Calcula a intensidade do gradiente (de 5% a 35% de opacidade na cor vermelha)
      const alpha = maxVal > 0 ? 0.02 + (0.35 * (val / maxVal)) : 0;
      return `<td style="background-color: rgba(220, 38, 38, ${alpha.toFixed(3)})">${BRL.format(val)}</td>`;
    }).join('')}
  </tr>`).join('')}</tbody>`;

  const tfoot = `<tfoot><tr>
    <td>TOTAL DESPESAS</td>
    ${monthKeys.map(m => `<td>${BRL.format(monthTotals[m])}</td>`).join('')}
  </tr></tfoot>`;

  tbl.innerHTML = thead + tbody + tfoot;
}

function destroyChart(key){ if (ST.charts[key]){ ST.charts[key].destroy(); delete ST.charts[key]; } }

// ─── Tabela (6 col + Ações) ──────────────────────────────────
function tableSearchFn(){ ST.tblSearch=document.getElementById('tbl-search')?.value.toLowerCase()||''; ST.page=1; renderTable(); }

function sortTable(col){ ST.sortCol===col?ST.sortAsc=!ST.sortAsc:(ST.sortCol=col,ST.sortAsc=true); renderTable(); }

function renderTable() {
  let d=[...ST.filteredData];
  if (ST.tblSearch){ const t=ST.tblSearch; d=d.filter(r=>r.descricao.toLowerCase().includes(t)||r.fornecedor.toLowerCase().includes(t)||r.categoria.toLowerCase().includes(t)||r.dateStr.includes(t)); }
  const col=ST.sortCol, asc=ST.sortAsc;
  d.sort((a,b)=>{ if(col==='date')return asc?a.date-b.date:b.date-a.date; if(col==='valor')return asc?a.valor-b.valor:b.valor-a.valor; const va=String(a[col]??'').toLowerCase(),vb=String(b[col]??'').toLowerCase(); return asc?va.localeCompare(vb,'pt-BR'):vb.localeCompare(va,'pt-BR'); });
  ST.tableData=d;
  const total=d.length, totalPages=Math.max(1,Math.ceil(total/CFG.PAGE_SIZE));
  if (ST.page>totalPages) ST.page=totalPages;
  const pageData=d.slice((ST.page-1)*CFG.PAGE_SIZE, ST.page*CFG.PAGE_SIZE);
  const tbody=document.getElementById('tbl-body'); if (!tbody) return;
  let curMonth=null; const html=[];
  for (const r of pageData){
    if (r.monthKey!==curMonth){
      curMonth=r.monthKey;
      const mRows=d.filter(x=>x.monthKey===r.monthKey);
      const mEnt=mRows.filter(x=>x.fluxo==='Entrada').reduce((s,x)=>s+x.valor,0);
      const mSai=mRows.filter(x=>x.fluxo==='Saída').reduce((s,x)=>s+x.valor,0);
      const mRes=mEnt-mSai;
      html.push(`<tr class="month-group-row"><td colspan="7"><div class="month-group-header">
        <span class="month-name">${esc(r.monthLabel)}</span>
        <div class="month-summary">
          <span class="ms-receitas">↑ ${BRL.format(mEnt)}</span>
          <span class="ms-despesas">↓ ${BRL.format(mSai)}</span>
          <span class="ms-resultado ${mRes>=0?'positive':'negative'}">${mRes>=0?'▲':'▼'} ${BRL.format(Math.abs(mRes))}</span>
        </div></div></td></tr>`);
    }
    const hasId = r.id > 0;
    const editBtn  = hasId ? `<button class="btn-tbl-edit"  title="Editar"  onclick="openEditModal(${r.id})">✏️</button>` : '';
    const delBtn   = hasId ? `<button class="btn-tbl-del"   title="Excluir" onclick="confirmDelete(${r.id},'${esc(r.descricao)}')">🗑️</button>` : '';
    html.push(`<tr class="data-row ${r.status==='Vencido'?'row-vencido':''} ${r.status==='Pago'?'row-pago':''}">
      <td style="white-space:nowrap">${esc(r.dateStr)}</td>
      <td class="td-descricao" title="${esc(r.descricao)}">${esc(r.descricao)}</td>
      <td class="td-fornecedor" title="${esc(r.fornecedor)}">${esc(r.fornecedor)||'<span style="color:var(--txt-faint);font-style:italic">—</span>'}</td>
      <td>${esc(r.categoria)}</td>
      <td class="td-valor ${r.fluxo==='Entrada'?'valor-entrada':'valor-saida'}">${BRL.format(r.valor)}</td>
      <td><span class="badge-fluxo ${r.fluxo==='Entrada'?'entrada':'saida'}">${esc(r.fluxo)}</span></td>
      <td class="td-actions">${editBtn}${delBtn}${!hasId?'<span title="Sem ID — execute o backfill">⚠️</span>':''}</td>
    </tr>`);
  }
  if (!html.length) html.push(`<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--txt-faint)">Nenhum lançamento encontrado.</td></tr>`);
  tbody.innerHTML=html.join('');
  set('tbl-count',`${total.toLocaleString('pt-BR')} registro${total!==1?'s':''}`);
  set('pg-cur',ST.page); set('pg-tot',totalPages);
  const prev=document.getElementById('btn-prev'), next=document.getElementById('btn-next');
  if (prev) prev.disabled=ST.page<=1;
  if (next) next.disabled=ST.page>=totalPages;
}

function changePage(dir){ const t=Math.max(1,Math.ceil(ST.tableData.length/CFG.PAGE_SIZE)); ST.page=Math.max(1,Math.min(t,ST.page+dir)); renderTable(); }

// ─── Exportar CSV ─────────────────────────────────────────────
function exportCSV(){
  const headers=['Data','Descrição','Fornecedor/Cliente','Categoria','Valor (R$)','Fluxo','Status','Macrocategoria','Método','ID'];
  const rows=ST.tableData.map(r=>[r.dateStr,r.descricao,r.fornecedor,r.categoria,r.valor.toFixed(2).replace('.',','),r.fluxo,r.status,r.macrocategoria,r.metodo,r.id].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';'));
  const csv='\uFEFF'+[headers.join(';'),...rows].join('\r\n');
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),download:`WGF_Financeiro_${new Date().toISOString().slice(0,10)}.csv`});
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ─── CRUD ─────────────────────────────────────────────────────

function populateDatalist(id, options){
  const dl=document.getElementById(id); if (!dl) return;
  dl.innerHTML=options.map(o=>`<option value="${esc(o)}">`).join('');
}

function openAddModal(){
  const cats=[...new Set(ST.rawData.map(r=>r.categoria).filter(Boolean))].sort();
  const forn=[...new Set(ST.rawData.map(r=>r.fornecedor).filter(Boolean))].sort();
  const mets=[...new Set(ST.rawData.map(r=>r.metodo).filter(Boolean))].sort();
  populateDatalist('dl-categorias',cats);
  populateDatalist('dl-fornecedores',forn);
  populateDatalist('dl-metodos',mets);
  document.getElementById('f-id').value='';
  document.getElementById('lancamento-form').reset();
  document.getElementById('form-modal-title').textContent='➕ Novo Lançamento';
  document.getElementById('form-error').classList.add('hidden');
  document.getElementById('form-modal').classList.remove('hidden');
  document.getElementById('f-vencimento').focus();
}

function openEditModal(id){
  const row=ST.filteredData.find(r=>r.id===id)||ST.rawData.find(r=>r.id===id);
  if (!row){ showToast('Lançamento não encontrado.',true); return; }
  const cats=[...new Set(ST.rawData.map(r=>r.categoria).filter(Boolean))].sort();
  const forn=[...new Set(ST.rawData.map(r=>r.fornecedor).filter(Boolean))].sort();
  const mets=[...new Set(ST.rawData.map(r=>r.metodo).filter(Boolean))].sort();
  populateDatalist('dl-categorias',cats);
  populateDatalist('dl-fornecedores',forn);
  populateDatalist('dl-metodos',mets);
  document.getElementById('f-id').value=id;
  document.getElementById('f-vencimento').value=dateToInput(row.date);
  document.getElementById('f-descricao').value=row.descricao;
  document.getElementById('f-fornecedor').value=row.fornecedor;
  document.getElementById('f-categoria').value=row.categoria;
  document.getElementById('f-metodo').value=row.metodo;
  document.getElementById('f-fluxo').value=row.fluxo;
  document.getElementById('f-valor').value=row.valor;
  document.getElementById('f-status').value=row.status||'A vencer';
  document.getElementById('f-senha').value='';
  document.getElementById('form-modal-title').textContent='✏️ Editar Lançamento';
  document.getElementById('form-error').classList.add('hidden');
  document.getElementById('form-modal').classList.remove('hidden');
}

function closeFormModal(){
  document.getElementById('form-modal').classList.add('hidden');
  document.getElementById('lancamento-form').reset();
}

async function submitForm(e){
  e.preventDefault();
  const id=document.getElementById('f-id').value;
  const isEdit=!!id;
  const payload={
    action: isEdit?'edit':'add',
    senha:  document.getElementById('f-senha').value,
    data:{
      id:          isEdit?parseInt(id):undefined,
      vencimento:  document.getElementById('f-vencimento').value,
      descricao:   document.getElementById('f-descricao').value.trim(),
      fornecedor:  document.getElementById('f-fornecedor').value.trim(),
      categoria:   document.getElementById('f-categoria').value.trim(),
      metodo:      document.getElementById('f-metodo').value.trim(),
      fluxo:       document.getElementById('f-fluxo').value,
      valor:       parseFloat(document.getElementById('f-valor').value),
      status:      document.getElementById('f-status').value,
    },
  };
  setFormLoading(true);
  try {
    const res=await callAPI(payload);
    if (!res.ok) throw new Error(res.error||'Erro ao salvar.');
    closeFormModal();
    showToast(isEdit?'Lançamento atualizado!':'Lançamento adicionado!');
    await loadData();
  } catch(err){
    showFormError(err.message);
  } finally { setFormLoading(false); }
}

function confirmDelete(id, desc){
  PENDING_DELETE_ID=id;
  set('delete-desc',`"${desc}" — Esta ação não pode ser desfeita.`);
  document.getElementById('delete-senha').value='';
  document.getElementById('delete-error').classList.add('hidden');
  document.getElementById('delete-modal').classList.remove('hidden');
  document.getElementById('delete-senha').focus();
}

function closeDeleteModal(){ document.getElementById('delete-modal').classList.add('hidden'); PENDING_DELETE_ID=null; }

async function executeDelete(){
  const senha=document.getElementById('delete-senha').value;
  if (!senha){ document.getElementById('delete-error').textContent='Digite a senha.'; document.getElementById('delete-error').classList.remove('hidden'); return; }
  document.getElementById('btn-confirm-delete').disabled=true;
  document.getElementById('btn-confirm-delete').textContent='Excluindo…';
  try {
    const res=await callAPI({ action:'delete', senha, id:PENDING_DELETE_ID });
    if (!res.ok) throw new Error(res.error||'Erro ao excluir.');
    closeDeleteModal();
    showToast('Lançamento excluído.');
    await loadData();
  } catch(err){
    document.getElementById('delete-error').textContent=err.message;
    document.getElementById('delete-error').classList.remove('hidden');
  } finally {
    document.getElementById('btn-confirm-delete').disabled=false;
    document.getElementById('btn-confirm-delete').textContent='🗑️ Excluir';
  }
}

async function callAPI(payload){
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('COLE_AQUI')){
    throw new Error('Apps Script não configurado. Cole a URL do Web App no início do arquivo app.js.');
  }
  const res=await fetch(APPS_SCRIPT_URL,{
    method:'POST',
    headers:{'Content-Type':'text/plain'},
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
  return res.json();
}

// ─── UI helpers ───────────────────────────────────────────────
function toggleSidebar(){ document.getElementById('sidebar')?.classList.toggle('open'); }
function toggleFg(id){ const fg=document.getElementById(id); if (!fg) return; fg.classList.toggle('open'); fg.querySelector('.fg-body')?.classList.toggle('collapsed'); }
function showLoading(on){ document.getElementById('loading-overlay')?.classList.toggle('hidden',!on); }
function setBtnSpinning(on){ document.getElementById('refresh-btn')?.classList.toggle('spinning',on); }
function showError(msg){ set('error-message',msg); document.getElementById('error-modal')?.classList.remove('hidden'); }
function retryLoad(){ document.getElementById('error-modal')?.classList.add('hidden'); loadData(); }
function set(id,val){ const el=document.getElementById(id); if (el) el.textContent=val; }
function setFormLoading(on){
  const btn=document.getElementById('btn-submit-form'), lbl=document.getElementById('btn-submit-label');
  if (btn) btn.disabled=on;
  if (lbl) lbl.textContent=on?'Salvando…':'💾 Salvar';
}
function showFormError(msg){ const el=document.getElementById('form-error'); if (!el) return; el.textContent=msg; el.classList.remove('hidden'); }

function showToast(msg, isError=false){
  const t=document.getElementById('toast'), m=document.getElementById('toast-msg');
  if (!t||!m) return;
  m.textContent=msg;
  t.className=`toast ${isError?'toast-error':'toast-success'}`;
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>{ t.className='toast hidden'; },3500);
}

// ─── Bootstrap ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded',()=>{
  const saved=localStorage.getItem(SALDO_KEY);
  if (saved!==null){ ST.saldoAtual=parseFloat(saved)||0; const inp=document.getElementById('saldo-input'); if (inp) inp.value=ST.saldoAtual||''; }
  document.addEventListener('click',e=>{
    const sb=document.getElementById('sidebar'), btn=document.getElementById('menu-btn');
    if (sb?.classList.contains('open')&&!sb.contains(e.target)&&e.target!==btn&&!btn?.contains(e.target)) sb.classList.remove('open');
  });
  // Fechar modais ao clicar no backdrop
  ['form-modal','delete-modal'].forEach(id=>{
    document.getElementById(id)?.addEventListener('click',e=>{ if (e.target.id===id){ if (id==='form-modal') closeFormModal(); else closeDeleteModal(); } });
  });
  loadData();
  setInterval(loadData, CFG.REFRESH_MS);
});
