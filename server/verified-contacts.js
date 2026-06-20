/** Real contacts sourced from Google Maps listings (snapshot — refreshed live when Places API is configured) */
export const VERIFIED_CONTACTS = {
  'croma-garuda': {
    name: 'Croma - Garuda Mall, Magrath road',
    phone: '+916366860871',
    address: '2nd Floor, Garuda Mall, 15, Magrath Rd, Craig Park Layout, Ashok Nagar, Bengaluru, Karnataka 560025',
    distanceKm: 4.1,
    googleMapsUri: 'https://www.google.com/maps/search/Croma+Garuda+Mall+Bengaluru'
  }
};

export function getVerifiedContact(id) {
  return VERIFIED_CONTACTS[id] || null;
}
