# Arquivos e memória de cálculo

O arquivo `rateio-projeto.json` é o formato de continuidade do Rateio Claro. Ele contém somente o estado aplicado: título, participantes, despesas, pesos e acertos declarados. Rascunhos e histórico de desfazer são temporários. Os outros cinco downloads são relatórios; não substituem esse arquivo para reabrir o trabalho.

## Projeto versão 1

O objeto raiz tem exatamente estes campos:

```json
{
  "version": 1,
  "title": "Passeio do grupo",
  "currency": "BRL",
  "participants": [
    { "id": "ana", "name": "Ana" },
    { "id": "bruno", "name": "Bruno" }
  ],
  "expenses": [
    {
      "id": "lanche",
      "description": "Lanche compartilhado",
      "payer": "ana",
      "amountCents": 501,
      "shares": [
        { "participant": "ana", "weight": 1 },
        { "participant": "bruno", "weight": 1 }
      ]
    }
  ],
  "transfers": [
    {
      "id": "acerto-01",
      "from": "bruno",
      "to": "ana",
      "amountCents": 100,
      "note": "Acerto declarado"
    }
  ]
}
```

`amountCents` é um valor inteiro em centavos: `501` significa R$ 5,01. `weight` é um peso inteiro positivo, não um percentual. A mesma pessoa pode pagar sem ser beneficiária. Um acerto exige pessoas distintas. Todos os participantes referenciados precisam existir; os beneficiários de uma despesa não podem se repetir.

IDs seguem `[a-z][a-z0-9_-]{0,39}` e são únicos dentro de sua coleção. Nomes repetidos são permitidos: a identidade vem do ID. O arquivo mantém a ordem original das coleções. Análises e relatórios ordenam participantes por ID, despesas por ID e parcelas por ID de beneficiário; a comparação dos IDs é ordinal ASCII.

Não são aceitos campos extras nem campos ausentes. Coleções vazias são válidas; cada despesa precisa ter pelo menos um beneficiário. A API JavaScript aceita apenas objetos comuns de dados e arrays densos, sem propriedades extras, classes, símbolos ou acessores. A validação devolve cópias profundamente congeladas e não retém referências mutáveis do chamador.

## Limites e importação

| Dado | Limite |
| --- | --- |
| Arquivo de projeto | 2 MiB (2.097.152 bytes UTF-8) |
| Participantes | 100 |
| Despesas | 500 |
| Acertos | 500 |
| Beneficiários por despesa | 1 a 100 |
| Valor individual em centavos | 1 a 1.000.000.000.000 |
| Soma das despesas em centavos | Até 1.000.000.000.000 |
| Soma dos acertos em centavos | Até 1.000.000.000.000, contada separadamente |
| Peso individual | 1 a 1.000.000.000 |
| Título | 1 a 120 pontos de código Unicode |
| Nome | 1 a 80 pontos de código Unicode |
| Descrição | 1 a 160 pontos de código Unicode |
| Nota do acerto | 0 a 160 pontos de código Unicode |

Textos não podem ter espaços externos, controles C0/DEL, substitutos Unicode isolados, U+2028, U+2029, U+FFFE ou U+FFFF. Nota vazia é permitida. Há somente a moeda BRL.

`parseProject` aceita uma string ou `Uint8Array`. A entrada precisa ser JSON em UTF-8 estrito, sem BOM nem chaves duplicadas. Chaves com escapes equivalentes, como `version` e `\u0076ersion`, também contam como repetidas. O limite é conferido antes da interpretação do JSON. A validação também confere o tamanho da serialização canônica do projeto.

Todos os números do JSON precisam ter lexemas inteiros. Ponto decimal e notação exponencial são recusados antes de `JSON.parse`, inclusive `1.0`, `1e0` e `1000000000000.00001`. Isso impede que um decimal original seja arredondado para um inteiro aparentemente válido. Texto entre aspas não sofre essa restrição. Valores monetários e pesos também precisam cumprir seus intervalos e ser inteiros seguros.

Os erros de leitura são `LedgerError` com `code`, `message` em português e `path`. Códigos de entrada: `IMPORT_INPUT`, `IMPORT_SIZE`, `IMPORT_UTF8`, `IMPORT_BOM`, `IMPORT_JSON`, `IMPORT_DUPLICATE_KEY` e `IMPORT_NUMBER`. Erros de esquema e limites usam os códigos do núcleo. Mensagens de importação não repetem conteúdo do arquivo. Nenhum exportador executa `toJSON` ou getters do projeto.

`serializeProject` escreve campos na ordem do esquema, indentação de dois espaços e LF final, sem BOM. Esse é o arquivo adequado para a ida e volta. O importador aceita também JSON compacto e espaços JSON válidos.

## Cálculo e acertos

Cada despesa é rateada separadamente. O núcleo calcula `amountCents × weight / totalWeight` com `BigInt`; atribui a parte inteira a cada beneficiário e distribui os centavos restantes pelos maiores restos. Empates são resolvidos pelo ID estável em ordem ASCII. Cada beneficiário recebe no máximo um centavo extra em cada despesa. Juntar ou separar despesas pode mudar o destino dos centavos; não há rodízio por data ou histórico.

O saldo de uma pessoa é `paidCents − shareCents + sentCents − receivedCents`. Positivo significa a receber; negativo, a pagar. Acertos não são despesas e não alteram as parcelas nem o total de custo. Sobrepagamentos declarados são aceitos e podem inverter saldos; não há correção silenciosa desses registros. A soma dos saldos é zero. `pendingCents` é a soma dos saldos positivos.

As sugestões percorrem devedores e credores por ID e consomem o menor saldo restante entre os primeiros de cada lista. A ordem é determinística, sem garantia de número mínimo de transferências. Sugestões não são acertos registrados. Registrá-las integralmente como novos acertos zeraria os saldos atuais.

## Downloads

| Nome | Conteúdo |
| --- | --- |
| `rateio-projeto.json` | Projeto editável versão 1 |
| `rateio-memoria.json` | `version`, `title`, `currency` e `analysis` calculada |
| `rateio-saldos.csv` | Pagamentos, parcelas, acertos enviados/recebidos e saldo por pessoa |
| `rateio-parcelas.csv` | Pesos, bases, restos, extras e parcelas por despesa |
| `rateio-sugestoes.csv` | Orientações pendentes com estado explícito `suggestion` |
| `rateio-relatorio.md` | Relatório legível com despesas/parcelas, acertos e sugestões separados |

A memória JSON contém totais, participantes, recibos de rateio e sugestões. `numerator`, `denominator` e `remainder` são strings decimais exatas, inclusive quando o numerador ultrapassa 2⁵³. Nenhum `BigInt` é entregue ao JSON como número. `totalWeight`, centavos e saldos são números inteiros seguros; um saldo pode chegar a ±2.000.000.000.000 centavos.

Os CSV são texto UTF-8 sem BOM, separados por vírgula, com LF final. Campos que contêm vírgula, aspas ou quebra de linha recebem aspas duplas; aspas internas são duplicadas. Os cabeçalhos são estáveis:

```text
participant_id,name,paid_cents,share_cents,sent_cents,received_cents,balance_cents
expense_id,description,payer,participant_id,name,weight,total_weight,base_cents,remainder,extra_cents,share_cents
status,from_id,from_name,to_id,to_name,amount_cents
```

Valores monetários são centavos inteiros, sem `R$` nem separadores de milhar. Nomes têm colunas próprias. O CSV de parcelas omite o numerador potencialmente grande; a memória JSON é a referência para esse valor exato. Textos autorais cujo primeiro caractere após espaços seja `=`, `+`, `-` ou `@` recebem um apóstrofo inicial. Essa proteção altera somente a representação CSV, nunca o JSON original. O apóstrofo pode ficar visível conforme o programa e as opções de importação. Saldos negativos continuam números.

O Markdown escapa HTML e pontuação Markdown de título, nomes, descrições, notas e IDs. As seções distinguem acertos declarados de sugestões não registradas e descrevem o arredondamento. O relatório é um documento de consulta, não um arquivo de projeto importável.

Planilhas externas podem aplicar conversões automáticas e aritmética de ponto flutuante. Os centavos exportados ficam abaixo de 2⁵³, mas refazer produtos de valor por peso em uma planilha pode perder precisão. Não há promessa de exatidão de fórmulas externas, nem equivalência automática com todos os importadores de Excel/CSV. A memória JSON conserva os inteiros racionais exatos do núcleo.

## Origem do exemplo

`fixtures/demo-project.json` foi gerado localmente com Node, chamando `serializeProject(demoProject())` das fontes deste projeto. São dados fictícios autorais: quatro pessoas, três despesas e um acerto. Os totais esperados são 26.901 centavos de despesas, 2.000 de acertos e 3.450 pendentes. A fixture não representa dados reais nem, por si só, uma execução ou download de navegador ou de planilha externa.
