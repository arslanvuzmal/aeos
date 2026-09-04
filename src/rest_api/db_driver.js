const fs = require('fs');
class SQLiteDriver {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.tables = {};
    this.load();
  }
  load() {
    try {
      if (this.dbPath && fs.existsSync(this.dbPath)) {
        this.tables = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
      }
    } catch {
      this.tables = {};
    }
  }
  save() {
    try {
      if (this.dbPath) {
        fs.writeFileSync(this.dbPath, JSON.stringify(this.tables, null, 2), 'utf-8');
      }
    } catch {}
  }
  createTable(name, schema) {
    if (!this.tables[name]) {
      this.tables[name] = { schema, rows: [], autoIncrement: 1 };
      this.save();
    }
  }
  insert(table, row) {
    if (!this.tables[table]) throw new Error(`Table ${table} does not exist`);
    const id = this.tables[table].autoIncrement++;
    const record = { id, ...row, created_at: new Date().toISOString() };
    this.tables[table].rows.push(record);
    this.save();
    return record;
  }
  findAll(table, filterFn) {
    if (!this.tables[table]) throw new Error(`Table ${table} does not exist`);
    const rows = this.tables[table].rows;
    return filterFn ? rows.filter(filterFn) : [...rows];
  }
  findById(table, id) {
    if (!this.tables[table]) throw new Error(`Table ${table} does not exist`);
    return this.tables[table].rows.find(r => r.id === Number(id)) || null;
  }
  update(table, id, updates) {
    if (!this.tables[table]) throw new Error(`Table ${table} does not exist`);
    const idx = this.tables[table].rows.findIndex(r => r.id === Number(id));
    if (idx === -1) return null;
    this.tables[table].rows[idx] = { ...this.tables[table].rows[idx], ...updates, updated_at: new Date().toISOString() };
    this.save();
    return this.tables[table].rows[idx];
  }
  delete(table, id) {
    if (!this.tables[table]) throw new Error(`Table ${table} does not exist`);
    const idx = this.tables[table].rows.findIndex(r => r.id === Number(id));
    if (idx === -1) return false;
    this.tables[table].rows.splice(idx, 1);
    this.save();
    return true;
  }
}
module.exports = SQLiteDriver;
