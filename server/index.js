import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { discoverStores, isPlacesConfigured, isSearchSpaceConfigured, isGeoapifyConfigured } from './gemini-agent.js';
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
  const { product, brand, sortBy = 'distance', radius = 50, chainFilter, brandFilter, includeDiscovered = false, lat, lng } = req.body;
  if (!product) return res.status(400).json({ error: 'Product is required' });
  const origin = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
    return res.status(400).json({ error: 'Location is required', message: 'Allow browser location so the app can search shops around you.' });
  }

  try {
    const { stores, source, agentNote } = await discoverStores(product, radius, origin);
    let scoped = filterResults(stores, { brandFilter, chainFilter, radius });

    const callable = scoped.filter(s => s.phone && s.phone.replace(/\D/g, '').length >= 10);
    if (callable.length === 0) {
      const results = sortResults(scoped.map((store) => ({
        ...store,
        available: false,
        callStatus: 'SKIPPED',
        verified: false,
        note: store.phone
          ? `Could not call ${store.name}; phone number is not in a callable format.`
          : `Discovered nearby, but Geoapify has no phone number for ${store.name}.`
      })), sortBy);

      return res.json({
        product,
        brand,
        radius,
        source,
        agentNote: `${agentNote || 'Store discovery completed.'} No callable seller phone numbers were found within ${radius}km.`,
        voiceMode: getVoiceMode(),
        discoveredStores: scoped.length,
        calledStores: 0,
        totalStores: scoped.length,
        inStock: 0,
        results: includeDiscovered ? results : []
      });
    }

    const verified = await Promise.all(callable.map(store => verifyStockWithCall(store, product)));
    const verifiedIds = new Set(verified.map((store) => store.id));
    const skipped = scoped
      .filter((store) => !verifiedIds.has(store.id))
      .map((store) => ({
        ...store,
        available: false,
        callStatus: 'SKIPPED',
        verified: false,
        note: store.phone
          ? `Could not call ${store.name}; phone number is not in a callable format.`
          : `Discovered nearby, but Geoapify has no phone number for ${store.name}.`
      }));

    verified.forEach(r => callResults.set(r.id, r));
    let results = sortResults(includeDiscovered ? [...verified, ...skipped] : verified, sortBy);

    return res.json({
      product,
      brand,
      radius,
      source,
      agentNote,
      voiceMode: getVoiceMode(),
      discoveredStores: scoped.length,
      calledStores: callable.length,
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
    storeSource: 'geoapify_live_scan'
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
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const { stores } = await discoverStores('PlayStation 5', radius, { lat, lng });
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
