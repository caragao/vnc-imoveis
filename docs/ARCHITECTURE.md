# Arquitetura

## Visão geral

```
┌─────────────────────────── coleta (manual, local) ───────────────────────────┐
│                                                                               │
│  scraper/sites/vnc.py ────────┐                                               │
│  scraper/sites/ph15.py ───────┼──▶ scraper/run.py ──▶ data/imoveis.json       │
│  scraper/sites/angloamericana.py (Playwright)  (valida com models.py/Pydantic)│
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                        │  git commit + push
                                        ▼
┌─────────────────────────── exibição (GitHub Pages) ──────────────────────────┐
│                                                                               │
│  index.html ──▶ assets/app.js ──fetch──▶ data/imoveis.json                    │
│                     │                                                         │
│                     ├── assets/anotacoes.js ◀──▶ localStorage                 │
│                     │        └──merge boot──▶ data/anotacoes.json (backup)    │
│                     └── assets/excel.js ──▶ .xlsx (SheetJS vendorizado)       │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Componentes

### Scraper (`scraper/`)
- `run.py` — orquestrador: chama os 3 módulos de site, consolida, calcula `preco_m2`, valida cada item com Pydantic, grava `data/imoveis.json` com envelope `{"atualizado_em", "imoveis"}`. Falha em uma fonte não aborta as demais (loga e segue).
- `models.py` — `Imovel` (Pydantic): schema único das 3 fontes.
- `sites/*.py` — um módulo por fonte, cada um expõe `coletar() -> list[Imovel]`. Detalhes por site em [SCRAPERS.md](SCRAPERS.md).

### Dados (`data/`)
- `imoveis.json` — **escrito apenas pelo scraper**. Sobrescrito por completo a cada execução; histórico via git.
- `anotacoes.json` — **escrito apenas pelo usuário** (export do dashboard, commitado manualmente). Dicionário `{id do imóvel: anotação}`.
- As duas camadas se unem pelo `id` (`{fonte}-{código do anúncio}`), estável entre execuções.

### Dashboard (raiz + `assets/`)
- `index.html` — layout: KPIs, barra de filtros, tabela, scatter, painel de detalhe/edição.
- `app.js` — estado dos filtros, ordenação, render da tabela e do scatter SVG.
- `anotacoes.js` — camada de persistência: lê `data/anotacoes.json`, mescla com `localStorage` (campo `atualizado_em` mais recente vence), salva edições, exporta/importa JSON.
- `excel.js` — monta planilha com as linhas filtradas + colunas de anotação e dispara download `.xlsx`.
- `vendor/xlsx.min.js` — SheetJS vendorizado (única dependência JS).

## Restrições de projeto
- Sem backend, sem build, sem CDN (ADR-003). Paths sempre relativos (funciona em Pages e em `http.server`).
- Scraper nunca toca em anotações (ADR-006).
- Escopo de coleta: venda + Vila Nova Conceição (ADR-005).

Racional completo de cada decisão: [DECISION_LOG.md](DECISION_LOG.md).
