const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const { exec } = require('child_process');

chromium.use(stealthPlugin());

class StealthBrowserService {
    async launchStealthBrowser() {
        const browser = await chromium.launch({
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-web-security',
                '--window-size=1920,1080',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ]
        });

        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 }
        });

        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        });

        const page = await context.newPage();
        return { browser, context, page };
    }

    async generateBezierCurve(start, end, steps = 30) {
        const points = [];
        const controlX = start.x + (end.x - start.x) / 2 + (Math.random() - 0.5) * 100;
        const controlY = start.y + (end.y - start.y) / 2 + (Math.random() - 0.5) * 100;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * controlX + t * t * end.x;
            const y = (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * controlY + t * t * end.y;
            points.push({ x: Math.round(x), y: Math.round(y) });
        }
        return points;
    }

    async handleCaptcha(page, triggerSelector) {
        const checkElement = await page.$(triggerSelector);
        if (checkElement) {
            console.log("⚠️ [AEOS] Cloudflare challenge triggered. Initializing visual VNC server display port...");
            exec("Xvfb :99 -screen 0 1920x1080x16 & export DISPLAY=:99 && x11vnc -display :99 -nopw -listen localhost -xkb &");
            console.log("\n🚨 ACTION REQUIRED: Captcha screen spawned. Connect locally to: vnc://localhost:5900\n");
            let resolved = false;
            for (let i = 0; i < 120; i++) {
                await new Promise(r => setTimeout(r, 5000));
                const activeChallenge = await page.$(triggerSelector);
                if (!activeChallenge) {
                    resolved = true;
                    break;
                }
            }
            if (!resolved) throw new Error("Operator captcha solution timeout.");
        }
    }
}

module.exports = { StealthBrowserService };
