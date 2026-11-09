# Um sábado entre amigos

Relatório de dados declarados em BRL. Nenhum pagamento é executado pelo Rateio Claro.

Despesas: **R$ 269,01**. Acertos registrados: **R$ 20,00**. Saldo pendente: **R$ 34,50**.

## Saldos

Saldo positivo significa valor a receber; saldo negativo significa valor a pagar. Saldo = despesas pagas − parcelas + acertos enviados − acertos recebidos. Acertos não aumentam o custo das despesas.

| Participante (ID) | Pago | Parcelas | Enviado | Recebido | Saldo |
| --- | --- | --- | --- | --- | --- |
| Ana (ana) | R$ 120,01 | R$ 81,51 | R$ 0,00 | R$ 20,00 | R$ 18,50 |
| Bruno (bruno) | R$ 69,00 | R$ 53,00 | R$ 0,00 | R$ 0,00 | R$ 16,00 |
| Clara (clara) | R$ 80,00 | R$ 81,50 | R$ 0,00 | R$ 0,00 | -R$ 1,50 |
| Diego (diego) | R$ 0,00 | R$ 53,00 | R$ 20,00 | R$ 0,00 | -R$ 33,00 |

## Despesas e parcelas

Cada despesa é rateada separadamente: valor em centavos × peso ÷ soma dos pesos. A parte inteira vai para cada beneficiário; os centavos restantes vão aos maiores restos, com empate pelo ID estável em ordem ASCII. Cada beneficiário recebe no máximo um centavo extra por despesa. Juntar ou separar despesas pode mudar quem recebe esses centavos; não há rotação por data ou histórico.

### Almoço compartilhado (almoco)

Pagador: Ana (ana). Valor: R$ 120,01. Soma dos pesos: 4.

| Beneficiário (ID) | Peso | Numerador | Denominador | Base (centavos) | Resto | Extra (centavos) | Parcela |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ana (ana) | 1 | 12001 | 4 | 3000 | 1 | 1 | R$ 30,01 |
| Bruno (bruno) | 1 | 12001 | 4 | 3000 | 1 | 0 | R$ 30,00 |
| Clara (clara) | 1 | 12001 | 4 | 3000 | 1 | 0 | R$ 30,00 |
| Diego (diego) | 1 | 12001 | 4 | 3000 | 1 | 0 | R$ 30,00 |

### Ingressos da visita (ingressos)

Pagador: Clara (clara). Valor: R$ 80,00. Soma dos pesos: 2.

| Beneficiário (ID) | Peso | Numerador | Denominador | Base (centavos) | Resto | Extra (centavos) | Parcela |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ana (ana) | 1 | 8000 | 2 | 4000 | 0 | 0 | R$ 40,00 |
| Clara (clara) | 1 | 8000 | 2 | 4000 | 0 | 0 | R$ 40,00 |

### Transporte do grupo (transporte)

Pagador: Bruno (bruno). Valor: R$ 69,00. Soma dos pesos: 6.

| Beneficiário (ID) | Peso | Numerador | Denominador | Base (centavos) | Resto | Extra (centavos) | Parcela |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ana (ana) | 1 | 6900 | 6 | 1150 | 0 | 0 | R$ 11,50 |
| Bruno (bruno) | 2 | 13800 | 6 | 2300 | 0 | 0 | R$ 23,00 |
| Clara (clara) | 1 | 6900 | 6 | 1150 | 0 | 0 | R$ 11,50 |
| Diego (diego) | 2 | 13800 | 6 | 2300 | 0 | 0 | R$ 23,00 |

## Acertos registrados

Estes são registros declarados pelo autor do projeto; o aplicativo não verifica que a transferência aconteceu. Sobrepagamentos são preservados e podem inverter saldos.

| ID | De | Para | Valor | Nota |
| --- | --- | --- | --- | --- |
| acerto\-01 | Diego (diego) | Ana (ana) | R$ 20,00 | Acerto declarado no exemplo |

## Sugestões NÃO registradas

As linhas abaixo são orientações calculadas, não lançamentos de acerto. Devedores e credores são ordenados por ID; a cada passo, transfere-se o menor saldo restante entre o primeiro devedor e o primeiro credor. O algoritmo é determinístico e não garante o número mínimo de transferências. Registrar todas estas sugestões como acertos zeraria os saldos atuais.

| De | Para | Valor | Estado |
| --- | --- | --- | --- |
| Clara (clara) | Ana (ana) | R$ 1,50 | Sugestão não registrada |
| Diego (diego) | Ana (ana) | R$ 17,00 | Sugestão não registrada |
| Diego (diego) | Bruno (bruno) | R$ 16,00 | Sugestão não registrada |
