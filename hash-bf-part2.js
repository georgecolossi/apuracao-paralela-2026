const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const str1 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'), 'utf8');
const str2 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-02-of-02.txt'), 'utf8');

const hashMatch = str2.match(/HASH:([A-F0-9]{128})/);
const expectedHash = hashMatch[1];
const hashIndex = hashMatch.index;

const part1Body = str1.substring(18, str1.indexOf(' HASH:'));
const part2Body = str2.substring(18, hashIndex);

console.log('Expected:', expectedHash);

const combo1 = part1Body + part2Body;
const combo2 = part1Body + ' ' + part2Body;

if (crypto.createHash('sha512').update(combo1, 'utf8').digest('hex').toUpperCase() === expectedHash) {
  console.log('FOUND: combo1 (part1Body + part2Body)');
}
if (crypto.createHash('sha512').update(combo2, 'utf8').digest('hex').toUpperCase() === expectedHash) {
  console.log('FOUND: combo2 (part1Body + space + part2Body)');
}

const part1Raw = str1.substring(0, str1.indexOf(' HASH:'));
const part2Raw = str2.substring(0, hashIndex);

if (crypto.createHash('sha512').update(part1Raw + part2Raw, 'utf8').digest('hex').toUpperCase() === expectedHash) {
  console.log('FOUND: part1Raw + part2Raw');
}

const part1NoQRBU = str1.replace(/^QRBU:\d+:\d+ /, '');
const part2NoQRBU = str2.replace(/^QRBU:\d+:\d+ /, '');

if (crypto.createHash('sha512').update(part1NoQRBU.substring(0, part1NoQRBU.indexOf(' HASH:')) + part2NoQRBU.substring(0, part2NoQRBU.indexOf(' HASH:')), 'utf8').digest('hex').toUpperCase() === expectedHash) {
  console.log('FOUND: part1NoQRBU + part2NoQRBU');
}

// Bruteforce str2 alone starting from 0 to 30
for (let i = 0; i < 30; i++) {
    const sub = str2.substring(i, hashIndex);
    if (crypto.createHash('sha512').update(sub, 'utf8').digest('hex').toUpperCase() === expectedHash) {
        console.log('FOUND in str2 alone, start:', i);
    }
    const sub2 = str2.substring(i, hashIndex - 1); // remove trailing space
    if (crypto.createHash('sha512').update(sub2, 'utf8').digest('hex').toUpperCase() === expectedHash) {
        console.log('FOUND in str2 alone, start:', i, 'without trailing space');
    }
}
