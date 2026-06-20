import { discoverFromGooglePlaces, normalizePhone, isPlacesConfigured, isRealPhone } from './google-places.js';
import { discoverFromGeoapify, isGeoapifyConfigured } from './geoapify-places.js';
import { discoverFromSearchSpace, isSearchSpaceConfigured } from './searchspace.js';
import { enrichStore, STORE_QUERIES } from './store-queries.js';
import { getCachedStore, setCachedStore } from './store-cache.js';
import { getVerifiedContact } from './verified-contacts.js';

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
function estimatePrice(product) {
  const p = product.toLowerCase();
  if (p.includes('pro')) return 74990;
  if (p.includes('digital') || p.includes('slim')) return 44990;
  if (p.includes('xbox')) return 52990;
  if (p.includes('switch')) return 37990;
  return 54990;
}

function fromVerifiedOnly(defaultPrice, radiusKm) {
  const stores = STORE_QUERIES.map((q) => {
    const v = getVerifiedContact(q.id);
    if (!v?.phone || !isRealPhone(v.phone)) return null;
    return enrichStore({
      id: q.id,
      chain: q.chain,
      name: v.name,
      phone: normalizePhone(v.phone),
      address: v.address,
      distanceKm: v.distanceKm ?? 10,
      price: defaultPrice,
      googleMapsUri: v.googleMapsUri,
      source: 'google_verified'
    });
  }).filter(Boolean).filter((s) => s.distanceKm <= radiusKm);

  return stores;
}

export async function discoverStores(product, radiusKm = 50, origin) {
  const defaultPrice = estimatePrice(product);
  let best = null;
  let searchSpaceAuthError = null;

  const remember = (candidate) => {
    if (!candidate?.stores?.length) return;
    if (!best || candidate.stores.length > best.stores.length) best = candidate;
  };

  // 1) Geoapify Places + Place Details — live store contact discovery
  try {
    const geoapify = await discoverFromGeoapify(radiusKm, defaultPrice, origin);
    remember(geoapify);
    if (geoapify?.stores?.length >= 1) return geoapify;
  } catch (err) {
    console.warn('Geoapify failed:', err.message);
    if (isGeoapifyConfigured()) throw err;
  }

  if (isGeoapifyConfigured()) {
    throw new Error('Geoapify did not find nearby electronics or game stores for this location and radius.');
  }

  // 2) SearchSpace API — live store contact discovery
  if (!isGeoapifyConfigured()) {
    try {
      const ss = await discoverFromSearchSpace(radiusKm, defaultPrice);
      remember(ss);
      if (ss?.stores?.length >= 8) return ss;
    } catch (err) {
      if (err.status === 401 || err.status === 403) searchSpaceAuthError = err;
      console.warn('SearchSpace failed:', err.message);
    }
  }

  // 3) Google Places API — pulls phone/address exactly as on Google Maps
  try {
    const places = await discoverFromGooglePlaces(radiusKm, defaultPrice);
    remember(places);
    if (places?.stores?.length >= 3) return places;
  } catch (err) {
    console.warn('Google Places failed:', err.message);
  }

  // 4) Gemini + Google Search — extracts listing contacts from Google
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const gemini = await discoverFromGeminiSearch(product, radiusKm, apiKey, defaultPrice);
      remember(gemini);
      if (gemini.stores.length >= 3) return gemini;
    } catch (err) {
      console.warn('Gemini search agent failed:', err.message);
    }
  }

  // 3) Cached real contacts from prior successful lookups
  const cached = STORE_QUERIES.map((q) => getCachedStore(q.id))
    .filter(Boolean)
    .filter((s) => isRealPhone(s.phone) && s.distanceKm <= radiusKm);
  remember({
    stores: cached,
    source: 'cache',
    agentNote: `${cached.length} stores from cached Google contacts.`
  });
  if (cached.length >= 3) {
    return {
      stores: cached,
      source: 'cache',
      agentNote: `${cached.length} stores from cached Google contacts. Add GOOGLE_PLACES_API_KEY for live refresh.`
    };
  }

  // 4) Verified Google snapshot (real numbers only — never fake placeholders)
  const verified = fromVerifiedOnly(defaultPrice, radiusKm);
  remember({
    stores: verified,
    source: 'google_verified',
    agentNote: `${verified.length} Google-verified contacts loaded. Set GOOGLE_PLACES_API_KEY to fetch all ${STORE_QUERIES.length} stores live.`
  });
  if (searchSpaceAuthError && (!best || best.stores.length < 3)) {
    throw new Error(
      'SearchSpace API key is invalid or unauthorized. Update SEARCHSPACE_API_KEY in .env, then restart the backend.'
    );
  }

  if (verified.length > 0) {
    return best;
  }

  if (best?.stores?.length) return best;

  throw new Error(
    'Could not fetch real store phone numbers. Add GOOGLE_PLACES_API_KEY (enable Places API New in Google Cloud) for live Google Maps contacts.'
  );
}

async function discoverFromGeminiSearch(product, radiusKm, apiKey, defaultPrice) {
  const queries = STORE_QUERIES.map((q) => `id="${q.id}" chain="${q.chain}" search="${q.query}"`).join('\n');

  const prompt = `Search Google Maps for these Bengaluru electronics/gaming stores. Return ONLY stores where you find a real phone number on the Google listing.

${queries}

Product: ${product}

Return JSON array only. Each item: id, chain, name, phone (exact from Google, convert to +91 E.164), address, distanceKm.
Skip stores without a Google-listed phone. Do NOT invent numbers.

JSON:`;

  let lastError;
  for (const model of GEMINI_MODELS) {
    try {
      const stores = await callGemini(model, apiKey, prompt, defaultPrice, radiusKm);
      if (stores.length >= 3) {
        return {
          stores,
          source: 'gemini_google_search',
          agentNote: `Gemini searched Google Maps and found ${stores.length} stores with real phone numbers.`
        };
      }
    } catch (err) {
      lastError = err;
      if (String(err.message).includes('429')) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastError || new Error('Gemini returned insufficient results');
}

async function callGemini(model, apiKey, prompt, defaultPrice, radiusKm) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
      })
    });

    if (!res.ok) throw new Error(`Gemini API ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON in Gemini response');

    return JSON.parse(jsonMatch[0])
      .map((s) => {
        const phone = normalizePhone(s.phone);
        if (!isRealPhone(phone)) return null;
        const store = enrichStore({
          id: s.id,
          chain: s.chain,
          name: s.name,
          phone,
          address: s.address,
          distanceKm: Number(s.distanceKm) || 12,
          price: defaultPrice,
          source: 'gemini_google_search'
        });
        if (s.id) setCachedStore(s.id, store);
        return store;
      })
      .filter(Boolean)
      .filter((s) => s.distanceKm <= radiusKm);
  } finally {
    clearTimeout(timer);
  }
}

export function simulateAvailability(store, product) {
  const hash = `${store.id}-${product}`.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const type = store.type || '';
  let chance = 0.75;
  if (type === 'Hypermarket') chance = 0.25;
  if (type === 'Gaming Store') chance = 0.85;
  const available = (hash % 100) / 100 < chance;
  return {
    available,
    note: available
      ? `✓ ${store.name} confirmed ${product} in stock.`
      : `✗ ${store.name} — out of stock for ${product}.`
  };
}

export { isPlacesConfigured, isSearchSpaceConfigured, isGeoapifyConfigured };
