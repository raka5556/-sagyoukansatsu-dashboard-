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
const IK_FOLDERS = [
  { lineType: 'FB', model: 'D26A', folder: 'C:\\Users\\rakaa\\IK FB D26A' },
  { lineType: 'FC', model: 'D26A', folder: 'C:\\Users\\rakaa\\IK FC D26A' },
  { lineType: 'FB', model: 'D37D', folder: 'C:\\Users\\rakaa\\IK FB D37D' },
  { lineType: 'FC', model: 'D37D', folder: 'C:\\Users\\rakaa\\IK FC D37D' },
];

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

/* ── Helper: ambil drawing file name untuk satu sheet ─────── */
async function getDrawingInfo(zip, sheetFilePath) {
  const sheetFileName  = path.basename(sheetFilePath);
  const relsPath       = `xl/worksheets/_rels/${sheetFileName}.rels`;
  const relsFile       = zip.files[relsPath];
  if (!relsFile) return null;

  const relsXml = await relsFile.async('text');
  const dm      = relsXml.match(/Target="\.\.\/drawings\/(drawing\d+\.xml)"/i);
  if (!dm) return null;

  const drawingFileName = dm[1];
  const drawingPath     = `xl/drawings/${drawingFileName}`;
  const drawingRelsPath = `xl/drawings/_rels/${drawingFileName}.rels`;
  return { drawingPath, drawingRelsPath };
}

/* ── Build rId→mediaPath map dari drawing rels ─────────────── */
async function buildRId2Media(zip, drawingRelsPath) {
  const rId2Media = {};
  const drFile    = zip.files[drawingRelsPath];
  if (!drFile) return rId2Media;

  const drXml = await drFile.async('text');
  for (const order of [
    /Id="(rId\d+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"/g,
    /Id="(rId\d+)"[^>]*Target="([^"]+)"[^>]*Type="([^"]+)"/g,
  ]) {
    for (const m of drXml.matchAll(order)) {
      if (rId2Media[m[1]]) continue;
      const [type, target] = order.source.indexOf('Type') < order.source.indexOf('Target')
        ? [m[2], m[3]] : [m[3], m[2]];
      if (type.includes('hdphoto')) continue;
      if (target.includes('media/')) {
        const fname = path.basename(target);
        const ext   = fname.split('.').pop().toLowerCase();
        if (WEB_EXTS.has(ext)) rId2Media[m[1]] = 'xl/media/' + fname;
      }
    }
  }
  return rId2Media;
}

/* ── Parse drawing XML → shapes (Oval/Rect/Bubble) ──────────
 * Returns { ovals, rects, bubbles } setiap elemen: {row, col, text}
 * Digunakan untuk membangun struktur langkah dari shape IK.
 * ─────────────────────────────────────────────────────────── */
async function getShapeList(zip, sheetFilePath) {
  const info = await getDrawingInfo(zip, sheetFilePath);
  if (!info) return null;

  const drawingFile = zip.files[info.drawingPath];
  if (!drawingFile) return null;
  const drXml = await drawingFile.async('text');

  const ovals = [], rects = [], bubbles = [];

  const re = /<xdr:(one|two)CellAnchor[^>]*?>([\s\S]*?)<\/xdr:\1CellAnchor>/g;
  for (const m of drXml.matchAll(re)) {
    const c = m[2];
    /* Hanya ambil anchor yang HANYA berisi shape (bukan pic, bukan group) */
    if (c.includes('<xdr:pic>'))   continue;
    if (c.includes('<xdr:grpSp>')) continue; /* skip group anchors — header shapes ada di sini */
    if (!c.includes('<xdr:sp ') && !c.includes('<xdr:sp>')) continue;

    const rowM  = c.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    const colM  = c.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/);
    if (!rowM || !colM) continue;
    const row   = parseInt(rowM[1]);
    const col   = parseInt(colM[1]);

    const nameM = c.match(/name="([^"]+)"/);
    const prstM = c.match(/prst="([^"]+)"/);
    const txts  = [...c.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(t => t[1]).join('').trim();
    const name  = nameM ? nameM[1] : '';
    const prst  = prstM ? prstM[1] : '';

    const isOval   = prst === 'ellipse';
    const isBubble = prst.toLowerCase().includes('callout') ||
                     prst.toLowerCase().includes('wedge')   ||
                     prst.toLowerCase().includes('cloud')   ||
                     name.toLowerCase().includes('speech bubble') ||
                     name.toLowerCase().includes('callout');

    if (isOval && /^\d+$/.test(txts)) {
      ovals.push({ row, col, text: txts });
    } else if (isBubble && txts) {
      bubbles.push({ row, col, text: txts });
    } else if (!isOval && !isBubble && txts.length > 2) {
      rects.push({ row, col, text: txts });
    }
  }

  return (ovals.length > 0) ? { ovals, rects, bubbles } : null;
}

/* ── Parse drawing XML → foto [{row, col, mediaPath, caption}]
 * Juga menangkap caption dari group anchor (pic + bubble dalam satu group).
 * ─────────────────────────────────────────────────────────── */
async function getImageList(zip, sheetFilePath) {
  const info = await getDrawingInfo(zip, sheetFilePath);
  if (!info) return [];

  const rId2Media  = await buildRId2Media(zip, info.drawingRelsPath);
  const drawingFile = zip.files[info.drawingPath];
  if (!drawingFile) return [];
  const drawingXml = await drawingFile.async('text');

  const images = [];
  const re = /<xdr:(one|two)CellAnchor[^>]*?>([\s\S]*?)<\/xdr:\1CellAnchor>/g;
  for (const m of drawingXml.matchAll(re)) {
    const content = m[2];
    const rowM = content.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    const colM = content.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/);
    /* Kumpulkan semua rId embed (bisa nested di dalam group) */
    const allRids = [...content.matchAll(/r:embed="(rId\d+)"/g)].map(x => x[1]);
    const mediaRid = allRids.find(r => rId2Media[r]);

    if (rowM && colM && mediaRid) {
      /* Cek apakah ada teks shape di dalam anchor yang sama (group dengan caption) */
      let caption = '';
      if (content.includes('<a:t>')) {
        const shapeTxts = [...content.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(t => t[1]).join('').trim();
        /* Hanya ambil jika ini benar-benar caption (bukan nama file dll) */
        if (shapeTxts.length > 3) caption = shapeTxts;
      }
      images.push({
        row:       parseInt(rowM[1]),
        col:       parseInt(colM[1]),
        mediaPath: rId2Media[mediaRid],
        caption,
      });
    }
  }

  return images;
}

/* ── Build langkah dari Shape data (Oval + Rect + Bubble + Foto)
 * Pendekatan:
 *   1. Oval = nomor langkah + posisi kolom sebagai "anchor" langkah
 *   2. Pisahkan blok atas (row oval < 60) dan blok bawah (row oval ≥ 60)
 *   3. Dalam tiap blok, rentang kolom langkah = oval.col s.d. oval_berikutnya.col
 *   4. Gambar & bubble yang jatuh dalam rentang kolom → milik langkah itu
 *   5. Bubble dicocokkan ke foto terdekat berdasarkan kolom
 * ─────────────────────────────────────────────────────────── */
const BLOK_SPLIT_ROW = 60; /* baris pemisah blok atas dan blok bawah */

function buildStepsFromShapes(shapeData, allImages) {
  const { ovals, rects, bubbles } = shapeData;

  /* Pisahkan blok atas & bawah */
  const ovalsTop = ovals.filter(o => o.row <  BLOK_SPLIT_ROW).sort((a, b) => a.col - b.col);
  const ovalsBot = ovals.filter(o => o.row >= BLOK_SPLIT_ROW).sort((a, b) => a.col - b.col);

  const steps = [];

  for (const [blockOvals, minRow, maxRow] of [
    [ovalsTop, 38, BLOK_SPLIT_ROW - 1],
    [ovalsBot, BLOK_SPLIT_ROW, 82],
  ]) {
    if (blockOvals.length === 0) continue;

    const blockImages  = allImages.filter(img => img.row >= minRow && img.row <= maxRow);
    const blockBubbles = bubbles.filter(b => b.row >= minRow && b.row <= maxRow);

    for (let i = 0; i < blockOvals.length; i++) {
      const oval     = blockOvals[i];
      const no       = parseInt(oval.text);
      const colFrom  = oval.col;
      const colTo    = i + 1 < blockOvals.length ? blockOvals[i + 1].col : 9999;

      /* Teks langkah: Rectangle dalam rentang kolom oval ± 3 */
      const stepRect = rects
        .filter(r => r.col >= colFrom - 3 && r.col < colTo && Math.abs(r.row - oval.row) < 6)
        .sort((a, b) => Math.abs(a.col - oval.col) - Math.abs(b.col - oval.col))[0];
      const text = stepRect ? stepRect.text : String(no);

      /* Foto dalam rentang kolom, dedup posisi exact */
      const seenPos = new Set();
      const stepImages = blockImages
        .filter(img => img.col >= colFrom && img.col < colTo)
        .sort((a, b) => a.col - b.col || a.row - b.row)
        .filter(img => {
          const key = `${img.row}_${img.col}`;
          if (seenPos.has(key)) return false;
          seenPos.add(key);
          return true;
        });

      /* Cocokkan bubble ke foto: cari bubble terdekat dalam rentang kolom */
      const stepBubbles = blockBubbles.filter(b => b.col >= colFrom && b.col < colTo);

      /* Pass 1: tentukan bubble terdekat untuk tiap foto (tanpa group caption) */
      const rawPairs = stepImages.map(img => {
        if (img.caption) return { img, bubble: null };
        const nearest = stepBubbles
          .slice()
          .sort((a, b) => Math.abs(a.col - img.col) - Math.abs(b.col - img.col))[0];
        return { img, bubble: nearest || null };
      });

      /* Pass 2: jika beberapa foto berbagi satu bubble, pisah teks per koma */
      const bubbleShareMap = new Map();
      rawPairs.forEach((pair, idx) => {
        if (!pair.bubble) return;
        const key = `${pair.bubble.row}_${pair.bubble.col}`;
        if (!bubbleShareMap.has(key)) bubbleShareMap.set(key, { bubble: pair.bubble, indices: [] });
        bubbleShareMap.get(key).indices.push(idx);
      });
      const finalCaptions = rawPairs.map(p => p.bubble ? p.bubble.text : '');
      for (const { bubble, indices } of bubbleShareMap.values()) {
        if (indices.length <= 1) continue;
        const parts = bubble.text.split(',').map(p => p.trim()).filter(p => p);
        if (parts.length >= indices.length) {
          indices.forEach((idx, i) => { finalCaptions[idx] = parts[i]; });
        }
      }

      const imagesWithCaption = rawPairs.map((pair, idx) => ({
        mediaPath: pair.img.mediaPath,
        caption:   pair.img.caption || finalCaptions[idx],
      }));

      steps.push({ no, text, _images: imagesWithCaption });
    }
  }

  return steps.sort((a, b) => a.no - b.no);
}

/* ── Fallback: parse dari sel Excel jika tidak ada oval shapes ─ */
function parseStepsFromCells(sheet) {
  if (!sheet || !sheet['!ref']) return [];

  const range = xlsx.utils.decode_range(sheet['!ref']);
  const steps = [];
  const seen  = new Set();

  for (let R = range.s.r; R <= range.e.r; R++) {
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
        let text = '';
        for (const TC of [C + 1, C + 2, C + 3]) {
          const tc = sheet[xlsx.utils.encode_cell({ r: R, c: TC })];
          if (tc && tc.v && String(tc.v).trim().length > 2) { text = String(tc.v).trim(); break; }
        }
        if (text) {
          steps.push({ no, text, _images: [] });
          seen.add(no);
        }
        break;
      }
    }
  }

  return steps.sort((a, b) => a.no - b.no);
}

/* ── Fallback image matching (bila tidak ada oval shapes) ──── */
const STEP_PHOTO_MIN_ROW = 38;
const STEP_PHOTO_MAX_ROW = 80;
const STEP_PHOTO_MAX_COL = 43;

function matchImagesFallback(steps, allImages) {
  const seen = new Set();
  const pool = allImages
    .filter(img =>
      img.row >= STEP_PHOTO_MIN_ROW &&
      img.row <= STEP_PHOTO_MAX_ROW &&
      img.col <= STEP_PHOTO_MAX_COL
    )
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .filter(img => {
      const key = `${img.row}_${img.col}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const sortedSteps = [...steps].sort((a, b) => a.no - b.no);
  for (let i = 0; i < sortedSteps.length; i++) {
    if (i >= pool.length) break;
    sortedSteps[i]._images = [{ mediaPath: pool[i].mediaPath, caption: pool[i].caption || '' }];
  }
}

/* ── Proses satu file Excel ──────────────────────────────── */
async function processFile(filePath, lineType, model) {
  console.log(`  [${lineType} ${model}] ${path.basename(filePath)}`);

  const fileBuffer = fs.readFileSync(filePath);
  const variant    = path.basename(filePath, '.xlsx')
    .replace(/\.Done\s*ok\s*Rev/i, '').trim();

  const wb  = xlsx.read(fileBuffer, { type: 'buffer' });
  const zip = await JSZip.loadAsync(fileBuffer);

  const sheetFileMap = await getSheetFileMap(zip);

  for (const sheetName of wb.SheetNames) {
    const sheet         = wb.Sheets[sheetName];
    const sheetFilePath = sheetFileMap[sheetName];

    /* Ambil daftar gambar */
    let allImages = [];
    if (sheetFilePath && zip.files[sheetFilePath]) {
      try { allImages = await getImageList(zip, sheetFilePath); }
      catch (e) { console.log(`    Sheet "${sheetName}": gambar gagal di-parse (${e.message})`); }
    }

    /* Coba parse langkah dari drawing shapes (oval/rect/bubble) */
    let steps;
    if (sheetFilePath && zip.files[sheetFilePath]) {
      try {
        const shapeData = await getShapeList(zip, sheetFilePath);
        if (shapeData) steps = buildStepsFromShapes(shapeData, allImages);
      } catch (e) {
        console.log(`    Sheet "${sheetName}": shape parse gagal (${e.message}), pakai fallback`);
      }
    }

    /* Fallback: parse dari sel jika tidak ada oval */
    if (!steps || !steps.length) {
      steps = parseStepsFromCells(sheet);
      if (steps.length) matchImagesFallback(steps, allImages);
    }

    if (!steps.length) {
      console.log(`    Sheet "${sheetName}": tidak ada langkah, lewati`);
      continue;
    }

    /* Upload gambar ke R2 (bisa lebih dari 1 per langkah) */
    for (const step of steps) {
      const uploaded = [];
      for (let idx = 0; idx < step._images.length; idx++) {
        const { mediaPath, caption } = step._images[idx];
        if (!mediaPath) continue;
        const mediaFile = zip.files[mediaPath];
        if (!mediaFile) continue;
        try {
          const imgBuffer = await mediaFile.async('nodebuffer');
          const ext       = path.extname(mediaPath).slice(1).toLowerCase() || 'png';
          const suffix    = step._images.length === 1 ? `step_${step.no}` : `step_${step.no}_${idx}`;
          const r2Key     = `ik/${lineType}/${model}/${safeKey(variant)}/${safeKey(sheetName)}/${suffix}.${ext}`;
          await uploadToR2(r2Key, imgBuffer, ext);
          uploaded.push({ key: r2Key, caption });
          console.log(`      Langkah ${step.no}[${idx}]: gambar → ${r2Key}`);
        } catch (e) {
          console.log(`      Langkah ${step.no}[${idx}]: gagal upload — ${e.message}`);
        }
      }
      step._uploaded = uploaded;
    }

    /* Bersihkan field internal sebelum simpan ke DB */
    const stepsForDB = steps.map(({ no, text, _uploaded }) => ({
      no, text, images: _uploaded || [],
    }));

    /* Upsert ke DB */
    await pool.query(
      `INSERT INTO ik_data (line_type, model, variant, sheet, steps)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (line_type, model, variant, sheet) DO UPDATE SET steps = EXCLUDED.steps`,
      [lineType, model, variant, sheetName, JSON.stringify(stepsForDB)]
    );

    const withImg = stepsForDB.filter(s => s.images.length > 0).length;
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
      steps     JSONB NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE ik_data ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'D26A'`);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ik_data_line_type_model_variant_sheet_key'
      ) THEN
        ALTER TABLE ik_data DROP CONSTRAINT IF EXISTS ik_data_line_type_variant_sheet_key;
        ALTER TABLE ik_data ADD CONSTRAINT ik_data_line_type_model_variant_sheet_key
          UNIQUE(line_type, model, variant, sheet);
      END IF;
    END $$;
  `);
  console.log('Tabel ik_data siap.\n');

  for (const { lineType, model, folder } of IK_FOLDERS) {
    console.log(`=== Folder ${lineType} ${model}: ${folder} ===`);
    if (!fs.existsSync(folder)) { console.log(`  Folder tidak ditemukan, dilewati.\n`); continue; }

    const files = fs.readdirSync(folder)
      .filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
      .sort().map(f => path.join(folder, f));

    console.log(`  Ditemukan ${files.length} file Excel\n`);
    for (const filePath of files) {
      try { await processFile(filePath, lineType, model); }
      catch (e) { console.error(`  ERROR pada ${path.basename(filePath)}: ${e.message}`); }
    }
    console.log('');
  }

  const { rows } = await pool.query(
    `SELECT line_type, model, COUNT(DISTINCT variant) AS v, COUNT(*) AS s
     FROM ik_data GROUP BY line_type, model ORDER BY line_type, model`
  );
  console.log('=== Ringkasan ===');
  for (const r of rows) console.log(`  ${r.line_type} ${r.model}: ${r.v} variant, ${r.s} sheet`);

  await pool.end();
  console.log('\nImport selesai!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
