import fs from 'fs';
import path from 'path';

const RELEVANT_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.css', '.prisma', '.html', '.yml', '.yaml'];
const EXCLUDED_DIRS = ['node_modules', '.next', '.git', 'backups', 'qrb-test-concordia', 'external-fixtures', 'test-results', 'dist'];

// Arquivos que testam explicitamente detecção de mojibake e contêm strings de teste legítimas
const EXCLUDED_FILES_FOR_MOJIBAKE_REGEX = [
  'pre-election-audit.test.ts',
  'metadata.integration.test.ts',
  'encoding-audit.test.ts',
  'check-source-encoding.mjs'
];

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

// Padrões de Mojibake decorrentes de decodificação dupla Windows-1252 / ISO-8859-1 -> UTF-8
// Ex: Ã£ (ã), Ã§ (ç), Ã© (é), Ã³ (ó), Ã¡ (á), Ãª (ê), Ãº (ú), Ã­ (í), Ã‰ (É), etc.
const MOJIBAKE_REGEX = /\u00C3[\u00A0-\u00BF]|\u00C2[\u00A0-\u00BF]/g;

function checkFile(fullPath) {
  let fileError = false;
  const filename = path.basename(fullPath);

  // 1. Ler bytes brutos
  const rawBytes = fs.readFileSync(fullPath);

  // 2. Validação estrita de bytes UTF-8 (rejeita sequências de bytes inválidas para UTF-8)
  let content = '';
  try {
    content = utf8Decoder.decode(rawBytes);
  } catch (err) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Bytes inválidos para codificação UTF-8 encontrados em: ${fullPath} (${err.message})`);
    return true;
  }

  // 3. Detecção de U+FFFD (Replacement Character indicativo de corrupção prévia)
  if (content.includes('\uFFFD')) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Arquivo contém caractere corrompido U+FFFD (Replacement Character): ${fullPath}`);
    fileError = true;
  }

  // 4. Detecção de sequências de mojibake
  if (!EXCLUDED_FILES_FOR_MOJIBAKE_REGEX.includes(filename)) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const match = line.match(MOJIBAKE_REGEX);
      if (match) {
        console.error(`\x1b[31m[ERROR]\x1b[0m Padrão de mojibake detectado (${match.slice(0, 3).join(', ')}) na linha ${idx + 1} de: ${fullPath}`);
        fileError = true;
      }
    });
  }

  return fileError;
}

function checkDir(dir) {
  let hasError = false;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (EXCLUDED_DIRS.includes(file)) continue;
    
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (checkDir(fullPath)) hasError = true;
    } else {
      const ext = path.extname(fullPath).toLowerCase();
      if (RELEVANT_EXTENSIONS.includes(ext)) {
        if (checkFile(fullPath)) hasError = true;
      }
    }
  }
  return hasError;
}

console.log('Iniciando verificação estrita de encoding e integridade UTF-8 dos arquivos-fonte...');
const failed = checkDir('.');

if (failed) {
  console.error('\x1b[31mFalha: Foram detectados problemas de encoding (bytes inválidos, U+FFFD ou mojibake) nos fontes.\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32mSucesso: Todos os arquivos-fonte possuem codificação UTF-8 íntegra, sem U+FFFD e sem mojibake.\x1b[0m');
  process.exit(0);
}
