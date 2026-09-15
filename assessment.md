# assessment.md - Overberg · Is this company worth an hour of deeper reading?

**Student:** Keziah Sherlyn Vanessa Vickraman · **Course:** MGMT 6110 · **Problem Set 2**

**Live (built in Google AI Studio):** https://mgmt6110problemset02finance.vercel.app/
**Repository:** https://github.com/KeziahVickraman-MBAI/mgmt6110_problemset_02_finance

**Live (build resumed in Claude Code):** https://mgmt6110ps2resume.vercel.app/
**Repository:** https://github.com/KeziahVickraman-MBAI/mgmt6110_ps2_resume

Two live links and two repositories because the build stopped in one tool and continued in another. Nothing was discarded — the second repo is a clone of the first at commit `6f2ae59`. Why that happened is Q2, and it is the most useful thing in this document.

---

## Part 1: My criteria, and where I actually land

### A good front end

**It says which thing is broken, not that something is.** `5/5` — A satellite outage while prices work is the normal case, not the exception. Four panels, four independent state machines, and every loading / empty / refused / unreachable sentence written literally by me. Not one was reworded across nine commits and two tools.

**Nothing on screen claims more than its source supports.** `5/5` — The Esri caption states that capture date is not published per tile. The site profile says "Measured by hand from basemap imagery, [date]". The synthesis line deletes itself if any panel underneath it is in a non-success state.

**It says what it cannot do, on the screen, not in a document.** `5/5` — <mark>"This panel shows scale and site type. It does not show activity."</mark> is on the page. So is the dashed empty ad slot with the licensing reason printed underneath it.

**Visual hierarchy matches decision weight.** `3/5` — The user is deciding whether to read further, so the imagery and the ninety-day trend should dominate. It gets there. It took four attempts, one of which removed the price from the page entirely.

### A good back end

**The credential never leaves the server.** `5/5` — All three keys via `process.env` inside `api/` only. No `VITE_` names, `.env*` in `.gitignore`, `/api/health` reports `keyConfigured` and nothing else.

**It fails before it calls, not after.** `5/5` — An unset variable is sent as the string `"undefined"` and the provider answers 401 exactly as it would for a wrong key. That is an hour spent debugging the wrong thing, so the guard sits before the fetch and returns 503 with a named error.

**It handles a success code that carries a failure.** `4/5` — The check was in every function from the first build. The calls were still firing concurrently for four days. Correct check, wrong architecture. More in Q3, because it *is* Q3.

**It degrades instead of disappearing.** `5/5` — Stale cache on throttle, and a three-tier satellite chain that keeps the dead NASA path tried-first so it recovers with no code change.

**Relevance, not just retrieval.** `2/5` — Five articles that mention the company in an affiliate shopping link is a working endpoint and a broken product. `q=walmart` still surfaces `thefilter-us` reviews, and a December 2020 article came back second in a *newest-first* list. Specified in Prompt 1. Described back to me as built. Not built.

> The back end deserves more credit than the front end, and the reason is not modesty. Every back-end judgement was made before any code existed, by me, at a terminal, calling providers by hand. The front end is where I spent four attempts on something I could have had in one, because I was describing a page to a tool that could not see it.

---

## Q1: Where did the agent make me faster, and by how much?

Fourteen files and five working serverless functions in one pass — `company`, `satellite`, `news`, `prices`, `health` — with cache headers, the before-fetch credential guard and the 200-character server-side truncation already in place. By hand, with five different error shapes, that is most of a weekend. It took minutes.

What I did with the hours is the part I would defend. I spent them calling the five endpoints myself: thirty consecutive Alpha Vantage calls, a Guardian search for `walmart`, three NASA endpoints over two networks with `curl -4` after I suspected an IPv6 fault. Those results became the guardrails in the master prompt. The speed did not remove work. It moved my work from typing handlers to interrogating providers, which is where it was worth more.

Two different kinds of task, and the distinction matters more than the instance:
- The five handlers --> something I **could have written but slowly**. Known shape, tedious, no judgement in it.
- The Web Mercator tile maths --> something I would have written **badly**, then debugged for an hour without realising, because `/{z}/{y}/{x}` and `/{z}/{x}/{y}` both return a perfectly valid picture and only one of them is the right place.

**And where it was faster by hand:** the Vercel environment variables. Setting them by conversation meant describing a dashboard the agent cannot see, back and forth. The dashboard took twenty seconds. I did not even try going for that....

---

## Q2: Where did it cost me time, and whose fault was that?

Three commits —> `1ac36ce`, `80387c8`, `6f2ae59` and then the quota dying mid-way through a fourth attempt at the same thing.

**The agent's share.** It reported success across all six sections of my restyle prompt and listed four edited files, two of which were `src/index.css` and `src/main.ts`. This project has no `src/`. The functions live at root in `api/` because that is what Vercel runs. It wrote into a directory structure it assumed rather than one it had read, then described that work back to me with total confidence.

**My share, which is bigger.** My prompt said *move the price into the hero overlay*. Both halves executed faithfully: the price was removed from the price panel, and placed into a container that was never built. <mark>The ninety-day percentage vanished from the page.</mark> That is not a misunderstanding. That is an instruction with a dependency I never checked.

**The part that actually cost the weekend.** I then wrote two more prompts to repair it — both against *my description of the page* rather than against the page, because neither of us could see the state. CSS fails silently on selectors matching nothing, so a stylesheet grows two hundred lines, nothing changes on screen, and no error is raised anywhere. I issued one instruction three times in slightly different words instead of once against a known state.

Two faults, two remedies, and only one of them is about the tool:
- Agent wrong about `src/` --> change tools.
- My instruction unfinished --> change my opening move. *Read the repository and tell me what you find. Do not change anything yet.* That is the first line of Prompt 9 and the single most useful sentence I wrote all weekend.

---

## Q3: Did it ever hand me something that looked right and was not?

Three times, getting worse each time.

**Caught in seconds.** The restyle report listed four edited files, two of them `src/index.css` and `src/main.ts`. There is no `src/` in this project and never has been. That one was free, because a file path is checkable in a glance — the tool had written into a structure it assumed rather than one it had read.

**Accepted for days.** The description of `api/news.js` came back saying it searched the name in quotes, excluded the affiliate sections, stripped HTML before truncating, and sorted newest-first. I approved it, because it was an exact restatement of what I had asked for and it read as competent. I found out when a **December 2020 article appeared second in a newest-first list**.

**Never caught at all.** When I moved to a tool that could read the repository and asked only for a report, it returned three defects I had never mentioned: `prices.js` and `company.js` firing **concurrently**, provider text injected **unescaped**, and `FACILITIES` **duplicated across two functions**.

The concurrency is the one that stings. I had forbidden it twice, in capitals, with the reason attached:

```js
// what a throttled Alpha Vantage reply actually is
{ "Information": "Please consider spreading out your free API requests (1 per second)..." }
// HTTP 200 OK. response.ok === true. No "Time Series (Daily)" key. Nothing throws.
```

For four days I read those intermittent rate-limit states as Alpha Vantage being flaky. It was my own page calling twice at once.

In the second and third parts, I realised eventually that the account was accurate about **my specification** and wrong about **its code**. I realised that I actually could not tell a description of the build from a brief. This is where I wanted to deepen my expertise exactly. I do not know what I am looking at actually...

---

## Q4: What did I have to know in order to supervise it?

Four things, and every one came from calling something by hand rather than reading about it.

- **That an HTTP 200 can carry a failure.** Thirty consecutive calls, roughly two throttles for every success, all of them `200 OK`. Naive code renders an empty chart and no error.
- **That both tile orders return a picture.** Swap `x` and `y` and you get a valid tile of the wrong place, silently. I verified against Apple Park's ring building rather than trusting the output, because this is exactly the kind of thing an agent "corrects" from habit.
- **That you cannot do change detection with one undated image.** Esri World Imagery is a single composited mosaic with no per-tile date published. Occupancy, footfall, utilisation, construction progress — not *hard at my resolution*, **impossible with my inputs**. Knowing that is what stopped me commissioning a "site activity score" that would have been invented while looking sourced.
- **That "newest first" is checkable in one glance.** Not by reading the first result, which is always plausible, but by reading the second one's date. A December 2020 article sitting in position two is the whole test, and it takes three seconds.

**Now the harder half.** What would I have needed to know to catch the concurrency, which I did not catch? Not more Alpha Vantage knowledge — I had that, I wrote it into the prompt. What I lacked was the knowledge that <mark>some classes of defect leave no trace on the screen at all</mark>, so looking at the page is not a test. Concurrency, escaping and duplicated state are all invisible from the front end. I was supervising by opening the deployed site, which catches a missing price and can never catch a race condition.

*I could read enough to verify a tile order and a caption. I could not have gone looking for the concurrency, because I did not know that file had a question in it—it contained my guardrail, restated back to me, and I had no reason to open it. The judgement that stays mine is knowing which questions the screen can answer and which ones only the code can.*

---

## Q5: Which decisions did I keep, and should I have kept more or fewer?

Mine, in the order they happened: what the product is for and for whom · which three providers, and which claim each repairs · **the literal sentence every panel shows in every state** · the cache windows · a fallback chain rather than waiting, faking or silently substituting when NASA died · that the caption must change with the source · that the satellite panel carries no derived metrics at all · that site figures are hand-entered with the date they were entered · that the ad slot is inert and carries its own licensing note · to stop prompting and use the Vercel dashboard · to change tools.

**One I should have handed over.** The styling. I wrote hex values, rem sizes, letter-spacing, six sections — and got a page with the price missing. That was production work I was holding onto, and holding it did not help, because what the task actually needed was sight of the current state, which I could neither give it nor check myself.

**Two that never reached the list at all.** The agent settled *where `FACILITIES` lives* by duplicating it, and settled *whether the two Alpha Vantage calls run in sequence* by running them in parallel. I never knew either was open.

**And the clearest instance of the boundary moving quietly.** In compare mode, the two satellite panels show two companies while the price chart and news beneath describe only one — unlabelled. The agent settled what the lower half of the page refers to, by not labelling it. I looked at that screen **for an hour**, flagging the visual imbalance between the two heroes, and never registered the actual problem underneath it. Fixed in `2308385`.

On the state sentences: I decided those, and it is the decision I am most confident about. But I only got to decide them because Prompt 1 was a specification rather than a request. Had I asked for "a company dashboard" I would have been handed a spinner and a single generic error banner --> and I would have accepted both, without ever noticing that a decision about my product had been made on the way past.

---

## Q6: Now scale it up — what does this mean for a team of thirty?

All three of these trace to one fact: **my worst defects this weekend were invisible from the product.**

**1. A read-only gate before any change to shared code, and the report goes in the pull request.**
*Traced to:* "read the repository and tell me what you find; change nothing" returned three real defects on its first run, none of which I had reported or suspected. One exchange, and it is the only step that catches the class of thing a screen cannot show.

**2. A named list of what an agent may not settle — enforced as assertions, not as a wiki page.**
Mine: user-facing sentences in failure states, any caption asserting provenance, licence and attribution lines, and concurrency against a rate-limited provider.
*Traced to:* my concurrency guardrail was written in capitals, twice, with the reason attached, and was ignored for four days. A rule in a document would not have caught it. A test asserting that two calls to one provider cannot overlap would have caught it on day one. <mark>If you cannot write a check for it, you have not reserved the decision — you have expressed a preference.</mark>

**3. A weekly provenance review, midweek rather than Friday.** One person, one hour, walking the product and asking of every number and every caption: where does this come from, and what is it claiming?
*Traced to:* my Landsat caption became false the instant the Esri fallback fired, and nothing in a code review, a test suite or a page load would have flagged it. Only a person reading the sentence while knowing where the pixels came from. This is the thing nobody currently checks: not whether the code is correct, but whether the words on the screen are still true about the data behind them after the data changed.

**What I would refuse outright, and sign my name to:** any generated figure whose provenance cannot be stated in one sentence on the screen. Across thirty people the failure does not arrive as somebody inventing a number. It arrives as a number hand-entered in one file, called "derived" in a second, and read as "measured" by a customer in a third, with nobody anywhere in that chain having lied.

---

`This was so much fun. Looking to learn how to build more on extracting and synthesising data from imagery — to optimise operations and finance together, and to write the tripwires before the thing ships rather than after it.`
