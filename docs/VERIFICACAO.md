# Verificação reproduzível

Este documento separa comandos locais, referências de arquivo e verificações que dependem de navegador, consumidor externo ou hospedagem. Uma fixture armazenada não equivale a uma nova execução. O resultado deve ser associado aos arquivos e ao commit efetivamente verificados.

## Ambiente e comandos locais

O projeto requer Node.js 22 ou 24. Não há dependências npm de execução ou build. Python 3 é usado para a conferência independente e para o empacotamento de release. A execução local inicial foi observada com Node v22.22.1, npm 9.2.0 e Python 3.14.4 em 09/11/2026.

Na raiz do projeto:

```sh
npm test
npm run build
npm run check
npm run dev
```

`npm test` executa `node --test tests/*.test.mjs`. Os testes do núcleo usam valores literais e um oráculo de pequenos rateios; cobrem quocientes acima de 2⁵³, desempate ordinal por ID, despesas separadas, pagador fora dos beneficiários, acertos e sobrepagamentos, repetição das sugestões, homônimos, remoção atômica, limites e cópias congeladas. Os testes de IO cobrem bytes UTF-8, BOM, chaves duplicadas, lexemas numéricos antes do arredondamento, tamanho, getters/`toJSON`, conteúdo CSV e escape Markdown.

`npm run build` copia somente [a lista pública](../scripts/public-files.mjs) para `dist/`, preservando os bytes das fontes. Gera `.nojekyll` vazio e `build-manifest.json` com tamanho e SHA-256 de cada arquivo distribuído, exceto o próprio manifesto. Nenhum diretório inteiro de fontes, testes, documentos ou arquivos locais entra na distribuição por coincidência de nome.

`npm run check` exige um `dist/` já gerado. Confere lista exata de arquivos, ausência de links simbólicos, igualdade dos bytes entre fontes e distribuição, manifesto determinístico, CSP sem conexões, recursos locais, sintaxe dos módulos e hashes/licenças das fontes OFL. Esse comando confere a distribuição local; não consulta GitHub Actions nem comprova um deploy.

`npm run dev` serve o build disponível em [http://127.0.0.1:4173/](http://127.0.0.1:4173/) e usa as fontes se não houver `dist/`. Para servir as fontes explicitamente, use `npm run dev -- --source`. `--port 4174` escolhe outra porta. O servidor aceita apenas GET/HEAD da lista pública. Encerre com `Ctrl+C`.

## Conferência independente dos arquivos

```sh
python3 -m unittest discover -s tests/python -v
python3 tools/check_downloads.py fixtures/interop/node-reference --provenance node-reference
```

O [verificador Python](../tools/check_downloads.py) usa a biblioteca padrão, inteiros de precisão arbitrária e `Fraction`; não importa `src/core.mjs` nem `src/io.mjs`. Ele reconstrói projeto, parcelas, saldos e sugestões e compara os seis arquivos com os nomes canônicos. Também interpreta CSV e tabelas Markdown, confere os textos escapados e gera hashes dos arquivos de entrada.

A referência em `fixtures/interop/node-reference/` foi gerada localmente pelos exportadores JavaScript e é identificada como `node-reference`. A [fixture de projeto](../fixtures/demo-project.json) vem de `serializeProject(demoProject())` executado por Node. Nenhuma dessas origens afirma aquisição por navegador.

Para conferir seis arquivos efetivamente baixados no navegador, coloque somente os downloads canônicos em um diretório e use:

```sh
python3 tools/check_downloads.py caminho/dos/downloads --provenance chrome-download --report caminho/relatorio-fora-dos-downloads.json
```

O argumento `--provenance` é uma declaração da aquisição, não uma comprovação automática de que Chrome foi executado. A evidência de navegador deve identificar a execução e os bytes obtidos. Um relatório deve ficar fora do diretório dos seis arquivos para não contaminar a conferência de nomes exatos.

O [documento de interoperabilidade](INTEROPERABILIDADE.md) concentra o procedimento e a evidência do consumidor LibreOffice, separando nova execução externa de releitura de fixtures já registradas. Relatórios de planilha não implicam equivalência com Excel nem exatidão universal de fórmulas em ponto flutuante.

## Conferência funcional da interface

A conferência manual em Chrome foi registrada em [CONFERENCIA-NAVEGADOR.json](CONFERENCIA-NAVEGADOR.json), com os bytes da ida e volta do projeto. Os passos abaixo permitem reproduzir o fluxo; não são testes de browser executados pela CI. As seis exportações reais também passaram pela reconstrução Python e pelo consumidor descrito em [INTEROPERABILIDADE.md](INTEROPERABILIDADE.md).

1. No exemplo inicial, conferir 26.901 centavos de despesas, 2.000 de acertos e 3.450 pendentes. Saldos de Ana, Bruno, Clara e Diego: 1.850, 1.600, −150 e −3.300 centavos. O almoço atribui 3.001 a Ana e 3.000 a cada outra pessoa.
2. Editar valor, beneficiários e pesos de uma despesa, mudar de registro e voltar. Conferir preservação do rascunho, pesos dos excluídos e indicação de prévia. Uma entrada inválida deve conservar o projeto aplicado e o rascunho.
3. Verificar que relatórios ficam bloqueados com rascunhos e que **Guardar JSON** continua exportando somente o estado aplicado. Aplicar ou descartar cada rascunho deve liberar os relatórios.
4. Preparar uma sugestão e conferir que ela não aumenta o número de acertos. Registrar explicitamente o acerto e conferir mudança de saldo sem aumento do custo. Editar uma despesa deve preservar os acertos existentes.
5. Tentar remover participante referenciado e confirmar recusa integral. Conferir homônimos com identidades distintas e tratamento dos participantes usados somente em rascunhos.
6. Abrir JSON válido e inválido, cancelar substituições e cancelar diálogos com Escape após uma confirmação anterior aceita. Conferir que projeto e rascunhos permanecem quando a ação é cancelada.
7. Usar **Desfazer**, guardar o JSON aplicado e reabri-lo. Conferir o aviso de saída com trabalho pendente sem contornar a confirmação nativa do navegador.
8. Usar teclado e viewport estreito, conferir foco, labels, mensagens, conteúdo sem dependência de cor e recursos locais. Verificar os seis downloads reais com o consumidor independente.

## Publicação e release

Destino previsto para GitHub Pages: [martinlofranodeoliveira.github.io/rateio-claro](https://martinlofranodeoliveira.github.io/rateio-claro/). O endereço é futuro até que haja registro de deploy bem-sucedido. Um build local aprovado não comprova que esse endereço está disponível.

A evidência de publicação deve identificar o commit, a execução de CI e a execução de Pages do mesmo commit. A evidência de release deve identificar os quatro assets — fonte ZIP, distribuição estática ZIP, projeto JSON de exemplo e `SHA256SUMS` — e conferir os bytes baixados novamente, hashes e integridade dos ZIP. Contagens e tamanhos devem vir dos arquivos finais medidos.

Este documento não atribui resultado a Chrome, LibreOffice, CI, Pages ou release sem o registro correspondente. Para resultados externos, consultar a proveniência e os relatórios ligados em [INTEROPERABILIDADE.md](INTEROPERABILIDADE.md) e a evidência adicionada junto à publicação final.
