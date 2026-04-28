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

const fs   = require('fs');
const path = require('path');
const xlsx = require('xlsx');
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

async function uploadToR2(key, buffer, ext) {
  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                    : ext === 'png'  ? 'image/png'
                    : ext === 'gif'  ? 'image/gif'
                    : 'image/png';
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType,
  }));
}

/* ── Parse workbook.xml → sheet name → file path di ZIP ─── */
async function getSheetFileMap(zip) {
  const wbFile = zip.files['xl/workbook.xml'];
  const wbRelsFile = zip.files['xl/_rels/workbook.xml.rels'];
  if (!wbFile || !wbRelsFile) return {};

  const wbXml   = await wbFile.async('text');
  const relsXml = await wbRelsFile.async('text');

  /* rId → sheet name */
  const rId2Name = {};
  for (const m of wbXml.matchAll(/name="([^"]+)"[^/]*r:id="(rId\d+)"/g)) {
    rId2Name[m[2]] = m[1];
  }
  /* fallback: r:id sebelum name */
  for (const m of wbXml.matchAll(/r:id="(rId\d+)"[^/]*name="([^"]+)"/g)) {
    if (!rId2Name[m[1]]) rId2Name[m[1]] = m[2];
  }

  /* rId → file path */
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

/* ── Parse drawing XML → baris (0-indexed) → path media di ZIP ── */
async function getRowImageMap(zip, sheetFilePath) {
  const sheetFileName = path.basename(sheetFilePath);
  const relsPath = `xl/worksheets/_rels/${sheetFileName}.rels`;

  const relsFile = zip.files[relsPath];
  if (!relsFile) return {};

  const relsXml = await relsFile.async('text');

  /* Cari Target drawing dari rels */
  let drawingFileName = null;
  const dm = relsXml.match(/Target="\.\.\/drawings\/(drawing\d+\.xml)"/i);
  if (dm) drawingFileName = dm[1];
  if (!drawingFileName) return {};

  const drawingPath     = `xl/drawings/${drawingFileName}`;
  const drawingRelsPath = `xl/drawings/_rels/${drawingFileName}.rels`;

  /* rId → path media */
  const rId2Media = {};
  const drFile = zip.files[drawingRelsPath];
  if (drFile) {
    const drXml = await drFile.async('text');
    for (const m of drXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
      const t = m[2];
      if (t.includes('media/')) {
        rId2Media[m[1]] = 'xl/media/' + path.basename(t);
      }
    }
  }

  const drawingFile = zip.files[drawingPath];
  if (!drawingFile) return {};
  const drawingXml = await drawingFile.async('text');

  const rowMap = {};
  /* Match oneCellAnchor dan twoCellAnchor */
  const re = /<xdr:(one|two)CellAnchor[^>]*?>([\s\S]*?)<\/xdr:\1CellAnchor>/g;
  for (const m of drawingXml.matchAll(re)) {
    const content = m[2];
    const rowM = content.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    const ridM = content.match(/r:embed="(rId\d+)"/);
    if (rowM && ridM && rId2Media[ridM[1]]) {
      rowMap[parseInt(rowM[1])] = rId2Media[ridM[1]];
    }
  }
  return rowMap;
}

/* ── Parse urutan kerja dari satu sheet ─────────────────── */
function parseSteps(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const steps = [];
  const seen  = new Set();

  for (const row of rows) {
    const col0 = row[0];
    let no = null;

    if (typeof col0 === 'number' && Number.isInteger(col0) && col0 >= 1 && col0 <= 99) {
      no = col0;
    } else if (typeof col0 === 'string' && col0.trim()) {
      const n = parseInt(col0.trim().replace(/[^0-9]/g, ''));
      if (!isNaN(n) && n >= 1 && n <= 99) no = n;
    }

    if (no !== null && !seen.has(no)) {
      /* Cari teks di kolom B (index 1) atau C (index 2) */
      const text = (String(row[1] || '').trim() || String(row[2] || '').trim());
      if (text) {
        steps.push({ no, text, image_key: null });
        seen.add(no);
      }
    }
  }

  return steps;
}

/* ── Proses satu file Excel ──────────────────────────────── */
async function processFile(filePath, lineType) {
  console.log(`  [${lineType}] ${path.basename(filePath)}`);

  const fileBuffer = fs.readFileSync(filePath);

  /* Nama variant = nama file tanpa ekstensi + bersihkan suffix "Done ok Rev" */
  const variant = path.basename(filePath, '.xlsx')
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

    /* Mapping baris → gambar */
    const sheetFilePath = sheetFileMap[sheetName];
    let rowImageMap = {};
    if (sheetFilePath && zip.files[sheetFilePath]) {
      try { rowImageMap = await getRowImageMap(zip, sheetFilePath); }
      catch (e) { console.log(`    Sheet "${sheetName}": gambar gagal di-parse (${e.message})`); }
    }

    /* Cocokkan gambar ke setiap langkah */
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const col0 = rows[rowIdx][0];
      let no = null;

      if (typeof col0 === 'number' && Number.isInteger(col0) && col0 >= 1 && col0 <= 99) {
        no = col0;
      } else if (typeof col0 === 'string' && col0.trim()) {
        const n = parseInt(col0.trim().replace(/[^0-9]/g, ''));
        if (!isNaN(n) && n >= 1 && n <= 99) no = n;
      }

      if (no === null) continue;

      /* Cari gambar di baris ini atau satu baris sebelum/sesudah */
      const mediaPath = rowImageMap[rowIdx]
                     || rowImageMap[rowIdx + 1]
                     || rowImageMap[rowIdx - 1]
                     || null;

      if (!mediaPath) continue;

      const mediaFile = zip.files[mediaPath];
      if (!mediaFile) continue;

      const step = steps.find(s => s.no === no);
      if (!step || step.image_key) continue; /* skip jika sudah ada gambar */

      try {
        const imgBuffer = await mediaFile.async('nodebuffer');
        const ext       = path.extname(mediaPath).slice(1).toLowerCase() || 'png';
        const r2Key     = `ik/${lineType}/${safeKey(variant)}/${safeKey(sheetName)}/step_${no}.${ext}`;
        await uploadToR2(r2Key, imgBuffer, ext);
        step.image_key = r2Key;
        console.log(`      Langkah ${no}: gambar → ${r2Key}`);
      } catch (e) {
        console.log(`      Langkah ${no}: gagal upload gambar — ${e.message}`);
      }
    }

    /* Simpan ke DB */
    await pool.query(
      `INSERT INTO ik_data (line_type, variant, sheet, steps)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (line_type, variant, sheet) DO UPDATE SET steps = EXCLUDED.steps`,
      [lineType, variant, sheetName, JSON.stringify(steps)]
    );

    const withImg = steps.filter(s => s.image_key).length;
    console.log(`    Sheet "${sheetName}": ${steps.length} langkah disimpan (${withImg} ada gambar)`);
  }
}

/* ── Main ────────────────────────────────────────────────── */
async function main() {
  console.log('=== IK Import Script ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL tidak ditemukan di .env');
    process.exit(1);
  }
  if (!process.env.R2_ACCOUNT_ID) {
    console.error('ERROR: R2_ACCOUNT_ID tidak ditemukan di .env');
    process.exit(1);
  }

  /* Pastikan tabel ada */
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

    if (!fs.existsSync(folderPath)) {
      console.log(`  Folder tidak ditemukan, dilewati.\n`);
      continue;
    }

    const files = fs.readdirSync(folderPath)
      .filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
      .sort()
      .map(f => path.join(folderPath, f));

    console.log(`  Ditemukan ${files.length} file Excel\n`);

    for (const filePath of files) {
      try {
        await processFile(filePath, lineType);
      } catch (e) {
        console.error(`  ERROR pada file ${path.basename(filePath)}: ${e.message}`);
      }
    }
    console.log('');
  }

  /* Ringkasan */
  const { rows } = await pool.query(
    'SELECT line_type, COUNT(DISTINCT variant) AS v, COUNT(*) AS s FROM ik_data GROUP BY line_type'
  );
  console.log('=== Ringkasan ===');
  for (const r of rows) {
    console.log(`  ${r.line_type}: ${r.v} variant, ${r.s} sheet`);
  }

  await pool.end();
  console.log('\nImport selesai!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
