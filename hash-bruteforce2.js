const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const p1 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'), 'utf8').trim();
const p1Body = p1.substring(0, p1.indexOf(' HASH:'));
const expectedHashHex = p1.match(/HASH:([A-F0-9]+)/)[1];

console.log('Expected:', expectedHashHex);

['utf8', 'latin1', 'ascii'].forEach(enc => {
  const h = crypto.createHash('sha512').update(p1Body, enc).digest('hex').toUpperCase();
  console.log(`${enc} p1Body:`, h);
  if (h === expectedHashHex) console.log(`SUCCESS! ${enc} p1Body`);
});

const p1NoHeader = p1Body.replace(/^QRBU:\d+:\d+ /, '');
['utf8', 'latin1', 'ascii'].forEach(enc => {
  const h = crypto.createHash('sha512').update(p1NoHeader, enc).digest('hex').toUpperCase();
  console.log(`${enc} p1NoHeader:`, h);
  if (h === expectedHashHex) console.log(`SUCCESS! ${enc} p1NoHeader`);
});
