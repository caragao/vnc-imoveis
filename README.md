# vnc-imoveis — Dashboard de Imóveis em Vila Nova Conceição (SP)

Dashboard estático que consolida apartamentos **à venda** em Vila Nova Conceição (São Paulo) a partir de 3 imobiliárias, para apoiar a avaliação e comparação de imóveis durante visitas.

**Dashboard:** https://caragao.github.io/vnc-imoveis/ *(GitHub Pages)*

## Fontes de dados

| Fonte | Site | Método |
|---|---|---|
| Anglo Americana | https://angloamericana.com.br/ | Playwright (site tem anti-bot) |
| VNC Private Homes | https://www.vnc.com.br/ | HTTP + parse (Next.js) |
| PH15 | https://ph15.com/ | HTTP + parse |

## O que o dashboard oferece

- **KPIs**: nº de imóveis, mediana de R$/m², faixa de preço
- **Filtros**: metragem, preço, R$/m², nº mínimo de suítes, score, fonte
- **Tabela ordenável** com link direto para o anúncio original em cada linha
- **Gráfico de dispersão** preço × m²
- **Anotações pessoais** por imóvel (endereço completo, comentário, score 1–5, visitado) — salvas **somente no seu navegador** (localStorage), com export/import manual para backup
- **Download para Excel** (.xlsx) dos imóveis filtrados, incluindo suas anotações

> ⚠️ **Privacidade (ADR-008):** este repositório e o GitHub Pages são **públicos**. Anotações pessoais **nunca são commitadas nem publicadas** — ficam só no seu navegador e nos backups que você exportar e guardar localmente.

## Como atualizar os dados (manual)

```bash
cd scraper
pip install -r requirements.txt
playwright install chromium
python run.py            # gera/atualiza data/imoveis.json
```

Depois: commit + push. O GitHub Pages atualiza o dashboard automaticamente.

Antes de commitar dados novos, rode o relatório de qualidade (o CI roda o mesmo script):

```bash
python scraper/validate_data.py
# valida schema/integridade (bloqueia) e reporta outliers e possíveis duplicados (não bloqueia)
```

## Como rodar o dashboard localmente

```bash
python -m http.server 8000
# abrir http://localhost:8000
```

(O `fetch` do JSON não funciona abrindo o `index.html` direto do disco — use o servidor local.)

## Backup das anotações

As anotações ficam no `localStorage` do seu navegador. Para não perdê-las (troca de máquina, limpeza do navegador):

1. No dashboard, clique em **Exportar anotações** → baixa `anotacoes.json`
2. **Guarde esse arquivo localmente** (nunca no repo — ele é público; ver ADR-008). O `.gitignore` bloqueia `data/anotacoes.json` por segurança
3. Em outro dispositivo/navegador, use **Importar anotações** — o merge mantém a versão mais recente de cada imóvel

Formato do arquivo: ver [data/anotacoes.example.json](data/anotacoes.example.json) (dados fictícios).

## Estrutura do projeto

```
index.html                   dashboard (servido pelo GitHub Pages)
assets/                      JS/CSS do dashboard (vanilla, sem build)
data/imoveis.json            dados raspados (gerado pelo scraper)
data/anotacoes.example.json  formato do backup de anotações (fictício; o real nunca é commitado)
transacoes.html              dashboard de transações ITBI (mesmos assets)
data/transacoes.json         transações de VNC (gerado por itbi/build.py)
scraper/                     coletor Python (um módulo por site) + validate_data.py + testes
itbi/                        pipeline das planilhas de ITBI (build/validate/models + testes)
tests/js/                    testes da camada de anotações (Node puro)
docs/                        arquitetura, decision log (ADRs), notas dos scrapers e do ITBI
```

## Para revisores e agentes (Claude, ChatGPT, etc.)

Leia o [CLAUDE.md](CLAUDE.md) antes de contribuir. Regras principais: todo trabalho em branch + PR, decisões de arquitetura registradas em [docs/DECISION_LOG.md](docs/DECISION_LOG.md), mudanças em seletores documentadas em [docs/SCRAPERS.md](docs/SCRAPERS.md).

## Segundo dashboard: transações fechadas (ITBI)

Além da **oferta** (imóveis à venda), o projeto tem um dashboard das **transações que
efetivamente ocorreram** em VNC, a partir dos dados públicos de **ITBI-IV da Prefeitura de SP**
(`transacoes.html`, linkado no topo do dashboard principal). Mostra valor realizado × área
construída (cor por ano), com filtros de natureza, tipo de ativo, área, valor, R$/m² e ano de
construção, e uma seção "Metodologia e limitações". Os KPIs de preço usam só transferências
**integrais** (100%) de **unidades residenciais** — ver [docs/ITBI.md](docs/ITBI.md).

Pipeline independente em `itbi/` (as planilhas brutas da Prefeitura **não** são commitadas —
ver ADR-011; só o `data/transacoes.json` derivado entra no repo):

```bash
# baixar os .xlsx do portal ITBI-IV e colocar em itbi/raw/
cd itbi && pip install -r requirements.txt
python build.py            # gera ../data/transacoes.json (só Vila Nova Conceição)
python validate_data.py    # relatório de qualidade + validação de schema
```

Detalhes de colunas, filtro de bairro e quirks: [docs/ITBI.md](docs/ITBI.md).

## Evoluções futuras (registradas, não implementadas)

- Dedup de imóveis anunciados em mais de uma imobiliária (por similaridade de área/preço/endereço)
- Histórico de preço por imóvel (hoje o histórico existe via commits do git)
- Incluir aluguel como segundo escopo
