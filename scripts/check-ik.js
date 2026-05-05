require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Ringkasan per line+model
  const { rows: summary } = await pool.query(
    `SELECT line_type, model, COUNT(DISTINCT variant) AS variants, COUNT(*) AS sheets
     FROM ik_data GROUP BY line_type, model ORDER BY line_type, model`
  );
  console.log('=== Ringkasan ik_data ===');
  summary.forEach(r => console.log(`  ${r.line_type} ${r.model}: ${r.variants} variant, ${r.sheets} sheet`));

  // Contoh 1 baris steps untuk lihat struktur
  console.log('\n=== Contoh struktur steps (FB D26A, 1 sheet) ===');
  const { rows: sample } = await pool.query(
    `SELECT variant, sheet, steps FROM ik_data WHERE line_type='FB' AND model='D26A' LIMIT 1`
  );
  if (sample[0]) {
    console.log('variant:', sample[0].variant);
    console.log('sheet:', sample[0].sheet);
    const steps = sample[0].steps;
    console.log('steps count:', steps.length);
    console.log('step[0]:', JSON.stringify(steps[0]).slice(0, 200));
    if (steps[0]?.images?.length) {
      console.log('  images[0].key:', steps[0].images[0].key);
    }
  }

  // Cek apakah ada steps yang punya images vs tidak
  console.log('\n=== FB D26A: sheets dengan gambar vs tanpa ===');
  const { rows: imgStats } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE jsonb_array_length(steps) > 0
         AND steps->0->'images' IS NOT NULL
         AND jsonb_array_length(steps->0->'images') > 0) AS with_images,
       COUNT(*) FILTER (WHERE steps = '[]'::jsonb OR
         steps->0->'images' IS NULL OR
         jsonb_array_length(steps->0->'images') = 0) AS without_images,
       COUNT(*) AS total
     FROM ik_data WHERE line_type='FB' AND model='D26A'`
  );
  console.log('  with images:', imgStats[0].with_images);
  console.log('  without images:', imgStats[0].without_images);
  console.log('  total:', imgStats[0].total);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
