# Privacidade e arquivos locais

O Rateio Claro processa os dados do projeto no navegador. Não há conta, autenticação, integração bancária, execução de pagamentos, envio de projetos para servidor ou telemetria do aplicativo. Valores, despesas e acertos são declarações de quem preenche o projeto.

O aplicativo não usa armazenamento persistente, sincronização nem salvamento automático. O estado aplicado, os rascunhos e o histórico temporário de desfazer ficam na memória da página. Fechar ou recarregar a página pode perder esse trabalho; o arquivo `rateio-projeto.json` baixado explicitamente é a forma de guardá-lo e reabri-lo.

Abrir um arquivo lê os bytes selecionados pelo usuário e valida o projeto antes de substituir o estado atual. Um arquivo inválido não deve apagar o projeto em uso. A importação exige UTF-8 estrito, formato e limites definidos em [FORMATO.md](FORMATO.md); mensagens de leitura não repetem dados autorais do arquivo. Código fornecido no JSON não é executado.

Os downloads contêm dados declarados e resultados do cálculo. O projeto JSON conserva nomes, despesas, pesos e notas de acertos; a memória e os relatórios também podem identificar pessoas e relações entre elas. O local de destino e o compartilhamento desses arquivos ficam sob controle do usuário e do navegador. Ao enviar um relatório a alguém, os dados presentes nesse arquivo são compartilhados com o destinatário.

Os relatórios não têm rastreadores, credenciais, identificadores de conta ou dados ocultos de outra aplicação. Os textos do relatório Markdown são escapados. Os CSV recebem proteção de texto para líderes de fórmula, conforme [FORMATO.md](FORMATO.md); programas externos continuam responsáveis por sua importação e interpretação.

A distribuição web é estática. O acesso à página e aos seus arquivos locais de interface passa pelo provedor de hospedagem, que pode manter seus próprios registros de acesso. Isso não envolve upload do conteúdo do projeto pelo aplicativo. Fontes e código usados pela interface são distribuídos com o próprio site; o aplicativo não depende de serviços externos de execução para calcular o rateio.

O exemplo incluído é fictício e autoral. Nenhum dado de cliente, usuário de outro serviço ou banco foi copiado para a demonstração. Esta documentação descreve o comportamento implementado, sem alegar certificação de segurança ou verificação de que os acertos declarados aconteceram.
