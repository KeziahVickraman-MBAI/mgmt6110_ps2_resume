// FACILITIES now lives in shared/facilities.js — one canonical copy, imported
// by both this handler and the client bundle (src/facilities.ts). The figures
// are hand-entered there and are never derived from imagery.
import { FACILITIES } from '../shared/facilities.js';
import { scheduleAvCall } from './_av.js';

// Re-exported so existing importers of this module keep working.
export { FACILITIES, scheduleAvCall };

// 7-day memory cache for symbol search
const searchCache = new Map();
const SEARCH_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  const q = (req.query?.q || '').trim();

  if (!q) {
    return res.status(400).json({
      error: 'invalid_query',
      message: "Query parameter 'q' is required."
    });
  }

  // Guard BEFORE fetch: check if ALPHAVANTAGE_API_KEY is configured
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(503).json({
      error: 'missing_credential',
      message: 'ALPHAVANTAGE_API_KEY is not configured.'
    });
  }

  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
    res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=604800');
    return res.status(200).json(cached.data);
  }

  const fetchSearch = async () => {
    const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(q)}&apikey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      return { status: response.status, ok: false };
    }
    const data = await response.json();
    return { ok: true, data };
  };

  try {
    let result = await scheduleAvCall(fetchSearch);

    // Alpha Vantage throttling detection: 200 OK carrying "Information" or "Note"
    if (result.ok && (result.data?.Information || result.data?.Note)) {
      // On throttle, wait 1200ms and retry ONCE
      await new Promise((r) => setTimeout(r, 1200));
      result = await scheduleAvCall(fetchSearch);
    }

    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        return res.status(result.status).json({
          error: 'refused',
          message: "We can't reach the company lookup right now."
        });
      }
      return res.status(502).json({
        error: 'unreachable',
        message: "We can't reach the company lookup right now."
      });
    }

    const payload = result.data;
    if (payload?.Information || payload?.Note) {
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Company lookup is rate-limited. Try again in a moment.'
      });
    }

    if (payload?.['Error Message']) {
      return res.status(401).json({
        error: 'refused',
        message: "We can't reach the company lookup right now."
      });
    }

    const rawMatches = payload?.bestMatches || [];
    const topMatches = rawMatches.slice(0, 5).map((item) => {
      const symbol = item['1. symbol'];
      const name = item['2. name'];
      const region = item['4. region'];
      const facility = FACILITIES[symbol] || null;

      return {
        symbol,
        name,
        region,
        facility: facility
          ? {
              lat: facility.lat,
              lon: facility.lon,
              label: facility.label,
              ...(facility.siteType ? { siteType: facility.siteType } : {}),
              ...(facility.footprintHa != null ? { footprintHa: facility.footprintHa } : {}),
              ...(facility.scaleNote ? { scaleNote: facility.scaleNote } : {}),
              ...(facility.measuredOn ? { measuredOn: facility.measuredOn } : {})
            }
          : null
      };
    });

    searchCache.set(cacheKey, {
      data: topMatches,
      timestamp: Date.now()
    });

    res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=604800');
    return res.status(200).json(topMatches);
  } catch (err) {
    return res.status(502).json({
      error: 'unreachable',
      message: "We can't reach the company lookup right now."
    });
  }
}
