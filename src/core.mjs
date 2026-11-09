/** Núcleo sem estado: valores monetários são centavos inteiros. */
export class LedgerError extends Error {
  constructor(code, message, path = '') {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.path = path;
  }
}

export const limits = Object.freeze({
  participants: 100,
  expenses: 500,
  transfers: 500,
  shares: 100,
  amountCents: 1_000_000_000_000,
  weight: 1_000_000_000,
  jsonBytes: 2 * 1024 * 1024,
  balanceCents: 2_000_000_000_000,
});

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;
const PROJECT_KEYS = ['version', 'title', 'currency', 'participants', 'expenses', 'transfers'];
const PARTICIPANT_KEYS = ['id', 'name'];
const EXPENSE_KEYS = ['id', 'description', 'payer', 'amountCents', 'shares'];
const SHARE_KEYS = ['participant', 'weight'];
const TRANSFER_KEYS = ['id', 'from', 'to', 'amountCents', 'note'];
const encoder = new TextEncoder();

function fail(code, message, path = '') {
  throw new LedgerError(code, message, path);
}

// Os descritores permitem recusar getters sem executá-los. Só os valores de
// propriedades próprias de dados entram na cópia que será validada.
function readRecord(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('E_TYPE', 'Informe um objeto de dados.', path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('E_TYPE', 'Use apenas objetos de dados comuns.', path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail('E_FIELDS', 'O objeto deve conter exatamente os campos previstos.', path);
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail('E_FIELDS', 'Os campos devem ser propriedades próprias de dados, sem acessores.', path);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function readArray(value, maximum, path, minimum = 0) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail('E_TYPE', 'Informe uma lista comum.', path);
  }
  const length = Object.getOwnPropertyDescriptor(value, 'length').value;
  if (length < minimum || length > maximum) {
    fail('E_LIMIT', 'A quantidade de itens está fora dos limites permitidos.', path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== length + 1) {
    fail('E_FIELDS', 'A lista deve ser densa e não pode ter propriedades extras.', path);
  }
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail('E_FIELDS', 'A lista deve conter apenas itens próprios de dados, sem acessores.', `${path}[${index}]`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function readText(value, minimum, maximum, path) {
  if (typeof value !== 'string') fail('E_TEXT', 'Informe um texto válido.', path);
  if (value.trim() !== value) fail('E_TEXT', 'Remova os espaços no início e no fim do texto.', path);
  let count = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point < 0x20 || point === 0x7f || (point >= 0xd800 && point <= 0xdfff)
      || point === 0x2028 || point === 0x2029 || point === 0xfffe || point === 0xffff) {
      fail('E_TEXT', 'O texto contém um caractere não permitido.', path);
    }
    count += 1;
    if (count > maximum) fail('E_TEXT', 'O tamanho do texto está fora dos limites permitidos.', path);
  }
  if (count < minimum || count > maximum) fail('E_TEXT', 'O tamanho do texto está fora dos limites permitidos.', path);
  return value;
}

function readId(value, path) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    fail('E_ID', 'Informe um identificador válido.', path);
  }
  return value;
}

function readInteger(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('E_INTEGER', 'Informe um número inteiro dentro dos limites permitidos.', path);
  }
  return value;
}

function readParticipant(value, path) {
  const item = readRecord(value, PARTICIPANT_KEYS, path);
  return { id: readId(item.id, `${path}.id`), name: readText(item.name, 1, 80, `${path}.name`) };
}

function requireParticipant(id, participants, path) {
  readId(id, path);
  if (!participants.has(id)) fail('E_REFERENCE', 'O participante indicado não existe neste projeto.', path);
  return id;
}

function readExpense(value, participants, path) {
  const item = readRecord(value, EXPENSE_KEYS, path);
  const shares = readArray(item.shares, limits.shares, `${path}.shares`, 1).map((value, index) => {
    const sharePath = `${path}.shares[${index}]`;
    const share = readRecord(value, SHARE_KEYS, sharePath);
    return {
      participant: requireParticipant(share.participant, participants, `${sharePath}.participant`),
      weight: readInteger(share.weight, 1, limits.weight, `${sharePath}.weight`),
    };
  });
  assertDistinct(shares, 'participant', `${path}.shares`);
  return {
    id: readId(item.id, `${path}.id`),
    description: readText(item.description, 1, 160, `${path}.description`),
    payer: requireParticipant(item.payer, participants, `${path}.payer`),
    amountCents: readInteger(item.amountCents, 1, limits.amountCents, `${path}.amountCents`),
    shares,
  };
}

function readTransfer(value, participants, path) {
  const item = readRecord(value, TRANSFER_KEYS, path);
  const from = requireParticipant(item.from, participants, `${path}.from`);
  const to = requireParticipant(item.to, participants, `${path}.to`);
  if (from === to) fail('E_SAME_PARTICIPANT', 'O acerto deve ligar dois participantes diferentes.', path);
  return {
    id: readId(item.id, `${path}.id`), from, to,
    amountCents: readInteger(item.amountCents, 1, limits.amountCents, `${path}.amountCents`),
    note: readText(item.note, 0, 160, `${path}.note`),
  };
}

function assertDistinct(items, key, path) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item[key])) fail('E_DUPLICATE', 'A lista contém identificadores repetidos.', path);
    seen.add(item[key]);
  }
}

function assertTotal(items, path) {
  let total = 0;
  for (const item of items) {
    total += item.amountCents;
    if (total > limits.amountCents) fail('E_LIMIT', 'A soma dos valores ultrapassa o limite permitido.', path);
  }
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

// Não chamamos JSON.stringify em objetos: mesmo uma cópia comum poderia herdar
// um toJSON externo. Strings e números primitivos não executam esse método.
function serializedBytes(value, depth = 0) {
  if (Array.isArray(value)) {
    if (value.length === 0) return 2;
    return 4 + depth * 2 + (value.length - 1) * 2 + value.reduce((sum, item) => (
      sum + (depth + 1) * 2 + serializedBytes(item, depth + 1)
    ), 0);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return 2;
    return 4 + depth * 2 + (entries.length - 1) * 2 + entries.reduce((sum, [key, item]) => (
      sum + (depth + 1) * 2 + encoder.encode(JSON.stringify(key)).length + 2 + serializedBytes(item, depth + 1)
    ), 0);
  }
  return encoder.encode(JSON.stringify(value)).length;
}

export function validateProject(value) {
  const input = readRecord(value, PROJECT_KEYS, '');
  if (input.version !== 1) fail('E_VERSION', 'A versão do projeto não é compatível.', 'version');
  if (input.currency !== 'BRL') fail('E_CURRENCY', 'O projeto deve usar a moeda BRL.', 'currency');
  const participants = readArray(input.participants, limits.participants, 'participants').map((item, index) => readParticipant(item, `participants[${index}]`));
  assertDistinct(participants, 'id', 'participants');
  const participantIds = new Set(participants.map((item) => item.id));
  const expenses = readArray(input.expenses, limits.expenses, 'expenses').map((item, index) => readExpense(item, participantIds, `expenses[${index}]`));
  const transfers = readArray(input.transfers, limits.transfers, 'transfers').map((item, index) => readTransfer(item, participantIds, `transfers[${index}]`));
  assertDistinct(expenses, 'id', 'expenses');
  assertDistinct(transfers, 'id', 'transfers');
  assertTotal(expenses, 'expenses');
  assertTotal(transfers, 'transfers');
  const result = {
    version: 1,
    title: readText(input.title, 1, 120, 'title'),
    currency: 'BRL', participants, expenses, transfers,
  };
  // O arquivo próprio usa dois espaços de indentação e um LF final. Assim todo
  // projeto validado pode ser exportado e reaberto dentro do mesmo limite.
  if (serializedBytes(result) + 1 > limits.jsonBytes) fail('E_LIMIT', 'O projeto ultrapassa o limite de tamanho do arquivo.', '');
  return freezeDeep(result);
}

export function createProject() {
  return validateProject({ version: 1, title: 'Novo rateio', currency: 'BRL', participants: [], expenses: [], transfers: [] });
}

export function setTitle(project, title) {
  const current = validateProject(project);
  return validateProject({ ...current, title: readText(title, 1, 120, 'title') });
}

function upsert(project, input, collection, readItem, path) {
  const current = validateProject(project);
  const item = readItem(input, new Set(current.participants.map((person) => person.id)), path);
  const items = [...current[collection]];
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index < 0) items.push(item);
  else items[index] = item;
  return validateProject({ ...current, [collection]: items });
}

function remove(project, id, collection) {
  const current = validateProject(project);
  readId(id, 'id');
  const index = current[collection].findIndex((item) => item.id === id);
  if (index < 0) fail('E_NOT_FOUND', 'O registro indicado não existe neste projeto.', 'id');
  if (collection === 'participants' && (
    current.expenses.some((item) => item.payer === id || item.shares.some((share) => share.participant === id))
    || current.transfers.some((item) => item.from === id || item.to === id)
  )) fail('E_IN_USE', 'O participante está vinculado a despesas ou acertos. Edite ou remova esses registros primeiro.', 'id');
  return validateProject({ ...current, [collection]: current[collection].filter((_, position) => position !== index) });
}

export function upsertParticipant(project, participant) {
  return upsert(project, participant, 'participants', (item, _, path) => readParticipant(item, path), 'participant');
}
export function removeParticipant(project, id) { return remove(project, id, 'participants'); }
export function upsertExpense(project, expense) { return upsert(project, expense, 'expenses', readExpense, 'expense'); }
export function removeExpense(project, id) { return remove(project, id, 'expenses'); }
export function upsertTransfer(project, transfer) { return upsert(project, transfer, 'transfers', readTransfer, 'transfer'); }
export function removeTransfer(project, id) { return remove(project, id, 'transfers'); }

export function parseMoney(text) {
  if (typeof text !== 'string') fail('E_MONEY', 'Informe o valor em formato decimal.');
  const trimmed = text.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
  const match = /^(0|[1-9][0-9]*)(?:[.,]([0-9]{1,2}))?$/.exec(trimmed);
  if (!match) fail('E_MONEY', 'Use um valor decimal sem símbolo, sinal ou separador de milhares.');
  if (match[1].length > 11) fail('E_LIMIT', 'O valor ultrapassa o limite permitido.');
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents > BigInt(limits.amountCents)) fail('E_LIMIT', 'O valor ultrapassa o limite permitido.');
  return Number(cents);
}

export function formatMoney(cents) {
  readInteger(cents, -limits.balanceCents, limits.balanceCents, 'cents');
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimal = (absolute % 100).toString().padStart(2, '0');
  return `${cents < 0 ? '-' : ''}R$ ${whole},${decimal}`;
}

const ordinal = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function allocate(expense) {
  const shares = [...expense.shares].sort((left, right) => ordinal(left.participant, right.participant));
  const totalWeight = shares.reduce((total, share) => total + share.weight, 0);
  const denominator = BigInt(totalWeight);
  const ranked = shares.map((share) => {
    const numerator = BigInt(expense.amountCents) * BigInt(share.weight);
    const base = numerator / denominator;
    const remainder = numerator % denominator;
    return { participant: share.participant, weight: share.weight, numerator, base, remainder, extra: 0 };
  });
  let remaining = Number(BigInt(expense.amountCents) - ranked.reduce((total, share) => total + share.base, 0n));
  const priorities = [...ranked].sort((left, right) => (
    left.remainder > right.remainder ? -1 : left.remainder < right.remainder ? 1 : ordinal(left.participant, right.participant)
  ));
  for (const share of priorities) {
    if (remaining === 0) break;
    share.extra = 1;
    remaining -= 1;
  }
  return {
    expenseId: expense.id, payer: expense.payer, amountCents: expense.amountCents, totalWeight,
    allocations: ranked.map((share) => ({
      participant: share.participant, weight: share.weight,
      numerator: share.numerator.toString(), denominator: denominator.toString(),
      baseCents: Number(share.base), remainder: share.remainder.toString(), extraCents: share.extra,
      shareCents: Number(share.base) + share.extra,
    })),
  };
}

function settle(participants) {
  const debtors = participants.filter((person) => person.balanceCents < 0).map((person) => ({ id: person.id, remaining: -person.balanceCents }));
  const creditors = participants.filter((person) => person.balanceCents > 0).map((person) => ({ id: person.id, remaining: person.balanceCents }));
  const suggestions = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.remaining, creditor.remaining);
    suggestions.push({ from: debtor.id, to: creditor.id, amountCents });
    debtor.remaining -= amountCents;
    creditor.remaining -= amountCents;
    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }
  return suggestions;
}

export function analyze(project) {
  const current = validateProject(project);
  const participants = [...current.participants].sort((left, right) => ordinal(left.id, right.id)).map((person) => ({
    id: person.id, name: person.name, paidCents: 0, shareCents: 0, sentCents: 0, receivedCents: 0, balanceCents: 0,
  }));
  const byId = new Map(participants.map((person) => [person.id, person]));
  const receipts = [...current.expenses].sort((left, right) => ordinal(left.id, right.id)).map(allocate);
  let totalExpenseCents = 0;
  let totalTransferCents = 0;
  for (const receipt of receipts) {
    totalExpenseCents += receipt.amountCents;
    byId.get(receipt.payer).paidCents += receipt.amountCents;
    for (const share of receipt.allocations) byId.get(share.participant).shareCents += share.shareCents;
  }
  for (const transfer of current.transfers) {
    totalTransferCents += transfer.amountCents;
    byId.get(transfer.from).sentCents += transfer.amountCents;
    byId.get(transfer.to).receivedCents += transfer.amountCents;
  }
  let pendingCents = 0;
  for (const person of participants) {
    person.balanceCents = person.paidCents - person.shareCents + person.sentCents - person.receivedCents;
    if (person.balanceCents > 0) pendingCents += person.balanceCents;
  }
  return freezeDeep({ totalExpenseCents, totalTransferCents, pendingCents, participants, receipts, suggestions: settle(participants) });
}
