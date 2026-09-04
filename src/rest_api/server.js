const http = require('http');
const SQLiteDriver = require('./db_driver.js');
const SchemaValidator = require('./validator.js');
const RateLimiter = require('./rate_limiter.js');

class RestApiServer {
  constructor(options = {}) {
    this.db = new SQLiteDriver(options.dbPath || '/tmp/aeos_api.db');
    this.db.createTable('items', { title: 'string', price: 'number' });
    this.validator = new SchemaValidator({
      title: { required: true, type: 'string', minLength: 2 },
      price: { required: true, type: 'number', min: 0 }
    });
    this.limiter = new RateLimiter({ windowMs: options.rateLimitWindowMs || 2000, maxRequests: options.rateLimitMax || 50 });
  }

  handleRequest(req, res) {
    const ip = req.socket.remoteAddress || '127.0.0.1';
    const limitStatus = this.limiter.check(ip);
    if (!limitStatus.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Too Many Requests', retryAfterMs: 2000 }));
    }

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'HEALTHY', timestamp: new Date().toISOString() }));
    }

    if (method === 'GET' && pathname === '/api/items') {
      const items = this.db.findAll('items');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items, count: items.length }));
    }

    const itemMatch = pathname.match(/^\/api\/items\/(\d+)$/);
    if (method === 'GET' && itemMatch) {
      const id = itemMatch[1];
      const item = this.db.findById('items', id);
      if (!item) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Item not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(item));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      if (body) {
        try { parsed = JSON.parse(body); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
        }
      }

      if (method === 'POST' && pathname === '/api/items') {
        const validation = this.validator.validate(parsed);
        if (!validation.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Validation Failed', details: validation.errors }));
        }
        const created = this.db.insert('items', parsed);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(created));
      }

      if (method === 'PUT' && itemMatch) {
        const id = itemMatch[1];
        const updated = this.db.update('items', id, parsed);
        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Item not found' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(updated));
      }

      if (method === 'DELETE' && itemMatch) {
        const id = itemMatch[1];
        const deleted = this.db.delete('items', id);
        if (!deleted) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Item not found' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ deleted: true, id }));
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Route not found' }));
    });
  }
}
module.exports = RestApiServer;
