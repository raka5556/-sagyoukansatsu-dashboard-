/* ── R2 HELPER ───────────────────────────────────────────── */
let _r2Cache = null;
async function checkR2() {
  if (_r2Cache !== null) return _r2Cache;
  _r2Cache = await fetch('/api/r2-config')
    .then(r => r.json()).then(d => d.enabled).catch(() => false);
  return _r2Cache;
}

async function uploadPhotoToR2(dataUrl, which, meta) {
  const res  = await fetch(dataUrl);
  const blob = await res.blob();
  const ext  = blob.type.includes('png') ? 'png' : 'jpg';
  const { uploadUrl, publicUrl } = await fetch('/api/presign-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'photo', which, ext, contentType: blob.type, meta }),
  }).then(r => r.json());
  const putRes = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } });
  if (!putRes.ok) throw new Error('Upload foto gagal (' + putRes.status + ')');
  return publicUrl;
}

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

          <!-- IK SECTION -->
          <div id="ik-section" style="display:none;margin-top:14px">
            <div class="ik-section-hdr">&#x1F4CB; Instruksi Kerja (IK) &mdash; Cek Kesesuaian</div>
            <div id="ik-slots-container">

              <!-- SLOT 0 -->
              <div id="ik-slot-0">
                <div class="fg" style="margin-bottom:8px">
                  <label style="font-size:12px">Variant Proses</label>
                  <select id="f-ik-variant-0" onchange="onIkVariantChange(0)" style="width:100%" disabled>
                    <option value="">-- Pilih Variant Proses --</option>
                  </select>
                </div>
                <div id="ik-sheet-wrap-0" style="display:none;margin-bottom:8px">
                  <label style="font-size:12px">Nama Proses (Sheet IK)</label>
                  <select id="f-ik-sheet-0" onchange="onIkSheetChange(0)" style="width:100%">
                    <option value="">-- Pilih Nama Proses --</option>
                  </select>
                </div>
                <div id="ik-images-wrap-0" style="display:none;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:8px">
                  <div id="ik-images-loading-0" style="color:var(--txt3);font-size:12px;text-align:center;padding:8px">&#x23F3; Memuat gambar IK...</div>
                  <div id="ik-images-list-0" style="display:flex;flex-direction:column;gap:10px"></div>
                  <div class="ik-step-btns" style="justify-content:center;margin-top:14px;gap:20px">
                    <button type="button" class="ik-btn ik-ok" id="ik-ok-btn-0" onclick="setIkSlotResult(0,'O')">O &nbsp;OK</button>
                    <button type="button" class="ik-btn ik-ng" id="ik-ng-btn-0" onclick="setIkSlotResult(0,'N')">N &nbsp;NG</button>
                  </div>
                  <div id="ik-ng-reason-0" style="display:none;margin-top:12px"></div>
                </div>
              </div>

              <!-- SLOT 1 -->
              <div id="ik-slot-1" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed #444">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                  <div style="font-size:12px;color:#fbbf24;font-weight:700">Proses IK 2</div>
                  <button type="button" class="ik-btn" style="padding:3px 10px;font-size:11px;background:#333;border-radius:6px" onclick="removeIkSlot(1)">&#x2715; Hapus</button>
                </div>
                <div id="ik-variant-info-1" style="font-size:11px;color:var(--txt3);margin-bottom:8px;padding:4px 8px;background:rgba(255,255,255,0.05);border-radius:6px"></div>
                <div style="margin-bottom:8px">
                  <label style="font-size:12px">Nama Proses (Sheet IK)</label>
                  <select id="f-ik-sheet-1" onchange="onIkSheetChange(1)" style="width:100%" disabled>
                    <option value="">-- Pilih Nama Proses --</option>
                  </select>
                </div>
                <div id="ik-images-wrap-1" style="display:none;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:8px">
                  <div id="ik-images-loading-1" style="color:var(--txt3);font-size:12px;text-align:center;padding:8px">&#x23F3; Memuat gambar IK...</div>
                  <div id="ik-images-list-1" style="display:flex;flex-direction:column;gap:10px"></div>
                  <div class="ik-step-btns" style="justify-content:center;margin-top:14px;gap:20px">
                    <button type="button" class="ik-btn ik-ok" id="ik-ok-btn-1" onclick="setIkSlotResult(1,'O')">O &nbsp;OK</button>
                    <button type="button" class="ik-btn ik-ng" id="ik-ng-btn-1" onclick="setIkSlotResult(1,'N')">N &nbsp;NG</button>
                  </div>
                  <div id="ik-ng-reason-1" style="display:none;margin-top:12px"></div>
                </div>
              </div>

              <!-- SLOT 2 -->
              <div id="ik-slot-2" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed #444">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                  <div style="font-size:12px;color:#fbbf24;font-weight:700">Proses IK 3</div>
                  <button type="button" class="ik-btn" style="padding:3px 10px;font-size:11px;background:#333;border-radius:6px" onclick="removeIkSlot(2)">&#x2715; Hapus</button>
                </div>
                <div id="ik-variant-info-2" style="font-size:11px;color:var(--txt3);margin-bottom:8px;padding:4px 8px;background:rgba(255,255,255,0.05);border-radius:6px"></div>
                <div style="margin-bottom:8px">
                  <label style="font-size:12px">Nama Proses (Sheet IK)</label>
                  <select id="f-ik-sheet-2" onchange="onIkSheetChange(2)" style="width:100%" disabled>
                    <option value="">-- Pilih Nama Proses --</option>
                  </select>
                </div>
                <div id="ik-images-wrap-2" style="display:none;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:8px">
                  <div id="ik-images-loading-2" style="color:var(--txt3);font-size:12px;text-align:center;padding:8px">&#x23F3; Memuat gambar IK...</div>
                  <div id="ik-images-list-2" style="display:flex;flex-direction:column;gap:10px"></div>
                  <div class="ik-step-btns" style="justify-content:center;margin-top:14px;gap:20px">
                    <button type="button" class="ik-btn ik-ok" id="ik-ok-btn-2" onclick="setIkSlotResult(2,'O')">O &nbsp;OK</button>
                    <button type="button" class="ik-btn ik-ng" id="ik-ng-btn-2" onclick="setIkSlotResult(2,'N')">N &nbsp;NG</button>
                  </div>
                  <div id="ik-ng-reason-2" style="display:none;margin-top:12px"></div>
                </div>
              </div>

            </div>
            <div id="ik-add-btn-wrap" style="display:none;margin-top:10px;text-align:right">
              <button type="button" class="btn btn-g btn-sm" onclick="addIkSlot()">&#x2795; Tambah Proses IK</button>
            </div>
          </div>
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
              <small style="color:var(--txt3)">MP4 / MOV / WebM</small>
            </div>
            <input type="file" id="f-video" accept="video/*"
                   onchange="handleVideo(this)">
          </div>
          <video id="prev-video" class="prev-vid" controls playsinline style="display:none"></video>
        </div>

        <div class="fg">
          <label>Waktu Sagyou <small style="color:var(--txt3)">(gunakan titik, cth: 101.09)</small></label>
          <input type="text" id="f-waktu" placeholder="cth: 101.09">
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

/* ── NG REASON OPTIONS ───────────────────────────────────── */
const NG_REASONS = [
  { group: '1. Persiapan', key: '1', items: [
    { key: '1A', label: 'A. Ambil part' },
    { key: '1B', label: 'B. Setting/Pasang part' },
    { key: '1C', label: 'C. Potong Benang' },
    { key: '1D', label: 'D. Supply part' },
  ]},
  { group: '2. Pengecekan', key: '2', items: [
    { key: '2A', label: 'A. Part' },
    { key: '2B', label: 'B. Hasil Jahitan' },
  ]},
  { group: '3. Proses', key: '3', items: [
    { key: '3A', label: 'A. Jahit' },
  ]},
];

/* ── IK STATE ────────────────────────────────────────────── */
let _ikSlots = [
  { variant: '', sheet: '', result: '', ngReason: '' },
  { variant: '', sheet: '', result: '', ngReason: '' },
  { variant: '', sheet: '', result: '', ngReason: '' },
];
let _ikActiveCount   = 1;
let _ikLineType      = '';
let _ikVariantsCache = [];

/* ── POS SELECTOR ────────────────────────────────────────── */
function selectPos(pos) {
  document.getElementById('f-pos').value = pos;
  document.querySelectorAll('.pos-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.pos === pos);
  });
  /* Tampilkan IK section dan load variant sesuai line */
  const line = document.getElementById('f-line').value;
  if (line) {
    document.getElementById('ik-section').style.display = 'block';
    _initIkSection(line.startsWith('FB') ? 'FB' : 'FC');
  }
}

/* ── IK: INIT SECTION ────────────────────────────────────── */
async function _initIkSection(lineType) {
  if (_ikLineType === lineType && _ikVariantsCache.length) return; /* sudah loaded */
  _ikLineType = lineType;
  _ikActiveCount = 1;
  _ikSlots.forEach(s => { s.variant = ''; s.sheet = ''; s.result = ''; s.ngReason = ''; });
  for (let i = 0; i < 3; i++) _resetIkSlotUI(i);
  document.getElementById('ik-slot-1').style.display = 'none';
  document.getElementById('ik-slot-2').style.display = 'none';
  document.getElementById('ik-add-btn-wrap').style.display = 'none';
  await _loadIkVariantsAll();
}

/* ── IK: LOAD VARIANTS (hanya slot 0) ────────────────────── */
async function _loadIkVariantsAll() {
  const sel0 = document.getElementById('f-ik-variant-0');
  if (sel0) { sel0.innerHTML = '<option value="">Memuat variant...</option>'; sel0.disabled = true; }
  try {
    const data = await fetch(`/api/ik/variants?line=${_ikLineType}`).then(r => r.json());
    _ikVariantsCache = Array.isArray(data) ? data : [];
    if (sel0) {
      sel0.innerHTML = !_ikVariantsCache.length
        ? '<option value="">-- Belum ada data IK --</option>'
        : '<option value="">-- Pilih Variant Proses --</option>' +
          _ikVariantsCache.map(d => `<option value="${escHtml(d.variant)}">${escHtml(d.variant)} (${d.sheetCount} proses)</option>`).join('');
      sel0.disabled = !_ikVariantsCache.length;
    }
  } catch(e) {
    if (sel0) sel0.innerHTML = '<option value="">-- Gagal load IK --</option>';
  }
}

/* ── IK: VARIANT CHANGED (hanya slot 0) ──────────────────── */
async function onIkVariantChange(slotIdx) {
  const variant = document.getElementById(`f-ik-variant-${slotIdx}`).value;
  _ikSlots[slotIdx].variant = variant;
  _ikSlots[slotIdx].sheet   = '';
  _ikSlots[slotIdx].result  = '';

  document.getElementById(`ik-sheet-wrap-${slotIdx}`).style.display = 'none';
  document.getElementById(`ik-images-wrap-${slotIdx}`).style.display = 'none';
  document.getElementById(`ik-images-list-${slotIdx}`).innerHTML = '';
  const sheetSel = document.getElementById(`f-ik-sheet-${slotIdx}`);
  sheetSel.innerHTML = '<option value="">-- Pilih Nama Proses --</option>';

  /* Jika slot 0 variant berubah, reset & sembunyikan slot 1 & 2 */
  if (slotIdx === 0) {
    for (let i = 1; i < 3; i++) {
      _ikSlots[i] = { variant: '', sheet: '', result: '' };
      _resetIkSlotUI(i);
      document.getElementById(`ik-slot-${i}`).style.display = 'none';
    }
    _ikActiveCount = 1;
  }

  _updateIkAddBtn();
  if (!variant) return;

  const sheetWrap = document.getElementById(`ik-sheet-wrap-${slotIdx}`);
  sheetSel.innerHTML = '<option value="">Memuat proses...</option>';
  sheetSel.disabled = true;
  sheetWrap.style.display = 'block';

  try {
    const sheets = await fetch(
      `/api/ik/sheets?line=${_ikLineType}&variant=${encodeURIComponent(variant)}`
    ).then(r => r.json());
    sheetSel.innerHTML = !Array.isArray(sheets) || !sheets.length
      ? '<option value="">-- Tidak ada sheet --</option>'
      : '<option value="">-- Pilih Nama Proses --</option>' +
        sheets.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    sheetSel.disabled = false;
  } catch(e) {
    sheetSel.innerHTML = '<option value="">-- Gagal load sheet --</option>';
  }
}

/* ── IK: SHEET CHANGED → tampil semua gambar ─────────────── */
async function onIkSheetChange(slotIdx) {
  const sheet   = document.getElementById(`f-ik-sheet-${slotIdx}`).value;
  const variant = _ikSlots[slotIdx].variant;
  _ikSlots[slotIdx].sheet  = sheet;
  _ikSlots[slotIdx].result = '';

  const okBtn = document.getElementById(`ik-ok-btn-${slotIdx}`);
  const ngBtn = document.getElementById(`ik-ng-btn-${slotIdx}`);
  if (okBtn) okBtn.classList.remove('active');
  if (ngBtn) ngBtn.classList.remove('active');

  const imagesWrap    = document.getElementById(`ik-images-wrap-${slotIdx}`);
  const imagesList    = document.getElementById(`ik-images-list-${slotIdx}`);
  const imagesLoading = document.getElementById(`ik-images-loading-${slotIdx}`);
  imagesWrap.style.borderLeft = '';
  _updateIkAddBtn();

  if (!sheet) { imagesWrap.style.display = 'none'; return; }

  imagesWrap.style.display = 'block';
  imagesLoading.style.display = 'block';
  imagesList.innerHTML = '';

  try {
    const steps = await fetch(
      `/api/ik/steps?line=${_ikLineType}&variant=${encodeURIComponent(variant)}&sheet=${encodeURIComponent(sheet)}`
    ).then(r => r.json());

    imagesLoading.style.display = 'none';

    /* Kumpulkan semua image_key dari semua step */
    const imgs = [];
    if (Array.isArray(steps)) {
      for (const s of steps) {
        const stepImgs = Array.isArray(s.images) && s.images.length ? s.images
                       : s.image_key ? [{ key: s.image_key }] : [];
        for (const img of stepImgs) {
          const key = img.key || img.image_key || '';
          if (key) imgs.push(key);
        }
      }
    }

    if (!imgs.length) {
      imagesList.innerHTML = '<div style="color:var(--txt3);font-size:12px;text-align:center;padding:8px">Tidak ada gambar IK untuk proses ini.</div>';
    } else {
      imagesList.innerHTML = imgs.map(key => `
        <div style="text-align:center">
          <img style="max-width:100%;border-radius:8px;border:1px solid #333;cursor:pointer;display:block;margin:0 auto"
            src="/api/serve-photo?key=${encodeURIComponent(key)}"
            alt="Gambar IK"
            onclick="lightbox(this.src)"
            onerror="this.style.display='none'">
        </div>`).join('');
    }

    _updateIkAddBtn();
  } catch(e) {
    imagesLoading.style.display = 'none';
    imagesList.innerHTML = `<div style="color:var(--red);font-size:12px">Gagal load gambar: ${escHtml(e.message)}</div>`;
  }
}

/* ── IK: SET O/N PER SLOT ────────────────────────────────── */
function setIkSlotResult(slotIdx, result) {
  _ikSlots[slotIdx].result   = result;
  _ikSlots[slotIdx].ngReason = '';
  const okBtn = document.getElementById(`ik-ok-btn-${slotIdx}`);
  const ngBtn = document.getElementById(`ik-ng-btn-${slotIdx}`);
  if (okBtn) okBtn.classList.toggle('active', result === 'O');
  if (ngBtn) ngBtn.classList.toggle('active', result === 'N');
  const wrap = document.getElementById(`ik-images-wrap-${slotIdx}`);
  if (wrap) wrap.style.borderLeft = result === 'O' ? '3px solid #34d399' : '3px solid #fb7185';

  /* Tampilkan/sembunyikan NG reason panel */
  const ngDiv = document.getElementById(`ik-ng-reason-${slotIdx}`);
  if (ngDiv) {
    if (result === 'N') {
      ngDiv.style.display = 'block';
      ngDiv.innerHTML = `
        <div style="font-size:11px;color:#fb7185;font-weight:700;margin-bottom:8px">&#x26A0; Pilih Penyebab NG:</div>
        ${NG_REASONS.map(g => `
          <div style="margin-bottom:8px">
            <div style="font-size:10px;color:var(--txt3);margin-bottom:4px">${escHtml(g.group)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${g.items.map(item => `
                <button type="button"
                  id="ng-reason-btn-${slotIdx}-${item.key}"
                  onclick="selectNgReason(${slotIdx},'${item.key}')"
                  style="padding:4px 10px;font-size:11px;border-radius:6px;border:1px solid #555;background:#222;color:var(--txt2);cursor:pointer">
                  ${escHtml(item.label)}
                </button>`).join('')}
            </div>
          </div>`).join('')}`;
    } else {
      ngDiv.style.display = 'none';
      ngDiv.innerHTML = '';
    }
  }
  _updateIkAddBtn();
}

/* ── IK: PILIH PENYEBAB NG ───────────────────────────────── */
function selectNgReason(slotIdx, key) {
  _ikSlots[slotIdx].ngReason = key;
  /* Highlight tombol yang dipilih */
  NG_REASONS.forEach(g => g.items.forEach(item => {
    const btn = document.getElementById(`ng-reason-btn-${slotIdx}-${item.key}`);
    if (btn) {
      btn.style.background  = item.key === key ? '#fb7185' : '#222';
      btn.style.color       = item.key === key ? '#000'    : 'var(--txt2)';
      btn.style.borderColor = item.key === key ? '#fb7185' : '#555';
      btn.style.fontWeight  = item.key === key ? '700'     : '400';
    }
  }));
  _updateIkAddBtn();
}

/* ── IK: TAMBAH / HAPUS SLOT ─────────────────────────────── */
async function addIkSlot() {
  if (_ikActiveCount >= 3) return;
  const newIdx  = _ikActiveCount;
  const variant = _ikSlots[0].variant;
  _ikSlots[newIdx].variant = variant;
  _ikSlots[newIdx].sheet   = '';
  _ikSlots[newIdx].result  = '';

  /* Tampilkan label variant */
  const varInfo = document.getElementById(`ik-variant-info-${newIdx}`);
  if (varInfo) varInfo.textContent = `Variant: ${variant}`;

  /* Load daftar proses untuk slot baru */
  const sheetSel = document.getElementById(`f-ik-sheet-${newIdx}`);
  sheetSel.innerHTML = '<option value="">Memuat proses...</option>';
  sheetSel.disabled = true;

  document.getElementById(`ik-slot-${newIdx}`).style.display = 'block';
  _ikActiveCount++;
  _updateIkAddBtn();

  try {
    const sheets = await fetch(
      `/api/ik/sheets?line=${_ikLineType}&variant=${encodeURIComponent(variant)}`
    ).then(r => r.json());
    sheetSel.innerHTML = !Array.isArray(sheets) || !sheets.length
      ? '<option value="">-- Tidak ada sheet --</option>'
      : '<option value="">-- Pilih Nama Proses --</option>' +
        sheets.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    sheetSel.disabled = false;
  } catch(e) {
    sheetSel.innerHTML = '<option value="">-- Gagal load sheet --</option>';
  }
}

function removeIkSlot(slotIdx) {
  document.getElementById(`ik-slot-${slotIdx}`).style.display = 'none';
  _resetIkSlotUI(slotIdx);
  _ikSlots[slotIdx] = { variant: '', sheet: '', result: '' };
  _ikActiveCount = slotIdx;
  _updateIkAddBtn();
}

/* ── IK: TAMPILKAN TOMBOL TAMBAH ─────────────────────────── */
function _updateIkAddBtn() {
  const wrap = document.getElementById('ik-add-btn-wrap');
  if (!wrap) return;
  const last = _ikSlots[_ikActiveCount - 1];
  const lastDone = last.sheet && last.result && (last.result === 'O' || (last.result === 'N' && last.ngReason));
  wrap.style.display = (_ikActiveCount < 3 && lastDone) ? 'block' : 'none';
}

/* ── IK: RESET UI SATU SLOT ──────────────────────────────── */
function _resetIkSlotUI(slotIdx) {
  if (slotIdx === 0) {
    const varSel = document.getElementById('f-ik-variant-0');
    if (varSel) varSel.value = '';
    const sheetWrap = document.getElementById('ik-sheet-wrap-0');
    if (sheetWrap) sheetWrap.style.display = 'none';
  } else {
    const varInfo = document.getElementById(`ik-variant-info-${slotIdx}`);
    if (varInfo) varInfo.textContent = '';
  }
  const sheetSel = document.getElementById(`f-ik-sheet-${slotIdx}`);
  if (sheetSel) { sheetSel.innerHTML = '<option value="">-- Pilih Nama Proses --</option>'; sheetSel.disabled = slotIdx > 0; }
  const imagesWrap = document.getElementById(`ik-images-wrap-${slotIdx}`);
  if (imagesWrap) { imagesWrap.style.display = 'none'; imagesWrap.style.borderLeft = ''; }
  const imagesList = document.getElementById(`ik-images-list-${slotIdx}`);
  if (imagesList) imagesList.innerHTML = '';
  const okBtn = document.getElementById(`ik-ok-btn-${slotIdx}`);
  if (okBtn) okBtn.classList.remove('active');
  const ngBtn = document.getElementById(`ik-ng-btn-${slotIdx}`);
  if (ngBtn) ngBtn.classList.remove('active');
  const ngDiv = document.getElementById(`ik-ng-reason-${slotIdx}`);
  if (ngDiv) { ngDiv.style.display = 'none'; ngDiv.innerHTML = ''; }
}

/* ── NG REASON LABEL ─────────────────────────────────────── */
function ngReasonLabel(key) {
  if (!key) return '';
  for (const g of NG_REASONS) {
    for (const item of g.items) {
      if (item.key === key) return `${g.group} — ${item.label}`;
    }
  }
  return key;
}

/* ── HTML ESCAPE ─────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
  try {
    document.getElementById('fi-video').textContent = '⏳';
    document.getElementById('ft-video').textContent = 'Memeriksa koneksi cloud...';

    const r2On = await checkR2();

    if (r2On) {
      /* ── Upload langsung ke R2 via presigned URL ── */
      document.getElementById('ft-video').textContent = `Mengupload ke cloud... (${sizeMB.toFixed(1)} MB)`;

      const ext         = (file.name.split('.').pop() || 'mp4').toLowerCase();
      const contentType = file.type || 'video/' + ext;
      const { uploadUrl, publicUrl } = await fetch('/api/presign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext, contentType }),
      }).then(r => r.json());

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType },
      });
      if (!putRes.ok) throw new Error('Upload video gagal (' + putRes.status + ') — cek koneksi dan coba lagi');

      input._videoUrl    = publicUrl;
      input._videoBase64 = '';

      const prev = document.getElementById('prev-video');
      prev.style.display = 'block';
      const previewKey = publicUrl.replace(/^https?:\/\/[^/]+\//, '');
      fetch('/api/video-url?key=' + encodeURIComponent(previewKey))
        .then(r => r.json())
        .then(d => { if (d.signedUrl) prev.src = d.signedUrl; })
        .catch(() => { prev.src = publicUrl; });

      document.getElementById('fi-video').textContent = '✅';
      document.getElementById('ft-video').textContent =
        file.name + ' (' + sizeMB.toFixed(1) + ' MB) — tersimpan di cloud ☁️';
      toast('Video berhasil diupload ke cloud');

    } else {
      /* ── Fallback: simpan sebagai base64 ── */
      document.getElementById('ft-video').textContent = 'Memuat video...';
      const base64 = await readFileAsBase64(file);
      input._videoBase64 = base64;
      input._videoUrl    = '';

      const prev = document.getElementById('prev-video');
      prev.src = base64;
      prev.style.display = 'block';

      document.getElementById('fi-video').textContent = '✅';
      document.getElementById('ft-video').textContent =
        file.name + ' (' + sizeMB.toFixed(1) + ' MB)';
      toast('Video berhasil dimuat');
    }
  } catch(e) { toast('Gagal memuat video: ' + e.message, false); }
}

/* ── COLLECT DATA ────────────────────────────────────────── */
function _getFormData() {
  const fBefore = document.getElementById('f-foto-before');
  const fAfter  = document.getElementById('f-foto-after');
  const fVideo  = document.getElementById('f-video');

  /* IK checks — kumpulkan semua slot yang sudah pilih variant & sheet */
  const ikChecksArr = _ikSlots
    .slice(0, _ikActiveCount)
    .filter(s => s.variant && s.sheet)
    .map(s => {
      const obj = { variant: s.variant, sheet: s.sheet, result: s.result };
      if (s.result === 'N' && s.ngReason) obj.ngReason = s.ngReason;
      return obj;
    });
  const ikChecks = ikChecksArr.length ? ikChecksArr : null;

  return {
    pic:           document.getElementById('f-pic').value,
    tanggal:       document.getElementById('f-tgl').value,
    waktu:         document.getElementById('f-waktu').value,
    line:          document.getElementById('f-line').value,
    pos:           document.getElementById('f-pos').value,
    pilihanTemuan: document.getElementById('f-temuan-val').value,
    deskripsi:     document.getElementById('f-deskripsi').value.trim(),
    video:         fVideo?._videoUrl || fVideo?._videoBase64 || '',
    fotoBefore:    fBefore?._compressed   || '',
    fotoAfter:     fAfter?._compressed    || '',
    ikChecks,
  };
}

function _validateForm(d) {
  if (!d.pic)           { toast('Nama PIC wajib dipilih', false);    return false; }
  if (!d.tanggal)       { toast('Tanggal wajib diisi', false);       return false; }
  if (!d.line)          { toast('Line wajib dipilih', false);        return false; }
  if (!d.pos)           { toast('Pos wajib dipilih (klik salah satu tombol Pos)', false); return false; }
  if (!d.pilihanTemuan) { toast('Pilihan Temuan wajib dipilih', false); return false; }

  /* Jika ada IK yang dipilih, semua proses harus diisi O atau N */
  if (Array.isArray(d.ikChecks) && d.ikChecks.length > 0) {
    const belumResult = d.ikChecks.filter(s => !s.result);
    if (belumResult.length > 0) {
      toast(`IK: ${belumResult.length} proses belum dipilih O atau N`, false);
      return false;
    }
    const belumReason = d.ikChecks.filter(s => s.result === 'N' && !s.ngReason);
    if (belumReason.length > 0) {
      toast(`IK: ${belumReason.length} proses NG belum dipilih penyebabnya`, false);
      return false;
    }
  }
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

  /* Video: jangan embed base64 besar ke innerHTML — set src setelah render */
  const vidBlock = d.video
    ? `<div class="pph" style="grid-column:1/-1">
         <div class="ppl">&#x1F3AC; Video Observasi</div>
         <video id="prev-modal-video" controls style="width:100%;border-radius:10px;max-height:200px"></video>
       </div>`
    : `<div class="pph" style="grid-column:1/-1">
         <div class="ppl">&#x1F3AC; Video Observasi</div>
         <div class="noph">Tidak ada video</div>
       </div>`;

  const ikPreviewHtml = Array.isArray(d.ikChecks) && d.ikChecks.length
    ? `<div style="margin-top:4px">
        <div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px">&#x1F4CB; Instruksi Kerja (IK)</div>
        ${d.ikChecks.map(s => {
          const rc = s.result === 'O' ? '#34d399' : s.result === 'N' ? '#fb7185' : 'var(--txt3)';
          const ngLbl = s.result === 'N' && s.ngReason
            ? `<div style="font-size:10px;color:#fb7185;margin-top:2px">&#x26A0; ${escHtml(ngReasonLabel(s.ngReason))}</div>` : '';
          return `<div style="padding:6px 10px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:4px">
            <div style="font-size:10px;color:#93c5fd">${escHtml(s.variant||'')} &rsaquo; ${escHtml(s.sheet||'')}</div>
            <div style="font-weight:700;color:${rc};font-size:12px">${s.result==='O'?'&#x2705; OK':'&#x274C; NG'}</div>
            ${ngLbl}
          </div>`;
        }).join('')}
      </div>`
    : '';

  document.getElementById('preview-body').innerHTML = `
    <div class="pgrid">
      <div class="pi"><div class="pl">Nama PIC</div><div class="pv">${d.pic}</div></div>
      <div class="pi"><div class="pl">Tanggal</div><div class="pv">${hari(d.tanggal)}, ${fmtD(d.tanggal)}</div></div>
      <div class="pi"><div class="pl">Waktu Sagyou</div><div class="pv">${d.waktu || '-'}</div></div>
      <div class="pi"><div class="pl">Line</div><div class="pv">${d.line}</div></div>
      <div class="pi"><div class="pl">Pos</div><div class="pv">${d.pos}</div></div>
      ${ikPreviewHtml ? `<div class="pi" style="grid-column:1/-1"><div class="pl">IK Check</div><div class="pv">${ikPreviewHtml}</div></div>` : ''}
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

  if (d.video) {
    document.getElementById('prev-modal-video').src = d.video;
  }

  document.getElementById('ov-preview').className = 'ov on';
}

/* ── SUBMIT / INJECT ─────────────────────────────────────── */
async function doSubmit() {
  const d = _getFormData();
  if (!_validateForm(d)) return;

  const btn = document.querySelector('#ov-preview .btn-s');
  btn.disabled = true;

  try {
    let fotoBefore = d.fotoBefore;
    let fotoAfter  = d.fotoAfter;

    const r2On = await checkR2();
    if (r2On && (fotoBefore || fotoAfter)) {
      const meta = { line: d.line, tanggal: d.tanggal, pic: d.pic, pos: d.pos };
      btn.textContent = '⏳ Upload foto before...';
      if (fotoBefore) fotoBefore = await uploadPhotoToR2(fotoBefore, 'before', meta);
      btn.textContent = '⏳ Upload foto after...';
      if (fotoAfter)  fotoAfter  = await uploadPhotoToR2(fotoAfter,  'after',  meta);
    }

    btn.textContent = '⏳ Menyimpan...';
    const record = {
      pic:           d.pic,
      tanggal:       d.tanggal,
      waktu:         d.waktu,
      hari:          hari(d.tanggal),
      line:          d.line,
      pos:           d.pos,
      pilihanTemuan: d.pilihanTemuan,
      deskripsi:     d.deskripsi,
      video:         d.video,
      fotoBefore,
      fotoAfter,
    };
    if (d.ikChecks) record.ikChecks = d.ikChecks;
    await DB.add(record);
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
  document.getElementById('f-waktu').value = '';
  document.getElementById('f-pos').value = '';
  document.getElementById('f-temuan-val').value = '';
  /* Reset IK section */
  const ikSec = document.getElementById('ik-section');
  if (ikSec) ikSec.style.display = 'none';
  _ikActiveCount = 1;
  _ikLineType    = '';
  _ikVariantsCache = [];
  _ikSlots.forEach(s => { s.variant = ''; s.sheet = ''; s.result = ''; s.ngReason = ''; });
  for (let i = 0; i < 3; i++) _resetIkSlotUI(i);
  const ikSlot1 = document.getElementById('ik-slot-1');
  if (ikSlot1) ikSlot1.style.display = 'none';
  const ikSlot2 = document.getElementById('ik-slot-2');
  if (ikSlot2) ikSlot2.style.display = 'none';
  const ikAddBtn = document.getElementById('ik-add-btn-wrap');
  if (ikAddBtn) ikAddBtn.style.display = 'none';

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
  if (fVid)  { fVid._videoBase64 = ''; fVid._videoUrl = ''; }

  const prevVid = document.getElementById('prev-video');
  if (prevVid) { prevVid.src = ''; prevVid.style.display = 'none'; }
  document.getElementById('fi-video').textContent = '🎬';
  document.getElementById('ft-video').innerHTML =
    'Klik atau tap untuk pilih video dari galeri / kamera HP<br>' +
    '<small style="color:var(--txt3)">MP4 / MOV / WebM</small>';
}
