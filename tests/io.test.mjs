import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LedgerError, analyze, validateProject } from '../src/core.mjs';
import { demoProject } from '../src/demo.mjs';
import {
  parseProject, serializeProject, exportMemory, exportBalancesCsv,
  exportAllocationsCsv, exportSuggestionsCsv, exportMarkdown,
} from '../src/io.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const exporters = [serializeProject, exportMemory, exportBalancesCsv, exportAllocationsCsv, exportSuggestionsCsv, exportMarkdown];
const plainDemo = () => JSON.parse(serializeProject(demoProject()));
const importFails = (source, code) => assert.throws(() => parseProject(source), error =>
  error instanceof LedgerError && error.code === code && typeof error.path === 'string');

test('fixture autoral é a saída Node do exemplo atual e faz ida e volta exata', async () => {
  const fixture = await readFile(new URL('../fixtures/demo-project.json', import.meta.url), 'utf8');
  assert.equal(fixture, serializeProject(demoProject()));
  const imported = parseProject(fixture);
  assert.deepEqual(imported, demoProject());
  assert.equal(serializeProject(imported), fixture);
  assert.ok(Object.isFrozen(imported.expenses[0].shares[0]));
  assert.ok(fixture.endsWith('\n'));
  assert.ok(!fixture.includes('\r'));
  assert.ok(fixture.startsWith('{\n  "version": 1,\n  "title":'));
});

test('serialização fixa a ordem dos campos e preserva a ordem das coleções', () => {
  const source = plainDemo();
  source.participants.reverse();
  const reordered = {
    transfers: source.transfers, expenses: source.expenses, participants: source.participants,
    currency: source.currency, title: source.title, version: source.version,
  };
  assert.equal(serializeProject(reordered), serializeProject(source));
  assert.equal(parseProject(serializeProject(reordered)).participants[0].id, 'diego');
});

test('memória mantém inteiros racionais como strings inclusive além de 2^53', () => {
  const project = plainDemo();
  project.expenses = [{
    id: 'grande', description: 'Numerador exato', payer: 'ana', amountCents: 1_000_000_000_000,
    shares: [{ participant: 'ana', weight: 1_000_000_000 }, { participant: 'bruno', weight: 999_999_999 }],
  }];
  project.transfers = [];
  const memory = JSON.parse(exportMemory(project));
  assert.deepEqual(Object.keys(memory), ['version', 'title', 'currency', 'analysis']);
  assert.deepEqual(memory.analysis, analyze(project));
  assert.equal(memory.analysis.receipts[0].allocations[0].numerator, '1000000000000000000000');
  assert.equal(memory.analysis.receipts[0].allocations[1].numerator, '999999999000000000000');
  assert.equal(memory.analysis.receipts[0].allocations[0].denominator, '1999999999');
  assert.equal(typeof memory.analysis.receipts[0].allocations[0].remainder, 'string');
  assert.ok(!exportAllocationsCsv(project).includes('1000000000000000000000'));
});

test('recusa decimais e expoentes originais antes de JSON.parse arredondar', () => {
  const source = serializeProject(demoProject());
  for (const token of ['12001.0', '1.2001e4', '120010e-1', '1000000000000.00001', '1e309', '-1.0', '0.1', '1E+2']) {
    importFails(source.replace('"amountCents": 12001', `"amountCents": ${token}`), 'IMPORT_NUMBER');
  }
  assert.equal(JSON.parse('{"amountCents":1000000000000.00001}').amountCents, 1_000_000_000_000);
  importFails(source.replace('"version": 1', '"version": 1.0'), 'IMPORT_NUMBER');
  importFails(source.replace('"weight": 1', '"weight": 1e0'), 'IMPORT_NUMBER');
});

test('varredura ignora números, barras e aspas escapadas dentro de textos', () => {
  const project = plainDemo();
  project.title = 'Literal 1e309, 3.14, "weight": 1.0, \\ fim';
  project.expenses[0].description = 'A string tem \\"amountCents": 1000000000000.00001';
  assert.deepEqual(parseProject(serializeProject(project)), validateProject(project));
});

test('recusa chaves repetidas, inclusive escapadas e aninhadas, sem ecoar dados', () => {
  const source = serializeProject(demoProject());
  importFails(source.replace('"version": 1,', '"version": 1, "version": 1,'), 'IMPORT_DUPLICATE_KEY');
  importFails(source.replace('"version": 1,', '"version": 1, "\\u0076ersion": 1,'), 'IMPORT_DUPLICATE_KEY');
  importFails(source.replace('"weight": 1', '"weight": 1, "weight": 1'), 'IMPORT_DUPLICATE_KEY');
  assert.throws(() => parseProject('{"segredo-autoral":1,"segredo-autoral":2}'), error =>
    error.code === 'IMPORT_DUPLICATE_KEY' && !error.message.includes('segredo-autoral') && error.path === '');
  assert.deepEqual(parseProject(source), demoProject()); // Same key in distinct objects is valid.
});

test('UTF-8 estrito, BOM e tipos incorretos são recusados', () => {
  const source = serializeProject(demoProject());
  const bytes = new TextEncoder().encode(source);
  assert.deepEqual(parseProject(bytes), demoProject());
  const wrapped = new Uint8Array(bytes.length + 2);
  wrapped[0] = 0xff;
  wrapped.set(bytes, 1);
  wrapped[wrapped.length - 1] = 0xff;
  assert.deepEqual(parseProject(wrapped.subarray(1, -1)), demoProject());
  for (const invalid of [[0xff], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) {
    importFails(new Uint8Array(invalid), 'IMPORT_UTF8');
  }
  importFails(`\ufeff${source}`, 'IMPORT_BOM');
  importFails(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]), 'IMPORT_BOM');
  importFails('"\ud800"', 'IMPORT_UTF8');
  for (const invalid of [null, {}, [], 1, new ArrayBuffer(1)]) importFails(invalid, 'IMPORT_INPUT');
});

test('limite de 2 MiB é medido nos bytes originais antes de interpretar JSON', () => {
  const source = serializeProject(demoProject());
  const exact = `${source}${' '.repeat(MAX_BYTES - Buffer.byteLength(source))}`;
  assert.deepEqual(parseProject(exact), demoProject());
  assert.deepEqual(parseProject(new TextEncoder().encode(exact)), demoProject());
  importFails(`${exact} `, 'IMPORT_SIZE');
  importFails(new Uint8Array(MAX_BYTES + 1), 'IMPORT_SIZE');
  // Fewer than 2 Mi characters, but more than 2 MiB of UTF-8.
  importFails('é'.repeat(MAX_BYTES / 2 + 1), 'IMPORT_SIZE');
});

test('JSON malformado e raízes fora do esquema não são aceitos', () => {
  for (const source of ['', ' ', '{', '[1,]', '{"a":1,}', '{"a" 1}', '{"a":01}', 'true false', 'NaN', '{"a":"\\q"}', '{"a":"linha\nquebrada"}', '['.repeat(70) + '0' + ']'.repeat(70)]) {
    importFails(source, 'IMPORT_JSON');
  }
  for (const source of ['[]', '{}', 'null', '1', '"texto"', 'true']) {
    assert.throws(() => parseProject(source), LedgerError);
  }
  const source = serializeProject(demoProject());
  assert.throws(() => parseProject(source.replace('"weight": 1', '"weight": 9007199254740993')), LedgerError);
});

test('todos exports recusam getters, toJSON próprio e arrays extras sem executar código', () => {
  for (const exporter of exporters) {
    let calls = 0;
    const withGetter = plainDemo();
    Object.defineProperty(withGetter, 'title', { enumerable: true, get() { calls += 1; return 'Vazou'; } });
    assert.throws(() => exporter(withGetter), LedgerError);
    const withHook = plainDemo();
    withHook.toJSON = () => { calls += 1; return {}; };
    assert.throws(() => exporter(withHook), LedgerError);
    const extraArrayProperty = plainDemo();
    Object.defineProperty(extraArrayProperty.participants, 'extra', { enumerable: true, get() { calls += 1; return 1; } });
    assert.throws(() => exporter(extraArrayProperty), LedgerError);
    assert.equal(calls, 0);
  }
});

test('toJSON herdado não é executado por validação nem exports', () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  let calls = 0;
  try {
    Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { calls += 1; throw new Error('hook executado'); } });
    for (const exporter of exporters) assert.equal(typeof exporter(demoProject()), 'string');
  } finally {
    if (previous) Object.defineProperty(Object.prototype, 'toJSON', previous);
    else delete Object.prototype.toJSON;
  }
  assert.equal(calls, 0);
});

test('CSV do exemplo tem cabeçalhos e centavos literais exatos', () => {
  assert.equal(exportBalancesCsv(demoProject()), [
    'participant_id,name,paid_cents,share_cents,sent_cents,received_cents,balance_cents',
    'ana,Ana,12001,8151,0,2000,1850', 'bruno,Bruno,6900,5300,0,0,1600',
    'clara,Clara,8000,8150,0,0,-150', 'diego,Diego,0,5300,2000,0,-3300', '',
  ].join('\n'));
  assert.equal(exportAllocationsCsv(demoProject()), [
    'expense_id,description,payer,participant_id,name,weight,total_weight,base_cents,remainder,extra_cents,share_cents',
    'almoco,Almoço compartilhado,ana,ana,Ana,1,4,3000,1,1,3001',
    'almoco,Almoço compartilhado,ana,bruno,Bruno,1,4,3000,1,0,3000',
    'almoco,Almoço compartilhado,ana,clara,Clara,1,4,3000,1,0,3000',
    'almoco,Almoço compartilhado,ana,diego,Diego,1,4,3000,1,0,3000',
    'ingressos,Ingressos da visita,clara,ana,Ana,1,2,4000,0,0,4000',
    'ingressos,Ingressos da visita,clara,clara,Clara,1,2,4000,0,0,4000',
    'transporte,Transporte do grupo,bruno,ana,Ana,1,6,1150,0,0,1150',
    'transporte,Transporte do grupo,bruno,bruno,Bruno,2,6,2300,0,0,2300',
    'transporte,Transporte do grupo,bruno,clara,Clara,1,6,1150,0,0,1150',
    'transporte,Transporte do grupo,bruno,diego,Diego,2,6,2300,0,0,2300', '',
  ].join('\n'));
  assert.equal(exportSuggestionsCsv(demoProject()), [
    'status,from_id,from_name,to_id,to_name,amount_cents',
    'suggestion,clara,Clara,ana,Ana,150', 'suggestion,diego,Diego,ana,Ana,1700',
    'suggestion,diego,Diego,bruno,Bruno,1600', '',
  ].join('\n'));
});

test('totais dos CSV conservam despesas, parcelas e saldos sem somar acertos ao custo', () => {
  const balances = exportBalancesCsv(demoProject()).trim().split('\n').slice(1).map(line => line.split(','));
  assert.equal(balances.reduce((sum, row) => sum + Number(row[2]), 0), 26901);
  assert.equal(balances.reduce((sum, row) => sum + Number(row[3]), 0), 26901);
  assert.equal(balances.reduce((sum, row) => sum + Number(row[4]), 0), 2000);
  assert.equal(balances.reduce((sum, row) => sum + Number(row[5]), 0), 2000);
  assert.equal(balances.reduce((sum, row) => sum + Number(row[6]), 0), 0);
  const allocations = exportAllocationsCsv(demoProject()).trim().split('\n').slice(1).map(line => line.split(','));
  const expected = { almoco: 12001, ingressos: 8000, transporte: 6900 };
  for (const [id, amount] of Object.entries(expected)) {
    assert.equal(allocations.filter(row => row[0] === id).reduce((sum, row) => sum + Number(row[10]), 0), amount);
  }
  assert.equal(exportSuggestionsCsv(demoProject()).trim().split('\n').slice(1).reduce((sum, line) => sum + Number(line.split(',')[5]), 0), 3450);
});

test('CSV protege líderes de fórmula em texto e cita vírgulas/aspas sem mudar JSON', () => {
  const project = plainDemo();
  project.participants[0].name = '=SUM(1,2)';
  project.participants[1].name = '+1';
  project.participants[2].name = '-2';
  project.participants[3].name = '@"Ana", grupo';
  project.expenses[0].description = '=HYPERLINK("https://example.invalid","Abrir")';
  const before = serializeProject(project);
  const balances = exportBalancesCsv(project);
  assert.ok(balances.includes('ana,"\'=SUM(1,2)",12001'));
  assert.ok(balances.includes("bruno,'+1,6900"));
  assert.ok(balances.includes("clara,'-2,8000"));
  assert.ok(balances.includes('diego,"\'@""Ana"", grupo",0'));
  assert.ok(exportAllocationsCsv(project).includes('"\'=HYPERLINK(""https://example.invalid"",""Abrir"")"'));
  assert.ok(exportSuggestionsCsv(project).includes("suggestion,clara,'-2,ana,"));
  assert.equal(serializeProject(project), before);
  assert.equal(parseProject(before).participants[0].name, '=SUM(1,2)');
  assert.ok(balances.includes(',-150\n')); // Numeric balances remain numeric.
});

test('Markdown separa registros/sugestões e documenta os critérios sem alterar o projeto', () => {
  const project = demoProject();
  const before = serializeProject(project);
  const report = exportMarkdown(project);
  assert.ok(report.includes('Despesas: **R$ 269,01**. Acertos registrados: **R$ 20,00**. Saldo pendente: **R$ 34,50**.'));
  assert.ok(report.includes('| Ana (ana) | 1 | 12001 | 4 | 3000 | 1 | 1 | R$ 30,01 |'));
  assert.ok(report.includes('Cada despesa é rateada separadamente'));
  assert.ok(report.includes('empate pelo ID estável em ordem ASCII'));
  assert.ok(report.includes('não garante o número mínimo de transferências'));
  assert.ok(report.includes('Saldo positivo significa valor a receber'));
  const [registered, suggested] = report.split('## Acertos registrados')[1].split('## Sugestões NÃO registradas');
  assert.ok(registered.includes('Acerto declarado no exemplo'));
  assert.ok(registered.includes('R$ 20,00'));
  assert.ok(!registered.includes('R$ 17,00'));
  assert.ok(suggested.includes('R$ 1,50') && suggested.includes('R$ 17,00') && suggested.includes('R$ 16,00'));
  assert.ok(!suggested.includes('Acerto declarado no exemplo'));
  assert.equal(serializeProject(project), before);
  assert.ok(report.endsWith('\n') && !report.includes('\r'));
});

test('Markdown escapa todos os textos autorais, HTML e sintaxe de tabela/link/código', () => {
  const project = plainDemo();
  project.title = '<script>alert(1)</script> & [t](javascript:alert(1))';
  project.participants[0].name = '**Ana** | <img src=x onerror=alert(1)>';
  project.expenses[0].description = '# [x](https://example.invalid) `código`';
  project.transfers[0].note = '<svg/onload=alert(1)> | ![imagem](x) \\';
  const report = exportMarkdown(project);
  assert.ok(report.includes('&lt;script&gt;alert\\(1\\)&lt;\\/script&gt; &amp; \\[t\\]\\(javascript\\:alert\\(1\\)\\)'));
  assert.ok(report.includes('\\*\\*Ana\\*\\* \\| &lt;img src\\=x onerror\\=alert\\(1\\)&gt;'));
  assert.ok(report.includes('\\# \\[x\\]\\(https\\:\\/\\/example\\.invalid\\) \\`código\\`'));
  assert.ok(report.includes('&lt;svg\\/onload\\=alert\\(1\\)&gt; \\| \\!\\[imagem\\]\\(x\\) \\\\'));
  for (const raw of [project.title, project.participants[0].name, project.expenses[0].description, project.transfers[0].note]) {
    assert.ok(!report.includes(raw));
  }
  assert.ok(!report.includes('<script') && !report.includes('<img') && !report.includes('<svg'));
});

test('projeto vazio produz cabeçalhos CSV e seções Markdown sem registros fictícios', () => {
  const project = { version: 1, title: 'Vazio', currency: 'BRL', participants: [], expenses: [], transfers: [] };
  assert.equal(exportBalancesCsv(project).split('\n').length, 2);
  assert.equal(exportAllocationsCsv(project).split('\n').length, 2);
  assert.equal(exportSuggestionsCsv(project).split('\n').length, 2);
  const report = exportMarkdown(project);
  assert.ok(report.includes('Nenhuma despesa registrada.'));
  assert.ok(report.includes('Nenhum acerto registrado.'));
  assert.ok(report.includes('Nenhuma sugestão pendente.'));
});
