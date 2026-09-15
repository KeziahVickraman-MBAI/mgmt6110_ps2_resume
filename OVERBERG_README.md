# Overberg — first-pass company research

**Student:** Keziah Sherlyn Vanessa Vickraman · **Course:** MGMT 6110 · **Problem Set 2**

**Live link:** https://mgmt6110problemset02finance.vercel.app/

---

Bloomberg is *bloom* and *berg*. This is *over* and *berg* — the view from above, which is the one panel nobody else's dashboard has.

## Who it's for

Someone doing first-pass research on a company before a meeting: an analyst, a student, a journalist. One person, thirty minutes, four browser tabs.

The decision is narrow and binary — **is this company worth an hour of deeper reading?** Everything on the screen serves that and nothing else.

Because the user is deciding whether to go deeper, news sorts newest-first and the price panel leads with the ninety-day trend rather than today's number. Neither is a styling choice; both fall out of the question being asked.

## What it does

A company name goes in. Three panels come back, each from a different provider, each failing independently:

- **Satellite** — the main facility from orbit, with its site type and footprint
- **Price** — ninety days of closes, with the period change
- **Coverage** — the five most recent Guardian pieces

Above them, one line synthesising what is already on screen. Below them, a **Synthesize** control that computes what the fetched data supports: where today's close sits in the ninety-day range, maximum drawdown with its peak and trough dates, realised volatility, up days against down days, coverage concentration by section.

Every figure traces to a value already fetched. No model call, no inference, no recommendation.

**Out of scope:** Overberg does not predict, advise, or rank. It replaces four tabs with one screen and stops there. Not financial advice, and I am not a financial adviser.

## The four panels

1. **Search** — type a name or ticker, pick from up to five matches across exchanges
2. **Satellite** — Landsat where available, Esri basemap where not, with the caption changing to match whichever is live
3. **Price** — ninety-day close as inline SVG, crosshair on hover, 30d/90d toggles that re-slice data already fetched
4. **Coverage** — headline, date, section, a 200-character excerpt truncated server-side, and a link out

## What I would not do

Three of the four sources prohibit ad-supported use — the Guardian developer key is non-commercial, Alpha Vantage's free tier is evaluation-only, and Esri's basemap terms do not cover it. Rather than write that in a document nobody opens, there is an empty dashed rectangle on the page with the reason underneath. It is inert: no script, no tag, no external request.

The satellite panel says what it is and is not: basemap imagery is an undated mosaic, so it shows site scale and type, never activity. Measuring change would need dated repeat imagery from a commercial provider. That sentence is on the screen, not only in the write-up.

## What broke, and what it taught me

**NASA's Earth imagery endpoints were unreachable for the entire build.** APOD returned 200 on the same key from the same network; `earth/assets` and `earth/imagery` timed out at the proxy, verified over IPv4 from two networks. Rather than fake the panel or wait, I built a fallback chain — Landsat first, Esri second, unreachable third — and left the NASA path in so it recovers with no code change. A genuinely unreachable provider turned out to be a better demonstration of that state than a simulated one.

**Alpha Vantage returns HTTP 200 with an `"Information"` key instead of data when throttled.** `response.ok` is true, nothing throws, and the chart renders empty. Thirty consecutive calls showed roughly two throttled replies for every success — the per-second limiter, not the documented daily cap. The handler now sequences its calls, checks for that key before looking for data, retries once, and serves stale cache rather than nothing.

**A prompt I sent removed the price from the page.** I asked for a hero image with the ninety-day change overlaid on it. The tool built the stylesheet and not the container, dutifully moved the price out of the panel it lived in, and the figure vanished. Both halves of the instruction were executed; only one had somewhere to land. CSS fails silently on selectors that match nothing, so nothing anywhere reported a problem.

## In this repo

| File | What it holds |
|---|---|
| [`PROMPTS.md`](PROMPTS.md) | Every prompt, what came back, and what I changed next |
| [`ASSESSMENT.md`](ASSESSMENT.md) | My criteria, marked honestly, including the ones I do not meet |
| `api/` | Five serverless functions — `company`, `satellite`, `news`, `prices`, `health` |
| `evidence/` | Hand-captured responses, including the NASA outage log |

Credentials live only in Vercel environment variables, are read only inside `api/`, and never reach browser code. `/api/health` reports whether each is configured without revealing any value.

Built in Google AI Studio, finished in Claude Code, deployed on Vercel. Guardian content is used under a non-commercial developer key registered as summary-only; imagery is Esri World Imagery and NASA Landsat; market data is Alpha Vantage. All attributions are on the page.
