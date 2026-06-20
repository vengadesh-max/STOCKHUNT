import { enrichStore, STORE_QUERIES } from './store-queries.js';
import { normalizePhone, isRealPhone } from './google-places.js';
import { getCachedStore, setCachedStore } from './store-cache.js';

const PLACES_URL = 'https://api.geoapify.com/v2/places';
const DETAILS_URL = 'https://api.geoapify.com/v2/place-details';
const GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';
const BLR = { lat: 12.9716, lng: 77.5946 };
const CATEGORIES = [
  'commercial.elektronics',
  'commercial.toy_and_game',
  'commercial.supermarket',
  'commercial.department_store',
  'commercial.shopping_mall'
].join(',');

function haversineKm(lat, lng) {
  const R = 6371;
  const dLat = ((lat - BLR.lat) * Math.PI) / 180;
  const dLng = ((lng - BLR.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((BLR.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

function apiError(status, data) {
  const err = new Error(data?.message || data?.error || `Geoapify ${status}`);
  err.status = status;
  return err;
}

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(res.status, data);
  return data;
}

function pickPhone(props = {}) {
  const candidates = [
    props.contact?.phone,
    ...(props.contact?.phone_other || []),
    ...Object.values(props.contact?.phone_international || {}),
    props.phone
  ].filter(Boolean);

  for (const candidate of candidates) {
    const phone = normalizePhone(candidate);
    if (isRealPhone(phone)) return phone;
  }
  return null;
}

function placeKey(store) {
  return store.phone || `${store.name}-${store.address}`.toLowerCase();
}

function scorePlace(entry, feature) {
  const props = feature.properties || {};
  const haystack = `${props.name || ''} ${props.formatted || ''} ${props.address_line1 || ''}`.toLowerCase();
  const terms = entry.query
    .toLowerCase()
    .replace(/\bbengaluru\b|\bbangalore\b|\bgoogle maps\b/g, '')
    .split(/\s+/)
    .filter((term) => term.length > 2);

  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function chainMatches(entry, feature) {
  const props = feature.properties || {};
  const haystack = `${props.name || ''} ${props.formatted || ''} ${props.address_line1 || ''}`.toLowerCase();
  const tokens = entry.chain.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  return tokens.every((term) => haystack.includes(term));
}

async function searchPlace(entry, radiusKm, apiKey) {
  const textParams = new URLSearchParams({
    text: entry.query,
    filter: `circle:${BLR.lng},${BLR.lat},${radiusKm * 1000}`,
    bias: `proximity:${BLR.lng},${BLR.lat}`,
    limit: '8',
    lang: 'en',
    apiKey
  });

  const textData = await getJson(`${GEOCODE_URL}?${textParams}`);
  const textFeatures = textData.features || [];
  const matched = textFeatures
    .filter((feature) => chainMatches(entry, feature))
    .map((feature) => ({ feature, score: scorePlace(entry, feature) }))
    .sort((a, b) => b.score - a.score)[0]?.feature;
  if (matched) return matched;

  const params = new URLSearchParams({
    categories: CATEGORIES,
    filter: `circle:${BLR.lng},${BLR.lat},${radiusKm * 1000}`,
    bias: `proximity:${BLR.lng},${BLR.lat}`,
    name: entry.chain,
    limit: '20',
    lang: 'en',
    apiKey
  });

  const data = await getJson(`${PLACES_URL}?${params}`);
  const features = data.features || [];
  if (!features.length) return null;

  return features
    .filter((feature) => chainMatches(entry, feature))
    .map((feature) => ({ feature, score: scorePlace(entry, feature) }))
    .sort((a, b) => b.score - a.score)[0]?.feature || null;
}

async function fetchDetails(placeId, apiKey) {
  if (!placeId) return null;
  const params = new URLSearchParams({
    id: placeId,
    features: 'details',
    lang: 'en',
    apiKey
  });
  const data = await getJson(`${DETAILS_URL}?${params}`);
  return data.features?.find((f) => f.properties?.feature_type === 'details') || data.features?.[0] || null;
}

async function resolveStore(entry, radiusKm, defaultPrice, apiKey) {
  const cached = getCachedStore(`geoapify:${entry.id}`);
  if (cached?.phone && isRealPhone(cached.phone)) return cached;

  const place = await searchPlace(entry, radiusKm, apiKey);
  if (!place) return null;

  const details = await fetchDetails(place.properties?.place_id, apiKey);
  const props = { ...(place.properties || {}), ...(details?.properties || {}) };
  const phone = pickPhone(props);

  const lat = Number(props.lat ?? place.properties?.lat ?? place.geometry?.coordinates?.[1] ?? BLR.lat);
  const lng = Number(props.lon ?? place.properties?.lon ?? place.geometry?.coordinates?.[0] ?? BLR.lng);
  const store = enrichStore({
    id: entry.id,
    chain: entry.chain,
    name: props.name || entry.query,
    phone,
    address: props.formatted || props.address_line1 || entry.query,
    distanceKm: haversineKm(lat, lng),
    price: defaultPrice,
    priceSource: 'msrp_estimate',
    googleMapsUri: props.datasource?.raw?.website || props.website,
    source: 'geoapify'
  });

  setCachedStore(`geoapify:${entry.id}`, store);
  return store;
}

async function scanNearbyStores(radiusKm, defaultPrice, apiKey) {
  const limit = Number(process.env.GEOAPIFY_SCAN_LIMIT) || 80;
  const params = new URLSearchParams({
    categories: CATEGORIES,
    filter: `circle:${BLR.lng},${BLR.lat},${radiusKm * 1000}`,
    bias: `proximity:${BLR.lng},${BLR.lat}`,
    limit: String(limit),
    lang: 'en',
    apiKey
  });

  const data = await getJson(`${PLACES_URL}?${params}`);
  const features = data.features || [];
  const stores = await runBatch(features, async (feature) => {
    const details = await fetchDetails(feature.properties?.place_id, apiKey);
    const props = { ...(feature.properties || {}), ...(details?.properties || {}) };
    const name = props.name || props.address_line1;
    if (!name) return null;

    const lat = Number(props.lat ?? feature.properties?.lat ?? feature.geometry?.coordinates?.[1] ?? BLR.lat);
    const lng = Number(props.lon ?? feature.properties?.lon ?? feature.geometry?.coordinates?.[0] ?? BLR.lng);
    const chain = props.brand || name;

    return enrichStore({
      id: `geoapify-${props.place_id || `${lat}-${lng}`}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
      chain,
      name,
      phone: pickPhone(props),
      address: props.formatted || props.address_line1 || '',
      distanceKm: haversineKm(lat, lng),
      price: defaultPrice,
      priceSource: 'msrp_estimate',
      googleMapsUri: props.datasource?.raw?.website || props.website,
      source: 'geoapify_scan'
    });
  }, 8);

  return stores.filter(Boolean);
}

async function runBatch(items, fn, size = 3) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const results = await Promise.allSettled(batch.map(fn));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
      if (r.status === 'rejected' && (r.reason?.status === 401 || r.reason?.status === 403)) throw r.reason;
    }
    if (i + size < items.length) await new Promise(r => setTimeout(r, 200));
  }
  return out;
}

export async function discoverFromGeoapify(radiusKm = 50, defaultPrice = 54990) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return null;

  const stores = await runBatch(
    STORE_QUERIES,
    (q) => resolveStore(q, radiusKm, defaultPrice, apiKey)
  );
  const scanned = await scanNearbyStores(radiusKm, defaultPrice, apiKey);
  const unique = [...new Map([...stores, ...scanned].map((store) => [placeKey(store), store])).values()]
    .filter((store) => store.distanceKm <= radiusKm);

  if (!unique.length) return null;
  const callable = unique.filter((store) => isRealPhone(store.phone)).length;
  return {
    stores: unique,
    source: 'geoapify',
    agentNote: `Geoapify found ${unique.length} nearby electronics/game stores; ${callable} have callable phone numbers.`
  };
}

export function isGeoapifyConfigured() {
  return !!process.env.GEOAPIFY_API_KEY;
}
