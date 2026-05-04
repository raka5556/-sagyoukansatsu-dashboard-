let _rekapRecords = [];
let _rekapPhotos  = {};

/* ── IK SUMMARY (rekap tabel) ────────────────────────────── */
function _ikSummary(r) {
  const ik = r.ikChecks;
  if (!ik) return '<span style="color:var(--txt3);font-size:10px">—</span>';
  /* Format baru: array of { variant, sheet, result } */
  if (Array.isArray(ik)) {
    if (!ik.length) return '<span style="color:var(--txt3);font-size:10px">—</span>';
    return ik.map(s => {
      const color = s.result === 'N' ? '#fb7185' : s.result === 'O' ? '#34d399' : 'var(--txt3)';
      return `<div style="font-size:10px;line-height:1.5;margin-bottom:3px">
        <div style="color:#93c5fd;font-size:9px">${(s.sheet||'').substring(0,24)}</div>
        <span style="color:${color};font-weight:700">${s.result || '—'}</span>
      </div>`;
    }).join('');
  }
  /* Format lama: { variant, sheet, checks[] } */
  if (!ik.checks || !ik.checks.length) return '<span style="color:var(--txt3);font-size:10px">—</span>';
  const ok = ik.checks.filter(c => c.result === 'O').length;
  const ng = ik.checks.filter(c => c.result === 'N').length;
  const total = ik.checks.length;
  const color = ng > 0 ? '#fb7185' : '#34d399';
  return `<div style="font-size:10px;color:var(--txt2);line-height:1.6">
    <div style="color:var(--txt3);font-size:9px;margin-bottom:2px">${ik.variant ? ik.variant.substring(0,20)+'…' : ''}</div>
    <div style="color:#93c5fd;font-size:9px;margin-bottom:3px">${ik.sheet || ''}</div>
    <span style="color:${color};font-weight:700">OK:${ok} NG:${ng}/${total}</span>
  </div>`;
}

/* ── REKAP DATA ──────────────────────────────────────────── */
async function renderRekap() {
  pageLoader();
  const records = await DB.allFull();

  const stampSrc = 'img/Approved_Foreman.png';

  if (!records.length) {
    document.getElementById('app').innerHTML = `
      <div class="empty"><div class="ei">📋</div><p>Belum ada data observasi.</p></div>`;
    return;
  }

  const sorted = (_rekapRecords = [...records].sort((a,b) => {
    const na = parseInt(a.id?.replace('SK-','') || 0);
    const nb = parseInt(b.id?.replace('SK-','') || 0);
    return na - nb;
  }));

  const total    = sorted.length;
  const tidakAda = sorted.filter(r => r.pilihanTemuan === '1').length;
  const adaTemuan= sorted.filter(r => r.pilihanTemuan !== '1').length;

_rekapPhotos = {};
  const pt = (r, field) => {
    const src = r[field];
    if (!src) return `<div style="color:#555;font-size:10px;border:1px dashed #333;border-radius:4px;padding:4px 6px">Tidak ada foto</div>`;
    const key = r.id + '_' + field;
    _rekapPhotos[key] = src;
    return `<img data-pk="${key}"
      style="width:72px;height:72px;object-fit:cover;border-radius:6px;cursor:pointer;display:block;margin:auto;border:1px solid #333"
      title="Klik untuk perbesar">`;
  };

  const vidBtn = (r) => r.video
    ? `<button class="btn-vid" onclick="openVideoById('${r.id}')">&#x25B6; Play</button>`
    : `<div style="color:var(--txt3);font-size:11px">—</div>`;

  const stamp = (r, field) => r[field]
    ? `<img src="${stampSrc}" class="approval-stamp" title="Disetujui — klik untuk batal"
           onclick="toggleApprove('${r.id}','${field}',false)" alt="Approved">`
    : `<button class="btn-approve" onclick="toggleApprove('${r.id}','${field}',true)">+ Tanda Tangan</button>`;

  const rows = sorted.map((r, i) => {
    const tIdx = parseInt(r.pilihanTemuan) - 1;
    const tLabel = TEMUAN_OPTIONS[tIdx] || '-';
    const tClass = `temuan-badge t${r.pilihanTemuan}`;

    return `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:700;color:#fb923c;white-space:nowrap">${r.id || '-'}</td>
      <td style="white-space:nowrap">${r.pic || '-'}</td>
      <td style="white-space:nowrap">${hari(r.tanggal)}<br><small>${fmtD(r.tanggal)}</small></td>
      <td style="white-space:nowrap;text-align:center;color:#fbbf24;font-weight:600">${r.waktu || '-'}</td>
      <td style="white-space:nowrap">${r.line || '-'}</td>
      <td style="white-space:nowrap;font-weight:600;color:#fbbf24">${r.pos || '-'}</td>
      <td style="max-width:140px;font-size:12px;color:var(--txt2)">${r.namaProses || '-'}</td>
      <td style="text-align:center">${vidBtn(r)}</td>
      <td style="max-width:180px;font-size:11px">${_ikSummary(r)}</td>
      <td style="max-width:160px;font-size:11px"><span class="${tClass}">${tLabel}</span></td>
      <td style="max-width:160px;font-size:12px;color:var(--txt2)">${r.deskripsi || '-'}</td>
      <td style="text-align:center;padding:4px">${pt(r,'fotoBefore')}</td>
      <td style="text-align:center;padding:4px">${pt(r,'fotoAfter')}</td>
      <td class="approval-cell" id="ac-${r.id}-approvedManager">${stamp(r,'approvedManager')}</td>
      <td class="approval-cell" id="ac-${r.id}-approved">${stamp(r,'approved')}</td>
      <td class="approval-cell" id="ac-${r.id}-approvedForeman">${stamp(r,'approvedForeman')}</td>
      <td>
        <button class="btn btn-d btn-sm" onclick="deleteRecord('${r.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('app').innerHTML = `
    <div style="margin-bottom:6px;color:var(--txt3);font-size:12px">
      Sagyoukansatsu Dashboard &middot; 作業観察 &middot; Monitoring Observasi Kerja Harian
    </div>

    <div class="kgrid">
      <div class="kcard kb"><div class="ki">&#x1F4CA;</div><div class="kv">${total}</div><div class="kl">TOTAL INPUT</div></div>
      <div class="kcard kg"><div class="ki">&#x2705;</div><div class="kv">${tidakAda}</div><div class="kl">TIDAK ADA TEMUAN</div></div>
      <div class="kcard kr"><div class="ki">&#x26A0;&#xFE0F;</div><div class="kv">${adaTemuan}</div><div class="kl">ADA TEMUAN</div></div>
    </div>

    <div class="card">
      <div class="ch">
        <h2>&#x1F4CB; Rekap Data Observasi</h2>
        <span class="cloud-tag">&#x2601;&#xFE0F; Cloud</span>
        <button class="btn btn-g btn-sm" style="margin-left:auto" onclick="DB.downloadBackup()">&#x2B07;&#xFE0F; Backup</button>
        <button class="btn btn-g btn-sm" onclick="downloadXLS()">&#x1F4C5; Download XLSX</button>
        <button class="btn btn-g btn-sm" onclick="downloadPDF()">&#x1F4C4; Download PDF</button>
      </div>
      <div class="twrap">
        <table>
          <thead>
            <tr>
              <th>No</th><th>ID</th><th>Nama PIC</th><th>Tanggal</th>
              <th>Waktu Sagyou</th><th>Line</th><th>Pos</th><th>Nama Proses</th><th>Video</th>
              <th>IK Check</th><th>Pilihan Temuan</th><th>Deskripsi</th>
              <th>Foto Before</th><th>Foto After</th>
              <th>Approved<br>Manager</th>
              <th>Approved<br>Supervisor</th>
              <th>Approved<br>Foreman</th>
              <th>Hapus</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  document.querySelectorAll('[data-pk]').forEach(img => {
    const src = _rekapPhotos[img.dataset.pk];
    if (!src) return;
    const displaySrc = src.startsWith('http')
      ? '/api/serve-photo?key=' + encodeURIComponent(src.replace(/^https?:\/\/[^/]+\//, ''))
      : src;
    img.src = displaySrc;
    img.addEventListener('click', () => lightbox(displaySrc));
  });
}

/* ── TOGGLE APPROVE ──────────────────────────────────────── */
async function toggleApprove(id, field, val) {
  try {
    await DB.upd(id, { [field]: val });
    const cell = document.getElementById(`ac-${id}-${field}`);
    if (cell) cell.innerHTML = val
      ? `<img src="img/Approved_Foreman.png" class="approval-stamp" title="Disetujui — klik untuk batal"
             onclick="toggleApprove('${id}','${field}',false)" alt="Approved">`
      : `<button class="btn-approve" onclick="toggleApprove('${id}','${field}',true)">+ Tanda Tangan</button>`;
    toast(val ? 'Tanda tangan ditambahkan' : 'Tanda tangan dihapus');
  } catch (e) { toast('Gagal: ' + e.message, false); }
}

/* ── DOWNLOAD XLSX ───────────────────────────────────────── */
async function downloadXLS() {
  toast('Menyiapkan file XLSX...', true);
  try {
    const raw = await DB.allFull();
    const sorted = [...raw].sort((a,b) => {
      const na = parseInt(a.id?.replace('SK-','') || 0);
      const nb = parseInt(b.id?.replace('SK-','') || 0);
      return na - nb;
    });
    if (!sorted.length) { toast('Belum ada data', false); return; }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('SK Observasi');

    /* No,ID,PIC,Tanggal,Hari,Waktu,Line,Pos,NamaProses,Video,IKCheck,Temuan,Deskripsi,FotoBefore,FotoAfter,MGR,SPV,FM */
    const COLS = [5,10,16,13,12,10,10,10,20,10,22,28,28,16,16,14,14,14];
    COLS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const HEADERS = ['No','ID','Nama PIC','Tanggal','Hari','Waktu','Line','Pos','Nama Proses','Video',
                     'IK Check',
                     'Pilihan Temuan','Deskripsi',
                     'Foto Before','Foto After',
                     'Appr. Manager','Appr. Supervisor','Appr. Foreman'];
    const hRow = ws.addRow(HEADERS);
    hRow.height = 20;
    hRow.eachCell(cell => {
      cell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF7C2D12' } };
      cell.font      = { color:{ argb:'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical:'middle', horizontal:'center' };
    });

    for (let i = 0; i < sorted.length; i++) {
      const r      = sorted[i];
      const ROW_H  = 72;
      const tLabel = TEMUAN_OPTIONS[parseInt(r.pilihanTemuan) - 1] || '-';

      /* IK Check summary teks */
      let ikText = '—';
      if (Array.isArray(r.ikChecks) && r.ikChecks.length) {
        ikText = r.ikChecks.map(s => `${s.sheet || ''}: ${s.result || '—'}`).join(' | ');
      } else if (r.ikChecks && r.ikChecks.checks && r.ikChecks.checks.length) {
        const ok = r.ikChecks.checks.filter(c => c.result === 'O').length;
        const ng = r.ikChecks.checks.filter(c => c.result === 'N').length;
        ikText = `${r.ikChecks.variant || ''}\n${r.ikChecks.sheet || ''}\nOK:${ok} NG:${ng}/${r.ikChecks.checks.length}`;
      }

      const row = ws.addRow([
        i+1, r.id||'', r.pic||'', r.tanggal||'',
        r.hari||hari(r.tanggal), r.waktu||'', r.line||'', r.pos||'',
        r.namaProses||'',
        r.video && r.video.startsWith('http')
          ? { text: '▶ Lihat Video', hyperlink: r.video }
          : r.video ? 'Ada' : '—',
        ikText,
        tLabel, r.deskripsi||'',
        '', '',  /* foto before & after col 14 & 15 — diisi gambar */
        r.approvedManager ? 'Ya' : 'Tidak',
        r.approved        ? 'Ya' : 'Tidak',
        r.approvedForeman ? 'Ya' : 'Tidak',
      ]);

      row.height = ROW_H;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.alignment = { vertical:'middle', wrapText: true };
      });

      [14, 15].forEach(c => {
        row.getCell(c).alignment = { vertical:'middle', horizontal:'center' };
      });

      const rowIdx = row.number;

      const addImg = async (src, colOneBased) => {
        if (!src) return;
        let base64;
        if (src.startsWith('data:')) {
          base64 = src.replace(/^data:image\/\w+;base64,/, '');
        } else if (src.startsWith('http')) {
          try {
            const fetchSrc = src.startsWith('http')
              ? '/api/serve-photo?key=' + encodeURIComponent(src.replace(/^https?:\/\/[^/]+\//, ''))
              : src;
            const resp = await fetch(fetchSrc);
            const blob = await resp.blob();
            base64 = await new Promise((res, rej) => {
              const fr = new FileReader();
              fr.onerror = rej;
              fr.onload  = e => res(e.target.result.replace(/^data:image\/\w+;base64,/, ''));
              fr.readAsDataURL(blob);
            });
          } catch { return; }
        } else return;
        const imgId = wb.addImage({ base64, extension: 'jpeg' });
        ws.addImage(imgId, {
          tl: { col: colOneBased - 1, row: rowIdx - 1 },
          br: { col: colOneBased,     row: rowIdx     },
          editAs: 'oneCell',
        });
      };

      await addImg(r.fotoBefore, 14);
      await addImg(r.fotoAfter,  15);
    }

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `SK_Observasi_${todayStr()}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
    toast('File XLSX berhasil didownload');
  } catch(e) {
    toast('Gagal buat XLSX: ' + e.message, false);
  }
}

/* ── DOWNLOAD PDF ────────────────────────────────────────── */
async function downloadPDF() {
  toast('Menyiapkan file PDF...', true);
  try {
    const raw = await DB.allFull();
    const sorted = [...raw].sort((a,b) => {
      const na = parseInt(a.id?.replace('SK-','') || 0);
      const nb = parseInt(b.id?.replace('SK-','') || 0);
      return na - nb;
    });
    if (!sorted.length) { toast('Belum ada data', false); return; }

    /* Pre-fetch foto (bisa URL R2 atau base64) sebelum render tabel PDF */
    const _fetchDataUrl = async (src) => {
      if (!src) return null;
      if (src.startsWith('data:')) return src;
      if (!src.startsWith('http')) return null;
      try {
        const resp = await fetch(src);
        const blob = await resp.blob();
        return await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onerror = rej;
          fr.onload  = e => res(e.target.result);
          fr.readAsDataURL(blob);
        });
      } catch { return null; }
    };

    const photoCache = new Map();
    for (const r of sorted) {
      photoCache.set(r.id, {
        before: await _fetchDataUrl(r.fotoBefore),
        after:  await _fetchDataUrl(r.fotoAfter),
      });
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFontSize(13);
    doc.text('Sagyoukansatsu Dashboard — Rekap Observasi Kerja', 14, 14);
    doc.setFontSize(9);
    doc.text(`Dicetak: ${fmtD(todayStr())}`, 14, 20);

    /* kolom foto ada di index 10 dan 11 (0-based) setelah tambah kolom Nama Proses */
    doc.autoTable({
      startY: 25,
      styles:     { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [124, 45, 18], textColor: 255 },
      columnStyles: { 10: { cellWidth: 28 }, 11: { cellWidth: 28 } },
      bodyStyles: { minCellHeight: 26 },
      head: [['No','ID','PIC','Tanggal','Line','Pos','Nama Proses','Video',
              'Temuan','Deskripsi',
              'Foto Before','Foto After',
              'Waktu','Appr. MGR','Appr. SPV','Appr. FM']],
      body: sorted.map((r, i) => {
        const tLabel = TEMUAN_OPTIONS[parseInt(r.pilihanTemuan) - 1] || '-';
        return [
          i+1, r.id, r.pic||'', fmtD(r.tanggal), r.line||'', r.pos||'',
          r.namaProses||'—',
          r.video ? 'Ada' : '—',
          tLabel, r.deskripsi||'',
          '','',
          r.waktu||'—',
          r.approvedManager ? '✓' : '',
          r.approved        ? '✓' : '',
          r.approvedForeman ? '✓' : '',
        ];
      }),
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        const r     = sorted[data.row.index];
        const cache = photoCache.get(r.id) || {};
        const src   = data.column.index === 10 ? cache.before
                    : data.column.index === 11 ? cache.after : null;
        if (!src) return;
        try {
          const p = 1;
          doc.addImage(src, 'JPEG',
            data.cell.x + p, data.cell.y + p,
            data.cell.width - p * 2, data.cell.height - p * 2);
        } catch(e) {}
      },
    });

    doc.save(`SK_Observasi_${todayStr()}.pdf`);
    toast('File PDF berhasil didownload');
  } catch(e) {
    toast('Gagal buat PDF: ' + e.message, false);
  }
}

/* ── DELETE RECORD ───────────────────────────────────────── */
async function deleteRecord(id) {
  if (!confirm(`Hapus data ${id}? Tindakan ini tidak bisa dibatalkan.`)) return;
  try {
    await DB.del(id);
    toast(`Data ${id} dihapus`);
    renderRekap();
    refreshStatus();
  } catch (e) { toast('Gagal hapus: ' + e.message, false); }
}
