import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES } from './public-files.mjs';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export async function build(root = PROJECT_ROOT) {
  root = await realpath(root);
  // Primeiro lê os arquivos permitidos. Uma fonte ausente conserva o dist anterior.
  const files = new Map();
  for (const file of PUBLIC_FILES) {
    const target = resolve(root, file);
    if (await realpath(target) !== target || !(await lstat(target)).isFile()) {
      throw new Error('A distribuição exige arquivos locais regulares, sem links simbólicos.');
    }
    files.set(file, await readFile(target));
  }
  if (!files.get('index.html').toString('utf8').includes('b222baf1')) {
    throw new Error('O comentário da direção visual deve permanecer no HTML.');
  }
  files.set('.nojekyll', Buffer.alloc(0));
  const manifest = {
    version: 1,
    algorithm: 'SHA-256',
    selfExcluded: 'build-manifest.json',
    files: Object.fromEntries([...files].sort(([a], [b]) => ordinal(a, b)).map(([file, bytes]) => [file, {
      bytes: bytes.length, sha256: sha256(bytes),
    }])),
  };
  files.set('build-manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  const staging = await mkdtemp(resolve(root, '.dist-build-'));
  try {
    for (const [file, bytes] of files) {
      const target = resolve(staging, file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    await rm(resolve(root, 'dist'), { recursive: true, force: true });
    await rename(staging, resolve(root, 'dist'));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await build();
  console.log(`Distribuição pronta: ${Object.keys(manifest.files).length + 1} arquivos, manifesto SHA-256 e fontes locais.`);
}
