// E2E proti běžícímu API se seed daty (pnpm --filter @ms/api seed && start). Spuštění: node e2e/http-flow.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/fonts|ERR_FAILED|401/.test(m.text()) && errors.push(m.text()));
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const login = async (email) => {
    await p.goto((process.env.APP_URL ?? 'http://localhost:3001') + '/#/');
    await p.waitForSelector('input[type=email]');
    await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'demo1234');
    await p.click('button:has-text("Přihlásit se")');
  };
  await login('marek@studio-dobryden.example');
  await p.waitForSelector('.kpi');
  await p.click('a[href="#/schvalovani"]'); await p.click('text=Vánoční cukroví na objednávku'); await p.waitForSelector('.preview');
  await p.fill('textarea[placeholder^="O čem"]', 'tříkrálové koláče od 2. ledna');
  await p.click('text=Navrhnout 3 varianty'); await p.waitForSelector('.ai-variant');
  await p.screenshot({ path: require('os').tmpdir() + '/http-editor.png', fullPage: true });
  // logout, client approves
  await p.click('button:has-text("Odhlásit")'); await p.waitForSelector('input[type=email]');
  await login('jana@pekarna-ulipy.example');
  await p.waitForSelector('tr.click'); await p.click('tr.click >> nth=0');
  await p.click('button:has-text("Schválit")'); await p.click('.modal button:has-text("Schválit")');
  await p.waitForSelector('text=Děkujeme, post je schválený');
  // client must not reach team page
  await p.goto((process.env.APP_URL ?? 'http://localhost:3001') + '/#/tym'); await p.waitForTimeout(500);
  const onTeam = await p.isVisible('text=Tým a přístupy');
  console.log('client sees team page:', onTeam, 'ERRORS', JSON.stringify(errors));
  await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
