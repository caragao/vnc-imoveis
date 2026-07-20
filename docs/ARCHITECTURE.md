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
│                     ├── assets/anotacoes.js ◀──▶ localStorage (só local!)     │
│                     │        └── export/import manual de JSON (ADR-008)       │
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
- Anotações do usuário — **somente no localStorage do navegador** (dicionário `{id do imóvel: anotação}`), com export/import manual de JSON guardado localmente. **Nunca commitadas: o repo e o Pages são públicos (ADR-008).** `data/anotacoes.example.json` documenta o formato com dados fictícios; `data/anotacoes.json` está no `.gitignore`.
- As duas camadas se unem pelo `id` (`{fonte}-{código do anúncio}`), estável entre execuções.

### Dashboard (raiz + `assets/`)
- `index.html` — layout: KPIs, barra de filtros, tabela, scatter, painel de detalhe/edição.
- `app.js` — estado dos filtros, ordenação, render da tabela e do scatter SVG.
- `anotacoes.js` — camada de persistência: localStorage sanitizado (score 0-5, boolean estrito, `atualizado_em` validado com `Date.parse` e normalizado para ISO), merge por timestamp mais recente, export/import de JSON. Degrada para memória quando o navegador nega escrita.
- `excel.js` — monta planilha com as linhas filtradas + colunas de anotação e dispara download `.xlsx`.
- `vendor/xlsx.min.js` — SheetJS vendorizado (única dependência JS).

### Conciliação entre dashboards (ADR-013)
Ligação em runtime, no navegador, entre a oferta (`imoveis.json`) e as transações (`transacoes.json`) — **nenhum dado é gravado nos JSONs**.
- `conciliacao.js` — módulo puro compartilhado: reduz um endereço a uma **chave de prédio** (`logradouro normalizado + número`). Usado pelas duas páginas; testável em Node.
- **Cada página busca os dois JSONs** (fetch não-fatal): `index.html` lê as transações (marca 🧾 prédios com transação **residencial de compra e venda** em 2025/2026 — mesmo mercado do default do painel irmão, ADR-012 — propagando pelos grupos de duplicados entre fontes); `transacoes.html` lê os imóveis (marca 🏙️ "à venda" e sugere a **área útil** = mediana dos anúncios do prédio).
- `area-util.js` — área útil informada pelo usuário na página de transações: localStorage (`vnc-imoveis:areautil`) + export/import, espelhando anotações. **Amenda o ADR-011** (a página de transações passa a ter uma camada local). Nunca commitada.

## Restrições de projeto
- Sem backend, sem build, sem CDN (ADR-003). Paths sempre relativos (funciona em Pages e em `http.server`).
- Scraper nunca toca em anotações (ADR-006) nem em áreas úteis manuais (ADR-013).
- Escopo de coleta: venda + Vila Nova Conceição (ADR-005).
- Conciliação é 100% client-side (ADR-013): os pipelines Python não sabem um do outro.

Racional completo de cada decisão: [DECISION_LOG.md](DECISION_LOG.md).
