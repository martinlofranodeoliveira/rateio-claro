import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, readdir, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import http from 'node:http';
import { build, PROJECT_ROOT } from '../scripts/build.mjs';
import { checkDistribution } from '../scripts/check.mjs';
import { createDevServer } from '../scripts/dev.mjs';
import { PUBLIC_FILES, DISTRIBUTION_FILES } from '../scripts/public-files.mjs';

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'rateio-dist-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of PUBLIC_FILES) {
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await copyFile(resolve(PROJECT_ROOT, file), resolve(root, file));
  }
  return root;
}

async function list(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await list(resolve(directory, entry.name), `${file}/`));
    else files.push(file);
  }
  return files.sort();
}

async function serve(t, root, source) {
  const { server, mode } = await createDevServer({ root, source });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  t.after(() => new Promise((accept) => server.close(accept)));
  assert.equal(server.address().address, '127.0.0.1');
  return { port: server.address().port, mode };
}

function request(port, path, method = 'GET') {
  return new Promise((accept, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (bytes) => chunks.push(bytes));
      res.on('end', () => accept({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('build determinístico usa whitelist, conserva bytes e comentário, sem dados locais', async (t) => {
  const root = await fixture(t);
  await mkdir(resolve(root, 'local'), { recursive: true });
  await writeFile(resolve(root, 'local/segredo.txt'), 'NÃO PUBLICAR');
  await writeFile(resolve(root, '.env'), 'NÃO PUBLICAR');
  const first = await build(root);
  const manifest = await readFile(resolve(root, 'dist/build-manifest.json'));
  assert.deepEqual(await list(resolve(root, 'dist')), [...DISTRIBUTION_FILES].sort());
  for (const file of PUBLIC_FILES) assert.ok((await readFile(resolve(root, file))).equals(await readFile(resolve(root, 'dist', file))));
  assert.ok((await readFile(resolve(root, 'dist/index.html'), 'utf8')).includes('b222baf1'));
  assert.ok(!manifest.toString('utf8').includes(root));
  assert.ok(!manifest.toString('utf8').includes('NÃO PUBLICAR'));
  await utimes(resolve(root, 'index.html'), new Date(0), new Date(0));
  assert.deepEqual(await build(root), first);
  assert.ok(manifest.equals(await readFile(resolve(root, 'dist/build-manifest.json'))));
  assert.deepEqual(await checkDistribution(root, { syntax: false }), { files: DISTRIBUTION_FILES.length, manifestEntries: DISTRIBUTION_FILES.length - 1 });
});

test('fonte ausente, link simbólico e comentário removido recusam build sem apagar dist', async (t) => {
  const root = await fixture(t);
  await build(root);
  const manifest = await readFile(resolve(root, 'dist/build-manifest.json'));
  const app = await readFile(resolve(root, 'src/app.mjs'));
  await rm(resolve(root, 'src/app.mjs'));
  await assert.rejects(build(root));
  assert.ok(manifest.equals(await readFile(resolve(root, 'dist/build-manifest.json'))));
  await writeFile(resolve(root, 'outside.mjs'), app);
  await symlink(resolve(root, 'outside.mjs'), resolve(root, 'src/app.mjs'));
  await assert.rejects(build(root), /links simbólicos/);
  assert.ok(manifest.equals(await readFile(resolve(root, 'dist/build-manifest.json'))));
  await rm(resolve(root, 'src/app.mjs'));
  await writeFile(resolve(root, 'src/app.mjs'), app);
  await writeFile(resolve(root, 'index.html'), '<html></html>');
  await assert.rejects(build(root), /direção visual/);
  assert.ok(manifest.equals(await readFile(resolve(root, 'dist/build-manifest.json'))));
});

test('conferência detecta byte alterado, arquivo extra e link em dist', async (t) => {
  const root = await fixture(t);
  await build(root);
  await writeFile(resolve(root, 'dist/src/core.mjs'), 'alterado');
  await assert.rejects(checkDistribution(root, { syntax: false }), /preservar os bytes/);
  await build(root);
  await writeFile(resolve(root, 'dist/segredo.txt'), 'extra');
  await assert.rejects(checkDistribution(root, { syntax: false }), /lista pública/);
  await build(root);
  await rm(resolve(root, 'dist/src/core.mjs'));
  await symlink(resolve(root, 'src/core.mjs'), resolve(root, 'dist/src/core.mjs'));
  await assert.rejects(checkDistribution(root, { syntax: false }), /links simbólicos/);
});

test('servidor fonte só lê whitelist, liga em loopback e respeita GET/HEAD', async (t) => {
  const root = await fixture(t);
  await mkdir(resolve(root, 'local'), { recursive: true });
  await writeFile(resolve(root, 'local/segredo.txt'), 'NÃO PUBLICAR');
  const { port, mode } = await serve(t, root, false);
  assert.equal(mode, 'fonte');
  const page = await request(port, '/');
  assert.equal(page.status, 200);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  const head = await request(port, '/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers['content-length']), page.body.length);
  assert.equal((await request(port, '/', 'POST')).status, 405);
  assert.equal((await request(port, '/%')).status, 400);
  assert.equal((await request(port, '/src/core.mjs?cache=1')).status, 200);
  for (const path of ['/local/segredo.txt', '/.env', '/.git/config', '/tools/check_downloads.py', '/tests/core.test.mjs',
    '/build-manifest.json', '/src/../local/segredo.txt', '/%2e%2e/local/segredo.txt', '/%2flocal/segredo.txt', '//index.html', '/assets/']) {
    assert.equal((await request(port, path)).status, 404, path);
  }
  await rm(resolve(root, 'assets/marca.svg'));
  await symlink(resolve(root, 'local/segredo.txt'), resolve(root, 'assets/marca.svg'));
  assert.equal((await request(port, '/assets/marca.svg')).status, 404);
});

test('servidor prefere dist existente e --source permite iteração explícita', async (t) => {
  const root = await fixture(t);
  await build(root);
  const original = await readFile(resolve(root, 'index.html'));
  await writeFile(resolve(root, 'index.html'), '<!-- b222baf1 -->FONTE ALTERADA');
  const production = await serve(t, root, false);
  const source = await serve(t, root, true);
  assert.equal(production.mode, 'dist');
  assert.equal(source.mode, 'fonte');
  assert.ok((await request(production.port, '/')).body.equals(original));
  assert.equal((await request(source.port, '/')).body.toString('utf8'), '<!-- b222baf1 -->FONTE ALTERADA');
  assert.equal((await request(production.port, '/build-manifest.json')).status, 200);
  await rm(resolve(root, 'dist/src/app.mjs'));
  assert.equal((await request(production.port, '/src/app.mjs')).status, 404);
});
