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
    INSERT INTO sk_meta (key, value) VALUES ('counter', 0)
      ON CONFLICT (key) DO NOTHING;
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!process.env.DATABASE_URL) {
    return send(res, 503, { error: 'DATABASE_URL belum dikonfigurasi di Vercel' });
  }

  try {
    await ensureDB();

    const url    = req.url.split('?')[0];
    const method = req.method;
    const body   = req.body || {};

    /* ── Status ─────────────────────────────────────────── */
    if (method === 'GET' && url === '/api/status') {
      const { rows } = await getPool().query('SELECT COUNT(*) FROM sk_records');
      return send(res, 200, { ok: true, count: parseInt(rows[0].count), ts: Date.now() });
    }

    /* ── List records ───────────────────────────────────── */
    if (method === 'GET' && url === '/api/records') {
      const { rows } = await getPool().query(
        "SELECT data FROM sk_records ORDER BY (data->>'ts')::bigint ASC"
      );
      return send(res, 200, rows.map(r => r.data));
    }

    /* ── Add record ─────────────────────────────────────── */
    if (method === 'POST' && url === '/api/records') {
      const id = await nextId();
      const r  = { id, ...body, approved: false, ts: Date.now() };
      await getPool().query('INSERT INTO sk_records (id, data) VALUES ($1, $2)', [id, r]);
      return send(res, 201, r);
    }

    /* ── Update / Delete by ID ──────────────────────────── */
    const idMatch = url.match(/^\/api\/records\/([^/]+)$/);

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

    return send(res, 404, { error: 'Endpoint tidak ditemukan' });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
};
