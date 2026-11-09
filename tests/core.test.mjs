import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LedgerError, limits, createProject, validateProject, setTitle,
  upsertParticipant, removeParticipant, upsertExpense, removeExpense,
  upsertTransfer, removeTransfer, parseMoney, formatMoney, analyze,
} from '../src/core.mjs';
import { demoProject } from '../src/demo.mjs';

const copy = (value) => JSON.parse(JSON.stringify(value));
const base = (ids = ['a', 'b', 'c']) => ({
  version: 1, title: 'Conferência', currency: 'BRL',
  participants: ids.map((id) => ({ id, name: id.toUpperCase() })), expenses: [], transfers: [],
});
const expense = (id = 'e', amountCents = 100, shares = [{ participant: 'b', weight: 1 }], payer = 'a') => ({
  id, description: 'Despesa de conferência', payer, amountCents, shares,
});
const transfer = (id = 't', from = 'b', to = 'a', amountCents = 100) => ({ id, from, to, amountCents, note: '' });

function rejects(action, code, path) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof LedgerError);
    assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
    assert.equal(typeof error.path, 'string');
    if (path !== undefined) assert.equal(error.path, path);
    return true;
  });
}

function assertFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertFrozen(child);
}

test('o exemplo literal conserva custo, acerto, parcelas, saldos e sugestões', () => {
  const result = analyze(demoProject());
  assert.equal(result.totalExpenseCents, 26901);
  assert.equal(result.totalTransferCents, 2000);
  assert.equal(result.pendingCents, 3450);
  assert.deepEqual(result.participants, [
    { id: 'ana', name: 'Ana', paidCents: 12001, shareCents: 8151, sentCents: 0, receivedCents: 2000, balanceCents: 1850 },
    { id: 'bruno', name: 'Bruno', paidCents: 6900, shareCents: 5300, sentCents: 0, receivedCents: 0, balanceCents: 1600 },
    { id: 'clara', name: 'Clara', paidCents: 8000, shareCents: 8150, sentCents: 0, receivedCents: 0, balanceCents: -150 },
    { id: 'diego', name: 'Diego', paidCents: 0, shareCents: 5300, sentCents: 2000, receivedCents: 0, balanceCents: -3300 },
  ]);
  assert.deepEqual(result.suggestions, [
    { from: 'clara', to: 'ana', amountCents: 150 },
    { from: 'diego', to: 'ana', amountCents: 1700 },
    { from: 'diego', to: 'bruno', amountCents: 1600 },
  ]);
  assert.deepEqual(result.receipts.map((item) => item.expenseId), ['almoco', 'ingressos', 'transporte']);
  assert.deepEqual(result.receipts[0].allocations, [
    { participant: 'ana', weight: 1, numerator: '12001', denominator: '4', baseCents: 3000, remainder: '1', extraCents: 1, shareCents: 3001 },
    { participant: 'bruno', weight: 1, numerator: '12001', denominator: '4', baseCents: 3000, remainder: '1', extraCents: 0, shareCents: 3000 },
    { participant: 'clara', weight: 1, numerator: '12001', denominator: '4', baseCents: 3000, remainder: '1', extraCents: 0, shareCents: 3000 },
    { participant: 'diego', weight: 1, numerator: '12001', denominator: '4', baseCents: 3000, remainder: '1', extraCents: 0, shareCents: 3000 },
  ]);
  assert.deepEqual(result.receipts[1].allocations.map((item) => item.shareCents), [4000, 4000]);
  assert.deepEqual(result.receipts[2].allocations.map((item) => item.shareCents), [1150, 2300, 1150, 2300]);
  assert.equal(result.participants.reduce((sum, person) => sum + person.balanceCents, 0), 0);
  assertFrozen(result);
});

test('quocientes e restos literais permanecem exatos acima de 2^53', () => {
  const project = base(['a', 'b']);
  project.expenses = [expense('grande', 999999999999, [
    { participant: 'a', weight: 999999999 }, { participant: 'b', weight: 2 },
  ])];
  const receipt = analyze(project).receipts[0];
  assert.equal(receipt.totalWeight, 1000000001);
  assert.deepEqual(receipt.allocations, [
    { participant: 'a', weight: 999999999, numerator: '999999998999000000001', denominator: '1000000001', baseCents: 999999997999, remainder: '2002', extraCents: 0, shareCents: 999999997999 },
    { participant: 'b', weight: 2, numerator: '1999999999998', denominator: '1000000001', baseCents: 1999, remainder: '999997999', extraCents: 1, shareCents: 2000 },
  ]);
  assert.equal(receipt.allocations.reduce((sum, item) => sum + item.shareCents, 0), 999999999999);
  assert.doesNotThrow(() => JSON.stringify(analyze(project)));
});

// Oráculo independente: busca todas as composições inteiras do valor e minimiza
// o erro quadrático racional. Não calcula piso, resto ou centavos restantes.
function exhaustiveOracle(amount, weights) {
  const denominator = BigInt(weights.reduce((sum, weight) => sum + weight, 0));
  let best;
  let bestScore;
  function visit(prefix, remaining) {
    if (prefix.length === weights.length - 1) {
      const candidate = [...prefix, remaining];
      const score = candidate.reduce((sum, allocation, index) => {
        const error = BigInt(allocation) * denominator - BigInt(amount) * BigInt(weights[index]);
        return sum + error * error;
      }, 0n);
      const firstDifference = best ? candidate.findIndex((item, index) => item !== best[index]) : -1;
      if (best === undefined || score < bestScore
        || (score === bestScore && firstDifference >= 0 && candidate[firstDifference] > best[firstDifference])) {
        best = candidate;
        bestScore = score;
      }
      return;
    }
    for (let allocation = 0; allocation <= remaining; allocation += 1) visit([...prefix, allocation], remaining - allocation);
  }
  visit([], amount);
  return best;
}

test('512 rateios pequenos coincidem com o oráculo exaustivo de erro racional', () => {
  for (let amount = 1; amount <= 8; amount += 1) {
    for (let a = 1; a <= 4; a += 1) for (let b = 1; b <= 4; b += 1) for (let c = 1; c <= 4; c += 1) {
      const project = base(['c', 'b', 'a']);
      project.expenses = [expense('e', amount, [
        { participant: 'c', weight: c }, { participant: 'a', weight: a }, { participant: 'b', weight: b },
      ])];
      const allocations = analyze(project).receipts[0].allocations;
      assert.deepEqual(allocations.map((item) => item.shareCents), exhaustiveOracle(amount, [a, b, c]), `valor=${amount}; pesos=${a},${b},${c}`);
      assert.equal(allocations.reduce((sum, item) => sum + item.shareCents, 0), amount);
    }
  }
});

test('arredonda cada despesa e documenta a diferença de juntar registros', () => {
  const shares = [{ participant: 'a', weight: 1 }, { participant: 'b', weight: 1 }];
  const separate = base(['b', 'a']);
  separate.expenses = [expense('e1', 1, shares, 'b'), expense('e2', 1, shares, 'b')];
  const merged = { ...separate, expenses: [expense('e1', 2, shares, 'b')] };
  assert.deepEqual(analyze(separate).participants.map((person) => person.shareCents), [2, 0]);
  assert.deepEqual(analyze(merged).participants.map((person) => person.shareCents), [1, 1]);
  assert.equal(analyze(separate).totalExpenseCents, analyze(merged).totalExpenseCents);
});

test('multiplicar todos os pesos preserva parcelas e o desempate segue o ID', () => {
  const project = base(['c', 'b', 'a']);
  project.expenses = [expense('e', 13, [
    { participant: 'c', weight: 3 }, { participant: 'b', weight: 2 }, { participant: 'a', weight: 1 },
  ])];
  const scaled = copy(project);
  scaled.expenses[0].shares.forEach((share) => { share.weight *= 17; });
  assert.deepEqual(analyze(project).participants, analyze(scaled).participants);
  project.expenses[0] = expense('e', 1, [{ participant: 'b', weight: 1 }, { participant: 'a', weight: 1 }]);
  assert.deepEqual(analyze(project).receipts[0].allocations.map((item) => item.shareCents), [1, 0]);
});

test('pagador fora dos beneficiários recebe o custo completo', () => {
  const project = base();
  project.expenses = [expense('e', 501, [{ participant: 'b', weight: 1 }, { participant: 'c', weight: 2 }])];
  const result = analyze(project);
  assert.deepEqual(result.participants.map((person) => person.balanceCents), [501, -167, -334]);
  assert.deepEqual(result.suggestions, [{ from: 'b', to: 'a', amountCents: 167 }, { from: 'c', to: 'a', amountCents: 334 }]);
});

test('acerto não é custo, reduz dívida, e sobrepagamento pode inverter o saldo', () => {
  const project = base(['a', 'b']);
  project.expenses = [expense()];
  const before = analyze(project);
  project.transfers = [transfer('t', 'b', 'a', 150)];
  const after = analyze(project);
  assert.equal(after.totalExpenseCents, 100);
  assert.equal(after.totalTransferCents, 150);
  assert.equal(after.pendingCents, 50);
  assert.deepEqual(after.receipts, before.receipts);
  assert.deepEqual(after.participants.map((person) => person.balanceCents), [-50, 50]);
  assert.deepEqual(after.suggestions, [{ from: 'a', to: 'b', amountCents: 50 }]);
});

test('registrar as sugestões como acertos zera todos os saldos', () => {
  let project = demoProject();
  const first = analyze(project);
  for (const [index, suggestion] of first.suggestions.entries()) {
    project = upsertTransfer(project, { id: `replay-${index}`, ...suggestion, note: 'Conferência do algoritmo' });
  }
  const result = analyze(project);
  assert.equal(result.totalExpenseCents, 26901);
  assert.equal(result.totalTransferCents, 5450);
  assert.equal(result.pendingCents, 0);
  assert.ok(result.participants.every((person) => person.balanceCents === 0));
  assert.deepEqual(result.suggestions, []);
  assert.equal(first.pendingCents, 3450);
});

test('algoritmo determinístico admite um contraexemplo com menos transferências', () => {
  const project = base(['d', 'c', 'b', 'a']);
  project.transfers = [transfer('t1', 'c', 'b', 3), transfer('t2', 'd', 'a', 2)];
  const result = analyze(project);
  assert.equal(result.totalExpenseCents, 0);
  assert.deepEqual(result.participants.map((person) => person.balanceCents), [-2, -3, 3, 2]);
  assert.deepEqual(result.suggestions, [
    { from: 'a', to: 'c', amountCents: 2 }, { from: 'b', to: 'c', amountCents: 1 }, { from: 'b', to: 'd', amountCents: 2 },
  ]);
  const alternative = copy(project);
  alternative.transfers.push(transfer('t3', 'a', 'd', 2), transfer('t4', 'b', 'c', 3));
  assert.equal(analyze(alternative).pendingCents, 0);
});

test('ordem de entrada não altera a análise e a validação conserva a ordem autoral', () => {
  const original = copy(demoProject());
  original.transfers.push(transfer('outro-01', 'bruno', 'clara', 1), transfer('outro-02', 'clara', 'diego', 2));
  const reordered = copy(original);
  reordered.participants.reverse();
  reordered.expenses.reverse();
  reordered.expenses.forEach((item) => item.shares.reverse());
  reordered.transfers.reverse();
  assert.deepEqual(analyze(reordered), analyze(original));
  assert.deepEqual(validateProject(reordered), reordered);
});

test('ordem de IDs usa ASCII ordinal, inclusive hífen, dígito e sublinhado', () => {
  const project = base(['a_z', 'a0', 'a-z']);
  project.expenses = [expense('e_z', 1, [
    { participant: 'a_z', weight: 1 }, { participant: 'a0', weight: 1 }, { participant: 'a-z', weight: 1 },
  ], 'a_z'), expense('e0', 1, [{ participant: 'a0', weight: 1 }], 'a_z'), expense('e-z', 1, [{ participant: 'a0', weight: 1 }], 'a_z')];
  const result = analyze(project);
  assert.deepEqual(result.participants.map((person) => person.id), ['a-z', 'a0', 'a_z']);
  assert.deepEqual(result.receipts.map((receipt) => receipt.expenseId), ['e-z', 'e0', 'e_z']);
  assert.deepEqual(result.receipts[2].allocations.map((share) => [share.participant, share.shareCents]), [['a-z', 1], ['a0', 0], ['a_z', 0]]);
});

test('homônimos continuam distintos e renomear não muda a identidade nem os valores', () => {
  let project = base(['b', 'a']);
  project.participants.forEach((person) => { person.name = 'Alex'; });
  project.expenses = [expense('e', 1, [{ participant: 'b', weight: 1 }, { participant: 'a', weight: 1 }], 'b')];
  const before = analyze(project);
  project = upsertParticipant(project, { id: 'a', name: 'Nome novo' });
  const after = analyze(project);
  assert.deepEqual(after.participants.map(({ name, ...person }) => person), before.participants.map(({ name, ...person }) => person));
  assert.deepEqual(after.suggestions, before.suggestions);
  assert.equal(after.participants[0].name, 'Nome novo');
  assert.equal(after.participants[1].name, 'Alex');
  assert.deepEqual(project.participants.map((person) => person.id), ['b', 'a']);
});

test('projetos novos, exemplos e validações não compartilham referências mutáveis', () => {
  const input = copy(demoProject());
  const checked = validateProject(input);
  const originalAnalysis = analyze(checked);
  input.title = 'Mudança externa';
  input.participants[0].name = 'Mudança externa';
  input.expenses[0].shares[0].weight = 200;
  input.transfers[0].amountCents = 1;
  assert.deepEqual(analyze(checked), originalAnalysis);
  assertFrozen(checked);
  assert.notEqual(validateProject(checked), checked);
  assert.notEqual(validateProject(checked).expenses[0].shares, checked.expenses[0].shares);
  assert.notEqual(demoProject(), demoProject());
  const first = createProject();
  assert.notEqual(first, createProject());
  assertFrozen(first);
  assert.deepEqual(first, { version: 1, title: 'Novo rateio', currency: 'BRL', participants: [], expenses: [], transfers: [] });
  assert.deepEqual(analyze(first), { totalExpenseCents: 0, totalTransferCents: 0, pendingCents: 0, participants: [], receipts: [], suggestions: [] });
  assert.throws(() => { checked.expenses[0].shares[0].weight = 2; }, TypeError);
});

test('edições são imutáveis, mantêm posição, acrescentam no fim e removem explicitamente', () => {
  const original = demoProject();
  let project = setTitle(original, 'Outra conferência');
  project = upsertParticipant(project, { id: 'bruno', name: 'Bruno editado' });
  project = upsertParticipant(project, { id: 'eva', name: 'Eva' });
  project = upsertExpense(project, { ...original.expenses[0], description: 'Almoço editado' });
  project = upsertExpense(project, expense('extra', 1, [{ participant: 'eva', weight: 1 }], 'eva'));
  project = upsertTransfer(project, { ...original.transfers[0], note: 'Acerto editado' });
  project = upsertTransfer(project, transfer('extra', 'eva', 'ana', 1));
  assert.deepEqual(project.participants.map((item) => item.id), ['ana', 'bruno', 'clara', 'diego', 'eva']);
  assert.deepEqual(project.expenses.map((item) => item.id), ['almoco', 'transporte', 'ingressos', 'extra']);
  assert.deepEqual(project.transfers.map((item) => item.id), ['acerto-01', 'extra']);
  assert.equal(original.title, 'Um sábado entre amigos');
  assert.equal(original.expenses[0].description, 'Almoço compartilhado');
  project = removeTransfer(project, 'extra');
  project = removeExpense(project, 'extra');
  project = removeParticipant(project, 'eva');
  assert.equal(project.participants.length, 4);
  assert.equal(project.expenses.length, 3);
  assert.equal(project.transfers.length, 1);
  assertFrozen(project);
});

test('remoção referenciada é recusada integralmente, inclusive só em acertos', () => {
  const original = demoProject();
  const before = copy(original);
  for (const person of original.participants) rejects(() => removeParticipant(original, person.id), 'E_IN_USE');
  assert.deepEqual(original, before);
  const onlyTransfer = base(['a', 'b']);
  onlyTransfer.transfers = [transfer()];
  rejects(() => removeParticipant(onlyTransfer, 'a'), 'E_IN_USE');
  rejects(() => removeParticipant(onlyTransfer, 'b'), 'E_IN_USE');
  rejects(() => removeParticipant(original, 'ausente'), 'E_NOT_FOUND');
  rejects(() => removeExpense(original, 'ausente'), 'E_NOT_FOUND');
  rejects(() => removeTransfer(original, 'ausente'), 'E_NOT_FOUND');
});

test('toda mutação revalida o projeto de entrada e não aplica entrada inválida', () => {
  const invalid = { ...base(), currency: 'USD' };
  for (const action of [
    () => setTitle(invalid, 'Título'), () => upsertParticipant(invalid, { id: 'z', name: 'Z' }),
    () => removeParticipant(invalid, 'a'), () => upsertExpense(invalid, expense()),
    () => removeExpense(invalid, 'e'), () => upsertTransfer(invalid, transfer()), () => removeTransfer(invalid, 't'),
  ]) rejects(action, 'E_CURRENCY', 'currency');
  const original = demoProject();
  rejects(() => upsertExpense(original, { ...original.expenses[0], amountCents: 0 }), 'E_INTEGER');
  rejects(() => upsertTransfer(original, { ...original.transfers[0], to: 'ausente' }), 'E_REFERENCE');
  rejects(() => upsertParticipant(original, { id: 'ana', name: ' Nome ' }), 'E_TEXT');
  assert.equal(analyze(original).pendingCents, 3450);
});

test('parseMoney usa gramática decimal explícita e confere o limite antes de Number', () => {
  for (const [text, cents] of [
    ['0', 0], ['0,0', 0], ['0.01', 1], ['1,2', 120], ['1.20', 120], [' 42,09 ', 4209],
    ['\t\n1\r ', 100], ['10000000000.00', 1000000000000], ['9999999999.99', 999999999999],
  ]) assert.equal(parseMoney(text), cents);
  for (const text of ['', ' ', '00', '01', '00.1', '.5', ',5', '1.', '1,', '1.234', '1,234',
    '1.000,00', '1,000.00', 'R$ 1', '+1', '-1', '1e2', '1 2', '1\n2', 'NaN', 'Infinity',
    '\u00a01\u00a0', '１', '0x10']) rejects(() => parseMoney(text), 'E_MONEY');
  for (const value of [null, 1, {}, new String('1')]) rejects(() => parseMoney(value), 'E_MONEY');
  for (const text of ['10000000000.01', '10000000001', '9'.repeat(1000)]) rejects(() => parseMoney(text), 'E_LIMIT');
});

test('formatMoney independe de locale e representa os limites e sinais', () => {
  for (const [cents, text] of [
    [0, 'R$ 0,00'], [-0, 'R$ 0,00'], [1, 'R$ 0,01'], [120, 'R$ 1,20'],
    [123456, 'R$ 1.234,56'], [-123456, '-R$ 1.234,56'],
    [2000000000000, 'R$ 20.000.000.000,00'], [-2000000000000, '-R$ 20.000.000.000,00'],
  ]) assert.equal(formatMoney(cents), text);
  for (const value of [1.1, NaN, Infinity, '100', 2000000000001, -2000000000001]) rejects(() => formatMoney(value), 'E_INTEGER');
});

test('rejeita campos ausentes, desconhecidos, símbolos, classes e listas não comuns', () => {
  const missing = base();
  delete missing.title;
  rejects(() => validateProject(missing), 'E_FIELDS');
  const unknown = { ...base(), segredo_do_chamador: 'valor sensível' };
  assert.throws(() => validateProject(unknown), (error) => {
    assert.ok(error instanceof LedgerError);
    assert.ok(!`${error.message}${error.path}`.includes('segredo_do_chamador'));
    assert.ok(!`${error.message}${error.path}`.includes('valor sensível'));
    return true;
  });
  rejects(() => validateProject({ ...base(), [Symbol('oculto')]: 1 }), 'E_FIELDS');
  class Project { constructor() { Object.assign(this, base()); } }
  rejects(() => validateProject(new Project()), 'E_TYPE');
  rejects(() => validateProject(new Date()), 'E_TYPE');
  rejects(() => validateProject(null), 'E_TYPE');
  rejects(() => validateProject([]), 'E_TYPE');
  const nullPrototype = Object.assign(Object.create(null), base());
  assert.deepEqual(validateProject(nullPrototype), base());
  for (const kind of ['hole', 'extra', 'symbol', 'prototype']) {
    const project = base();
    if (kind === 'hole') delete project.participants[1];
    if (kind === 'extra') project.participants.extra = 1;
    if (kind === 'symbol') project.participants[Symbol('extra')] = 1;
    if (kind === 'prototype') Object.setPrototypeOf(project.participants, null);
    rejects(() => validateProject(project), kind === 'prototype' ? 'E_TYPE' : 'E_FIELDS');
  }
});

test('nenhum getter, setter ou toJSON do chamador é executado', () => {
  let calls = 0;
  const getter = () => { calls += 1; throw new Error('Getter executado'); };
  for (const location of ['project', 'participant', 'expense', 'share', 'transfer', 'array']) {
    const project = base();
    project.expenses = [expense()];
    project.transfers = [transfer()];
    const [target, key] = location === 'project' ? [project, 'title']
      : location === 'participant' ? [project.participants[0], 'name']
        : location === 'expense' ? [project.expenses[0], 'description']
          : location === 'share' ? [project.expenses[0].shares[0], 'weight']
            : location === 'transfer' ? [project.transfers[0], 'note'] : [project.participants, '0'];
    Object.defineProperty(target, key, { get: getter, set: getter, enumerable: true });
    rejects(() => validateProject(project), 'E_FIELDS');
  }
  const ownToJson = { ...base(), toJSON: getter };
  rejects(() => validateProject(ownToJson), 'E_FIELDS');
  const old = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  try {
    Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value: getter });
    assert.doesNotThrow(() => validateProject(base()));
  } finally {
    if (old) Object.defineProperty(Object.prototype, 'toJSON', old);
    else delete Object.prototype.toJSON;
  }
  assert.equal(calls, 0);
});

test('identificadores, referências e duplicatas são validados em todas as coleções', () => {
  for (const id of ['', 'A', 'a b', '1a', 'á', 'a'.repeat(41)]) {
    const project = base(); project.participants[0].id = id;
    rejects(() => validateProject(project), 'E_ID');
  }
  assert.doesNotThrow(() => validateProject(base(['a', 'a_1-z', `a${'0'.repeat(39)}`])));
  for (const collection of ['participants', 'expenses', 'transfers']) {
    const project = base(); project.expenses = [expense()]; project.transfers = [transfer()];
    project[collection].push({ ...project[collection][0] });
    rejects(() => validateProject(project), 'E_DUPLICATE');
  }
  const duplicateShare = base();
  duplicateShare.expenses = [expense('e', 1, [{ participant: 'a', weight: 1 }, { participant: 'a', weight: 2 }])];
  rejects(() => validateProject(duplicateShare), 'E_DUPLICATE');
  for (const field of ['payer', 'share', 'from', 'to']) {
    const project = base(); project.expenses = [expense()]; project.transfers = [transfer()];
    if (field === 'payer') project.expenses[0].payer = 'ausente';
    if (field === 'share') project.expenses[0].shares[0].participant = 'ausente';
    if (field === 'from' || field === 'to') project.transfers[0][field] = 'ausente';
    rejects(() => validateProject(project), 'E_REFERENCE');
  }
  const self = base(); self.transfers = [transfer('t', 'a', 'a')];
  rejects(() => validateProject(self), 'E_SAME_PARTICIPANT');
});

test('valida textos por pontos Unicode e recusa controles e surrogates isolados', () => {
  for (const title of ['', ' Espaço', 'Espaço ', 'a\n', 'a\u0000b', 'a\u007fb', 'a\u2028b', 'a\u2029b', '\ufffe', '\uffff', '\ud800', '\udfff']) {
    rejects(() => validateProject({ ...base(), title }), 'E_TEXT');
  }
  assert.doesNotThrow(() => validateProject({ ...base(), title: '🙂'.repeat(120) }));
  rejects(() => validateProject({ ...base(), title: '🙂'.repeat(121) }), 'E_TEXT');
  for (const [target, key, maximum] of [['participant', 'name', 80], ['expense', 'description', 160], ['transfer', 'note', 160]]) {
    const project = base(); project.expenses = [expense()]; project.transfers = [transfer()];
    const record = target === 'participant' ? project.participants[0] : target === 'expense' ? project.expenses[0] : project.transfers[0];
    record[key] = '🙂'.repeat(maximum);
    assert.doesNotThrow(() => validateProject(project));
    record[key] += '🙂';
    rejects(() => validateProject(project), 'E_TEXT');
    record[key] = 1;
    rejects(() => validateProject(project), 'E_TEXT');
  }
});

test('limites monetários são inteiros seguros, separados por coleção e permitem saldo de ±2e12', () => {
  for (const amount of [0, -1, 0.1, NaN, Infinity, 1000000000001, Number.MAX_SAFE_INTEGER + 1, '100']) {
    for (const collection of ['expenses', 'transfers']) {
      const project = base();
      project[collection] = collection === 'expenses' ? [expense('e', amount)] : [transfer('t', 'b', 'a', amount)];
      rejects(() => validateProject(project), 'E_INTEGER');
    }
  }
  for (const weight of [0, -1, 1.5, NaN, Infinity, 1000000001, '1']) {
    const project = base(); project.expenses = [expense('e', 1, [{ participant: 'a', weight }])];
    rejects(() => validateProject(project), 'E_INTEGER');
  }
  for (const collection of ['expenses', 'transfers']) {
    const project = base();
    project[collection] = collection === 'expenses'
      ? [expense('e1', limits.amountCents), expense('e2', 1)]
      : [transfer('t1', 'a', 'b', limits.amountCents), transfer('t2', 'a', 'b', 1)];
    rejects(() => validateProject(project), 'E_LIMIT', collection);
  }
  const project = base(['a', 'b']);
  project.expenses = [expense('e', limits.amountCents)];
  project.transfers = [transfer('t', 'a', 'b', limits.amountCents)];
  const result = analyze(project);
  assert.equal(result.totalExpenseCents, 1000000000000);
  assert.equal(result.totalTransferCents, 1000000000000);
  assert.equal(result.pendingCents, 2000000000000);
  assert.deepEqual(result.participants.map((person) => person.balanceCents), [2000000000000, -2000000000000]);
});

test('limites de coleções e beneficiários incluem a fronteira válida', () => {
  const project = base(Array.from({ length: 100 }, (_, index) => `p${index}`));
  project.expenses = Array.from({ length: 500 }, (_, index) => expense(`e${index}`, 1, [{ participant: 'p1', weight: 1 }], 'p0'));
  project.transfers = Array.from({ length: 500 }, (_, index) => transfer(`t${index}`, 'p1', 'p0', 1));
  assert.doesNotThrow(() => validateProject(project));
  for (const collection of ['participants', 'expenses', 'transfers']) {
    const over = copy(project);
    over[collection].push(collection === 'participants' ? { id: 'extra', name: 'Extra' }
      : collection === 'expenses' ? expense('extra', 1, [{ participant: 'p1', weight: 1 }], 'p0') : transfer('extra', 'p1', 'p0', 1));
    rejects(() => validateProject(over), 'E_LIMIT', collection);
  }
  project.expenses = [expense('e', 1, project.participants.map((person) => ({ participant: person.id, weight: 1000000000 })), 'p0')];
  assert.equal(analyze(project).receipts[0].totalWeight, 100000000000);
  project.expenses[0].shares = [];
  rejects(() => validateProject(project), 'E_LIMIT');
  project.expenses[0].shares = Array.from({ length: 101 }, () => ({ participant: 'p0', weight: 1 }));
  rejects(() => validateProject(project), 'E_LIMIT');
});

test('limite de 2 MiB considera a serialização própria UTF-8 da API', () => {
  const ids = Array.from({ length: 100 }, (_, index) => `p${index.toString().padStart(37, '0')}`);
  const project = {
    version: 1, title: `${'🙂'.repeat(10)}TTTT`, currency: 'BRL',
    participants: ids.map((id) => ({ id, name: 'N' })),
    expenses: Array.from({ length: 174 }, (_, index) => ({
      id: `e${index}`, description: 'D', payer: ids[0], amountCents: 1,
      shares: ids.slice(0, Math.min(100, 17310 - index * 100)).map((participant) => ({ participant, weight: 1000000000 })),
    })),
    transfers: [],
  };
  assert.equal(Buffer.byteLength(`${JSON.stringify(project, null, 2)}\n`, 'utf8'), 2097152);
  assert.doesNotThrow(() => validateProject(project));
  project.title += 'T';
  assert.equal(Buffer.byteLength(`${JSON.stringify(project, null, 2)}\n`, 'utf8'), 2097153);
  assert.ok(Buffer.byteLength(JSON.stringify(project), 'utf8') < limits.jsonBytes);
  rejects(() => validateProject(project), 'E_LIMIT', '');
});

test('versão e moeda são literais e errors carregam code/message/path', () => {
  const error = new LedgerError('E_EXAMPLE', 'Mensagem de exemplo');
  assert.equal(error.name, 'LedgerError');
  assert.equal(error.path, '');
  assert.equal(error.code, 'E_EXAMPLE');
  assert.equal(error.message, 'Mensagem de exemplo');
  for (const version of [0, 2, '1', true]) rejects(() => validateProject({ ...base(), version }), 'E_VERSION', 'version');
  for (const currency of ['USD', 'brl', '', null]) rejects(() => validateProject({ ...base(), currency }), 'E_CURRENCY', 'currency');
  assertFrozen(limits);
});
