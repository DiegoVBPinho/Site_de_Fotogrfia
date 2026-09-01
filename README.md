# Diego Victor — Fotografia

Site portado do deploy atual (`https://diegovictor.netlify.app`), com uma mudança
central: os álbuns, fotos, texto "Sobre mim" e contatos agora vêm de uma
**planilha Google** em vez de estarem fixos em `js/data.js`. Editar a
planilha atualiza o site — sem redeploy.

Design, animações e toda a navegação (mural, álbuns aninhados, linha do
tempo, lightbox, busca) são os mesmos de antes — só a fonte dos dados mudou.

## Como configurar a planilha (uma vez só)

1. Crie uma planilha nova em [sheets.google.com](https://sheets.google.com).
2. Crie 4 abas com esses nomes exatos: `Albuns`, `Fotos`, `Categorias`, `Config`.
3. Em cada aba: **Arquivo → Importar → Upload**, escolha o CSV correspondente
   em [`csv/`](csv/) deste projeto, e marque **"Substituir planilha"**.
   - [`csv/Albuns.csv`](csv/Albuns.csv) → aba `Albuns`
   - [`csv/Fotos.csv`](csv/Fotos.csv) → aba `Fotos`
   - [`csv/Categorias.csv`](csv/Categorias.csv) → aba `Categorias`
   - [`csv/Config.csv`](csv/Config.csv) → aba `Config`
   - Esses CSVs já têm os 39 álbuns e 360 fotos do site atual — nada pra
     retdigitar.
4. **Compartilhar → Geral → "Qualquer pessoa com o link" → Leitor.**
   (sem isso o site não consegue ler a planilha)
5. Preencha as 3 linhas em branco da aba `Config`: `instagram`, `whatsapp`
   (só números, com DDI+DDD) e `email`. Os links do rodapé ficam inativos
   até isso ser preenchido.
6. Copie o ID da planilha, o trecho da URL entre `/d/` e `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`ESTE_PEDAÇO`**`/edit`
7. Cole esse ID em [`js/data.js`](js/data.js), na constante `SHEET_ID` (linha ~15).

Feito isso, o site passa a ler direto da planilha. Pra testar antes de ter
a planilha pronta, o site já roda com os CSVs locais (é o padrão enquanto
`SHEET_ID` não for trocado).

## Adicionando conteúdo depois

Veja o painel **"Como atualizar o site"** no rodapé do próprio site — mesmo
conteúdo deste guia, pra consulta rápida sem precisar abrir o projeto.

Fotos novas: suba a imagem numa pasta do Google Drive, clique com o botão
direito → **Compartilhar** → **Copiar link** (acesso "Qualquer pessoa com
o link"), e cole esse link na coluna `imagem`/`capa` da planilha. O site
identifica que é um link do Drive e converte pro formato de imagem sozinho.

As ~360 fotos que já existem continuam apontando pra `images/...`
(arquivos deste projeto) — não precisam ser movidas pro Drive. Drive é só
pra fotos novas, daqui pra frente.

## Bugs encontrados no site atual (corrigidos aqui)

- **Links de contato mortos:** Instagram/WhatsApp/E-mail no rodapé eram
  `href="#"` — nunca tinham sido preenchidos. Agora vêm da aba `Config`.
- **Foto quebrada:** `images/rural/rural-01.jpg` (álbum "Rural") dava 404
  no deploy atual — o registro existia nos dados mas o arquivo da foto
  nunca foi publicado. Não incluí esse arquivo aqui (não tenho a foto
  original); a linha continua em `csv/Fotos.csv` — troque a coluna
  `imagem` por um link do Drive com a foto certa, ou apague a linha.

## O que mudou no código

- `js/data.js` — reescrito: busca as 4 abas da planilha (formato CSV),
  monta os mesmos objetos `ALBUMS`/`PHOTOS`/`CATEGORIAS`/`SOBRE_MIM_TEXTO`/
  `CONTATO` que o site já usava, e só então injeta `js/main.js` na página.
- `js/main.js` — idêntico ao original, exceto o trecho que liga os links
  de contato (agora usa `CONTATO` em vez de ficar sempre desativado).
- `js/admin.js` e o gerenciador antigo (zip + colar código) saíram —
  substituídos pela planilha.
- `images/` — as fotos, logo e assinatura foram copiadas do deploy atual,
  sem alteração.

## Publicar

Mesma rotina de antes: suba esta pasta pro repositório/Netlify ligado ao
site (arraste a pasta no painel da Netlify, ou `git push` se for
repositório). `SHEET_ID` já configurado é o suficiente — não precisa
tocar em mais nada no código pra manutenção do dia a dia.
