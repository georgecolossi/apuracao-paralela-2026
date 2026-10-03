const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");

const ROOT = path.join(process.cwd(), "qrb-test-concordia");

const common =
  "VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2100 DTPL:20261004 " +
  "PLEI:3220 TURN:1 FASE:S UNFE:SC MUNI:80837 ZONA:90 ";

const scenarios = {
  A_1QR: [
    common +
      "SECA:901 AGRE:1 IDUE:9900001 IDCA:990000000000000000000001 " +
      "VERS:10.20.0.0 LOCA:1 APTO:100 " +

      "CARG:7 TIPO:1 " +
      "PART:22 22555:12 " +
      "PART:11 11130:8 " +

      "CARG:6 TIPO:1 " +
      "PART:22 2200:15 2222:10 " +
      "PART:13 1313:9 " +

      "CARG:5 TIPO:0 " +
      "221:20 222:15 133:12 " +

      "CARG:3 TIPO:0 " +
      "22:45 55:35 " +

      "CARG:1 TIPO:0 " +
      "13:40 22:50"
  ],

  B_2QR: [
    common +
      "SECA:902 AGRE:1 IDUE:9900002 IDCA:990000000000000000000002 " +
      "VERS:10.20.0.0 LOCA:2 APTO:120 " +

      "CARG:7 TIPO:1 " +
      "PART:22 22555:20 " +
      "PART:11 11130:14 " +

      "CARG:6 TIPO:1 " +
      "PART:22 2200:18 2222:22",

    "VRQR:6.0 " +
      "PART:13 1313:16 " +
      "PART:30 3050:11 " +

      "CARG:5 TIPO:0 " +
      "221:25 222:18 133:20 " +

      "CARG:3 TIPO:0 " +
      "22:52 55:43 " +

      "CARG:1 TIPO:0 " +
      "13:55 22:48"
  ],

  C_3QR: [
    common +
      "SECA:903 AGRE:1 IDUE:9900003 IDCA:990000000000000000000003 " +
      "VERS:10.20.0.0 LOCA:3 APTO:140 " +

      "CARG:7 TIPO:1 " +
      "PART:22 22555:25 " +
      "PART:11 11130:17",

    "VRQR:6.0 " +
      "CARG:6 TIPO:1 " +
      "PART:22 2200:30 2222:26 " +
      "PART:13 1313:21 " +
      "PART:30 3050:13 " +

      "CARG:5 TIPO:0 " +
      "221:30 222:24 133:22",

    "VRQR:6.0 " +
      "CARG:3 TIPO:0 " +
      "22:60 55:50 " +

      "CARG:1 TIPO:0 " +
      "13:65 22:58"
  ]
};

function calculateHash(bodies) {
  /*
   * Replica Tse2026HashValidator:
   *
   * 1. QRBU:n:x e VRQR são removidos de cada parte.
   * 2. Conteúdo das partes é unido com espaço.
   * 3. Na última parte HASH em diante não participa.
   * 4. SHA-512 UTF-8.
   */

  const processed = bodies.map(body => {
    return body.replace(/^VRQR:\S+\s+/, "");
  });

  const hashInput = processed.join(" ");

  return crypto
    .createHash("sha512")
    .update(hashInput, "utf8")
    .digest("hex")
    .toUpperCase();
}

async function generateScenario(name, bodies) {
  const directory = path.join(ROOT, name);

  fs.mkdirSync(directory, {
    recursive: true
  });

  const totalParts = bodies.length;
  const hash = calculateHash(bodies);

  console.log("");
  console.log("========================================");
  console.log(name);
  console.log("PARTES:", totalParts);
  console.log("HASH:", hash);
  console.log("========================================");

  for (let i = 0; i < bodies.length; i++) {
    const partNumber = i + 1;

    let payload =
      `QRBU:${partNumber}:${totalParts} ` +
      bodies[i];

    /*
     * HASH somente na última parte.
     * ASSI propositalmente ausente:
     * é um BU sintético, não assinado pelo TSE.
     */
    if (partNumber === totalParts) {
      payload += ` HASH:${hash}`;
    }

    const baseName =
      `qrbu-${String(partNumber).padStart(2, "0")}` +
      `-of-${String(totalParts).padStart(2, "0")}`;

    const txtPath =
      path.join(directory, `${baseName}.txt`);

    const pngPath =
      path.join(directory, `${baseName}.png`);

    fs.writeFileSync(
      txtPath,
      payload,
      "utf8"
    );

    await QRCode.toFile(
      pngPath,
      payload,
      {
        errorCorrectionLevel: "M",
        margin: 4,
        width: 1000
      }
    );

    console.log(
      `Gerado ${name} - QR ${partNumber}/${totalParts}`
    );
  }

  fs.writeFileSync(
    path.join(directory, "HASH.txt"),
    hash,
    "utf8"
  );
}

async function main() {
  console.log("");
  console.log("QRBU SINTÉTICOS - CONCÓRDIA/SC");
  console.log("========================================");
  console.log("ATENÇÃO: USAR SOMENTE NO STAGING");
  console.log("NÃO SÃO BOLETINS OFICIAIS DO TSE");
  console.log("========================================");

  fs.mkdirSync(ROOT, {
    recursive: true
  });

  for (const [name, bodies] of Object.entries(scenarios)) {
    await generateScenario(name, bodies);
  }

  const expected = `
QRBU SINTÉTICOS - CONCÓRDIA/SC
========================================

NÃO SÃO BOLETINS OFICIAIS.
USO EXCLUSIVO PARA TESTE NO STAGING.

Contexto:

PLEI: 3220
TURN: 1
UF: SC
MUNI: 80837

----------------------------------------
CENÁRIO A
----------------------------------------

Seção: 901
Urna: 9900001
QRs: 1

----------------------------------------
CENÁRIO B
----------------------------------------

Seção: 902
Urna: 9900002
QRs: 2

----------------------------------------
CENÁRIO C
----------------------------------------

Seção: 903
Urna: 9900003
QRs: 3

========================================
RESULTADO NOMINAL AGREGADO ESPERADO
========================================

PRESIDENTE

13 = 160
22 = 156

GOVERNADOR

22 = 157
55 = 128

SENADOR

221 = 75
222 = 57
133 = 54

DEPUTADO FEDERAL

2200 = 63
2222 = 58
1313 = 46
3050 = 24

DEPUTADO ESTADUAL

22555 = 57
11130 = 39

========================================
`;

  fs.writeFileSync(
    path.join(ROOT, "RESULTADO-ESPERADO.txt"),
    expected.trim() + "\n",
    "utf8"
  );

  console.log("");
  console.log("========================================");
  console.log("GERAÇÃO CONCLUÍDA");
  console.log("========================================");
  console.log("");
  console.log("Arquivos:");
  console.log(ROOT);
  console.log("");
  console.log("ATENÇÃO: NÃO ESCANEIE ESTES QRs EM PRODUÇÃO.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});