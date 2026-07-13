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
- **Anotações pessoais** por imóvel (endereço completo, comentário, score 1–5, visitado) — salvas no navegador (localStorage), com export/import para backup
- **Download para Excel** (.xlsx) dos imóveis filtrados, incluindo suas anotações

## Como atualizar os dados (manual)

```bash
cd scraper
pip install -r requirements.txt
playwright install chromium
python run.py            # gera/atualiza data/imoveis.json
```

Depois: commit + push. O GitHub Pages atualiza o dashboard automaticamente.

## Como rodar o dashboard localmente

```bash
python -m http.server 8000
# abrir http://localhost:8000
```

(O `fetch` do JSON não funciona abrindo o `index.html` direto do disco — use o servidor local.)

## Backup das anotações

As anotações ficam no `localStorage` do seu navegador. Para não perdê-las (troca de máquina, limpeza do navegador):

1. No dashboard, clique em **Exportar anotações** → baixa `anotacoes.json`
2. Substitua `data/anotacoes.json` no repo e faça commit
3. Em outro dispositivo, o dashboard carrega esse arquivo e mescla com o localStorage (o mais recente vence)

## Estrutura do projeto

```
index.html          dashboard (servido pelo GitHub Pages)
assets/             JS/CSS do dashboard (vanilla, sem build)
data/imoveis.json   dados raspados (gerado pelo scraper)
data/anotacoes.json backup das anotações do usuário (nunca tocado pelo scraper)
scraper/            coletor Python (um módulo por site)
docs/               arquitetura, decision log (ADRs), notas dos scrapers
```

## Para revisores e agentes (Claude, ChatGPT, etc.)

Leia o [CLAUDE.md](CLAUDE.md) antes de contribuir. Regras principais: todo trabalho em branch + PR, decisões de arquitetura registradas em [docs/DECISION_LOG.md](docs/DECISION_LOG.md), mudanças em seletores documentadas em [docs/SCRAPERS.md](docs/SCRAPERS.md).

## Evoluções futuras (registradas, não implementadas)

- Dedup de imóveis anunciados em mais de uma imobiliária (por similaridade de área/preço/endereço)
- Histórico de preço por imóvel (hoje o histórico existe via commits do git)
- Incluir aluguel como segundo escopo
