/* ── DASHBOARD ───────────────────────────────────────────── */
async function renderDash() {
  pageLoader();
  const records = await DB.all();

  const total     = records.length;
  const tidakAda  = records.filter(r => r.pilihanTemuan === '1').length;
  const adaTemuan = records.filter(r => r.pilihanTemuan !== '1').length;

  /* ── Breakdown per pilihan temuan ─────────────────────── */
  const temuanCounts = TEMUAN_OPTIONS.map((label, i) => {
    const key = String(i + 1);
    return {
      key,
      label,
      count: records.filter(r => r.pilihanTemuan === key).length,
    };
  });

  /* ── Breakdown per line ────────────────────────────────── */
  const lineRows = LINES.map(line => {
    const lr = records.filter(r => r.line === line);
    return {
      line,
      total:   lr.length,
      tidakAda: lr.filter(r => r.pilihanTemuan === '1').length,
      ada:      lr.filter(r => r.pilihanTemuan !== '1').length,
    };
  });

  /* ── Breakdown per pos ─────────────────────────────────── */
  const posRows = POSES.map(pos => {
    const pr = records.filter(r => r.pos === pos);
    return {
      pos,
      total:   pr.length,
      tidakAda: pr.filter(r => r.pilihanTemuan === '1').length,
      ada:      pr.filter(r => r.pilihanTemuan !== '1').length,
    };
  });

  /* ── Trend per bulan (last 6 bulan) ───────────────────── */
  const now    = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth() + 1, label: MONTHS[d.getMonth()].slice(0,3) + ' ' + d.getFullYear() });
  }

  const trendData = months.map(({ y, m, label }) => {
    const mr = records.filter(r => {
      if (!r.tanggal) return false;
      const [ry, rm] = r.tanggal.split('-');
      return parseInt(ry) === y && parseInt(rm) === m;
    });
    return {
      label,
      total:   mr.length,
      tidakAda: mr.filter(r => r.pilihanTemuan === '1').length,
      ada:      mr.filter(r => r.pilihanTemuan !== '1').length,
    };
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

  /* ── Line table helper ─────────────────────────────────── */
  const cell = (val, color) =>
    `<td style="text-align:center;font-weight:700;color:${color || 'var(--txt)'}">${val}</td>`;

  const lineTableRows = [
    { label: 'Total Input',    key: 'total',    color: 'var(--txt)' },
    { label: 'Tidak Ada Temuan', key: 'tidakAda', color: '#34d399' },
    { label: 'Ada Temuan',     key: 'ada',      color: '#fb923c' },
  ].map(({ label, key, color }) =>
    `<tr>
      <td style="font-weight:600;color:${color};white-space:nowrap">${label}</td>
      ${lineRows.map(lr => cell(lr[key], lr[key] > 0 ? color : 'var(--txt3)')).join('')}
    </tr>`
  ).join('');

  /* ── Pos table ─────────────────────────────────────────── */
  const posTableRows = [
    { label: 'Total Input',    key: 'total',    color: 'var(--txt)' },
    { label: 'Tidak Ada Temuan', key: 'tidakAda', color: '#34d399' },
    { label: 'Ada Temuan',     key: 'ada',      color: '#fb923c' },
  ].map(({ label, key, color }) =>
    `<tr>
      <td style="font-weight:600;color:${color};white-space:nowrap">${label}</td>
      ${posRows.map(pr => cell(pr[key], pr[key] > 0 ? color : 'var(--txt3)')).join('')}
    </tr>`
  ).join('');

  document.getElementById('app').innerHTML = `
    <div style="margin-bottom:6px;color:var(--txt3);font-size:12px">
      Sagyoukansatsu Dashboard &middot; 作業観察 &middot; Monitoring Observasi Kerja Harian
    </div>

    <!-- KPI -->
    <div class="kgrid">
      <div class="kcard kb"><div class="ki">&#x1F4CA;</div><div class="kv">${total}</div><div class="kl">TOTAL INPUT</div></div>
      <div class="kcard kg"><div class="ki">&#x2705;</div><div class="kv">${tidakAda}</div><div class="kl">TIDAK ADA TEMUAN</div></div>
      <div class="kcard ko"><div class="ki">&#x26A0;&#xFE0F;</div><div class="kv">${adaTemuan}</div><div class="kl">ADA TEMUAN</div></div>
    </div>

    <!-- Breakdown per Temuan -->
    <div class="card">
      <div class="ch"><h2>&#x1F4CC; Breakdown per Pilihan Temuan</h2></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
        ${temuanCounts.map((t, i) => {
          const colors = ['#34d399','#fb923c','#f59e0b','#f43f5e','#a78bfa','#60a5fa'];
          const bgs    = ['#064e3b','#7c2d12','#78350f','#881337','#3b0764','#1e3a5f'];
          const c = colors[i] || '#94a3b8';
          const bg = bgs[i] || '#1e293b';
          const pct = total ? Math.round(t.count / total * 100) : 0;
          return `
            <div style="background:${bg}22;border:1px solid ${c}44;border-radius:10px;padding:14px">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                <span style="font-size:11px;font-weight:600;color:${c};line-height:1.4">${t.label}</span>
                <span style="font-size:20px;font-weight:800;color:${c};flex-shrink:0;margin-left:8px">${t.count}</span>
              </div>
              <div class="pbar" style="width:100%">
                <div class="pfill" style="width:${pct}%;background:linear-gradient(90deg,${bg},${c})"></div>
              </div>
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
          <thead>
            <tr>
              <th>Kategori</th>
              ${LINES.map(l => `<th style="text-align:center">${l}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${lineTableRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Ringkasan per Pos -->
    <div class="card">
      <div class="ch"><h2>&#x1F3AF; Ringkasan per Pos</h2></div>
      <div class="twrap">
        <table>
          <thead>
            <tr>
              <th>Kategori</th>
              ${POSES.map(p => `<th style="text-align:center">${p}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${posTableRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Trend bulanan -->
    <div class="card">
      <div class="ch"><h2>&#x1F4C8; Trend Observasi 6 Bulan Terakhir</h2></div>
      <div style="display:flex;gap:8px;align-items:flex-end;padding:8px 0 4px;min-height:140px">
        ${bars}
      </div>
      <div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px">
          <div style="width:14px;height:14px;border-radius:3px;background:#10b981"></div> Tidak Ada Temuan
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px">
          <div style="width:14px;height:14px;border-radius:3px;background:#f97316"></div> Ada Temuan
        </div>
      </div>
    </div>`;
}
