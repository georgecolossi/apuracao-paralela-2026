const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const p1 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'), 'utf8').trim();
const p2 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-02-of-02.txt'), 'utf8').trim();

const p1Body = p1.substring(0, p1.indexOf(' HASH:'));
const p2Body = p2.substring(0, p2.indexOf(' HASH:'));
const p1NoHeader = p1Body.replace(/^QRBU:\d+:\d+ /, '');
const p2NoHeader = p2Body.replace(/^QRBU:\d+:\d+ /, '');

const expectedHashHex = p1.match(/HASH:([A-F0-9]+)/)[1];
const expectedHashHex2 = p2.match(/HASH:([A-F0-9]+)/)[1];

console.log('Expected Hash 1:', expectedHashHex);
console.log('Expected Hash 2:', expectedHashHex2);

function testHash(name, content) {
  const h = crypto.createHash('sha512').update(content, 'utf8').digest('hex').toUpperCase();
  if (h === expectedHashHex) {
    console.log(`[SUCCESS 1] ${name}`);
  }
}

function testHash2(name, content) {
  const h = crypto.createHash('sha512').update(content, 'utf8').digest('hex').toUpperCase();
  if (h === expectedHashHex2) {
    console.log(`[SUCCESS 2] ${name}`);
  }
}

// Em eleições brasileiras passadas, o HASH de cada parte costuma ser o hash da string exata que antecede o " HASH:".
// Se cada parte tiver um hash diferente (e eles têm!), o input para o p1 é p1Body, e para o p2 é p2Body.
testHash('p1 raw', p1);
testHash('p1Body', p1Body);
testHash('p1NoHeader', p1NoHeader);

testHash2('p2 raw', p2);
testHash2('p2Body', p2Body);
testHash2('p2NoHeader', p2NoHeader);

