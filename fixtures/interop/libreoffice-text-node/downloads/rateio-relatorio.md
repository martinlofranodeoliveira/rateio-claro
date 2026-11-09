# \=Texto &lt;&amp;&gt; \"ação\"\, \| 😀

Relatório de dados declarados em BRL. Nenhum pagamento é executado pelo Rateio Claro.

Despesas: **R$ 1,03**. Acertos registrados: **R$ 0,03**. Saldo pendente: **R$ 0,85**.

## Saldos

Saldo positivo significa valor a receber; saldo negativo significa valor a pagar. Saldo = despesas pagas − parcelas + acertos enviados − acertos recebidos. Acertos não aumentam o custo das despesas.

| Participante (ID) | Pago | Parcelas | Enviado | Recebido | Saldo |
| --- | --- | --- | --- | --- | --- |
| \=1\+1 (a) | R$ 0,00 | R$ 0,15 | R$ 0,03 | R$ 0,00 | -R$ 0,12 |
| \+SUM\(A1\:A2\) (b) | R$ 0,00 | R$ 0,29 | R$ 0,00 | R$ 0,00 | -R$ 0,29 |
| \-2\+3 (c) | R$ 0,00 | R$ 0,15 | R$ 0,00 | R$ 0,00 | -R$ 0,15 |
| \@SUM\(A1\:A2\) (d) | R$ 0,00 | R$ 0,29 | R$ 0,00 | R$ 0,00 | -R$ 0,29 |
| Aço &lt;&amp;&gt; \"ação\"\, \| \_x0041\_ 😀 (e) | R$ 1,03 | R$ 0,15 | R$ 0,00 | R$ 0,03 | R$ 0,85 |

## Despesas e parcelas

Cada despesa é rateada separadamente: valor em centavos × peso ÷ soma dos pesos. A parte inteira vai para cada beneficiário; os centavos restantes vão aos maiores restos, com empate pelo ID estável em ordem ASCII. Cada beneficiário recebe no máximo um centavo extra por despesa. Juntar ou separar despesas pode mudar quem recebe esses centavos; não há rotação por data ou histórico.

### \@Despesa &lt;&amp;&gt; \"ação\"\, \| \_x0041\_ (texto)

Pagador: Aço &lt;&amp;&gt; \"ação\"\, \| \_x0041\_ 😀 (e). Valor: R$ 1,03. Soma dos pesos: 7.

| Beneficiário (ID) | Peso | Numerador | Denominador | Base (centavos) | Resto | Extra (centavos) | Parcela |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \=1\+1 (a) | 1 | 103 | 7 | 14 | 5 | 1 | R$ 0,15 |
| \+SUM\(A1\:A2\) (b) | 2 | 206 | 7 | 29 | 3 | 0 | R$ 0,29 |
| \-2\+3 (c) | 1 | 103 | 7 | 14 | 5 | 1 | R$ 0,15 |
| \@SUM\(A1\:A2\) (d) | 2 | 206 | 7 | 29 | 3 | 0 | R$ 0,29 |
| Aço &lt;&amp;&gt; \"ação\"\, \| \_x0041\_ 😀 (e) | 1 | 103 | 7 | 14 | 5 | 1 | R$ 0,15 |

## Acertos registrados

Estes são registros declarados pelo autor do projeto; o aplicativo não verifica que a transferência aconteceu. Sobrepagamentos são preservados e podem inverter saldos.

| ID | De | Para | Valor | Nota |
| --- | --- | --- | --- | --- |
| texto\-acerto | \=1\+1 (a) | Aço &lt;&amp;&gt; \"ação\"\, \| \_x0041\_ 😀 (e) | R$ 0,03 | \=Nota &lt;&amp;&gt; \"ação\"\, \| 😀 |

## Sugestões NÃO registradas

As linhas abaixo são orientações calculadas, não lançamentos de acerto. Devedores e credores são ordenados por ID; a cada passo, transfere-se o menor saldo restante entre o primeiro devedor e o primeiro credor. O algoritmo é determinístico e não garante o número mínimo de transferências. Registrar todas estas sugestões como acertos zeraria os saldos atuais.

| De | Para | Valor | Estado |
| --- | --- | --- | --- |
| \=1\+1 (a) | Aço &lt;&amp;&gt; \"ação\"\, \| \_x0041\_ 😀 (e) | R$ 0,12 | Sugestão não registrada |
| \+SUM\(A1\:A2\) (b) | Aço &lt;&amp;&gt; \"ação\"\, \| \_x0041\_ 😀 (e) | R$ 0,29 | Sugestão não registrada |
| \-2\+3 (c) | Aço &lt;&amp;&gt; \"ação\"\, \| \_x0041\_ 😀 (e) | R$ 0,15 | Sugestão não registrada |
| \@SUM\(A1\:A2\) (d) | Aço &lt;&amp;&gt; \"ação\"\, \| \_x0041\_ 😀 (e) | R$ 0,29 | Sugestão não registrada |
