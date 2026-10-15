# Studio Pilates — Sistema de Gestão

Sistema de gestão para studios de Pilates, em **um único arquivo HTML**, sem servidor, sem banco de dados e sem build. Funciona no celular (Android/iOS), no computador e pode ser instalado como app (PWA).

## Funcionalidades

- **Alunos**: cadastro, plano, dia/horário, aniversariantes e lista de espera
- **Agenda e ocupação**: grade semanal, reposições e horários
- **Financeiro e cobranças**: mensalidades, gastos, vencimentos e mensagens de cobrança por WhatsApp (com PIX copia e cola)
- **Equipamentos**: uso e histórico por aparelho
- **Evolução do aluno**: avaliação inicial, metas, histórico e relatório imprimível
- **Dashboard e relatórios**: indicadores, gráficos e relatório gerencial em PDF
- **Backup e restauração** em arquivo JSON, exportação CSV, tema claro/escuro

## Demonstração

Abra o site com `?demo=1` no final do endereço para carregar dados fictícios (75 alunos e 1 ano de histórico):

```
https://SEU-USUARIO.github.io/SEU-REPOSITORIO/?demo=1
```

- Senha do modo demonstração: **`pilates123`**
- Para sair do modo demo: acrescente `?demo=0` ao endereço.

Sem `?demo=1`, o sistema inicia **vazio**, pronto para uso real.

## Como publicar

É um site estático: basta servir os arquivos desta pasta.

**GitHub Pages**
1. Crie o repositório e envie todos os arquivos.
2. Em *Settings → Pages*, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. Em alguns minutos o site estará em `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/`.

**Netlify / Cloudflare Pages / Vercel**: importe o repositório (ou arraste a pasta), sem comando de build e com diretório de saída na raiz. O arquivo `_headers` já aplica cabeçalhos de segurança no Netlify e no Cloudflare Pages.

**Firebase (login + sincronização entre aparelhos)**: veja o passo a passo em [FIREBASE.md](FIREBASE.md).

**Uso local**: abra o `index.html` no navegador. (O modo offline/instalável exige `http(s)`, não `file://`.)

## Estrutura

```
index.html              aplicação completa (HTML + CSS + JS)
firebase-config.js      configuração do Firebase (vazio = modo 100% local)
firebase-sync.js        login + sincronização com o Firestore
sync-core.js            motor de sincronização (merge por registro)
firestore.rules         regras de segurança do banco
firebase.json           deploy (Hosting + regras)   .firebaserc → ID do projeto
FIREBASE.md             guia de publicação no Firebase
manifest.webmanifest    instalação como app (PWA)
sw.js                   cache offline (incremente CACHE_VERSION ao atualizar)
icons/                  ícones do app
_headers                cabeçalhos de segurança (Netlify/Cloudflare)
.nojekyll               evita processamento do Jekyll no GitHub Pages
```

## Dados e privacidade (LGPD)

- Por padrão, todos os dados ficam **no navegador do dispositivo** (`localStorage`) e nada é enviado a servidor algum. Nesse modo os dados não sincronizam entre aparelhos e podem ser perdidos se o navegador for limpo. **Faça backup regularmente** pela tela de Configurações.
- Opcionalmente, ao preencher `firebase-config.js`, os dados passam a ser sincronizados com o **seu** projeto Firebase (login por e-mail e senha; cada conta só acessa os próprios dados). Veja [FIREBASE.md](FIREBASE.md).
- Os dados incluem informações de saúde dos alunos (dado sensível pela LGPD). Mantenha os backups em local seguro e **nunca os envie para o repositório** (o `.gitignore` já bloqueia os nomes mais comuns).

## Segurança — leia antes de usar com dados reais

Sem Firebase, a tela de senha é um **bloqueio de uso no aparelho**, não uma proteção forte: a verificação roda no navegador e quem tiver acesso ao dispositivo e conhecimento técnico consegue contorná-la.

1. **Troque a senha padrão** (`pilates123`) no primeiro acesso, no menu de alteração de senha.
2. Cada navegador guarda a própria senha; trocar em um aparelho não altera os demais.
3. Para proteção real em um site público, use o login do Firebase ([FIREBASE.md](FIREBASE.md)) ou coloque o site atrás de autenticação do host (por exemplo Cloudflare Access).

## Dependências externas

[Chart.js 4.4.7](https://www.chartjs.org/) (jsDelivr), carregado quando uma tela de gráficos é aberta, e, só se o Firebase estiver ativo, o SDK do Firebase 10.14.1 (gstatic.com). Sem internet, o sistema funciona normalmente, mas os gráficos não aparecem. Para uso 100% offline, baixe o `chart.umd.min.js` para a pasta e ajuste a URL em `ensureChartJS()` dentro do `index.html`.

## Licença

Defina a licença do projeto antes de publicar (sem licença, o padrão legal é "todos os direitos reservados").
