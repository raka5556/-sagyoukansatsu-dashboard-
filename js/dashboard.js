let _temuanChart  = null;
let _dashAllRec   = [];
let _dashFilter   = { year: 0, month: 0 };

/* ── FILTER HELPER ───────────────────────────────────────── */
function _filterRecords(records, filter) {
  return records.filter(r => {
    if (!r.tanggal) return !filter.year && !filter.month;
    const [ry, rm] = r.tanggal.split('-');
    if (filter.year  && parseInt(ry) !== filter.year)  return false;
    if (filter.month && parseInt(rm) !== filter.month) return false;
    return true;
  });
}

/* ── DASHBOARD ENTRY ─────────────────────────────────────── */
async function renderDash() {
  pageLoader();
  _dashAllRec = await DB.all();
  _renderDashContent();
}

function applyDashFilter() {
  _dashFilter.year  = parseInt(document.getElementById('df-year')?.value  || 0);
  _dashFilter.month = parseInt(document.getElementById('df-month')?.value || 0);
  _renderDashContent();
}

function _renderDashContent() {
  const records = _filterRecords(_dashAllRec, _dashFilter);

  /* ── Tahun tersedia dari data ────────────────────────────── */
  const years = [...new Set(_dashAllRec.map(r => r.tanggal?.split('-')[0]).filter(Boolean))].sort().reverse();

  /* ── KPI ─────────────────────────────────────────────────── */
  const total     = records.length;
  const tidakAda  = records.filter(r => r.pilihanTemuan === '1').length;
  const adaTemuan = records.filter(r => r.pilihanTemuan !== '1').length;

  /* ── NG IK Stats ─────────────────────────────────────────── */
  const allIk   = records.flatMap(r => Array.isArray(r.ikChecks) ? r.ikChecks : []);
  const totalIk = allIk.length;
  const totalNg = allIk.filter(s => s.result === 'N').length;
  const totalOk = allIk.filter(s => s.result === 'O').length;

  const ngByReason = {};
  allIk.filter(s => s.result === 'N' && s.ngReason).forEach(s => {
    ngByReason[s.ngReason] = (ngByReason[s.ngReason] || 0) + 1;
  });
  const ngReasonEntries = Object.entries(ngByReason).sort((a,b) => b[1]-a[1]);
  const topNg = ngReasonEntries[0] || null;
  const maxNgCount = topNg ? topNg[1] : 1;

  /* ── Breakdown per pilihan temuan ────────────────────────── */
  const temuanCounts = TEMUAN_OPTIONS.map((label, i) => {
    const key = String(i + 1);
    return { key, label, count: records.filter(r => r.pilihanTemuan === key).length };
  });

  /* ── Breakdown per line ──────────────────────────────────── */
  const lineRows = LINES.map(line => {
    const lr = records.filter(r => r.line === line);
    return { line, total: lr.length,
      tidakAda: lr.filter(r => r.pilihanTemuan === '1').length,
      ada:      lr.filter(r => r.pilihanTemuan !== '1').length };
  });

  /* ── Breakdown per pos ───────────────────────────────────── */
  const posRows = POSES.map(pos => {
    const pr = records.filter(r => r.pos === pos);
    return { pos, total: pr.length,
      tidakAda: pr.filter(r => r.pilihanTemuan === '1').length,
      ada:      pr.filter(r => r.pilihanTemuan !== '1').length };
  });

  /* ── Trend per bulan (last 6 bulan dari filter/sekarang) ─── */
  const refDate = (_dashFilter.year && _dashFilter.month)
    ? new Date(_dashFilter.year, _dashFilter.month - 1, 1)
    : new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth() + 1, label: MONTHS[d.getMonth()].slice(0,3) + ' ' + d.getFullYear() });
  }
  const trendData = months.map(({ y, m, label }) => {
    const mr = _dashAllRec.filter(r => {
      if (!r.tanggal) return false;
      const [ry, rm] = r.tanggal.split('-');
      return parseInt(ry) === y && parseInt(rm) === m;
    });
    return { label, total: mr.length,
      tidakAda: mr.filter(r => r.pilihanTemuan === '1').length,
      ada:      mr.filter(r => r.pilihanTemuan !== '1').length };
  });
  const maxTrend = Math.max(...trendData.map(d => d.total), 1);

  const bars = trendData.map(d => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
      <div style="font-size:11px;color:var(--txt3);font-weight:600">${d.total}</div>
      <div style="width:100%;display:flex;flex-direction:column;justify-content:flex-end;height:100px;gap:2px">
        <div style="width:100%;height:${Math.round(d.tidakAda/maxTrend*90)}px;background:linear-gradient(180deg,#10b981,#059669);border-radius:4px 4px 0 0;min-height:${d.tidakAda?'4px':'0'}"></div>
        <div style="width:100%;height:${Math.round(d.ada/maxTrend*90)}px;background:linear-gradient(180deg,#f97316,#ea580c);border-radius:4px 4px 0 0;min-height:${d.ada?'4px':'0'}"></div>
      </div>
      <div style="font-size:10px;color:var(--txt3);text-align:center;line-height:1.3">${d.label}</div>
    </div>`).join('');

  /* ── Table helpers ───────────────────────────────────────── */
  const cell = (val, color) =>
    `<td style="text-align:center;font-weight:700;color:${color||'var(--txt)'}">${val}</td>`;

  const lineTableRows = [
    { label:'Total Input',      key:'total',    color:'var(--txt)' },
    { label:'Tidak Ada Temuan', key:'tidakAda', color:'#34d399' },
    { label:'Ada Temuan',       key:'ada',      color:'#fb923c' },
  ].map(({ label, key, color }) =>
    `<tr><td style="font-weight:600;color:${color};white-space:nowrap">${label}</td>
    ${lineRows.map(lr => cell(lr[key], lr[key]>0?color:'var(--txt3)')).join('')}</tr>`
  ).join('');

  const posTableRows = [
    { label:'Total Input',      key:'total',    color:'var(--txt)' },
    { label:'Tidak Ada Temuan', key:'tidakAda', color:'#34d399' },
    { label:'Ada Temuan',       key:'ada',      color:'#fb923c' },
  ].map(({ label, key, color }) =>
    `<tr><td style="font-weight:600;color:${color};white-space:nowrap">${label}</td>
    ${posRows.map(pr => cell(pr[key], pr[key]>0?color:'var(--txt3)')).join('')}</tr>`
  ).join('');

  /* ── NG IK Reason bars ───────────────────────────────────── */
  const ngReasonBars = totalNg === 0
    ? `<div style="color:var(--txt3);font-size:12px;padding:8px 0">Belum ada data NG IK.</div>`
    : ngReasonEntries.map(([key, count]) => {
        const pct = Math.round(count / maxNgCount * 100);
        const lbl = ngReasonLabel(key);
        return `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
            <span style="color:var(--txt2)">${lbl}</span>
            <span style="color:#fb7185;font-weight:700">${count}</span>
          </div>
          <div style="height:8px;background:#222;border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#f43f5e,#fb7185);border-radius:4px;transition:width .4s"></div>
          </div>
        </div>`;
      }).join('');

  const filterLabel = _dashFilter.year
    ? (_dashFilter.month ? `${MONTHS[_dashFilter.month-1]} ${_dashFilter.year}` : `Tahun ${_dashFilter.year}`)
    : 'Semua Data';

  document.getElementById('app').innerHTML = `
    <div style="margin-bottom:6px;color:var(--txt3);font-size:12px">
      Sagyoukansatsu Dashboard &middot; 作業観察 &middot; Monitoring Observasi Kerja Harian
    </div>

    <!-- FILTER -->
    <div class="card" style="padding:12px 16px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--txt3);font-weight:600">&#x1F4C5; Filter:</span>
        <select id="df-year" onchange="applyDashFilter()" style="padding:5px 10px;font-size:12px;border-radius:6px;background:#1a1a1a;border:1px solid #333;color:var(--txt)">
          <option value="0" ${!_dashFilter.year?'selected':''}>Semua Tahun</option>
          ${years.map(y => `<option value="${y}" ${_dashFilter.year==y?'selected':''}>${y}</option>`).join('')}
        </select>
        <select id="df-month" onchange="applyDashFilter()" style="padding:5px 10px;font-size:12px;border-radius:6px;background:#1a1a1a;border:1px solid #333;color:var(--txt)">
          <option value="0" ${!_dashFilter.month?'selected':''}>Semua Bulan</option>
          ${MONTHS.map((m,i) => `<option value="${i+1}" ${_dashFilter.month==i+1?'selected':''}>${m}</option>`).join('')}
        </select>
        <span style="font-size:12px;color:#fbbf24;font-weight:600">${filterLabel}</span>
        ${(_dashFilter.year||_dashFilter.month) ? `<button onclick="_dashFilter={year:0,month:0};_renderDashContent()" style="padding:4px 10px;font-size:11px;border-radius:6px;background:#333;border:none;color:var(--txt2);cursor:pointer">&#x2715; Reset</button>` : ''}
      </div>
    </div>

    <!-- KPI -->
    <div class="kgrid">
      <div class="kcard kb"><div class="ki">&#x1F4CA;</div><div class="kv">${total}</div><div class="kl">TOTAL INPUT</div></div>
      <div class="kcard kg"><div class="ki">&#x2705;</div><div class="kv">${tidakAda}</div><div class="kl">TIDAK ADA TEMUAN</div></div>
      <div class="kcard ko"><div class="ki">&#x26A0;&#xFE0F;</div><div class="kv">${adaTemuan}</div><div class="kl">ADA TEMUAN</div></div>
    </div>

    <!-- NG IK STATS -->
    ${totalIk > 0 ? `
    <div class="card">
      <div class="ch"><h2>&#x274C; Statistik NG Instruksi Kerja (IK)</h2></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px">
        <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#93c5fd">${totalIk}</div>
          <div style="font-size:10px;color:var(--txt3);margin-top:2px">Proses Dicek</div>
        </div>
        <div style="background:#052e16;border:1px solid #166534;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#34d399">${totalOk}</div>
          <div style="font-size:10px;color:var(--txt3);margin-top:2px">OK</div>
        </div>
        <div style="background:#2d0a0a;border:1px solid #7f1d1d;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#fb7185">${totalNg}</div>
          <div style="font-size:10px;color:var(--txt3);margin-top:2px">NG</div>
        </div>
        ${topNg ? `
        <div style="background:#2d1b00;border:1px solid #92400e;border-radius:10px;padding:14px;text-align:center;grid-column:span 1">
          <div style="font-size:11px;font-weight:700;color:#fbbf24">Terbanyak</div>
          <div style="font-size:12px;color:#fb7185;font-weight:700;margin-top:4px;line-height:1.3">${ngReasonLabel(topNg[0])}</div>
          <div style="font-size:18px;font-weight:800;color:#fbbf24;margin-top:2px">${topNg[1]}x</div>
        </div>` : ''}
      </div>
      ${totalNg > 0 ? `
      <div style="font-size:11px;color:var(--txt3);font-weight:600;margin-bottom:8px">Breakdown Penyebab NG:</div>
      <div style="max-width:500px">${ngReasonBars}</div>` : ''}
    </div>` : ''}

    <!-- Grafik Temuan -->
    <div class="card">
      <div class="ch"><h2>&#x1F4CA; Grafik Pilihan Temuan</h2></div>
      <div style="position:relative;height:260px;padding:4px 0">
        <canvas id="chart-temuan"></canvas>
      </div>
    </div>

    <!-- Breakdown per Temuan -->
    <div class="card">
      <div class="ch"><h2>&#x1F4CC; Breakdown per Pilihan Temuan</h2></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
        ${temuanCounts.map((t, i) => {
          const colors = ['#34d399','#fb923c','#f59e0b','#f43f5e','#a78bfa','#60a5fa'];
          const bgs    = ['#064e3b','#7c2d12','#78350f','#881337','#3b0764','#1e3a5f'];
          const c  = colors[i] || '#94a3b8';
          const bg = bgs[i]   || '#1e293b';
          const pct = total ? Math.round(t.count / total * 100) : 0;
          return `
            <div style="background:${bg}22;border:1px solid ${c}44;border-radius:10px;padding:14px">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                <span style="font-size:11px;font-weight:600;color:${c};line-height:1.4">${t.label}</span>
                <span style="font-size:20px;font-weight:800;color:${c};flex-shrink:0;margin-left:8px">${t.count}</span>
              </div>
              <div class="pbar"><div class="pfill" style="width:${pct}%;background:linear-gradient(90deg,${bg},${c})"></div></div>
              <div style="font-size:11px;color:var(--txt3);margin-top:4px">${pct}% dari total</div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Ringkasan per Line -->
    <div class="card">
      <div class="ch"><h2>&#x1F4CD; Ringkasan per Line</h2></div>
      <div class="twrap">
        <table>
          <thead><tr><th>Kategori</th>${LINES.map(l=>`<th style="text-align:center">${l}</th>`).join('')}</tr></thead>
          <tbody>${lineTableRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Ringkasan per Pos -->
    <div class="card">
      <div class="ch"><h2>&#x1F3AF; Ringkasan per Pos</h2></div>
      <div class="twrap">
        <table>
          <thead><tr><th>Kategori</th>${POSES.map(p=>`<th style="text-align:center">${p}</th>`).join('')}</tr></thead>
          <tbody>${posTableRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Trend bulanan -->
    <div class="card">
      <div class="ch"><h2>&#x1F4C8; Trend Observasi 6 Bulan</h2></div>
      <div style="display:flex;gap:8px;align-items:flex-end;padding:8px 0 4px;min-height:140px">${bars}</div>
      <div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px">
          <div style="width:14px;height:14px;border-radius:3px;background:#10b981"></div> Tidak Ada Temuan
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px">
          <div style="width:14px;height:14px;border-radius:3px;background:#f97316"></div> Ada Temuan
        </div>
      </div>
    </div>`;

  /* ── Chart.js ─────────────────────────────────────────────── */
  if (_temuanChart) { _temuanChart.destroy(); _temuanChart = null; }
  const COLORS  = ['#34d399','#fb923c','#f59e0b','#f43f5e','#a78bfa','#60a5fa'];
  const labels  = temuanCounts.map(t => t.label.replace(/^\d+\.\s*/,''));
  const counts  = temuanCounts.map(t => t.count);
  _temuanChart  = new Chart(
    document.getElementById('chart-temuan').getContext('2d'),
    { type:'bar', data:{ labels, datasets:[{ label:'Jumlah Temuan', data:counts,
        backgroundColor:COLORS.map(c=>c+'55'), borderColor:COLORS,
        borderWidth:2, borderRadius:6, borderSkipped:false }] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false },
          tooltip:{ callbacks:{ title:items=>labels[items[0].dataIndex], label:item=>` ${item.parsed.y} kejadian` } } },
        scales:{
          x:{ ticks:{ color:'#94a3b8', font:{size:10}, maxRotation:25,
              callback(_,i){ const s=labels[i]; return s.length>18?s.slice(0,17)+'…':s; } },
              grid:{ color:'#ffffff0f' } },
          y:{ beginAtZero:true, ticks:{ color:'#94a3b8', stepSize:1, precision:0 },
              grid:{ color:'#ffffff0f' } } } } }
  );
}
