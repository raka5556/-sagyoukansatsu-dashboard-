/**
 * server.js — Sagyoukansatsu Dashboard
 * Mode lokal  : data/db.json
 * Mode cloud  : PostgreSQL (DATABASE_URL env var)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT   = parseInt(process.env.PORT) || 8082;
const ROOT   = __dirname;
const USE_PG = !!process.env.DATABASE_URL;

/* ══════════════════════════════════════════════════════════
   R2 OBJECT STORAGE (video)
   ══════════════════════════════════════════════════════════ */

let r2 = null;

function initR2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicUrl = process.env.R2_PUBLIC_URL;
  const bucket    = process.env.R2_BUCKET_NAME || 'sagyoukansatsu';

  if (!accessKey || !secretKey || !publicUrl || publicUrl === 'GANTI_DENGAN_URL_PUBLIC_BUCKET') {
    console.log('  ℹ️   R2  : tidak dikonfigurasi (video simpan sebagai base64)');
    return;
  }

  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    r2 = {
      client: new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      }),
      bucket,
      publicUrl: publicUrl.replace(/\/$/, ''),
    };
    console.log(`  ☁️   R2  : ${r2.publicUrl} (bucket: ${r2.bucket})`);
  } catch(e) {
    console.error('  ⚠️  R2 gagal init:', e.message);
  }
}

/* ══════════════════════════════════════════════════════════
   STORAGE LAYER
   ══════════════════════════════════════════════════════════ */

let db;

/* ── Mode A: File JSON (lokal) ───────────────────────────── */
function initFileDB() {
  const DATA_DIR = path.join(ROOT, 'data');
  const DB_FILE  = path.join(DATA_DIR, 'db.json');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  function read() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch { return { records: [], counter: 0 }; }
  }
  function write(data) {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  }
  function autoBackup() {
    const data = read();
    if (!data.records.length) return;
    const tag  = new Date().toISOString().split('T')[0];
    const dest = path.join(DATA_DIR, `backup_${tag}.json`);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf8');
      console.log(`  💾  Auto-backup: ${dest}`);
      fs.readdirSync(DATA_DIR)
        .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
        .sort().reverse().slice(7)
        .forEach(f => fs.unlinkSync(path.join(DATA_DIR, f)));
    }
  }

  setInterval(autoBackup, 60 * 60 * 1000);
  autoBackup();

  db = {
    async status()      { const d = read(); return { count: d.records.length }; },
    async all(lite)     {
      const records = read().records;
      if (!lite) return records;
      return records.map(({ video, fotoBefore, fotoAfter, ...rest }) => ({
        ...rest,
        hasVideo:      !!video,
        hasFotoBefore: !!fotoBefore,
        hasFotoAfter:  !!fotoAfter,
      }));
    },
    async get(id)       {
      const r = read().records.find(r => r.id === id);
      if (!r) throw new Error('Not found');
      return r;
    },
    async add(body)     {
      const data = read();
      data.counter = (data.counter || 0) + 1;
      const r = { id: 'SK-' + String(data.counter).padStart(3,'0'), ...body, approved: false, ts: Date.now() };
      data.records.push(r); write(data); return r;
    },
    async upd(id, patch) {
      const data = read();
      const i = data.records.findIndex(r => r.id === id);
      if (i < 0) throw new Error('Not found');
      data.records[i] = { ...data.records[i], ...patch };
      write(data); return data.records[i];
    },
    async del(id)       {
      const data = read();
      const before = data.records.length;
      data.records = data.records.filter(r => r.id !== id);
      if (data.records.length === before) throw new Error('Not found');
      write(data);
    },
    async backup()      { return read(); },
    async restore(body) {
      write({ records: body.records, counter: body.counter || body.records.length });
      return body.records.length;
    },
    dbPath: DB_FILE,
  };

  console.log(`  💾  Storage : ${DB_FILE}`);
  console.log(`  📊  Records : ${read().records.length} data tersimpan`);
}

/* ── Mode B: PostgreSQL (Railway) ────────────────────────── */
async function initPgDB() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sk_records (
      id   TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sk_meta (
      key   TEXT PRIMARY KEY,
      value BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sk_backups (
      id         SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      label      TEXT,
      data       JSONB NOT NULL
    );
    INSERT INTO sk_meta (key, value) VALUES ('counter', 0)
      ON CONFLICT (key) DO NOTHING;
  `);

  async function nextId() {
    const { rows } = await pool.query(
      "UPDATE sk_meta SET value = value + 1 WHERE key = 'counter' RETURNING value"
    );
    return 'SK-' + String(rows[0].value).padStart(3, '0');
  }
  async function getCounter() {
    const { rows } = await pool.query("SELECT value FROM sk_meta WHERE key = 'counter'");
    return parseInt(rows[0]?.value || '0');
  }

  db = {
    async status() {
      const { rows } = await pool.query('SELECT COUNT(*) FROM sk_records');
      return { count: parseInt(rows[0].count) };
    },
    async all(lite) {
      const query = lite
        ? `SELECT (data - 'video' - 'fotoBefore' - 'fotoAfter') || jsonb_build_object(
             'hasVideo',      (data->>'video')      IS NOT NULL AND data->>'video'      != '',
             'hasFotoBefore', (data->>'fotoBefore') IS NOT NULL AND data->>'fotoBefore' != '',
             'hasFotoAfter',  (data->>'fotoAfter')  IS NOT NULL AND data->>'fotoAfter'  != ''
           ) AS data FROM sk_records ORDER BY (data->>'ts')::bigint ASC`
        : "SELECT data FROM sk_records ORDER BY (data->>'ts')::bigint ASC";
      const { rows } = await pool.query(query);
      return rows.map(r => r.data);
    },
    async get(id) {
      const { rows } = await pool.query('SELECT data FROM sk_records WHERE id = $1', [id]);
      if (!rows[0]) throw new Error('Not found');
      return rows[0].data;
    },
    async add(body) {
      const id = await nextId();
      const r  = { id, ...body, approved: false, ts: Date.now() };
      await pool.query('INSERT INTO sk_records (id, data) VALUES ($1, $2)', [id, r]);
      return r;
    },
    async upd(id, patch) {
      const { rows } = await pool.query('SELECT data FROM sk_records WHERE id = $1', [id]);
      if (!rows[0]) throw new Error('Not found');
      const merged = { ...rows[0].data, ...patch };
      await pool.query('UPDATE sk_records SET data = $2 WHERE id = $1', [id, merged]);
      return merged;
    },
    async del(id) {
      const { rowCount } = await pool.query('DELETE FROM sk_records WHERE id = $1', [id]);
      if (!rowCount) throw new Error('Not found');
    },
    async backup() {
      const records = (await pool.query('SELECT data FROM sk_records')).rows.map(r => r.data);
      return { records, counter: await getCounter() };
    },
    async restore(body) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM sk_records');
        for (const r of body.records) {
          await client.query('INSERT INTO sk_records (id, data) VALUES ($1, $2)', [r.id, r]);
        }
        await client.query(
          "UPDATE sk_meta SET value = $1 WHERE key = 'counter'",
          [body.counter || body.records.length]
        );
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally     { client.release(); }
      return body.records.length;
    },
    dbPath: 'PostgreSQL (Railway)',
  };

  const { count } = await db.status();
  console.log('  🐘  Storage : PostgreSQL (Railway)');
  console.log(`  📊  Records : ${count} data tersimpan`);

  async function autoBackupPg() {
    try {
      const snap  = await db.backup();
      const label = new Date().toISOString().split('T')[0];
      await pool.query(
        'INSERT INTO sk_backups (label, data) VALUES ($1, $2)',
        [label, JSON.stringify(snap)]
      );
      await pool.query(`
        DELETE FROM sk_backups
        WHERE id NOT IN (SELECT id FROM sk_backups ORDER BY created_at DESC LIMIT 7)
      `);
      console.log(`  💾  Auto-backup: ${label} (${snap.records.length} record)`);
    } catch (e) {
      console.error('  ⚠️  Auto-backup gagal:', e.message);
    }
  }

  autoBackupPg();
  setInterval(autoBackupPg, 24 * 60 * 60 * 1000);
}

/* ══════════════════════════════════════════════════════════
   API
   ══════════════════════════════════════════════════════════ */

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => {
      try   { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function jsonRes(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(body);
}

async function handleAPI(req, res) {
  const qs     = new URLSearchParams(req.url.split('?')[1] || '');
  const url    = req.url.split('?')[0];
  const method = req.method;

  if (method === 'GET'  && url === '/api/status')    return jsonRes(res, 200, { ok: true, ...(await db.status()), ts: Date.now() });
  if (method === 'GET'  && url === '/api/r2-config') return jsonRes(res, 200, { enabled: !!r2 });
  if (method === 'GET'  && url === '/api/records')   return jsonRes(res, 200, await db.all(qs.get('lite') === '1'));
  if (method === 'POST' && url === '/api/records')   return jsonRes(res, 201, await db.add(await readBody(req)));

  if (method === 'POST' && url === '/api/presign-upload') {
    if (!r2) return jsonRes(res, 503, { error: 'R2 tidak dikonfigurasi' });
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl }     = require('@aws-sdk/s3-request-presigner');
    const body = await readBody(req);
    const ext  = (body.ext || 'mp4').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
    const key  = `videos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const cmd  = new PutObjectCommand({
      Bucket: r2.bucket, Key: key,
      ContentType: body.contentType || 'video/mp4',
    });
    const uploadUrl = await getSignedUrl(r2.client, cmd, { expiresIn: 600 });
    return jsonRes(res, 200, { uploadUrl, publicUrl: `${r2.publicUrl}/${key}` });
  }

  const idMatch = url.match(/^\/api\/records\/([^/]+)$/);
  if (method === 'GET'    && idMatch) return jsonRes(res, 200, await db.get(decodeURIComponent(idMatch[1])));
  if (method === 'PUT'    && idMatch) return jsonRes(res, 200, await db.upd(decodeURIComponent(idMatch[1]), await readBody(req)));
  if (method === 'DELETE' && idMatch) { await db.del(decodeURIComponent(idMatch[1])); return jsonRes(res, 200, { ok: true }); }

  if (method === 'GET' && url === '/api/backup') {
    const data = await db.backup();
    const date = new Date().toISOString().split('T')[0];
    res.writeHead(200, {
      'Content-Type'       : 'application/json',
      'Content-Disposition': `attachment; filename="sk_backup_${date}.json"`,
    });
    return res.end(JSON.stringify(data, null, 2));
  }

  if (method === 'POST' && url === '/api/restore') {
    const body = await readBody(req);
    if (!Array.isArray(body.records)) return jsonRes(res, 400, { error: 'Format tidak valid' });
    return jsonRes(res, 200, { ok: true, count: await db.restore(body) });
  }

  jsonRes(res, 404, { error: 'Endpoint tidak ditemukan' });
}

/* ══════════════════════════════════════════════════════════
   STATIC FILES
   ══════════════════════════════════════════════════════════ */

const MIME = {
  '.html' : 'text/html; charset=utf-8',
  '.css'  : 'text/css; charset=utf-8',
  '.js'   : 'application/javascript; charset=utf-8',
  '.json' : 'application/json',
  '.png'  : 'image/png',
  '.jpg'  : 'image/jpeg',
  '.jpeg' : 'image/jpeg',
  '.ico'  : 'image/x-icon',
  '.svg'  : 'image/svg+xml',
  '.mp4'  : 'video/mp4',
  '.webm' : 'video/webm',
  '.mov'  : 'video/quicktime',
};

function handleStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500); res.end(String(err.code)); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

/* ══════════════════════════════════════════════════════════
   HTTP SERVER
   ══════════════════════════════════════════════════════════ */

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url.startsWith('/api/')) {
    try   { await handleAPI(req, res); }
    catch (err) { jsonRes(res, 500, { error: err.message }); }
    return;
  }
  if (req.url.startsWith('/data/')) { res.writeHead(403); res.end('Forbidden'); return; }

  handleStatic(req, res);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`\n❌  Port ${PORT} sudah digunakan.\n`);
  else console.error('\n❌  Error:', err.message);
  process.exit(1);
});

/* ══════════════════════════════════════════════════════════
   BOOTSTRAP
   ══════════════════════════════════════════════════════════ */

async function start() {
  const line = '═'.repeat(56);
  console.log('\n' + line);
  console.log('  ✅   Sagyoukansatsu Dashboard  —  Server');
  console.log(line);

  initR2();

  if (USE_PG) {
    await initPgDB();
  } else {
    initFileDB();
    const skip = /virtual|vmware|vmnet|vethernet|loopback|bluetooth/i;
    Object.entries(os.networkInterfaces()).forEach(([name, addrs]) => {
      if (skip.test(name)) return;
      (addrs || []).forEach(a => {
        if (a.family === 'IPv4' && !a.internal)
          console.log(`  📱  ${name.padEnd(12)}: http://${a.address}:${PORT}  ← buka di HP`);
      });
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`  💻  Lokal   : http://localhost:${PORT}`);
    console.log(line + '\n');
  });
}

start().catch(err => {
  console.error('❌  Gagal start:', err.message);
  process.exit(1);
});
