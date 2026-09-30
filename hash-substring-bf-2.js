const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const str2 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-02-of-02.txt'), 'utf8');

const hashMatch = str2.match(/HASH:([A-F0-9]{128})/);
const expectedHash = hashMatch[1];
const hashIndex = hashMatch.index;

const startString = str2.indexOf('APTA:'); // Because part 2 usually starts with APTA or whatever is next
console.log('Index of APTA:', startString);

let found = false;
for (let i = 0; i < 30; i++) { 
  for (let j = hashIndex - 2; j <= hashIndex + 2; j++) {
    if (j <= i) continue;
    const sub = str2.substring(i, j);
    const h = crypto.createHash('sha512').update(sub, 'utf8').digest('hex').toUpperCase();
    if (h === expectedHash) {
      console.log('FOUND IT PART 2!');
      console.log('Start index:', i);
      console.log('End index:', j);
      console.log('Substring starts with:', sub.substring(0, 20));
      console.log('Substring ends with:', sub.substring(sub.length - 20));
      found = true;
    }
  }
}
