# waterfront-tracker

A single-file dashboard tracking waterfront land and homes under $200k within ~3 hours of
Glen Allen, VA, for a build in 2–4 years. Land is the default; homes only qualify at
land value. Published at https://thgold-collab.github.io/waterfront-tracker/

Updated weekly by the `Waterfront deal scan v2` routine (Fridays ~7am ET), which commits
straight to `main`.

## Architecture

`index.html` is the whole thing — inline CSS and JS, no build step, no dependencies, no
external calls. All data lives in one place: the `<script id="state" type="application/json">`
block near the bottom. **That block is normally the only thing you edit.**

```
{ schema, runDate, runNumber, runLabel, runNote, priorityAreas, priorityLabel, criteria, listings[] }
```

Each listing: `id`, `name`, `region` (nn|es|lk), `water`, `type` (waterfront|access|home),
`price`, `priceWas` (ORIGINAL list price), `acres`, `score`, `drive` ("1h20"), `hoa`,
`firstSeen`, `firstSeenRun`, `status` (active|pending|sold|removed), `highlights[]`,
`flags[]`, `signals`, `url`.

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

## Network access

Listing sites are only reachable if the cloud environment's network access allows them.
Under **Trusted** (the default) every listing source is blocked and fetches fail with a
403 at the egress gateway — this is the environment's own policy, not the sites blocking
scrapers. Run 2 misattributed it to LandSearch; don't repeat that.

Diagnose with `curl -sS "$HTTPS_PROXY/__agentproxy/status"`, which lists recent policy
denials by host. Never route around a policy denial. If sources are blocked, say so in
`runNote` and in the summary, and do not present carried-forward figures as re-verified.

## Verifying a change

There is no test suite. Drive the page in headless Chromium before committing:

```
NODE_PATH=/opt/node22/lib/node_modules node -e "…require('playwright')…"
```

Chromium lives at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Worth covering:
the committed data, a bumped run number, listings going pending/sold, **all** listings
inactive, an empty listings array, and hostile scraped text containing markup and
ampersands. At minimum, confirm the state block still parses and the page still renders.
