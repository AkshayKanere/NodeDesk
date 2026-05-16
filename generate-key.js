const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keyDir = path.join(__dirname, 'keys');
if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir);

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

fs.writeFileSync(path.join(keyDir, 'host_key'), privateKey);
fs.writeFileSync(path.join(keyDir, 'host_key.pub'), publicKey);

console.log('Host keys generated in keys/ directory');
console.log('  keys/host_key      (private - copy to server)');
console.log('  keys/host_key.pub  (public)');
