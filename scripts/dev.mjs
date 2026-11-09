import http from 'node:http';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT } from './build.mjs';
import { PUBLIC_FILES, DISTRIBUTION_FILES } from './public-files.mjs';

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

export async function createDevServer({ root = PROJECT_ROOT, source = false } = {}) {
  root = await realpath(root);
  let directory = root;
  let mode = 'fonte';
  if (!source) {
    const candidate = resolve(root, 'dist');
    const stat = await lstat(candidate).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat) {
      if (!stat.isDirectory() || await realpath(candidate) !== candidate) throw new Error('A distribuição local deve ser um diretório regular.');
      directory = candidate;
      mode = 'dist';
    }
  }
  const allowed = new Set(mode === 'dist' ? DISTRIBUTION_FILES : PUBLIC_FILES);
  const server = http.createServer(async (request, response) => {
    const end = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD'); end(405, 'Método não permitido.'); return;
    }
    try {
      // A lista é comparada antes de resolver caminhos. Encoding, query e nomes
      // alternativos nunca ampliam o conjunto de arquivos publicados.
      const rawPath = request.url.split('?')[0];
      const decoded = decodeURIComponent(rawPath);
      const file = decoded === '/' ? 'index.html' : decoded.slice(1);
      if (!decoded.startsWith('/') || decoded.startsWith('//') || !allowed.has(file)) {
        end(404, 'Não encontrado.'); return;
      }
      const target = resolve(directory, file);
      if (await realpath(target) !== target || !(await lstat(target)).isFile()) {
        end(404, 'Não encontrado.'); return;
      }
      const bytes = await readFile(target);
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'text/plain; charset=utf-8',
        'Content-Length': bytes.length, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      end(error.code === 'ENOENT' ? 404 : 400, 'Requisição inválida.');
    }
  });
  return { server, mode };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let port = 4173;
  let source = false;
  let portSeen = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--source' && !source) { source = true; continue; }
    if (args[index] !== '--port' || portSeen || !/^[0-9]{1,5}$/.test(args[index + 1] ?? '')) {
      throw new Error('Use npm run dev -- [--source] [--port 4173].');
    }
    port = Number(args[++index]); portSeen = true;
    if (port > 65535) throw new Error('Porta fora do intervalo permitido.');
  }
  const { server, mode } = await createDevServer({ source });
  server.listen(port, '127.0.0.1', () => console.log(`Local (${mode}): http://127.0.0.1:${server.address().port}/`));
  server.on('error', (error) => { console.error(`Servidor local indisponível: ${error.code ?? 'erro'}.`); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
