import { LedgerError, validateProject, analyze, formatMoney } from './core.mjs';

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const byteLengthOf = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), 'byteLength',
).get;

function importError(code, message) {
  throw new LedgerError(code, message, '');
}

// JSON.stringify receives only primitive strings. In particular, an inherited
// toJSON hook cannot execute while exporting a validated project or analysis.
function prettyJson(value, depth = 0) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const indent = '  '.repeat(depth);
  const childIndent = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map(item => `${childIndent}${prettyJson(item, depth + 1)}`).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  return `{\n${keys.map(key => `${childIndent}${JSON.stringify(key)}: ${prettyJson(value[key], depth + 1)}`).join(',\n')}\n${indent}}`;
}

function canonicalProject(project) {
  return {
    version: project.version,
    title: project.title,
    currency: project.currency,
    participants: project.participants.map(({ id, name }) => ({ id, name })),
    expenses: project.expenses.map(({ id, description, payer, amountCents, shares }) => ({
      id, description, payer, amountCents,
      shares: shares.map(({ participant, weight }) => ({ participant, weight })),
    })),
    transfers: project.transfers.map(({ id, from, to, amountCents, note }) => ({
      id, from, to, amountCents, note,
    })),
  };
}

function assertUnicodeSource(source) {
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = source.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        importError('IMPORT_UTF8', 'O arquivo deve conter texto UTF-8 válido.');
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      importError('IMPORT_UTF8', 'O arquivo deve conter texto UTF-8 válido.');
    }
  }
}

// Scan the original tokens before JSON.parse can round a fractional or
// exponential lexeme. Object keys are compared after decoding JSON escapes.
function inspectJson(source) {
  let cursor = 0;
  const malformed = () => importError('IMPORT_JSON', 'O arquivo não contém um projeto JSON válido.');
  const whitespace = () => {
    while (cursor < source.length && /[ \t\r\n]/.test(source[cursor])) cursor += 1;
  };
  function readString(decode = false) {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === '"') {
        return decode ? JSON.parse(source.slice(start, cursor)) : undefined;
      }
      if (char.charCodeAt(0) < 0x20) malformed();
      if (char === '\\') {
        const escaped = source[cursor++];
        if (escaped === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(cursor, cursor + 4))) malformed();
          cursor += 4;
        } else if (!'"\\/bfnrt'.includes(escaped ?? '\u0000')) malformed();
      }
    }
    malformed();
  }
  function readNumber() {
    if (source[cursor] === '-') cursor += 1;
    if (source[cursor] === '0') cursor += 1;
    else {
      if (!/[1-9]/.test(source[cursor] ?? '')) malformed();
      do { cursor += 1; } while (/[0-9]/.test(source[cursor] ?? ''));
    }
    if (/[.eE]/.test(source[cursor] ?? '')) {
      importError('IMPORT_NUMBER', 'Use somente números inteiros no arquivo JSON.');
    }
  }
  function readValue(depth) {
    // The project schema needs fewer than ten levels. This bounded scanner also
    // refuses hostile nesting without depending on the JavaScript stack limit.
    if (depth > 64) malformed();
    whitespace();
    const char = source[cursor];
    if (char === '"') return readString();
    if (char === '{') {
      cursor += 1;
      whitespace();
      const seen = new Set();
      if (source[cursor] === '}') { cursor += 1; return; }
      while (cursor < source.length) {
        if (source[cursor] !== '"') malformed();
        const key = readString(true);
        if (seen.has(key)) {
          importError('IMPORT_DUPLICATE_KEY', 'O arquivo contém uma chave JSON repetida.');
        }
        seen.add(key);
        whitespace();
        if (source[cursor++] !== ':') malformed();
        readValue(depth + 1);
        whitespace();
        if (source[cursor] === '}') { cursor += 1; return; }
        if (source[cursor++] !== ',') malformed();
        whitespace();
      }
      malformed();
    }
    if (char === '[') {
      cursor += 1;
      whitespace();
      if (source[cursor] === ']') { cursor += 1; return; }
      while (cursor < source.length) {
        readValue(depth + 1);
        whitespace();
        if (source[cursor] === ']') { cursor += 1; return; }
        if (source[cursor++] !== ',') malformed();
      }
      malformed();
    }
    if (char === '-' || /[0-9]/.test(char ?? '')) return readNumber();
    for (const literal of ['true', 'false', 'null']) {
      if (source.startsWith(literal, cursor)) { cursor += literal.length; return; }
    }
    malformed();
  }
  readValue(0);
  whitespace();
  if (cursor !== source.length) malformed();
}

export function parseProject(input) {
  let source;
  if (typeof input === 'string') {
    if (input.length > MAX_JSON_BYTES) importError('IMPORT_SIZE', 'O arquivo excede o limite de 2 MiB.');
    assertUnicodeSource(input);
    if (new TextEncoder().encode(input).byteLength > MAX_JSON_BYTES) {
      importError('IMPORT_SIZE', 'O arquivo excede o limite de 2 MiB.');
    }
    source = input;
  } else if (input instanceof Uint8Array) {
    if (byteLengthOf.call(input) > MAX_JSON_BYTES) {
      importError('IMPORT_SIZE', 'O arquivo excede o limite de 2 MiB.');
    }
    try {
      source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
      importError('IMPORT_UTF8', 'O arquivo deve conter texto UTF-8 válido.');
    }
  } else importError('IMPORT_INPUT', 'Abra um arquivo JSON em texto ou bytes UTF-8.');
  if (source.startsWith('\ufeff')) importError('IMPORT_BOM', 'O arquivo UTF-8 deve estar sem BOM.');
  inspectJson(source);
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { importError('IMPORT_JSON', 'O arquivo não contém um projeto JSON válido.'); }
  return validateProject(parsed);
}

export function serializeProject(project) {
  return `${prettyJson(canonicalProject(validateProject(project)))}\n`;
}

export function exportMemory(project) {
  const validated = validateProject(project);
  return `${prettyJson({
    version: 1,
    title: validated.title,
    currency: validated.currency,
    analysis: analyze(validated),
  })}\n`;
}

function csvCell(value, authored = false) {
  let text = String(value);
  if (authored && /^\s*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const textCell = value => csvCell(value, true);
const csv = (header, rows) => `${header}\n${rows.map(row => row.join(',')).join('\n')}${rows.length ? '\n' : ''}`;

export function exportBalancesCsv(project) {
  const analysis = analyze(validateProject(project));
  return csv('participant_id,name,paid_cents,share_cents,sent_cents,received_cents,balance_cents',
    analysis.participants.map(person => [
      person.id, textCell(person.name), person.paidCents, person.shareCents,
      person.sentCents, person.receivedCents, person.balanceCents,
    ]));
}

export function exportAllocationsCsv(project) {
  const validated = validateProject(project);
  const analysis = analyze(validated);
  const expenses = new Map(validated.expenses.map(expense => [expense.id, expense]));
  const people = new Map(validated.participants.map(person => [person.id, person.name]));
  return csv('expense_id,description,payer,participant_id,name,weight,total_weight,base_cents,remainder,extra_cents,share_cents',
    analysis.receipts.flatMap(receipt => receipt.allocations.map(allocation => [
      receipt.expenseId, textCell(expenses.get(receipt.expenseId).description), receipt.payer,
      allocation.participant, textCell(people.get(allocation.participant)), allocation.weight,
      receipt.totalWeight, allocation.baseCents, allocation.remainder,
      allocation.extraCents, allocation.shareCents,
    ])));
}

export function exportSuggestionsCsv(project) {
  const analysis = analyze(validateProject(project));
  const people = new Map(analysis.participants.map(person => [person.id, person.name]));
  return csv('status,from_id,from_name,to_id,to_name,amount_cents',
    analysis.suggestions.map(suggestion => [
      'suggestion', suggestion.from, textCell(people.get(suggestion.from)), suggestion.to,
      textCell(people.get(suggestion.to)), suggestion.amountCents,
    ]));
}

// Escape HTML first, then every Markdown punctuation character. Generated IDs,
// amounts and table syntax remain separate from all participant-authored text.
function markdownText(text) {
  return text.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, character => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return `\\${character}`;
  });
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function exportMarkdown(project) {
  const validated = validateProject(project);
  const analysis = analyze(validated);
  const people = new Map(validated.participants.map(person => [person.id, person.name]));
  const person = id => `${markdownText(people.get(id))} (${markdownText(id)})`;
  const expenses = new Map(validated.expenses.map(expense => [expense.id, expense]));
  const sections = [
    `# ${markdownText(validated.title)}`,
    'Relatório de dados declarados em BRL. Nenhum pagamento é executado pelo Rateio Claro.',
    `Despesas: **${formatMoney(analysis.totalExpenseCents)}**. Acertos registrados: **${formatMoney(analysis.totalTransferCents)}**. Saldo pendente: **${formatMoney(analysis.pendingCents)}**.`,
    '## Saldos',
    'Saldo positivo significa valor a receber; saldo negativo significa valor a pagar. Saldo = despesas pagas − parcelas + acertos enviados − acertos recebidos. Acertos não aumentam o custo das despesas.',
    markdownTable(['Participante (ID)', 'Pago', 'Parcelas', 'Enviado', 'Recebido', 'Saldo'],
      analysis.participants.map(item => [person(item.id), formatMoney(item.paidCents), formatMoney(item.shareCents),
        formatMoney(item.sentCents), formatMoney(item.receivedCents), formatMoney(item.balanceCents)])),
    '## Despesas e parcelas',
    'Cada despesa é rateada separadamente: valor em centavos × peso ÷ soma dos pesos. A parte inteira vai para cada beneficiário; os centavos restantes vão aos maiores restos, com empate pelo ID estável em ordem ASCII. Cada beneficiário recebe no máximo um centavo extra por despesa. Juntar ou separar despesas pode mudar quem recebe esses centavos; não há rotação por data ou histórico.',
  ];
  if (!analysis.receipts.length) sections.push('Nenhuma despesa registrada.');
  for (const receipt of analysis.receipts) {
    const expense = expenses.get(receipt.expenseId);
    sections.push(`### ${markdownText(expense.description)} (${markdownText(expense.id)})`);
    sections.push(`Pagador: ${person(receipt.payer)}. Valor: ${formatMoney(receipt.amountCents)}. Soma dos pesos: ${receipt.totalWeight}.`);
    sections.push(markdownTable(['Beneficiário (ID)', 'Peso', 'Numerador', 'Denominador', 'Base (centavos)', 'Resto', 'Extra (centavos)', 'Parcela'],
      receipt.allocations.map(item => [person(item.participant), item.weight, item.numerator, item.denominator,
        item.baseCents, item.remainder, item.extraCents, formatMoney(item.shareCents)])));
  }
  sections.push('## Acertos registrados');
  sections.push('Estes são registros declarados pelo autor do projeto; o aplicativo não verifica que a transferência aconteceu. Sobrepagamentos são preservados e podem inverter saldos.');
  if (validated.transfers.length) {
    sections.push(markdownTable(['ID', 'De', 'Para', 'Valor', 'Nota'],
      [...validated.transfers].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(item => [
        markdownText(item.id), person(item.from), person(item.to), formatMoney(item.amountCents), markdownText(item.note),
      ])));
  } else sections.push('Nenhum acerto registrado.');
  sections.push('## Sugestões NÃO registradas');
  sections.push('As linhas abaixo são orientações calculadas, não lançamentos de acerto. Devedores e credores são ordenados por ID; a cada passo, transfere-se o menor saldo restante entre o primeiro devedor e o primeiro credor. O algoritmo é determinístico e não garante o número mínimo de transferências. Registrar todas estas sugestões como acertos zeraria os saldos atuais.');
  if (analysis.suggestions.length) {
    sections.push(markdownTable(['De', 'Para', 'Valor', 'Estado'], analysis.suggestions.map(item => [
      person(item.from), person(item.to), formatMoney(item.amountCents), 'Sugestão não registrada',
    ])));
  } else sections.push('Nenhuma sugestão pendente.');
  return `${sections.join('\n\n')}\n`;
}
