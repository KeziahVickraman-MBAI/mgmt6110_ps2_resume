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
  // Which slice of the already-fetched series the chart draws. Changing this
  // NEVER refetches — the 90-day series is already in priceData and Alpha
  // Vantage would reject another call.
  chartPeriod: 30 | 90;
  // Full-screen chart. The price panel itself becomes the overlay, so there is
  // only ever one chart in the DOM and no duplicated element ids.
  chartFullscreen: boolean;
  // Newsletter signup. Its own four states, deliberately separate from any
  // data panel: a form failure is not a provider outage and must not read
  // like one.
  signupState: 'idle' | 'submitting' | 'sent' | 'rejected' | 'unreachable';
  signupName: string;
  signupEmail: string;
  signupEmailError: string | null;
  // Ticker captured at submit time, so the confirmation keeps naming the
  // company that was actually tracked.
  signupTrackedTicker: string | null;
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
  deviceMode: 'desktop',
  chartPeriod: 90,
  chartFullscreen: false,
  signupState: 'idle',
  signupName: '',
  signupEmail: '',
  signupEmailError: null,
  signupTrackedTicker: null
};

// UI Expansion state (per-session, resets on lookup)
interface ExpansionState {
  news: boolean;
  profile: boolean;
  compareInvoked: boolean;
  synthesis: boolean;
}

const expansionState: ExpansionState = {
  news: false,
  profile: false,
  compareInvoked: false,
  synthesis: false
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
//
// Geometry is kept in chartGeom so the hover/keyboard handlers can invert a
// pointer position back to a data index without re-deriving any of it.
interface ChartGeom {
  points: PricePoint[];
  width: number;
  padLeft: number;
  padTop: number;
  chartW: number;
  chartH: number;
  minPrice: number;
  priceRange: number;
}

let chartGeom: ChartGeom | null = null;

function chartX(g: ChartGeom, index: number): number {
  if (g.points.length < 2) return g.padLeft;
  return g.padLeft + (index / (g.points.length - 1)) * g.chartW;
}

function chartY(g: ChartGeom, price: number): number {
  return g.padTop + g.chartH - ((price - g.minPrice) / g.priceRange) * g.chartH;
}

// Geometry of the inline chart. Full screen passes its own so the viewBox
// stays close to the rendered pixel size — preserveAspectRatio="none" would
// otherwise stretch the axis text along with the plot.
interface ChartOptions {
  width?: number;
  height?: number;
  padLeft?: number;
  padRight?: number;
  padTop?: number;
  padBottom?: number;
  labelSize?: number;
  axisSize?: number;
}

const FULLSCREEN_CHART: ChartOptions = {
  width: 1200,
  height: 520,
  padLeft: 72,
  padRight: 30,
  padTop: 30,
  padBottom: 44,
  labelSize: 13,
  axisSize: 12
};

function generatePriceChartSvg(prices: PricePoint[], opts: ChartOptions = {}): string {
  if (!prices || prices.length < 2) {
    chartGeom = null;
    return '';
  }

  const width = opts.width ?? 340;
  const height = opts.height ?? 180;
  const padLeft = opts.padLeft ?? 45;
  const padRight = opts.padRight ?? 15;
  const padTop = opts.padTop ?? 20;
  const padBottom = opts.padBottom ?? 26;
  const labelSize = opts.labelSize ?? 10;
  const axisSize = opts.axisSize ?? 9.5;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const closes = prices.map((p) => p.close);
  const minPrice = Math.min(...closes);
  const maxPrice = Math.max(...closes);
  const priceRange = maxPrice - minPrice || 1;

  const g: ChartGeom = { points: prices, width, padLeft, padTop, chartW, chartH, minPrice, priceRange };
  chartGeom = g;

  const getX = (index: number) => chartX(g, index);
  const getY = (price: number) => chartY(g, price);

  const points = prices.map((p, i) => `${getX(i).toFixed(1)},${getY(p.close).toFixed(1)}`).join(' ');
  const firstX = getX(0).toFixed(1);
  const lastX = getX(prices.length - 1).toFixed(1);
  const bottomY = (padTop + chartH).toFixed(1);
  const areaPath = `M ${firstX},${bottomY} L ${points} L ${lastX},${bottomY} Z`;

  const midPrice = minPrice + priceRange / 2;
  const isUp = prices[prices.length - 1].close >= prices[0].close;
  const strokeColor = isUp ? '#2F6B4F' : '#A33A2A';

  const rangeLabel = `${formatDate(prices[0].date)} to ${formatDate(prices[prices.length - 1].date)}`;

  return `
    <svg
      id="price-chart"
      class="price-chart-svg"
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="none"
      tabindex="0"
      role="img"
      aria-label="Daily closing prices, ${prices.length} points, ${esc(rangeLabel)}. Use the left and right arrow keys to step through individual closes."
      aria-describedby="chart-readout"
    >
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
      <text x="${padLeft - 6}" y="${(getY(maxPrice) + 3).toFixed(1)}" text-anchor="end" font-size="${labelSize}" fill="#6E7469" font-family="monospace">$${maxPrice.toFixed(2)}</text>
      <text x="${padLeft - 6}" y="${(getY(minPrice) + 3).toFixed(1)}" text-anchor="end" font-size="${labelSize}" fill="#6E7469" font-family="monospace">$${minPrice.toFixed(2)}</text>

      <!-- Area fill -->
      <path d="${areaPath}" fill="url(#priceGradient)" />

      <!-- Price polyline -->
      <polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Endpoint circle -->
      <circle cx="${lastX}" cy="${getY(prices[prices.length - 1].close).toFixed(1)}" r="3" fill="${strokeColor}" />

      <!-- Crosshair, revealed on hover or keyboard focus -->
      <g id="chart-crosshair" class="chart-crosshair" visibility="hidden" pointer-events="none">
        <line id="chart-crosshair-line" y1="${padTop}" y2="${padTop + chartH}" stroke="#1B1F1A" stroke-width="1" stroke-dasharray="3,2" opacity="0.55" />
        <circle id="chart-crosshair-dot" r="3.5" fill="${strokeColor}" stroke="#FBFBF8" stroke-width="1.5" />
      </g>

      <!-- Date bounds on X-axis -->
      <text x="${padLeft}" y="${height - 6}" text-anchor="start" font-size="${axisSize}" fill="#6E7469">${formatDate(prices[0].date)}</text>
      <text x="${padLeft + chartW}" y="${height - 6}" text-anchor="end" font-size="${axisSize}" fill="#6E7469">${formatDate(prices[prices.length - 1].date)}</text>

      <!-- Transparent hit area last so it receives every pointer event -->
      <rect id="chart-hit" x="${padLeft}" y="${padTop}" width="${chartW}" height="${chartH}" fill="transparent" />
    </svg>
  `;
}

// Compact metadata row that sits directly under the hero image.
//
// Left: "Corporate HQ · 140 ha". Right: the "Site details" toggle and, for the
// primary panel, the compare control. Everything that used to be stacked below
// the hero as separate grey paragraphs — the four profile fields, the capture
// date, the "shows scale and site type" line and the imagery caption — now
// lives in the one drawer this row opens. Those lines are provenance, not
// primary content, but they are never deleted and always reachable: the
// toggle renders whenever the drawer has anything in it.
//
// The provider ATTRIBUTION is deliberately NOT in the drawer. It is a licence
// requirement and stays visible at all times.
interface MetaRowOptions {
  drawerId?: string;
  // Extra provenance to fold into the drawer (primary panel only).
  provenance?: string[];
  // Render the compare control in this row (primary panel only).
  compareControl?: string;
}

function renderFacilityMetaRow(
  fac: Facility | FacilityEntry | null | undefined,
  options: MetaRowOptions = {}
): string {
  const drawerId = options.drawerId || 'profile-details-drawer';
  const provenance = options.provenance || [];
  const compareControl = options.compareControl || '';

  const hasType = !!fac?.siteType;
  const hasFootprint = typeof fac?.footprintHa === 'number' && !isNaN(fac.footprintHa as number);

  const fields: string[] = [];
  if (fac?.siteType) {
    fields.push(`
      <div>
        <span class="profile-field-label">Site type</span>
        <span class="profile-field-value">${esc(fac.siteType)}</span>
      </div>
    `);
  }
  if (typeof fac?.footprintHa === 'number' && !isNaN(fac.footprintHa)) {
    fields.push(`
      <div>
        <span class="profile-field-label">Footprint</span>
        <span class="profile-field-value">${esc(fac.footprintHa)} ha</span>
      </div>
    `);
  }
  if (fac?.scaleNote) {
    fields.push(`
      <div>
        <span class="profile-field-label">Scale context</span>
        <span class="profile-field-value">${esc(fac.scaleNote)}</span>
      </div>
    `);
  }
  if (fac?.measuredOn) {
    fields.push(`
      <div>
        <span class="profile-field-label">Provenance</span>
        <span class="profile-field-value profile-field-quiet">Measured by hand from basemap imagery, ${esc(fac.measuredOn)}</span>
      </div>
    `);
  }

  const hasDrawer = fields.length > 0 || provenance.length > 0;

  // Nothing to show and nothing to control: render nothing at all.
  if (!hasDrawer && !compareControl && !hasType && !hasFootprint) return '';

  const isExpanded = expansionState.profile;

  return `
    <div class="facility-meta-wrapper">
      <div class="facility-meta-row">
        <div class="facility-meta-summary">
          ${fac?.siteType ? `<span class="profile-summary-type">${esc(fac.siteType)}</span>` : ''}
          ${hasType && hasFootprint ? `<span class="profile-summary-sep">·</span>` : ''}
          ${hasFootprint ? `<span class="profile-summary-ha">${esc(fac?.footprintHa)} ha</span>` : ''}
        </div>
        <div class="facility-meta-controls">
          ${
            hasDrawer
              ? `
            <button
              type="button"
              class="quiet-toggle-btn toggle-profile-btn"
              data-target="${esc(drawerId)}"
              aria-expanded="${isExpanded ? 'true' : 'false'}"
              aria-controls="${esc(drawerId)}"
            >
              ${isExpanded ? 'Hide details' : 'Site details'}
            </button>
          `
              : ''
          }
          ${compareControl}
        </div>
      </div>
      ${
        hasDrawer
          ? `
        <div class="profile-details-drawer ${isExpanded ? 'is-expanded' : 'is-collapsed'}" id="${esc(drawerId)}">
          ${fields.length > 0 ? `<div class="site-profile-strip">${fields.join('')}</div>` : ''}
          ${provenance.map((line) => `<p class="provenance-line">${line}</p>`).join('')}
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

// Compute the footprint ratio between two facilities.
//
// Returned in parts so the multiple can be set larger than the words around
// it. Both footprints are hand-entered FACILITIES figures — nothing here is
// derived from imagery.
interface RatioLine {
  before: string;
  multiple: string | null;
  after: string;
}

function computeRatioLine(
  primaryName: string,
  primaryFacility: Facility | FacilityEntry | null | undefined,
  compareFacility: FacilityEntry | null | undefined
): RatioLine | null {
  if (!primaryFacility || !compareFacility) return null;
  const pHa = primaryFacility.footprintHa;
  const cHa = compareFacility.footprintHa;
  if (typeof pHa !== 'number' || typeof cHa !== 'number' || pHa <= 0 || cHa <= 0) {
    return null;
  }

  const pClean = toPossessive(cleanName(primaryName));
  const cClean = toPossessive(cleanName(compareFacility.name));

  if (Math.abs(pHa - cHa) < 0.05) {
    return {
      before: `${pClean} primary site is roughly the same footprint as ${cClean}.`,
      multiple: null,
      after: ''
    };
  }

  if (pHa >= cHa) {
    return {
      before: `${pClean} primary site is roughly`,
      multiple: `${(pHa / cHa).toFixed(1)}x`,
      after: `the footprint of ${cClean}.`
    };
  }
  return {
    before: `${cClean} primary site is roughly`,
    multiple: `${(cHa / pHa).toFixed(1)}x`,
    after: `the footprint of ${pClean}.`
  };
}

function renderRatioLine(ratio: RatioLine | null): string {
  if (!ratio) return '';
  return `
    <div class="compare-ratio">
      <span class="compare-ratio-text">${esc(ratio.before)}</span>
      ${ratio.multiple ? `<span class="compare-ratio-multiple">${esc(ratio.multiple)}</span>` : ''}
      ${ratio.after ? `<span class="compare-ratio-text">${esc(ratio.after)}</span>` : ''}
    </div>
  `;
}

// --- Newsletter signup (Web3Forms) ---------------------------------------

// WEB3FORMS_KEY is the one credential in this project that lives in browser code.
// It can do exactly one thing: post a message to one inbox. It cannot read anything,
// cannot be used against another account, and exposing it costs us nothing beyond
// spam to our own address. Every other key here is server-side because every other
// key can do more than one thing. Do not generalise from this.
const WEB3FORMS_KEY =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_WEB3FORMS_KEY ?? '';

const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function submitSignup(): Promise<void> {
  const company = state.selectedCompany;
  if (!company || state.signupState === 'submitting') return;

  const email = state.signupEmail.trim();

  // Validate here rather than posting a bad address and letting the service
  // reject it — that would surface as "rejected", which blames the wrong party.
  if (!isValidEmail(email)) {
    state.signupEmailError = "That doesn't look like an email address";
    render();
    (document.getElementById('signup-email') as HTMLInputElement | null)?.focus();
    return;
  }

  state.signupEmailError = null;
  state.signupState = 'submitting';
  render();

  try {
    // The address travels in the POST body only, never in the URL.
    const response = await fetch(WEB3FORMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: 'Overberg · new tracker',
        from_name: 'Overberg',
        email,
        name: state.signupName.trim(),
        message: `Tracking ${company.name} (${company.symbol})`,
        // Web3Forms passes unrecognised fields straight into the email body,
        // so these need no configuration at their end.
        ticker: company.symbol,
        company: company.name
      })
    });

    // Web3Forms answers HTTP 200 carrying {"success": false}. Branch on the
    // payload, NEVER on response.ok. This is the second place in this codebase
    // where a success code carries a failure — the first is Alpha Vantage
    // returning 200 with an "Information" key (see api/prices.js) — and both
    // are checked the same way.
    const data = await response.json().catch(() => null);

    if (data && data.success === true) {
      state.signupTrackedTicker = company.symbol;
      state.signupState = 'sent';
    } else {
      // We reached the service and it declined. That is not an outage.
      state.signupState = 'rejected';
    }
  } catch {
    // The request never completed.
    state.signupState = 'unreachable';
  }

  render();
}

// --- Synthesis -----------------------------------------------------------
//
// Arithmetic over values this page has already fetched and displayed. No API
// call, no model call, no inference. Each row states what a number IS; none
// states what it means, predicts, or recommends.
//
// Guardrail: a panel that is loading, empty, refused, unreachable or
// rate-limited contributes NO column at all. Nothing here substitutes a
// default or a placeholder for a figure we do not have.
//
// Each row is a figure with a label beneath it — the figure is the content and
// carries the only meaningful colour on the page:
//   'down' for the drawdown and the down-day count
//   'up'   for the up-day count and a close in the top half of its range
//   'ink'  for everything else. Labels are never tinted.

type SynthesisTone = 'ink' | 'up' | 'down';

interface SynthesisRow {
  // Pre-built HTML when a single row needs two differently toned figures
  // (up days / down days); otherwise plain text.
  figure: string;
  label: string;
  tone?: SynthesisTone;
  figureIsHtml?: boolean;
}

interface SynthesisGroup {
  heading: string;
  rows: SynthesisRow[];
}

const MAX_ROWS_PER_COLUMN = 4;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Daily simple returns across the series.
function dailyReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(closes[i] / closes[i - 1] - 1);
  }
  return returns;
}

// Short date used inside labels, e.g. "19 May".
function shortDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function priceSynthesisGroup(): SynthesisGroup | null {
  // Only a fully resolved price panel contributes. A stale/rate-limited panel
  // carries figures we cannot date confidently, so it is omitted entirely.
  if (state.priceState !== 'loaded') return null;
  const prices = state.priceData?.prices;
  if (!prices || prices.length < 2) return null;

  const closes = prices.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const last = closes[closes.length - 1];
  const rows: SynthesisRow[] = [];

  // Position of the last close within the window's range.
  if (max > min) {
    const pct = ((last - min) / (max - min)) * 100;
    const inTopHalf = pct > 50;
    rows.push({
      figure: inTopHalf ? `Top ${Math.round(100 - pct)}%` : `Bottom ${Math.round(pct)}%`,
      label: `Position in its ${prices.length}-day range, closed $${last.toFixed(2)}`,
      tone: inTopHalf ? 'up' : 'ink'
    });
  }

  // Maximum peak-to-trough decline over the window.
  let runningPeak = closes[0];
  let runningPeakIdx = 0;
  let worst = 0;
  let worstPeakIdx = 0;
  let worstTroughIdx = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > runningPeak) {
      runningPeak = closes[i];
      runningPeakIdx = i;
    }
    const decline = (closes[i] - runningPeak) / runningPeak;
    if (decline < worst) {
      worst = decline;
      worstPeakIdx = runningPeakIdx;
      worstTroughIdx = i;
    }
  }
  if (worst < 0) {
    rows.push({
      figure: `${(Math.abs(worst) * 100).toFixed(1)}%`,
      label: `Maximum drawdown, ${shortDate(prices[worstPeakIdx].date)} to ${shortDate(prices[worstTroughIdx].date)}`,
      tone: 'down'
    });
  }

  const returns = dailyReturns(closes);
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
    const annualised = Math.sqrt(variance) * Math.sqrt(252) * 100;
    rows.push({
      figure: `${annualised.toFixed(1)}%`,
      label: `Realised volatility, annualised from ${returns.length} daily returns`,
      tone: 'ink'
    });
  }

  if (returns.length > 0) {
    const up = returns.filter((r) => r > 0).length;
    const down = returns.filter((r) => r < 0).length;
    rows.push({
      figure: `<span class="syn-up">${up}</span><span class="syn-divider"> / </span><span class="syn-down">${down}</span>`,
      figureIsHtml: true,
      label: 'Up days and down days'
    });
  }

  return rows.length > 0 ? { heading: 'Price', rows: rows.slice(0, MAX_ROWS_PER_COLUMN) } : null;
}

function coverageSynthesisGroup(): SynthesisGroup | null {
  if (state.newsState !== 'loaded' || state.newsItems.length === 0) return null;

  const now = Date.now();
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const total = state.newsItems.length;
  const sectionCounts: Record<string, number> = {};
  let recent = 0;
  let older = 0;
  let newestMs: number | null = null;

  for (const item of state.newsItems) {
    const t = new Date(item.date).getTime();
    if (!Number.isNaN(t)) {
      if (now - t <= NINETY_DAYS_MS) recent++;
      else older++;
      if (newestMs === null || t > newestMs) newestMs = t;
    }
    if (item.section) {
      sectionCounts[item.section] = (sectionCounts[item.section] || 0) + 1;
    }
  }

  const rows: SynthesisRow[] = [];
  if (recent + older > 0) {
    rows.push({
      figure: `${recent} of ${total}`,
      label: 'Results published in the last 90 days',
      tone: 'ink'
    });
    rows.push({
      figure: `${older}`,
      label: older === 1 ? 'Result older than 90 days' : 'Results older than 90 days',
      tone: 'ink'
    });
  }

  let topSection = '';
  let topCount = 0;
  for (const [section, count] of Object.entries(sectionCounts)) {
    if (count > topCount) {
      topCount = count;
      topSection = section;
    }
  }
  if (topSection) {
    rows.push({
      figure: topSection,
      label: `Most frequent section, ${topCount} of ${total} results`,
      tone: 'ink'
    });
  }

  if (newestMs !== null) {
    const days = Math.max(0, Math.floor((now - newestMs) / (24 * 60 * 60 * 1000)));
    rows.push({
      figure: days === 1 ? '1 day' : `${days} days`,
      label: 'Age of the most recent article',
      tone: 'ink'
    });
  }

  return rows.length > 0 ? { heading: 'Coverage', rows: rows.slice(0, MAX_ROWS_PER_COLUMN) } : null;
}

function siteSynthesisGroup(): SynthesisGroup | null {
  // Footprint only. Nothing about the imagery itself belongs in a synthesis.
  if (state.satelliteState !== 'loaded') return null;

  const symbol = state.selectedCompany?.symbol;
  if (!symbol) return null;
  const facility = state.selectedCompany?.facility;
  const footprint = facility?.footprintHa ?? FACILITIES[symbol]?.footprintHa;
  if (typeof footprint !== 'number' || !Number.isFinite(footprint)) return null;

  const mapped = Object.values(FACILITIES).filter(
    (f) => typeof f.footprintHa === 'number' && Number.isFinite(f.footprintHa)
  );
  if (mapped.length === 0) return null;

  const ranked = [...mapped].sort((a, b) => (b.footprintHa as number) - (a.footprintHa as number));
  const rank = ranked.findIndex((f) => f.symbol === symbol) + 1;
  if (rank === 0) return null;

  const rows: SynthesisRow[] = [
    {
      figure: `${ordinal(rank)} of ${mapped.length}`,
      label: 'Rank by footprint among mapped sites',
      tone: 'ink'
    },
    {
      figure: `${footprint} ha`,
      label: facility?.measuredOn
        ? `Site footprint, entered by hand ${facility.measuredOn}`
        : 'Site footprint',
      tone: 'ink'
    }
  ];

  if (facility?.siteType) {
    rows.push({ figure: facility.siteType, label: 'Site type', tone: 'ink' });
  }

  return { heading: 'Site', rows: rows.slice(0, MAX_ROWS_PER_COLUMN) };
}

function renderSynthesisRow(row: SynthesisRow): string {
  const toneClass = row.tone === 'up' ? 'syn-up' : row.tone === 'down' ? 'syn-down' : '';
  return `
    <div class="synthesis-row">
      <span class="synthesis-figure ${toneClass}">${row.figureIsHtml ? row.figure : esc(row.figure)}</span>
      <span class="synthesis-row-label">${esc(row.label)}</span>
    </div>
  `;
}

function renderSignupSection(): string {
  const company = state.selectedCompany;
  const hasCompany = !!company;
  const ticker = company ? company.symbol : '';
  const buttonLabel = ticker ? `Track ${esc(ticker)}` : 'Track';
  const isSubmitting = state.signupState === 'submitting';
  const disabled = !hasCompany || isSubmitting;

  // Sent collapses the whole form to the confirmation line.
  if (state.signupState === 'sent') {
    return `
      <section class="signup-section" aria-labelledby="signup-heading">
        <div class="signup-inner">
          <div class="signup-copy">
            <h2 class="signup-heading" id="signup-heading">Track this company</h2>
            <p class="signup-status signup-status--sent" role="status" aria-live="polite">
              Tracking ${esc(state.signupTrackedTicker || ticker)}. Check your inbox to confirm.
            </p>
          </div>
        </div>
        <p class="signup-honesty">
          Signups are collected but the digest isn't running yet. This form demonstrates the capture step only.
        </p>
      </section>
    `;
  }

  // One status line, driven by the submitting / rejected / unreachable states.
  // These sentences are the signup's own — a form failure is not a data-panel
  // outage and must not borrow a panel's wording.
  let statusLine = '';
  if (isSubmitting) {
    statusLine = 'Sending…';
  } else if (state.signupState === 'rejected') {
    statusLine = "That didn't go through. The form service rejected the request.";
  } else if (state.signupState === 'unreachable') {
    statusLine = "Can't reach the form service. Try again in a moment.";
  }

  const statusClass =
    state.signupState === 'rejected' || state.signupState === 'unreachable'
      ? 'signup-status signup-status--fail'
      : 'signup-status';

  return `
    <section class="signup-section" aria-labelledby="signup-heading">
      <!-- Two columns so the full-width band is actually used: copy on the
           left, controls on the right. Stacks below 820px. -->
      <div class="signup-inner">
        <div class="signup-copy">
          <h2 class="signup-heading" id="signup-heading">Track this company</h2>
          ${
            hasCompany
              ? `<p class="signup-sub">We'll email you when there's new Guardian coverage of ${esc(company!.name)}. One message a week at most.</p>`
              : `<p class="signup-sub">Pick a company first.</p>`
          }
        </div>

        <div class="signup-action">
      <form id="signup-form" class="signup-form" novalidate>
        <div class="signup-field">
          <label class="signup-label" for="signup-name">Name <span class="signup-optional">(optional)</span></label>
          <input
            id="signup-name"
            name="name"
            type="text"
            autocomplete="name"
            class="signup-input"
            value="${esc(state.signupName)}"
            ${disabled ? 'disabled' : ''}
          />
        </div>

        <div class="signup-field">
          <label class="signup-label" for="signup-email">Email</label>
          <input
            id="signup-email"
            name="email"
            type="email"
            required
            autocomplete="email"
            class="signup-input ${state.signupEmailError ? 'has-error' : ''}"
            value="${esc(state.signupEmail)}"
            aria-invalid="${state.signupEmailError ? 'true' : 'false'}"
            ${state.signupEmailError ? 'aria-describedby="signup-email-error"' : ''}
            ${disabled ? 'disabled' : ''}
          />
          ${
            state.signupEmailError
              ? `<span class="signup-error" id="signup-email-error">${esc(state.signupEmailError)}</span>`
              : ''
          }
        </div>

        <button
          type="submit"
          id="signup-submit"
          class="signup-btn"
          ${disabled ? 'disabled' : ''}
        >${buttonLabel}</button>
      </form>

          <p class="${statusClass}" role="status" aria-live="polite">${esc(statusLine)}</p>
        </div>
      </div>

      <p class="signup-honesty">
        Signups are collected but the digest isn't running yet. This form demonstrates the capture step only.
      </p>
    </section>
  `;
}

function renderSynthesisSection(): string {
  const isOpen = expansionState.synthesis;
  const groups = [priceSynthesisGroup(), coverageSynthesisGroup(), siteSynthesisGroup()].filter(
    (g): g is SynthesisGroup => g !== null
  );

  const body =
    groups.length === 0
      ? `<p class="synthesis-pending">No panel has resolved figures to compute from yet.</p>`
      : `
        <div class="synthesis-columns">
          ${groups
            .map(
              (group) => `
            <div class="synthesis-column">
              <h3 class="synthesis-column-heading">${esc(group.heading)}</h3>
              ${group.rows.map(renderSynthesisRow).join('')}
            </div>
          `
            )
            .join('')}
        </div>
        <p class="synthesis-note">Computed from the data on this page. No inference, no external model.</p>
      `;

  return `
    <section class="synthesis-section">
      <button
        type="button"
        id="synthesize-btn"
        class="synthesize-btn"
        aria-expanded="${isOpen ? 'true' : 'false'}"
        aria-controls="synthesis-output"
      >
        Synthesize
      </button>
      <div
        id="synthesis-output"
        class="synthesis-band ${isOpen ? 'is-expanded' : 'is-collapsed'}"
        ${isOpen ? '' : 'hidden'}
      >
        ${body}
      </div>
    </section>
  `;
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

  // Compare control, previously in the panel header, now in the metadata row
  // directly under the hero.
  const compareControl = !expansionState.compareInvoked && !state.compareSymbol
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
          <option value="${esc(f.symbol)}" ${state.compareSymbol === f.symbol ? 'selected' : ''}>
            ${esc(f.symbol)} · ${esc(f.name)}
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
    `;

  // Provenance folded into the "Site details" drawer: the capture date when we
  // have one, the scale/activity disclaimer, and the imagery caption. All three
  // are verbatim; only their placement changed.
  const satelliteSources = activeSatelliteSources();
  const captionText =
    satelliteSources.length === 0
      ? CAPTION_LANDSAT
      : satelliteSources.map((src) => (src === 'esri' ? CAPTION_ESRI : CAPTION_LANDSAT)).join(' ');
  const attributionText =
    satelliteSources.length === 0
      ? ATTRIBUTION_LANDSAT
      : satelliteSources
          .map((src) => (src === 'esri' ? ATTRIBUTION_ESRI : ATTRIBUTION_LANDSAT))
          .join(' · ');

  const satelliteProvenance: string[] = [];
  if (state.satelliteSource === 'landsat' && state.satelliteCaptureDate) {
    satelliteProvenance.push(`Captured: ${esc(state.satelliteCaptureDate)}`);
  }
  satelliteProvenance.push(
    'This panel shows scale and site type. It does not show activity. Measuring change would need dated, repeat imagery from a commercial provider — the input we don\'t have.'
  );
  satelliteProvenance.push(captionText);

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

            <!-- Three Provider Status Chips -->
            <div class="status-chips-group">
              ${getStatusChip('satellite', 'Satellite')}
              ${getStatusChip('news', 'News')}
              ${getStatusChip('price', 'Price')}
            </div>
          </div>

          ${
            state.compareSymbol && FACILITIES[state.compareSymbol]
              ? `
            <!-- COMPARE MODE: two viewports at the SAME zoom with matched
                 overlays. No price overlay on either: we fetch prices for the
                 primary company only, so showing a change on one image and
                 nothing on the other invited a comparison the data does not
                 support. Both carry name, ticker and facility only, and the
                 footprint ratio — the actual point of the mode — sits between
                 them. Stacks to one column under 820px. -->
            <div class="compare-grid">
              <!-- Primary Company -->
              <div class="compare-column">
                <div class="compare-viewport-container">
                  ${renderViewportContent(state.satelliteState, state.satelliteSource, state.satelliteTiles, state.satelliteImageUrl, facilityLabel)}
                  <div class="hero-scrim-overlay">
                    <h1 class="hero-company-name compare-hero-name">${esc(name)}</h1>
                    <div class="hero-meta-row compare-hero-meta">
                      <span class="hero-ticker">${esc(symbol)}</span>
                      ${region && region !== '—' ? `<span>·</span><span>${esc(region)}</span>` : ''}
                    </div>
                    <div class="hero-facility-label compare-hero-facility">${esc(facilityLabel)}</div>
                  </div>
                </div>
                ${renderFacilityMetaRow(comp?.facility, { drawerId: 'profile-details-primary', provenance: satelliteProvenance, compareControl })}
              </div>

              <!-- Footprint ratio, centred between the pair -->
              ${renderRatioLine(computeRatioLine(name, comp?.facility, FACILITIES[state.compareSymbol]))}

              <!-- Compared Company -->
              <div class="compare-column">
                <div class="compare-viewport-container">
                  ${renderViewportContent(state.compareState, state.compareSource, state.compareTiles, state.compareImageUrl, FACILITIES[state.compareSymbol].label)}
                  <div class="hero-scrim-overlay">
                    <div class="hero-company-name compare-hero-name">${esc(FACILITIES[state.compareSymbol].name)}</div>
                    <div class="hero-meta-row compare-hero-meta">
                      <span class="hero-ticker">${esc(FACILITIES[state.compareSymbol].symbol)}</span>
                      <span>·</span>
                      <span>Comparison</span>
                    </div>
                    <div class="hero-facility-label compare-hero-facility">${esc(FACILITIES[state.compareSymbol].label)}</div>
                  </div>
                </div>
                ${renderFacilityMetaRow(FACILITIES[state.compareSymbol], { drawerId: 'profile-details-compare' })}
              </div>
            </div>
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

            <!-- Metadata row under the collapsed line -->
            ${renderFacilityMetaRow(comp?.facility, { provenance: satelliteProvenance, compareControl })}
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

            <!-- Compact metadata row directly under the hero. Capture date,
                 disclaimer and caption are folded into its drawer. -->
            ${renderFacilityMetaRow(comp?.facility, { provenance: satelliteProvenance, compareControl })}
          `
          }
        </div>

        <!-- Attribution is a licence requirement: always visible, never behind
             the Site details toggle. -->
        <div class="panel-bottom-bar panel-bottom-bar--attribution-only">
          <span class="panel-attribution">${attributionText}</span>
        </div>
      </section>

      <!-- CROSS-PANEL SYNTHESIS (Directly beneath hero, above lower grid) -->
      ${renderCrossPanelSynthesis()}

      <!-- Compare mode puts a second company on screen, but prices and coverage
           are fetched once, for the primary company only (selectCompareFacility
           requests imagery and nothing else). Say so rather than leaving two
           unlabelled panels next to two facilities. -->
      ${
        state.compareSymbol && FACILITIES[state.compareSymbol] && comp
          ? `<p class="compare-scope-note">Prices and coverage below are for ${esc(symbol)} only — neither is fetched for ${esc(state.compareSymbol)}.</p>`
          : ''
      }

      <!-- LOWER GRID · PRICE & NEWS (Denser and Quieter) -->
      <div class="lower-sections-grid">

        <!-- PANEL C · PRICE -->
        <section
          id="panel-price"
          class="instrument-section price-panel-body ${state.priceState === 'loading' ? 'is-loading' : ''} ${state.chartFullscreen ? 'is-fullscreen' : ''}"
          ${state.chartFullscreen ? 'role="dialog" aria-modal="true" aria-label="Ninety-day close, full screen"' : ''}
        >
          <div>
            <div class="panel-header-bar">
              <h2 class="panel-heading">Ninety-day close${
                comp ? `<span class="panel-heading-ticker"> · ${esc(symbol)}</span>` : ''
              }</h2>
              ${
                state.priceData?.prices && state.priceData.prices.length > 1
                  ? `
                <div class="price-panel-controls">
                  <div class="chart-period-toggle" role="group" aria-label="Chart period">
                    ${[30, 90]
                      .map(
                        (days) => `
                      <button
                        type="button"
                        class="chart-period-btn ${state.chartPeriod === days ? 'is-active' : ''}"
                        data-period="${days}"
                        aria-pressed="${state.chartPeriod === days ? 'true' : 'false'}"
                      >${days}d</button>
                    `
                      )
                      .join('')}
                  </div>
                  <button
                    type="button"
                    id="chart-fullscreen-btn"
                    class="chart-expand-btn"
                    aria-pressed="${state.chartFullscreen ? 'true' : 'false'}"
                  >${state.chartFullscreen ? 'Exit full screen' : 'Expand'}</button>
                </div>
              `
                  : ''
              }
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

              // Loaded (or rate-limited serving stale cache).
              // The period toggle re-slices THIS array — the full series is
              // already here, so switching 30d/90d never refetches.
              const fullSeries = state.priceData?.prices || [];
              const prices = fullSeries.slice(-state.chartPeriod);
              if (prices.length > 0) {
                const latest = prices[prices.length - 1];
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

                  <!-- Readout for the hovered / focused point. Defaults to the
                       latest close so the row never shifts the layout. -->
                  <div id="chart-readout" class="chart-readout" aria-live="polite">
                    <span id="chart-readout-date" class="chart-readout-date">${esc(formatDate(latest.date))}</span>
                    <span id="chart-readout-close" class="chart-readout-close">$${latest.close.toFixed(2)}</span>
                  </div>

                  <!-- Inline SVG Chart -->
                  <div class="price-chart-wrap">
                    ${generatePriceChartSvg(prices, state.chartFullscreen ? FULLSCREEN_CHART : {})}
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
            <h2 class="panel-heading">Recent coverage${
              comp ? `<span class="panel-heading-ticker"> · ${esc(symbol)}</span>` : ''
            }</h2>
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

      <!-- SYNTHESIZE · computed from data already on screen -->
      ${renderSynthesisSection()}

      <!-- NEWSLETTER SIGNUP · posts straight to Web3Forms, not through /api -->
      ${renderSignupSection()}

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

// --- Price chart interaction (no charting library) ------------------------
//
// The crosshair is driven by direct DOM writes rather than a re-render, so
// hovering never rebuilds the page and never loses pointer focus.
let activeChartIndex = 0;

function readoutFor(point: PricePoint): void {
  const dateEl = document.getElementById('chart-readout-date');
  const closeEl = document.getElementById('chart-readout-close');
  if (dateEl) dateEl.textContent = formatDate(point.date);
  if (closeEl) closeEl.textContent = `$${point.close.toFixed(2)}`;
}

function updateCrosshair(index: number): void {
  const g = chartGeom;
  if (!g || g.points.length === 0) return;

  const i = Math.max(0, Math.min(g.points.length - 1, index));
  const point = g.points[i];
  const group = document.getElementById('chart-crosshair');
  const line = document.getElementById('chart-crosshair-line');
  const dot = document.getElementById('chart-crosshair-dot');
  if (!group || !line || !dot) return;

  const x = chartX(g, i);
  const y = chartY(g, point.close);
  line.setAttribute('x1', x.toFixed(1));
  line.setAttribute('x2', x.toFixed(1));
  dot.setAttribute('cx', x.toFixed(1));
  dot.setAttribute('cy', y.toFixed(1));
  group.setAttribute('visibility', 'visible');

  readoutFor(point);
  activeChartIndex = i;
}

function hideCrosshair(): void {
  const group = document.getElementById('chart-crosshair');
  if (group) group.setAttribute('visibility', 'hidden');

  const g = chartGeom;
  if (!g || g.points.length === 0) return;
  // Fall back to the latest close so the readout row keeps its height.
  activeChartIndex = g.points.length - 1;
  readoutFor(g.points[activeChartIndex]);
}

// preserveAspectRatio="none" means viewBox x maps linearly across the
// rendered width, so a plain proportional inversion is exact.
function indexFromClientX(svg: SVGSVGElement, clientX: number): number {
  const g = chartGeom;
  if (!g || g.points.length < 2) return 0;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0) return 0;
  const viewBoxX = ((clientX - rect.left) / rect.width) * g.width;
  const ratio = (viewBoxX - g.padLeft) / g.chartW;
  return Math.round(ratio * (g.points.length - 1));
}

function attachChartInteraction(): void {
  const svg = document.getElementById('price-chart') as unknown as SVGSVGElement | null;
  if (!svg || !chartGeom || chartGeom.points.length === 0) return;

  activeChartIndex = chartGeom.points.length - 1;

  svg.addEventListener('mousemove', (e) => {
    updateCrosshair(indexFromClientX(svg, (e as MouseEvent).clientX));
  });
  svg.addEventListener('mouseleave', hideCrosshair);
  svg.addEventListener('focus', () => updateCrosshair(activeChartIndex));
  svg.addEventListener('blur', hideCrosshair);
  svg.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    const count = chartGeom?.points.length ?? 0;
    if (count === 0) return;

    let next = activeChartIndex;
    if (ev.key === 'ArrowLeft') next = activeChartIndex - 1;
    else if (ev.key === 'ArrowRight') next = activeChartIndex + 1;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = count - 1;
    else return;

    ev.preventDefault();
    updateCrosshair(next);
  });
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

  // Chart period toggles. These re-slice data already in state.priceData —
  // they must never call fetchPrices(), because Alpha Vantage would reject the
  // extra request and the panel would drop to its rate-limited state.
  const periodBtns = document.querySelectorAll('.chart-period-btn');
  periodBtns.forEach((btn) => {
    (btn as HTMLElement).onclick = () => {
      const days = Number(btn.getAttribute('data-period'));
      if (days !== 30 && days !== 90) return;
      if (state.chartPeriod === days) return;
      state.chartPeriod = days;
      render();
    };
  });

  // Full-screen chart. Re-renders from state.priceData only — expanding never
  // refetches, for the same reason the period toggles do not.
  const fullscreenBtn = document.getElementById('chart-fullscreen-btn');
  if (fullscreenBtn) {
    fullscreenBtn.onclick = () => {
      state.chartFullscreen = !state.chartFullscreen;
      render();
      // Keep focus on the control across the re-render so the keyboard path
      // is not dropped at the top of the document.
      document.getElementById('chart-fullscreen-btn')?.focus();
    };
  }

  // Escape leaves full screen. Assigned rather than added so repeated renders
  // cannot stack duplicate listeners.
  document.onkeydown = (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && state.chartFullscreen) {
      state.chartFullscreen = false;
  state.signupState = 'idle';
  state.signupEmailError = null;
  state.signupTrackedTicker = null;
      render();
      document.getElementById('chart-fullscreen-btn')?.focus();
    }
  };

  // Stop the page behind the overlay from scrolling.
  if (document.body) {
    document.body.classList.toggle('has-fullscreen-chart', state.chartFullscreen);
  }

  // Newsletter signup. Field values are mirrored into state on input WITHOUT
  // re-rendering — render() rebuilds innerHTML, so typing would otherwise be
  // destroyed on any unrelated re-render, and re-rendering per keystroke would
  // fight the caret.
  const signupForm = document.getElementById('signup-form') as HTMLFormElement | null;
  const signupName = document.getElementById('signup-name') as HTMLInputElement | null;
  const signupEmail = document.getElementById('signup-email') as HTMLInputElement | null;

  if (signupName) {
    signupName.oninput = () => {
      state.signupName = signupName.value;
    };
  }

  if (signupEmail) {
    signupEmail.oninput = () => {
      state.signupEmail = signupEmail.value;
    };
  }

  if (signupForm) {
    signupForm.onsubmit = (e) => {
      e.preventDefault();
      // Read straight off the inputs so a submit never posts a stale value.
      if (signupName) state.signupName = signupName.value;
      if (signupEmail) state.signupEmail = signupEmail.value;
      // A retry should start from a clean status rather than showing the
      // previous failure underneath "Sending…".
      if (state.signupState === 'rejected' || state.signupState === 'unreachable') {
        state.signupState = 'idle';
      }
      submitSignup();
    };
  }

  // Synthesize toggle
  const synthBtn = document.getElementById('synthesize-btn');
  if (synthBtn) {
    synthBtn.onclick = () => {
      expansionState.synthesis = !expansionState.synthesis;
      render();
    };
  }

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

  attachChartInteraction();
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
  expansionState.synthesis = false;
  state.chartPeriod = 90;
  state.chartFullscreen = false;

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
