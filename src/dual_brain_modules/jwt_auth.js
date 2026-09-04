/**
 * AEOS Dual-Brain Auth Module: Lightweight HMAC-SHA256 Token Engine
 * Synthesized by Brain 2 (Antigravity SDE)
 */
const crypto = require('crypto');

class JWTAuthService {
  constructor(secret = 'aeos_secret_key_2026') {
    this.secret = secret;
    this.revokedTokens = new Set();
  }

  sign(payload, expiresInSeconds = 3600) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  verify(token) {
    if (this.revokedTokens.has(token)) {
      throw new Error('Token has been revoked');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed token');
    }
    const [header, body, signature] = parts;
    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new Error('Invalid signature');
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token has expired');
    }
    return payload;
  }

  revoke(token) {
    this.revokedTokens.add(token);
  }
}

module.exports = { JWTAuthService };
