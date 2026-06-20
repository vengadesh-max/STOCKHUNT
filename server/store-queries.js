/** Store search targets — contacts resolved live from Google, not hardcoded */
export const CHAIN_TYPES = {
  Croma: 'Electronics Retail Chain',
  'Reliance Digital': 'Electronics Retail Chain',
  'Vijay Sales': 'Electronics Retail Chain',
  Unilet: 'Electronics Retail Chain',
  'Electronics Mart': 'Electronics Retail Chain',
  'Sony Center': 'Gaming Store',
  'Games The Shop': 'Gaming Store',
  'Rey Games Castle': 'Gaming Store',
  Gamestation: 'Gaming Store',
  DMart: 'Hypermarket',
  'Reliance Smart Bazaar': 'Hypermarket',
  'Lulu Hypermarket': 'Hypermarket'
};

export const STORE_QUERIES = [
  { id: 'croma-garuda', chain: 'Croma', query: 'Croma Garuda Mall Magrath Road Bengaluru' },
  { id: 'croma-brigade', chain: 'Croma', query: 'Croma Brigade Road Bengaluru' },
  { id: 'croma-indiranagar', chain: 'Croma', query: 'Croma Indiranagar Bengaluru' },
  { id: 'reliance-koramangala', chain: 'Reliance Digital', query: 'Reliance Digital Koramangala Bengaluru' },
  { id: 'reliance-whitefield', chain: 'Reliance Digital', query: 'Reliance Digital Phoenix Marketcity Whitefield Bengaluru' },
  { id: 'vijay-jayanagar', chain: 'Vijay Sales', query: 'Vijay Sales Jayanagar Bengaluru' },
  { id: 'vijay-malleshwaram', chain: 'Vijay Sales', query: 'Vijay Sales Malleshwaram Bengaluru' },
  { id: 'unilet-mg', chain: 'Unilet', query: 'Unilet MG Road Bengaluru' },
  { id: 'unilet-jp', chain: 'Unilet', query: 'Unilet JP Nagar Bengaluru' },
  { id: 'emi-hsr', chain: 'Electronics Mart', query: 'Electronics Mart HSR Layout Bengaluru' },
  { id: 'sony-phoenix', chain: 'Sony Center', query: 'Sony Center Phoenix Marketcity Whitefield Bengaluru' },
  { id: 'sony-forum', chain: 'Sony Center', query: 'Sony Center Forum Mall Koramangala Bengaluru' },
  { id: 'gts-orion', chain: 'Games The Shop', query: 'Games The Shop Orion Mall Bengaluru' },
  { id: 'gts-garuda', chain: 'Games The Shop', query: 'Games The Shop Garuda Mall Bengaluru' },
  { id: 'rey-sarjapur', chain: 'Rey Games Castle', query: 'Rey Games Castle Sarjapur Road Bengaluru' },
  { id: 'rey-brookfield', chain: 'Rey Games Castle', query: 'Rey Games Castle Brookfield Bengaluru' },
  { id: 'gamestation-indiranagar', chain: 'Gamestation', query: 'Gamestation Indiranagar Bengaluru' },
  { id: 'gamestation-btm', chain: 'Gamestation', query: 'Gamestation BTM Layout Bengaluru' },
  { id: 'dmart-yeshwanthpur', chain: 'DMart', query: 'DMart Yeshwanthpur Bengaluru' },
  { id: 'smart-silkboard', chain: 'Reliance Smart Bazaar', query: 'Reliance Smart Bazaar Silk Board Bengaluru' },
  { id: 'smart-yelahanka', chain: 'Reliance Smart Bazaar', query: 'Reliance Smart Bazaar Yelahanka Bengaluru' },
  { id: 'lulu-rajajinagar', chain: 'Lulu Hypermarket', query: 'Lulu Hypermarket Rajajinagar Bengaluru' },
  { id: 'lulu-hebbal', chain: 'Lulu Hypermarket', query: 'Lulu Hypermarket Hebbal Bengaluru' }
];

export function enrichStore(store) {
  return {
    ...store,
    type: CHAIN_TYPES[store.chain] || 'Retail Store',
    brand: store.chain
  };
}
