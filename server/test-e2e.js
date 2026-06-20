import dotenv from 'dotenv';
dotenv.config();

const BASE = `http://localhost:${process.env.PORT || 4000}`;

async function run() {
  console.log('=== E2E TEST ===\n');

  const cfg = await fetch(`${BASE}/api/config-status`).then(r => r.json());
  console.log('Config:', cfg);

  const body = { product: 'PlayStation 5 (Disc)', radius: 50, sortBy: 'distance' };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  console.log(`\nSearch (${Date.now() - t0}ms):`, res.status);
  console.log('Source:', data.source);
  console.log('Voice:', data.voiceMode);
  console.log('Agent:', data.agentNote);
  console.log('Stores called:', data.totalStores, '| In stock:', data.inStock);

  if (data.results?.length) {
    console.log('\nSample results:');
    data.results.slice(0, 5).forEach(s => {
      console.log(`  ${s.available ? '✓' : '✗'} ${s.name} | ${s.phone} | ${s.note}`);
    });
  } else {
    console.log('Error:', data.message || data.error);
    process.exit(1);
  }

  console.log('\n=== PASS ===');
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
