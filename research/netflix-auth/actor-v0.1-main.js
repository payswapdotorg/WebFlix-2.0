console.log('[boot] node', process.version);
try {
const { Actor } = require('apify');
Actor.main(async () => {
    // P45 harvest: homepage warm-up -> real Sign-In click -> human-paced typing ->
    // ONE clean submit -> success measured by the presence of NetflixId+SecureNetflixId.
    const input = (await Actor.getInput()) || {};
    const email = input.email || 'sportsentertainment7192@gmail.com';
    const password = input.password || 'Tepa123456!';
    const proxyGroup = input.proxyGroup || 'RESIDENTIAL';
    const country = input.country || 'GB';
    const proxyConfiguration = await Actor.createProxyConfiguration({ groups: [proxyGroup], countryCode: country });
    const puppeteer = require('puppeteer-extra');
    puppeteer.use(require('puppeteer-extra-plugin-stealth')());

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rand = (a, b) => a + Math.floor(Math.random() * (b - a));

    const sessionId = 'wfxp45' + Date.now();
    const pUrl = new URL(await proxyConfiguration.newUrl(sessionId));
    const browser = await puppeteer.launch({
        headless: false,
        proxy: { server: `http://${pUrl.host}`, username: pUrl.username, password: pUrl.password },
        args: [
            '--lang=en-GB', '--window-size=1366,850', '--no-sandbox',
            '--disable-blink-features=AutomationControlled', '--disable-infobars',
        ],
    });
    let page;
    try {
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 850 });
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        const loginResponses = [];
        page.on('response', async (res) => {
            try {
                const req = res.request();
                const url = res.url();
                if (req.method() === 'POST' && /netflix\.com.*(login|\/api\/)/.test(url)) {
                    let body = '';
                    try { body = (await res.text()).slice(0, 500); } catch {}
                    loginResponses.push({ status: res.status(), url: url.slice(0, 120), body });
                }
            } catch {}
        });

        const state = async (step) => {
            let url = '', title = '', text = '', shot;
            try {
                url = page.url();
                title = await page.title();
                text = (await page.evaluate(() => document.body.innerText.slice(0, 300))).replace(/\n/g, ' | ');
                shot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 40 }).catch(() => undefined);
            } catch {}
            await Actor.pushData({ step, url: url.slice(0, 150), title: String(title).slice(0, 80), text, shot });
        };

        const humanType = async (sel, text) => {
            await page.click(sel);
            await sleep(rand(200, 500));
            for (const ch of text) {
                await page.keyboard.type(ch, { delay: rand(60, 160) });
                if (Math.random() < 0.12) await sleep(rand(180, 480));
            }
        };
        const humanMove = async (sel) => {
            const el = await page.$(sel);
            if (!el) return;
            const box = await el.boundingBox();
            if (!box) return;
            await page.mouse.move(
                box.x + box.width * (0.3 + Math.random() * 0.4),
                box.y + box.height / 2,
                { steps: rand(8, 18) },
            );
            await sleep(rand(120, 350));
        };

        // ---- warm-up: the homepage first (cookie context + dwell), like a human opener
        await page.goto('https://www.netflix.com/', { waitUntil: 'networkidle2', timeout: 90000 }).catch(async () => {
            await state('home-goto-slow');
        });
        await state('home-loaded');
        await sleep(rand(4000, 7000));
        await page.evaluate(() => window.scrollBy({ top: 700, behavior: 'smooth' }));
        await sleep(rand(2500, 4000));
        await page.evaluate(() => window.scrollBy({ top: -300, behavior: 'smooth' }));
        await sleep(rand(1500, 3000));
        await state('warmup');

        // ---- enter via the real Sign In link
        const SIGNIN = 'a[href="/login"], a[data-uia="header-login-link"]';
        const signed = await page.$(SIGNIN);
        if (signed) {
            await humanMove(SIGNIN);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
                page.click(SIGNIN),
            ]);
        } else {
            await page.goto('https://www.netflix.com/login', { waitUntil: 'networkidle2', timeout: 90000 });
        }
        await sleep(rand(3000, 5000));
        await state('login-page');

        // ---- fill the form like a person
        const EMAIL_SEL = 'input[name="email"], #id_userLoginId, input[type="email"], input[autocomplete="email"], input[autocomplete="username"], input[data-uia="user-login-id"]';
        await page.waitForSelector(EMAIL_SEL, { timeout: 45000, visible: true });
        await humanMove(EMAIL_SEL);
        await humanType(EMAIL_SEL, email);
        await sleep(rand(800, 1500));

        const PWD_SEL = 'input[name="password"], #id_password, input[type="password"]';
        let hasPwd = await page.$(PWD_SEL);
        if (!hasPwd) {
            await humanMove('button[type="submit"]');
            await page.click('button[type="submit"]');
            await sleep(4000);
            await page.waitForSelector(PWD_SEL, { timeout: 30000, visible: true });
        }
        await humanMove(PWD_SEL);
        await humanType(PWD_SEL, password);
        const rem = await page.$('input[name="rememberMe"]');
        if (rem) { try { await page.click('input[name="rememberMe"]'); } catch {} }
        await sleep(rand(1200, 2200));

        // ---- ONE clean submit
        loginResponses.length = 0;
        await humanMove('button[type="submit"]');
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
        await sleep(rand(8000, 11000));
        await state('after-submit');

        const url = page.url();
        const diag = await page.evaluate(() => document.body.innerText.slice(0, 400));
        let cookies = await page.cookies();
        const issued = ['NetflixId', 'SecureNetflixId'].every((n) => cookies.some((c) => c.name === n));
        // v0.3 honesty: issued cookies != a live session. Netflix's risk engine
        // sometimes QUARANTINES a login ("Something went wrong" + cookies set).
        // If the wall text is showing, test the session directly at /browse.
        const wallish = /something went wrong|enter your info to sign in|join now|get started/i.test(diag) || url.includes('/login');
        let finalDiag = diag;
        let finalUrl = url;
        if (issued && wallish) {
            await page.goto('https://www.netflix.com/browse', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
            await sleep(rand(6000, 9000));
            finalUrl = page.url();
            finalDiag = await page.evaluate(() => document.body.innerText.slice(0, 400));
            cookies = await page.cookies();
        }
        const signedIn =
            !/something went wrong|enter your info to sign in|join now|get started|protected by google recaptcha/i.test(finalDiag) &&
            !finalUrl.includes('/login') &&
            ['NetflixId', 'SecureNetflixId'].every((n) => cookies.some((c) => c.name === n));
        const shot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 });
        await Actor.pushData({
            status: signedIn ? 'logged-in' : issued ? 'quarantined' : 'blocked-or-failed',
            finalUrl: finalUrl.slice(0, 150),
            diag: finalDiag.replace(/\n/g, ' | ').slice(0, 300),
            cookies: signedIn ? cookies : undefined,
            loginResponses: loginResponses.slice(-6),
            shot,
        });
        Actor.exit({ statusMessage: signedIn ? 'P45_LOGGED_IN' : issued ? 'P45_QUARANTINED' : 'P45_BLOCKED' });
    } catch (e) {
        let shot;
        try {
            const ps = await browser.pages();
            if (ps[0]) shot = await ps[0].screenshot({ encoding: 'base64', type: 'jpeg', quality: 40 });
        } catch {}
        let eurl = '', etext = '';
        try { eurl = page.url(); etext = (await page.evaluate(() => document.body.innerText.slice(0, 300))).replace(/\n/g, ' | '); } catch {}
        await Actor.pushData({ status: 'error', diag: String((e && e.message) || e).slice(0, 300), finalUrl: eurl.slice(0, 150), diagText: etext, shot });
        throw e;
    } finally {
        await browser.close().catch(() => {});
    }
});
} catch (e) {
    console.log('[fatal]', (e && e.stack) || String(e));
    process.exit(1);
}
