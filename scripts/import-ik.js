/**
 * scripts/import-ik.js
 * Parse semua file Excel IK FB & IK FC → simpan struktur ke Neon DB, upload gambar ke R2.
 *
 * Cara jalankan (dari folder sagyoukansatsu/):
 *   node scripts/import-ik.js
 *
 * Butuh .env dengan:
 *   DATABASE_URL=postgres://...
 *   R2_ACCOUNT_ID=...
 *   R2_ACCESS_KEY_ID=...
 *   R2_SECRET_ACCESS_KEY=...
 *   R2_BUCKET_NAME=sagyoukansatsu
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs    = require('fs');
const path  = require('path');
const xlsx  = require('xlsx');
const JSZip = require('jszip');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

/* ── Konfigurasi folder IK ──────────────────────────────── */
const IK_FOLDERS = {
  FB: 'C:\\Users\\rakaa\\IK FB D26A',
  FC: 'C:\\Users\\rakaa\\IK FC D26A',
};

/* ── Database ────────────────────────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* ── R2 Storage ──────────────────────────────────────────── */
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sagyoukansatsu';

function safeKey(str) {
  return String(str).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

const WEB_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

async function uploadToR2(key, buffer, ext) {
  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                    : ext === 'png'  ? 'image/png'
                    : ext === 'gif'  ? 'image/gif'
                    : ext === 'webp' ? 'image/webp'
                    : ext === 'bmp'  ? 'image/bmp'
                    : 'image/jpeg';
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType,
  }));
}

/* ── Parse workbook.xml → sheet name → file path di ZIP ─── */
async function getSheetFileMap(zip) {
  const wbFile    = zip.files['xl/workbook.xml'];
  const wbRelsFile = zip.files['xl/_rels/workbook.xml.rels'];
  if (!wbFile || !wbRelsFile) return {};

  const wbXml   = await wbFile.async('text');
  const relsXml = await wbRelsFile.async('text');

  const rId2Name = {};
  for (const m of wbXml.matchAll(/name="([^"]+)"[^/]*r:id="(rId\d+)"/g)) rId2Name[m[2]] = m[1];
  for (const m of wbXml.matchAll(/r:id="(rId\d+)"[^/]*name="([^"]+)"/g)) if (!rId2Name[m[1]]) rId2Name[m[1]] = m[2];

  const rId2File = {};
  for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
    if (m[2].toLowerCase().includes('worksheet')) {
      rId2File[m[1]] = 'xl/' + m[2].replace(/^\.\.\//, '').replace(/^\/?xl\//, '');
    }
  }

  const result = {};
  for (const [rId, name] of Object.entries(rId2Name)) {
    if (rId2File[rId]) result[name] = rId2File[rId];
  }
  return result;
}

/* ── Parse drawing XML → array of {row, col, mediaPath} ────
 * row & col adalah 0-indexed sesuai Excel drawing coordinate.
 * Hanya ambil gambar standar (bukan hdphoto/WDP).
 * ─────────────────────────────────────────────────────────── */
async function getImageList(zip, sheetFilePath) {
  const sheetFileName  = path.basename(sheetFilePath);
  const relsPath       = `xl/worksheets/_rels/${sheetFileName}.rels`;
  const relsFile       = zip.files[relsPath];
  if (!relsFile) return [];

  const relsXml = await relsFile.async('text');
  let drawingFileName = null;
  const dm = relsXml.match(/Target="\.\.\/drawings\/(drawing\d+\.xml)"/i);
  if (dm) drawingFileName = dm[1];
  if (!drawingFileName) return [];

  const drawingPath     = `xl/drawings/${drawingFileName}`;
  const drawingRelsPath = `xl/drawings/_rels/${drawingFileName}.rels`;

  /* rId → media path (hanya tipe image standar, bukan hdphoto) */
  const rId2Media = {};
  const drFile = zip.files[drawingRelsPath];
  if (drFile) {
    const drXml = await drFile.async('text');
    for (const m of drXml.matchAll(/Id="(rId\d+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      const type   = m[2];
      const target = m[3];
      /* Lewati hdphoto (WDP) — browser tidak bisa tampilkan */
      if (type.includes('hdphoto')) continue;
      if (target.includes('media/')) {
        const fname = path.basename(target);
        const ext   = fname.split('.').pop().toLowerCase();
        if (WEB_EXTS.has(ext)) {
          rId2Media[m[1]] = 'xl/media/' + fname;
        }
      }
    }
    /* Coba juga urutan atribut terbalik */
    for (const m of drXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"[^>]*Type="([^"]+)"/g)) {
      if (rId2Media[m[1]]) continue;
      const target = m[2];
      const type   = m[3];
      if (type.includes('hdphoto')) continue;
      if (target.includes('media/')) {
        const fname = path.basename(target);
        const ext   = fname.split('.').pop().toLowerCase();
        if (WEB_EXTS.has(ext)) rId2Media[m[1]] = 'xl/media/' + fname;
      }
    }
  }

  const drawingFile = zip.files[drawingPath];
  if (!drawingFile) return [];
  const drawingXml = await drawingFile.async('text');

  const images = [];
  const re = /<xdr:(one|two)CellAnchor[^>]*?>([\s\S]*?)<\/xdr:\1CellAnchor>/g;
  for (const m of drawingXml.matchAll(re)) {
    const content = m[2];
    const rowM = content.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    const colM = content.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/);
    const ridM = content.match(/r:embed="(rId\d+)"/);
    if (rowM && colM && ridM && rId2Media[ridM[1]]) {
      images.push({
        row:       parseInt(rowM[1]),  /* drawing row (0-indexed = Excel row - 1) */
        col:       parseInt(colM[1]),  /* drawing col (0-indexed) */
        mediaPath: rId2Media[ridM[1]],
      });
    }
  }

  return images; /* [{row, col, mediaPath}] */
}

/* ── Parse urutan kerja menggunakan ACTUAL ROW NUMBER ───────
 * Berbeda dari versi lama yang pakai array index.
 * Kini pakai cell address r,c agar row = drawing row yang benar.
 * ─────────────────────────────────────────────────────────── */
function parseSteps(sheet) {
  if (!sheet || !sheet['!ref']) return [];

  const range = xlsx.utils.decode_range(sheet['!ref']);
  const steps = [];
  const seen  = new Set();

  for (let R = range.s.r; R <= range.e.r; R++) {
    /* Cek kolom A (0) dan B (1) untuk nomor langkah */
    for (const C of [0, 1]) {
      const cell = sheet[xlsx.utils.encode_cell({ r: R, c: C })];
      if (!cell || cell.v === undefined || cell.v === '') continue;

      const val = cell.v;
      let no = null;

      if (typeof val === 'number' && Number.isInteger(val) && val >= 1 && val <= 99) {
        no = val;
      } else if (typeof val === 'string' && val.trim()) {
        const n = parseInt(val.trim().replace(/[^0-9]/g, ''));
        if (!isNaN(n) && n >= 1 && n <= 99) no = n;
      }

      if (no !== null && !seen.has(no)) {
        /* Ambil teks dari kolom berikutnya (C+1 atau C+2) */
        let text = '';
        for (const TC of [C + 1, C + 2, C + 3]) {
          const tc = sheet[xlsx.utils.encode_cell({ r: R, c: TC })];
          if (tc && tc.v && String(tc.v).trim().length > 2) {
            text = String(tc.v).trim();
            break;
          }
        }
        if (text) {
          steps.push({ no, text, image_key: null, _row: R }); /* R = drawing row (0-indexed) */
          seen.add(no);
        }
        break;
      }
    }
  }

  return steps.sort((a, b) => a.no - b.no);
}

/* ── Match gambar ke langkah ─────────────────────────────────
 * Logika:
 * 1. Filter gambar di area kanan (col > MIN_IMG_COL) = zona foto langkah
 * 2. Urutkan gambar berdasarkan row (atas ke bawah)
 * 3. Untuk setiap langkah, cari gambar terdekat (dalam ROW_TOLERANCE baris)
 * ─────────────────────────────────────────────────────────── */
const MIN_IMG_COL   = 25; /* gambar di kiri area ini = header/machine foto, skip */
const ROW_TOLERANCE = 8;  /* cari gambar dalam ±8 baris dari langkah */

function matchImagesToSteps(steps, allImages) {
  /* Hanya pakai gambar di zona kanan */
  const stepImages = allImages
    .filter(img => img.col >= MIN_IMG_COL)
    .sort((a, b) => a.row - b.row);

  /* Jika tidak ada gambar zona kanan, coba semua tapi lewati baris 0 */
  const pool = stepImages.length > 0
    ? stepImages
    : allImages.filter(img => img.row > 2).sort((a, b) => a.row - b.row);

  const usedMedia = new Set();

  for (const step of steps) {
    /* Cari gambar terdekat dengan row langkah ini */
    let best = null;
    let bestDist = Infinity;

    for (const img of pool) {
      if (usedMedia.has(img.mediaPath)) continue;
      const dist = Math.abs(img.row - step._row);
      if (dist <= ROW_TOLERANCE && dist < bestDist) {
        bestDist = dist;
        best = img;
      }
    }

    if (best) {
      step._imgPath = best.mediaPath;
      usedMedia.add(best.mediaPath);
    }
  }
}

/* ── Proses satu file Excel ──────────────────────────────── */
async function processFile(filePath, lineType) {
  console.log(`  [${lineType}] ${path.basename(filePath)}`);

  const fileBuffer = fs.readFileSync(filePath);
  const variant    = path.basename(filePath, '.xlsx')
    .replace(/\.Done\s*ok\s*Rev/i, '').trim();

  const wb  = xlsx.read(fileBuffer, { type: 'buffer' });
  const zip = await JSZip.loadAsync(fileBuffer);

  const sheetFileMap = await getSheetFileMap(zip);

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const steps = parseSteps(sheet);

    if (!steps.length) {
      console.log(`    Sheet "${sheetName}": tidak ada langkah, lewati`);
      continue;
    }

    /* Ambil daftar gambar untuk sheet ini */
    const sheetFilePath = sheetFileMap[sheetName];
    let allImages = [];
    if (sheetFilePath && zip.files[sheetFilePath]) {
      try { allImages = await getImageList(zip, sheetFilePath); }
      catch (e) { console.log(`    Sheet "${sheetName}": gambar gagal di-parse (${e.message})`); }
    }

    /* Cocokkan gambar ke langkah menggunakan actual row numbers */
    matchImagesToSteps(steps, allImages);

    /* Upload gambar ke R2 */
    for (const step of steps) {
      if (!step._imgPath) continue;
      const mediaFile = zip.files[step._imgPath];
      if (!mediaFile) continue;
      try {
        const imgBuffer = await mediaFile.async('nodebuffer');
        const ext       = path.extname(step._imgPath).slice(1).toLowerCase() || 'png';
        const r2Key     = `ik/${lineType}/${safeKey(variant)}/${safeKey(sheetName)}/step_${step.no}.${ext}`;
        await uploadToR2(r2Key, imgBuffer, ext);
        step.image_key = r2Key;
        console.log(`      Langkah ${step.no}: gambar → ${r2Key}`);
      } catch (e) {
        console.log(`      Langkah ${step.no}: gagal upload — ${e.message}`);
      }
      delete step._imgPath;
      delete step._row;
    }

    /* Bersihkan field internal sebelum simpan ke DB */
    const stepsForDB = steps.map(({ no, text, image_key }) => ({ no, text, image_key }));

    /* Upsert ke DB */
    await pool.query(
      `INSERT INTO ik_data (line_type, variant, sheet, steps)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (line_type, variant, sheet) DO UPDATE SET steps = EXCLUDED.steps`,
      [lineType, variant, sheetName, JSON.stringify(stepsForDB)]
    );

    const withImg = stepsForDB.filter(s => s.image_key).length;
    console.log(`    Sheet "${sheetName}": ${stepsForDB.length} langkah disimpan (${withImg} ada gambar)`);
  }
}

/* ── Main ────────────────────────────────────────────────── */
async function main() {
  console.log('=== IK Import Script (v2 — fixed row mapping) ===\n');

  if (!process.env.DATABASE_URL) { console.error('ERROR: DATABASE_URL tidak ada di .env'); process.exit(1); }
  if (!process.env.R2_ACCOUNT_ID) { console.error('ERROR: R2_ACCOUNT_ID tidak ada di .env'); process.exit(1); }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ik_data (
      id        SERIAL PRIMARY KEY,
      line_type TEXT NOT NULL,
      variant   TEXT NOT NULL,
      sheet     TEXT NOT NULL,
      steps     JSONB NOT NULL,
      UNIQUE(line_type, variant, sheet)
    )
  `);
  console.log('Tabel ik_data siap.\n');

  for (const [lineType, folderPath] of Object.entries(IK_FOLDERS)) {
    console.log(`=== Folder ${lineType}: ${folderPath} ===`);
    if (!fs.existsSync(folderPath)) { console.log(`  Folder tidak ditemukan, dilewati.\n`); continue; }

    const files = fs.readdirSync(folderPath)
      .filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
      .sort().map(f => path.join(folderPath, f));

    console.log(`  Ditemukan ${files.length} file Excel\n`);
    for (const filePath of files) {
      try { await processFile(filePath, lineType); }
      catch (e) { console.error(`  ERROR pada ${path.basename(filePath)}: ${e.message}`); }
    }
    console.log('');
  }

  const { rows } = await pool.query(
    'SELECT line_type, COUNT(DISTINCT variant) AS v, COUNT(*) AS s FROM ik_data GROUP BY line_type'
  );
  console.log('=== Ringkasan ===');
  for (const r of rows) console.log(`  ${r.line_type}: ${r.v} variant, ${r.s} sheet`);

  await pool.end();
  console.log('\nImport selesai!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
