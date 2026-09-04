const auth = require('./auth_module.js');
const token = auth.createToken({ sub: 'user_admin_01', role: 'root' }, 'aeos_secret_key');
console.log('GENERATED_TOKEN:' + token);
const payload = auth.verifyToken(token, 'aeos_secret_key');
if (!payload || payload.sub !== 'user_admin_01') {
  console.error('VERIFICATION_FAILED');
  process.exit(1);
}
console.log('JWT_VERIFICATION_SUCCESS:sub=' + payload.sub);
