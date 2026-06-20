import { useEffect, useMemo, useState } from 'react';

interface Product {
  id: string;
  name: string;
  brand: string;
  price: number;
}

interface StoreResult {
  id: string;
  chain: string;
  name: string;
  type: string;
  phone?: string | null;
  address: string;
  distanceKm: number;
  price: number;
  priceSource?: string;
  available: boolean;
  callStatus: string;
  note: string;
}

const PRODUCTS: Product[] = [
  { id: 'ps5-disc', name: 'PlayStation 5 (Disc)', brand: 'Sony', price: 54990 },
  { id: 'ps5-digital', name: 'PlayStation 5 Slim (Digital)', brand: 'Sony', price: 44990 },
  { id: 'ps5-pro', name: 'PlayStation 5 Pro', brand: 'Sony', price: 74990 },
  { id: 'xbox-x', name: 'Xbox Series X', brand: 'Microsoft', price: 52990 },
  { id: 'switch-oled', name: 'Nintendo Switch OLED', brand: 'Nintendo', price: 37990 }
];

const BRANDS = ['All', 'Sony', 'Microsoft', 'Nintendo'];

function App() {
  const [selectedProduct, setSelectedProduct] = useState<Product>(PRODUCTS[0]);
  const [brandFilter, setBrandFilter] = useState('All');
  const [radius, setRadius] = useState(50);
  const [sortBy, setSortBy] = useState<'distance' | 'brand'>('distance');
  const [chainFilter, setChainFilter] = useState('all');
  const [stores, setStores] = useState<StoreResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [agentNote, setAgentNote] = useState('');
  const [config, setConfig] = useState({ voiceMode: 'SIMULATION', searchSpaceConfigured: false, storeCount: 22 });
  const [dataSource, setDataSource] = useState('');
  const [resultMeta, setResultMeta] = useState({ discoveredStores: 0, calledStores: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/config-status')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  const visibleProducts = useMemo(
    () => (brandFilter === 'All' ? PRODUCTS : PRODUCTS.filter(p => p.brand === brandFilter)),
    [brandFilter]
  );

  const chains = useMemo(() => ['all', ...new Set(stores.map(s => s.chain))], [stores]);

  const visibleStores = useMemo(() => {
    let list = [...stores];
    if (chainFilter !== 'all') list = list.filter(s => s.chain === chainFilter);
    if (sortBy === 'brand') list = [...list].sort((a, b) => a.chain.localeCompare(b.chain));
    else list = [...list].sort((a, b) => a.distanceKm - b.distanceKm);
    return list;
  }, [stores, chainFilter, sortBy]);

  const inStockCount = useMemo(() => visibleStores.filter(s => s.available).length, [visibleStores]);

  const dispatchAgent = async () => {
    setLoading(true);
    setShowResults(true);
    setStores([]);
    setError('');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: selectedProduct.name,
          brand: selectedProduct.brand,
          sortBy,
          radius,
          chainFilter: chainFilter === 'all' ? null : chainFilter
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Search failed');
      setStores(data.results || []);
      setAgentNote(data.agentNote || '');
      setDataSource(data.source || '');
      setResultMeta({
        discoveredStores: data.discoveredStores ?? data.totalStores ?? 0,
        calledStores: data.calledStores ?? (data.results || []).length
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Backend not running. Run: npm run dev';
      setError(msg);
      setAgentNote(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="top-bar">
        <div className="logo">STOCKHUNT <span>/ BLR</span></div>
        <div className="meta">
          <span>v0.1 // phase 1</span>
          <span className="pill">{config.voiceMode?.includes('LIVE') ? '📞 agora live' : '📞 agora agent'}</span>
          {config.searchSpaceConfigured && <span className="pill ai">📍 searchspace</span>}
        </div>
      </header>

      {!showResults ? (
        <main className="hero">
          <section className="hero-copy">
            <p className="eyebrow">physical retail · agentic stock lookup</p>
            <h1>
              Don't drive<br />
              <em>all over Bengaluru.</em>
            </h1>
            <p className="lede">
              Pick a product. Our agent dials every consumer-electronics and gaming store in a {radius} km radius
              and reports back who actually has it. Store addresses and distances come from place data; live seller pricing is not shown unless confirmed.
            </p>
            <div className="stats">
              <div><strong>{config.voiceMode?.includes('LIVE') ? 'live' : 'agent'}</strong><span>voice calls</span></div>
              <div><strong>{config.storeCount}</strong><span>stores indexed</span></div>
              <div><strong>{radius}km</strong><span>radius</span></div>
            </div>
          </section>

          <section className="picker">
            <div className="picker-head">
              <h2>01 · Pick the product</h2>
              <span>{visibleProducts.length} available</span>
            </div>

            <div className="brand-tabs">
              {BRANDS.map(b => (
                <button
                  key={b}
                  className={brandFilter === b ? 'active' : ''}
                  onClick={() => {
                    setBrandFilter(b);
                    const next = b === 'All' ? PRODUCTS[0] : PRODUCTS.find(p => p.brand === b)!;
                    if (next) setSelectedProduct(next);
                  }}
                >
                  {b === 'All' ? 'All brands' : b}
                </button>
              ))}
            </div>

            <div className="product-grid">
              {visibleProducts.map(p => (
                <button
                  key={p.id}
                  className={`product-card ${selectedProduct.id === p.id ? 'selected' : ''}`}
                  onClick={() => setSelectedProduct(p)}
                >
                  <span className="pc-brand">{p.brand}</span>
                  <span className="pc-name">{p.name}</span>
                  <span className="pc-price"><small>MSRP</small> ₹{p.price.toLocaleString()}</span>
                </button>
              ))}
            </div>

            <div className="radius-block">
              <label>search radius from city center</label>
              <div className="radius-val">{radius}km</div>
              <input type="range" min={5} max={50} value={radius} onChange={e => setRadius(+e.target.value)} />
              <div className="radius-hint">5km — 50km</div>
            </div>

            <button className="dispatch" onClick={dispatchAgent} disabled={loading}>
              {loading ? 'agent calling stores…' : 'dispatch agent →'}
            </button>
            <p className="hint">agent will call every matching store</p>
          </section>
        </main>
      ) : (
        <main className="results">
          <div className="results-top">
            <button className="back" onClick={() => setShowResults(false)}>← back</button>
            <div>
              <h2>{selectedProduct.name}</h2>
              <p>{agentNote || `Searching within ${radius}km of Bengaluru center`}{dataSource ? ` · source: ${dataSource.replace(/_/g, ' ')}` : ''}</p>
            </div>
            <div className="stock-badge">{inStockCount} in stock / {visibleStores.length} called</div>
          </div>

          <div className="filters">
            <label>
              Store chain
              <select value={chainFilter} onChange={e => setChainFilter(e.target.value)}>
                {chains.map(c => (
                  <option key={c} value={c}>{c === 'all' ? 'All chains' : c}</option>
                ))}
              </select>
            </label>
            <label>
              Sort by
              <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
                <option value="distance">Distance (nearest first)</option>
                <option value="brand">Brand / chain name</option>
              </select>
            </label>
            <button className="refresh" onClick={dispatchAgent} disabled={loading}>
              {loading ? 'calling…' : 're-run agent'}
            </button>
          </div>

          {loading && (
            <div className="loading">
              <div className="spinner" />
              <p>AI agent finding stores → voice agent calling sellers for {selectedProduct.name}…</p>
            </div>
          )}

          {!loading && error && (
            <div className="empty">{error}</div>
          )}

          {!loading && !error && visibleStores.length === 0 && (
            <div className="empty">No sellers found within {radius}km. Try increasing radius or another product.</div>
          )}

          <div className="store-list">
            {visibleStores.map((s, i) => (
              <article key={s.id} className={`store-card ${s.callStatus?.toLowerCase()}`}>
                <div className="idx">{String(i + 1).padStart(2, '0')}</div>
                <div className="body">
                  <div className="row">
                    <h3>{s.name}</h3>
                    <span className="tag">{s.type}</span>
                  </div>
                  <p className="addr">{s.address}</p>
                  <div className="chips">
                    <span>📏 {s.distanceKm} km from BLR center</span>
                    <span>📞 {s.phone ? <a href={`tel:${s.phone}`}>{s.phone}</a> : 'not listed'}</span>
                    <span className="chain">{s.chain}</span>
                  </div>
                  <p className="note">{s.note}</p>
                </div>
              </article>
            ))}
          </div>
        </main>
      )}

      <footer>
        <span>built for Bengaluru shoppers</span>
        <span>{resultMeta.discoveredStores ? `${resultMeta.discoveredStores} discovered · ${resultMeta.calledStores} called` : 'physical retail · agentic stock lookup'}</span>
      </footer>
    </div>
  );
}

export default App;
