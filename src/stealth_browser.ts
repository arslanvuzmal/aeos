import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

export interface StealthBrowserConfig {
  proxyUrl?: string;
  vncPort?: number;
  headless?: boolean;
}

export interface TrajectoryPoint {
  x: number;
  y: number;
}

export class StealthBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private vncServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private isPausedForHuman: boolean = false;
  private readonly vncPort: number;
  private readonly headless: boolean;

  constructor(config?: StealthBrowserConfig) {
    this.vncPort = config?.vncPort || 8765;
    this.headless = config?.headless ?? true;
  }

  public async initialize(): Promise<Page> {
    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1920,1080'
    ];

    this.browser = await chromium.launch({
      headless: this.headless,
      args: launchArgs
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York'
    });

    // Anti-Detection Prototype & Hardware Masking
    await this.context.addInitScript(`
      // 1. Remove navigator.webdriver
      try {
        const proto = Object.getPrototypeOf(navigator);
        delete proto.webdriver;
      } catch (e) {}
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // 2. WebGL Hardware Unmasking
      try {
        const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
          if (parameter === 37445) return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
          if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
          return originalGetParameter.apply(this, [parameter]);
        };
      } catch (e) {}

      if (typeof WebGL2RenderingContext !== 'undefined') {
        try {
          const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function (parameter) {
            if (parameter === 37445) return 'Intel Inc.';
            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
            return originalGetParameter2.apply(this, [parameter]);
          };
        } catch (e) {}
      }

      // 3. Canvas 1-Bit Parity Jitter
      try {
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type, ...args) {
          const ctx = this.getContext('2d');
          if (ctx) {
            try {
              const img = ctx.getImageData(0, 0, Math.min(this.width, 10), Math.min(this.height, 10));
              for (let i = 0; i < img.data.length; i += 4) {
                img.data[i] = img.data[i] ^ 1;
              }
              ctx.putImageData(img, 0, 0);
            } catch (e) {}
          }
          return originalToDataURL.apply(this, [type, ...args]);
        };
      } catch (e) {}

      // 4. Neutralize WebRTC Local IP Leaks
      try {
        if (window.RTCPeerConnection) {
          const OrigRTC = window.RTCPeerConnection;
          window.RTCPeerConnection = function (cfg) {
            if (cfg && cfg.iceServers) cfg.iceServers = [];
            return new OrigRTC(cfg);
          };
          window.RTCPeerConnection.prototype = OrigRTC.prototype;
        }
      } catch (e) {}
    `);

    this.page = await this.context.newPage();
    return this.page;
  }

  public getPage(): Page | null {
    return this.page;
  }

  public getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * Generates a smooth cubic Bézier trajectory with Gaussian perturbations.
   */
  public calculateBezierPath(
    p0: TrajectoryPoint,
    p3: TrajectoryPoint,
    steps: number = 30
  ): TrajectoryPoint[] {
    const deltaX = p3.x - p0.x;
    const deltaY = p3.y - p0.y;

    const p1: TrajectoryPoint = {
      x: p0.x + deltaX * 0.25 + (Math.random() - 0.5) * 80,
      y: p0.y + deltaY * 0.1 + (Math.random() - 0.5) * 80
    };

    const p2: TrajectoryPoint = {
      x: p0.x + deltaX * 0.75 + (Math.random() - 0.5) * 80,
      y: p0.y + deltaY * 0.9 + (Math.random() - 0.5) * 80
    };

    const trajectory: TrajectoryPoint[] = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x =
        Math.pow(1 - t, 3) * p0.x +
        3 * Math.pow(1 - t, 2) * t * p1.x +
        3 * (1 - t) * Math.pow(t, 2) * p2.x +
        Math.pow(t, 3) * p3.x;

      const y =
        Math.pow(1 - t, 3) * p0.y +
        3 * Math.pow(1 - t, 2) * t * p1.y +
        3 * (1 - t) * Math.pow(t, 2) * p2.y +
        Math.pow(t, 3) * p3.y;

      // Add Gaussian neuromuscular jitter
      const jitterX = (Math.random() - 0.5) * 1.5;
      const jitterY = (Math.random() - 0.5) * 1.5;

      trajectory.push({ x: Number((x + jitterX).toFixed(2)), y: Number((y + jitterY).toFixed(2)) });
    }

    return trajectory;
  }

  public async humanLikeMove(targetX: number, targetY: number): Promise<void> {
    if (!this.page) throw new Error('[AEOS BROWSER] Cannot move mouse; page is not initialized.');

    const start = { x: 100, y: 100 };
    const target = { x: targetX, y: targetY };
    const path = this.calculateBezierPath(start, target);

    for (const pt of path) {
      await this.page.mouse.move(pt.x, pt.y);
      const delay = Math.floor(Math.random() * 8) + 4;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  public async humanType(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error('[AEOS BROWSER] Cannot type; page is not initialized.');
    await this.page.click(selector);

    for (const char of text) {
      await this.page.keyboard.type(char);
      const delay = Math.floor(Math.random() * 110) + 40; // 40ms to 150ms randomized cadence
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  public async detectSecurityChallenge(): Promise<boolean> {
    if (!this.page) return false;
    const challengeSelectors = [
      'iframe[src*="cloudflare"]',
      'iframe[src*="turnstile"]',
      '#challenge-running',
      '#cf-challenge-running',
      'div[class*="captcha"]',
      '#datadome-captcha',
      '.g-recaptcha'
    ];

    for (const sel of challengeSelectors) {
      const el = await this.page.$(sel);
      if (el) return true;
    }
    return false;
  }

  /**
   * Spins up the local visual screencast fallback portal and pauses programmatic run.
   */
  public async triggerHumanVncFallback(): Promise<void> {
    if (this.isPausedForHuman || !this.page) return;
    this.isPausedForHuman = true;

    process.stdout.write(`\n\x1b[33m[AEOS SECURITY INTERCEPT]\x1b[0m Bot firewall challenge detected.\n`);
    process.stdout.write(
      `Visual Fallback Portal initialized: \x1b[36mhttp://127.0.0.1:${this.vncPort}/portal\x1b[0m\n`
    );

    return new Promise<void>((resolve) => {
      this.vncServer = http.createServer((req, res) => {
        if (req.url === '/portal') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8" />
              <title>AEOS Visual Recovery Portal</title>
              <style>
                body { margin: 0; background: #121212; color: #ececec; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; }
                header { padding: 15px; background: #1e1e1e; border-bottom: 1px solid #333; }
                h2 { margin: 0 0 5px 0; font-size: 20px; color: #61afef; }
                p { margin: 0; font-size: 14px; color: #abb2bf; }
                #viewport { margin: 20px auto; max-width: 92%; position: relative; display: inline-block; box-shadow: 0 8px 24px rgba(0,0,0,0.6); }
                #stream { display: block; width: 100%; border-radius: 4px; border: 1px solid #444; cursor: crosshair; }
                .action-bar { margin: 20px; }
                button { padding: 12px 28px; font-size: 15px; font-weight: 600; background: #98c379; color: #1e1e1e; border: none; border-radius: 6px; cursor: pointer; transition: background 0.2s; }
                button:hover { background: #7cb85c; }
              </style>
            </head>
            <body>
              <header>
                <h2>AEOS Visual Screencast Gate</h2>
                <p>Interactive security barrier detected. Solve the challenge below and click Resume.</p>
              </header>
              <div id="viewport">
                <img id="stream" alt="Live Session Screencast" />
              </div>
              <div class="action-bar">
                <button onclick="resumePipeline()">Resume Pipeline Execution</button>
              </div>
              <script>
                const ws = new WebSocket('ws://' + location.host);
                const img = document.getElementById('stream');
                ws.onmessage = (e) => { img.src = 'data:image/jpeg;base64,' + e.data; };
                
                img.onmousedown = (e) => {
                  const rect = img.getBoundingClientRect();
                  const x = (e.clientX - rect.left) * (1920 / rect.width);
                  const y = (e.clientY - rect.top) * (1080 / rect.height);
                  ws.send(JSON.stringify({ type: 'click', x, y }));
                };

                function resumePipeline() {
                  fetch('/resume')
                    .then(r => r.json())
                    .then(() => {
                      document.body.innerHTML = '<h2 style="margin-top:50px;color:#98c379;">Pipeline Resumed. You may close this tab.</h2>';
                    });
                }
              </script>
            </body>
            </html>
          `);
          return;
        }

        if (req.url === '/resume') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'resumed', timestamp: new Date().toISOString() }));
          this.teardownVnc();
          this.isPausedForHuman = false;
          resolve();
          return;
        }

        res.writeHead(404);
        res.end();
      });

      this.wss = new WebSocketServer({ server: this.vncServer });
      this.wss.on('connection', (ws: WebSocket) => {
        const frameInterval = setInterval(async () => {
          if (this.page && !this.page.isClosed()) {
            try {
              const buffer = await this.page.screenshot({ type: 'jpeg', quality: 65 });
              ws.send(buffer.toString('base64'));
            } catch {
              // Frame dropped during active render
            }
          }
        }, 150);

        ws.on('message', async (data: string) => {
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'click' && this.page) {
              await this.page.mouse.click(msg.x, msg.y);
            }
          } catch {
            // Malformed message guard
          }
        });

        ws.on('close', () => clearInterval(frameInterval));
      });

      this.vncServer.listen(this.vncPort);
    });
  }

  public teardownVnc(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.vncServer) {
      this.vncServer.close();
      this.vncServer = null;
    }
  }

  public async getSessionCookies(): Promise<any[]> {
    if (!this.context) return [];
    return await this.context.cookies();
  }

  public async close(): Promise<void> {
    this.teardownVnc();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}