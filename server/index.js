import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { discoverStores, isPlacesConfigured, isSearchSpaceConfigured, isGeoapifyConfigured } from './gemini-agent.js';
import { STORE_QUERIES } from './store-queries.js';
import { verifyStockWithCall, isConfigured, updateCallStatus, recordCallResponse, getVoiceMode } from './agora-voice.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const callResults = new Map();

function sortResults(results, sortBy) {
  const sorted = [...results];
  if (sortBy === 'price') sorted.sort((a, b) => a.price - b.price);
  else if (sortBy === 'brand') sorted.sort((a, b) => a.chain.localeCompare(b.chain));
  else sorted.sort((a, b) => a.distanceKm - b.distanceKm);
  return sorted;
}

function filterResults(results, { brandFilter, chainFilter, radius }) {
  return results.filter(store => {
    if (radius && store.distanceKm > radius) return false;
    if (chainFilter && chainFilter !== 'all' && store.chain !== chainFilter) return false;
    if (brandFilter && brandFilter !== 'all') {
      const bf = brandFilter.toLowerCase();
      if (!store.chain.toLowerCase().includes(bf) && !store.name.toLowerCase().includes(bf)) return false;
    }
    return true;
  });
}

app.post('/api/search', async (req, res) => {
  const { product, brand, sortBy = 'distance', radius = 50, chainFilter, brandFilter } = req.body;
  if (!product) return res.status(400).json({ error: 'Product is required' });

  try {
    const { stores, source, agentNote } = await discoverStores(product, radius);
    let scoped = filterResults(stores, { brandFilter, chainFilter, radius });

    const callable = scoped.filter(s => s.phone && s.phone.replace(/\D/g, '').length >= 10);
    if (callable.length === 0) {
      return res.json({
        product,
        brand,
        radius,
        source,
        agentNote: `${agentNote || 'Store discovery completed.'} No callable seller phone numbers were found within ${radius}km.`,
        voiceMode: getVoiceMode(),
        totalStores: scoped.length,
        inStock: 0,
        results: []
      });
    }

    const verified = await Promise.all(callable.map(store => verifyStockWithCall(store, product)));

    verified.forEach(r => callResults.set(r.id, r));
    let results = sortResults(verified, sortBy);

    return res.json({
      product,
      brand,
      radius,
      source,
      agentNote,
      voiceMode: getVoiceMode(),
      totalStores: scoped.length,
      inStock: results.filter(r => r.available).length,
      results
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Search failed', message: err.message });
  }
});

app.get('/api/config-status', (req, res) => {
  return res.json({
    searchSpaceConfigured: isSearchSpaceConfigured(),
    geoapifyConfigured: isGeoapifyConfigured(),
    agoraConfigured: isConfigured(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    googlePlacesConfigured: isPlacesConfigured(),
    voiceMode: getVoiceMode(),
    storeCount: STORE_QUERIES.length
  });
});

app.post('/api/agora-webhook', (req, res) => {
  const storeId = req.query.storeId;
  const available = req.body?.available === true || req.body?.digits === '1';
  recordCallResponse(storeId, available);
  if (callResults.has(storeId)) {
    const store = callResults.get(storeId);
    callResults.set(storeId, {
      ...store,
      available,
      callStatus: 'COMPLETED',
      verified: true,
      note: available ? `✓ ${store.name} confirmed in stock.` : `✗ ${store.name} out of stock.`
    });
  }
  res.json({ ok: true });
});

app.get('/api/stores', async (req, res) => {
  try {
    const radius = Number(req.query.radius) || 50;
    const { stores } = await discoverStores('PlayStation 5', radius);
    return res.json({ stores, count: stores.length });
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }
});

const port = process.env.PORT || 4000;
const isVercel = !!process.env.VERCEL;
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (process.env.NODE_ENV === 'production' && !isVercel) {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

if (isDirectRun) {
  app.listen(port, () => {
    console.log(`Stock Hunt → http://localhost:${port}`);
    console.log(`SearchSpace: ${isSearchSpaceConfigured() ? 'ON' : 'OFF'} | Agora: ${getVoiceMode()} | Gemini: ${process.env.GEMINI_API_KEY ? 'ON' : 'OFF'}`);
  });
}

export default app;
