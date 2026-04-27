/**
 * storage.js — Cloud API client untuk Sagyoukansatsu Dashboard
 */

const DB = {
  BASE: '/api',

  _cache: null,
  _cacheTs: 0,
  _cacheTTL: 30_000,
  _fullCache: new Map(),

  _invalidate() {
    this._cache = null;
    this._cacheTs = 0;
    this._fullCache.clear();
  },

  async _fetch(path, opts = {}) {
    const res = await fetch(this.BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  async all() {
    if (this._cache && Date.now() - this._cacheTs < this._cacheTTL) {
      return this._cache;
    }
    this._cache = await this._fetch('/records?lite=1');
    this._cacheTs = Date.now();
    return this._cache;
  },

  async allFull() {
    return this._fetch('/records');
  },

  async get(id) {
    if (this._fullCache.has(id)) return this._fullCache.get(id);
    const r = await this._fetch('/records/' + encodeURIComponent(id));
    this._fullCache.set(id, r);
    return r;
  },

  async add(record) {
    const result = await this._fetch('/records', {
      method: 'POST',
      body: JSON.stringify(record),
    });
    this._invalidate();
    return result;
  },

  async upd(id, updates) {
    const result = await this._fetch('/records/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    this._invalidate();
    return result;
  },

  async del(id) {
    const result = await this._fetch('/records/' + encodeURIComponent(id), { method: 'DELETE' });
    this._invalidate();
    return result;
  },

  async byYearMonth(year, month = '') {
    const all = await this.all();
    return all.filter(r => {
      const [y, m] = r.tanggal.split('-');
      if (year  && y !== String(year))                   return false;
      if (month && m !== String(month).padStart(2,'0'))  return false;
      return true;
    });
  },

  status() {
    return this._fetch('/status');
  },

  downloadBackup() {
    window.location.href = '/api/backup';
  },

  async restore(dbObject) {
    const result = await this._fetch('/restore', {
      method: 'POST',
      body: JSON.stringify(dbObject),
    });
    this._invalidate();
    return result;
  },
};
