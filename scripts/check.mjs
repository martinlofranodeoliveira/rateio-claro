import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, sha256 } from './build.mjs';
import { PUBLIC_FILES, DISTRIBUTION_FILES } from './public-files.mjs';

const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function requireCheck(condition, message) { if (!condition) throw new Error(message); }

async function listRegular(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    requireCheck(!entry.isSymbolicLink(), 'A distribuição não pode conter links simbólicos.');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listRegular(path, `${relative}/`));
    else {
      requireCheck(entry.isFile(), 'A distribuição deve conter apenas arquivos regulares.');
      files.push(relative);
    }
  }
  return files.sort(ordinal);
}

export async function checkDistribution(root = PROJECT_ROOT, { syntax = true } = {}) {
  root = await realpath(root);
  const dist = resolve(root, 'dist');
  requireCheck((await lstat(dist)).isDirectory() && await realpath(dist) === dist, 'Execute o build em um diretório regular antes da conferência.');
  const actual = await listRegular(dist);
  requireCheck(JSON.stringify(actual) === JSON.stringify([...DISTRIBUTION_FILES].sort(ordinal)), 'A distribuição diverge da lista pública fechada.');
  for (const file of PUBLIC_FILES) {
    const original = resolve(root, file);
    requireCheck(await realpath(original) === original && (await lstat(original)).isFile(), 'A fonte deve ser um arquivo regular local.');
    requireCheck((await readFile(original)).equals(await readFile(resolve(dist, file))), 'O build deve preservar os bytes de todas as fontes públicas.');
  }
  requireCheck((await readFile(resolve(dist, '.nojekyll'))).length === 0, 'O marcador .nojekyll deve ser vazio.');
  const manifestText = await readFile(resolve(dist, 'build-manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  const expected = {
    version: 1, algorithm: 'SHA-256', selfExcluded: 'build-manifest.json', files: {},
  };
  for (const file of actual.filter((file) => file !== 'build-manifest.json')) {
    const bytes = await readFile(resolve(dist, file));
    expected.files[file] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  requireCheck(manifestText === `${JSON.stringify(expected, null, 2)}\n`, 'O manifesto determinístico SHA-256 não confere.');
  requireCheck(JSON.stringify(manifest) === JSON.stringify(expected), 'O manifesto contém campos não previstos.');
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  requireCheck(html.includes('b222baf1'), 'O comentário da direção visual foi removido.');
  requireCheck(html.includes('Content-Security-Policy') && html.includes("connect-src 'none'"), 'O HTML deve declarar CSP sem conexões.');
  requireCheck(!/<(?:script|img|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html), 'Scripts, imagens, estilos e fontes devem ser locais.');
  requireCheck(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'Os módulos executáveis devem permanecer em arquivos locais.');
  const fonts = JSON.parse(await readFile(resolve(dist, 'assets/FONTS.json'), 'utf8'));
  const declaredFonts = ['chivo.ttf', 'public-sans.ttf', 'CHIVO-OFL.txt', 'PUBLIC-SANS-OFL.txt'];
  requireCheck(Array.isArray(fonts.fonts) && fonts.fonts.length === declaredFonts.length, 'A declaração das fontes deve identificar os quatro arquivos locais.');
  for (const file of declaredFonts) {
    const item = fonts.fonts.find((item) => item.file === file);
    const bytes = await readFile(resolve(dist, 'assets', file));
    requireCheck(item && item.bytes === bytes.length && item.sha256 === sha256(bytes) && item.modified === false,
      'Os bytes das fontes ou de suas licenças divergem da proveniência declarada.');
    requireCheck(item.license === 'SIL Open Font License 1.1', 'A licença das fontes deve acompanhar a distribuição.');
  }
  if (syntax) {
    const modules = [...PUBLIC_FILES.filter((file) => file.endsWith('.mjs')),
      'scripts/public-files.mjs', 'scripts/build.mjs', 'scripts/check.mjs', 'scripts/dev.mjs'];
    for (const file of modules) {
      const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8' });
      requireCheck(result.status === 0, `Módulo com sintaxe inválida: ${file}.`);
    }
  }
  return { files: actual.length, manifestEntries: Object.keys(expected.files).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkDistribution();
  console.log(`Conferência concluída: ${result.files} arquivos permitidos, bytes, fontes OFL, módulos e manifesto SHA-256.`);
}
