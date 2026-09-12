// Health reports whether each provider's credential is configured, and probes
// the two providers that can be probed for free.
//
// Alpha Vantage is deliberately NOT probed. Its free tier allows 25 requests a
// day, so a probe here would spend one of them on every page load just to draw
// a status dot — and it would race the /api/prices call the client fires at
// the same moment, which is exactly the concurrent pair Alpha Vantage must
// never see. The client derives the price chip from the outcome of the price
// request it already makes (see getPriceChipState in src/main.ts), which is
// both free and more accurate than a probe of an unrelated symbol.
export default async function handler(req, res) {
  const nasaKey = process.env.NASA_API_KEY;
  const guardianKey = process.env.GUARDIAN_API_KEY;
  const avKey = process.env.ALPHAVANTAGE_API_KEY;

  const result = {
    satellite: {
      provider: 'NASA Landsat',
      keyConfigured: Boolean(nasaKey && nasaKey.trim().length > 0),
      answered: false,
      status: null,
      state: 'down' // 'up' | 'degraded' | 'down'
    },
    news: {
      provider: 'The Guardian',
      keyConfigured: Boolean(guardianKey && guardianKey.trim().length > 0),
      answered: false,
      status: null,
      state: 'down'
    },
    price: {
      provider: 'Alpha Vantage',
      keyConfigured: Boolean(avKey && avKey.trim().length > 0),
      answered: false,
      status: null,
      // 'unknown' until the client's own price request resolves. Not probed
      // here; see the note above the handler.
      state: 'unknown'
    }
  };

  // Check NASA status (specifically the Earth planetary endpoint)
  if (result.satellite.keyConfigured) {
    try {
      // Testing NASA Earth assets endpoint with short timeout to catch current upstream outage
      const nasaRes = await fetch(
        `https://api.nasa.gov/planetary/earth/assets?lon=-94.218&lat=36.366&date=2024-06-01&dim=0.15&api_key=${encodeURIComponent(nasaKey)}`,
        { signal: AbortSignal.timeout(2500) }
      );
      result.satellite.status = nasaRes.status;
      result.satellite.answered = true;
      if (nasaRes.ok) {
        result.satellite.state = 'up';
      } else if (nasaRes.status === 401 || nasaRes.status === 403) {
        result.satellite.state = 'down';
      } else {
        result.satellite.state = 'degraded';
      }
    } catch (err) {
      result.satellite.answered = false;
      result.satellite.status = 504;
      result.satellite.state = 'down';
    }
  }

  // If NASA is down or degraded, check Tier 2 fallback: Esri World Imagery
  if (result.satellite.state !== 'up') {
    try {
      const esriRes = await fetch(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/25652/15616',
        { method: 'HEAD', signal: AbortSignal.timeout(3000) }
      );
      if (esriRes.ok) {
        result.satellite.provider = 'Esri World Imagery';
        result.satellite.keyConfigured = true;
        result.satellite.answered = true;
        result.satellite.status = 200;
        result.satellite.state = 'up';
      }
    } catch {
      // Fallback also failed
    }
  }

  // Check Guardian status
  if (result.news.keyConfigured) {
    try {
      const gRes = await fetch(
        `https://content.guardianapis.com/search?page-size=1&api-key=${encodeURIComponent(guardianKey)}`,
        { signal: AbortSignal.timeout(4000) }
      );
      result.news.status = gRes.status;
      result.news.answered = true;
      if (gRes.ok) {
        result.news.state = 'up';
      } else if (gRes.status === 401 || gRes.status === 403) {
        result.news.state = 'down';
      } else {
        result.news.state = 'degraded';
      }
    } catch (err) {
      result.news.answered = false;
      result.news.status = 504;
      result.news.state = 'down';
    }
  }

  // A missing credential is knowable without spending a request.
  if (!result.price.keyConfigured) {
    result.price.state = 'down';
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(result);
}
