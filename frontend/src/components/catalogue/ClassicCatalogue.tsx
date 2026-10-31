import { Download, MapPin, MessageCircle, Phone, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { logoUrl } from '../../lib/logo';
import type { PublicCatalogue } from '../../types';
import { addressLines, CatalogueProduct, groupByCategory, initials, mapsUrl, telHref, whatsappNumber } from './catalogueData';
import './classic.css';

const wholeRupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const price = (paise: number) => (paise % 100 === 0 ? wholeRupees : withPaise).format(paise / 100);

const monthYear = (iso: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const fullDate = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/** Six warm print tones; each category takes the next one so sections are easy to tell apart. */
const TONES = 6;

function Logo({ cat, size }: { cat: PublicCatalogue; size: 'lg' | 'sm' }) {
  const [failed, setFailed] = useState(false);
  const src = logoUrl(cat.shop.logoKey);
  if (src && !failed) return <img className={`cc-logo cc-logo-${size}`} src={src} alt={`${cat.shop.name} logo`} onError={() => setFailed(true)} />;
  return (
    <span className={`cc-logo cc-logo-${size} cc-monogram`} aria-hidden="true">
      {initials(cat.shop.name)}
    </span>
  );
}

function ProductCard({ p, tone, showPrices, whatsapp }: { p: CatalogueProduct; tone: number; showPrices: boolean; whatsapp: string | null }) {
  const ask = `Hello! I saw your catalogue and would like to order: ${p.name}${p.pricePaise !== null ? ` (${price(p.pricePaise)} / ${p.unit})` : ''}.`;
  return (
    <article className={`cc-card${p.available ? '' : ' cc-card-out'}`}>
      <div className={`cc-tile cc-tone-${tone}`}>
        <span className="cc-tile-mark">{initials(p.name)}</span>
        <span className="cc-tile-unit">per {p.unit}</span>
        {!p.available && <span className="cc-tile-flag">Out of stock</span>}
      </div>
      <div className="cc-card-body">
        <h3 className="cc-card-name">{p.name}</h3>
        {p.sku && <p className="cc-card-sku">Code {p.sku}</p>}
        <div className="cc-card-foot">
          {showPrices && p.pricePaise !== null ? (
            <p className="cc-price">
              {price(p.pricePaise)}
              <span> / {p.unit}</span>
            </p>
          ) : (
            <p className="cc-price cc-price-ask">Price on request</p>
          )}
          {whatsapp && p.available && (
            <a className="cc-ask cc-screen" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(ask)}`} target="_blank" rel="noopener noreferrer">
              Enquire
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * "Classic": an editorial, printed-booklet look. Cover with the shop's logo, a contents page,
 * one section per category, and the shop's stores at the back. Prints as an A4 PDF.
 */
export default function ClassicCatalogue({ cat }: { cat: PublicCatalogue }) {
  const [query, setQuery] = useState('');
  const sections = useMemo(() => groupByCategory(cat.products), [cat.products]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      !q
        ? sections
        : sections
            .map((s) => ({ ...s, products: s.products.filter((p) => [p.name, p.sku, s.name].some((t) => t?.toLowerCase().includes(q))) }))
            .filter((s) => s.products.length),
    [sections, q],
  );

  const shop = cat.shop;
  const whatsapp = whatsappNumber(shop.phone);
  const title = cat.title || 'Product Catalogue';
  const stores = [{ id: 0, main: true, ...shop }, ...cat.branches.map((b) => ({ ...b, main: false }))].filter(
    (s) => addressLines(s).length || s.phone,
  );
  const mainAddress = addressLines(shop);

  return (
    <div className="cc">
      {/* Cover */}
      <header className="cc-cover">
        <div className="cc-cover-frame">
          <p className="cc-eyebrow">
            {title}
            <span className="cc-dot">◆</span>
            {monthYear(cat.generatedAt)}
          </p>
          <div className="cc-cover-centre">
            <Logo cat={cat} size="lg" />
            <h1 className="cc-shop-name">{shop.name}</h1>
            {cat.tagline && <p className="cc-tagline">{cat.tagline}</p>}
            <div className="cc-ornament" aria-hidden="true">
              <span />◆<span />
            </div>
            <p className="cc-cover-count">
              {cat.products.length} {cat.products.length === 1 ? 'product' : 'products'} · {sections.length}{' '}
              {sections.length === 1 ? 'category' : 'categories'}
            </p>
          </div>
          <footer className="cc-cover-foot">
            {mainAddress.length > 0 && <p>{mainAddress.join(', ')}</p>}
            <p>
              {[shop.phone, shop.email].filter(Boolean).join('   ·   ')}
              {stores.length > 1 && <span className="cc-cover-branches">{`   ·   ${stores.length} stores`}</span>}
            </p>
          </footer>
        </div>
      </header>

      {/* Screen-only bar: search, jump to a category, contact, save as PDF */}
      <nav className="cc-bar cc-screen" aria-label="Catalogue">
        <div className="cc-bar-row">
          <span className="cc-bar-brand">
            <Logo cat={cat} size="sm" />
            <span>{shop.name}</span>
          </span>
          <label className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>
          <div className="cc-bar-actions">
            {whatsapp ? (
              <a className="cc-btn cc-btn-solid" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={15} /> <span>WhatsApp</span>
              </a>
            ) : (
              shop.phone && (
                <a className="cc-btn cc-btn-solid" href={telHref(shop.phone)}>
                  <Phone size={15} /> <span>Call</span>
                </a>
              )
            )}
            <button type="button" className="cc-btn" onClick={() => window.print()} title="Save as PDF or print">
              <Download size={15} /> <span>PDF</span>
            </button>
          </div>
        </div>
        {sections.length > 1 && !q && (
          <div className="cc-chips">
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.name}
              </a>
            ))}
          </div>
        )}
      </nav>

      <main className="cc-pages">
        {/* Contents */}
        {sections.length > 1 && !q && (
          <section className="cc-contents" aria-labelledby="cc-contents-h">
            <h2 id="cc-contents-h" className="cc-section-kicker">
              Contents
            </h2>
            <ol>
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>
                    <span className="cc-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="cc-contents-name">{s.name}</span>
                    <span className="cc-leader" aria-hidden="true" />
                    <span className="cc-contents-count">
                      {s.products.length} {s.products.length === 1 ? 'item' : 'items'}
                    </span>
                  </a>
                </li>
              ))}
              {stores.length > 0 && (
                <li>
                  <a href="#cc-stores">
                    <span className="cc-num">{String(sections.length + 1).padStart(2, '0')}</span>
                    <span className="cc-contents-name">{stores.length > 1 ? 'Our stores' : 'Visit us'}</span>
                    <span className="cc-leader" aria-hidden="true" />
                    <span className="cc-contents-count">{stores.length > 1 ? `${stores.length} stores` : ''}</span>
                  </a>
                </li>
              )}
            </ol>
          </section>
        )}

        {/* Categories */}
        {visible.length === 0 ? (
          <p className="cc-empty">{q ? `Nothing matches “${query.trim()}”.` : 'New products are on their way. Please check back soon.'}</p>
        ) : (
          visible.map((s) => {
            const index = sections.findIndex((x) => x.id === s.id);
            return (
              <section key={s.id} id={s.id} className="cc-category" aria-labelledby={`${s.id}-h`}>
                <header className="cc-category-head">
                  <span className="cc-category-num">{String(index + 1).padStart(2, '0')}</span>
                  <h2 id={`${s.id}-h`}>{s.name}</h2>
                  <span className="cc-category-count">
                    {s.products.length} {s.products.length === 1 ? 'item' : 'items'}
                  </span>
                </header>
                <div className="cc-grid">
                  {s.products.map((p) => (
                    <ProductCard key={p.id} p={p} tone={index % TONES} showPrices={cat.showPrices} whatsapp={whatsapp} />
                  ))}
                </div>
              </section>
            );
          })
        )}
        {cat.truncated && <p className="cc-note">Showing the first {cat.products.length} products. Ask us for the full range.</p>}

        {/* Stores */}
        {stores.length > 0 && (
          <section id="cc-stores" className="cc-stores" aria-labelledby="cc-stores-h">
            <h2 id="cc-stores-h" className="cc-section-kicker">
              {stores.length > 1 ? 'Our stores' : 'Visit us'}
            </h2>
            <div className="cc-store-grid">
              {stores.map((s) => {
                const lines = addressLines(s);
                return (
                  <article key={`${s.main ? 'main' : s.id}`} className="cc-store">
                    {stores.length > 1 && <p className="cc-store-tag">{s.main ? 'Main store' : 'Branch'}</p>}
                    <h3>{s.name}</h3>
                    {lines.length > 0 && (
                      <address>
                        {lines.map((l) => (
                          <span key={l}>{l}</span>
                        ))}
                      </address>
                    )}
                    <div className="cc-store-links">
                      {s.phone && (
                        <a href={telHref(s.phone)}>
                          <Phone size={13} aria-hidden="true" /> {s.phone}
                        </a>
                      )}
                      {lines.length > 0 && (
                        <a className="cc-screen" href={mapsUrl(s.name, s)} target="_blank" rel="noopener noreferrer">
                          <MapPin size={13} aria-hidden="true" /> Directions
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <footer className="cc-colophon">
          <p>
            {cat.showPrices ? 'Prices and availability' : 'Availability'} as of {fullDate(cat.generatedAt)} and may change. Please confirm with us
            before you order.
          </p>
          <p className="cc-made">Made with CartWell</p>
        </footer>
      </main>
    </div>
  );
}
