# CLAUDE.md — instruções para agentes

Projeto: dashboard estático de imóveis à venda em Vila Nova Conceição (SP), com scraper Python e publicação via GitHub Pages. Dono: caragao. Revisão feita por múltiplos agentes (Claude Cowork, ChatGPT) — a documentação é o contrato entre eles.

## Fluxo de trabalho (obrigatório)

1. **Nunca commitar direto na `main`.** Todo trabalho em branch (`feat/...`, `fix/...`, `docs/...`) e Pull Request via `gh pr create`.
2. **Toda decisão de arquitetura vira ADR** em `docs/DECISION_LOG.md` (numeração sequencial ADR-NNN, formato do arquivo). Isso inclui: trocar biblioteca, mudar schema de dados, mudar estratégia de scraping.
3. **Mexeu em scraper → atualizar `docs/SCRAPERS.md`** (URLs, seletores, quirks anti-bot descobertos).
4. **PR deve preencher o template** (`.github/pull_request_template.md`) — checklist de docs e validação de dados.
5. Commits pequenos com mensagem em português no imperativo: `adiciona filtro de suítes`, `corrige parse de preço da VNC`.

## Arquitetura em 30 segundos

```
scraper/run.py  ──gera──▶  data/imoveis.json  ──fetch──▶  index.html + assets/*.js
(Python, manual)           (commitado no git)             (vanilla JS, GitHub Pages)
```

- **Sem backend, sem build step, sem framework.** O dashboard é HTML/CSS/JS puro que qualquer agente consegue revisar. Não introduzir React/bundlers/CDNs — dependências JS são vendorizadas em `assets/vendor/`.
- **Duas camadas de dados independentes**, unidas pelo `id` do imóvel:
  - `data/imoveis.json` — só o scraper escreve. Envelope `{"atualizado_em", "imoveis": [...]}`.
  - `data/anotacoes.json` + localStorage — só o usuário escreve (via dashboard). **O scraper nunca toca em anotações.**
- Schema do imóvel validado por Pydantic em `scraper/models.py`. `id` = `{fonte}-{código do anúncio}` (estável entre execuções).

## Comandos

```bash
# atualizar dados
cd scraper && pip install -r requirements.txt && playwright install chromium
python run.py

# dashboard local
python -m http.server 8000   # na raiz do repo

# PR
git checkout -b feat/minha-mudanca
gh pr create --fill
```

## Regras específicas de scraping

- Escopo: **bairro Vila Nova Conceição, finalidade venda** (ADR-005). Não coletar aluguel nem outros bairros.
- `angloamericana.com.br` retorna 403 para HTTP simples — **só Playwright** (ADR-001).
- Ser educado: delay entre requisições, user-agent identificável, não paralelizar agressivamente.
- Falha em uma fonte não pode derrubar a execução: logar, seguir com as demais e reportar no final.
- Preços em centavos não: usar `int` de reais (ex.: `11900000`). Área em `float` m². `preco_m2` = `round(preco / area_util_m2)`.

## Armadilhas conhecidas

- `data/imoveis.json` é sobrescrito por completo a cada execução do scraper — histórico fica nos commits do git.
- O dashboard precisa funcionar via `python -m http.server` E no GitHub Pages (paths relativos sempre).
- Excel brasileiro + CSV = encoding quebrado; por isso export é `.xlsx` via SheetJS vendorizado (ADR-007).
