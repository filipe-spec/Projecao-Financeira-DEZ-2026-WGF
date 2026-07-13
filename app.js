/* ====================================================
   WGF Financial Dashboard — app.js  (v2)
   Alterações v2:
   - chartjs-plugin-datalabels sempre visível
   - Card "A Vencer/Vencidos" removido
   - Saldo Atual em Caixa (editável, persistido em localStorage)
   - Tabela sem colunas Status, Macrocategoria, Método
   - Top Fornecedores: apenas Saídas, "Vazio" para vazio
   - Novo gráfico TOP CLIENTES (apenas Entradas)
   ==================================================== */

'use strict';

// ─── Registrar plugin de rótulos ─────────────────────────────
Chart.register(ChartDataLabels);

// ─── Config ─────────────────────────────────────────────────
const CFG = {
  SHEET_ID:    '1t1FbQa_YcpAmLnLmWHNZNHa0WLB1b498',
  SHEET_NAME:  'Base_de_Dados',
  REFRESH_MS:  2 * 60 * 1000,
  PAGE_SIZE:   50,
};

const SALDO_KEY = 'wgf_saldo_atual';

// ─── Paleta ──────────────────────────────────────────────────
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
  grid:     'rgba(13,35,72,0.07)',
  macro: [
    'rgba(176,112,32,0.85)',
    'rgba(22,163,74,0.80)',
    'rgba(220,38,38,0.75)',
    'rgba(37,99,235,0.80)',
    'rgba(124,58,237,0.80)',
    'rgba(13,148,136,0.80)',
    'rgba(234,88,12,0.80)',
    'rgba(219,39,119,0.80)',
    'rgba(202,138,4,0.80)',
    'rgba(71,85,105,0.80)',
  ],
};

// ─── Formatadores ────────────────────────────────────────────
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d) =>
  `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
const fmtMonth  = (d) => d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const esc = (s) =>
  String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/** Formato compacto para rótulos de gráfico: R$50k, R$1,2M */
const fmtK = (v) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return 'R$' + (v / 1_000_000).toFixed(1).replace('.',',') + 'M';
  if (abs >= 1_000)     return 'R$' + (v / 1_000).toFixed(0) + 'k';
  return 'R$' + Math.round(v).toLocaleString('pt-BR');
};

// ─── Estado da aplicação ────────────────────────────────────
const ST = {
  rawData:      [],
  filteredData: [],
  tableData:    [],
  charts:       {},
  sortCol:      'date',
  sortAsc:      true,
  page:         1,
  tblSearch:    '',
  saldoAtual:   parseFloat(localStorage.getItem(SALDO_KEY)) || 0,
  filters: {
    dateFrom:       '',
    dateTo:         '',
    fluxo:          'all',
    status:         new Set(),
    macrocategoria: new Set(),
    categoria:      new Set(),
    fornecedor:     new Set(),
    metodo:         new Set(),
  },
};

// ─── Fetch de dados ──────────────────────────────────────────

async function loadData() {
  showLoading(true);
  setBtnSpinning(true);
  try {
    const data = await fetchSheet();
    ST.rawData = data;
    populateFilters();
    applyFilters();
    document.getElementById('last-updated').textContent =
      new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    console.error('[WGF] Erro ao carregar:', e);
    showError(e.message || 'Falha desconhecida ao carregar dados.');
  } finally {
    showLoading(false);
    setBtnSpinning(false);
  }
}

async function fetchSheet() {
  const url = [
    'https://docs.google.com/spreadsheets/d/',
    CFG.SHEET_ID,
    '/gviz/tq?tqx=out:json&headers=1&sheet=',
    encodeURIComponent(CFG.SHEET_NAME),
  ].join('');
  const res = await fetch(url);
  if (!res.ok) throw new Error(
    `Erro HTTP ${res.status}. Certifique-se de que a planilha está compartilhada como "Qualquer pessoa com o link pode visualizar".`
  );
  return parseGviz(await res.text());
}

function parseGviz(text) {
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start === -1 || end === -1)
    throw new Error('Resposta inválida da planilha Google. Verifique as permissões de compartilhamento.');

  const json = JSON.parse(text.slice(start, end + 1));
  if (json.status === 'error') {
    throw new Error(
      json.errors?.[0]?.detailed_message || json.errors?.[0]?.message || 'Erro retornado pela planilha.'
    );
  }

  const { rows } = json.table || {};
  if (!rows?.length) return [];

  const data = [];
  for (const row of rows) {
    if (!row?.c) continue;
    const c = row.c;
    const date = parseGvizDate(c[0]?.v);
    if (!date || isNaN(date.getTime())) continue;

    const valor = typeof c[6]?.v === 'number'
      ? c[6].v
      : parseFloat(String(c[6]?.v ?? '0').replace(',', '.')) || 0;

    data.push({
      date,
      dateStr:        fmtDate(date),
      monthKey:       `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,
      monthLabel:     capitalize(fmtMonth(date)),
      descricao:      gStr(c[1]),
      fornecedor:     gStr(c[2]),
      categoria:      gStr(c[3]),
      metodo:         gStr(c[4]),
      fluxo:          gStr(c[5]),
      valor,
      status:         gStr(c[7]),
      macrocategoria: gStr(c[8]),
    });
  }
  return data.sort((a, b) => a.date - b.date);
}

function parseGvizDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && v.startsWith('Date(')) {
    const m = v.match(/Date\((\d+),(\d+),(\d+)\)/);
    if (m) return new Date(+m[1], +m[2], +m[3]);
  }
  return null;
}

const gStr = (cell) => cell?.v != null ? String(cell.v).trim() : '';

// ─── Filtros ─────────────────────────────────────────────────

function populateFilters() {
  const data = ST.rawData;
  const status = new Set(), macros = new Set(), cats = new Set(),
        fornecs = new Set(), metodos = new Set();
  let minDate = null, maxDate = null;

  for (const r of data) {
    if (r.status)         status.add(r.status);
    if (r.macrocategoria) macros.add(r.macrocategoria);
    if (r.categoria)      cats.add(r.categoria);
    if (r.fornecedor)     fornecs.add(r.fornecedor);
    if (r.metodo)         metodos.add(r.metodo);
    if (!minDate || r.date < minDate) minDate = r.date;
    if (!maxDate || r.date > maxDate) maxDate = r.date;
  }

  const dFrom = document.getElementById('date-from');
  const dTo   = document.getElementById('date-to');
  if (minDate && !ST.filters.dateFrom) {
    const val = `${minDate.getFullYear()}-${String(minDate.getMonth()+1).padStart(2,'0')}`;
    dFrom.value = val; ST.filters.dateFrom = val;
  }
  if (maxDate && !ST.filters.dateTo) {
    const val = `${maxDate.getFullYear()}-${String(maxDate.getMonth()+1).padStart(2,'0')}`;
    dTo.value = val; ST.filters.dateTo = val;
  }

  renderCBGroup('status-filter',    [...status].sort(),  ST.filters.status);
  renderCBGroup('macro-filter',     [...macros].sort(),  ST.filters.macrocategoria);
  renderCBGroup('categoria-filter', [...cats].sort(),    ST.filters.categoria);
  renderCBGroup('fornecedor-filter',[...fornecs].sort(), ST.filters.fornecedor);
  renderCBGroup('metodo-filter',    [...metodos].sort(), ST.filters.metodo);
}

function renderCBGroup(id, options, selectedSet) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = options.map(opt => {
    const isActive = selectedSet.has(opt);
    return `
      <label class="cb-label ${isActive ? 'active' : ''}" title="${esc(opt)}">
        <input type="checkbox" value="${esc(opt)}" ${isActive ? 'checked' : ''}
               onchange="onCBChange('${id}', this)" />
        <span class="checkmark"></span>
        <span class="cb-text">${esc(opt || '(vazio)')}</span>
      </label>`;
  }).join('');
}

function onCBChange(groupId, cb) {
  const map = {
    'status-filter':    'status',
    'macro-filter':     'macrocategoria',
    'categoria-filter': 'categoria',
    'fornecedor-filter':'fornecedor',
    'metodo-filter':    'metodo',
  };
  const key = map[groupId];
  if (!key) return;
  const set = ST.filters[key];
  if (cb.checked) set.add(cb.value); else set.delete(cb.value);
  cb.closest('.cb-label').classList.toggle('active', cb.checked);
  ST.page = 1;
  applyFilters();
}

function filterSearch(input, groupId) {
  const term = input.value.toLowerCase();
  document.querySelectorAll(`#${groupId} .cb-label`).forEach(lbl => {
    lbl.style.display = lbl.querySelector('.cb-text').textContent.toLowerCase().includes(term) ? '' : 'none';
  });
}

function setFluxo(val) {
  ST.filters.fluxo = val;
  ['all','Entrada','Saída'].forEach(f => {
    const id = f === 'all' ? 'fluxo-all' : f === 'Entrada' ? 'fluxo-entrada' : 'fluxo-saida';
    document.getElementById(id)?.classList.toggle('active', f === val);
  });
  ST.page = 1;
  applyFilters();
}

function updateDateFilter() {
  ST.filters.dateFrom = document.getElementById('date-from').value;
  ST.filters.dateTo   = document.getElementById('date-to').value;
  ST.page = 1;
  applyFilters();
}

function clearAllFilters() {
  const f = ST.filters;
  f.dateFrom = ''; f.dateTo = '';
  f.fluxo = 'all';
  f.status.clear(); f.macrocategoria.clear();
  f.categoria.clear(); f.fornecedor.clear(); f.metodo.clear();
  ST.tblSearch = ''; ST.page = 1;
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value   = '';
  const ts = document.getElementById('tbl-search');
  if (ts) ts.value = '';
  setFluxo('all');
  populateFilters();
  applyFilters();
}

// ─── Motor de filtros ─────────────────────────────────────────

function applyFilters() {
  const f = ST.filters;
  let d = ST.rawData;

  if (f.dateFrom) {
    const [fy, fm] = f.dateFrom.split('-').map(Number);
    d = d.filter(r => { const y = r.date.getFullYear(), m = r.date.getMonth()+1; return y > fy || (y===fy && m>=fm); });
  }
  if (f.dateTo) {
    const [ty, tm] = f.dateTo.split('-').map(Number);
    d = d.filter(r => { const y = r.date.getFullYear(), m = r.date.getMonth()+1; return y < ty || (y===ty && m<=tm); });
  }
  if (f.fluxo !== 'all')     d = d.filter(r => r.fluxo === f.fluxo);
  if (f.status.size)         d = d.filter(r => f.status.has(r.status));
  if (f.macrocategoria.size) d = d.filter(r => f.macrocategoria.has(r.macrocategoria));
  if (f.categoria.size)      d = d.filter(r => f.categoria.has(r.categoria));
  if (f.fornecedor.size)     d = d.filter(r => f.fornecedor.has(r.fornecedor));
  if (f.metodo.size)         d = d.filter(r => f.metodo.has(r.metodo));

  ST.filteredData = d;
  updateKPIs();
  updateCharts();
  renderTable();
}

// ─── KPIs ────────────────────────────────────────────────────

function updateKPIs() {
  const d = ST.filteredData;
  const ent  = d.filter(r => r.fluxo === 'Entrada');
  const sai  = d.filter(r => r.fluxo === 'Saída');

  const tRec  = ent.reduce((s,r) => s+r.valor, 0);
  const tDesp = sai.reduce((s,r) => s+r.valor, 0);
  const tRes  = tRec - tDesp;
  const saldoProj = ST.saldoAtual + tRes;

  set('k-receitas',     BRL.format(tRec));
  set('k-receitas-n',   `${ent.length} lançamento${ent.length !== 1 ? 's' : ''}`);
  set('k-despesas',     BRL.format(tDesp));
  set('k-despesas-n',   `${sai.length} lançamento${sai.length !== 1 ? 's' : ''}`);
  set('k-resultado',    BRL.format(Math.abs(tRes)));
  set('k-total',        d.length.toLocaleString('pt-BR'));

  const kRes = document.getElementById('k-resultado');
  if (kRes) kRes.style.color = tRes >= 0 ? C.green : C.red;
  set('k-resultado-label', tRes >= 0 ? '↑ Superávit no período' : '↓ Déficit no período');
  document.getElementById('k-res-icon')?.textContent && (document.getElementById('k-res-icon').textContent = tRes >= 0 ? '↑' : '↓');

  // Saldo projetado (saldo atual + resultado do período)
  const kProj = document.getElementById('k-saldo-proj');
  if (kProj) {
    kProj.textContent = BRL.format(saldoProj);
    kProj.style.color = saldoProj >= 0 ? C.green : C.red;
  }
}

// ─── Saldo Atual ─────────────────────────────────────────────

function updateSaldoAtual() {
  const raw = document.getElementById('saldo-input')?.value ?? '0';
  ST.saldoAtual = parseFloat(raw.replace(',', '.')) || 0;
  localStorage.setItem(SALDO_KEY, ST.saldoAtual);
  updateKPIs();
  buildMonthly(); // Recalcula linha de saldo acumulado
}

// ─── Gráficos ─────────────────────────────────────────────────

function updateCharts() {
  buildMonthly();
  buildMacro();
  buildSuppliers();
  buildClients();
}

// Configuração base de datalabels para barras horizontais
function dlHbar(color) {
  return {
    anchor: 'end',
    align: 'end',
    formatter: (v) => v > 0 ? fmtK(v) : '',
    color: color || '#E8EFF8',
    font: { family: 'Inter', size: 9, weight: '600' },
    clip: false,
  };
}

function buildMonthly() {
  const byMonth = {};
  for (const r of ST.filteredData) {
    if (!byMonth[r.monthKey]) byMonth[r.monthKey] = { label: r.monthLabel, ent: 0, sai: 0 };
    if (r.fluxo === 'Entrada')      byMonth[r.monthKey].ent += r.valor;
    else if (r.fluxo === 'Saída')   byMonth[r.monthKey].sai += r.valor;
  }
  const sorted  = Object.entries(byMonth).sort(([a],[b]) => a.localeCompare(b));
  const labels  = sorted.map(([,v]) => capitalize(v.label));
  const ents    = sorted.map(([,v]) => v.ent);
  const sais    = sorted.map(([,v]) => v.sai);

  // Saldo acumulado = saldo inicial + resultado acumulado mês a mês
  let cum = ST.saldoAtual;
  const saldoCum = sorted.map(([,v]) => { cum += v.ent - v.sai; return cum; });

  destroyChart('monthly');
  const ctx = document.getElementById('c-monthly');
  if (!ctx) return;

  ST.charts.monthly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Receitas',
          data: ents,
          backgroundColor: C.greenA,
          borderColor: C.green,
          borderWidth: 1,
          borderRadius: 5,
          order: 2,
          datalabels: {
            anchor: 'end', align: 'end',
            formatter: (v) => v > 0 ? fmtK(v) : '',
            color: '#E8EFF8',
            font: { family: 'Inter', size: 9, weight: '600' },
          },
        },
        {
          label: 'Despesas',
          data: sais,
          backgroundColor: C.redA,
          borderColor: C.red,
          borderWidth: 1,
          borderRadius: 5,
          order: 2,
          datalabels: {
            anchor: 'end', align: 'end',
            formatter: (v) => v > 0 ? fmtK(v) : '',
            color: '#E8EFF8',
            font: { family: 'Inter', size: 9, weight: '600' },
          },
        },
        {
          label: 'Saldo Acumulado',
          data: saldoCum,
          type: 'line',
          borderColor: C.gold,
          backgroundColor: 'rgba(176,112,32,0.07)',
          borderWidth: 2.5,
          pointBackgroundColor: C.gold,
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2,
          pointRadius: 5,
          fill: true,
          tension: 0.4,
          order: 1,
          yAxisID: 'y',
          datalabels: {
            anchor: 'top', align: 'top',
            formatter: fmtK,
            color: C.gold,
            font: { family: 'Inter', size: 9, weight: '700' },
            padding: { bottom: 4 },
          },
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 28 } },
      plugins: {
        legend: { labels: { color: C.txtMuted, font: { family: 'Inter', size: 11 }, usePointStyle: true, padding: 14 } },
        tooltip: {
          backgroundColor: 'rgba(10,24,40,0.95)',
          titleColor: C.gold,
          bodyColor: '#CBD5E1',
          borderColor: 'rgba(196,151,59,0.3)',
          borderWidth: 1,
          padding: 12,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${BRL.format(ctx.raw)}` },
        },
        datalabels: { display: true },
      },
      scales: {
        x: { ticks: { color: C.txtMuted, font: { family: 'Inter', size: 11 } }, grid: { color: C.grid } },
        y: { ticks: { color: C.txtMuted, font: { family: 'Inter', size: 11 }, callback: v => fmtK(v) }, grid: { color: C.grid } },
      },
    },
  });
}

function buildMacro() {
  const saidas = ST.filteredData.filter(r => r.fluxo === 'Saída');
  const byMac  = {};
  for (const r of saidas) {
    const k = r.macrocategoria || 'Sem classificação';
    byMac[k] = (byMac[k] || 0) + r.valor;
  }
  const sorted = Object.entries(byMac).sort(([,a],[,b]) => b-a);
  const total  = sorted.reduce((s,[,v]) => s+v, 0);

  destroyChart('macro');
  const ctx = document.getElementById('c-macro');
  if (!ctx) return;

  ST.charts.macro = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{
        data: sorted.map(([,v]) => v),
        backgroundColor: C.macro,
        borderColor: '#0A1828',
        borderWidth: 3,
        hoverOffset: 10,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      layout: { padding: 20 },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: C.txtMuted, font: { family: 'Inter', size: 10 }, padding: 10, usePointStyle: true, boxWidth: 8 },
        },
        tooltip: {
          backgroundColor: 'rgba(10,24,40,0.95)',
          titleColor: C.gold,
          bodyColor: '#CBD5E1',
          borderColor: 'rgba(196,151,59,0.3)',
          borderWidth: 1,
          padding: 12,
          callbacks: { label: ctx => ` ${ctx.label}: ${BRL.format(ctx.raw)} (${total > 0 ? ((ctx.raw/total)*100).toFixed(1) : 0}%)` },
        },
        datalabels: {
          display: (ctx) => (ctx.dataset.data[ctx.dataIndex] / total) >= 0.03, // exibe apenas fatias ≥ 3%
          formatter: (v) => ((v/total)*100).toFixed(1) + '%',
          color: '#fff',
          font: { family: 'Inter', size: 10, weight: '700' },
          textStrokeColor: 'rgba(0,0,0,0.4)',
          textStrokeWidth: 3,
        },
      },
    },
  });
}

function buildSuppliers() {
  // Apenas Saídas; fornecedor vazio → "Vazio"
  const saidas = ST.filteredData.filter(r => r.fluxo === 'Saída');
  const bySup  = {};
  for (const r of saidas) {
    const key = r.fornecedor || 'Vazio';
    bySup[key] = (bySup[key] || 0) + r.valor;
  }
  const top10 = Object.entries(bySup).sort(([,a],[,b]) => b-a).slice(0, 10).reverse();

  destroyChart('suppliers');
  const ctx = document.getElementById('c-suppliers');
  if (!ctx) return;

  ST.charts.suppliers = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top10.map(([k]) => k.length > 22 ? k.slice(0,22)+'…' : k),
      datasets: [{
        data: top10.map(([,v]) => v),
        backgroundColor: C.redA,
        borderColor: C.red,
        borderWidth: 1,
        borderRadius: 4,
        datalabels: {
          anchor: 'end', align: 'end',
          formatter: (v) => fmtK(v),
          color: '#E8EFF8',
          font: { family: 'Inter', size: 9, weight: '600' },
          clip: false,
        },
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 60 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,24,40,0.95)',
          titleColor: C.gold,
          bodyColor: '#CBD5E1',
          borderColor: 'rgba(196,151,59,0.3)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: ctx => ` ${BRL.format(ctx.raw)}`,
            title: items => top10[items[0].dataIndex]?.[0] || items[0].label,
          },
        },
        datalabels: { display: true },
      },
      scales: {
        x: { ticks: { color: C.txtMuted, font: { family: 'Inter', size: 10 }, callback: v => fmtK(v) }, grid: { color: C.grid } },
        y: { ticks: { color: C.txtMuted, font: { family: 'Inter', size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function buildClients() {
  // Apenas Entradas; cliente vazio → "Vazio"
  const entradas = ST.filteredData.filter(r => r.fluxo === 'Entrada');
  const byCli    = {};
  for (const r of entradas) {
    const key = r.fornecedor || 'Vazio';
    byCli[key] = (byCli[key] || 0) + r.valor;
  }
  const top10 = Object.entries(byCli).sort(([,a],[,b]) => b-a).slice(0, 10).reverse();

  destroyChart('clients');
  const ctx = document.getElementById('c-clients');
  if (!ctx) return;

  // Sem dados de entrada
  if (!top10.length) {
    ctx.parentElement.innerHTML = '<p style="color:var(--txt-faint);text-align:center;padding:40px">Sem receitas no período selecionado</p>';
    return;
  }

  ST.charts.clients = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top10.map(([k]) => k.length > 22 ? k.slice(0,22)+'…' : k),
      datasets: [{
        data: top10.map(([,v]) => v),
        backgroundColor: C.greenA,
        borderColor: C.green,
        borderWidth: 1,
        borderRadius: 4,
        datalabels: {
          anchor: 'end', align: 'end',
          formatter: (v) => fmtK(v),
          color: '#E8EFF8',
          font: { family: 'Inter', size: 9, weight: '600' },
          clip: false,
        },
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 60 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,24,40,0.95)',
          titleColor: C.gold,
          bodyColor: '#CBD5E1',
          borderColor: 'rgba(196,151,59,0.3)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: ctx => ` ${BRL.format(ctx.raw)}`,
            title: items => top10[items[0].dataIndex]?.[0] || items[0].label,
          },
        },
        datalabels: { display: true },
      },
      scales: {
        x: { ticks: { color: C.txtMuted, font: { family: 'Inter', size: 10 }, callback: v => fmtK(v) }, grid: { color: C.grid } },
        y: { ticks: { color: C.txtMuted, font: { family: 'Inter', size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function destroyChart(key) {
  if (ST.charts[key]) { ST.charts[key].destroy(); delete ST.charts[key]; }
}

// ─── Tabela (6 colunas: sem Status, Macrocategoria, Método) ──

function tableSearchFn() {
  ST.tblSearch = document.getElementById('tbl-search')?.value.toLowerCase() || '';
  ST.page = 1;
  renderTable();
}

function sortTable(col) {
  if (ST.sortCol === col) ST.sortAsc = !ST.sortAsc;
  else { ST.sortCol = col; ST.sortAsc = true; }
  renderTable();
}

function renderTable() {
  let d = [...ST.filteredData];

  if (ST.tblSearch) {
    const t = ST.tblSearch;
    d = d.filter(r =>
      r.descricao.toLowerCase().includes(t)  ||
      r.fornecedor.toLowerCase().includes(t) ||
      r.categoria.toLowerCase().includes(t)  ||
      r.dateStr.includes(t)
    );
  }

  const col = ST.sortCol, asc = ST.sortAsc;
  d.sort((a, b) => {
    if (col === 'date')  return asc ? a.date - b.date : b.date - a.date;
    if (col === 'valor') return asc ? a.valor - b.valor : b.valor - a.valor;
    const va = String(a[col]??'').toLowerCase(), vb = String(b[col]??'').toLowerCase();
    return asc ? va.localeCompare(vb,'pt-BR') : vb.localeCompare(va,'pt-BR');
  });

  ST.tableData = d;

  const total      = d.length;
  const totalPages = Math.max(1, Math.ceil(total / CFG.PAGE_SIZE));
  if (ST.page > totalPages) ST.page = totalPages;
  const start    = (ST.page - 1) * CFG.PAGE_SIZE;
  const pageData = d.slice(start, start + CFG.PAGE_SIZE);

  const tbody = document.getElementById('tbl-body');
  if (!tbody) return;

  let curMonth = null;
  const html   = [];

  for (const r of pageData) {
    if (r.monthKey !== curMonth) {
      curMonth = r.monthKey;
      const mRows = d.filter(x => x.monthKey === r.monthKey);
      const mEnt  = mRows.filter(x => x.fluxo === 'Entrada').reduce((s,x) => s+x.valor, 0);
      const mSai  = mRows.filter(x => x.fluxo === 'Saída').reduce((s,x) => s+x.valor, 0);
      const mRes  = mEnt - mSai;

      html.push(`
        <tr class="month-group-row">
          <td colspan="6">
            <div class="month-group-header">
              <span class="month-name">${esc(r.monthLabel)}</span>
              <div class="month-summary">
                <span class="ms-receitas">↑ ${BRL.format(mEnt)}</span>
                <span class="ms-despesas">↓ ${BRL.format(mSai)}</span>
                <span class="ms-resultado ${mRes>=0?'positive':'negative'}">${mRes>=0?'▲':'▼'} ${BRL.format(Math.abs(mRes))}</span>
              </div>
            </div>
          </td>
        </tr>`);
    }

    const fluxoClass = r.fluxo === 'Entrada' ? 'entrada' : 'saida';
    html.push(`
      <tr class="data-row ${r.status==='Vencido'?'row-vencido':''} ${r.status==='Pago'?'row-pago':''}">
        <td style="white-space:nowrap">${esc(r.dateStr)}</td>
        <td class="td-descricao" title="${esc(r.descricao)}">${esc(r.descricao)}</td>
        <td class="td-fornecedor" title="${esc(r.fornecedor)}">${esc(r.fornecedor) || '<span style="color:var(--txt-faint);font-style:italic">—</span>'}</td>
        <td>${esc(r.categoria)}</td>
        <td class="td-valor ${r.fluxo==='Entrada'?'valor-entrada':'valor-saida'}">${BRL.format(r.valor)}</td>
        <td><span class="badge-fluxo ${fluxoClass}">${esc(r.fluxo)}</span></td>
      </tr>`);
  }

  if (!html.length) {
    html.push(`<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--txt-faint)">Nenhum lançamento encontrado com os filtros selecionados.</td></tr>`);
  }

  tbody.innerHTML = html.join('');
  set('tbl-count', `${total.toLocaleString('pt-BR')} registro${total!==1?'s':''}`);
  set('pg-cur',    ST.page);
  set('pg-tot',    totalPages);
  const prev = document.getElementById('btn-prev'), next = document.getElementById('btn-next');
  if (prev) prev.disabled = ST.page <= 1;
  if (next) next.disabled = ST.page >= totalPages;
}

function changePage(dir) {
  const total = Math.max(1, Math.ceil(ST.tableData.length / CFG.PAGE_SIZE));
  ST.page = Math.max(1, Math.min(total, ST.page + dir));
  renderTable();
}

// ─── Exportar CSV ─────────────────────────────────────────────

function exportCSV() {
  const headers = ['Data','Descrição','Fornecedor/Cliente','Categoria','Valor (R$)','Fluxo','Status','Macrocategoria','Método'];
  const rows = ST.tableData.map(r => [
    r.dateStr, r.descricao, r.fornecedor, r.categoria,
    r.valor.toFixed(2).replace('.',','),
    r.fluxo, r.status, r.macrocategoria, r.metodo,
  ].map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(';'));

  const csv  = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `WGF_Financeiro_${new Date().toISOString().slice(0,10)}.csv`,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── UI ──────────────────────────────────────────────────────

function toggleSidebar() { document.getElementById('sidebar')?.classList.toggle('open'); }

function toggleFg(id) {
  const fg = document.getElementById(id);
  if (!fg) return;
  fg.classList.toggle('open');
  fg.querySelector('.fg-body')?.classList.toggle('collapsed');
}

function showLoading(show) {
  const el = document.getElementById('loading-overlay');
  if (el) show ? el.classList.remove('hidden') : el.classList.add('hidden');
}
function setBtnSpinning(on) { document.getElementById('refresh-btn')?.classList.toggle('spinning', on); }
function showError(msg) {
  const el = document.getElementById('error-message');
  if (el) el.textContent = msg;
  document.getElementById('error-modal')?.classList.remove('hidden');
}
function retryLoad() {
  document.getElementById('error-modal')?.classList.add('hidden');
  loadData();
}
function set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ─── Bootstrap ───────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // Restaurar saldo do localStorage
  const savedSaldo = localStorage.getItem(SALDO_KEY);
  if (savedSaldo !== null) {
    ST.saldoAtual = parseFloat(savedSaldo) || 0;
    const inp = document.getElementById('saldo-input');
    if (inp) inp.value = ST.saldoAtual || '';
  }

  // Fechar sidebar ao clicar fora (mobile)
  document.addEventListener('click', e => {
    const sb  = document.getElementById('sidebar');
    const btn = document.getElementById('menu-btn');
    if (sb?.classList.contains('open') && !sb.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
      sb.classList.remove('open');
    }
  });

  loadData();
  setInterval(loadData, CFG.REFRESH_MS);
});
