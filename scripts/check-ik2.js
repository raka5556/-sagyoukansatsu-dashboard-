require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Contoh steps D26A
  console.log('=== Contoh steps FB D26A ===');
  const { rows: a } = await pool.query(
    `SELECT variant, sheet, steps FROM ik_data WHERE line_type='FB' AND model='D26A' LIMIT 3`
  );
  a.forEach(r => {
    console.log(`variant: ${r.variant} | sheet: ${r.sheet}`);
    console.log(`steps[0]: ${JSON.stringify(r.steps[0]).slice(0,300)}`);
    console.log('---');
  });

  // Contoh steps D37D
  console.log('\n=== Contoh steps FB D37D ===');
  const { rows: b } = await pool.query(
    `SELECT variant, sheet, steps FROM ik_data WHERE line_type='FB' AND model='D37D' LIMIT 3`
  );
  if (!b.length) { console.log('  Tidak ada data'); }
  b.forEach(r => {
    console.log(`variant: ${r.variant} | sheet: ${r.sheet}`);
    console.log(`steps count: ${r.steps.length}`);
    console.log(`steps[0]: ${JSON.stringify(r.steps[0]).slice(0,300)}`);
    console.log('---');
  });

  // Bandingkan jumlah steps per sheet
  console.log('\n=== Rata-rata steps per sheet ===');
  const { rows: c } = await pool.query(
    `SELECT line_type, model,
       ROUND(AVG(jsonb_array_length(steps)),1) AS avg_steps,
       MAX(jsonb_array_length(steps)) AS max_steps,
       COUNT(*) AS sheets
     FROM ik_data GROUP BY line_type, model ORDER BY line_type, model`
  );
  c.forEach(r => console.log(`  ${r.line_type} ${r.model}: avg ${r.avg_steps} steps, max ${r.max_steps}, total ${r.sheets} sheets`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
