const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const os = require('os');

// Run from anywhere:  NODE_PATH=/opt/node22/lib/node_modules node scripts/verify.js
const SRC = process.env.WF_INDEX || path.join(__dirname, '..', 'index.html');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-verify-'));
const CHROME = process.env.WF_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const STATE_RE = /(<script id="state" type="application\/json">)([\s\S]*?)(<\/script>)/;

let fails = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}
function variant(name, mutate) {
  const html = fs.readFileSync(SRC, 'utf8');
  const st = JSON.parse(html.match(STATE_RE)[2]);
  mutate(st);
  const json = JSON.stringify(st);
  if (json.includes('</script>')) throw new Error('test data would break the script block');
  const out = path.join(TMP, name);
  fs.writeFileSync(out, html.replace(STATE_RE, (_, a, __, c) => a + json + c));
  return out;
}
async function open(browser, file, waitFor = '.card') {
  const page = await browser.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto('file://' + file);
  if (waitFor) await page.waitForSelector(waitFor);
  return { page, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const st = JSON.parse(fs.readFileSync(SRC, 'utf8').match(STATE_RE)[2]);
  const TRACKS = st.tracks || [{ id: 'land', rubric: st.rubric || [], priorityAreas: st.priorityAreas || [] }];
  const track = TRACKS.find(t => t.id === st.activeTrack) || TRACKS[0];
  const L = st.listings.filter(x => (x.track || 'land') === track.id);   // active track only
  const N = L.length;
  const nCuts = L.filter(x => x.priceWas).length;
  const dmin = d => { const m = String(d).match(/(\d+)h(\d+)/); return m ? (+m[1]) * 60 + (+m[2]) : 999; };
  const bandOf = t => ((t.criteria || {}).driveBandMins || null);
  const inBandOf = (t, x) => { const b = bandOf(t); if (!b) return true; const m = dmin(x.drive); return m !== 999 && m >= b[0] && m <= b[1]; };
  const nBand = L.filter(x => inBandOf(track, x)).length;
  // The drive band can start switched on, so "every card renders" is not the opening
  // state. Tests that need the full set clear it first.
  const clearBand = async page => {
    const b = page.locator('#nearFilter button');
    if (await b.count() && (await b.getAttribute('aria-pressed')) === 'true') await b.click();
  };
  const priAreas = (track.priorityAreas || []).map(s => s.toLowerCase());
  const priList = L.filter(x => priAreas.some(p => ((x.name || '') + ' ' + (x.water || '')).toLowerCase().includes(p)));
  console.log(`base: ${st.listings.length} listings across ${TRACKS.length} track(s); active "${track.id}" has ${N}, run ${st.runNumber}, ${nCuts} with cuts, ${priList.length} in priority areas`);
  priList.forEach(x => console.log(`      priority: ${x.name}`));
  console.log();

  console.log('=== data invariants ===');
  const ids = st.listings.map(x => x.id);
  check('ids unique', ids.length, new Set(ids).size);
  check('no literal </script> in data', JSON.stringify(st).includes('</' + 'script>'), false);
  TRACKS.forEach(t => check(`track "${t.id}" rubric totals 100`, (t.rubric || []).reduce((a, r) => a + r.pts, 0), 100));
  TRACKS.forEach(t => { const b = (t.criteria || {}).driveBandMins; if (b) {
    check(`track "${t.id}" drive band is [lo, hi] with lo < hi`, Array.isArray(b) && b.length === 2 && b[0] < b[1], true);
    check(`track "${t.id}" has listings inside its band`, st.listings.filter(x => (x.track || 'land') === t.id && inBandOf(t, x)).length > 0, true);
  } });
  const badDrive = st.listings.filter(x => x.drive && !/^\d+h\d\d$/.test(x.drive));
  check('every drive time parses as NhMM', badDrive.length, 0);
  badDrive.forEach(x => console.log('     ' + x.id + ': ' + x.drive));
  const trackIds = new Set(TRACKS.map(t => t.id));
  const orphan = st.listings.filter(x => !trackIds.has(x.track || 'land'));
  check('every listing belongs to a declared track', orphan.length, 0);
  const amPts = ((track.rubric || []).find(r => /amenit/i.test(r.label)) || {}).pts || 0;
  // A listing with no amenities[] forfeits that whole category, so its ceiling is
  // 100 - amenityPoints. Scoring above it means the score and the data disagree.
  const ceiling = 100 - amPts;
  const overCeiling = amPts ? L.filter(x => !(x.amenities || []).length && x.score > ceiling) : [];
  check(`no-amenity listings stay at or below the ${ceiling} ceiling`, overCeiling.length, 0);
  overCeiling.forEach(x => console.log(`     over by ${x.score - ceiling}: ${x.score} ${x.name}`));
  // --- status provenance (added after run 8 carried a house that had sold 11 weeks earlier) ---
  const soldNoDate = st.listings.filter(x => x.status === 'sold' && !x.soldOn);
  check('every sold listing records soldOn', soldNoDate.length, 0);
  soldNoDate.forEach(x => console.log('     missing soldOn: ' + x.name));

  const urls = st.listings.map(x => x.url).filter(Boolean);
  const dupUrl = [...new Set(urls.filter((u, i) => urls.indexOf(u) !== i))];
  check('no two listings share a source URL', dupUrl.length, 0);
  dupUrl.forEach(u => console.log('     shared by ' + urls.filter(v => v === u).length + ': ' + u));

  const badDate = st.listings.filter(x => x.statusAsOf &&
    (isNaN(new Date(x.statusAsOf + 'T12:00:00')) || x.statusAsOf > st.runDate));
  check('statusAsOf parses and is not in the future', badDate.length, 0);
  badDate.forEach(x => console.log('     bad statusAsOf ' + x.statusAsOf + ': ' + x.name));

  // Ratchet: anything this run touched must carry provenance. Older rows are grandfathered
  // but counted out loud, so the backlog cannot quietly become permanent.
  const touchedNoProv = st.listings.filter(x => x.firstSeenRun === st.runNumber && !x.statusAsOf);
  check('listings touched this run carry statusAsOf', touchedNoProv.length, 0);
  touchedNoProv.forEach(x => console.log('     no statusAsOf: ' + x.name));

  const activeAll = st.listings.filter(x => x.status === 'active');
  const unverified = activeAll.filter(x => !x.statusAsOf);
  console.log(`     BACKLOG: ${unverified.length} of ${activeAll.length} active listings have never had their status verified`);

  const badNew = st.listings.filter(x => x.firstSeenRun === st.runNumber && !x.firstSeen);
  check('active track is a declared track', trackIds.has(track.id), true);
  check('listings new this run carry firstSeen', badNew.length, 0);
  console.log();

  const { page, errs } = await open(browser, SRC);
  console.log('=== render + run metadata ===');
  check('console/page errors', errs.length, 0);
  errs.forEach(e => console.log('     ' + e));
  if (bandOf(track) && (track.criteria || {}).driveBandDefault) {
    const b = bandOf(track);
    check('drive band starts switched on', await page.locator('#nearFilter button').getAttribute('aria-pressed'), 'true');
    check(`opening view is the ${b[0]}-${b[1]} min band`, await page.locator('.card').count(), nBand);
    check('listHead says the band is applied', (await page.locator('#listHead').textContent()).includes(`${b[0]}-${b[1]} min drive only`), true);
    await clearBand(page);
  }
  check('cards', await page.locator('.card').count(), N);
  check('subtitle shows run number from data', (await page.locator('header .sub').textContent()).includes('Run ' + st.runNumber), true);
  check('subtitle label from data', (await page.locator('header .sub').textContent()).includes(st.runLabel), true);
  check('run note rendered from data', (await page.locator('#runnote').textContent()).startsWith('Run ' + st.runNumber + ' note:'), true);
  check('"New this run" badges match firstSeenRun', await page.locator('.badge.new').count(), L.filter(x => x.firstSeenRun === st.runNumber).length);

  if (TRACKS.length > 1) {
    console.log('\n=== track switching ===');
    const other = TRACKS.find(t => t.id !== track.id);
    check('a button per track', await page.locator('#trackSwitch button').count(), TRACKS.length);
    check('active track is pressed', await page.locator('#trackSwitch button[aria-pressed="true"]').count(), 1);
    check('criteria chips come from the track', await page.locator('#criteria span').count(), (track.chips || []).length);
    await page.click(`#trackSwitch button[data-track="${other.id}"]`);
    const otherL = st.listings.filter(x => (x.track || 'land') === other.id);
    check(`switching to "${other.id}" shows its listings`, await page.locator('.card').count(), otherL.length);
    if (!otherL.length) check('empty track shows an empty-state message', await page.locator('.empty').count(), 1);
    check('chips swapped to the new track', await page.locator('#criteria span').count(), (other.chips || []).length);
    check('rubric swapped to the new track', (await page.locator('#rubric').textContent()).includes(other.rubric[0].label), true);
    check('type filters swapped', await page.locator('#typeFilters button').count(), (other.typeFilters || []).length);
    check('sorts swapped', await page.locator('#sortSel option').count(), (other.sorts || []).length);
    await page.click(`#trackSwitch button[data-track="${track.id}"]`);
    await clearBand(page);
    check('switching back restores the original track', await page.locator('.card').count(), N);
  }

  console.log('\n=== tiles are interactive ===');
  // Baseline is 4 (all / top score / cuts / cheapest true waterfront); a "with a dock
  // or slip" tile joins them whenever the active track has dock data (CLAUDE.md: dock
  // drives a badge, a summary tile and a filter) — tile count isn't fixed per track.
  const activeL = L.filter(x => x.status === 'active');
  const dockCount = activeL.filter(x => !!x.dock).length;
  const unverifiedCount = activeL.filter(x => !x.statusAsOf ||
    Math.round((new Date(st.runDate + 'T12:00:00') - new Date(x.statusAsOf + 'T12:00:00')) / 86400000) > 14).length;
  const wantTiles = [track.unit || 'candidates on watchlist', 'top score', 'with price cuts', 'cheapest true waterfront'];
  if (dockCount) wantTiles.push('with a dock or slip');
  if (unverifiedCount && unverifiedCount < activeL.length + 1) wantTiles.push('status unverified');
  const gotTiles = (await page.locator('.tile .l').allTextContents()).map(t => t.trim());
  check('tile inventory matches the data', JSON.stringify(gotTiles.slice().sort()), JSON.stringify(wantTiles.slice().sort()));
  check('every tile is actionable', await page.locator('button.tile').count(), gotTiles.length);
  const labels = await page.locator('button.tile').evaluateAll(ns => ns.map(n => n.dataset.action + ':' + n.querySelector('.go').textContent.trim()));
  labels.forEach(l => console.log('     ' + l));

  console.log('\n=== tile: "with price cuts" filters ===');
  const cutsTile = page.locator('button.tile[data-action="cuts"]');
  check('starts unpressed', await cutsTile.getAttribute('aria-pressed'), 'false');
  await cutsTile.click();
  check('filters to cut listings only', await page.locator('.card').count(), nCuts);
  check('now pressed', await cutsTile.getAttribute('aria-pressed'), 'true');
  check('every shown card has a cut', await page.locator('.card .cut').count(), nCuts);
  check('listHead notes the filter', (await page.locator('#listHead').textContent()).includes('price cuts only'), true);
  check('tile CTA flips to clear', (await cutsTile.locator('.go').textContent()).includes('Clear'), true);
  await cutsTile.click();
  check('toggles back off', await page.locator('.card').count(), N);

  console.log('\n=== tile: "cheapest true waterfront" jumps to listing ===');
  // Selected by label, not position: the dock tile (when present) sits between "top
  // score" and "with price cuts", shifting this tile's index depending on the track.
  const cheapTile = page.locator('button.tile').filter({ has: page.locator('.l', { hasText: 'cheapest true waterfront' }) });
  const cheapName = (await cheapTile.locator('.d').textContent()).trim();
  await page.click('#regionFilters button[data-r="lk"]');       // filter it out of view first
  check('pre-jump: cheapest not in list', await page.locator(`.card:has-text("${cheapName}")`).count(), 0);
  await cheapTile.click();
  await page.waitForTimeout(300);
  check('jump cleared the region filter', await page.locator('.card').count(), N);
  const flashed = page.locator('.card.flash');
  check('exactly one card flashed', await flashed.count(), 1);
  check('flashed card is the cheapest waterfront', (await flashed.locator('h3 a').textContent()).startsWith(cheapName), true);
  check('region buttons re-synced to All', await page.locator('#regionFilters button.on').getAttribute('data-r'), 'all');

  console.log('\n=== tile: "top score" jumps ===');
  const topTile = page.locator('button.tile').filter({ has: page.locator('.l', { hasText: 'top score' }) });
  const topName = (await topTile.locator('.d').textContent()).trim();
  await topTile.click();
  await page.waitForTimeout(300);
  check('flashed card is the top scorer', (await page.locator('.card.flash h3 a').textContent()).startsWith(topName), true);

  console.log('\n=== tile: "show all" resets everything ===');
  // Pick any non-"all" type filter from the active track rather than a hardcoded
  // value ("home" only exists on the land track's typeFilters, not house's).
  const someType = (track.typeFilters || []).map(t => t.v).find(v => v !== 'all');
  await page.click(`#typeFilters button[data-t="${someType}"]`);
  await page.locator('button.tile[data-action="cuts"]').click();
  await page.locator('button.tile[data-action="all"]').click();
  check('all filters cleared', await page.locator('.card').count(), N);
  check('type buttons re-synced', await page.locator('#typeFilters button.on').getAttribute('data-t'), 'all');

  if (bandOf(track)) {
    const b = bandOf(track);
    console.log(`\n=== drive band filter (${b[0]}-${b[1]} min) ===`);
    const btn = page.locator('#nearFilter button');
    check('chip shows the live in-band count', (await btn.textContent()).includes('(' + nBand + ')'), true);
    await btn.click();
    check('filters to in-band listings', await page.locator('.card').count(), nBand);
    check('pressed state set', await btn.getAttribute('aria-pressed'), 'true');
    const shown = await page.locator('.card .drive, .card').evaluateAll(ns => ns.length);
    check('something is still shown', shown > 0, true);
    await btn.click();
    check('toggles back off', await page.locator('.card').count(), N);
    // "Show all" must beat a default-on filter or there is no way back to the full board
    await btn.click();
    await page.locator('button.tile[data-action="all"]').click();
    check('"Show all" clears the band filter too', await page.locator('.card').count(), N);
    check('band chip unpressed after Show all', await btn.getAttribute('aria-pressed'), 'false');
  }

  console.log('\n=== priority areas (Cape Charles / Bay Creek) ===');
  check('priority badges on cards', await page.locator('.badge.priority').count(), priList.length);
  check('priority cards visually marked', await page.locator('.card.priority').count(), priList.length);
  const priBtn = page.locator('#priorityFilter button');
  check('priority button shows count', (await priBtn.textContent()).includes(`(${priList.length})`), true);
  await priBtn.click();
  check('filters to priority listings', await page.locator('.card').count(), priList.length);
  check('all shown are priority', await page.locator('.card.priority').count(), priList.length);
  check('listHead notes it', (await page.locator('#listHead').textContent()).includes('priority areas only'), true);
  await priBtn.click();
  check('toggles off', await page.locator('.card').count(), N);

  console.log('\n=== sort: priority first ===');
  await page.selectOption('#sortSel', 'priority');
  const firstFive = await page.locator('.card').evaluateAll((ns, n) => ns.slice(0, n).map(c => c.classList.contains('priority')), priList.length);
  check('top N cards are all priority', firstFive.every(Boolean), true);
  await page.selectOption('#sortSel', 'score');

  await page.setViewportSize({ width: 1120, height: 1500 });
  await page.screenshot({ path: path.join(TMP, 'tracker.png') });

  console.log('\n=== amenities ===');
  const amList = L.filter(x => (x.amenities || []).length);
  console.log(`     ${amList.length} listings carry amenities`);
  if (amList.length) {
    check('amenity chip shows live count', (await page.locator('#amenityFilter button').textContent()).includes(`(${amList.length})`), true);
    check('amenity lines rendered', await page.locator('.card .amen').count(), amList.length);
    check('amenity badges rendered', await page.locator('.badge.amenity').count(), amList.length);
    const amBtn = page.locator('#amenityFilter button');
    await amBtn.click();
    check('filters to amenity communities', await page.locator('.card').count(), amList.length);
    check('listHead notes it', (await page.locator('#listHead').textContent()).includes('amenity communities only'), true);
    check('pressed state set', await amBtn.getAttribute('aria-pressed'), 'true');
    await amBtn.click();
    check('toggles off', await page.locator('.card').count(), N);
  } else {
    // No amenities on this track's active listings (e.g. the Houses track, which
    // never carries amenities data) -- the chip should be absent, not empty.
    check('no amenities on this track: chip hidden entirely', await page.locator('#amenityFilter button').count(), 0);
  }

  console.log('\n=== rubric rendered from data ===');
  const rub = await page.locator('#rubric').textContent();
  console.log('     ' + rub.trim());
  check('every category present', track.rubric.every(r => rub.includes(r.label)), true);
  check('rubric totals 100', track.rubric.reduce((a, r) => a + r.pts, 0), 100);

  if (amList.length && (track.sorts || []).some(s => s.v === 'amenities')) {
    console.log('\n=== sort: most amenities first ===');
    await page.selectOption('#sortSel', 'amenities');
    const best = amList.reduce((a, b) => b.amenities.length > a.amenities.length ? b : a);
    check('first card is the most-amenitied listing', await page.locator('.card').first().getAttribute('data-id'), best.id);
    await page.selectOption('#sortSel', 'score');
  }

  console.log('\n=== degrades when the new fields are absent ===');
  const rNoAm = await open(browser, variant('r-noam.html', s2 => { s2.listings.forEach(x => { delete x.amenities; }); }));
  check('no amenities: no errors', rNoAm.errs.length, 0);
  check('no amenities: no lines', await rNoAm.page.locator('.card .amen').count(), 0);
  check('no amenities: chip hidden entirely', await rNoAm.page.locator('#amenityFilter button').count(), 0);
  const rNoRub = await open(browser, variant('r-norub.html', s2 => { s2.tracks.forEach(t => { delete t.rubric; }); }));
  check('no rubric: no errors', rNoRub.errs.length, 0);
  check('no rubric: paragraph hidden', await rNoRub.page.evaluate(() => getComputedStyle(document.getElementById('rubric')).display), 'none');
  check('no rubric: paragraph renders no text', (await rNoRub.page.locator('#rubric').textContent()).trim(), '');

  console.log('\n=== regressions: guards + escaping still hold ===');
  const fAllSold = variant('r-allsold.html', s => { s.listings.forEach(x => { x.status = 'sold'; }); });
  const rA = await open(browser, fAllSold);
  check('all-inactive does not throw', rA.errs.length, 0);
  rA.errs.forEach(e => console.log('     ' + e));

  const fEmpty = variant('r-empty.html', s => { s.listings = []; });
  const rE = await open(browser, fEmpty, '.tile');
  check('empty list does not throw', rE.errs.length, 0);
  check('empty list: priority chip hidden rather than showing (0)', await rE.page.locator('#priorityFilter button').count(), 0);
  check('empty list: empty-state message shown', await rE.page.locator('.empty').count(), 1);

  // Use the active track's own first priority area so this listing actually
  // matches as priority regardless of which track is active ("Cape Charles" is
  // land-only; it wouldn't match while the Houses track, with its own preferred
  // towns, is active).
  const priNeedle = (track.priorityAreas || [])[0] || 'Cape Charles';
  const fHostile = variant('r-hostile.html', s => {
    s.runNote = 'note <b>x</b> & "q"';
    s.listings = [{
      track: s.activeTrack, id: 'x<y', name: priNeedle + ' <img src=x onerror=alert(1)> & "q" Rd', region: 'es',
      water: 'Creek <b>b</b> & wide', type: 'waterfront', price: 1e5, priceWas: 15e4, acres: 1,
      score: 50, drive: '1h00', hoa: 'A & B', firstSeen: '2026-08-01', firstSeenRun: 3,
      status: 'active', highlights: ['h <i>i</i> & m'], flags: ['f <u>u</u> & y'],
      amenities: ['Pool <b>x</b> & spa', 'Golf <i>y</i>'],
      signals: 's & <span>s</span>', url: 'https://example.com/?a=1&b=2'
    }];
  });
  const rH = await open(browser, fHostile);
  check('hostile data does not throw', rH.errs.length, 0);
  rH.errs.forEach(e => console.log('     ' + e));
  check('no injected elements', await rH.page.locator('.card img, .card script').count(), 0);
  check('name literal', await rH.page.locator('.card h3 a').textContent(), priNeedle + ' <img src=x onerror=alert(1)> & "q" Rd');
  check('hostile listing matched as priority', await rH.page.locator('.card.priority').count(), 1);
  check('amenity text escaped', (await rH.page.locator('.card .amen').textContent()).includes('Pool <b>x</b> & spa'), true);
  check('no elements injected via amenities', await rH.page.locator('.card .amen *').count(), 1);
  // id contains "<" — focus uses CSS.escape, so the jump must still resolve
  await rH.page.locator('button.tile[data-action="focus"]').first().click();
  await rH.page.waitForTimeout(250);
  check('focus works with an id containing markup chars', await rH.page.locator('.card.flash').count(), 1);

  await browser.close();
  console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
  process.exit(fails ? 1 : 0);
})();
