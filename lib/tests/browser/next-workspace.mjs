import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TPW_BROWSER_URL || 'http://localhost:3000';
// Filled from the editor just before submitting, so the payload is compared against the values
// the inputs actually showed rather than against numbers repeated in the test.
const shownSites = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
try {
  const page = await browser.newPage();
  const org = { id: 'org-2', name: 'Org 2' };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace(/\/$/, '').split('/').at(-1);
    if (endpoint === 'dashboard') {
      assert.equal(url.searchParams.get('org'), org.id);
      return route.fulfill({ json: { org, orgs: [org], submissions: [] } });
    }
    if (endpoint === 'programs') {
      assert.equal(url.searchParams.get('org'), org.id);
      return route.fulfill({ json: { items: [], count: 0, total: 0, offset: 0, page: 1, pages: 1 } });
    }
    if (endpoint === 'submissions' && route.request().method() === 'GET') {
      assert.equal(url.searchParams.get('org'), org.id);
      if (url.searchParams.get('detail')) return route.fulfill({ json: { programs: [] } });
      return route.fulfill({ json: {
        count: 1, total: 1, page: 1, pages: 1, offset: 0,
        items: [{
          key: '["org-2",2026,1]', organization: org.name,
          reportingPeriod: { year: 2026, quarter: 1, inferred: false },
          submittedAt: '2026-02-01T00:00:00.000Z',
          metrics: { programs: 1, participants: 0, completed: 0, hours: 0 }, facilities: 1
        }],
        totals: { programs: 1, participants: 0, completed: 0, hours: 0 },
        years: [2026]
      } });
    }
    if (endpoint === 'submissions' && route.request().method() === 'POST') {
      const { id, submission } = route.request().postDataJSON();
      assert.equal(submission.orgId, org.id);
      // Both ticked yards are in the payload with the numbers their inputs showed.
      assert.deepEqual(submission.programs[0].sites, shownSites);
      // The prisons array is derived from the programs' assignments, not chosen up front.
      assert.deepEqual(submission.prisons, [{ code: 'CCI', name: 'California Correctional Institution (CCI)', yards: ['A Yard', 'B Yard'] }]);
      assert.deepEqual(submission.programs[0].assignments, [{ code: 'CCI', yards: ['A Yard', 'B Yard'] }]);
      return route.fulfill({ json: { id } });
    }
    return route.abort();
  });

  for (const oldPath of ['/dashboard/', '/intake/simple.html/', '/team-dashboard/programs.html/', '/form-demo/']) {
    assert.equal((await page.request.get(base + oldPath)).status(), 404, oldPath);
  }
  await page.goto(base + '/');
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/sign-in/');
  const websiteLinks = [
    ['Our Members', 'https://www.thetpw.org/our-members'],
    ['Our Story', 'https://www.thetpw.org/ourstory'],
    ['Our Work', 'https://www.thetpw.org/ourwork'],
    ['Our Team', 'https://www.thetpw.org/our-team'],
  ];
  function mainNav() { return page.getByRole('navigation', { name: 'Main navigation', exact: true }); }
  async function checkPublicLinks() {
    const nav = mainNav();
    for (const [label, href] of websiteLinks) {
      const link = nav.getByRole('link', { name: label, exact: true });
      assert.equal(await link.getAttribute('href'), href);
      assert.equal(await link.getAttribute('aria-current'), null);
      assert(await link.isVisible());
    }
    assert.equal(await page.getByRole('link', { name: 'TPW home', exact: true }).getAttribute('href'), 'https://www.thetpw.org/');
    assert.equal(await nav.getByRole('link', { name: 'Account', exact: true }).count(), 0, 'there is no separate Account entry');
    assert.equal(await nav.locator('a.login, button.login').count(), 1, 'one member entry point');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  async function checkSignedOutHeader() {
    await checkPublicLinks();
    const nav = mainNav();
    const portal = nav.getByRole('link', { name: 'Member Portal', exact: true });
    assert.equal(await portal.getAttribute('href'), '/sign-in/');
    assert.equal(await nav.locator('[aria-current]').count(), 0);
    assert.equal((await portal.evaluate(link => getComputedStyle(link).textDecorationLine)).includes('underline'), false);
  }
  async function checkSignedInHeader(width) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + '/team-dashboard/#org-2');
    await page.locator('nav[aria-label="Main navigation"] [aria-current]').waitFor();
    await checkPublicLinks();
    const nav = mainNav();
    const portal = nav.getByRole('link', { name: 'Member Portal', exact: true });
    assert.equal(await portal.getAttribute('href'), '/team-dashboard/member-portal/#org-2');
    assert.equal(await portal.getAttribute('aria-current'), 'location');
    assert.equal(await nav.locator('[aria-current]').count(), 1, 'only the portal marks your location');
    assert((await portal.evaluate(link => getComputedStyle(link).textDecorationLine)).includes('underline'), 'the active portal is underlined');
    assert.equal(await page.getByRole('dialog').count(), 0, 'no side drawer: the portal is a page');
  }
  async function checkPortalPage() {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await mainNav().getByRole('link', { name: 'Member Portal', exact: true }).click();
    await page.waitForURL('**/team-dashboard/member-portal/**');
    assert.equal(await page.getByRole('heading', { level: 1, name: 'Member Portal' }).isVisible(), true);
    for (const id of ['initiatives', 'resources', 'announcements', 'help']) {
      assert.equal(await page.locator('#' + id).isVisible(), true, id);
    }
    assert.equal(await page.locator('#resources a').count() >= 5, true, 'resource links are present');
    assert.equal(await page.getByRole('link', { name: /membership@thetpw\.org/ }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Sign out' }).isVisible(), true);
    assert.equal(await page.getByRole('link', { name: 'AB 581 Clearance Reporting Form' }).getAttribute('href'), 'https://forms.gle/6V48HgrJC8e3Xqja7');
    await page.setViewportSize({ width: 390, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'portal reflows on a phone');
    await page.setViewportSize({ width: 1280, height: 1000 });
    assert.equal(await page.getByRole('navigation', { name: 'Member navigation' }).getByRole('link', { name: 'Portal' }).getAttribute('aria-current'), 'page');
    await page.goto(base + '/log-data/?account=org-2');
    await page.getByRole('heading', { name: 'Reporting period', exact: true }).waitFor();
  }
  for (const width of [1280, 390]) await checkSignedInHeader(width);
  await checkPortalPage();
  // One page: no chooser, and every section is visible from the start.
  assert.equal(await page.getByRole('button', { name: 'Use previous entries' }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'What would you like to do?' }).count(), 0);
  await page.getByRole('heading', { name: 'Reporting period', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Facilities and yards', exact: true }).count(), 0, 'no separate facilities section');
  await page.getByRole('heading', { name: 'Programs', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Submit', exact: true }).waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  // Programs come first: the facility is chosen inside the program editor, not in a section above.
  await page.getByRole('button', { name: 'Add a program' }).click();
  await page.getByLabel('Program name').fill('Browser test program');
  await page.getByLabel('Schedule status').selectOption('Planned');
  await page.locator('#program-facility').selectOption('CCI');
  // A facility with nothing ticked still says why “Done with program” is disabled.
  const done = page.getByRole('button', { name: 'Done with program' });
  assert.equal(await done.isDisabled(), true);
  assert.equal(await done.getAttribute('aria-describedby'), 'program-counts-empty');
  assert.equal(await page.locator('#program-counts-empty').isVisible(), true, 'the empty-state reason is on screen');
  // No separate “Participants at each yard” block: each yard's numbers sit on its own row.
  assert.equal(await page.getByRole('heading', { name: 'Participants at each yard', exact: true }).count(), 0);
  const facility = code => page.locator(`.facility-row[data-facility="${code}"]`);
  const tick = (code, name) => facility(code).getByRole('checkbox', { name, exact: true });
  const yardRow = (code, name) => facility(code).locator('.yard-number-row').filter({ has: page.getByRole('checkbox', { name, exact: true }) });
  const enrolled = row => row.getByLabel('Participants enrolled', { exact: true });
  const completed = row => row.getByLabel('Completed', { exact: true });
  await tick('CCI', 'A Yard').check();
  await tick('CCI', 'B Yard').check();
  const first = yardRow('CCI', 'A Yard'), second = yardRow('CCI', 'B Yard');
  // A second facility is on screen while the first facility is typed into, and never inherits
  // its numbers: carry-forward is one facility's business.
  await page.locator('#program-facility').selectOption('CHCF');
  await tick('CHCF', 'A Yard').check();
  // Carry-forward: the first ticked row fills the other ticked rows that are still empty, and
  // keeps them following as the member keeps typing.
  await enrolled(first).click();
  await enrolled(first).pressSequentially('1');
  assert.equal(await enrolled(second).inputValue(), '1', 'the first yard carries its enrollment forward');
  await enrolled(first).pressSequentially('2');
  assert.equal(await enrolled(second).inputValue(), '12', 'a carried box follows the template while it stays a mirror');
  assert.equal(await enrolled(yardRow('CHCF', 'A Yard')).inputValue(), '', 'carry-forward never crosses facilities');
  // A number typed in the second row does not travel back to the first, and never overwrites.
  await completed(second).fill('5');
  assert.equal(await completed(first).inputValue(), '', 'the second row leaves the first row alone');
  await enrolled(second).fill('9');
  assert.equal(await enrolled(first).inputValue(), '12', 'editing the second row does not overwrite the first');
  await enrolled(first).fill('14');
  assert.equal(await enrolled(second).inputValue(), '9', 'a filled box is never overwritten by carry-forward');
  await completed(first).fill('3');
  assert.equal(await completed(second).inputValue(), '5', 'completions keep their own values');
  // A row that is not ticked has no numbers to fill in, and unticking clears the ones it had.
  await tick('CCI', 'C Yard').check();
  await enrolled(yardRow('CCI', 'C Yard')).fill('7');
  assert.equal(await enrolled(first).inputValue(), '14', 'a later row never rewrites an earlier one');
  await tick('CCI', 'C Yard').uncheck();
  assert.equal(await enrolled(yardRow('CCI', 'C Yard')).inputValue(), '', 'unticking clears the row’s numbers');
  assert.equal(await enrolled(yardRow('CCI', 'C Yard')).isDisabled(), true, 'unticking disables the row’s numbers');
  // Back to the one facility the payload is about.
  await facility('CHCF').getByRole('button', { name: /^Remove California Health Care Facility/ }).click();
  // Every ticked yard is one row, with its two numbers beside the yard name.
  const layout = await first.evaluate(row => {
    const boxes = [...row.querySelectorAll('input[type="number"]')];
    return {
      top: row.getBoundingClientRect().top,
      beside: boxes.every(box => box.getBoundingClientRect().left > row.querySelector('.yard-number-pick').getBoundingClientRect().right),
      enabled: boxes.every(box => !box.disabled)
    };
  });
  assert.equal(layout.beside, true, 'the numbers sit beside the yard name');
  assert.equal(layout.enabled, true, 'a ticked yard’s numbers are editable');
  assert.equal(await second.evaluate((row, firstTop) => row.getBoundingClientRect().top > firstTop, layout.top), true, 'each yard gets its own row');
  await page.setViewportSize({ width: 390, height: 1000 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the editor reflows on a phone');
  await page.setViewportSize({ width: 1280, height: 1000 });
  // The payload carries what the boxes showed, read from the boxes themselves.
  for (const [yard, row] of [['A Yard', first], ['B Yard', second]]) {
    shownSites.push({ facilityCode: 'CCI', yard, participants: Number(await enrolled(row).inputValue()), completed: Number(await completed(row).inputValue()) });
  }
  assert.deepEqual(shownSites, [
    { facilityCode: 'CCI', yard: 'A Yard', participants: 14, completed: 3 },
    { facilityCode: 'CCI', yard: 'B Yard', participants: 9, completed: 5 }
  ]);
  await page.getByRole('button', { name: 'Done with program' }).click();
  await page.getByRole('button', { name: 'Finish and submit' }).click();
  await page.getByText(/Submitted to TPW. Reference/).waitFor();
  await page.reload();
  await page.getByText(/Submitted to TPW. Reference/).waitFor();
  await page.getByRole('button', { name: 'Start a new submission' }).click();
  await page.getByRole('heading', { name: 'Reporting period', exact: true }).waitFor();
  // Submissions shows the member's history directly, with no chooser in the way.
  await page.getByRole('navigation', { name: 'Member navigation' }).getByRole('link', { name: 'Submissions' }).click();
  await page.waitForURL('**/team-dashboard/submissions/**');
  await page.getByRole('heading', { name: 'Your submission history' }).waitFor();
  await page.getByText('1 of 1 submissions').waitFor();
  assert.equal(await page.getByRole('link', { name: 'View your data' }).count(), 0);
  // The annual report is a tab with the PDF in the page, not an off-site link.
  await page.getByRole('navigation', { name: 'Member navigation' }).getByRole('link', { name: 'Annual report' }).click();
  await page.waitForURL('**/team-dashboard/annual-report/**');
  assert.equal(await page.getByRole('navigation', { name: 'Member navigation' }).getByRole('link', { name: 'Annual report' }).getAttribute('aria-current'), 'page');
  const pdf = page.locator('object[type="application/pdf"]');
  assert.equal(await pdf.count(), 1);
  assert.equal(await pdf.getAttribute('data'), '/report/organizations/org-2-annual-report-2026.pdf');
  assert.equal(await page.getByRole('link', { name: 'Download the PDF' }).getAttribute('href'), '/report/organizations/org-2-annual-report-2026.pdf');
  await page.setViewportSize({ width: 390, height: 1000 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'annual report reflows at 390px');
  assert.deepEqual(errors, []);
  console.log('PASS: TPW website links, Member Portal as a tab with content, no side drawer, desktop/mobile header, dense single-page Log data, inline submission history, and the embedded annual report.');
} finally {
  await browser.close();
}
