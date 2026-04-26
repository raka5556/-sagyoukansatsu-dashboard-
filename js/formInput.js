/* ── RENDER FORM ─────────────────────────────────────────── */
function renderForm() {
  document.getElementById('app').innerHTML = `
  <form id="sk-form" onsubmit="return false">

    <!-- BAGIAN 1: INFORMASI UMUM -->
    <div class="card">
      <div class="ch">
        <span class="sec-lbl s1">Bagian 1</span>
        <h2>Informasi Umum</h2>
      </div>
      <div class="fgrid">
        <div class="fg">
          <label>Nama PIC *</label>
          <select id="f-pic" required>
            <option value="">-- Pilih PIC --</option>
            ${PICS.map(p => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>
        <div class="fg">
          <label>Tanggal *</label>
          <input type="date" id="f-tgl" required>
        </div>
      </div>
    </div>

    <!-- BAGIAN 2: LINE & POS -->
    <div class="card">
      <div class="ch">
        <span class="sec-lbl s2">Bagian 2</span>
        <h2>Line &amp; Pos</h2>
      </div>
      <div class="fgrid">
        <div class="fg">
          <label>Line *</label>
          <select id="f-line" required>
            <option value="">-- Pilih Line --</option>
            ${LINES.map(l => `<option value="${l}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="fg full">
          <label>Pos *</label>
          <div class="pos-grid" id="pos-grid">
            ${POSES.map(p => `
              <button type="button" class="pos-btn" data-pos="${p}" onclick="selectPos('${p}')">
                ${p}
              </button>`).join('')}
          </div>
          <input type="hidden" id="f-pos">
        </div>
      </div>
    </div>

    <!-- BAGIAN 3: VIDEO & TEMUAN -->
    <div class="card">
      <div class="ch">
        <span class="sec-lbl s3">Bagian 3</span>
        <h2>&#x1F3AC; Video &amp; Temuan</h2>
      </div>
      <div class="fgrid">

        <div class="fg full">
          <label>Upload Video Observasi</label>
          <div class="fwrap-vid" id="fw-video">
            <div class="fi" id="fi-video">&#x1F3AC;</div>
            <div class="ft" id="ft-video">
              Klik atau tap untuk pilih video dari galeri / kamera HP<br>
              <small style="color:var(--txt3)">MP4 / MOV / WebM &mdash; maks 50 MB</small>
            </div>
            <input type="file" id="f-video" accept="video/*"
                   onchange="handleVideo(this)">
          </div>
          <video id="prev-video" class="prev-vid" controls style="display:none"></video>
        </div>

        <div class="fg full">
          <label>Pilihan Temuan *</label>
          <div class="temuan-grid" id="temuan-grid">
            ${TEMUAN_OPTIONS.map((t, i) => `
              <button type="button" class="temuan-btn" data-val="${i+1}" onclick="selectTemuan(${i+1})">
                <span class="temuan-num">${i+1}</span>
                <span class="temuan-txt">${t.replace(/^\d+\.\s*/,'')}</span>
              </button>`).join('')}
          </div>
          <input type="hidden" id="f-temuan-val">
        </div>

        <div class="fg full">
          <label>Deskripsi Temuan</label>
          <textarea id="f-deskripsi" placeholder="Deskripsi detail temuan observasi kerja..."></textarea>
        </div>

      </div>
    </div>

    <!-- BAGIAN 4: BUKTI PERBAIKAN -->
    <div class="card">
      <div class="ch">
        <span class="sec-lbl s4">Bagian 4</span>
        <h2>&#x1F4F8; Bukti Perbaikan</h2>
      </div>
      <div class="fgrid">

        <div class="fg">
          <label>Foto Before <small style="color:var(--txt3)">(sebelum perbaikan)</small></label>
          <div class="fwrap" id="fw-before">
            <div class="fi" id="fi-before">&#x274C;</div>
            <div class="ft" id="ft-before">
              Klik atau tap untuk pilih foto Before<br>
              <small style="color:var(--txt3)">JPG / PNG &mdash; maks 5 MB</small>
            </div>
            <input type="file" id="f-foto-before" accept="image/*"
                   onchange="handleImg(this,'prev-before','fi-before','ft-before')">
          </div>
          <img id="prev-before" class="prev" alt="">
        </div>

        <div class="fg">
          <label>Foto After <small style="color:var(--txt3)">(sesudah perbaikan)</small></label>
          <div class="fwrap" id="fw-after">
            <div class="fi" id="fi-after">&#x2705;</div>
            <div class="ft" id="ft-after">
              Klik atau tap untuk pilih foto After<br>
              <small style="color:var(--txt3)">JPG / PNG &mdash; maks 5 MB (opsional)</small>
            </div>
            <input type="file" id="f-foto-after" accept="image/*"
                   onchange="handleImg(this,'prev-after','fi-after','ft-after')">
          </div>
          <img id="prev-after" class="prev" alt="">
        </div>

      </div>
    </div>

    <!-- PREVIEW & SUBMIT -->
    <div class="card">
      <div class="ch">
        <span class="sec-lbl s5">Preview Data</span>
        <h2>Konfirmasi sebelum Inject</h2>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button type="button" class="btn btn-p" onclick="showPreviewModal()">&#x1F441; Preview &amp; Inject</button>
        <button type="button" class="btn btn-g btn-sm" onclick="resetFormSK()">&#x21BA; Reset Form</button>
      </div>
    </div>

  </form>`;

  document.getElementById('f-tgl').value = todayStr();
}

/* ── POS SELECTOR ────────────────────────────────────────── */
function selectPos(pos) {
  document.getElementById('f-pos').value = pos;
  document.querySelectorAll('.pos-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.pos === pos);
  });
}

/* ── TEMUAN SELECTOR ─────────────────────────────────────── */
function selectTemuan(val) {
  document.getElementById('f-temuan-val').value = val;
  document.querySelectorAll('.temuan-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.val) === val);
  });
}

/* ── IMAGE HANDLER ───────────────────────────────────────── */
async function handleImg(input, prevId, fiId, ftId) {
  if (!input.files[0]) return;
  const size = input.files[0].size / 1024 / 1024;
  if (size > 5) { toast('Ukuran foto maks 5 MB', false); input.value = ''; return; }
  try {
    const compressed  = await compressImg(input.files[0]);
    input._compressed = compressed;
    const prev = document.getElementById(prevId);
    prev.src = compressed; prev.style.display = 'block';
    document.getElementById(fiId).textContent = '✅';
    document.getElementById(ftId).textContent = input.files[0].name;
  } catch { toast('Gagal memproses foto', false); }
}

/* ── VIDEO HANDLER ───────────────────────────────────────── */
async function handleVideo(input) {
  if (!input.files[0]) return;
  const file = input.files[0];
  const sizeMB = file.size / 1024 / 1024;
  if (sizeMB > 50) {
    toast('Ukuran video maks 50 MB — coba potong video lebih pendek', false);
    input.value = '';
    return;
  }
  try {
    document.getElementById('fi-video').textContent = '⏳';
    document.getElementById('ft-video').textContent = 'Memuat video...';

    const base64 = await readFileAsBase64(file);
    input._videoBase64 = base64;

    const prev = document.getElementById('prev-video');
    prev.src = base64;
    prev.style.display = 'block';

    document.getElementById('fi-video').textContent = '✅';
    document.getElementById('ft-video').textContent =
      file.name + ' (' + sizeMB.toFixed(1) + ' MB)';
    toast('Video berhasil dimuat');
  } catch { toast('Gagal memuat video', false); }
}

/* ── COLLECT DATA ────────────────────────────────────────── */
function _getFormData() {
  const fBefore = document.getElementById('f-foto-before');
  const fAfter  = document.getElementById('f-foto-after');
  const fVideo  = document.getElementById('f-video');
  return {
    pic:           document.getElementById('f-pic').value,
    tanggal:       document.getElementById('f-tgl').value,
    line:          document.getElementById('f-line').value,
    pos:           document.getElementById('f-pos').value,
    pilihanTemuan: document.getElementById('f-temuan-val').value,
    deskripsi:     document.getElementById('f-deskripsi').value.trim(),
    video:         fVideo?._videoBase64   || '',
    fotoBefore:    fBefore?._compressed   || '',
    fotoAfter:     fAfter?._compressed    || '',
  };
}

function _validateForm(d) {
  if (!d.pic)           { toast('Nama PIC wajib dipilih', false);    return false; }
  if (!d.tanggal)       { toast('Tanggal wajib diisi', false);       return false; }
  if (!d.line)          { toast('Line wajib dipilih', false);        return false; }
  if (!d.pos)           { toast('Pos wajib dipilih (klik salah satu tombol Pos)', false); return false; }
  if (!d.pilihanTemuan) { toast('Pilihan Temuan wajib dipilih', false); return false; }
  return true;
}

/* ── PREVIEW MODAL ───────────────────────────────────────── */
function showPreviewModal() {
  const d = _getFormData();
  if (!_validateForm(d)) return;

  const temuanLabel = TEMUAN_OPTIONS[parseInt(d.pilihanTemuan) - 1] || '-';

  const ph = (src, lbl) => src
    ? `<div class="pph"><div class="ppl">${lbl}</div><img src="${src}" alt=""></div>`
    : `<div class="pph"><div class="ppl">${lbl}</div><div class="noph">Tidak ada foto</div></div>`;

  const vidBlock = d.video
    ? `<div class="pph" style="grid-column:1/-1">
         <div class="ppl">&#x1F3AC; Video Observasi</div>
         <video src="${d.video}" controls style="width:100%;border-radius:10px;max-height:200px"></video>
       </div>`
    : `<div class="pph" style="grid-column:1/-1">
         <div class="ppl">&#x1F3AC; Video Observasi</div>
         <div class="noph">Tidak ada video</div>
       </div>`;

  document.getElementById('preview-body').innerHTML = `
    <div class="pgrid">
      <div class="pi"><div class="pl">Nama PIC</div><div class="pv">${d.pic}</div></div>
      <div class="pi"><div class="pl">Tanggal</div><div class="pv">${hari(d.tanggal)}, ${fmtD(d.tanggal)}</div></div>
      <div class="pi"><div class="pl">Line</div><div class="pv">${d.line}</div></div>
      <div class="pi"><div class="pl">Pos</div><div class="pv">${d.pos}</div></div>
      <div class="pi" style="grid-column:1/-1"><div class="pl">Pilihan Temuan</div>
        <div class="pv"><span class="temuan-badge t${d.pilihanTemuan}">${temuanLabel}</span></div>
      </div>
      <div class="pi" style="grid-column:1/-1"><div class="pl">Deskripsi</div>
        <div class="pv">${d.deskripsi || '-'}</div>
      </div>
    </div>
    <div class="pphoto" style="grid-template-columns:1fr">
      ${vidBlock}
    </div>
    <div class="pphoto">
      ${ph(d.fotoBefore,'❌ Foto Before')}
      ${ph(d.fotoAfter,'✅ Foto After')}
    </div>`;

  document.getElementById('ov-preview').className = 'ov on';
}

/* ── SUBMIT / INJECT ─────────────────────────────────────── */
async function doSubmit() {
  const d = _getFormData();
  if (!_validateForm(d)) return;

  const btn = document.querySelector('#ov-preview .btn-s');
  btn.disabled = true; btn.textContent = '⏳ Menyimpan...';

  try {
    await DB.add({
      pic:           d.pic,
      tanggal:       d.tanggal,
      hari:          hari(d.tanggal),
      line:          d.line,
      pos:           d.pos,
      pilihanTemuan: d.pilihanTemuan,
      deskripsi:     d.deskripsi,
      video:         d.video,
      fotoBefore:    d.fotoBefore,
      fotoAfter:     d.fotoAfter,
    });
    toast('Data berhasil disimpan! ✅');
    closeOv('ov-preview');
    resetFormSK();
    refreshStatus();
  } catch (err) {
    toast('Gagal menyimpan: ' + err.message, false);
  } finally {
    btn.disabled = false; btn.textContent = '✓ Inject Data';
  }
}

/* ── RESET FORM ──────────────────────────────────────────── */
function resetFormSK() {
  const frm = document.getElementById('sk-form');
  if (frm) frm.reset();
  document.getElementById('f-tgl').value = todayStr();
  document.getElementById('f-pos').value = '';
  document.getElementById('f-temuan-val').value = '';

  document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.temuan-btn').forEach(b => b.classList.remove('active'));

  [
    ['prev-before','fi-before','ft-before','❌','Klik atau tap untuk pilih foto Before','JPG / PNG — maks 5 MB'],
    ['prev-after','fi-after','ft-after','✅','Klik atau tap untuk pilih foto After','JPG / PNG — maks 5 MB (opsional)'],
  ].forEach(([pid,fiid,ftid,icon,l1,l2]) => {
    const p = document.getElementById(pid); if (p) p.style.display = 'none';
    const fi = document.getElementById(fiid); if (fi) fi.textContent = icon;
    const ft = document.getElementById(ftid);
    if (ft) ft.innerHTML = `${l1}<br><small style="color:var(--txt3)">${l2}</small>`;
  });

  const fBefore = document.getElementById('f-foto-before');
  const fAfter  = document.getElementById('f-foto-after');
  const fVid    = document.getElementById('f-video');
  if (fBefore) fBefore._compressed = '';
  if (fAfter)  fAfter._compressed  = '';
  if (fVid)    fVid._videoBase64   = '';

  const prevVid = document.getElementById('prev-video');
  if (prevVid) { prevVid.src = ''; prevVid.style.display = 'none'; }
  document.getElementById('fi-video').textContent = '🎬';
  document.getElementById('ft-video').innerHTML =
    'Klik atau tap untuk pilih video dari galeri / kamera HP<br>' +
    '<small style="color:var(--txt3)">MP4 / MOV / WebM — maks 50 MB</small>';
}
