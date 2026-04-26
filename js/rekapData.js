let _rekapRecords = [];

/* ── REKAP DATA ──────────────────────────────────────────── */
async function renderRekap() {
  pageLoader();
  const records = await DB.all();

  const stampSrc = 'img/Approved.png';

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

  const pt = (src, lbl) => src
    ? `<img class="pt" src="${src}" alt="${lbl}" title="${lbl}"
           onclick="lightbox('${src.replace(/'/g,"\\'")}')">`
    : `<div class="np" title="${lbl}">&#x1F4F7;</div>`;

  const vidBtn = (src) => src
    ? `<button class="btn-vid" onclick="openVideoModal('${src.replace(/'/g,"\\'")}')">&#x25B6; Play</button>`
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
      <td style="white-space:nowrap">${r.line || '-'}</td>
      <td style="white-space:nowrap;font-weight:600;color:#fbbf24">${r.pos || '-'}</td>
      <td style="text-align:center">${vidBtn(r.video)}</td>
      <td style="max-width:160px;font-size:11px"><span class="${tClass}">${tLabel}</span></td>
      <td style="max-width:160px;font-size:12px;color:var(--txt2)">${r.deskripsi || '-'}</td>
      <td style="text-align:center">${pt(r.fotoBefore,'Before')}</td>
      <td style="text-align:center">${pt(r.fotoAfter,'After')}</td>
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
              <th>Line</th><th>Pos</th><th>Video</th>
              <th>Pilihan Temuan</th><th>Deskripsi</th>
              <th>Foto Before</th><th>Foto After</th>
              <th>Approved<br>Supervisor</th>
              <th>Approved<br>Foreman</th>
              <th>Hapus</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ── TOGGLE APPROVE ──────────────────────────────────────── */
async function toggleApprove(id, field, val) {
  try {
    await DB.upd(id, { [field]: val });
    const cell = document.getElementById(`ac-${id}-${field}`);
    if (cell) cell.innerHTML = val
      ? `<img src="img/Approved.png" class="approval-stamp" title="Disetujui — klik untuk batal"
             onclick="toggleApprove('${id}','${field}',false)" alt="Approved">`
      : `<button class="btn-approve" onclick="toggleApprove('${id}','${field}',true)">+ Tanda Tangan</button>`;
    toast(val ? 'Tanda tangan ditambahkan' : 'Tanda tangan dihapus');
  } catch (e) { toast('Gagal: ' + e.message, false); }
}

/* ── DOWNLOAD XLSX ───────────────────────────────────────── */
async function downloadXLS() {
  if (!_rekapRecords.length) { toast('Belum ada data', false); return; }
  toast('Menyiapkan file XLSX...', true);

  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('SK Observasi');

    const COLS = [5,10,16,13,12,10,10,28,28,16,16,14,14];
    COLS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const HEADERS = ['No','ID','Nama PIC','Tanggal','Hari','Line','Pos',
                     'Pilihan Temuan','Deskripsi',
                     'Foto Before','Foto After',
                     'Appr. Supervisor','Appr. Foreman'];
    const hRow = ws.addRow(HEADERS);
    hRow.height = 20;
    hRow.eachCell(cell => {
      cell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF7C2D12' } };
      cell.font      = { color:{ argb:'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical:'middle', horizontal:'center' };
    });

    for (let i = 0; i < _rekapRecords.length; i++) {
      const r      = _rekapRecords[i];
      const ROW_H  = 72;
      const tLabel = TEMUAN_OPTIONS[parseInt(r.pilihanTemuan) - 1] || '-';

      const row = ws.addRow([
        i+1, r.id||'', r.pic||'', r.tanggal||'',
        r.hari||hari(r.tanggal), r.line||'', r.pos||'',
        tLabel, r.deskripsi||'',
        '', '',  /* foto before & after — diisi gambar */
        r.approved        ? 'Ya' : 'Tidak',
        r.approvedForeman ? 'Ya' : 'Tidak',
      ]);

      row.height = ROW_H;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.alignment = { vertical:'middle', wrapText: true };
      });

      [10, 11].forEach(c => {
        row.getCell(c).alignment = { vertical:'middle', horizontal:'center' };
      });

      const rowIdx = row.number;

      const addImg = (src, colOneBased) => {
        if (!src) return;
        const base64 = src.replace(/^data:image\/\w+;base64,/, '');
        const imgId  = wb.addImage({ base64, extension: 'jpeg' });
        ws.addImage(imgId, {
          tl: { col: colOneBased - 1, row: rowIdx - 1 },
          br: { col: colOneBased,     row: rowIdx     },
          editAs: 'oneCell',
        });
      };

      addImg(r.fotoBefore, 10);
      addImg(r.fotoAfter,  11);
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
function downloadPDF() {
  if (!_rekapRecords.length) { toast('Belum ada data', false); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(13);
  doc.text('Sagyoukansatsu Dashboard — Rekap Observasi Kerja', 14, 14);
  doc.setFontSize(9);
  doc.text(`Dicetak: ${fmtD(todayStr())}`, 14, 20);

  doc.autoTable({
    startY: 25,
    styles:     { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [124, 45, 18], textColor: 255 },
    columnStyles: { 9: { cellWidth: 28 }, 10: { cellWidth: 28 } },
    bodyStyles: { minCellHeight: 26 },
    head: [['No','ID','PIC','Tanggal','Line','Pos',
            'Temuan','Deskripsi',
            'Foto Before','Foto After',
            'Appr. SPV','Appr. FM']],
    body: _rekapRecords.map((r, i) => {
      const tLabel = TEMUAN_OPTIONS[parseInt(r.pilihanTemuan) - 1] || '-';
      return [
        i+1, r.id, r.pic||'', fmtD(r.tanggal), r.line||'', r.pos||'',
        tLabel, r.deskripsi||'',
        '','',
        r.approved        ? '✓' : '',
        r.approvedForeman ? '✓' : '',
      ];
    }),
    didDrawCell: (data) => {
      if (data.section !== 'body') return;
      const r   = _rekapRecords[data.row.index];
      const src = data.column.index === 8 ? r.fotoBefore
                : data.column.index === 9 ? r.fotoAfter : null;
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
