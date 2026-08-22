/**
 * End-to-end auth verification: drives a real browser against the running app.
 *
 * Asserts observable behaviour only — what the browser lands on, what the DOM
 * says, and what rows exist afterwards.
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const WEB = 'http://localhost:3000';
const stamp = Date.now();
const EMAIL = `ui.signup.${stamp}@example.dz`;
const PASSWORD = 'Str0ng-Passw0rd!';
const FULL_NAME = 'مستخدم الاختبار';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function sql(q) {
  return execSync(
    `docker exec saas-postgres psql -U postgres -d saas_dev -tAc ${JSON.stringify(q)}`,
    { encoding: 'utf8' },
  ).trim();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

try {
  // ---------------------------------------------------------------- locale
  await page.goto(WEB, { waitUntil: 'networkidle' });
  check(
    'root redirects to default locale /ar',
    new URL(page.url()).pathname.startsWith('/ar'),
    page.url(),
  );

  const dir = await page.getAttribute('html', 'dir');
  const lang = await page.getAttribute('html', 'lang');
  check('Arabic renders RTL', dir === 'rtl' && lang === 'ar', `dir=${dir} lang=${lang}`);

  await page.goto(`${WEB}/fr`, { waitUntil: 'networkidle' });
  const frDir = await page.getAttribute('html', 'dir');
  check('French renders LTR', frDir === 'ltr', `dir=${frDir}`);

  // ------------------------------------------------- protected route gating
  await page.goto(`${WEB}/ar/dashboard`, { waitUntil: 'networkidle' });
  const gated = new URL(page.url());
  check(
    'unauthenticated /ar/dashboard redirects to login',
    gated.pathname === '/ar/login',
    gated.pathname,
  );
  check(
    'redirectTo preserved for post-login return',
    gated.searchParams.get('redirectTo') === '/ar/dashboard',
    gated.searchParams.get('redirectTo') ?? '(none)',
  );

  // ------------------------------------------------------ client validation
  await page.goto(`${WEB}/ar/signup`, { waitUntil: 'networkidle' });
  await page.fill('#field-email', 'not-an-email');
  await page.fill('#field-password', 'short');
  await page.fill('#field-confirmPassword', 'different');
  await page.click('button[type=submit]');
  await page.waitForTimeout(600);
  const alerts = await page.locator('[role=alert]').allTextContents();
  check(
    'zod validation blocks a bad submit and shows messages',
    alerts.length >= 2 && new URL(page.url()).pathname === '/ar/signup',
    `${alerts.length} messages`,
  );

  // -------------------------------------------------- the real UI sign-up
  const before = sql(
    "select (select count(*) from auth.users)::text || '|' || (select count(*) from public.users)::text || '|' || (select count(*) from public.credit_wallets)::text",
  );

  await page.goto(`${WEB}/ar/signup`, { waitUntil: 'networkidle' });
  await page.fill('#field-fullName', FULL_NAME);
  await page.fill('#field-email', EMAIL);
  await page.fill('#field-password', PASSWORD);
  await page.fill('#field-confirmPassword', PASSWORD);
  await page.screenshot({ path: '/tmp/01-signup-ar.png' });
  await page.click('button[type=submit]');

  await page.waitForURL('**/dashboard', { timeout: 30000 }).catch(() => {});
  const landed = new URL(page.url()).pathname;
  check('sign-up lands on the dashboard', landed === '/ar/dashboard', landed);
  await page.screenshot({ path: '/tmp/02-dashboard-ar.png' });

  // --------------------------------------- Phase 1 trigger fired for THIS user
  const after = sql(
    "select (select count(*) from auth.users)::text || '|' || (select count(*) from public.users)::text || '|' || (select count(*) from public.credit_wallets)::text",
  );
  check(
    'row counts advanced by exactly one everywhere',
    (() => {
      const b = before.split('|').map(Number);
      const a = after.split('|').map(Number);
      return a.every((v, i) => v === b[i] + 1);
    })(),
    `${before} -> ${after}`,
  );

  const row = sql(
    `select coalesce(u.full_name,'(null)') || ' | wallet=' || coalesce(w.balance_credits::text,'(none)') || ' | wallet_user_matches=' || (w.user_id = u.id)::text from public.users u left join public.credit_wallets w on w.user_id = u.id where u.email = '${EMAIL}'`,
  );
  check(
    'provisioned user + wallet for the signed-up email',
    row.includes('wallet_user_matches=t'),
    row,
  );
  check(
    'full_name flowed from the form through auth metadata',
    row.startsWith(FULL_NAME),
    row.split('|')[0].trim(),
  );

  // ------------------------------------------- dashboard shows live API data
  const body = await page.locator('main').innerText();
  check(
    'dashboard renders the balance from the API',
    /0/.test(body) && !/apiUnreachable/.test(body),
    body.split('\n').slice(0, 6).join(' / '),
  );

  // ------------------------------------- signed-in user bounced off auth pages
  await page.goto(`${WEB}/ar/login`, { waitUntil: 'networkidle' });
  check(
    'signed-in user redirected away from /login',
    new URL(page.url()).pathname === '/ar/dashboard',
    new URL(page.url()).pathname,
  );

  // ------------------------------------------------------------- sign out
  await page.goto(`${WEB}/ar/dashboard`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("تسجيل الخروج")');
  await page.waitForTimeout(2500);
  await page.goto(`${WEB}/ar/dashboard`, { waitUntil: 'networkidle' });
  check(
    'after sign-out the dashboard is protected again',
    new URL(page.url()).pathname === '/ar/login',
    new URL(page.url()).pathname,
  );

  // ------------------------------------------------------- log back in (FR)
  await page.goto(`${WEB}/fr/login`, { waitUntil: 'networkidle' });
  await page.fill('#field-email', EMAIL);
  await page.fill('#field-password', PASSWORD);
  await page.screenshot({ path: '/tmp/03-login-fr.png' });
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 30000 }).catch(() => {});
  check(
    'existing account can log back in (French locale)',
    new URL(page.url()).pathname === '/fr/dashboard',
    new URL(page.url()).pathname,
  );
  await page.screenshot({ path: '/tmp/04-dashboard-fr.png' });

  // --------------------------------------------------- wrong password fails
  await ctx.clearCookies();
  await page.goto(`${WEB}/ar/login`, { waitUntil: 'networkidle' });
  await page.fill('#field-email', EMAIL);
  await page.fill('#field-password', 'definitely-the-wrong-password-1');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2500);
  const errText = (await page.locator('[role=alert]').allTextContents()).join(' ');
  check(
    'wrong password is rejected with a generic message',
    new URL(page.url()).pathname === '/ar/login' && errText.length > 0,
    errText.slice(0, 60),
  );
} finally {
  await browser.close();
}

console.log('\n================ SUMMARY ================');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name} (${f.detail})`));
  process.exitCode = 1;
}
