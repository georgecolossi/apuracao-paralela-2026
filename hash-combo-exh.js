const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const str1 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'), 'utf8').trim();
const str2 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-02-of-02.txt'), 'utf8').trim();

const expectedHash2 = str2.match(/HASH:([A-F0-9]{128})/)[1];

const t1 = str1.substring(0, str1.indexOf(' HASH:'));
const t2 = str2.substring(0, str2.indexOf(' HASH:'));

// Let's generate a list of likely prefixes for t1 and t2
const getPrefixes = (t) => {
  return [
    t,
    t.replace(/^QRBU:\d+:\d+ /, ''),
    t.replace(/^QRBU:\d+:\d+ VRQR:\S+ /, '')
  ];
};

const getSuffixes = (t) => {
  return [
    t,
    t + ' ',
    t + ' HASH:',
  ];
};

let options1 = [];
for (let p of getPrefixes(t1)) {
  for (let s of getSuffixes(p)) options1.push(s);
}

let options2 = [];
for (let p of getPrefixes(t2)) {
  for (let s of getSuffixes(p)) options2.push(s);
}

for (let o1 of options1) {
  for (let o2 of options2) {
    const combos = [
      o1 + o2, o1 + ' ' + o2, o1 + '\n' + o2,
      o2 + o1, o2 + ' ' + o1
    ];
    for (let c of combos) {
      if (crypto.createHash('sha512').update(c, 'utf8').digest('hex').toUpperCase() === expectedHash2) {
        console.log('FOUND P2!');
        console.log(c.substring(0, 50));
        return;
      }
    }
  }
}

console.log('Not found.');
