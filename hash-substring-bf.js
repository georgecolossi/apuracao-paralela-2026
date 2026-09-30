const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const raw = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'));
const str = raw.toString('utf8');

const hashMatch = str.match(/HASH:([A-F0-9]{128})/);
const expectedHash = hashMatch[1];
const hashIndex = hashMatch.index;

console.log('Expected:', expectedHash);

let found = false;
console.log('Searching all substrings...');

for (let i = 0; i < 50; i++) { // start can only be around the beginning
  for (let j = hashIndex - 20; j <= hashIndex + 20; j++) { // end is around HASH:
    if (j <= i) continue;
    const sub = str.substring(i, j);
    const h = crypto.createHash('sha512').update(sub, 'utf8').digest('hex').toUpperCase();
    if (h === expectedHash) {
      console.log('FOUND IT!');
      console.log('Start index:', i);
      console.log('End index:', j);
      console.log('Substring starts with:', sub.substring(0, 20));
      console.log('Substring ends with:', sub.substring(sub.length - 20));
      found = true;
    }
  }
}

if (!found) {
  console.log('Not found by simple substring. Trying without QRBU header...');
  const body = str.substring(str.indexOf(' VRQR:'), str.length);
  for (let i = 0; i < 20; i++) {
    for (let j = hashIndex - 20; j <= hashIndex + 20; j++) {
      if (j <= i) continue;
      const sub = body.substring(i, j);
      const h = crypto.createHash('sha512').update(sub, 'utf8').digest('hex').toUpperCase();
      if (h === expectedHash) {
        console.log('FOUND IT (No header)!');
        found = true;
      }
    }
  }
}

if (!found) {
  console.log('Not found anywhere in substrings.');
}
