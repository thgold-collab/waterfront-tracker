# waterfront-tracker

A single-file dashboard running **two parallel searches** for Ted, published at
https://thgold-collab.github.io/waterfront-tracker/

- **Land** — waterfront land and homes under $200k within ~3 hrs of Glen Allen, VA, for a
  build in 2–4 years. Land is the default; homes only qualify at land value.
- **Houses** — 3+ bed / 2+ bath houses from $350k to $700k up and down the Rappahannock
  and around the Potomac, under a 2-hour drive where possible. Waterfront preferred,
  near-water considered. Preferred towns: Urbanna, White Stone, Irvington, Kilmarnock,
  Tappahannock, Montross.

The two are independent: separate criteria, rubric, filters, sorts and preferred areas.
A track switcher above the tiles picks one.

Updated weekly by the `Waterfront deal scan v2` routine (Fridays ~7am ET), which commits
straight to `main`.

## Architecture

`index.html` is the whole thing — inline CSS and JS, no build step, no dependencies, no
external calls. All data lives in one place: the `<script id="state" type="application/json">`
block near the bottom. **That block is normally the only thing you edit.**

```
{ schema: 2, runDate, runNumber, runLabel, runNote, activeTrack, tracks[], listings[] }
```

Each track: `id`, `label`, `blurb`, `unit`, `listLabel`, `chips[]`, `criteria{}`,
`rubric[]`, `typeFilters[]`, `typeNames{}`, `sorts[]`, `priorityAreas[]`,
`priorityLabel`, `footnote`, `emptyMsg`. Everything the header, controls and footer show
comes from the active track — **there is no track-specific text left in the HTML.**

Each listing: `id`, `name`, `region` (nn|es|lk), `water`, `type` (waterfront|access|home),
`price`, `priceWas` (ORIGINAL list price), `acres`, `score`, `drive` ("1h20"), `hoa`,
`firstSeen`, `firstSeenRun`, `status` (active|pending|sold|removed), `highlights[]`,
`amenities[]` (optional), `flags[]`, `signals`, `url`, and **`track`** (`land`|`house`;
absent means `land`).

House listings additionally carry `beds`, `baths`, `sqft`, `yearBuilt` and `dock` (a
short string, or `true`). `dock` drives a badge, a summary tile and a filter.

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

## Priority areas

`priorityAreas` (currently `["Cape Charles","Bay Creek"]`) is matched case-insensitively
against each listing's `name` and `water`. Matches get a star badge, a left rule, a filter
chip and a "priority areas first" sort. New listings in those areas inherit the flag
automatically — do not hand-tag them. `listing.priority === true` forces it on.

These areas get deeper diligence than anywhere else. Open questions: Bay Creek POA
assessment vs. optional-or-mandatory club membership and the real annual carry; tidal
frontage vs. resort amenity pond (Crystal Lake is a pond); Kings Creek frontage character
and MLW depth; lot elevation vs. BFE. Cape Charles sits ~3 ft with most developed land at
5–10 ft, and Northampton County requires a sealed flood elevation certificate, with V-zone
plans sealed by a Virginia-licensed architect or engineer.

## Amenities — recorded, not scored

**As of run 7 amenities earn no points.** Ted asked for them out of the scoring, so the
Land rubric returned to its pre-run-5 weights (price 30 / buildability 25 / water access
20 / hold-and-build fit 15 / deal signals 10). Keep populating `amenities[]` — it still
drives the card line, the count badge, a filter chip and a sort, and the research is
worth having — but do not award points for it, and do not reinstate the category without
being asked. The history below is kept because it explains the shape of the data.

## Amenities history — there were two buyers

Ted optimises for land value, buildability and real boating water. His wife rates the
lifestyle of an amenity community (Bay Creek being the reference) very highly: pool and
clubhouse, golf, beach and trails. Both count, and a lot strong on only one axis is
weaker than its number suggests.

Run 5 made amenities worth 20 of 100, funded mainly by dropping hold-and-build
fit from 15 to 10. Run 7 removed that weighting again. That category penalised HOA and club dues, so an amenity-rich
community was charged twice — once for the cost, with no credit for what it buys.

Rank amenity quality: pool/clubhouse first, then golf, then beach and trails, then
everything else. **A marina, boat ramp or deeded slip is not an amenity here** — water
access quality already scores those, and counting them in both places inflates every
community with a dock.

`amenities[]` holds short plain-text items and drives a line on the card, a count badge,
a filter chip and a sort. Populate it only from what a listing or the community's own
materials state. Omit the field entirely for an unresearched community — that is
different from having no amenities, and a keyword sweep is not good enough: it tags
`nn-haven-beach-*` off a road name and `nn-buzzard-point` off a nearby *public* beach.

## Network access

Listing sites are only reachable if the cloud environment's network access allows them.
Under **Trusted** (the default) every listing source is blocked and fetches fail with a
403 at the egress gateway — this is the environment's own policy, not the sites blocking
scrapers. Run 2 misattributed it to LandSearch; don't repeat that.

Diagnose with `curl -sS "$HTTPS_PROXY/__agentproxy/status"`, which lists recent policy
denials by host. Never route around a policy denial. If sources are blocked, say so in
`runNote` and in the summary, and do not present carried-forward figures as re-verified.

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
- **Sanity-check the distribution before committing:** roughly 30–85, several listings
  above 75, the best approaching 80+. If nothing clears 75, a category is being
  systematically under-awarded.

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
