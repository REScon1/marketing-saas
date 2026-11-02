// E2E průchod demem: klient vrátí post, manažer opraví, host schválí přes odkaz, publikace, tmavý režim, mobil.
// Spuštění: pnpm build:demo && node e2e/demo-flow.cjs
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : require('os').tmpdir() + '/';
const URL = 'file://' + require('path').resolve(__dirname, '../dist-demo/index.html');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_FAILED') && errors.push(m.text()));
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await p.goto(URL);
  await p.waitForSelector('.persona');
  // 1) client persona approves
  await p.click('.persona >> nth=2');
  await p.waitForSelector('table, .empty'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '10-client-home.png', fullPage: true });
  await p.click('tr.click >> nth=0'); await p.waitForSelector('text=Agentura čeká na vaše rozhodnutí');
  await p.screenshot({ path: OUT + '11-client-post.png', fullPage: true });
  await p.click('button:has-text("Vrátit k úpravě")');
  await p.fill('.modal textarea', 'Prosím doplňte cenu za kilo: 690 Kč.');
  await p.click('.modal button:has-text("Odeslat připomínky")');
  await p.waitForSelector('text=Odesláno agentuře');
  // 2) manager: fix, resend, get link
  await p.click('button:has-text("Přepnout")'); await p.click('.persona >> nth=1'); await p.waitForSelector('.kpi');
  await p.click('text=Vánoční cukroví na objednávku'); await p.waitForSelector('text=Klient chce úpravy');
  await p.fill('textarea.textarea >> nth=0', 'Letos poprvé pečeme vánoční cukroví i na objednávku. Kilo směsi z 12 druhů za 690 Kč, vyzvednutí od 18. prosince. 🎄\n\n#pekarnaulipy #cukrovi');
  await p.click('button:has-text("Uložit")'); await p.waitForTimeout(500);
  await p.click('button:has-text("Poslat ke schválení")'); await p.click('.modal button:has-text("Odeslat")');
  await p.waitForSelector('text=Odkaz pro klienta');
  const href = '#/schvalit/' + (await p.inputValue('input[aria-label="Odkaz pro klienta"]')).split('#/schvalit/')[1];
  // 3) guest approves via link in new page
  const g = await ctx.newPage();
  g.on('pageerror', (e) => errors.push('GUEST ' + e.message));
  await g.goto(URL + href.slice(href.indexOf('#')));
  await g.waitForSelector('text=Vaše rozhodnutí');
  await g.screenshot({ path: OUT + '12-public.png', fullPage: true });
  await g.fill('input[autocomplete=name]', 'Jana Lípová');
  await g.click('button:has-text("Schválit")');
  await g.waitForSelector('text=Děkujeme, post je schválený');
  await g.close();
  // 4) manager schedules + simulate publish
  await p.goto(URL + '#/'); await p.reload(); await p.waitForSelector('.persona'); await p.click('.persona >> nth=1'); await p.waitForSelector('.kpi');
  await p.goto(URL + '#/schvalovani'); await p.waitForTimeout(400);
  await p.click('text=Vánoční cukroví na objednávku'); await p.waitForSelector('button:has-text("Naplánovat")');
  await p.click('button:has-text("Naplánovat")'); await p.waitForSelector('button:has-text("Simulovat publikaci teď")');
  await p.click('button:has-text("Simulovat publikaci teď")'); await p.waitForSelector('text=Publikováno', { timeout: 5000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '13-published.png', fullPage: true });
  // 5) dark + mobile
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.goto(URL + '#/'); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '14-dark.png' });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(URL + '#/kalendar'); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '15-mobile.png' });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('mobile horizontal overflow:', overflow);
  console.log('ERRORS', JSON.stringify(errors));
  await b.close();
  if (errors.length || overflow) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
// Konec: nenulový exit, pokud prohlížeč hlásil chyby
process.on('exit', () => {});
