# Decision Log (ADRs)

Registro de decisões de arquitetura. Cada decisão relevante ganha uma entrada ADR-NNN. Não apagar entradas antigas — se uma decisão for revertida, criar novo ADR referenciando o anterior com status `substitui ADR-NNN`.

Formato de cada entrada: **Contexto → Decisão → Alternativas rejeitadas → Consequências.**

---

## ADR-001 — Scraper em Python + Playwright
**Data:** 2026-07-13 · **Status:** aceito

**Contexto:** `angloamericana.com.br` retorna HTTP 403 para qualquer requisição sem browser real (inclusive sitemap.xml) — proteção anti-bot. `vnc.com.br` (Next.js) e `ph15.com` respondem a HTTP simples.

**Decisão:** Python 3.14 com Playwright (Chromium) para a Anglo Americana; `requests` + BeautifulSoup para VNC e PH15, com fallback Playwright se necessário. Pydantic valida o schema antes de gravar.

**Alternativas rejeitadas:** Node/Puppeteer (equivalente, mas Python já é o runtime do restante do tooling); só `requests` (impossível para a Anglo).

**Consequências:** dependência do binário Chromium (`playwright install chromium`) na máquina que roda o scraper.

---

## ADR-002 — Dados em JSON versionado no git, sem banco
**Data:** 2026-07-13 · **Status:** aceito

**Contexto:** escopo é um único bairro; volume esperado de dezenas a poucas centenas de anúncios.

**Decisão:** `data/imoveis.json` commitado no repo, sobrescrito a cada execução. Histórico de preços = histórico de commits do git.

**Alternativas rejeitadas:** SQLite/Supabase (complexidade sem ganho nesse volume); CSV (tipagem pobre, encoding).

**Consequências:** diffs de dados visíveis em PR; sem queries — o dashboard filtra em memória no browser.

---

## ADR-003 — Dashboard em HTML/CSS/JS vanilla, sem build step
**Data:** 2026-07-13 · **Status:** aceito

**Contexto:** o dashboard será revisado por múltiplos agentes e precisa rodar no GitHub Pages e localmente sem instalação.

**Decisão:** `index.html` estático + JS vanilla que faz `fetch` do JSON. Dependências vendorizadas em `assets/vendor/` (sem CDN). Gráfico de dispersão em SVG feito à mão.

**Alternativas rejeitadas:** React/Vite (build step, atrito para revisores); Chart.js via CDN (dependência externa, offline quebra).

**Consequências:** código de UI mais verboso, porém 100% inspecionável e sem cadeia de dependências.

---

## ADR-004 — Publicação via GitHub Pages (repo público), atualização manual
**Data:** 2026-07-13 · **Status:** aceito

**Contexto:** usuário quer URL fixa para acessar/compartilhar e interagir sem depender de agente. Escolheu atualização manual (sem CI agendado).

**Decisão:** GitHub Pages servindo a raiz da branch `main` de repo público. Atualizar dados = rodar `scraper/run.py` local + commit + push.

**Alternativas rejeitadas:** Artifact do claude.ai (precisa do Claude para republicar a cada mudança e não persiste edições do usuário — contraria o requisito de autonomia); GitHub Actions agendado (usuário optou por manual nesta fase; pode virar ADR futuro).

**Consequências:** dados públicos na internet; frescor dos dados depende de rodar o script.

---

## ADR-005 — Escopo: apenas venda, apenas Vila Nova Conceição
**Data:** 2026-07-13 · **Status:** aceito

**Contexto:** objetivo é avaliar compra de apartamento; R$/m² só é comparável dentro da mesma finalidade.

**Decisão:** coletar somente anúncios de **venda** no bairro **Vila Nova Conceição** nas 3 fontes.

**Consequências:** scraping menor e mais rápido; incluir aluguel/outros bairros exigirá novo ADR e filtro de finalidade no dashboard.

---

## ADR-006 — Anotações do usuário em camada separada (localStorage + backup no repo)
**Data:** 2026-07-13 · **Status:** aceito

**Contexto:** usuário visita imóveis e quer registrar endereço completo, comentário e score 1–5 por imóvel, sem backend e sem depender de agente. As anotações precisam sobreviver a re-execuções do scraper.

**Decisão:** anotações ficam em estrutura própria chaveada pelo `id` do imóvel: edição no dashboard → salva em `localStorage`; botões exportar/importar `anotacoes.json`; arquivo `data/anotacoes.json` commitado serve de backup/seed e é mesclado no boot (timestamp mais recente vence). O scraper nunca lê nem escreve anotações.

**Alternativas rejeitadas:** gravar via API do GitHub direto do browser (token exposto em repo público); anotar no próprio `imoveis.json` (scraper sobrescreveria).

**Consequências:** sincronização entre dispositivos é manual (export → commit → import); risco de perda mitigado, não eliminado.

---

## ADR-007 — Export para Excel em .xlsx via SheetJS vendorizado
**Data:** 2026-07-13 · **Status:** aceito

**Contexto:** usuário quer baixar os imóveis filtrados para Excel. CSV em Excel pt-BR sofre com encoding UTF-8 e separador `;`.

**Decisão:** botão "Baixar Excel" gera `.xlsx` real no browser com SheetJS (`assets/vendor/xlsx.min.js`, vendorizado — sem CDN), exportando as linhas visíveis pós-filtro, incluindo colunas de anotação.

**Alternativas rejeitadas:** CSV (problemas de encoding/separador); export server-side (não há servidor).

**Consequências:** ~280 KB de lib vendorizada no repo (build mini; rastreabilidade em `assets/vendor/README.md`); export sempre reflete o filtro atual.

---

## ADR-008 — Anotações pessoais nunca são commitadas (privacidade em repo público)
**Data:** 2026-07-13 · **Status:** aceito · **Revisa parcialmente o ADR-006**

**Contexto:** review de CTO apontou que o repositório e o GitHub Pages são **públicos**. O fluxo do ADR-006 sugeria commitar `data/anotacoes.json` como backup — isso publicaria endereço completo, comentários de visita, score e status de visita do usuário na internet.

**Decisão:** anotações vivem **exclusivamente no localStorage** do navegador. Backup é **somente** export/import manual de JSON, guardado localmente pelo usuário (fora do repo). O dashboard não faz mais `fetch` de `data/anotacoes.json`; o arquivo saiu do repo e está no `.gitignore`; existe apenas `data/anotacoes.example.json` com dados fictícios para documentar o formato.

**Alternativas rejeitadas:** repo privado (perderia GitHub Pages gratuito e a facilidade de compartilhar o dashboard); criptografar anotações no repo (complexidade e gestão de chave — fora do escopo).

**Consequências:** sincronização entre dispositivos é 100% manual (exportar → transferir por canal privado → importar). Perda do navegador sem backup exportado = perda das anotações; o dashboard avisa quando o armazenamento não persiste.
