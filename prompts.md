# prompts.md — Overberg

**Student:** Keziah Sherlyn Vanessa Vickraman · **Course:** MGMT 6110 · **Problem Set 2**

**User sentence:** An *analyst* with thirty minutes before a call opens this screen to decide whether this company is *worth an hour of deeper reading*, and knows it worked when they've either closed the tab or opened the Guardian article.

**Live link (built in Google AI Studio):** https://mgmt6110problemset02finance.vercel.app/
**Repository:** https://github.com/KeziahVickraman-MBAI/mgmt6110_problemset_02_finance

**Live link (build resumed in Claude Code):** https://mgmt6110ps2resume.vercel.app/
**Repository:** https://github.com/KeziahVickraman-MBAI/mgmt6110_ps2_resume

There are two of each because the build stopped in one tool and continued in another. Entry 7 is where that happened and why. The second repository is a clone of the first at commit `6f2ae59`; nothing was discarded.

---

## 1. The master prompt

> ```
> ROLE: You are a senior full-stack developer working in a static site deployed to Vercel
> from GitHub. No build step, no framework — vanilla HTML/CSS/JS plus serverless functions
> in api/.
>
> GOAL: Build a company research dashboard.
>  THE USER: someone doing first-pass research on a company before a meeting — an analyst,
>  a student, a journalist. Right now they open four browser tabs to do this.
>  THE DECISION: whether this company is worth an hour of deeper reading.
>  THE CLAIM: the screen tells the user what a company's share price has done over ninety
>  days, what has been written about it recently, and what its main facility looks like
>  from orbit. Right now that comes from four tabs and a person's memory; to be true it has
>  to come from Alpha Vantage, the Guardian and NASA Landsat.
>
>  Because the user is deciding whether to go deeper, news sorts newest-first and the price
>  panel leads with the ninety-day trend rather than today's number.
>
>  FIVE FUNCTIONS:
>  1) api/company.js — ?q=, calls Alpha Vantage SYMBOL_SEARCH, returns top five matches with
>     symbol, name, region. Looks up coordinates from a hardcoded FACILITIES table
>     (symbol -> {lat, lon, label}) that I will extend by hand. Returns null coordinates when
>     the symbol is not in the table.
>  2) api/satellite.js — ?lat=&lon=&date=, calls api.nasa.gov/planetary/earth/assets to find
>     the nearest available capture date, then /planetary/earth/imagery for the tile. Returns
>     the PNG as a passthrough, not JSON. Put the actual capture date in a response header.
>  3) api/news.js — ?q=, calls content.guardianapis.com/search?show-fields=body&order-by=newest.
>     Returns five results: headline, date, section, webUrl, and an excerpt TRUNCATED TO 200
>     CHARACTERS SERVER-SIDE. Do not return the full body and hide the overflow in CSS — our
>     Guardian licence is registered as "summary only", so the full text must never reach the
>     browser.
>  4) api/prices.js — ?symbol=, calls Alpha Vantage TIME_SERIES_DAILY (compact), returns the
>     last ninety closes as {date, close} with close cast to Number.
>  5) api/health.js — reports keyConfigured separately for NASA_API_KEY, GUARDIAN_API_KEY and
>     ALPHAVANTAGE_API_KEY, plus whether each provider answered and its upstream status.
>     Never prints any key or any part of one.
>
> OUTPUT — THE FOUR PANELS, each with its own independent states and its own sentences. Do
> not collapse them into one shared error banner.
>
>  PANEL 0 · SEARCH — one input, placeholder "Company name or ticker". On submit, up to five
>  matches as a pick list (symbol, name, region). The pick drives everything below.
>    loading:      "Looking up companies…"
>    empty:        "No companies match that name. Try the ticker instead."
>    rate-limited: "Company lookup is rate-limited. Try again in a moment."
>    refused:      "We can't reach the company lookup right now."
>
>  PANEL A · COMPANY HEADER — name, ticker, exchange, mapped facility label, and three
>  provider status chips (satellite / news / price) showing up, degraded or down.
>
>  PANEL B · SATELLITE — one Landsat tile, capture date beneath it, fixed caption. FIVE
>  states, because two of them are empty in different ways:
>    loading:     "Fetching imagery…"
>    no facility: "We don't have a mapped facility for this company. Add one to FACILITIES
>                  to see imagery."
>    no capture:  "No cloud-free capture near that date. Nearest available: [date]."
>    refused:     "NASA rejected our credential. No imagery on this screen is current."
>    unreachable: "Can't reach NASA's imagery service."
>  Caption, always visible: "Landsat 8, roughly 30m per pixel, 16-day revisit. Shows site
>  context and long-run change. It cannot resolve vehicles and is not a demand or revenue
>  signal."
>
>  PANEL C · PRICE — ninety-day close as inline SVG (no charting library), with last close
>  and period change above it.
>    loading:      "Loading ninety days of closes…"
>    empty:        "No price history for this symbol. It may be delisted or not covered."
>    rate-limited: "Price data is rate-limited right now. Showing the last figures we have,
>                   from [time]."
>    refused:      "The price provider rejected our credential."
>    unreachable:  "Can't reach the price provider."
>
>  PANEL D · NEWS — five most recent, newest first: headline, date, section, excerpt, link
>  out to webUrl.
>    loading:     "Searching recent coverage…"
>    empty:       "No Guardian coverage of this company in the archive. That's not unusual
>                  for smaller listings."
>    refused:     "The Guardian rejected our credential."
>    unreachable: "Can't reach the Guardian."
>
>  LAYOUT: single column, max-width 1100px, centred. Search pinned top, then the header
>  strip, then a two-thirds / one-third split with satellite left and price right, then news
>  full width beneath as five rows rather than cards. Collapse to one column under 820px.
>  Reserve each panel's height so a loading-to-loaded transition does not shift everything
>  below it.
>
>  FILES: the five handlers at project root in api/, siblings of package.json, never inside
>  src/. package.json needs "type":"module" or name the files .mjs.
>
>  FOOTER: "Powered by the Guardian" with a link to theguardian.com; NASA imagery credit;
>  Alpha Vantage credit per their terms; and one line stating this is a research aid, not
>  financial advice.
>
> GUARDRAILS:
>  - All three keys read via process.env inside api/ only. Never in browser code, never in a
>    file, comment or README, never a variable name starting with VITE_, never printed in a
>    response or log.
>  - Guard BEFORE each fetch: if the relevant variable is missing or empty, return 503 with a
>    named error and do not call the provider. An unset variable is sent as the string
>    "undefined" and providers answer 401 exactly as for a wrong key.
>  - ALPHA VANTAGE IS RATE-LIMITED AT ROUGHLY ONE REQUEST PER SECOND on the free tier, and
>    returns 200 OK with an "Information" key instead of data when throttled — a success code
>    carrying a failure. NEVER fire two Alpha Vantage calls concurrently; sequence them. After
>    parsing any Alpha Vantage response, check for "Information" or "Note" BEFORE looking for
>    data. On throttle, wait 1200ms and retry ONCE; if the retry also throttles, surface the
>    rate-limited state. Serve stale cache rather than nothing.
>  - Cache prices 24h (s-maxage=86400), SYMBOL_SEARCH 7 days, news 15 minutes, satellite 24h.
>  - Guardian free key is non-commercial, 500 calls/day, registered as summary-only.
>  - NASA imagery returns image bytes, not JSON — passthrough with the right content-type. Do
>    not build on DEMO_KEY; it is metered by network address.
>  - Check response.ok BEFORE reading any body. Cast every price with Number() at the
>    boundary. Never emit NaN or null into the chart.
>  - No new npm packages. No database, no login.
>
> CONTEXT: Deployed on Vercel from GitHub. Keys live only in Vercel environment variables
> named NASA_API_KEY, GUARDIAN_API_KEY, ALPHAVANTAGE_API_KEY.
>
> [Followed by the five real provider responses I had called by hand — SYMBOL_SEARCH with
> its numbered field-name prefixes and string matchScore, TIME_SERIES_DAILY with dates as
> object keys, the rate-limited "Information" body arriving as 200 OK, the Guardian envelope
> nested under "response", and the NASA timings from 12 Sep 2026.]
> ```

Came back with: a running app, 14 files, preview loading, and the three keys prompted as empty strings. All five functions were where I asked for them, at project root in `api/`. The rate-limit check, the 200-char server-side truncation and the before-fetch credential guard were all present in the code I read.
Action: kept it whole. Pushed, added the three environment variables in Vercel, and ran `/api/health`. Commit `cdd2339`.
What I would not know until entry 8: `api/prices.js` and `api/company.js` were firing concurrently, which is the one thing the GUARDRAILS block above forbids twice. It read as compliant because every individual function contained the throttle check. Nothing on the screen showed it.

---

## 2. Calling the five endpoints by hand before trusting any of them

Not a prompt. Before writing anything I called each provider myself, and three of the four things I found went straight into the prompt above as guardrails.

- **Alpha Vantage, 30 consecutive calls:** roughly two throttled replies for every one success, alternating all the way to call 30. Every throttled reply arrived as **HTTP 200 OK with an `Information` key and no `Time Series (Daily)` key at all**. `response.ok` is true. Nothing throws. The daily cap was never reached, because throttled calls appear not to count against it.
- **Guardian, `q=walmart`:** the results were consumer product reviews that merely contain walmart.com shopping links in the body. Not coverage of the company. `fields.body` is full HTML, so truncating it without stripping tags produces a 200-character fragment of a `<p>`.
- **NASA, 12 Sep 2026:** `/planetary/apod` answered 200 OK in 0.81s. `/planetary/earth/assets` timed out. `/planetary/earth/imagery` returned status 000 after 20s. Same key, same session. I re-ran it all with `curl -4` in case it was an IPv6 routing fault, then from a second network. Same result both times.

Action: pasted the real response bodies into the master prompt rather than describing them.
Lesson: this is the step the problem set told me not to skip, and it is the only reason entry 3 exists instead of a broken panel.

---

## 3. The satellite fallback chain

> ```
> GOAL: Replace the satellite panel's data source. NASA's Earth imagery endpoints
> (api.nasa.gov/planetary/earth/assets and /imagery) are unreachable — verified over IPv4
> from two networks while NASA's other services return 200. Build a fallback chain rather
> than a substitution. Rewrite api/satellite.js as a three-tier chain:
>   - Try NASA Landsat as now. If it answers, use it and label the panel LANDSAT. On failure,
>     fetch Esri World Imagery tiles and label the panel ESRI WORLD IMAGERY.
>   - If Esri also fails, fall through to the existing unreachable state.
>   ESRI TILES — verified working 12 Sep 2026:
>   https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
>   Returns image/jpeg, roughly 15KB per tile, Cache-Control max-age=86400.
>
> NOTE THE ORDER: it is /{z}/{y}/{x}, NOT the /{z}/{x}/{y} used by most XYZ servers. Getting
> this backwards returns a valid tile of the wrong place, silently.
>
> Compute tile coordinates from lat/lon with standard Web Mercator:
> function toTile(lat, lon, z) {
>   const n = 2 ** z;
>   const x = Math.floor((lon + 180) / 360 * n);
>   const latRad = lat * Math.PI / 180;
>   const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
>   return { x, y, z };
> }
>
> Fetch a 3x3 block centred on the facility tile at zoom 16, and lay it out as a CSS grid of
> nine 256px tiles filling the existing panel. Do not stitch server-side — return the nine
> URLs proxied through /api so the caching and one shape of code still hold. Return a
> "source" field ("landsat" | "esri") so the UI can label and caption correctly.
>
> CAPTION — MUST CHANGE WITH THE SOURCE. The current Landsat caption becomes FALSE for Esri
> and must not persist:
>   landsat: "Landsat 8, roughly 30m per pixel, 16-day revisit. Shows site context and
>             long-run change. It cannot resolve vehicles and is not a demand or revenue
>             signal."
>   esri:    "Esri World Imagery basemap. Capture date varies by location and is not
>             published per tile — this shows what the site looks like, but not when. Not a
>             demand or revenue signal."
> The "no capture date" state disappears under Esri, because there is no per-tile date to
> report. Do not invent one, and do not show today's date as though it were a capture date.
>
> Panel header shows which source is live, and a small line stating the fallback happened:
> "Landsat unavailable — showing basemap imagery."
> FOOTER: add Esri attribution per their terms alongside the existing credits.
>
> GUARDRAILS: no key needed for Esri, but still route through /api for caching and
> consistency. Cache tiles 24h. Keep the Landsat path intact and tried first, so the panel
> starts working again with no code change if NASA returns. Do not remove the NASA code.
> Never emit a tile URL the browser calls directly.
> ```

Came back with: a working chain, first time.
Action: kept it, but checked the tile order myself rather than trusting it — Apple Park at 37.3349, -122.0090 rendered the recognisable ring building, which it would not have done if x and y had been swapped. Also confirmed the caption swapped to the Esri text and that the "no capture date" state had been dropped. Commit `edc153f`.
What it cost: resolution and time. Esri is a composite of many undated captures, so no change over time can be measured from it. That is stated in the caption rather than hidden, and it is why the panel carries no derived metrics.
Lesson: I rejected three alternatives before prompting — wait for NASA, fake the panel with a placeholder image, or silently swap providers. The third is the one worth naming, because it produces a working screen with a Landsat caption sitting over non-Landsat imagery, and nothing on the page would say so.

---

## 4. Making the satellite panel say something, without inventing anything

> ```
> GOAL: Add an actionable layer to the satellite panel. The imagery currently shows a
> facility and says nothing about it. Add measured site facts and a comparison mode, both
> derived from the FACILITIES table rather than from the pixels.
>
> WHY THIS SHAPE: Esri basemap imagery is a single undated mosaic. There is no time series,
> no revisit, no per-tile capture date. Change detection, occupancy trends and activity
> inference all require two dated images and are therefore impossible here. What IS derivable
> from one image is the site itself — its type, its extent, its scale — and how that compares
> to another company's site. Build only that.
>
> --- A. Extend FACILITIES
> Each entry gains four hand-entered fields alongside the existing lat/lon/label:
>   siteType     — one of: "Corporate HQ", "Manufacturing", "Distribution",
>                  "Retail flagship", "Mixed campus"
>   footprintHa  — approximate site area in hectares, a number
>   scaleNote    — one short line of context, e.g. "~12,000 staff"
>   measuredOn   — ISO date the figures were entered by hand
> Populate WMT, AAPL, TSLA, NVDA, BA, CAT with plausible hand-entered values and leave a
> comment showing the shape so I can extend it. When a field is missing, the row is omitted
> rather than showing "N/A" or a zero.
>
> --- B. Site profile strip
> Directly under the image, above the existing caption: a four-column strip showing siteType,
> footprintHa, scaleNote, and a provenance line reading "Measured by hand from basemap
> imagery, [measuredOn]". Style it as quiet metadata, not as a metric dashboard — no large
> numbers, no colour, no trend arrows. These are static facts and the visual weight should
> say so. Below the strip, before the caption, one line in muted text: "This panel shows
> scale and site type. It does not show activity. Measuring change would need dated, repeat
> imagery from a commercial provider — the input we don't have."
>
> --- C. Compare mode
> A "Compare with…" control in the satellite panel header, listing the other companies in
> FACILITIES. Selecting one splits the panel into two side-by-side tile grids AT THE SAME
> ZOOM, each with its own label and profile strip. Same zoom is the whole point — the
> comparison is only fair if the scale bar is identical. Do not fit each image to its site;
> use a fixed zoom for both and let the larger site overflow its frame, because that overflow
> IS the finding. Under the pair, one generated line stating the ratio, computed from
> footprintHa. If either value is missing, omit the line entirely rather than guessing.
> Collapse to stacked, still same zoom, under 820px.
>
> --- D. Cross-panel synthesis
> A single line above the three panels, generated from data already on screen:
> "[siteType] · 90-day price [+/-X%] · recent coverage concentrated in [top Guardian
> sectionName by count]". Use only values already rendered in the panels. If any of the three
> is in a loading, empty, refused, unreachable or rate-limited state, omit that clause rather
> than substituting a default. If fewer than two clauses are available, hide the line. This
> is a summary of what is on screen, NOT an inference. Do not add interpretation, causation,
> sentiment or a recommendation.
>
> GUARDRAILS:
>  - No value in the profile strip may be computed from image pixels. Everything comes from
>    the hand-entered FACILITIES table.
>  - Do not add anything implying activity, occupancy, footfall, utilisation, throughput, or
>    a demand or revenue signal. No "activity index", no counting, no estimates derived from
>    imagery.
>  - The existing Esri caption stays exactly as written and must not be contradicted by
>    anything added above it.
>  - No new npm packages. No charting library. No image processing of any kind.
>  - Compare mode must not double the Alpha Vantage or Guardian calls — it compares
>    facilities only.
>  - Keep the Landsat-first fallback chain intact.
>  - The synthesis line is presentation only. It must never appear when the underlying panel
>    is in a non-success state.
> ```

Came back with: all four parts, working. The site figures here are hand-entered and carry the date they were entered, which is the point.
Action: kept it. Checked three things specifically — that compare mode held the same zoom rather than fitting each image to its own frame, that the ratio line omitted itself when a footprint value was missing rather than defaulting to zero, and that the synthesis line disappeared when I forced the price panel into its rate-limited state. Commit `35fd794`.
Lesson: the explicit ban on activity indices was defensive, not decorative. The agent had alternative-data context from the earlier prompts and would plausibly have offered a "site activity score" as a helpful addition. Naming the prohibition was cheaper than reviewing for it afterwards.

---

## 5. The restyle. This is the one that went wrong

> ```
> GOAL: Restyle only. Do not change any behaviour, any state logic, any API call, any
> function in api/, or any of the panel state sentences.
>
> THE PROBLEM WITH THE CURRENT UI: every panel is the same white rounded card on grey, same
> radius, same shadow, so the satellite image, the price and the news all carry equal visual
> weight and the eye has nowhere to land. Every panel also has a tracked-out all-caps label
> joined with middle dots, which occupies the most prominent row in each card and says the
> least. One typeface at essentially one size throughout.
>
> THE DIRECTION: the satellite image is the distinctive thing on this page. Spend the
> boldness there and make everything else quiet and dense. The page should read as a research
> instrument, not a SaaS dashboard.
>
> --- A. Palette — ground it in the imagery itself.
>   --ink #1B1F1A · --paper #FBFAF7 · --slate #6E7469 · --rule #D8D9D2 · --up #2F6B4F ·
>   --down #A33A2A. Remove the current saturated greens and reds.
>
> --- B. Structure — remove the card grid entirely. No white boxes, no box-shadow, no
> background fills on panels. Sections separated by a single hairline. border-radius 4px, and
> only on the satellite image. The satellite panel becomes the hero: full width, noticeably
> taller, with the company name, ticker and ninety-day change overlaid on the image at the
> lower left over a soft dark gradient scrim. The separate header strip above it goes away;
> its information moves onto the image. Price and news sit beneath, denser and quieter.
>
> --- C. Typography — one family, real range. price change 3.2rem/500/-0.02em tabular-nums;
> company name 1.9rem/600; headlines 1.05rem/1.35/600; body 0.9rem var(--slate); metadata
> 0.72rem var(--slate) SENTENCE CASE. Tabular figures on every number that updates.
>
> --- D. Labels — replace every all-caps middle-dot eyebrow with a plain sentence-case
> heading. Source attribution moves to the bottom right of each panel as quiet metadata. Do
> not delete any attribution — it is a licence requirement.
>
> --- E. Status chips — flatter and smaller, not prettier. 6px dot plus the word, no pill, no
> border, 0.72rem. Colour the dot only.
>
> --- F. News rhythm — editorial list, not cards. Rows separated by hairlines, line length
> under 80 characters.
>
> GUARDRAILS:
>  - style.css only, plus the minimum markup edits needed for the label swap in D and the
>    image overlay in B. Do not touch any file in api/.
>  - Do not change, shorten or reword any state sentence.
>  - Do not remove the Esri, Landsat, Guardian, Alpha Vantage or not-financial-advice lines.
>  - Keep the reserved panel heights so a state change does not shift the page.
>  - No animation on load. Keep visible keyboard focus. Respect prefers-reduced-motion.
>  - Collapse cleanly to one column under 820px.
>  - No new libraries, no CSS framework, no web font beyond what is already loaded.
> WHEN DONE: list what you changed in style.css and the exact markup lines you touched.
> ```

Came back with: a confident report of success across all six sections, and a list of four edited files — `style.css`, `index.html`, **`src/index.css` and `src/main.ts`**.
This project has no `src/`. The functions live at project root in `api/` because that is what Vercel runs, and the front end is a single `index.html` with one external stylesheet. Two of the four files it edited do not exist in my repository. It wrote into a directory structure it assumed rather than one it had read.
What actually shipped: the palette, the hairlines, the type scale and the status chips landed. The hero did not. And because section B said *move the price into the hero overlay*, the price was duly removed from the price panel and placed into a container that was never built. **The ninety-day percentage disappeared from the page entirely.** Both halves of the instruction were executed; only one had somewhere to land.
Action: none yet. I did not read the summary and move on, I opened the deployed page, which is the only reason I found it. Commit `1ac36ce`.
Lesson: CSS fails silently on selectors that match nothing. A stylesheet can grow by two hundred lines and change nothing on screen without raising an error anywhere. A tool's account of its own work is not evidence.

---

## 6. Asking three times for the same thing

Commits `80387c8` and `6f2ae59`. Two further prompts, both trying to repair the hero from entry 5, neither of which I am reproducing in full because they were the same instruction in slightly different words.

The mistake is structural rather than verbal: each prompt was written against **my description of the page** rather than against the page, because the tool could not read the repository and I could not see what it had actually written. I was repairing a state neither of us could see.
Action: stopped rewording. The pattern across the five commits was already clear — the tool succeeded where the work was contained in a single file it was writing from scratch, and failed where the work required knowing what already existed across two files. That is a limit of context, not of code generation.

---

## 7. Where I stopped prompting

Two places.

**The Vercel environment variables.** Setting them by conversation was going to take several exchanges of me describing a dashboard the agent could not see. Doing it in the dashboard took about twenty seconds. I stopped asking after that.

**The tool itself.** Midway through the fourth styling attempt the AI Studio quota ran out and generation was cut off. That forced a decision I had been putting off since entry 5: keep spending attempts on a tool that cannot read the repository, or move. I cloned the repository to `mgmt6110_ps2_resume`, which is why there are two live links and two repos above, and continued in Claude Code.

---

## 8. The resume prompt — read first, change nothing

> ```
> This is an existing static site deployed to Vercel from GitHub. Read the repo before
> changing anything — index.html, style.css, and everything in api/.
>
> WHAT IT IS: "Overberg", a first-pass company research dashboard. A user searches a company
> and gets four panels — a satellite view of its main facility, a ninety-day price chart,
> recent Guardian coverage, and a synthesis line summarising the three.
>
> STACK: vanilla HTML/CSS/JS, no build step, no framework. Serverless functions at project
> root in api/, siblings of package.json. Keys in Vercel environment variables: NASA_API_KEY,
> GUARDIAN_API_KEY, ALPHAVANTAGE_API_KEY.
>
> WHAT YOU MUST NOT BREAK — these were hard-won and are the graded part of this project:
> 1. FOUR-STATE HANDLING. Every panel has its own independent loading, empty, refused and
>    unreachable states, each with its own literal user-facing sentence. Do not collapse them
>    into a shared error banner. Do not reword any state sentence. A satellite outage while
>    prices work is normal and the screen must say which is down.
> 2. ALPHA VANTAGE returns HTTP 200 OK with an "Information" key instead of data when
>    rate-limited — a success code carrying a failure. Never fire two Alpha Vantage calls
>    concurrently; sequence them. Check for "Information"/"Note" before looking for data.
>    Retry once after 1200ms, then surface the rate-limited state. Serve stale cache rather
>    than nothing.
> 3. SATELLITE FALLBACK CHAIN. NASA Landsat first, Esri World Imagery second, unreachable
>    third. NASA's Earth endpoints were down at build time and the Landsat path stays so it
>    recovers with no code change. Esri tiles are /{z}/{y}/{x}, NOT /{z}/{x}/{y} — swapping
>    them returns a valid tile of the wrong place, silently.
> 4. CAPTIONS MATCH THE SOURCE. The Esri caption states that capture date is not published per
>    tile. Do not invent a date, do not show today's date as a capture date, and do not add
>    anything implying activity, occupancy, footfall or a demand signal. The site profile
>    figures are hand-entered in FACILITIES, never derived from pixels.
> 5. CREDENTIALS. Keys read via process.env inside api/ only. Never in browser code, never in
>    a file or comment, never a variable name starting with VITE_, never printed in a response
>    or log. /api/health reports keyConfigured without revealing values.
> 6. ATTRIBUTIONS ARE LICENCE REQUIREMENTS. Guardian ("Powered by the Guardian", linked,
>    summary-only so excerpts truncate to 200 chars server-side), NASA, Esri, Alpha Vantage,
>    and the not-financial-advice line. None may be removed or hidden behind a toggle.
>
> KNOWN OUTSTANDING ISSUES, in priority order:
>   a) api/news.js returns a December 2020 article as the second most recent result for a
>      Walmart search. order-by=newest may not be reaching the request, and the relevance
>      filtering was specced but never implemented — results match on retailer links buried in
>      body text rather than on coverage of the company.
>   b) The satellite hero was specced and never built. The image, company name, ticker and
>      price overlay are missing from the top of the page.
>
> Start by reading the repo and telling me what you find — in particular whether (a) and (b)
> match what is actually in the code. Do not change anything yet.
> ```

Came back with: three defects I never mentioned and could not have seen.
1. `api/prices.js` and `api/company.js` were firing **concurrently** — exactly the pattern the rate limiter rejects, and exactly what I had forbidden in the master prompt at entry 1. It had never been implemented.
2. Provider text was being injected **unescaped**.
3. The `FACILITIES` table was **duplicated across two functions** rather than shared, so my hand-entered figures could drift apart silently.

None of these are visible from the front end. All three were found by reading code rather than by looking at the page, which is the entire argument for the move.
Action: fixed all three. Commit `bf5babc`.
Lesson: I had been reading intermittent rate-limit states as provider flakiness for two days. It was my own concurrency.

---

## 9. The work after that

Five commits in the second repository. My prompts here were shorter, because I was no longer describing a codebase to a tool that could not see it.

- **`b9fd6e6` — price chart crosshair, grouped synthesis, compact metadata row.** The constraint that mattered: the crosshair and the period toggles read from the ninety-day series already in memory and re-slice rather than re-fetch. Another call would have been refused.
- **`d601973` — synthesis restructured into a tinted column band.** A correction to my own earlier instruction. I had told it to strip colour and hierarchy from everything so the imagery could carry the page, and that flattened the synthesis into a footnote when it is the payoff. This commit breaks my own rule in exactly one place, deliberately.
- **`a6b7c5b` — expandable price chart, tinted facility metadata.** Density. There was roughly 40% dead space between the hero and the panels.
- **`d9e66ca` — inert mockup ad slot with a licensing note.** Three of my four sources prohibit ad-supported use: the Guardian developer key is non-commercial, the Alpha Vantage free tier is evaluation-only, and Esri's basemap terms do not cover it. Rather than write that in a document nobody opens, it sits on the page as an empty dashed rectangle with the reason underneath. "Inert" in the commit message is literal: no script, no tag, no external request.
- **`2308385` — label which company the lower panels describe in compare mode.** A bug I had been looking at for an hour without registering. In compare mode the two satellite panels show Walmart and NVIDIA, but the price chart and news beneath still describe Walmart only, unlabelled. Nothing on screen said which company the lower half was about. I had flagged the visual imbalance between the two heroes and missed the actual problem underneath it.

---

## 10. Everything the agent told me that turned out to be wrong

| What I was told | How I found out |
|---|---|
| Six sections of the restyle completed, four files edited | Opened the deployed page. The price was gone. Two of the four files do not exist in this repo. |
| `api/news.js` filters affiliate sections and sorts newest-first | A December 2020 article came back second in a "newest first" list. The filtering was specced, described back to me accurately, and never implemented. |
| Alpha Vantage calls sequenced per the guardrail | Only when a second tool read the repository, four days later. Invisible from the screen. |
| FACILITIES shared across functions | It was duplicated. Found by reading, not looking. |

The pattern in the first three rows is the same: **the description of the work was accurate about my specification and wrong about the code.** It was telling me what I had asked for, not what it had built, and those read identically.

---

`This was so much fun. Looking to learn how to build more on extracting and synthesising the data we get from images, to optimise operations and finance together.`
