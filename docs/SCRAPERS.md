# Notas dos scrapers (por site)

Documento vivo: **toda mudança de seletor, URL ou quirk descoberto deve ser registrada aqui** (regra do CLAUDE.md). Reconhecimento inicial e implementação: 2026-07-13.

## Resumo

| Fonte | id prefixo | Método | Anti-bot | Volume (07/2026) |
|---|---|---|---|---|
| VNC Private Homes | `vnc-` | API JSON (`api-site.vnc.com.br`) | não | 226 |
| PH15 | `ph15-` | API JSON (`api.ph15.com`) | não | 275 |
| Anglo Americana | `anglo-` | Playwright (DOM) | **403 em HTTP simples** | 11 |

---

## vnc.com.br (VNC Private Homes)

- **Stack:** Next.js App Router, client-rendered. O HTML da busca é só o shell — **não usar parse de HTML**; existe API JSON pública.
- **API:** `https://api-site.vnc.com.br/lopes/units`
  - Filtros usados: `slug=vila-nova-conceicao-sao-paulo-sp-brasil` (bairro) + `listingType=SALE` (⚠️ `venda`/`comprar` retornam HTTP 500 — o valor é `SALE`)
  - Paginação: `page` + `pageSize`; resposta traz `total`, `totalPages`, `hasMorePages`.
  - Slugs de bairro: `GET /lopes/neighborhoods` (69 bairros).
  - Outros endpoints mapeados: `/lopes/units/{id}?published=1`, `/lopes/units/reference/{ref}?published=1`, `/lopes/types/tree`.
- **Campos usados:** `reference`, `sellingPrice` ("8600000.00"), `usableArea` ("225.00"), `bedrooms`, `suites`, `parkingSpaces`, `subType.name`/`type.name`, `address.street`, `name`.
- **URL do anúncio (replicada do front, chunk `8320`):** `/imovel/REO{reference}/{tipo-slug}-{bedrooms}-dormitorios-{bairro-slug}?finalidade=venda`. Validado com HTTP 200.
- **Filtro residencial:** a API devolve também comercial (Salas etc.); filtramos por lista de tipos residenciais em `sites/vnc.py` (`TIPOS_RESIDENCIAIS`). ~20 itens comerciais excluídos.

## ph15.com (PH15)

- **Stack:** custom (jQuery + templates `{{...}}`), dados via API própria.
- **API:** `https://api.ph15.com/v1/site/listings`
  - Autenticação: `apiKey` + `chaveIndicacao` **públicas, embutidas na home** em `<script>PARAMETROS = {...}</script>` — o scraper extrai em runtime (regex) com fallback hardcoded (`sites/ph15.py`). Se o fallback quebrar, re-extrair da home.
  - Filtros usados: `filtro-tagList[]=residencial&filtro-tagList[]=vende` + `filtro-idDgCidade=3` (São Paulo) + `filtro-idDgBairro=5` (Vila Nova Conceição).
  - Mapa de bairros/cidades: `GET /v1/site/meta`.
  - Paginação: `page`; na resposta, **`total` = número de PÁGINAS** (não de registros!) e `records` = total de registros. ~45 rows/página.
  - Outros endpoints: `/v1/site/property`, `/v1/site/search`, `/v1/site/listings/special`.
- **Campos usados:** `referencia` ("79.432" → remover ponto), `tituloAnuncio`, `subSubTipo`, `valorVenda` ("R$ 8.600.000"), `area` ("259,88 m²"), `dormitorios`, `suites`, `vagas`, `logradouro` (frequentemente null), `urlAnuncio` (path pronto, ex. `/imoveis/venda/br/sp/sao-paulo/vila-nova-conceicao/apartamentos/79432-I`).
- Alguns anúncios vêm sem preço/área ("sob consulta") → descartados (~6).

## angloamericana.com.br (Anglo Americana)

- **Anti-bot:** HTTP 403 para qualquer requisição não-browser (até `/sitemap.xml`). **Playwright headless Chromium com user-agent de Chrome real passa** (confirmado 2026-07-13). Se voltarem a bloquear: tentar `headless=False`.
- **Stack:** Next.js + Vista CRM (imagens em `cdn.vistahost.com.br/angloame16738`). O payload RSC não expõe JSON das listagens — **parse do DOM**.
- **Busca:** `/busca/venda/sao-paulo/vila-nova-conceicao`. Cards server-rendered; `?pagina=`/`?page=` são ignorados; scroll não carrega mais (volume pequeno, ~11 anúncios no bairro). O scraper rola até estabilizar por segurança.
- **Card** (`a[href*="/imovel/venda/"]`, innerText): `Venda / [Novidade] / {Tipo} / {Bairro} / {N}m² / {N} quartos / {N} vagas / R$ {preço}`. ⚠️ **Card não tem suítes.**
- **Detalhe** (1 visita por anúncio, delay ~2,7s): suítes no padrão `"3 quartos (1 suites)"` — regex `\((\d+)\s*su[ií]tes?\)` com fallback `(\d+)\s*su[ií]tes?`. Página também tem `R$ N/m²`, condomínio e IPTU (não coletados hoje).
- **Código do anúncio:** último segmento do path (`/imovel/venda/sao-paulo/vila-nova-conceicao/apartamento/425933` → `anglo-425933`).
- Cards de destaque de outros bairros aparecem na página → filtrar `href` contendo `/vila-nova-conceicao/`.

---

## Convenções comuns

- `coletar() -> list[Imovel]` em cada módulo; sem efeitos colaterais fora do retorno.
- Delay de ≥1s entre requisições por host (`util.http_get`); user-agent identificável com sufixo `vnc-imoveis-dashboard`.
- Parse de preço/área em `util.py` (`parse_preco_brl`, `parse_area_m2`) — trata `R$`, `\xa0`, milhar `.` e decimal `,`.
- Anúncio sem preço ou sem área → descartar (sem R$/m² não serve à avaliação); contagem logada por fonte.
- `run.py` deduplica por `id` e ordena por `preco_m2`; falha de uma fonte não aborta as outras (`fontes_com_falha` no envelope).

## Como debugar

```bash
cd scraper
python -c "from sites import vnc; [print(i.id, i.preco_m2) for i in vnc.coletar()[:3]]"
python -c "from sites import ph15; [print(i.id, i.preco_m2) for i in ph15.coletar()[:3]]"
# Anglo com browser visível: trocar headless=True -> False em sites/angloamericana.py
```
