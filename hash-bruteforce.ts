import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const p1 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-01-of-02.txt'), 'utf8').trim();
const p2 = fs.readFileSync(path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples/UE2013_s02110ac0139200090110-imgbu/decoded/qrbu-02-of-02.txt'), 'utf8').trim();

const p1Body = p1.substring(0, p1.indexOf(' HASH:'));
const p2Body = p2.substring(0, p2.indexOf(' HASH:'));
const p1NoHeader = p1Body.replace(/^QRBU:\d+:\d+ /, '');
const p2NoHeader = p2Body.replace(/^QRBU:\d+:\d+ /, '');

const expectedHashHex = p1.match(/HASH:([A-F0-9]+)/)![1];

console.log('Expected Hash:', expectedHashHex);

function testHash(name: string, content: string) {
  const h = crypto.createHash('sha512').update(content, 'utf8').digest('hex').toUpperCase();
  if (h === expectedHashHex) {
    console.log(`[SUCCESS] ${name}`);
  } else {
    // console.log(`[FAIL] ${name}`);
  }
}

// Candidatos:
// 1. p1Body + p2Body
testHash('p1Body + p2Body', p1Body + p2Body);
testHash('p1Body + " " + p2Body', p1Body + ' ' + p2Body);

// 2. p1NoHeader + p2NoHeader
testHash('p1NoHeader + p2NoHeader', p1NoHeader + p2NoHeader);
testHash('p1NoHeader + " " + p2NoHeader', p1NoHeader + ' ' + p2NoHeader);

// 3. p1Body + p2NoHeader
testHash('p1Body + p2NoHeader', p1Body + p2NoHeader);
testHash('p1Body + " " + p2NoHeader', p1Body + ' ' + p2NoHeader);

// 4. In 2022, the hash for each part was individual? No, usually one global hash. Wait! The hash is identical in BOTH parts!
const expectedHash2 = p2.match(/HASH:([A-F0-9]+)/)![1];
console.log('Is hash same in all parts?', expectedHashHex === expectedHash2);

// 5. What if the hash includes HASH: without the value?
testHash('p1NoHeader + p2NoHeader + HASH:', p1NoHeader + p2NoHeader + ' HASH:');

// Let's brute force a bunch of spaces
testHash('p1NoHeader(VRQR...) + p2NoHeader(VRQR...)', p1NoHeader + p2NoHeader);

// In TSE 2020/2022, the hash is calculated over the concatenation of the parts WITHOUT the QRBU:n:m header, BUT keeping the VRQR? Wait, in 2020 the header wasn't stripped?
// Actually in 2022, each part has `QRBU:n:x VRQR:...`
// The concatenated string for hash is just the exact body of the parts minus HASH and ASSI, concatenated directly.
// Let's try combining the parts by stripping QRBU header from ALL parts except the first? Or from ALL parts?
testHash('p1NoHeader + p2NoHeader', p1NoHeader + p2NoHeader);
testHash('p1NoHeader + p2NoHeader (com espaco)', p1NoHeader + ' ' + p2NoHeader);

const allPartsCombined = p1Body + p2Body;
testHash('p1 raw', p1);
testHash('p1Body', p1Body);
testHash('p1NoHeader', p1NoHeader);

const expectedHashHex2 = p2.match(/HASH:([A-F0-9]+)/)![1];
function testHash2(name: string, content: string) {
  const h = crypto.createHash('sha512').update(content, 'utf8').digest('hex').toUpperCase();
  if (h === expectedHashHex2) console.log(`[SUCCESS] ${name}`);
}
testHash2('p2Body', p2Body);
testHash2('p2NoHeader', p2NoHeader);


