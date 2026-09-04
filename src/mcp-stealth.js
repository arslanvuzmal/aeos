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

    async handleCaptcha(page, triggerSelector) {
        const checkElement = await page.$(triggerSelector);
        if (checkElement) {
            console.log("⚠️ [AEOS] Capture challenge detected. Spinning VNC visual gate...");
            exec("Xvfb :99 -screen 0 1920x1080x16 & export DISPLAY=:99 && x11vnc -display :99 -nopw -listen localhost -xkb &");
            
            console.log("\n=======================================================");
            console.log("🚨 CAPTCHA ENGAGED: Human Intervention Required.");
            console.log("👉 Visual link: vnc://localhost:5900");
            console.log("=======================================================\n");

            let resolved = false;
            for (let i = 0; i < 120; i++) {
                await new Promise(r => setTimeout(r, 5000));
                const activeChallenge = await page.$(triggerSelector);
                if (!activeChallenge) {
                    resolved = true;
                    console.log("✅ Captcha successfully resolved. Resuming automation.");
                    break;
                }
            }
            if (!resolved) throw new Error("Captcha human intervention timeout.");
        }
    }
}

module.exports = { StealthBrowserService };
