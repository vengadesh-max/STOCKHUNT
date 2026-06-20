import { getCachedStore, setCachedStore } from './store-cache.js';
import { enrichStore, STORE_QUERIES } from './store-queries.js';
import { getVerifiedContact } from './verified-contacts.js';

const BLR_CENTER = { lat: 12.9716, lng: 77.5946 };
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

export function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  return phone.startsWith('+') ? phone : null;
}

function isRealPhone(phone) {
  const n = normalizePhone(phone);
  if (!n) return false;
  const digits = n.replace(/\D/g, '');
  return digits.length >= 12 && !/^9180412345/.test(digits);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

async function searchPlace(query, apiKey) {
  const res = await fetch(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.location,places.googleMapsUri'
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'en',
      regionCode: 'IN',
      locationBias: {
        circle: {
          center: { latitude: BLR_CENTER.lat, longitude: BLR_CENTER.lng },
          radius: 50000
        }
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Places API ${res.status}: ${err.slice(0, 120)}`);
  }

  const data = await res.json();
  return data.places?.[0] || null;
}

async function fetchPlacePhone(placeId, apiKey) {
  const res = await fetch(`${DETAILS_URL}/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'nationalPhoneNumber,internationalPhoneNumber'
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.internationalPhoneNumber || data.nationalPhoneNumber || null;
}

function fromVerified(entry, defaultPrice) {
  const v = getVerifiedContact(entry.id);
  if (!v?.phone || !isRealPhone(v.phone)) return null;
  return enrichStore({
    id: entry.id,
    chain: entry.chain,
    name: v.name,
    phone: normalizePhone(v.phone),
    address: v.address,
    distanceKm: v.distanceKm ?? 10,
    price: defaultPrice,
    googleMapsUri: v.googleMapsUri,
    source: 'google_verified'
  });
}

async function fromPlaces(entry, apiKey, defaultPrice) {
  const cached = getCachedStore(entry.id);
  if (cached?.phone && isRealPhone(cached.phone)) return cached;

  const place = await searchPlace(entry.query, apiKey);
  if (!place) return fromVerified(entry, defaultPrice);

  let phone = place.internationalPhoneNumber || place.nationalPhoneNumber;
  if (!phone && place.id) {
    const placeId = place.id.replace(/^places\//, '');
    phone = await fetchPlacePhone(placeId, apiKey);
  }
  phone = normalizePhone(phone);
  if (!isRealPhone(phone)) return fromVerified(entry, defaultPrice);

  const lat = place.location?.latitude ?? BLR_CENTER.lat;
  const lng = place.location?.longitude ?? BLR_CENTER.lng;
  const store = enrichStore({
    id: entry.id,
    chain: entry.chain,
    name: place.displayName?.text || entry.query,
    phone,
    address: place.formattedAddress || entry.query,
    distanceKm: haversineKm(BLR_CENTER.lat, BLR_CENTER.lng, lat, lng),
    price: defaultPrice,
    googleMapsUri: place.googleMapsUri,
    source: 'google_places'
  });

  setCachedStore(entry.id, store);
  return store;
}

async function runBatch(items, fn, size = 3) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const results = await Promise.allSettled(batch.map(fn));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
    }
    if (i + size < items.length) await new Promise(r => setTimeout(r, 200));
  }
  return out;
}

export async function discoverFromGooglePlaces(radiusKm = 50, defaultPrice = 54990) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const stores = await runBatch(STORE_QUERIES, (q) => fromPlaces(q, apiKey, defaultPrice));
  const inRadius = stores.filter((s) => s.distanceKm <= radiusKm && isRealPhone(s.phone));

  return {
    stores: inRadius,
    source: 'google_places',
    agentNote: `Live Google Maps lookup: ${inRadius.length} stores with verified phone numbers.`
  };
}

export function isPlacesConfigured() {
  return !!(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY);
}

export { isRealPhone };
