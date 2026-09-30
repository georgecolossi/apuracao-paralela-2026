const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const str1 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'), 'utf8');
const str2 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-02-of-02.txt'), 'utf8');

const expectedHash2 = str2.match(/HASH:([A-F0-9]{128})/)[1];
console.log('Expected Hash 2:', expectedHash2);

const p1Body = str1.substring(0, str1.indexOf(' HASH:'));
const p2Body = str2.substring(0, str2.indexOf(' HASH:'));

// Try various combinations of stripping the headers
const strippedP1 = [
  p1Body, // Full
  p1Body.replace(/^QRBU:\d+:\d+ /, ''), // VRQR:...
  p1Body.replace(/^QRBU:\d+:\d+ VRQR:\S+ /, ''), // ORIG:...
];

const strippedP2 = [
  p2Body,
  p2Body.replace(/^QRBU:\d+:\d+ /, ''),
  p2Body.replace(/^QRBU:\d+:\d+ VRQR:\S+ /, ''),
];

for (const s1 of strippedP1) {
  for (const s2 of strippedP2) {
    const combos = [
      s1 + s2,
      s1 + ' ' + s2,
      s1 + '\n' + s2
    ];
    for (const c of combos) {
      if (crypto.createHash('sha512').update(c, 'utf8').digest('hex').toUpperCase() === expectedHash2) {
        console.log('FOUND P2 HASH OVER CONCATENATION!');
        console.log('S1:', s1.substring(0, 20));
        console.log('S2:', s2.substring(0, 20));
        return;
      }
    }
  }
}

console.log('Not found in simple concatenations. Trying to see if part 2 hash is ONLY over part 2...');

// For Part 1, we found that str1.substring(18, hashIndex) matched!
// 18 is exactly after `QRBU:1:2 VRQR:6.0 `
// Let's check part 2 alone again, just in case
for (let i = 0; i < 50; i++) {
  const c = str2.substring(i, str2.indexOf(' HASH:'));
  if (crypto.createHash('sha512').update(c, 'utf8').digest('hex').toUpperCase() === expectedHash2) {
    console.log('FOUND P2 HASH IN P2 ALONE!');
    return;
  }
}

console.log('Nothing found.');
