---
name: Rateio Claro
description: Rateio ponderado em reais, com parcelas, centavos e estados explícitos.
colors:
  accent: "#2454d4"
  accent-dark: "#163c9d"
  tint: "#e6edf9"
  ground: "#f7f9fc"
  surface: "#fff"
  ink: "#1b263b"
  muted: "#52617a"
  line: "#c9d3e3"
  line-soft: "#dce3ee"
  field-border: "#a7b5cc"
  error: "#a32035"
  error-ground: "#fff0f2"
  disabled-text: "#657086"
  disabled-ground: "#edf0f5"
  disabled-border: "#d8dfe9"
typography:
  headline:
    fontFamily: "Chivo, sans-serif"
    fontSize: "1.8rem"
    fontWeight: 700
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 750
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "0.81rem"
    fontWeight: 650
  action:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 650
  numeric:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    letterSpacing: "-0.02em"
  table:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
rounded:
  control: "6px"
  dialog: "12px"
spacing:
  tight: "8px"
  small: "12px"
  medium: "16px"
  base: "24px"
  large: "32px"
  wide: "40px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-dark}"
    textColor: "{colors.surface}"
  button-neutral:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 10px"
  expense-selected:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "15px 13px"
    width: "100%"
  receipt-table:
    textColor: "{colors.ink}"
    typography: "{typography.table}"
    width: "100%"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "28px"
---

# Design System: Rateio Claro

## Overview

**Creative North Star: "Blocos de composição"**

A implementação organiza o rateio como uma composição de despesas, parcelas e saldos. Campo claro, tinta azul-escura e cobalto formam uma área de trabalho sóbria e legível. O caráter vem do alinhamento dos valores, da tipografia e da explicação do centavo adicional. Esta documentação registra o sistema presente no código.

Rateio Claro é uma ferramenta estática, em português, da LOFRANO TECNOLOGIA. Os valores são declarados em BRL, com centavos inteiros; acertos são registros informados pelas pessoas. A interface deve manter visível essa natureza operacional: não executa pagamentos nem representa uma conta bancária. Arquivos locais e salvamento explícito dão continuidade ao trabalho.

**Key Characteristics:**

- Superfícies planas, divisórias finas e espaços entre tarefas.
- Valores tabulares, alinhados à direita em tabelas e saldos.
- Cobalto para ação, seleção e explicação dos centavos.
- Prévia, estado aplicado e acerto declarado identificados por texto.
- Recibo resumido antes da edição no celular.

## Colors

A paleta combina um campo frio e muito claro com tinta escura; o cobalto orienta ações e leitura dos resultados. Os valores normativos estão no frontmatter.

### Primary

- **Cobalto de ação — `accent`:** ações principais, links, foco visível, saldo a receber e indicação de centavo adicional.
- **Cobalto profundo — `accent-dark`:** resposta de hover das ações principais e dos links.
- **Azul de seleção — `tint`:** despesa selecionada, aviso de rascunho e hover dos botões neutros.

### Secondary

- **Carmim de erro — `error`:** mensagens de falha e ação de remoção. O texto nomeia o problema; a cor apenas o reforça.
- **Rosa de alerta — `error-ground`:** fundo dos erros junto aos formulários e da mensagem sem JavaScript.

### Neutral

- **Campo frio — `ground`:** fundo contínuo da aplicação.
- **Branco de controle — `surface`:** campos, botões neutros e diálogo.
- **Tinta — `ink`:** títulos, nomes, valores e conteúdo principal.
- **Texto de apoio — `muted`:** instruções, identificadores, estados e explicações secundárias.
- **Divisória — `line`:** limites de regiões e registros; `line-soft` separa linhas internas com menor peso.
- **Contorno de campo — `field-border`:** limite dos campos de entrada e seleção.
- **Desabilitado — `disabled-text`, `disabled-ground`, `disabled-border`:** controles indisponíveis. O botão principal desabilitado usa uma variação clara própria, registrada no snippet do componente.

## Typography

**Headline Font:** Chivo, com fallback sans-serif.

**Body Font:** Public Sans, com fallback sans-serif.

As duas famílias variáveis são servidas por arquivos TTF locais. Chivo dá identidade à marca e ao título do rateio; Public Sans sustenta campos, tabelas e instruções. Os arquivos e as licenças OFL acompanham os assets. Números usam algarismos tabulares em toda a aplicação.

### Hierarchy

- **Headline:** título do rateio, com peso forte e aproximação entre letras; reduz para (1.55rem) no celular. O título institucional usa a mesma família em escala menor.
- **Title:** títulos funcionais de seção, compactos e fortes. Subtítulos usam (0.9rem, peso 700).
- **Body:** texto de leitura com entrelinha confortável; parágrafos têm limite de (72ch). A maior parte do texto operacional usa escalas menores conforme o contexto.
- **Label:** rótulos acima dos campos, com peso suficiente para se separar das instruções.
- **Action:** botões comuns; ações dentro de listas e cabeçalhos usam versões menores, preservando a hierarquia do comando principal.
- **Numeric:** valores de saldos e da lista de despesas. A tabela usa o papel `table`, com números alinhados à direita e sem quebra de linha.
- **Supporting text:** instruções em (0.78rem), estados em (0.7rem) e cabeçalhos de tabela em (0.71rem). No celular esses papéis ficam mais compactos; não são estilos de chamada promocional.

## Layout

O contêiner principal é centralizado, com largura máxima de (1792px) e margens internas laterais de (32px). A barra superior reúne marca à esquerda e comandos de arquivo à direita, permitindo que os botões quebrem linha. O cabeçalho do projeto e o resumo aplicado antecedem a área de trabalho.

No desktop, a área de trabalho tem três regiões: lista de despesas (220px), editor flexível (`minmax(0, 1fr)`) e saldos (300px), separadas por (32px). O editor recebe divisórias laterais e espaço interno de (28px). Campos relacionados e pesos formam pares; registros de pessoas e acertos ficam numa seção posterior de duas colunas. Exportações e explicação do cálculo seguem abaixo.

- **A partir de (1550px):** lista e saldos passam a (265px) e (350px); o intervalo entre regiões e o espaço lateral do editor passam a (40px). As margens do conteúdo também passam a (40px).
- **Até (1100px):** lista (185px) e editor ocupam a primeira linha. Saldos e sugestões mudam para uma segunda linha, dividida em duas colunas. A nota ao lado da marca é ocultada.
- **Até (700px):** a composição vira uma coluna, com margens de (20px). O resumo aplicado mantém dois indicadores na primeira linha e o valor pendente abaixo. Um recibo compacto da despesa selecionada aparece antes da lista e do editor. A lista de despesas vira uma faixa horizontal com rolagem e cartões de (185px). Pessoas, acertos, exportações e texto explicativo passam a blocos verticais. Os campos de pagador/valor e os pesos continuam em pares.

O ritmo usa os espaços do frontmatter. Intervalos menores aproximam rótulo, campo e instrução; os maiores separam tarefas e seções. Conteúdo textual longo quebra dentro de nomes e descrições, enquanto valores monetários preservam sua unidade.

**The Centavo à Vista Rule.** A composição deve permitir conferir a parcela e identificar quem recebeu o centavo pelo resto, inclusive no resumo do celular. O resumo mostra até quatro pessoas e oferece um link para a memória completa.

## Elevation & Depth

A área de trabalho é plana: divisórias, alinhamento e fundos tonais organizam as regiões, sem sombras de cartões. A única sombra estrutural pertence ao diálogo modal (`0 20px 70px #152e5733`), sobre um backdrop escuro translúcido (`#15233b70`). Contornos de foco e a confirmação breve do recibo indicam estado, não profundidade permanente.

**The Flat Workspace Rule.** Mantenha lista, editor, recibo e saldos no mesmo plano visual; reserve a elevação para a interrupção modal.

## Shapes

Controles e seleção de despesa usam cantos discretamente arredondados, no papel `control`; o diálogo usa o papel `dialog`. Contornos e divisórias têm espessura de (1px). O recibo conserva a forma de tabela aberta, sem caixa decorativa ao redor. Checkboxes nativos, campos de peso estreitos e botões textuais mantêm as ações reconhecíveis.

## Components

### Buttons and project commands

Botões são compactos, com altura mínima de (38px); a prioridade vem do preenchimento em cobalto. Guardar JSON e Aplicar despesa usam essa variante. Botões neutros usam branco e contorno; no hover recebem fundo tonal e contorno cobalto. O estado ativo neutro usa um azul mais intenso (`#d6e1f7`). Remover é uma ação textual em carmim, com fundo e contorno transparentes em repouso.

Todos os controles interativos compartilham foco visível com contorno de (3px) e afastamento de (3px), na cor `accent`. As transições de fundo e borda duram (0.16s), com `ease-out`. Ações de lista e de cabeçalho têm altura mínima de (30px); a barra superior usa (35px) no celular. Estados desabilitados não respondem ao hover.

### Inputs and weighted shares

Campos brancos usam contorno de (1px), altura mínima de (42px), cantos de controle e padding do papel `input`. Rótulos ficam acima; instruções ficam junto do campo a que pertencem. A divisão associa checkbox, nome e peso numérico: desmarcar uma pessoa desabilita o peso, sem ocultar a linha. O checkbox mede (17px); o campo de peso mede (68px) no desktop e (58px) no celular.

A validação mostra texto em carmim sobre fundo rosa junto ao formulário. Uma edição recusada preserva os valores digitados. Não transforme erro em confirmação nem apague silenciosamente um rascunho.

### Expense selection

A lista usa botões de largura total, com descrição, valor e pagador em linhas separadas. A seleção recebe fundo tonal e contorno azul claro (`#bed0f1`), além de `aria-pressed`. Um rascunho preservado tem marcador textual próprio. No celular, a mesma estrutura entra na faixa rolável; a seleção continua distinta sem depender da posição de rolagem.

### Receipt and mobile preview

O recibo completo apresenta Pessoa, Peso e Parcela, seguido de Total conferido. A memória expansível explica quociente, resto e centavo extra por pessoa. A indicação “+1 centavo pelo resto” fica junto ao nome, com cobalto e texto explícito.

O recibo compacto do celular repete a descrição, o estado e até quatro parcelas em duas colunas. Ele nomeia “Estado aplicado” ou “Prévia · ainda não aplicada” e oferece acesso à memória completa. É um resumo da despesa selecionada, não uma confirmação de pagamento.

Ao aplicar uma despesa, apenas o recibo completo recebe uma confirmação de contorno que desaparece em (0.65s), com `cubic-bezier(.16, 1, .3, 1)`. A preferência `prefers-reduced-motion: reduce` remove animações e transições e mantém a rolagem automática desativada.

### Applied summary, drafts and balances

O resumo superior mostra despesas, acertos registrados e falta compensar. Saldos apresentam o valor junto de “a receber”, “a compensar” ou “saldo zerado”; o texto conserva o significado além da cor. O cobalto reforça valores a receber e o total pendente.

**The Applied State Rule.** Saldos e resumo pertencem ao estado aplicado. Alterar uma despesa atualiza a prévia, mas só Aplicar muda esses totais. O aviso tonal de rascunhos explica essa diferença. Relatórios ficam indisponíveis enquanto há rascunhos; Guardar JSON continua salvando apenas o estado aplicado.

### Suggestions and declared transfers

Cada sugestão mostra origem, destino, valor e “Ainda não registrado”. Usar prepara o formulário de acerto; Registrar acerto exige uma ação posterior. Acertos declarados aparecem em registros próprios, com edição e remoção. Uma sugestão nunca ganha aparência de comprovante ou de transferência executada.

### Confirmation and empty states

O diálogo nativo concentra título, consequência e duas ações explícitas. Mensagens de estado usam a região de status; erros recebem tratamento semântico distinto. Sem pessoas ou despesas, o conteúdo explica o próximo passo e os controles dependentes ficam desabilitados. Importação inválida conserva o projeto e os rascunhos atuais. Novo projeto e substituição do trabalho usam confirmação.

## Do's and Don'ts

### Do:

- **Do** manter nomes, valores, pesos e estado próximos da ação que eles explicam.
- **Do** usar números tabulares, BRL em português e alinhamento à direita nas colunas monetárias.
- **Do** preservar a diferença textual entre prévia, estado aplicado, sugestão e acerto declarado.
- **Do** manter o recibo compacto antes do editor no celular e acesso à memória completa.
- **Do** preservar rascunhos recusados, foco visível e mensagens úteis nos estados vazios e de erro.
- **Do** manter fontes e assets locais, com suas licenças; o uso normal não depende de conexão externa.

### Don't:

- **Don't** atualizar os saldos aplicados a partir de uma prévia ainda não confirmada.
- **Don't** apresentar uma sugestão como acerto registrado ou um registro declarado como pagamento executado.
- **Don't** usar apenas cor para distinguir erro, rascunho, saldo ou centavo adicional.
- **Don't** ocultar o destino de centavos restantes para simplificar a tabela.
- **Don't** substituir o salvamento explícito por uma indicação de autosave que a aplicação não oferece.
- **Don't** introduzir sombras permanentes nas regiões planas da área de trabalho.
