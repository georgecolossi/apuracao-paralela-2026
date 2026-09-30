const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const str1 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'), 'utf8');
const str2 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-02-of-02.txt'), 'utf8');

const expectedHash2 = str2.match(/HASH:([A-F0-9]{128})/)[1];

const p1_full = str1.trim();
const p1_nohashassi = str1.substring(0, str1.indexOf(' HASH:'));
const p1_withhash = str1.substring(0, str1.indexOf(' ASSI:'));

const p2_full = str2.trim();
const p2_nohashassi = str2.substring(0, str2.indexOf(' HASH:'));

const optionsP1 = [
  p1_full, p1_nohashassi, p1_withhash, 
  p1_nohashassi.substring(18), p1_withhash.substring(18)
];

const optionsP2 = [
  p2_nohashassi, p2_nohashassi.substring(18)
];

for (const o1 of optionsP1) {
  for (const o2 of optionsP2) {
    const combos = [ o1 + o2, o1 + ' ' + o2, o1 + '\n' + o2 ];
    for (const c of combos) {
      if (crypto.createHash('sha512').update(c, 'utf8').digest('hex').toUpperCase() === expectedHash2) {
        console.log('FOUND IT!');
        console.log('Combo matched!');
        return;
      }
    }
  }
}

console.log('Not found by combos.');
