// Canonical FACILITIES table — the single source of truth.
//
// Imported by api/company.js (Vercel Node runtime) and by src/facilities.ts
// (Vite client bundle), so it is plain ESM JavaScript with no type syntax.
// It previously existed as two hand-maintained copies that could drift; the
// figures below are hand-entered and are never derived from imagery pixels.
//
/*
Shape for extending FACILITIES:
  SYMBOL: {
    symbol: string,           // Ticker symbol
    name: string,             // Company name
    lat: number,              // Latitude (decimal degrees)
    lon: number,              // Longitude (decimal degrees)
    label: string,            // Facility name and location
    siteType?: string,        // "Corporate HQ" | "Manufacturing" | "Distribution" | "Retail flagship" | "Mixed campus"
    footprintHa?: number,     // Approximate site area in hectares
    scaleNote?: string,       // Short context line (e.g. "~12,000 staff" or "~5,000 vehicles/week at capacity")
    measuredOn?: string       // ISO date (YYYY-MM-DD) the figures were entered by hand
  }
When a field is missing, the row is omitted rather than showing "N/A" or a zero.
*/
export const FACILITIES = {
  WMT: {
    symbol: 'WMT',
    name: 'Walmart Inc',
    lat: 36.3667,
    lon: -94.2180,
    label: 'Walmart Home Office & Global HQ, Bentonville, AR',
    siteType: 'Corporate HQ',
    footprintHa: 140,
    scaleNote: '~15,000 staff across corporate campus',
    measuredOn: '2026-03-15'
  },
  AAPL: {
    symbol: 'AAPL',
    name: 'Apple Inc',
    lat: 37.3349,
    lon: -122.0090,
    label: 'Apple Park Campus, Cupertino, CA',
    siteType: 'Corporate HQ',
    footprintHa: 71,
    scaleNote: '~12,000 staff in main ring building',
    measuredOn: '2026-02-10'
  },
  TSLA: {
    symbol: 'TSLA',
    name: 'Tesla Inc',
    lat: 30.2223,
    lon: -97.6171,
    label: 'Tesla Gigafactory Texas, Austin, TX',
    siteType: 'Manufacturing',
    footprintHa: 398,
    scaleNote: '~5,000 vehicles/week at capacity',
    measuredOn: '2026-01-20'
  },
  NVDA: {
    symbol: 'NVDA',
    name: 'NVIDIA Corp',
    lat: 37.3708,
    lon: -121.9634,
    label: 'NVIDIA Voyager & Endeavor Headquarters, Santa Clara, CA',
    siteType: 'Corporate HQ',
    footprintHa: 22,
    scaleNote: '~5,000 engineering and operations staff',
    measuredOn: '2026-04-05'
  },
  BA: {
    symbol: 'BA',
    name: 'Boeing Co',
    lat: 47.9252,
    lon: -122.2715,
    label: 'Boeing Everett Production Facility, Everett, WA',
    siteType: 'Manufacturing',
    footprintHa: 415,
    scaleNote: '~30,000 aerospace assembly workers',
    measuredOn: '2026-02-18'
  },
  CAT: {
    symbol: 'CAT',
    name: 'Caterpillar Inc',
    lat: 40.8172,
    lon: -89.5786,
    label: 'Caterpillar Global Engine Facility, Mossville, IL',
    siteType: 'Manufacturing',
    footprintHa: 180,
    scaleNote: '~3,500 engine design and assembly personnel',
    measuredOn: '2026-03-22'
  },
  AMZN: {
    symbol: 'AMZN',
    name: 'Amazon.com Inc',
    lat: 47.6155,
    lon: -122.3398,
    label: 'Amazon Corporate Headquarters & Spheres, Seattle, WA'
  },
  MSFT: {
    symbol: 'MSFT',
    name: 'Microsoft Corp',
    lat: 47.6423,
    lon: -122.1368,
    label: 'Microsoft Redmond Main Campus, Redmond, WA'
  },
  GOOGL: {
    symbol: 'GOOGL',
    name: 'Alphabet Inc (Class A)',
    lat: 37.4220,
    lon: -122.0841,
    label: 'Googleplex World Headquarters, Mountain View, CA'
  },
  GOOG: {
    symbol: 'GOOG',
    name: 'Alphabet Inc (Class C)',
    lat: 37.4220,
    lon: -122.0841,
    label: 'Googleplex World Headquarters, Mountain View, CA'
  },
  META: {
    symbol: 'META',
    name: 'Meta Platforms Inc',
    lat: 37.4848,
    lon: -122.1484,
    label: 'Meta Menlo Park Headquarters (1 Hacker Way), Menlo Park, CA'
  },
  INTC: {
    symbol: 'INTC',
    name: 'Intel Corp',
    lat: 45.5428,
    lon: -122.9238,
    label: 'Intel Ronler Acres Campus, Hillsboro, OR'
  },
  F: {
    symbol: 'F',
    name: 'Ford Motor Co',
    lat: 42.3045,
    lon: -83.1558,
    label: 'Ford River Rouge Complex, Dearborn, MI'
  },
  GM: {
    symbol: 'GM',
    name: 'General Motors Co',
    lat: 42.3831,
    lon: -83.0450,
    label: 'GM Factory ZERO EV Assembly Center, Detroit, MI'
  },
  XOM: {
    symbol: 'XOM',
    name: 'Exxon Mobil Corp',
    lat: 30.0886,
    lon: -95.4265,
    label: 'ExxonMobil Houston Campus, Spring, TX'
  },
  CVX: {
    symbol: 'CVX',
    name: 'Chevron Corp',
    lat: 37.7699,
    lon: -121.9568,
    label: 'Chevron San Ramon Headquarters, San Ramon, CA'
  },
  DIS: {
    symbol: 'DIS',
    name: 'Walt Disney Co',
    lat: 34.1565,
    lon: -118.3251,
    label: 'Walt Disney Studios, Burbank, CA'
  },
  NKE: {
    symbol: 'NKE',
    name: 'Nike Inc',
    lat: 45.5085,
    lon: -122.8276,
    label: 'Nike World Headquarters, Beaverton, OR'
  },
  NFLX: {
    symbol: 'NFLX',
    name: 'Netflix Inc',
    lat: 37.2431,
    lon: -121.9689,
    label: 'Netflix Corporate Headquarters, Los Gatos, CA'
  },
  AMD: {
    symbol: 'AMD',
    name: 'Advanced Micro Devices Inc',
    lat: 37.3789,
    lon: -121.9678,
    label: 'AMD Corporate Headquarters, Santa Clara, CA'
  },
  JNJ: {
    symbol: 'JNJ',
    name: 'Johnson & Johnson',
    lat: 40.4988,
    lon: -74.4449,
    label: 'Johnson & Johnson One J&J Plaza, New Brunswick, NJ'
  },
  PFE: {
    symbol: 'PFE',
    name: 'Pfizer Inc',
    lat: 40.7516,
    lon: -73.9723,
    label: 'Pfizer World Headquarters, New York, NY'
  },
  JPM: {
    symbol: 'JPM',
    name: 'JPMorgan Chase & Co',
    lat: 40.7558,
    lon: -73.9754,
    label: 'JPMorgan Chase Global HQ (270 Park Ave), New York, NY'
  },
  KO: {
    symbol: 'KO',
    name: 'Coca-Cola Co',
    lat: 33.7712,
    lon: -84.3969,
    label: 'Coca-Cola Global Headquarters, Atlanta, GA'
  }
};
