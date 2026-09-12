import { FACILITIES, FacilityEntry, SiteType } from './facilities';

// Types
interface Facility {
  lat: number;
  lon: number;
  label: string;
  siteType?: SiteType;
  footprintHa?: number;
  scaleNote?: string;
  measuredOn?: string;
}

interface CompanyMatch {
  symbol: string;
  name: string;
  region: string;
  facility: Facility | null;
}

interface PricePoint {
  date: string;
  close: number;
}

interface PriceData {
  symbol: string;
  prices: PricePoint[];
  lastRefreshed?: string;
  stale?: boolean;
  cachedAt?: string;
}

interface NewsItem {
  headline: string;
  date: string;
  section: string;
  webUrl: string;
  excerpt: string;
}

interface ProviderHealth {
  provider: string;
  keyConfigured: boolean;
  answered: boolean;
  status: number | null;
  state: 'up' | 'degraded' | 'down' | 'unknown';
}

interface HealthData {
  satellite: ProviderHealth;
  news: ProviderHealth;
  price: ProviderHealth;
}

// Current Application State
interface State {
  selectedCompany: CompanyMatch | null;
  searchQuery: string;
  searchMatches: CompanyMatch[];
  searchState: 'idle' | 'loading' | 'empty' | 'rate-limited' | 'refused';
  satelliteState: 'idle' | 'loading' | 'loaded' | 'no-facility' | 'no-capture' | 'refused' | 'unreachable';
  satelliteSource: 'landsat' | 'esri' | null;
  satelliteImageUrl: string | null;
  satelliteTiles: string[] | null;
  satelliteCaptureDate: string | null;
  satelliteNoCaptureDate: string | null;
  satelliteFallback: boolean;
  // Compare mode state
  compareSymbol: string | null;
  compareState: 'idle' | 'loading' | 'loaded' | 'unreachable';
  compareSource: 'landsat' | 'esri' | null;
  compareImageUrl: string | null;
  compareTiles: string[] | null;
  priceState: 'idle' | 'loading' | 'loaded' | 'empty' | 'rate-limited' | 'refused' | 'unreachable';
  priceData: PriceData | null;
  priceRateLimitedTime: string | null;
  newsState: 'idle' | 'loading' | 'loaded' | 'empty' | 'refused' | 'unreachable';
  newsItems: NewsItem[];
  health: HealthData | null;
  deviceMode: 'desktop' | 'mobile';
}

const state: State = {
  selectedCompany: null,
  searchQuery: '',
  searchMatches: [],
  searchState: 'idle',
  satelliteState: 'idle',
  satelliteSource: null,
  satelliteImageUrl: null,
  satelliteTiles: null,
  satelliteCaptureDate: null,
  satelliteNoCaptureDate: null,
  satelliteFallback: false,
  compareSymbol: null,
  compareState: 'idle',
  compareSource: null,
  compareImageUrl: null,
  compareTiles: null,
  priceState: 'idle',
  priceData: null,
  priceRateLimitedTime: null,
  newsState: 'idle',
  newsItems: [],
  health: null,
  deviceMode: 'desktop'
};

// UI Expansion state (per-session, resets on lookup)
interface ExpansionState {
  news: boolean;
  profile: boolean;
  compareInvoked: boolean;
}

const expansionState: ExpansionState = {
  news: false,
  profile: false,
  compareInvoked: false
};

// Tab title synchronizer
function updateTabTitle(): void {
  if (state.selectedCompany && state.selectedCompany.symbol) {
    document.title = `Overberg · ${state.selectedCompany.symbol}`;
  } else {
    document.title = 'Overberg';
  }
}

// Default seed company (Walmart - WMT)
const DEFAULT_COMPANY: CompanyMatch = {
  symbol: 'WMT',
  name: 'Walmart Inc',
  region: 'United States',
  facility: FACILITIES.WMT || {
    lat: 36.3667,
    lon: -94.2180,
    label: 'Walmart Home Office & Global HQ, Bentonville, AR',
    siteType: 'Corporate HQ',
    footprintHa: 140,
    scaleNote: '~15,000 staff across corporate campus',
    measuredOn: '2026-03-15'
  }
};

// Date formatting helper
function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

// Escape text that came from a provider before it goes into innerHTML.
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http(s) links through to an href attribute.
function safeUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  return /^https?:\/\//i.test(raw) ? esc(raw) : '#';
}

// --- Alpha Vantage request queue ----------------------------------------
//
// Alpha Vantage must never see two of our calls in flight at once, and it
// signals throttling with HTTP 200 carrying an "Information" key rather than
// an error status — so a burst does not fail loudly, it silently returns no
// data. The server-side mutex in api/_av.js cannot enforce this on Vercel:
// /api/company and /api/prices are separate serverless functions with separate
// module instances, so neither can see the other's in-flight call. The browser
// is the one process that sees both, so the ordering is enforced here and the
// server mutex remains only as defence in depth.
//
// Every fetch to an Alpha Vantage-backed route goes through this queue.
const AV_MIN_GAP_MS = 1200;
let avChain: Promise<unknown> = Promise.resolve();
let avLastFinished = 0;

function queueAvRequest<T>(run: () => Promise<T>): Promise<T> {
  const result = avChain.then(async () => {
    const sinceLast = Date.now() - avLastFinished;
    if (sinceLast < AV_MIN_GAP_MS) {
      await new Promise((r) => setTimeout(r, AV_MIN_GAP_MS - sinceLast));
    }
    try {
      return await run();
    } finally {
      avLastFinished = Date.now();
    }
  });
  // Keep the chain alive even if this link rejects, so one failure cannot
  // wedge every later request.
  avChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// Satellite imagery captions. Each states what its own source can and cannot
// show; they are licence/accuracy text and must not be reworded or merged.
const CAPTION_LANDSAT =
  'Landsat 8, roughly 30m per pixel, 16-day revisit. Shows site context and long-run change. It cannot resolve vehicles and is not a demand or revenue signal.';
const CAPTION_ESRI =
  'Esri World Imagery basemap. Capture date varies by location and is not published per tile — this shows what the site looks like, but not when. Not a demand or revenue signal.';
const ATTRIBUTION_LANDSAT = 'NASA / Landsat 8';
const ATTRIBUTION_ESRI = 'Esri World Imagery';

// The sources actually on screen right now. In compare mode the two viewports
// can legitimately come from different tiers (primary Landsat, comparison
// Esri), so the caption has to describe every source being shown rather than
// letting either one speak for both.
function activeSatelliteSources(): Array<'landsat' | 'esri'> {
  const sources: Array<'landsat' | 'esri'> = [];
  if (state.satelliteState === 'loaded' && state.satelliteSource) {
    sources.push(state.satelliteSource);
  }
  if (
    state.compareSymbol &&
    state.compareState === 'loaded' &&
    state.compareSource &&
    !sources.includes(state.compareSource)
  ) {
    sources.push(state.compareSource);
  }
  return sources;
}

// Generate Inline SVG Price Chart (no charting library)
function generatePriceChartSvg(prices: PricePoint[]): string {
  if (!prices || prices.length < 2) return '';

  const width = 340;
  const height = 180;
  const padLeft = 45;
  const padRight = 15;
  const padTop = 20;
  const padBottom = 26;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const closes = prices.map((p) => p.close);
  const minPrice = Math.min(...closes);
  const maxPrice = Math.max(...closes);
  const priceRange = maxPrice - minPrice || 1;

  const getX = (index: number) => padLeft + (index / (prices.length - 1)) * chartW;
  const getY = (price: number) => padTop + chartH - ((price - minPrice) / priceRange) * chartH;

  const points = prices.map((p, i) => `${getX(i).toFixed(1)},${getY(p.close).toFixed(1)}`).join(' ');
  const firstX = getX(0).toFixed(1);
  const lastX = getX(prices.length - 1).toFixed(1);
  const bottomY = (padTop + chartH).toFixed(1);
  const areaPath = `M ${firstX},${bottomY} L ${points} L ${lastX},${bottomY} Z`;

  const midPrice = minPrice + priceRange / 2;
  const isUp = prices[prices.length - 1].close >= prices[0].close;
  const strokeColor = isUp ? '#2F6B4F' : '#A33A2A';
  const fillColor = isUp ? 'rgba(47, 107, 79, 0.08)' : 'rgba(163, 58, 42, 0.08)';

  return `
    <svg class="price-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.16" />
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Horizontal grid guides -->
      <line x1="${padLeft}" y1="${getY(maxPrice).toFixed(1)}" x2="${padLeft + chartW}" y2="${getY(maxPrice).toFixed(1)}" stroke="#D8D9D2" stroke-dasharray="2,2" stroke-width="1" />
      <line x1="${padLeft}" y1="${getY(midPrice).toFixed(1)}" x2="${padLeft + chartW}" y2="${getY(midPrice).toFixed(1)}" stroke="#E4E5DF" stroke-dasharray="2,2" stroke-width="1" />
      <line x1="${padLeft}" y1="${getY(minPrice).toFixed(1)}" x2="${padLeft + chartW}" y2="${getY(minPrice).toFixed(1)}" stroke="#D8D9D2" stroke-dasharray="2,2" stroke-width="1" />

      <!-- Price Labels on Y-axis -->
      <text x="${padLeft - 6}" y="${(getY(maxPrice) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#6E7469" font-family="monospace">$${maxPrice.toFixed(2)}</text>
      <text x="${padLeft - 6}" y="${(getY(minPrice) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#6E7469" font-family="monospace">$${minPrice.toFixed(2)}</text>

      <!-- Area fill -->
      <path d="${areaPath}" fill="url(#priceGradient)" />

      <!-- Price polyline -->
      <polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Endpoint circle -->
      <circle cx="${lastX}" cy="${getY(prices[prices.length - 1].close).toFixed(1)}" r="3" fill="${strokeColor}" />

      <!-- Date bounds on X-axis -->
      <text x="${padLeft}" y="${height - 6}" text-anchor="start" font-size="9.5" fill="#6E7469">${formatDate(prices[0].date)}</text>
      <text x="${padLeft + chartW}" y="${height - 6}" text-anchor="end" font-size="9.5" fill="#6E7469">${formatDate(prices[prices.length - 1].date)}</text>
    </svg>
  `;
}

// Render site profile strip directly under imagery (collapsed to single line, expands to four fields + provenance)
function renderProfileStrip(fac: Facility | FacilityEntry | null | undefined, drawerId = 'profile-details-drawer'): string {
  if (!fac) return '';

  const hasType = !!fac.siteType;
  const hasFootprint = typeof fac.footprintHa === 'number' && !isNaN(fac.footprintHa);
  const hasMore = !!(fac.scaleNote || fac.measuredOn);

  if (!hasType && !hasFootprint && !hasMore) return '';

  const cols: string[] = [];

  if (fac.siteType) {
    cols.push(`
      <div>
        <span class="profile-field-label">Site type</span>
        <span class="profile-field-value">${fac.siteType}</span>
      </div>
    `);
  }

  if (typeof fac.footprintHa === 'number' && !isNaN(fac.footprintHa)) {
    cols.push(`
      <div>
        <span class="profile-field-label">Footprint</span>
        <span class="profile-field-value">${fac.footprintHa} ha</span>
      </div>
    `);
  }

  if (fac.scaleNote) {
    cols.push(`
      <div>
        <span class="profile-field-label">Scale context</span>
        <span class="profile-field-value">${fac.scaleNote}</span>
      </div>
    `);
  }

  if (fac.measuredOn) {
    cols.push(`
      <div>
        <span class="profile-field-label">Provenance</span>
        <span class="profile-field-value" style="color: var(--slate); font-size: 0.72rem;">Measured by hand from basemap imagery, ${fac.measuredOn}</span>
      </div>
    `);
  }

  const isExpanded = expansionState.profile;

  return `
    <div class="site-profile-wrapper">
      <div class="profile-strip-collapsed">
        <div class="profile-collapsed-summary">
          ${fac.siteType ? `<span class="profile-summary-type">${fac.siteType}</span>` : ''}
          ${hasType && hasFootprint ? `<span class="profile-summary-sep">·</span>` : ''}
          ${hasFootprint ? `<span class="profile-summary-ha">${fac.footprintHa} ha</span>` : ''}
        </div>
        ${
          hasMore
            ? `
          <button
            type="button"
            class="quiet-toggle-btn toggle-profile-btn"
            data-target="${drawerId}"
            aria-expanded="${isExpanded ? 'true' : 'false'}"
          >
            ${isExpanded ? 'Hide details' : 'Site details'}
          </button>
        `
            : ''
        }
      </div>
      ${
        hasMore
          ? `
        <div class="profile-details-drawer ${isExpanded ? 'is-expanded' : 'is-collapsed'}" id="${drawerId}">
          <div class="site-profile-strip">
            ${cols.join('')}
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;
}

// Render viewport content at fixed zoom for satellite imagery
function renderViewportContent(
  status: string,
  source: 'landsat' | 'esri' | null,
  tiles: string[] | null,
  imageUrl: string | null,
  fallbackLabel?: string
): string {
  if (status === 'loading') {
    return `
      <div class="flex flex-col items-center gap-2 p-6">
        <div class="w-6 h-6 border-2 border-neutral-300 border-t-neutral-800 rounded-full animate-spin"></div>
        <p class="text-sm text-neutral-600 font-medium">Fetching imagery…</p>
      </div>
    `;
  }

  if (status === 'loaded' && source === 'esri' && tiles && tiles.length === 9) {
    return `
      <div class="esri-tile-container">
        <div class="esri-tile-grid">
          ${tiles
            .map(
              (tileUrl, idx) => `
            <img
              src="${tileUrl}"
              alt="Esri World Imagery tile ${idx + 1}"
              class="esri-tile-img"
              loading="eager"
            />
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  if (status === 'loaded' && source === 'landsat' && imageUrl) {
    return `
      <img
        src="${imageUrl}"
        alt="Satellite capture"
        class="hero-image-cover"
      />
    `;
  }

  if (status === 'no-facility') {
    return `
      <div class="max-w-md p-6">
        <p class="text-sm text-neutral-600">
          We don't have a mapped facility for this company. Add one to FACILITIES to see imagery.
        </p>
      </div>
    `;
  }

  if (status === 'refused') {
    return `
      <div class="max-w-md p-6">
        <p class="text-sm text-neutral-700 font-medium">
          Provider rejected our credential. No imagery on this screen is current.
        </p>
      </div>
    `;
  }

  return `
    <div class="max-w-md p-6">
      <div class="w-8 h-8 mx-auto mb-2 text-neutral-400">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-12.728 0m0 0l2.829-2.829m-2.829 2.829L3 21m2.828-12.728a5 5 0 017.072 0l-2.828 2.828" />
        </svg>
      </div>
      <p class="text-sm text-neutral-600 font-medium">
        Can't reach satellite imagery service.
      </p>
      <p class="text-xs text-neutral-400 mt-1.5">
        ${fallbackLabel || 'Service proxy unavailable from upstream endpoints.'}
      </p>
    </div>
  `;
}

// String cleanup and possessive formatting helper
function cleanName(name: string): string {
  return name
    .replace(/,?\s*(Inc\.?|Corp\.?|Corporation|Co\.?|LLC|Ltd\.?|plc|Company)$/i, '')
    .trim();
}

function toPossessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

// Compute ratio line between two facility footprints
function computeRatioLine(
  primaryName: string,
  primaryFacility: Facility | FacilityEntry | null | undefined,
  compareFacility: FacilityEntry | null | undefined
): string | null {
  if (!primaryFacility || !compareFacility) return null;
  const pHa = primaryFacility.footprintHa;
  const cHa = compareFacility.footprintHa;
  if (typeof pHa !== 'number' || typeof cHa !== 'number' || pHa <= 0 || cHa <= 0) {
    return null;
  }

  const pClean = toPossessive(cleanName(primaryName));
  const cClean = toPossessive(cleanName(compareFacility.name));

  if (Math.abs(pHa - cHa) < 0.05) {
    return `${pClean} primary site is roughly the same footprint as ${cClean}.`;
  }

  if (pHa >= cHa) {
    const ratio = (pHa / cHa).toFixed(1);
    return `${pClean} primary site is roughly ${ratio}x the footprint of ${cClean}.`;
  } else {
    const ratio = (cHa / pHa).toFixed(1);
    return `${cClean} primary site is roughly ${ratio}x the footprint of ${pClean}.`;
  }
}

// Generate single cross-panel synthesis line above the three panels
function renderCrossPanelSynthesis(): string {
  const clauses: string[] = [];

  // Clause 1: siteType (only if satellite is loaded and has siteType)
  if (state.satelliteState === 'loaded' && state.selectedCompany?.facility?.siteType) {
    clauses.push(state.selectedCompany.facility.siteType);
  }

  // Clause 2: ninety-day price [+/-X%] (only if price state is loaded with prices)
  if (state.priceState === 'loaded' && state.priceData?.prices && state.priceData.prices.length > 1) {
    const prices = state.priceData.prices;
    const firstClose = prices[0].close;
    const lastClose = prices[prices.length - 1].close;
    if (firstClose > 0) {
      const diff = lastClose - firstClose;
      const pct = (diff / firstClose) * 100;
      const sign = pct >= 0 ? '+' : '';
      clauses.push(`ninety-day price ${sign}${pct.toFixed(1)}%`);
    }
  }

  // Clause 3: recent coverage concentrated in [top Guardian sectionName by count]
  if (state.newsState === 'loaded' && state.newsItems.length > 0) {
    const counts: Record<string, number> = {};
    for (const item of state.newsItems) {
      if (item.section) {
        counts[item.section] = (counts[item.section] || 0) + 1;
      }
    }
    let topSection = '';
    let maxCount = 0;
    for (const [sec, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        topSection = sec;
      }
    }
    if (topSection) {
      clauses.push(`recent coverage concentrated in ${topSection}`);
    }
  }

  // Rule: If fewer than two clauses are available, hide the line.
  if (clauses.length < 2) {
    return '';
  }

  return `
    <div id="cross-panel-synthesis" class="cross-panel-synthesis">
      ${clauses.join(' · ')}
    </div>
  `;
}

// Render the entire app UI
function render() {
  updateTabTitle();

  const root = document.getElementById('root');
  if (!root) return;

  const comp = state.selectedCompany;
  const symbol = comp ? comp.symbol : '—';
  const name = comp ? comp.name : 'Select a company';
  const region = comp ? comp.region : '—';
  const facilityLabel = comp?.facility ? comp.facility.label : 'No mapped facility in database';

  // Calculate 90-day price metrics for image overlay
  let ninetyDayDiffStr: string | null = null;
  let ninetyDayIsPos = true;
  let lastCloseVal: number | null = null;
  let lastCloseDateStr: string | null = null;

  if (state.priceData?.prices && state.priceData.prices.length > 1) {
    const prices = state.priceData.prices;
    const firstClose = prices[0].close;
    const lastClose = prices[prices.length - 1].close;
    lastCloseVal = lastClose;
    lastCloseDateStr = formatDate(prices[prices.length - 1].date);
    if (firstClose > 0) {
      const diff = lastClose - firstClose;
      const pct = (diff / firstClose) * 100;
      ninetyDayIsPos = diff >= 0;
      const sign = diff >= 0 ? '+' : '';
      ninetyDayDiffStr = `${sign}${pct.toFixed(2)}%`;
    }
  }

  // /api/health does not probe Alpha Vantage — that would spend one of the 25
  // daily requests on every page load and race the real price call. The price
  // chip is derived from the price request the page already made, which is
  // free and describes the symbol actually on screen.
  const getPriceChipState = (): { dot: string; text: string } => {
    if (state.health && !state.health.price.keyConfigured) {
      return { dot: 'status-dot-down', text: 'down' };
    }
    switch (state.priceState) {
      case 'loaded':
      case 'empty':
        // The provider answered; "empty" is a fact about the symbol, not a fault.
        return { dot: 'status-dot-up', text: 'up' };
      case 'rate-limited':
        return { dot: 'status-dot-slate', text: 'degraded' };
      case 'refused':
      case 'unreachable':
        return { dot: 'status-dot-down', text: 'down' };
      default:
        return { dot: 'status-dot-slate', text: 'checking…' };
    }
  };

  // Status dot indicators helper
  const getStatusChip = (providerKey: 'satellite' | 'news' | 'price', label: string) => {
    let dotClass = 'status-dot-slate';
    let statusText = 'checking…';

    if (providerKey === 'price') {
      const derived = getPriceChipState();
      dotClass = derived.dot;
      statusText = derived.text;
    } else {
      const p = state.health ? state.health[providerKey] : null;
      if (p) {
        if (p.state === 'up') {
          dotClass = 'status-dot-up';
          statusText = 'up';
        } else if (p.state === 'degraded') {
          dotClass = 'status-dot-slate';
          statusText = 'degraded';
        } else if (p.state === 'unknown') {
          dotClass = 'status-dot-slate';
          statusText = 'checking…';
        } else {
          dotClass = 'status-dot-down';
          statusText = 'down';
        }
      }
    }

    return `
      <div class="status-chip" title="${label}: ${statusText}">
        <span class="status-dot ${dotClass}"></span>
        <span>${label}: ${statusText}</span>
      </div>
    `;
  };

  root.innerHTML = `
    <div class="app-container ${state.deviceMode === 'mobile' ? 'device-mode-mobile' : ''}">

      <!-- PANEL 0 · SEARCH (Pinned Top) -->
      <section id="panel-search" class="search-section">
        <div class="search-top-bar">
          <div class="wordmark-container">
            <span class="product-wordmark">OVERBERG</span>
          </div>
          <div class="device-preview-controls" role="group" aria-label="Device layout preview">
            <button
              type="button"
              id="device-desktop-btn"
              class="device-toggle-btn ${state.deviceMode === 'desktop' ? 'is-active' : ''}"
              aria-pressed="${state.deviceMode === 'desktop' ? 'true' : 'false'}"
            >
              Desktop
            </button>
            <span class="device-toggle-sep">/</span>
            <button
              type="button"
              id="device-mobile-btn"
              class="device-toggle-btn ${state.deviceMode === 'mobile' ? 'is-active' : ''}"
              aria-pressed="${state.deviceMode === 'mobile' ? 'true' : 'false'}"
            >
              Mobile
            </button>
          </div>
        </div>
        <form id="search-form" class="search-form">
          <div class="relative flex-1">
            <input
              id="search-input"
              type="text"
              autocomplete="off"
              placeholder="Company name or ticker"
              value="${esc(state.searchQuery)}"
              class="search-input w-full"
            />
          </div>
          <button
            id="search-submit"
            type="submit"
            class="search-button"
          >
            Lookup
          </button>
        </form>

        <!-- Search Status & State Messages -->
        ${
          state.searchState === 'loading'
            ? `<div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--slate); font-weight: 500;">Looking up companies…</div>`
            : ''
        }
        ${
          state.searchState === 'empty'
            ? `<div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--slate); font-weight: 500;">No companies match that name. Try the ticker instead.</div>`
            : ''
        }
        ${
          state.searchState === 'rate-limited'
            ? `<div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--down); font-weight: 500;">Company lookup is rate-limited. Try again in a moment.</div>`
            : ''
        }
        ${
          state.searchState === 'refused'
            ? `<div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--down); font-weight: 500;">We can't reach the company lookup right now.</div>`
            : ''
        }

        <!-- Pick List of Up to Five Matches -->
        ${
          state.searchMatches.length > 0
            ? `
            <div class="search-dropdown">
              <div style="padding: 0.35rem 0.85rem; background: rgba(27, 31, 26, 0.04); font-size: 0.72rem; color: var(--slate); border-bottom: 1px solid var(--rule);">
                Select listing
              </div>
              ${state.searchMatches
                .map(
                  (m) => `
                <button
                  type="button"
                  data-symbol="${esc(m.symbol)}"
                  class="search-result-row"
                >
                  <div class="min-w-0 flex items-baseline gap-2">
                    <span style="font-family: var(--font-mono); font-weight: 600; font-size: 0.85rem; color: var(--ink);">${esc(m.symbol)}</span>
                    <span style="font-size: 0.85rem; color: var(--ink);" class="truncate">${esc(m.name)}</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span style="font-size: 0.72rem; color: var(--slate);">${esc(m.region)}</span>
                    ${
                      m.facility
                        ? `<span style="font-size: 0.72rem; color: var(--up);">Facility mapped</span>`
                        : ''
                    }
                  </div>
                </button>
              `
                )
                .join('')}
            </div>
          `
            : ''
        }

        <!-- Quick suggestion pills for testing -->
        <div class="quick-picks">
          <span>Quick test:</span>
          ${['WMT', 'AAPL', 'TSLA', 'NVDA', 'BA', 'CAT']
            .map(
              (sym) => `
            <button
              type="button"
              data-quick-symbol="${sym}"
              class="quick-pick-btn"
            >
              ${sym}
            </button>
          `
            )
            .join('')}
        </div>
      </section>

      <!-- HERO · SATELLITE (Full Width) -->
      <section id="panel-satellite" class="instrument-section satellite-panel-body ${state.satelliteState === 'loading' ? 'is-loading' : ''}">
        <div>
          <div class="panel-header-bar">
            <div>
              <h2 class="panel-heading">Main facility</h2>
              ${
                state.satelliteFallback
                  ? `<p style="font-size: 0.72rem; color: var(--down); margin: 0.2rem 0 0 0;">Landsat unavailable — showing basemap imagery.</p>`
                  : ''
              }
            </div>

            <div class="flex items-center gap-4 flex-wrap">
              <!-- Three Provider Status Chips -->
              <div class="status-chips-group">
                ${getStatusChip('satellite', 'Satellite')}
                ${getStatusChip('news', 'News')}
                ${getStatusChip('price', 'Price')}
              </div>

              <!-- Compare with... control (invoked on demand) -->
              <div class="flex items-center gap-2">
                ${
                  !expansionState.compareInvoked && !state.compareSymbol
                    ? `
                  <button
                    type="button"
                    id="open-compare-btn"
                    class="quiet-toggle-btn"
                    aria-expanded="false"
                  >
                    Compare with…
                  </button>
                `
                    : `
                  <select
                    id="compare-facility-select"
                    aria-label="Compare with another company facility"
                    class="compare-select"
                  >
                    <option value="">Select company to compare…</option>
                    ${Object.values(FACILITIES)
                      .filter((f) => f.symbol !== (state.selectedCompany?.symbol || ''))
                      .map(
                        (f) => `
                      <option value="${f.symbol}" ${state.compareSymbol === f.symbol ? 'selected' : ''}>
                        ${f.symbol} · ${f.name}
                      </option>
                    `
                      )
                      .join('')}
                  </select>
                  <button
                    type="button"
                    id="exit-compare-btn"
                    class="compare-exit-btn"
                    title="Exit compare mode"
                  >
                    ${state.compareSymbol ? 'Exit' : 'Cancel'}
                  </button>
                `
                }
              </div>
            </div>
          </div>

          ${
            state.compareSymbol && FACILITIES[state.compareSymbol]
              ? `
            <!-- COMPARE MODE: Split into side-by-side tile grids AT THE SAME ZOOM, collapsed to stacked under 820px -->
            <div class="grid grid-cols-1 min-[820px]:grid-cols-2 gap-4">
              <!-- Primary Company -->
              <div class="flex flex-col">
                <div class="compare-viewport-container">
                  ${renderViewportContent(state.satelliteState, state.satelliteSource, state.satelliteTiles, state.satelliteImageUrl, facilityLabel)}
                  <div class="hero-scrim-overlay">
                    <h1 class="hero-company-name" style="font-size: 1.35rem;">${esc(name)}</h1>
                    <div class="hero-meta-row" style="font-size: 0.75rem;">
                      <span class="hero-ticker">${esc(symbol)}</span>
                      ${region && region !== '—' ? `<span>·</span><span>${esc(region)}</span>` : ''}
                    </div>
                    ${
                      ninetyDayDiffStr && lastCloseVal !== null
                        ? `
                      <div class="hero-price-change ${ninetyDayIsPos ? 'up' : 'down'}" style="font-size: 1.8rem; margin-top: 0.25rem;">
                        ${ninetyDayDiffStr}
                      </div>
                      <div class="hero-last-close-line" style="font-size: 0.72rem;">
                        Last close: <strong>$${lastCloseVal.toFixed(2)}</strong> · ${lastCloseDateStr}
                      </div>
                    `
                        : ''
                    }
                    <div class="hero-facility-label" style="font-size: 0.72rem; margin-top: 0.2rem;">${esc(facilityLabel)}</div>
                  </div>
                </div>
                ${renderProfileStrip(comp?.facility, 'profile-details-primary')}
              </div>

              <!-- Compared Company -->
              <div class="flex flex-col">
                <div class="compare-viewport-container">
                  ${renderViewportContent(state.compareState, state.compareSource, state.compareTiles, state.compareImageUrl, FACILITIES[state.compareSymbol].label)}
                  <div class="hero-scrim-overlay">
                    <div class="hero-company-name" style="font-size: 1.35rem;">${FACILITIES[state.compareSymbol].name}</div>
                    <div class="hero-meta-row" style="font-size: 0.75rem;">
                      <span class="hero-ticker">${FACILITIES[state.compareSymbol].symbol}</span>
                      <span>·</span>
                      <span>Comparison</span>
                    </div>
                    <div class="hero-facility-label" style="font-size: 0.72rem; margin-top: 0.2rem;">${FACILITIES[state.compareSymbol].label}</div>
                  </div>
                </div>
                ${renderProfileStrip(FACILITIES[state.compareSymbol], 'profile-details-compare')}
              </div>
            </div>

            <!-- Ratio line under the pair -->
            ${(() => {
              const ratioLine = computeRatioLine(name, comp?.facility, FACILITIES[state.compareSymbol]);
              return ratioLine
                ? `
              <div style="margin-top: 0.75rem; padding: 0.4rem 0; border-top: 1px solid var(--rule); font-size: 0.75rem; color: var(--ink); font-variant-numeric: tabular-nums;">
                ${esc(ratioLine)}
              </div>
            `
                : '';
            })()}
          `
              : state.satelliteState === 'no-facility' || state.satelliteState === 'refused' || state.satelliteState === 'unreachable'
              ? `
            <!-- COLLAPSED FAILED STATE: Shrunk to single line carrying existing sentence verbatim -->
            <div class="satellite-collapsed-header">
              <h1 class="satellite-company-name">${esc(name)}</h1>
              <div class="hero-meta-row" style="color: var(--slate);">
                <span class="hero-ticker" style="color: var(--ink);">${esc(symbol)}</span>
                ${region && region !== '—' ? `<span>·</span><span>${esc(region)}</span>` : ''}
              </div>
              ${
                ninetyDayDiffStr && lastCloseVal !== null
                  ? `
                <div class="hero-price-change ${ninetyDayIsPos ? 'up' : 'down'}" style="font-size: 1.8rem; margin-top: 0.25rem;">
                  ${ninetyDayDiffStr}
                </div>
                <div class="hero-last-close-line" style="color: var(--slate);">
                  Last close: <strong style="color: var(--ink);">$${lastCloseVal.toFixed(2)}</strong> · ${lastCloseDateStr}
                </div>
              `
                  : ''
              }
              ${facilityLabel ? `<div class="hero-facility-label" style="color: var(--slate); margin-top: 0.25rem;">${esc(facilityLabel)}</div>` : ''}
            </div>

            ${
              state.satelliteState === 'no-facility'
                ? `<div class="panel-failed-line">We don't have a mapped facility for this company. Add one to FACILITIES to see imagery.</div>`
                : state.satelliteState === 'refused'
                ? `<div class="panel-failed-line text-down">Provider rejected our credential. No imagery on this screen is current.</div>`
                : `<div class="panel-failed-line">Can't reach satellite imagery service. ${facilityLabel ? '' : 'Service proxy unavailable from upstream endpoints.'}</div>`
            }

            <!-- Profile Strip directly under collapsed line if facility data exists -->
            ${renderProfileStrip(comp?.facility)}
          `
              : `
            <!-- SINGLE MODE: Hero with overlaid text on lower left -->
            <div class="hero-viewport-container">
              ${renderViewportContent(state.satelliteState, state.satelliteSource, state.satelliteTiles, state.satelliteImageUrl, facilityLabel)}
              ${
                state.selectedCompany
                  ? `
                <div class="hero-scrim-overlay">
                  <h1 class="hero-company-name">${esc(name)}</h1>
                  <div class="hero-meta-row">
                    <span class="hero-ticker">${esc(symbol)}</span>
                    ${region && region !== '—' ? `<span>·</span><span>${esc(region)}</span>` : ''}
                    ${facilityLabel ? `<span>·</span><span class="hero-facility-label">${esc(facilityLabel)}</span>` : ''}
                  </div>
                  ${
                    ninetyDayDiffStr && lastCloseVal !== null
                      ? `
                    <div class="hero-price-change ${ninetyDayIsPos ? 'up' : 'down'}">
                      ${ninetyDayDiffStr}
                    </div>
                    <div class="hero-last-close-line">
                      Last close: <strong>$${lastCloseVal.toFixed(2)}</strong> · ${lastCloseDateStr}
                    </div>
                  `
                      : ''
                  }
                </div>
              `
                  : ''
              }
            </div>

            ${
              state.satelliteSource === 'landsat' && state.satelliteCaptureDate
                ? `
              <div style="margin-top: 0.4rem; font-size: 0.72rem; color: var(--slate); font-family: var(--font-mono);">
                Captured: ${state.satelliteCaptureDate}
              </div>
            `
                : ''
            }

            <!-- Profile Strip directly under image -->
            ${renderProfileStrip(comp?.facility)}
          `
          }

          <!-- Disclaimer directly below profile strip and above caption -->
          <p style="margin-top: 0.75rem; font-size: 0.72rem; color: var(--slate); line-height: 1.4;">
            This panel shows scale and site type. It does not show activity. Measuring change would need dated, repeat imagery from a commercial provider — the input we don't have.
          </p>
        </div>

        <!-- Fixed Caption, ALWAYS VISIBLE with bottom-right attribution -->
        <div class="panel-bottom-bar">
          <p style="margin: 0; font-size: 0.72rem; color: var(--slate); line-height: 1.4; max-width: 65ch;">
            ${(() => {
              const sources = activeSatelliteSources();
              if (sources.length === 0) return CAPTION_LANDSAT;
              return sources
                .map((src) => (src === 'esri' ? CAPTION_ESRI : CAPTION_LANDSAT))
                .join(' ');
            })()}
          </p>
          <span class="panel-attribution">
            ${(() => {
              const sources = activeSatelliteSources();
              if (sources.length === 0) return ATTRIBUTION_LANDSAT;
              return sources
                .map((src) => (src === 'esri' ? ATTRIBUTION_ESRI : ATTRIBUTION_LANDSAT))
                .join(' · ');
            })()}
          </span>
        </div>
      </section>

      <!-- CROSS-PANEL SYNTHESIS (Directly beneath hero, above lower grid) -->
      ${renderCrossPanelSynthesis()}

      <!-- LOWER GRID · PRICE & NEWS (Denser and Quieter) -->
      <div class="lower-sections-grid">

        <!-- PANEL C · PRICE -->
        <section id="panel-price" class="instrument-section price-panel-body ${state.priceState === 'loading' ? 'is-loading' : ''}">
          <div>
            <div class="panel-header-bar">
              <h2 class="panel-heading">Ninety-day close</h2>
            </div>

            ${(() => {
              if (state.priceState === 'loading') {
                return `
                  <div class="h-[240px] flex flex-col items-center justify-center gap-2">
                    <div class="w-5 h-5 border-2 border-[#D8D9D2] border-t-[#1B1F1A] rounded-full animate-spin"></div>
                    <p style="font-size: 0.85rem; color: var(--slate);">Loading ninety days of closes…</p>
                  </div>
                `;
              }

              if (state.priceState === 'empty') {
                return `
                  <div class="panel-failed-line">No price history for this symbol. It may be delisted or not covered.</div>
                `;
              }

              if (state.priceState === 'refused') {
                return `
                  <div class="panel-failed-line text-down">The price provider rejected our credential.</div>
                `;
              }

              if (state.priceState === 'unreachable') {
                return `
                  <div class="panel-failed-line">Can't reach the price provider.</div>
                `;
              }

              if (state.priceState === 'rate-limited' && !state.priceData?.prices?.length) {
                return `
                  <div class="panel-failed-line text-down">Price data is rate-limited right now. Try again in a moment.</div>
                `;
              }

              // Loaded (or rate-limited serving stale cache)
              const prices = state.priceData?.prices || [];
              if (prices.length > 0) {
                return `
                  ${
                    state.priceData?.stale || state.priceState === 'rate-limited'
                      ? `
                    <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--down); padding: 0.25rem 0;">
                      Price data is rate-limited right now. Showing the last figures we have, from ${formatTime(state.priceData?.cachedAt || '')}.
                    </div>
                  `
                      : ''
                  }

                  <!-- Inline SVG Chart -->
                  <div class="price-chart-wrap">
                    ${generatePriceChartSvg(prices)}
                  </div>
                `;
              }

              return `
                <div class="panel-failed-line">Enter a company ticker above to inspect 90-day closes.</div>
              `;
            })()}
          </div>

          <div class="panel-bottom-bar">
            <span>Daily closes (compact)</span>
            <span class="panel-attribution">Alpha Vantage</span>
          </div>
        </section>

        <!-- PANEL D · NEWS -->
        <section id="panel-news" class="instrument-section news-panel-body ${state.newsState === 'loading' ? 'is-loading' : ''}">
          <div class="panel-header-bar">
            <h2 class="panel-heading">Recent coverage</h2>
            <span class="panel-attribution">The Guardian · Summary Only Licence</span>
          </div>

          ${(() => {
            if (state.newsState === 'loading') {
              return `
                <div class="h-[280px] flex flex-col items-center justify-center gap-2">
                  <div class="w-5 h-5 border-2 border-[#D8D9D2] border-t-[#1B1F1A] rounded-full animate-spin"></div>
                  <p style="font-size: 0.85rem; color: var(--slate);">Searching recent coverage…</p>
                </div>
              `;
            }

            if (state.newsState === 'empty') {
              return `
                <div class="panel-failed-line">
                  No Guardian coverage of this company in the archive. That's not unusual for smaller listings.
                </div>
              `;
            }

            if (state.newsState === 'refused') {
              return `
                <div class="panel-failed-line text-down">The Guardian rejected our credential.</div>
              `;
            }

            if (state.newsState === 'unreachable') {
              return `
                <div class="panel-failed-line">Can't reach the Guardian.</div>
              `;
            }

            if (state.newsItems.length > 0) {
              const renderArticle = (item: NewsItem) => `
                <article class="news-editorial-row">
                  <h3 class="news-headline">
                    <a href="${safeUrl(item.webUrl)}" target="_blank" rel="noopener noreferrer">
                      ${esc(item.headline)}
                    </a>
                  </h3>
                  <!-- Excerpt truncated strictly to 200 characters server-side -->
                  <p class="news-excerpt">
                    ${esc(item.excerpt)}
                  </p>
                  <div class="news-meta-line">
                    <time datetime="${esc(item.date)}">${esc(formatDate(item.date))}</time>
                    <span>·</span>
                    <span>${esc(item.section)}</span>
                  </div>
                </article>
              `;

              const firstTwo = state.newsItems.slice(0, 2);
              const remaining = state.newsItems.slice(2);
              const isExpanded = expansionState.news;

              return `
                <div class="news-editorial-list">
                  ${firstTwo.map(renderArticle).join('')}
                  ${
                    remaining.length > 0
                      ? `
                    <div id="news-extra-items" class="news-extra-container ${isExpanded ? 'is-expanded' : 'is-collapsed'}">
                      ${remaining.map(renderArticle).join('')}
                    </div>
                    <div class="news-toggle-wrap">
                      <button
                        type="button"
                        class="quiet-toggle-btn"
                        id="toggle-news-btn"
                        aria-expanded="${isExpanded ? 'true' : 'false'}"
                      >
                        ${isExpanded ? 'Show fewer' : `${remaining.length} more`}
                      </button>
                    </div>
                  `
                      : ''
                  }
                </div>
              `;
            }

            return `
              <div class="panel-failed-line">Select a company to load recent journalistic coverage.</div>
            `;
          })()}
        </section>

      </div>

      <!-- FOOTER -->
      <footer class="site-footer">
        <p class="footer-disclaimer">
          Overberg is a coursework prototype. Not financial advice.
        </p>
        <div class="footer-credits">
          <a href="https://www.theguardian.com" target="_blank" rel="noopener noreferrer">
            Powered by the Guardian
          </a>
          <span class="footer-sep">·</span>
          <span>Imagery courtesy of NASA Earth Science / Landsat</span>
          <span class="footer-sep">·</span>
          <span>Basemap tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community</span>
          <span class="footer-sep">·</span>
          <span>Market data provided by Alpha Vantage</span>
        </div>
      </footer>

    </div>
  `;

  attachEventListeners();
}

// Event Listeners
function attachEventListeners() {
  const desktopBtn = document.getElementById('device-desktop-btn');
  const mobileBtn = document.getElementById('device-mobile-btn');
  if (desktopBtn && mobileBtn) {
    desktopBtn.onclick = () => {
      if (state.deviceMode !== 'desktop') {
        state.deviceMode = 'desktop';
        render();
      }
    };
    mobileBtn.onclick = () => {
      if (state.deviceMode !== 'mobile') {
        state.deviceMode = 'mobile';
        render();
      }
    };
  }
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input') as HTMLInputElement | null;

  if (form && input) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) {
        state.searchQuery = q;
        performCompanySearch(q);
      }
    };
  }

  // Open compare mode toggle
  const openCompareBtn = document.getElementById('open-compare-btn');
  if (openCompareBtn) {
    openCompareBtn.onclick = () => {
      expansionState.compareInvoked = true;
      render();
      const newSelect = document.getElementById('compare-facility-select') as HTMLSelectElement | null;
      if (newSelect) newSelect.focus();
    };
  }

  // Compare facility selector
  const compareSelect = document.getElementById('compare-facility-select') as HTMLSelectElement | null;
  if (compareSelect) {
    compareSelect.onchange = () => {
      const sym = compareSelect.value;
      if (sym) {
        selectCompareFacility(sym);
      } else {
        exitCompareMode();
      }
    };
  }

  // Exit compare button
  const exitBtn = document.getElementById('exit-compare-btn');
  if (exitBtn) {
    exitBtn.onclick = () => {
      expansionState.compareInvoked = false;
      exitCompareMode();
    };
  }

  // News expand / collapse toggle
  const toggleNewsBtn = document.getElementById('toggle-news-btn');
  if (toggleNewsBtn) {
    toggleNewsBtn.onclick = () => {
      expansionState.news = !expansionState.news;
      const extraItems = document.getElementById('news-extra-items');
      if (extraItems) {
        if (expansionState.news) {
          extraItems.classList.remove('is-collapsed');
          extraItems.classList.add('is-expanded');
          toggleNewsBtn.setAttribute('aria-expanded', 'true');
          toggleNewsBtn.textContent = 'Show fewer';
        } else {
          extraItems.classList.remove('is-expanded');
          extraItems.classList.add('is-collapsed');
          toggleNewsBtn.setAttribute('aria-expanded', 'false');
          const remainingCount = Math.max(0, state.newsItems.length - 2);
          toggleNewsBtn.textContent = `${remainingCount} more`;
        }
      } else {
        render();
      }
    };
  }

  // Profile details expand / collapse toggle
  const profileBtns = document.querySelectorAll('.toggle-profile-btn');
  profileBtns.forEach((btn) => {
    (btn as HTMLElement).onclick = () => {
      expansionState.profile = !expansionState.profile;
      const targetId = btn.getAttribute('data-target') || 'profile-details-drawer';
      const drawer = document.getElementById(targetId);
      if (drawer) {
        if (expansionState.profile) {
          drawer.classList.remove('is-collapsed');
          drawer.classList.add('is-expanded');
          btn.setAttribute('aria-expanded', 'true');
          btn.textContent = 'Hide details';
        } else {
          drawer.classList.remove('is-expanded');
          drawer.classList.add('is-collapsed');
          btn.setAttribute('aria-expanded', 'false');
          btn.textContent = 'Site details';
        }
      } else {
        render();
      }
    };
  });

  // Pick list clicks
  const resultRows = document.querySelectorAll('.search-result-row');
  resultRows.forEach((row) => {
    (row as HTMLElement).onclick = () => {
      const sym = row.getAttribute('data-symbol');
      const found = state.searchMatches.find((m) => m.symbol === sym);
      if (found) {
        selectCompany(found);
      }
    };
  });

  // Quick pick buttons
  const quickPickBtns = document.querySelectorAll('.quick-pick-btn');
  quickPickBtns.forEach((btn) => {
    (btn as HTMLElement).onclick = () => {
      const sym = btn.getAttribute('data-quick-symbol');
      if (sym) {
        if (input) input.value = sym;
        state.searchQuery = sym;
        const fac = FACILITIES[sym];
        if (fac) {
          selectCompany({
            symbol: fac.symbol,
            name: fac.name,
            region: 'United States',
            facility: fac
          });
        } else {
          performCompanySearch(sym, true);
        }
      }
    };
  });
}

// Perform Company Search via api/company.js
async function performCompanySearch(query: string, autoSelectFirst = false) {
  state.searchState = 'loading';
  state.searchMatches = [];
  render();

  try {
    const res = await queueAvRequest(() =>
      fetch(`/api/company?q=${encodeURIComponent(query)}`)
    );
    if (res.status === 429) {
      state.searchState = 'rate-limited';
      render();
      return;
    }
    if (!res.ok) {
      const qLower = query.toLowerCase();
      const localMatches: CompanyMatch[] = [];
      for (const f of Object.values(FACILITIES)) {
        if (f.symbol.toLowerCase().includes(qLower) || f.name.toLowerCase().includes(qLower)) {
          localMatches.push({
            symbol: f.symbol,
            name: f.name,
            region: 'United States',
            facility: f
          });
        }
      }
      if (localMatches.length > 0) {
        state.searchState = 'idle';
        state.searchMatches = localMatches;
        if (autoSelectFirst) {
          selectCompany(localMatches[0]);
          return;
        }
        render();
        return;
      }

      state.searchState = 'refused';
      render();
      return;
    }

    const data = await res.json();
    const matches: CompanyMatch[] = Array.isArray(data) ? data : data.matches || [];

    if (matches.length === 0) {
      state.searchState = 'empty';
      state.searchMatches = [];
    } else {
      state.searchState = 'idle';
      state.searchMatches = matches;
      if (autoSelectFirst && matches.length > 0) {
        selectCompany(matches[0]);
        return;
      }
    }
  } catch {
    state.searchState = 'refused';
  }
  render();
}

// Select a company and update all panels
function selectCompany(company: CompanyMatch) {
  // Reset expansion toggles on new lookup (compact by default)
  expansionState.news = false;
  expansionState.profile = false;
  expansionState.compareInvoked = false;

  // Merge facility with hand-entered FACILITIES entry if available
  const known = FACILITIES[company.symbol];
  const facility = known
    ? { ...known, ...(company.facility || {}) }
    : company.facility;

  state.selectedCompany = {
    ...company,
    facility
  };
  state.searchMatches = []; // Clear pick list once picked
  state.compareSymbol = null; // Reset comparison on primary company change
  state.compareState = 'idle';
  state.compareTiles = null;
  state.compareImageUrl = null;
  state.compareSource = null;

  // Trigger Panel B (Satellite), Panel C (Price), Panel D (News)
  fetchSatellite(state.selectedCompany);
  fetchPrices(company.symbol);
  fetchNews(company.name);

  render();
}

// Fetch comparison satellite imagery for selected compare company (does NOT call price or news)
async function selectCompareFacility(symbol: string) {
  state.compareSymbol = symbol;
  state.compareState = 'loading';
  state.compareTiles = null;
  state.compareImageUrl = null;
  state.compareSource = null;
  render();

  const fac = FACILITIES[symbol];
  if (!fac || typeof fac.lat !== 'number' || typeof fac.lon !== 'number') {
    state.compareState = 'unreachable';
    render();
    return;
  }

  try {
    const res = await fetch(`/api/satellite?lat=${fac.lat}&lon=${fac.lon}`);
    if (!res.ok) {
      state.compareState = 'unreachable';
      render();
      return;
    }
    const data = await res.json();
    if (data.source === 'landsat' && data.url) {
      state.compareSource = 'landsat';
      state.compareImageUrl = data.url;
      state.compareTiles = null;
      state.compareState = 'loaded';
    } else if (data.source === 'esri' && Array.isArray(data.tiles)) {
      state.compareSource = 'esri';
      state.compareTiles = data.tiles;
      state.compareImageUrl = null;
      state.compareState = 'loaded';
    } else {
      state.compareState = 'unreachable';
    }
  } catch {
    state.compareState = 'unreachable';
  }
  render();
}

// Exit compare mode
function exitCompareMode() {
  expansionState.compareInvoked = false;
  state.compareSymbol = null;
  state.compareState = 'idle';
  state.compareTiles = null;
  state.compareImageUrl = null;
  state.compareSource = null;
  render();
}

// Fetch Satellite Tile via api/satellite.js
async function fetchSatellite(company: CompanyMatch) {
  // Number.isFinite, not truthiness: latitude or longitude 0 is a real
  // coordinate and must not read as "no mapped facility".
  const fac = company.facility;
  if (!fac || !Number.isFinite(fac.lat) || !Number.isFinite(fac.lon)) {
    state.satelliteState = 'no-facility';
    state.satelliteSource = null;
    state.satelliteImageUrl = null;
    state.satelliteTiles = null;
    state.satelliteCaptureDate = null;
    state.satelliteFallback = false;
    render();
    return;
  }

  state.satelliteState = 'loading';
  state.satelliteSource = null;
  state.satelliteImageUrl = null;
  state.satelliteTiles = null;
  state.satelliteCaptureDate = null;
  state.satelliteFallback = false;
  render();

  try {
    const lat = fac.lat;
    const lon = fac.lon;
    const res = await fetch(`/api/satellite?lat=${lat}&lon=${lon}`);

    if (res.status === 401 || res.status === 403) {
      state.satelliteState = 'refused';
      render();
      return;
    }

    if (res.status === 504 || res.status === 502 || res.status === 503 || !res.ok) {
      state.satelliteState = 'unreachable';
      render();
      return;
    }

    const data = await res.json();
    if (data.source === 'landsat') {
      state.satelliteSource = 'landsat';
      state.satelliteImageUrl = data.url;
      state.satelliteCaptureDate = data.captureDate || null;
      state.satelliteFallback = false;
      state.satelliteTiles = null;
      state.satelliteState = 'loaded';
    } else if (data.source === 'esri') {
      state.satelliteSource = 'esri';
      state.satelliteTiles = Array.isArray(data.tiles) ? data.tiles : [];
      state.satelliteFallback = true;
      state.satelliteCaptureDate = null;
      state.satelliteImageUrl = null;
      state.satelliteState = 'loaded';
    } else {
      state.satelliteState = 'unreachable';
    }
  } catch {
    state.satelliteState = 'unreachable';
  }
  render();
}

// Fetch 90-Day Prices via api/prices.js
async function fetchPrices(symbol: string) {
  state.priceState = 'loading';
  state.priceData = null;
  render();

  try {
    const res = await queueAvRequest(() =>
      fetch(`/api/prices?symbol=${encodeURIComponent(symbol)}`)
    );

    if (res.status === 401 || res.status === 403) {
      state.priceState = 'refused';
      render();
      return;
    }

    if (res.status === 429) {
      state.priceState = 'rate-limited';
      state.priceRateLimitedTime = new Date().toISOString();
      render();
      return;
    }

    if (res.status === 504 || res.status === 502 || res.status === 503) {
      state.priceState = 'unreachable';
      render();
      return;
    }

    if (!res.ok) {
      state.priceState = 'unreachable';
      render();
      return;
    }

    const data: PriceData = await res.json();

    if (!data.prices || data.prices.length === 0) {
      state.priceState = 'empty';
      state.priceData = null;
    } else {
      state.priceData = data;
      state.priceState = data.stale ? 'rate-limited' : 'loaded';
    }
  } catch {
    state.priceState = 'unreachable';
  }
  render();
}

// Fetch News via api/news.js
async function fetchNews(companyName: string) {
  state.newsState = 'loading';
  state.newsItems = [];
  render();

  try {
    const res = await fetch(`/api/news?q=${encodeURIComponent(companyName)}`);

    if (res.status === 401 || res.status === 403) {
      state.newsState = 'refused';
      render();
      return;
    }

    if (res.status === 504 || res.status === 502 || res.status === 503) {
      state.newsState = 'unreachable';
      render();
      return;
    }

    if (!res.ok) {
      state.newsState = 'unreachable';
      render();
      return;
    }

    const data = await res.json();
    const items: NewsItem[] = Array.isArray(data) ? data : data.results || [];

    if (items.length === 0) {
      state.newsState = 'empty';
      state.newsItems = [];
    } else {
      state.newsItems = items;
      state.newsState = 'loaded';
    }
  } catch {
    state.newsState = 'unreachable';
  }
  render();
}

// Fetch Health Status via api/health.js
async function fetchHealth() {
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const data: HealthData = await res.json();
      state.health = data;
      render();
    }
  } catch {
    // Health is non-blocking
  }
}

// App Initialization
async function init() {
  render();
  // Fetch initial provider health status in background
  fetchHealth();

  // Load default demo company (WMT)
  selectCompany(DEFAULT_COMPANY);
}

// Start application
init();
