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
  const badNew = st.listings.filter(x => x.firstSeenRun === st.runNumber && !x.firstSeen);
  check('active track is a declared track', trackIds.has(track.id), true);
  check('listings new this run carry firstSeen', badNew.length, 0);
  console.log();

  const { page, errs } = await open(browser, SRC);
  console.log('=== render + run metadata ===');
  check('console/page errors', errs.length, 0);
  errs.forEach(e => console.log('     ' + e));
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
    check('switching back restores the original track', await page.locator('.card').count(), N);
  }

  console.log('\n=== tiles are interactive ===');
  check('total tiles', await page.locator('.tile').count(), 4);
  check('actionable tiles are buttons', await page.locator('button.tile').count(), 4);
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
  const cheapTile = page.locator('button.tile').nth(3);
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
  await page.locator('button.tile').nth(1).click();
  await page.waitForTimeout(300);
  const topName = (await page.locator('button.tile').nth(1).locator('.d').textContent()).trim();
  check('flashed card is the top scorer', (await page.locator('.card.flash h3 a').textContent()).startsWith(topName), true);

  console.log('\n=== tile: "show all" resets everything ===');
  await page.click('#typeFilters button[data-t="home"]');
  await page.locator('button.tile[data-action="cuts"]').click();
  await page.locator('button.tile[data-action="all"]').click();
  check('all filters cleared', await page.locator('.card').count(), N);
  check('type buttons re-synced', await page.locator('#typeFilters button.on').getAttribute('data-t'), 'all');

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

  console.log('\n=== rubric rendered from data ===');
  const rub = await page.locator('#rubric').textContent();
  console.log('     ' + rub.trim());
  check('every category present', track.rubric.every(r => rub.includes(r.label)), true);
  check('rubric totals 100', track.rubric.reduce((a, r) => a + r.pts, 0), 100);

  console.log('\n=== sort: most amenities first ===');
  await page.selectOption('#sortSel', 'amenities');
  const best = amList.reduce((a, b) => b.amenities.length > a.amenities.length ? b : a);
  check('first card is the most-amenitied listing', await page.locator('.card').first().getAttribute('data-id'), best.id);
  await page.selectOption('#sortSel', 'score');

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

  const fHostile = variant('r-hostile.html', s => {
    s.runNote = 'note <b>x</b> & "q"';
    s.listings = [{
      track: s.activeTrack, id: 'x<y', name: 'Cape Charles <img src=x onerror=alert(1)> & "q" Rd', region: 'es',
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
  check('name literal', await rH.page.locator('.card h3 a').textContent(), 'Cape Charles <img src=x onerror=alert(1)> & "q" Rd');
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
