import fs from 'fs';
import path from 'path';

const RELEVANT_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.css', '.prisma'];
const EXCLUDED_DIRS = ['node_modules', '.next', '.git', 'backups', 'qrb-test-concordia', 'external-fixtures'];

function checkDir(dir) {
  let hasError = false;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (EXCLUDED_DIRS.includes(file) || file === 'check-source-encoding.mjs') continue;
    
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (checkDir(fullPath)) hasError = true;
    } else {
      const ext = path.extname(fullPath);
      if (RELEVANT_EXTENSIONS.includes(ext)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        // Search for literal U+FFFD (Replacement Character)
        if (content.includes('\uFFFD')) {
          console.error(`\x1b[31m[ERROR]\x1b[0m Arquivo contém caractere U+FFFD (Replacement Character): ${fullPath}`);
          hasError = true;
        }

        // Search for mojibake patterns using unicode escapes to avoid self-matching
        const mojibakeRegex = new RegExp('\\u00C3[\\u00A0-\\u00BF]|\\u00C2[\\u00A0-\\u00BF]', 'g');
        const mojibakeMatch = content.match(mojibakeRegex);
        if (mojibakeMatch && !fullPath.includes('pre-election-audit.test.ts')) {
          console.error(`\x1b[31m[ERROR]\x1b[0m Arquivo contém padrão de mojibake (${mojibakeMatch.slice(0, 3).join(', ')}): ${fullPath}`);
          hasError = true;
        }
      }
    }
  }
  return hasError;
}

console.log('Iniciando verificação de encoding de arquivos-fonte...');
const failed = checkDir('.');

if (failed) {
  console.error('\x1b[31mFalha: Encontrado caractere corrompido literal (U+FFFD) nos fontes.\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32mSucesso: Nenhum caractere corrompido detectado.\x1b[0m');
  process.exit(0);
}
