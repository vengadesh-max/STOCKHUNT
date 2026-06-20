import { enrichStore } from './store-queries.js';
import { normalizePhone, isRealPhone } from './google-places.js';

const PLACES_URL = 'https://api.geoapify.com/v2/places';
const DETAILS_URL = 'https://api.geoapify.com/v2/place-details';
const CATEGORIES = [
  'commercial.elektronics',
  'commercial.toy_and_game',
  'commercial.supermarket',
  'commercial.department_store',
  'commercial.shopping_mall'
].join(',');

function haversineKm(origin, lat, lng) {
  const R = 6371;
  const dLat = ((lat - origin.lat) * Math.PI) / 180;
  const dLng = ((lng - origin.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((origin.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
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

async function scanNearbyStores(radiusKm, defaultPrice, apiKey, origin) {
  const limit = Number(process.env.GEOAPIFY_SCAN_LIMIT) || 80;
  const params = new URLSearchParams({
    categories: CATEGORIES,
    filter: `circle:${origin.lng},${origin.lat},${radiusKm * 1000}`,
    bias: `proximity:${origin.lng},${origin.lat}`,
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

    const lat = Number(props.lat ?? feature.properties?.lat ?? feature.geometry?.coordinates?.[1]);
    const lng = Number(props.lon ?? feature.properties?.lon ?? feature.geometry?.coordinates?.[0]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const chain = props.brand || name;

    return enrichStore({
      id: `geoapify-${props.place_id || `${lat}-${lng}`}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
      chain,
      name,
      phone: pickPhone(props),
      address: props.formatted || props.address_line1 || '',
      distanceKm: haversineKm(origin, lat, lng),
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

export async function discoverFromGeoapify(radiusKm = 50, defaultPrice = 54990, origin) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return null;
  if (!origin?.lat || !origin?.lng) throw new Error('Location is required for live Geoapify discovery.');

  const scanned = await scanNearbyStores(radiusKm, defaultPrice, apiKey, origin);
  const unique = [...new Map(scanned.map((store) => [placeKey(store), store])).values()]
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
