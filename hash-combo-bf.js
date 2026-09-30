const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const str1 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'), 'utf8');
const str2 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-02-of-02.txt'), 'utf8');

const hashMatch = str2.match(/HASH:([A-F0-9]{128})/);
const expectedHash = hashMatch[1];
const targetIndex = str1.length + 1 + hashMatch.index;

const fullStr = str1.trim() + ' ' + str2.trim();

console.log('Searching in full combined string...');

for (let i = 0; i < str1.length + 50; i++) {
  // Let's check exactly ending at the start of HASH: in part 2
  const sub = fullStr.substring(i, targetIndex);
  if (crypto.createHash('sha512').update(sub, 'utf8').digest('hex').toUpperCase() === expectedHash) {
    console.log('FOUND IT AT I=', i);
    console.log('Sub starts:', sub.substring(0, 30));
    return;
  }
}

// What if the parts are joined without ' '?
const fullStrNoSpace = str1.trim() + str2.trim();
const targetIndexNoSpace = str1.trim().length + hashMatch.index;
for (let i = 0; i < str1.length + 50; i++) {
  const sub = fullStrNoSpace.substring(i, targetIndexNoSpace);
  if (crypto.createHash('sha512').update(sub, 'utf8').digest('hex').toUpperCase() === expectedHash) {
    console.log('FOUND IT AT I=', i, '(No Space)');
    console.log('Sub starts:', sub.substring(0, 30));
    return;
  }
}

// What if the hash is over ALL of part 1, minus HASH and ASSI?
const p1Base = str1.substring(18, str1.indexOf(' HASH:'));
const p2Base = str2.substring(18, str2.indexOf(' HASH:'));
const combinedP1P2 = p1Base + p2Base;

if (crypto.createHash('sha512').update(combinedP1P2, 'utf8').digest('hex').toUpperCase() === expectedHash) {
  console.log('FOUND P1BASE + P2BASE');
}
