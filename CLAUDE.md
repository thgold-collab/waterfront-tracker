# waterfront-tracker

A single-file dashboard running **two parallel searches** for Ted, published at
https://thgold-collab.github.io/waterfront-tracker/

- **Houses** *(the live search as of run 12)* — 3+ bed / 2+ bath, $350k–$700k, **60–90
  minutes** from Glen Allen and centred on Tappahannock, **plus Bay Creek at Cape Charles**
  regardless of drive. Amenities and town life score as highly as water. **Reedville is
  excluded** — Ted went and found there was nothing to do there.
- **Land** *(parked)* — waterfront land under $200k within ~3 hrs, for a build in 2–4
  years. Ted said "I want houses not lots" at run 12; the track, its run-8 rubric and its
  scores are all left untouched, not deleted. Do not re-score it without being asked.

The two are independent: separate criteria, rubric, filters, sorts and preferred areas.
A track switcher above the tiles picks one.

**The brief moves.** It has changed materially at runs 5, 7, 8, 11 and 12. Read the state
block for what is true now; treat this file's history sections as the reasoning behind
past decisions, not as current instructions.

Updated weekly by the `Waterfront deal scan` routine (Fridays ~7am ET), which commits
straight to `main`. Both tracks are refreshed in the same run.

## Architecture

`index.html` is the dashboard — inline CSS and JS, no build step, no dependencies, no
external calls. `sunday.html` is a standalone trip itinerary served from the same Pages
site; it is hand-written, has nothing to do with the weekly run, and **routines must leave
it alone.** All data lives in one place: the `<script id="state" type="application/json">`
block near the bottom. **That block is normally the only thing you edit.**

```
{ schema: 2, runDate, runNumber, runLabel, runNote, activeTrack, tracks[], listings[] }
```

Each track: `id`, `label`, `blurb`, `unit`, `listLabel`, `chips[]`, `criteria{}`,
`rubric[]`, `typeFilters[]`, `typeNames{}`, `sorts[]`, `priorityAreas[]`,
`priorityLabel`, `footnote`, `emptyMsg`, and on Houses `townScores{}`. Everything the
header, controls and footer show comes from the active track — **there is no
track-specific text left in the HTML.**

`criteria.driveBandMins` (e.g. `[60, 90]`) turns on a drive-band filter chip;
`criteria.driveBandDefault` makes it start pressed, so the board opens focused;
`criteria.bandExempt` lists areas searched deliberately from outside the ring (Bay Creek)
so the band never hides them. "Show all" clears the band like any other filter.

Each listing: `id`, `name`, `region` (nn|es|lk), `water`, `type` (waterfront|access|home),
`price`, `priceWas` (ORIGINAL list price), `acres`, `score`, `drive` ("1h20"), `hoa`,
`firstSeen`, `firstSeenRun`, `status` (active|pending|sold|removed), `highlights[]`,
`amenities[]` (optional), `flags[]`, `signals`, `url`, and **`track`** (`land`|`house`;
absent means `land`).

House listings additionally carry `beds`, `baths`, `sqft`, `yearBuilt` and `dock` (a
short string, or `true`). `dock` drives a badge, a summary tile and a filter.

`driveSource` records how a drive time was obtained. Run 11 routed eleven addresses door
to door and found the estimates wrong in both directions by up to half an hour, which
matters now that a drive band filters the board. **Route new drive times; do not eyeball
them.** Rows without `driveSource` are still estimates.

## Invariants — each of these is a bug that was already fixed once

Do not hand-edit the header or footer HTML, and do not rewrite the render functions
without reading this list first.

- **Run metadata is data-driven.** The subtitle's "Run N" comes from `runNumber`, the
  phrase after it from `runLabel`, the footer note from `runNote`. Editing the HTML
  instead reintroduces stale run text. Omit `runNote` and the paragraph removes itself —
  never carry a previous run's note forward.
- **"New this run" is `firstSeenRun === runNumber`.** Set `firstSeenRun` on genuinely new
  listings only; never touch it on existing ones. (It was once hardcoded on for every card.)
- **All listing text is escaped through `esc()` before interpolation.** Every field is
  scraped from third-party sites. Separators stay as literal HTML entities; data never does.
- **No bare `reduce()` on a filtered subset.** The tile summaries run on status-filtered
  arrays, so they can legitimately be empty. An unguarded reduce throws
  "Reduce of empty array with no initial value" and blanks the entire page.
- **No value may contain the literal `</script>`.** It terminates the state block and
  breaks the page. Everything else (`&`, `<`, quotes) is safe.
- **Listing ids must be unique and stable.** The clickable tiles jump by id.
- **Every listing needs a valid `track`.** An id not in `tracks[]` renders nowhere.
- **The scoring rubric is data too, per track.** The footer paragraph renders from the
  active track's `rubric[]`
  (`{label, detail, pts}`). Reweighting means editing that array, never the HTML, and the
  points must still total 100. Scores on the board must reflect the current rubric — when
  the weights change, every listing gets re-scored, not just the new ones.

## Preferred areas

`priorityAreas` is **per track** — `["Cape Charles","Bay Creek"]` on Land, and the six
preferred towns on Houses. It is matched case-insensitively against each listing's
`name` and `water`. Matches get a star badge, a left rule, a filter
chip and a "priority areas first" sort. New listings in those areas inherit the flag
automatically — do not hand-tag them. `listing.priority === true` forces it on.

The Land track's preferred areas get deeper diligence than anywhere else. Open questions: Bay Creek POA
assessment vs. optional-or-mandatory club membership and the real annual carry; tidal
frontage vs. resort amenity pond (Crystal Lake is a pond); Kings Creek frontage character
and MLW depth; lot elevation vs. BFE. Cape Charles sits ~3 ft with most developed land at
5–10 ft, and Northampton County requires a sealed flood elevation certificate, with V-zone
plans sealed by a Virginia-licensed architect or engineer.

## Amenities — scored on Houses, not on Land

**Run 12 split the two tracks on this.** On **Houses**, amenities are now scored, but not
as their own category: waterfront quality and community amenities are one **`setting`**
category worth 25, taken as **whichever axis the place leads on**. Ted's words were
"amenities and town things to do high and water high if amenities are low", and that is
compensatory, not additive — a bare waterfront house and an amenity community reach the
same mark by different routes, and neither is docked for lacking the other. Do not turn
this back into two categories that sum; that would penalise every listing for being one
thing rather than both.

On **Land**, amenities still earn no points (run 7, unchanged). The Land rubric stays at
price 30 / buildability 25 / water access 20 / hold-and-build fit 15 / deal signals 10.
Keep populating `amenities[]` there — it drives the card line, the count badge, a filter
chip and a sort — but do not score it, and do not re-score that track without being asked.

**A caution learned the hard way at run 12.** Halving Land's water access to 10 frees only
10 points, so amenities at 20 cannot be funded from water alone; the arithmetic has to
come to exactly 100 and a proposal that totals 110 is not a proposal. Check the sum before
offering a rubric, not after.

## Amenities history — there were two buyers

Ted optimises for land value, buildability and real boating water. His wife rates the
lifestyle of an amenity community (Bay Creek being the reference) very highly: pool and
clubhouse, golf, beach and trails. Both count, and a lot strong on only one axis is
weaker than its number suggests.

Run 5 made amenities worth 20 of 100, funded mainly by dropping hold-and-build fit from
15 to 10 — that category penalised HOA and club dues, so an amenity-rich community was
being charged twice, once for the cost with no credit for what it buys. Run 7 removed the
weighting again, which restores that double-charge; if amenities ever come back, take the
points from hold-and-build fit again rather than adding them on top.

Rank amenity quality: pool/clubhouse first, then golf, then beach and trails, then
everything else. **A marina, boat ramp or deeded slip is not an amenity here** — water
access quality already scores those, and counting them in both places inflates every
community with a dock.

`amenities[]` holds short plain-text items and drives a line on the card, a count badge,
a filter chip and a sort. Populate it only from what a listing or the community's own
materials state. Omit the field entirely for an unresearched community — that is
different from having no amenities, and a keyword sweep is not good enough: it tags
`nn-haven-beach-*` off a road name and `nn-buzzard-point` off a nearby *public* beach.

## Status provenance — how a sold house got recommended for a viewing

Run 8 put 103 Bayview Dr on a shortlist for a Sunday drive. It had **sold on 5/18/2026**
and had been carried as active for about eleven weeks. The same shortlist's other house,
270 River Road Cir, turned out to be a **complete tear-down**. Neither was bad luck:

- `statusAsOf`, `listedOn`, `soldOn` were populated on **0 of 38** houses. "Active" was a
  claim with no date and no source, so a stale one looked exactly like a fresh one.
- The Saluda `url` was a brokerage **category page**, not a property-detail page, so that
  listing could never be re-verified and its condition could never be checked.
- Condition was never researched. `yearBuilt` was empty on 27 of 38, and $307/sqft put it
  at the **high** end of the board — the price gave no warning at all.

So, non-negotiable now:

- **Every listing carries `statusAsOf` and `statusSource`.** A status older than 14 days
  renders an explicit unverified badge, is counted in its own summary tile, and can be
  filtered. `scripts/verify.js` enforces this on anything the current run touched, and
  prints the legacy backlog count so it cannot quietly persist.
- **Verification hierarchy.** County transfer and assessment records are authoritative for
  sold and for prior-sale price. An MLS-backed brokerage detail page beats an aggregator.
  A search page, category page or index page is **not evidence** — if you cannot reach a
  property-detail page, set `status: "unverified"` rather than leaving it active.
- **`url` must be a property-detail page**, unique per listing. Two listings sharing a URL
  fails the suite.
- **Condition is researched, not assumed.** Record `yearBuilt`, and flag as-is / handyman /
  investor / "bring your vision" language, absent interior photos, or a gut job. For this
  brief a tear-down is close to disqualifying — say so in a flag rather than burying it in
  a size comment.

## What actually holds the Houses track down

Three things cap it at once, and every one is missing information rather than a judgement.
Run 12's active board tops out at **70** with a mean of 58 for exactly these reasons — say
which case it is in `runNote` rather than inflating scores to look healthier.

1. **No listing sits in a good town.** `townScores` runs to 13 (Irvington, Urbanna) but the
   board's best active town is Kilmarnock at 11. **There are zero active houses in Urbanna
   or Irvington** — the two towns Ted named. That is a coverage gap: sweep them directly.
2. **Almost no community amenities.** 3 of 23 active houses have any recorded, and the best
   set is 15 of 20. Nothing on the board is Bay-Creek-grade, which is why Bay Creek houses
   are now searched despite being outside the drive band.
3. **MLW depth.** Dock & boating is 10 of 100 since run 12 (down from 22), but depth is
   still its currency and **one house of 38 states a figure** — 57 Swann Court, at a
   shallow 3–4 ft. Everything else is listing language: "sailboat depth", "good boating
   depth", "dock-able". Never convert that language into a number. Sources worth trying:
   NOAA chart soundings, county GIS, VMRC/JPA dock-permit records, the listing agent.
   Distinguish a private permitted pier, a shared community dock, "dock-able" and "room for
   a pier" — four different things, and only the first earns full marks.

## Network access — measured at run 12, and not what this file used to say

**Most listing sites are blocked by the sites themselves, not by our network.** Run 12
tested this properly: `$HTTPS_PROXY/__agentproxy/status` reported `recentRelayFailures: []`
— zero policy denials — while the sites returned their own walls. Earlier runs (and run
12's own first pass) called this an egress-policy block and were wrong. Run 2 made the
mirror-image mistake, blaming LandSearch for a policy denial. **Check which it is before
claiming either.**

**`curl` and `WebFetch` do not have the same reach.** WebFetch returned `EGRESS_BLOCKED`
for hosts that `curl` fetches fine — the JLARC broadband report is a 6.2 MB PDF over curl
and "blocked" over WebFetch. If WebFetch refuses, retry with curl before recording a
source as unreachable.

Measured at run 12 (re-test; these move):

| Source | State |
|---|---|
| Zillow, Trulia | **403, PerimeterX captcha** — the site's wall |
| LandWatch, Homes.com | **403 Akamai "Access Denied"** — the site's wall |
| LandSearch | **403 Cloudflare challenge** — the site's wall |
| Long & Foster, Hometown Realty | 403 |
| Realtor.com | 429, **and its robots.txt forbids scraping in terms** — do not use |
| **Redfin** | **200.** robots.txt `User-agent: *` **disallows `/stingray/`** (their API) — public city and property pages only |
| **Hardesty Homes** (Tappahannock) | **200**, has `/listings/city/<Town>/` indexes |
| **Mason Realty** (Urbanna) | 200 — but category-page based; find the detail page |
| **Blue Heron Realty** (Cape Charles) | 200, `/homes-for-sale-search/` |
| Chesapeake Bay Properties, Coldwell Banker | 200; CB property-detail pages re-verify fine |
| WebSearch | Always works, and has produced real MLS numbers and prices all along |

Respect robots.txt and site terms — that is a separate question from whether a fetch
succeeds. Never route around a *policy* denial. If sources really are unreachable, say so
in `runNote` and in the summary, and do not present carried-forward figures as re-verified.

### There is no MLS API to reach for — checked at run 13

The standard exists (RESO Web API, REST/OData, OAuth 2.0, and NAR requires REALTOR-owned
MLSs to offer it) but it is credentialed, per-MLS, and gated on a licensed participant.
**This search area needs at least two licences**, which the board's own MLS ids show:

- **`CVR-…`** — Central Virginia Regional MLS. Tappahannock, Warsaw, West Point, and all
  18 of run 13's candidates. Licensed through **Trestle**; the Data License Agreement is
  signed by the technology provider **and** a broker **and** the agents on it.
- **`VANV…`, `VALV…`** — Bright MLS (VA + county code) — the Northern Neck.
- Bare numeric ids — a third, smaller association.

The Bright ↔ CVR data share (May 2025) **excludes IDX and API feeds**, so it does not
collapse the two into one. Reckon on ~$50–500/mo per MLS plus setup, and a sponsoring
broker either way. Do not spend a run trying to obtain this.

And it would not fix the actual bottleneck. What holds this board back is MLW depth,
condition and community dues — MLW is essentially never a public MLS field. An agent's
saved search with instant alerts is the better instrument: it *is* the MLS, it is free,
and it covers both systems if the agent holds both.

## Scoring calibration

Re-scoring the whole board against changed weights is the single most error-prone thing
a run does. Run 6's first attempt marked *everything* down instead of reweighting — mean
65 → 50, top score 82 → 71, nothing above 70 — and needed a corrective pass. Anchors:

- **Score each category on its own scale and sum.** Do not form an overall impression and
  back-fill the parts. That is what produces board-wide drift.
- **A missing category is unearned, not a penalty.** A listing with no community amenities
  scores 0 of 20 there and loses nothing elsewhere. Its ceiling is therefore 80, and an
  excellent bare-land waterfront lot should still reach the low-to-mid 70s.
- **Score and data must agree.** When a rubric has an amenities category, a listing with
  no `amenities[]` cannot exceed `100 − amenityPoints`. `scripts/verify.js` enforces this
  whenever the active track's rubric carries such a category.
- **Facts unchanged ⇒ score barely moves.** A listing whose facts are the same as last run
  should shift by roughly the reweighting delta, never 40 points. A large swing with no new
  information is a bug, not a finding.
- **Never recast an existing highlight as a flag** without genuinely new adverse
  information, and never re-charge carried-forward diligence already priced into an
  earlier score.
- **Sanity-check the distribution before committing:** roughly 30–85 with real spread,
  several listings above 75, the best approaching 80+. If nothing clears 75, suspect a
  category is being systematically under-awarded — *unless* a category is genuinely capped
  across the whole board by missing information, which is a real and different situation.
  Run 8 topped out at 74 on the Houses track because not one house had a verified MLW
  depth, and dock is worth 22; that was honest scoring, not drift. Say which case it is in
  `runNote` rather than leaving the reader to guess.

## Verifying a change

```
NODE_PATH=/opt/node22/lib/node_modules node scripts/verify.js
```

Checks the data invariants (unique ids, no literal `</script>`, rubric totals 100, the
no-amenity score ceiling) and then drives the page in headless Chromium: the committed
data, every tile action, the priority and amenity filters and sorts, a bumped run number,
listings going pending/sold, **all** listings inactive, an empty listings array, absent
`amenities`/`rubric`, and hostile scraped text containing markup and ampersands.

Override `WF_INDEX` to check a different file and `WF_CHROME` if Chromium moves; it
currently lives at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
