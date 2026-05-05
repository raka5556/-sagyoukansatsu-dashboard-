require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(
  "SELECT sheet FROM ik_data WHERE line_type='FC' AND model='D26A' GROUP BY sheet ORDER BY sheet"
).then(r => {
  r.rows.forEach(x => console.log(JSON.stringify(x.sheet)));
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
