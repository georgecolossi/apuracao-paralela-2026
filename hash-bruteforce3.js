const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const raw = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'));
// The raw buffer bytes might have some weird things?
console.log('Raw length:', raw.length);
const str = raw.toString('utf8');

const hashMatch = str.match(/HASH:([A-F0-9]{128})/);
const expectedHash = hashMatch[1];
const hashIndex = hashMatch.index;

console.log('Expected:', expectedHash);

const beforeHash = str.substring(0, hashIndex);
// beforeHash ends with space?
console.log('Ends with space?', beforeHash.endsWith(' '));

const h1 = crypto.createHash('sha512').update(beforeHash, 'utf8').digest('hex').toUpperCase();
console.log('beforeHash:', h1, h1 === expectedHash);

const beforeHashNoHeader = beforeHash.replace(/^QRBU:\d+:\d+ /, '');
const h2 = crypto.createHash('sha512').update(beforeHashNoHeader, 'utf8').digest('hex').toUpperCase();
console.log('beforeHashNoHeader:', h2, h2 === expectedHash);

const justHashPrefix = beforeHash + 'HASH:';
const h3 = crypto.createHash('sha512').update(justHashPrefix, 'utf8').digest('hex').toUpperCase();
console.log('beforeHash + HASH:', h3, h3 === expectedHash);
