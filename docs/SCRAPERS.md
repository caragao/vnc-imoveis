# Notas dos scrapers (por site)

Documento vivo: **toda mudança de seletor, URL ou quirk descoberto deve ser registrada aqui** (regra do CLAUDE.md). Reconhecimento inicial feito em 2026-07-13.

## Resumo

| Fonte | id prefixo | Método | Anti-bot | Status |
|---|---|---|---|---|
| VNC Private Homes | `vnc-` | HTTP + parse | não detectado | a implementar |
| PH15 | `ph15-` | HTTP + parse | não detectado | a implementar |
| Anglo Americana | `anglo-` | Playwright | **403 em HTTP simples** | a implementar |

---

## vnc.com.br (VNC Private Homes)

- **Stack:** Next.js custom (URLs `/_next/image` no HTML) → provável `__NEXT_DATA__` com JSON embutido nas páginas.
- **Busca:** `/comprar/imovel` (venda), parâmetros como `?tipo=Apartamento`. Verificar parâmetro/rota de bairro para Vila Nova Conceição.
- **Anúncio:** `/imovel/{CODIGO}/{slug}` — ex.: `/imovel/REO1180184/apartamento-3-dormitorios-moema`. Código `REO...` é o id estável → `vnc-REO1180184`.
- **Campos visíveis:** preço (`R$ 11.900.000,00`), `Área útil: 288.00m²`, `3 Dorms`, `3 Suítes`, `5 Vagas`, bairro, tipo.
- **Estratégia:** `requests` na busca paginada filtrada por bairro; extrair do `__NEXT_DATA__` se existir, senão parse HTML. Fallback Playwright.
- *(preencher na implementação: seletores/paths JSON reais, paginação)*

## ph15.com (PH15)

- **Stack:** custom.
- **Busca:** `/busca`; página de bairro dedicada: `/bairro/vila-nova-conceicao` ← ponto de entrada ideal.
- **Filtros do site:** preço, m², dorms (1–4+), suítes (1–4+), vagas (1–4+), tipo — todos os campos que precisamos existem nos cards.
- **Estratégia:** `requests` + BeautifulSoup na página do bairro (+ paginação). Fallback Playwright.
- *(preencher na implementação: seletores reais, formato do código do anúncio, paginação)*

## angloamericana.com.br (Anglo Americana)

- **Anti-bot:** retorna **HTTP 403 para qualquer requisição não-browser** — inclusive `/sitemap.xml`. Confirmado em 2026-07-13 (WebFetch/HTTP puro).
- **Estratégia:** Playwright Chromium com user-agent real; navegar até a busca de venda filtrada por Vila Nova Conceição; extrair cards renderizados. Se headless for bloqueado, tentar `headless=False`; se ainda assim bloquear, registrar limitação em ADR e seguir com 2 fontes.
- *(preencher na implementação: URL de busca, seletores, formato do código do anúncio)*

---

## Convenções comuns

- `coletar() -> list[Imovel]` em cada módulo; sem efeitos colaterais fora do retorno.
- Delay de ≥1s entre requisições por site; user-agent identificável.
- Parse de preço: remover `R$`, `.` de milhar, converter `,` decimal; guardar `int` em reais.
- Área: `float` m² (área útil; se o site só der área total, registrar aqui e usar com nota no campo `titulo` ou futuro campo dedicado).
- Anúncio sem preço ou sem área → descartar (sem R$/m² não serve à avaliação) e logar quantos foram descartados.

## Como debugar

```bash
cd scraper
python -c "from sites import vnc; [print(i) for i in vnc.coletar()[:3]]"
# Playwright com browser visível:
# em angloamericana.py, trocar headless=True por False temporariamente
```
