const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const raw = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'));
const str = raw.toString('utf8');

const hashMatch = str.match(/HASH:([A-F0-9]{128})/);
const expectedHash = hashMatch[1];
const hashIndex = hashMatch.index;

console.log('Expected:', expectedHash);

const beforeHash = str.substring(0, hashIndex).trim(); // Remove that last space
const noHeader = beforeHash.replace(/^QRBU:\d+:\d+ /, '');

console.log('--- Combinations ---');
[
  beforeHash,
  noHeader,
  noHeader + ' ',
  noHeader + ' HASH:',
  str.substring(0, hashIndex + 5), // up to "HASH:"
  noHeader.replace(/ /g, ''), // without spaces
].forEach((c, i) => {
  const h = crypto.createHash('sha512').update(c, 'utf8').digest('hex').toUpperCase();
  console.log(`Comb ${i}:`, h === expectedHash, c.substring(0, 20) + '...', h.substring(0, 16));
});
