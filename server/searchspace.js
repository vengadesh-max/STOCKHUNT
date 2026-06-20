import { enrichStore, STORE_QUERIES } from './store-queries.js';
import { normalizePhone, isRealPhone } from './google-places.js';
import { getCachedStore, setCachedStore } from './store-cache.js';
import { getVerifiedContact } from './verified-contacts.js';

const BASE = process.env.SEARCHSPACE_API_URL || 'https://zues.searchagora.com/api/v1';
const BLR = { lat: 12.9716, lng: 77.5946 };

function haversineKm(lat, lng) {
  const R = 6371;
  const dLat = ((lat - BLR.lat) * Math.PI) / 180;
  const dLng = ((lng - BLR.lng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((BLR.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function extractPhone(text) {
  if (!text) return null;
  const s = String(text);
  const patterns = [/\+91[\s-]?[6-9]\d{4}[\s-]?\d{5}/g, /(?:^|\s)([6-9]\d{9})(?:\s|$)/g, /0([6-9]\d{9})/g];
  for (const p of patterns) {
    const m = s.match(p);
    if (m?.[0]) return normalizePhone(m[0].trim());
  }
  return null;
}

async function api(path, body, apiKey) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.data || `SearchSpace ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function resolveStore(entry, apiKey, defaultPrice) {
  const cached = getCachedStore(entry.id);
  if (cached?.phone && isRealPhone(cached.phone)) return cached;

  try {
    const data = await api('/deep-search', {
      query: `${entry.query} Google Maps phone number address contact Bengaluru Karnataka India`
    }, apiKey);

    const blob = JSON.stringify(data.data || data);
    const phone = extractPhone(blob) || extractPhone(data.data?.aiResponse);
    if (!phone || !isRealPhone(phone)) return null;

    const lat = data.data?.latitude || data.data?.lat;
    const lng = data.data?.longitude || data.data?.lng;
    const store = enrichStore({
      id: entry.id,
      chain: entry.chain,
      name: data.data?.name || entry.query,
      phone,
      address: data.data?.address || data.data?.description || entry.query,
      distanceKm: lat && lng ? haversineKm(Number(lat), Number(lng)) : 10,
      price: defaultPrice,
      source: 'searchspace'
    });
    setCachedStore(entry.id, store);
    return store;
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw err;

    const verified = getVerifiedContact(entry.id);
    if (!verified?.phone) return null;

    const store = enrichStore({
      id: entry.id,
      chain: entry.chain,
      name: verified.name,
      phone: normalizePhone(verified.phone),
      address: verified.address,
      distanceKm: verified.distanceKm ?? 5,
      price: defaultPrice,
      source: 'searchspace_verified'
    });
    setCachedStore(entry.id, store);
    return store;
  }
}

async function runBatch(items, fn, size = 4) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const results = await Promise.allSettled(batch.map(fn));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
      if (r.status === 'rejected' && (r.reason?.status === 401 || r.reason?.status === 403)) {
        throw r.reason;
      }
    }
    if (i + size < items.length) await new Promise(r => setTimeout(r, 200));
  }
  return out;
}

export async function discoverFromSearchSpace(radiusKm = 50, defaultPrice = 54990) {
  const apiKey = process.env.SEARCHSPACE_API_KEY;
  if (!apiKey) return null;

  const stores = await runBatch(
    STORE_QUERIES,
    (q) => resolveStore(q, apiKey, defaultPrice)
  );

  if (stores.length < 3) {
    try {
      const chains = [...new Set(STORE_QUERIES.map(q => q.chain))].join(', ');
      const data = await api('/deep-search', {
        query: `${chains} electronics gaming stores Bengaluru Karnataka India phone numbers addresses Google Maps`
      }, apiKey);
      const text = JSON.stringify(data.data || data);
      for (const q of STORE_QUERIES) {
        if (stores.find(s => s.id === q.id)) continue;
        const chunk = text.includes(q.chain) ? text : '';
        const phone = extractPhone(chunk) || extractPhone(data.data?.aiResponse);
        if (phone && isRealPhone(phone)) {
          stores.push(enrichStore({
            id: q.id,
            chain: q.chain,
            name: q.query,
            phone,
            address: q.query,
            distanceKm: 10,
            price: defaultPrice,
            source: 'searchspace'
          }));
        }
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw err;
      console.warn('SearchSpace deep-search:', err.message);
    }
  }

  const inRadius = stores.filter(s => s.distanceKm <= radiusKm && isRealPhone(s.phone));
  if (!inRadius.length) return null;

  return {
    stores: inRadius,
    source: 'searchspace',
    agentNote: `SearchSpace found ${inRadius.length} Bengaluru stores with real phone numbers.`
  };
}

export function isSearchSpaceConfigured() {
  return !!process.env.SEARCHSPACE_API_KEY;
}
