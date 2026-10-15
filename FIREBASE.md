# Publicar no Firebase (Hosting + Login + Nuvem)

O sistema continua funcionando 100% no aparelho (offline). Com o Firebase configurado, ele passa a ter:

- **Login por e-mail e senha** (Firebase Authentication)
- **Sincronização entre aparelhos** (Cloud Firestore), com cópia na nuvem
- **Hospedagem** com HTTPS (Firebase Hosting)

Plano gratuito (Spark): 50 mil leituras e 20 mil gravações por dia, 1 GiB de dados. Para um studio, sobra.

---

## 1. Criar o projeto

1. Acesse https://console.firebase.google.com → **Adicionar projeto**.
2. Dê um nome (ex.: `meu-studio`). Pode **desativar o Google Analytics**.
3. Anote o **ID do projeto** (aparece em *Configurações do projeto*).

## 2. Ativar o login

1. **Build → Authentication → Vamos começar**.
2. Aba **Sign-in method** → **E-mail/senha** → ativar (deixe "Link por e-mail" desligado) → Salvar.
3. Aba **Users** → **Adicionar usuário** → informe o e-mail e uma senha forte. Esse é o login do sistema.
4. Aba **Settings → User actions** → **desmarque "Enable create (sign-up)"**. Assim ninguém consegue criar conta por conta própria.

## 3. Criar o banco

1. **Build → Firestore Database → Criar banco de dados**.
2. Local: **southamerica-east1 (São Paulo)**. *Não dá para mudar depois.*
3. Modo: **Produção** (as regras deste projeto substituem o padrão no passo 6).

## 4. Pegar a configuração do app

1. **Configurações do projeto (engrenagem) → Seus apps → ícone Web `</>`**.
2. Apelido: `studio-web`. **Não** marque Hosting aqui. Registrar app.
3. Copie o objeto `firebaseConfig` e cole em **`firebase-config.js`**:

```js
window.SP_FIREBASE = {
  apiKey: "AIzaSy...",
  authDomain: "meu-studio.firebaseapp.com",
  projectId: "meu-studio",
  appId: "1:123456789:web:abcdef"
};
```

Esses valores não são segredo. A proteção dos dados é o login + as regras do passo 6.

## 5. Instalar a ferramenta de publicação

Precisa do [Node.js](https://nodejs.org) (versão LTS). No terminal, dentro da pasta do projeto:

```bash
npm install -g firebase-tools
firebase login
```

Abra o arquivo **`.firebaserc`** e troque `SEU-PROJETO-ID` pelo ID do projeto (ou rode `firebase use --add` e escolha o projeto).

## 6. Publicar regras e site

```bash
firebase deploy --only firestore:rules   # regras de segurança (firestore.rules)
firebase deploy --only hosting           # o site
```

Ou tudo de uma vez: `firebase deploy`.

O terminal mostra o endereço: `https://meu-studio.web.app` (e `.firebaseapp.com`).

## 7. Primeiro acesso e migração dos dados

1. **Entre primeiro no aparelho que tem os dados mais atuais** (o que você usa hoje). Abra o endereço, faça login.
2. O indicador **☁ Sincronizado** (no topo) confirma o envio. No console, em Firestore, aparecem `studios → {seu uid} → data`.
3. Só depois entre nos outros aparelhos (celular, outro computador). Eles baixam tudo automaticamente.
4. No celular: menu do navegador → **Adicionar à tela inicial** (instala como app).

> Aparelho novo com dados próprios: os registros são **unidos** (nada é apagado), mas as *configurações* do remoto prevalecem. Por isso a ordem acima.

## Como funciona

| Item | Comportamento |
|---|---|
| Local primeiro | Tudo é salvo no aparelho na hora; a nuvem sincroniza em segundo plano (1,5 s depois). |
| Offline | Continua funcionando. Ao voltar a internet, envia e recebe sozinho. |
| Conflitos | Mescla por registro. Dois aparelhos editando registros diferentes: ambos preservados. Mesmo registro: vale o `updatedAt` mais novo. Nada é apagado só porque um documento sumiu. |
| Indicador ☁ | Verde = sincronizado · azul = sincronizando · laranja = offline · vermelho = erro (toque para tentar de novo). |
| Sair | Botão de cadeado do menu vira **Sair da conta**. Os dados ficam no aparelho (modo offline). |
| Outra conta | Se entrar com outra conta num aparelho com dados, o sistema pergunta antes de substituir. |
| Modo demo (`?demo=1`) | Nunca sincroniza (não envia dados de exemplo para a sua conta). |

## Segurança

- Regras (`firestore.rules`): cada conta só lê/grava `studios/{seu uid}/...`. Todo o resto é negado.
- **Senha forte** na conta (é ela que protege dados de saúde dos alunos).
- Várias pessoas usando o sistema = **o mesmo login** (os dados são por conta). Cada um pode ter o próprio aparelho.
- Opcional, recomendado: **Authentication → Settings → Password policy** (exigir senha forte) e **App Check** (reCAPTCHA) para limitar abuso.
- **Alerta de orçamento**: no Google Cloud (Billing → Budgets) crie um alerta, por segurança.

## Backup

A nuvem sincroniza, mas **não é backup** (uma exclusão também é sincronizada). Continue exportando o **backup JSON** do sistema (Configurações) periodicamente. O backup agendado do Firestore exige plano pago (Blaze).

## Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| Tela mostra "Não foi possível carregar o Firebase" | Sem internet no primeiro acesso, ou bloqueio de `gstatic.com`. Recarregue com internet. |
| "E-mail ou senha incorretos" | Confira o usuário em Authentication → Users; use "Esqueci minha senha". |
| Indicador vermelho `permission-denied` | Regras não publicadas: rode `firebase deploy --only firestore:rules`. |
| Indicador vermelho `too-large` | Um bloco de dados passou de ~900 KB (muito improvável; avise o desenvolvedor). |
| Domínio próprio/GitHub Pages: erro de domínio | Authentication → Settings → **Authorized domains** → adicionar o domínio. (`*.web.app` e `*.firebaseapp.com` já vêm liberados.) |
| Atualizei o site e o celular mostra a versão velha | Incremente `CACHE_VERSION` em `sw.js`, publique de novo e reabra o app. |

## Atualizar o sistema depois

Edite os arquivos e rode `firebase deploy --only hosting`. Os dados na nuvem não são afetados.
