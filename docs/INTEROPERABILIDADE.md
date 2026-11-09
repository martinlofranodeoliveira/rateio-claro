# Conferência independente e consumidores

O aplicativo opera sobre centavos inteiros. O leitor `tools/check_downloads.py` reconstrói cada quota com `fractions.Fraction` e inteiros arbitrários do Python, sem importar o núcleo JavaScript. Compara a memória JSON inteira, todas as células dos três CSVs e as tabelas semânticas do Markdown. Confere também os totais, as seções e as descrições das despesas. O JSON original permanece a fonte dos dados declarados.

## Oráculo independente

O leitor faz o piso de cada quota racional, ordena os restos por valor decrescente e desempata pelo ID ASCII. Distribui os centavos restantes em cada despesa separadamente. Reconstrói os saldos como `pago − parcela + enviado − recebido` e as sugestões consumindo devedores e credores na ordem dos IDs. Isso não promete o menor número de transferências.

O parser JSON recebe os lexemas numéricos antes de qualquer conversão para ponto flutuante. Recusa ponto decimal, expoente, valores não finitos, chaves repetidas, BOM e UTF-8 inválido. O projeto tem limite de 2 MiB. A memória derivada pode ser maior; o leitor usa um limite próprio de recursos de 64 MiB para ela. O leitor exige exatamente os seis nomes canônicos, sem arquivos adicionais ou links simbólicos:

```text
rateio-projeto.json
rateio-memoria.json
rateio-saldos.csv
rateio-parcelas.csv
rateio-sugestoes.csv
rateio-relatorio.md
```

Os 16 testes Python incluem ouro literal da demonstração, empate de centavo, despesas juntas e separadas, projeto vazio, pagador fora dos beneficiários, homônimos, produto acima de 2^53, sinal de sobrepagamento, invariância da ordem e reaplicação das sugestões. Um cenário literal exige três sugestões do algoritmo mesmo havendo uma alternativa válida com duas transferências. Mutações alteram cada um dos seis exports, os nomes dos arquivos, uma célula ODS importada e um cache de fórmula XLSX. O leitor recusa essas alterações.

```bash
python3 -m unittest discover -s tests/python -v
python3 tools/check_downloads.py fixtures/interop/node-reference --provenance node-reference
python3 tools/check_downloads.py fixtures/interop/text-reference --provenance node-reference
python3 tools/check_downloads.py fixtures/interop/libreoffice-chrome/downloads --provenance chrome-download
```

## Execuções reais do LibreOffice

As evidências `fixtures/interop/libreoffice-node/evidence.json` e `fixtures/interop/libreoffice-text-node/evidence.json` registram execuções reais do LibreOffice 26.2.6.3 no Linux. As entradas desses dois ensaios foram produzidas pelas funções de exportação chamadas diretamente pelo Node, conforme o campo `provenance: node-reference`. Elas não são apresentadas como downloads de navegador.

A terceira execução, `fixtures/interop/libreoffice-chrome/evidence.json`, consumiu os seis arquivos realmente baixados pelos botões da interface no Chrome. O registro `acquisition.json` guarda os nomes observados, tamanhos, SHA-256 e origem `Chrome UI Blob download`. O leitor conferiu os bytes recebidos contra esse inventário antes de chamar o LibreOffice. As cópias preservadas em `downloads/` mantêm os mesmos hashes. `fixtures/interop/chrome-download-check.json` registra a reconstrução independente desses arquivos, com despesas de 26.901 centavos, acertos de 2.000 e pendência de 3.450. Os saldos conferidos foram Ana 1.850, Bruno 1.600, Clara −150 e Diego −3.300 centavos.

Cada execução usou `unshare --user --map-root-user --net`, diretório pessoal/XDG temporários e perfil novo e exclusivo. O script desabilitou macros e atualização de links nesse perfil, manteve a rede isolada por namespace e não alterou políticas globais do kernel. Não leu nem reutilizou o perfil de escritório do usuário.

O importador CSV recebeu delimitador vírgula, aspas duplas, UTF-8 e formato **Texto** explicitamente em todas as colunas. Detecção de números especiais/científicos, remoção de espaços e importação como fórmulas ficaram desabilitadas. O significado dos parâmetros está na [documentação oficial do filtro CSV do LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/csv_params.html). A sequência exata utilizada por arquivo fica em `csvImportOptions` e no comando registrado na evidência.

O script lê o `content.xml` dos ODS resultantes e exige igualdade de todas as células, tipo textual, ausência de fórmulas e de relações externas. Os centavos continuam sendo lexemas inteiros exatos nessas importações textuais. Essa etapa verifica preservação dos relatórios, não operações aritméticas com essas células textuais.

| Entrada | CSVs | Células comparadas | Resultado |
| --- | ---: | ---: | --- |
| Demonstração Node | 3 | 180 | Preservadas |
| Texto autoral Node | 3 | 138 | Preservadas |
| Downloads reais do Chrome | 3 | 180 | Preservadas |

O caso de texto inclui nomes iniciados por `=`, `+`, `-` e `@`, vírgula, aspas, pipe, HTML literal, `_x0041_`, acentos e emoji. O JSON mantém os textos autorais originais; os CSVs acrescentam o apóstrofo protetor previsto no contrato. O LibreOffice preservou esse texto, incluindo o apóstrofo, sem criar fórmulas.

## Auditoria de fórmulas separada

O arquivo de QA `audit-source.xlsx` é autoria independente do leitor Python, com fórmulas usuais `SUM`, `INT`, `MOD`, `COUNTIF`, `COUNTIFS`, `IF` e `MAX`. Ele não é um export do aplicativo. Entradas e esperados são literais explícitos de cinco cenários: demonstração, empate, uma despesa de dois centavos, duas despesas de um centavo e sobrepagamento declarado.

O LibreOffice abriu, recalculou e salvou esse arquivo em XLSX. O verificador compara 189 caches numéricos de fórmulas contra esperados inteiros literais, com tolerância zero, e confere as entradas e os esperados antes e depois. Os 189 são as mesmas verificações em cada execução, não cenários adicionais ao repetir o ensaio. Uma mutação em um cache demonstra que só encontrar fórmulas no arquivo não basta.

Essa auditoria usa números pequenos e inteiros representáveis pelo consumidor. Ela não prova aritmética exata genérica do Excel, não substitui o núcleo BigInt e não garante outros programas, locais de importação ou salvamentos posteriores. Os produtos grandes do contrato são conferidos pelo oráculo de inteiros/Fraction, não por fórmulas em ponto flutuante.

## Repetir ou conferir o registro

Verificar artefatos guardados usa só a biblioteca padrão Python e não executa novamente o LibreOffice:

```bash
python3 tools/verify_libreoffice.py --check-fixtures
python3 tools/verify_libreoffice.py --check-fixtures --fixtures-dir fixtures/interop/libreoffice-text-node
python3 tools/verify_libreoffice.py --check-fixtures --fixtures-dir fixtures/interop/libreoffice-chrome
```

O resultado declara `mode: stored-evidence-only` e `newExternalExecution: false`. O verificador reabre os arquivos guardados, compara hashes/tamanhos, reconstrói os seis exports e repete as comparações semânticas. Isso confirma o registro armazenado, sem alegar uma nova execução externa.

Para uma execução externa nova, use diretório de saída que ainda não exista. O `openpyxl` 3.1.5 serve somente à autoria do workbook de QA; não é dependência do aplicativo estático nem do leitor independente:

```bash
uv venv .venv-interop
uv pip install --python .venv-interop/bin/python openpyxl==3.1.5
.venv-interop/bin/python tools/verify_libreoffice.py fixtures/interop/node-reference --provenance node-reference --output-dir local/libreoffice-nova-execucao
```

Para arquivos realmente baixados no Chrome, substitua o diretório de entrada e passe `--provenance chrome-download`. Nesse modo o ensaio externo também exige `--acquisition-proof`, com o inventário observado dos seis downloads, seus nomes, tamanhos e hashes. O leitor simples registra o método informado pelo operador; nenhum desses scripts autentica sozinho o navegador. A aquisição real foi observada na etapa de interface e seu registro separado foi confrontado com os bytes consumidos.

```bash
.venv-interop/bin/python tools/verify_libreoffice.py local/chrome-downloads --provenance chrome-download --acquisition-proof local/chrome-download-proof.json --output-dir local/libreoffice-nova-execucao-chrome
```

Os registros guardam comandos, versão, opções de importação, hashes SHA-256, tamanhos e resultados medidos. Caminhos privados dos comandos/stdout/stderr são substituídos por `[TEMP]`, `[TEMP_URI]` e `[EVIDENCE]`, mantendo a estrutura dos argumentos executados; os workbooks guardados não contêm o caminho pessoal do workspace. A evidência deve ficar fora do diretório que contém os seis downloads, para que arquivos auxiliares não sejam confundidos com exports.
