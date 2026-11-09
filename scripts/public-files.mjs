/** Nenhum diretório inteiro é publicado. A lista também limita o servidor local. */
export const PUBLIC_FILES = Object.freeze([
  'index.html',
  'styles.css',
  'src/app.mjs',
  'src/core.mjs',
  'src/demo.mjs',
  'src/io.mjs',
  'assets/marca.svg',
  'assets/FONTS.json',
  'assets/chivo.ttf',
  'assets/public-sans.ttf',
  'assets/CHIVO-OFL.txt',
  'assets/PUBLIC-SANS-OFL.txt',
  'LICENSE',
]);
export const GENERATED_FILES = Object.freeze(['.nojekyll', 'build-manifest.json']);
export const DISTRIBUTION_FILES = Object.freeze([...PUBLIC_FILES, ...GENERATED_FILES]);
