/**
 * api/index.js — Vercel Serverless Function
 * Menangani semua route /api/* untuk Sagyoukansatsu Dashboard
 */

const { Pool } = require('pg');

let _pool  = null;
let _ready = false;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

async function ensureDB() {
  if (_ready) return;
  await getPool().query(`
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
    CREATE TABLE IF NOT EXISTS ik_data (
      id        SERIAL PRIMARY KEY,
      line_type TEXT NOT NULL,
      variant   TEXT NOT NULL,
      sheet     TEXT NOT NULL,
      steps     JSONB NOT NULL,
      UNIQUE(line_type, variant, sheet)
    );
    INSERT INTO sk_meta (key, value) VALUES ('counter', 0)
      ON CONFLICT (key) DO NOTHING;
  `);
  await getPool().query(`
    ALTER TABLE ik_data ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'D26A';
  `);
  await getPool().query(`
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
  _ready = true;
}

async function nextId() {
  const { rows } = await getPool().query(
    "UPDATE sk_meta SET value = value + 1 WHERE key = 'counter' RETURNING value"
  );
  return 'SK-' + String(rows[0].value).padStart(3, '0');
}

function send(res, code, data) {
  res.status(code).json(data);
}

/* ── R2 / Cloudflare Object Storage ───────────────────────── */
function r2Enabled() {
  return !!(
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_PUBLIC_URL &&
    process.env.R2_PUBLIC_URL !== 'GANTI_DENGAN_URL_PUBLIC_BUCKET'
  );
}

function getR2() {
  const { S3Client } = require('@aws-sdk/client-s3');
  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    }),
    bucket:    process.env.R2_BUCKET_NAME || 'sagyoukansatsu',
    publicUrl: (process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const url    = req.url.split('?')[0];
  const method = req.method;
  const body   = req.body || {};
  const qs     = req.query || {};

  /* ── R2 status (tidak perlu DB) ─────────────────────────── */
  if (method === 'GET' && url === '/api/r2-config') {
    return send(res, 200, { enabled: r2Enabled() });
  }

  /* ── Proxy foto dari R2 (atasi masalah spasi di key) ────── */
  if (method === 'GET' && url === '/api/serve-photo') {
    if (!r2Enabled()) return send(res, 503, { error: 'R2 tidak dikonfigurasi' });
    const r2Key = qs.key;
    if (!r2Key) return send(res, 400, { error: 'key wajib diisi' });
    try {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const r2  = getR2();
      const obj = await r2.client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: r2Key }));
      const chunks = [];
      for await (const chunk of obj.Body) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type', obj.ContentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=60');
      res.status(200).send(buf);
    } catch (e) {
      return send(res, 404, { error: 'Foto tidak ditemukan: ' + e.message });
    }
    return;
  }

  /* ── Presigned GET URL untuk video ──────────────────────── */
  if (method === 'GET' && url === '/api/video-url') {
    if (!r2Enabled()) return send(res, 503, { error: 'R2 tidak dikonfigurasi' });
    const r2Key = qs.key;
    if (!r2Key) return send(res, 400, { error: 'key wajib diisi' });
    try {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl }     = require('@aws-sdk/s3-request-presigner');
      const r2  = getR2();
      const cmd = new GetObjectCommand({ Bucket: r2.bucket, Key: r2Key });
      const signedUrl = await getSignedUrl(r2.client, cmd, { expiresIn: 3600 });
      return send(res, 200, { signedUrl });
    } catch (e) {
      return send(res, 404, { error: 'Video tidak ditemukan: ' + e.message });
    }
  }

  /* ── Presigned URL untuk upload video ke R2 ─────────────── */
  if (method === 'POST' && url === '/api/presign-upload') {
    if (!r2Enabled()) return send(res, 503, { error: 'R2 tidak dikonfigurasi' });
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl }     = require('@aws-sdk/s3-request-presigner');
    const r2   = getR2();
    const type = body.type || 'video';
    const ext  = ((body.ext || (type === 'photo' ? 'jpg' : 'mp4'))
                   .replace(/[^a-zA-Z0-9]/g, '') || 'jpg').slice(0, 10);

    let key;
    if (type === 'photo') {
      const m      = body.meta || {};
      const safe   = s => String(s || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
      const line   = safe(m.line);
      const tgl    = String(m.tanggal || new Date().toISOString().split('T')[0]).replace(/[^0-9-]/g, '');
      const pic    = safe(m.pic);
      const pos    = safe(m.pos);
      const which  = body.which === 'after' ? 'after' : 'before';
      key = `photos/${line}/${tgl}/${pic}/${pos}/${which}_${Date.now()}.${ext}`;
    } else {
      key = `videos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    }

    const cmd = new PutObjectCommand({
      Bucket:      r2.bucket,
      Key:         key,
      ContentType: body.contentType || (type === 'photo' ? 'image/jpeg' : 'video/mp4'),
    });
    const uploadUrl = await getSignedUrl(r2.client, cmd, { expiresIn: 600 });
    return send(res, 200, { uploadUrl, publicUrl: `${r2.publicUrl}/${key}` });
  }

  if (!process.env.DATABASE_URL) {
    return send(res, 503, { error: 'DATABASE_URL belum dikonfigurasi di Vercel' });
  }

  try {
    await ensureDB();

    /* ── Status ─────────────────────────────────────────── */
    if (method === 'GET' && url === '/api/status') {
      const { rows } = await getPool().query('SELECT COUNT(*) FROM sk_records');
      return send(res, 200, { ok: true, count: parseInt(rows[0].count), ts: Date.now() });
    }

    /* ── List records ───────────────────────────────────── */
    if (method === 'GET' && url === '/api/records') {
      const lite = qs.lite === '1';
      const query = lite
        ? `SELECT (data - 'video' - 'fotoBefore' - 'fotoAfter') || jsonb_build_object(
             'hasVideo',      (data->>'video')      IS NOT NULL AND data->>'video'      != '',
             'hasFotoBefore', (data->>'fotoBefore') IS NOT NULL AND data->>'fotoBefore' != '',
             'hasFotoAfter',  (data->>'fotoAfter')  IS NOT NULL AND data->>'fotoAfter'  != ''
           ) AS data FROM sk_records ORDER BY (data->>'ts')::bigint ASC`
        : "SELECT data FROM sk_records ORDER BY (data->>'ts')::bigint ASC";
      const { rows } = await getPool().query(query);
      return send(res, 200, rows.map(r => r.data));
    }

    /* ── Add record ─────────────────────────────────────── */
    if (method === 'POST' && url === '/api/records') {
      const id = await nextId();
      const r  = { id, ...body, approved: false, ts: Date.now() };
      await getPool().query('INSERT INTO sk_records (id, data) VALUES ($1, $2)', [id, r]);
      return send(res, 201, r);
    }

    /* ── Update / Delete / Get by ID ───────────────────── */
    const idMatch = url.match(/^\/api\/records\/([^/]+)$/);

    if (method === 'GET' && idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      const { rows } = await getPool().query('SELECT data FROM sk_records WHERE id = $1', [id]);
      if (!rows[0]) return send(res, 404, { error: 'Not found' });
      return send(res, 200, rows[0].data);
    }

    if (method === 'PUT' && idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      const { rows } = await getPool().query('SELECT data FROM sk_records WHERE id = $1', [id]);
      if (!rows[0]) return send(res, 404, { error: 'Not found' });
      const merged = { ...rows[0].data, ...body };
      await getPool().query('UPDATE sk_records SET data = $2 WHERE id = $1', [id, merged]);
      return send(res, 200, merged);
    }

    if (method === 'DELETE' && idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      const { rowCount } = await getPool().query('DELETE FROM sk_records WHERE id = $1', [id]);
      if (!rowCount) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { ok: true });
    }

    /* ── Backup download ────────────────────────────────── */
    if (method === 'GET' && url === '/api/backup') {
      const records = (await getPool().query('SELECT data FROM sk_records')).rows.map(r => r.data);
      const { rows } = await getPool().query("SELECT value FROM sk_meta WHERE key = 'counter'");
      const counter  = parseInt(rows[0]?.value || '0');
      const date     = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Disposition', `attachment; filename="sk_backup_${date}.json"`);
      return send(res, 200, { records, counter });
    }

    /* ── Restore ────────────────────────────────────────── */
    if (method === 'POST' && url === '/api/restore') {
      if (!Array.isArray(body.records)) return send(res, 400, { error: 'Format tidak valid' });
      const client = await getPool().connect();
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
      return send(res, 200, { ok: true, count: body.records.length });
    }

    /* ── IK: list models untuk satu line ───────────────── */
    if (method === 'GET' && url === '/api/ik/models') {
      const line = qs.line;
      if (!line) return send(res, 400, { error: 'line wajib diisi (FB atau FC)' });
      const { rows } = await getPool().query(
        `SELECT DISTINCT model FROM ik_data WHERE line_type = $1 ORDER BY model`,
        [line]
      );
      return send(res, 200, rows.map(r => r.model));
    }

    /* ── IK: list variants ──────────────────────────────── */
    if (method === 'GET' && url === '/api/ik/variants') {
      const line  = qs.line;
      const model = qs.model || 'D26A';
      if (!line) return send(res, 400, { error: 'line wajib diisi (FB atau FC)' });
      const { rows } = await getPool().query(
        `SELECT variant, COUNT(*) AS sheet_count
         FROM ik_data WHERE line_type = $1 AND model = $2
         GROUP BY variant
         ORDER BY (CASE WHEN variant ~ '^[0-9]'
                        THEN (regexp_replace(variant, '^([0-9]+).*', '\\1'))::integer
                        ELSE 9999 END), variant`,
        [line, model]
      );
      return send(res, 200, rows.map(r => ({ variant: r.variant, sheetCount: parseInt(r.sheet_count) })));
    }

    /* ── IK: list sheets untuk satu variant ─────────────── */
    if (method === 'GET' && url === '/api/ik/sheets') {
      const { line, variant } = qs;
      const model = qs.model || 'D26A';
      if (!line || !variant) return send(res, 400, { error: 'line dan variant wajib diisi' });
      const { rows } = await getPool().query(
        'SELECT sheet FROM ik_data WHERE line_type = $1 AND model = $2 AND variant = $3',
        [line, model, variant]
      );
      const sheets = rows.map(r => r.sheet).sort((a, b) => {
        const na = parseInt(a) || 0;
        const nb = parseInt(b) || 0;
        return na !== nb ? na - nb : a.localeCompare(b);
      });
      return send(res, 200, sheets);
    }

    /* ── IK: steps untuk satu sheet ─────────────────────── */
    if (method === 'GET' && url === '/api/ik/steps') {
      const { line, variant, sheet } = qs;
      const model = qs.model || 'D26A';
      if (!line || !variant || !sheet) return send(res, 400, { error: 'line, variant, dan sheet wajib diisi' });
      const { rows } = await getPool().query(
        'SELECT steps FROM ik_data WHERE line_type = $1 AND model = $2 AND variant = $3 AND sheet = $4',
        [line, model, variant, sheet]
      );
      if (!rows[0]) return send(res, 404, { error: 'Data IK tidak ditemukan' });
      return send(res, 200, rows[0].steps);
    }

    return send(res, 404, { error: 'Endpoint tidak ditemukan' });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
};
