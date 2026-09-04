class SchemaValidator {
  constructor(schema) {
    this.schema = schema;
  }
  validate(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Request body must be a valid JSON object'] };
    }
    for (const [field, rules] of Object.entries(this.schema)) {
      if (rules.required && (data[field] === undefined || data[field] === null || data[field] === '')) {
        errors.push(`Field '${field}' is required.`);
        continue;
      }
      if (data[field] !== undefined) {
        if (rules.type && typeof data[field] !== rules.type) {
          errors.push(`Field '${field}' must be of type ${rules.type}.`);
        }
        if (rules.min !== undefined && data[field] < rules.min) {
          errors.push(`Field '${field}' must be >= ${rules.min}.`);
        }
        if (rules.minLength !== undefined && data[field].length < rules.minLength) {
          errors.push(`Field '${field}' length must be >= ${rules.minLength}.`);
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }
}
module.exports = SchemaValidator;
