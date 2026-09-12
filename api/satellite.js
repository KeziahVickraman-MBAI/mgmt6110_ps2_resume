// Web Mercator tile calculation helper
function toTile(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y, z };
}

export default async function handler(req, res) {
  // 1. Check if this is a request for a proxied Esri tile: /api/satellite?z=16&y=...&x=...
  const { z, y, x, raw } = req.query || {};

  if (z !== undefined && y !== undefined && x !== undefined) {
    const zoom = parseInt(z, 10);
    const tileY = parseInt(y, 10);
    const tileX = parseInt(x, 10);

    if (isNaN(zoom) || isNaN(tileY) || isNaN(tileX)) {
      return res.status(400).json({
        error: 'invalid_params',
        message: "Parameters 'z', 'y', and 'x' must be integers."
      });
    }

    // ArcGIS REST World Imagery endpoint: /{z}/{y}/{x} (Note: y then x)
    const esriTileUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}/${tileX}`;

    try {
      const tileRes = await fetch(esriTileUrl, {
        signal: AbortSignal.timeout(6000)
      });

      if (!tileRes.ok) {
        return res.status(tileRes.status === 404 ? 404 : 502).json({
          error: 'tile_unavailable',
          message: `Esri tile unavailable (HTTP ${tileRes.status})`
        });
      }

      const imageArrayBuffer = await tileRes.arrayBuffer();
      const imageBuffer = Buffer.from(imageArrayBuffer);

      res.setHeader('Content-Type', tileRes.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=86400');
      return res.status(200).send(imageBuffer);
    } catch (tileErr) {
      return res.status(504).json({
        error: 'unreachable',
        message: "Can't reach Esri tile service."
      });
    }
  }

  // 2. Check if this is a request for raw Landsat imagery
  const { lat, lon, date } = req.query || {};

  if (raw === 'landsat') {
    const apiKey = process.env.NASA_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'missing_credential',
        message: 'NASA_API_KEY is not configured.'
      });
    }
    const rawLat = parseFloat(lat);
    const rawLon = parseFloat(lon);
    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLon)) {
      return res.status(400).json({
        error: 'invalid_params',
        message: "Parameters 'lat' and 'lon' must be valid numbers."
      });
    }
    const captureDate = (date || '2024-06-01').trim();
    const imageryUrl = `https://api.nasa.gov/planetary/earth/imagery?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}&date=${encodeURIComponent(captureDate)}&dim=0.15&api_key=${encodeURIComponent(apiKey)}`;
    try {
      const imageryRes = await fetch(imageryUrl, { signal: AbortSignal.timeout(8000) });
      if (!imageryRes.ok) {
        return res.status(imageryRes.status).json({ error: 'unreachable' });
      }
      const buffer = Buffer.from(await imageryRes.arrayBuffer());
      res.setHeader('Content-Type', imageryRes.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=86400');
      return res.status(200).send(buffer);
    } catch {
      return res.status(504).json({ error: 'unreachable' });
    }
  }

  // 3. Main Satellite Request: Lat & Lon coordinates required
  if (!lat || !lon) {
    return res.status(400).json({
      error: 'invalid_params',
      message: "Parameters 'lat' and 'lon' are required."
    });
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);
  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({
      error: 'invalid_params',
      message: "Parameters 'lat' and 'lon' must be valid numbers."
    });
  }

  const searchDate = (date || '2024-06-01').trim();
  const apiKey = process.env.NASA_API_KEY;

  // --- TIER 1: Try NASA Landsat as now ---
  let landsatSuccess = false;
  let landsatData = null;

  if (apiKey && apiKey.trim().length > 0) {
    try {
      const assetsUrl = `https://api.nasa.gov/planetary/earth/assets?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}&date=${encodeURIComponent(searchDate)}&dim=0.15&api_key=${encodeURIComponent(apiKey)}`;
      const assetsResponse = await fetch(assetsUrl, { signal: AbortSignal.timeout(2500) });
      if (assetsResponse.ok) {
        const assetData = await assetsResponse.json();

        // The capture date must come from the asset itself. It is NOT safe to
        // fall back to searchDate: that is the date we *asked* for, and showing
        // it as "Captured:" would put a fabricated date under the image. If
        // NASA answers without a usable date we cannot caption Landsat
        // honestly, so we treat Tier 1 as failed and fall through to Esri,
        // whose caption is explicit that no per-tile date is published.
        const rawDate = typeof assetData?.date === 'string' ? assetData.date.split('T')[0] : '';
        const captureDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

        if (captureDate) {
          landsatSuccess = true;
          landsatData = {
            source: 'landsat',
            captureDate,
            url: `/api/satellite?raw=landsat&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&date=${encodeURIComponent(captureDate)}`
          };
        }
      }
    } catch {
      // NASA timed out or failed; silently proceed to Tier 2
      landsatSuccess = false;
    }
  }

  if (landsatSuccess && landsatData) {
    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=86400');
    return res.status(200).json(landsatData);
  }

  // --- TIER 2: On failure, fetch Esri World Imagery tiles ---
  try {
    const center = toTile(latitude, longitude, 16);

    // Verify Esri tile service answers (check center tile)
    const testUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/${center.y}/${center.x}`;
    const testRes = await fetch(testUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000)
    });

    if (!testRes.ok) {
      // Tier 3: Esri also failed -> fall through to unreachable state
      return res.status(502).json({
        error: 'unreachable',
        message: "Can't reach satellite imagery service."
      });
    }

    // Build 3x3 block centred on facility tile at zoom 16
    // Top-left to bottom-right: y-1 to y+1, x-1 to x+1
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tileX = center.x + dx;
        const tileY = center.y + dy;
        tiles.push(`/api/satellite?z=16&y=${tileY}&x=${tileX}`);
      }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=86400');
    return res.status(200).json({
      source: 'esri',
      fallback: true,
      fallbackReason: 'Landsat unavailable — showing basemap imagery.',
      tiles
    });
  } catch (esriErr) {
    // --- TIER 3: If Esri also fails, fall through to unreachable state ---
    return res.status(504).json({
      error: 'unreachable',
      message: "Can't reach satellite imagery service."
    });
  }
}

