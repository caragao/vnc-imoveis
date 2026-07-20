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

---

## ADR-009 — Schema ganha `condominio` e `iptu`
**Data:** 2026-07-13 · **Status:** aceito

**Contexto:** o custo real de morar não é só o preço — condomínio e IPTU pesam no mês a mês. Sondagem das fontes confirmou que os dados existem: VNC expõe `iptu`/`monthlyPropertyTax` na API (sem condomínio), PH15 expõe `valorCondominio` e `valorIptu`, e a Anglo mostra ambos na página de detalhe.

**Decisão:** adicionar dois campos **opcionais** ao `Imovel` (`scraper/models.py`): `condominio: Optional[int]` e `iptu: Optional[int]`, em reais. Opcionais porque nem toda fonte/anúncio expõe os dois (VNC não tem condomínio; alguns anúncios omitem valores). O período (mensal/anual) varia por fonte e **não é normalizado** — armazenamos o valor que a fonte informa; o dashboard exibe como está.

**Alternativas rejeitadas:** normalizar tudo para mensal (as fontes não rotulam o período de forma confiável); campo único "custo mensal" somando os dois (perde a distinção e mistura períodos incertos).

**Consequências:** duas colunas ordenáveis na tabela + no Excel + no tooltip. Valores podem parecer inconsistentes entre fontes (períodos diferentes) — é um diagnóstico, não uma métrica exata. Cobertura reportada por `validate_data.py`.

---

## ADR-010 — Duplicados entre fontes: marcar, nunca deletar
**Data:** 2026-07-13 · **Status:** aceito

**Contexto:** o mesmo imóvel costuma ser anunciado por mais de uma imobiliária, aparecendo 2–3x no JSON consolidado (fontes têm `id` próprio, então `run.py` não os funde). Isso **infla a contagem e a mediana** dos KPIs. Deletar seria arriscado: a heurística de igualdade não é perfeita e cada anúncio pode ter dados complementares (endereço na VNC, condomínio na PH15).

**Decisão:** detectar duplicados **entre fontes** no front (`assets/app.js`, `analisarDuplicados`) pela chave `(área arredondada, preço)`, considerando só grupos que abrangem ≥2 fontes distintas (colisões dentro da mesma fonte são unidades diferentes). O arredondamento da área usa a regra **meio-para-cima explícita** `floor(x+0,5)`, idêntica no dashboard (`arredondarArea`) e no validador (`validate_data.py`) — o `round()` do Python usa banker's rounding e divergiria em áreas `.5`. Num grupo, as **unidades reais** são as da fonte com mais anúncios (`unidadesReais`); as demais fontes são ecos da mesma unidade. Os **KPIs e o scatter** contam só as unidades reais; a **tabela mostra todas as linhas**, esmaecendo os ecos e marcando com selo `↔ também em {fonte}`. Nada é removido dos dados nem da tabela.

A análise é **recomputada a cada render sobre o conjunto visível** (uma chamada de `analisarDuplicados` por render, compartilhada por KPIs/scatter/tabela). Assim a marcação nunca contradiz a contagem sob filtros: se um filtro esconde a fonte-irmã, o que sobra deixa de ser tratado como duplicado (ex.: só PH15 → nenhuma linha esmaecida, todas contadas).

**Alternativas rejeitadas:** deduplicar no scraper apagando linhas (perde dados complementares e é irreversível no JSON); colapsar grupos em uma linha só (esconde anúncios que o usuário pode querer abrir).

**Consequências:** KPIs deixam de inflar; o usuário ainda vê e abre cada anúncio. A chave é sensível a arredondamento de área — casos com área ligeiramente diferente entre fontes podem escapar (aceitável para um diagnóstico visual).

---

## ADR-011 — Segundo dashboard: transações fechadas via ITBI da Prefeitura
**Data:** 2026-07-19 · **Status:** aceito

**Contexto:** o dashboard existente mostra a **oferta** (imóveis à venda anunciados pelas corretoras). Falta o outro lado: o **preço realizado** das transações que de fato ocorreram, para avaliar o valor de mercado em VNC em função de tamanho, localização e ano do imóvel. A Prefeitura de SP publica os dados de ITBI-IV (uma linha por DTI paga) em planilhas `.xlsx` anuais.

**Decisão:** criar uma **segunda camada de dados independente**, reaproveitando os padrões dos ADR-002/003/007:
- Pipeline Python em `itbi/` (irmão de `scraper/`): `build.py` lê os `.xlsx` brutos, filtra Vila Nova Conceição, normaliza via Pydantic (`itbi/models.py`) e grava `data/transacoes.json` (envelope `{atualizado_em, fonte, periodo, total, transacoes}`). `validate_data.py` reporta qualidade + valida schema.
- Página estática nova `transacoes.html` + `assets/itbi.js` (+ `assets/itbi-excel.js`), espelhando o dashboard de imóveis: KPIs, scatter SVG (valor × área construída, cor por ano), tabela ordenável, filtros e download `.xlsx`. **Sem camada de anotações** (dado público, read-only). Navegação recíproca com `index.html`.
- **Filtro VNC por CEP na faixa real do bairro (`04500`–`04515`) + rótulo**, não só pelo campo Bairro (que mistura Vila Nossa Senhora da Conceição e Sítio Conceição, e rotula como "Nova Conceição" endereços de Itaim/Vila Olímpia em `04522+` — ver docs/ITBI.md).
- **Transferências parciais (proporção <100%, ~37%) ajustadas para 100%** (`valor ÷ proporção`) como métrica principal de R$/m²; coluna de proporção + filtro "só 100%".
- **Ano da análise vem da Data de Transação**, não do mês de pagamento da guia.
- Default do dashboard = **mercado residencial** (natureza "Compra e venda" + uso 10/20/21/25); tudo filtrável.
- **Planilhas brutas NUNCA commitadas** (~65 MB, atualizadas mensalmente): `itbi/raw/` e `*.xlsx` no `.gitignore`. Só o JSON derivado entra no repo (espelha o ADR-002).

**Alternativas rejeitadas:** unir tudo em `imoveis.json`/`index.html` (oferta e transação são naturezas distintas — R$/m² e filtros diferentes; poluiria os dois); commitar os `.xlsx` (peso e crescimento mensal no git); filtrar VNC só pelo Bairro (traria bairros homônimos); usar o valor declarado bruto sem ajuste de proporção (37% das linhas apareceriam artificialmente baratas).

**Consequências:** duas fontes de verdade separadas, cada uma com seu pipeline e página. Atualizar transações é manual (baixar `.xlsx` → `python itbi/build.py` → commit do JSON). A base tem imperfeições inerentes (área construída ausente em ~18%, naturezas não-mercado) — tratadas por normalização e defaults, documentadas em docs/ITBI.md.

---

## ADR-012 — Refino do pipeline ITBI após revisão (geo, metodologia, auditoria)
**Data:** 2026-07-20 · **Status:** aceito · **Complementa o ADR-011**

**Contexto:** revisão do PR #6 (Codex + ChatGPT) apontou que o ADR-011, apesar de correto na direção, tinha lacunas: (a) a faixa de CEP `045xxxxx` era larga demais e deixava vazar Itaim Bibi/Vila Olímpia rotulados como "Nova Conceição" (74 registros, ~11% da base); (b) a proporção `NaN` do pandas fazia descartar transações em vez de aplicar o default; (c) o cabeçalho `N°` (grau) ≠ `Nº` (ordinal) fazia o SQL virar `"?"` em 100% das linhas; (d) KPIs misturavam transferências parciais extrapoladas com compras integrais; (e) faltava classificação econômica explícita e auditoria.

**Decisão:**
- **Regra geográfica final (centralizada em `itbi/util.py`):** VNC = CEP na faixa real `04500-000`–`04515-999` **E** rótulo "Nova Conceição" (sem homônimos) **E** logradouro fora de uma lista de ruas confirmadas de Itaim/Vila Olímpia (defesa em profundidade). O perímetro `04515` vem do corte limpo observado nos dados (VNC vai até `04515`; `04522+` é Itaim/VO). Não confiar no campo Bairro isolado.
- **Registros ambíguos nunca entram por default:** CEP na faixa VNC mas rótulo divergente é contado como "revisar" na auditoria, não incluído.
- **Auditoria obrigatória** no `build.py` a cada execução: brutas, aceitas, excluídas por CEP/rua, ambíguas, CEPs aceitos com contagem, ruas excluídas, quantos usaram default de proporção e o delta vs o JSON anterior. `validate_data.py` reporta composição por natureza/tipo de ativo/padrão/proporção/área.
- **Cabeçalhos casados por forma normalizada** (`_norm_header`, tolerante a acento/º/°/espaço), não por igualdade exata.
- **Inclusão residencial explícita (não por percentil):** KPIs/scatter padrão = unidades residenciais de mercado (uso IPTU 20 apartamento, 25 flat, 10 casa), **excluindo** cadastro de prédio inteiro (uso 21), vagas, depósitos, lojas, escritórios e terrenos. Campo `tipo_ativo` derivado do uso permite segmentar.
- **Transferências parciais fora dos indicadores padrão:** KPIs e scatter só usam transferências **integrais (100%)**; parciais ficam na tabela. Nomenclatura corrigida para `valor equivalente a 100%` / `extrapolado` (não "preço real da unidade").
- **Metodologia visível:** seção "Metodologia e limitações" no dashboard; comparação oferta×realizado permanece **não** implementada (exigiria controle por área/tipo/idade/padrão etc.).

**Alternativas rejeitadas:** manter a faixa larga de CEP com validação só por rótulo (vaza bairros vizinhos); usar corte por percentil no lugar de classificação econômica (esconde o problema, não classifica); descartar linhas com proporção ausente (perde dados válidos).

**Consequências:** a base cai de ~396 para ~322 transações (remoção do vazamento), e os KPIs passam a refletir só compras integrais de unidades residenciais — números menores porém defensáveis. A cada atualização mensal, conferir a auditoria do `build.py` (CEPs novos, ambíguos, ruas) antes de commitar o JSON.
