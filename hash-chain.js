const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const str1 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'), 'utf8').trim();
const str2 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-02-of-02.txt'), 'utf8').trim();

const hash1 = str1.match(/HASH:([A-F0-9]{128})/)[1];
const expectedHash2 = str2.match(/HASH:([A-F0-9]{128})/)[1];

const t2 = str2.substring(0, str2.indexOf(' HASH:'));
const options2 = [
  t2,
  t2.replace(/^QRBU:\d+:\d+ /, ''),
  t2.replace(/^QRBU:\d+:\d+ VRQR:\S+ /, '')
];

for (let o2 of options2) {
  const combos = [
    hash1 + o2,
    hash1 + ' ' + o2,
    o2 + hash1,
    o2 + ' ' + hash1,
    'HASH:' + hash1 + ' ' + o2,
    o2 + ' HASH:' + hash1
  ];
  
  for (let c of combos) {
    if (crypto.createHash('sha512').update(c, 'utf8').digest('hex').toUpperCase() === expectedHash2) {
      console.log('FOUND IT WITH CHAINING!');
      console.log(c.substring(0, 50));
      return;
    }
  }
}

// What about chaining the raw bytes of hash1?
const hash1Bytes = Buffer.from(hash1, 'hex');
for (let o2 of options2) {
  const buf2 = Buffer.from(o2, 'utf8');
  if (crypto.createHash('sha512').update(Buffer.concat([hash1Bytes, buf2])).digest('hex').toUpperCase() === expectedHash2) {
      console.log('FOUND WITH BINARY CHAINING!'); return;
  }
}

console.log('Not chained either.');
