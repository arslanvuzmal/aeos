const { exec } = require('child_process');
const fs = require('fs');
const readline = require('readline');

let chromium = null;
try {
    const playwrightExtra = require('playwright-extra');
    const stealthPlugin = require('puppeteer-extra-plugin-stealth');
    chromium = playwrightExtra.chromium;
    chromium.use(stealthPlugin());
} catch (e) {
    try {
        chromium = require('playwright').chromium;
    } catch (_) {
        chromium = null;
    }
}

class StealthBrowserService {
    async launchStealthBrowser() {
        if (!chromium) {
            throw new Error("Playwright or Playwright-Extra not found. Run npm install playwright playwright-extra puppeteer-extra-plugin-stealth.");
        }
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

    async humanMove(page, targetX, targetY) {
        const start = { x: 100, y: 100 };
        const curve = await this.generateBezierCurve(start, { x: targetX, y: targetY });
        for (const pt of curve) {
            await page.mouse.move(pt.x, pt.y);
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 8) + 2));
        }
    }

    async humanType(page, selector, text) {
        await page.focus(selector);
        for (const char of text) {
            await page.keyboard.type(char);
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 50) + 30));
        }
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

    async fetchPageContent(url, options = {}) {
        const { browser, context, page } = await this.launchStealthBrowser();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            if (options.captchaSelector) {
                await this.handleCaptcha(page, options.captchaSelector);
            }
            const title = await page.title();
            const textContent = await page.evaluate(() => document.body.innerText);
            return { title, content: textContent.slice(0, 15000), status: 200 };
        } finally {
            await context.close();
            await browser.close();
        }
    }
}

if (require.main === module) {
    const service = new StealthBrowserService();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

    rl.on('line', async (line) => {
        if (!line.trim()) return;
        try {
            const req = JSON.parse(line);
            if (req.method === 'initialize') {
                const res = {
                    jsonrpc: '2.0',
                    id: req.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'aeos-stealth-browser', version: '1.1.0' }
                    }
                };
                process.stdout.write(JSON.stringify(res) + '\n');
            } else if (req.method === 'tools/list') {
                const res = {
                    jsonrpc: '2.0',
                    id: req.id,
                    result: {
                        tools: [
                            {
                                name: 'stealth_browse',
                                description: 'Navigate to a target URL using stealth evasions and retrieve text contents.',
                                inputSchema: {
                                    type: 'object',
                                    properties: {
                                        url: { type: 'string', description: 'URL to visit' },
                                        captchaSelector: { type: 'string', description: 'Optional CSS selector for CAPTCHA element' }
                                    },
                                    required: ['url']
                                }
                            }
                        ]
                    }
                };
                process.stdout.write(JSON.stringify(res) + '\n');
            } else if (req.method === 'tools/call') {
                const { name, arguments: args } = req.params;
                if (name === 'stealth_browse') {
                    const data = await service.fetchPageContent(args.url, { captchaSelector: args.captchaSelector });
                    const res = {
                        jsonrpc: '2.0',
                        id: req.id,
                        result: {
                            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
                        }
                    };
                    process.stdout.write(JSON.stringify(res) + '\n');
                } else {
                    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } }) + '\n');
                }
            }
        } catch (e) {
            process.stderr.write(`Error processing line: ${e.message}\n`);
        }
    });
}

module.exports = { StealthBrowserService };
