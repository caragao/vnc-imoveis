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
- **Campos usados:** `reference`, `sellingPrice` ("8600000.00"), `usableArea` ("225.00"), `bedrooms`, `suites`, `parkingSpaces`, `subType.name`/`type.name`, `address.street`, `iptu`/`monthlyPropertyTax`.
- **Custos:** `iptu` e `monthlyPropertyTax` vêm iguais e no formato `"2000.00"` (como `sellingPrice`) — parse com `int(float(...))`, **não** com `parse_preco_brl` (que exige `R$`). **VNC não expõe condomínio** (`condominio=None`). IPTU preenchido em ~92% dos anúncios; alguns valores são muito baixos (ex.: `"50.00"`) — é o que a fonte informa, não erro de parse.
- **Título:** o campo `name` da API vem sempre como `"Imóvel {reference}"` (inútil). Compomos o título em `titulo_vnc(tipo, area, endereco)`: `"Apartamento · 71 m² · Rua Afonso Braz"` (rua sem o número). Ignoramos `name`.
- **URL do anúncio (replicada do front, chunk `8320`):** `/imovel/REO{reference}/{tipo-slug}-{bedrooms}-dormitorios-{bairro-slug}?finalidade=venda`. Validado com HTTP 200.
- **Filtro residencial:** a API devolve também comercial (Salas etc.); filtramos por lista de tipos residenciais em `sites/vnc.py` (`TIPOS_RESIDENCIAIS`). ~20 itens comerciais excluídos.

## ph15.com (PH15)

- **Stack:** custom (jQuery + templates `{{...}}`), dados via API própria.
- **API:** `https://api.ph15.com/v1/site/listings`
  - Autenticação: `apiKey` + `chaveIndicacao` **públicas, embutidas na home** em `<script>PARAMETROS = {...}</script>` — o scraper extrai em runtime (regex), **sem fallback hardcoded**: se a extração falhar, a fonte levanta erro e `run.py` a registra em `fontes_com_falha` (decisão de review: credencial antiga mascarando falha é pior que falha visível). Para consertar, inspecionar a home e ajustar o regex em `_credenciais()`.
  - Filtros usados: `filtro-tagList[]=residencial&filtro-tagList[]=vende` + `filtro-idDgCidade=3` (São Paulo) + `filtro-idDgBairro=5` (Vila Nova Conceição).
  - Mapa de bairros/cidades: `GET /v1/site/meta`.
  - Paginação: `page`; na resposta, **`total` = número de PÁGINAS** (não de registros!) e `records` = total de registros. ~45 rows/página.
  - Outros endpoints: `/v1/site/property`, `/v1/site/search`, `/v1/site/listings/special`.
- **Campos usados:** `referencia` ("79.432" → remover ponto), `tituloAnuncio`, `subSubTipo`, `valorVenda` ("R$ 8.600.000"), `area` ("259,88 m²"), `dormitorios`, `suites`, `vagas`, `valorCondominio` ("R$ 7.598"), `valorIptu` ("R$ 1.612"), `logradouro` (frequentemente null), `urlAnuncio` (path pronto, ex. `/imoveis/venda/br/sp/sao-paulo/vila-nova-conceicao/apartamentos/79432-I`).
- **Custos:** `valorCondominio`/`valorIptu` no formato `"R$ N"` → `parse_preco_brl`. Condomínio ~91% preenchido, IPTU ~95%.
- Alguns anúncios vêm sem preço/área ("sob consulta") → descartados (~6).

## angloamericana.com.br (Anglo Americana)

- **Anti-bot:** HTTP 403 para qualquer requisição não-browser (até `/sitemap.xml`). **Playwright headless Chromium com user-agent de Chrome real passa** (confirmado 2026-07-13). Se voltarem a bloquear: tentar `headless=False`.
- **Stack:** Next.js + Vista CRM (imagens em `cdn.vistahost.com.br/angloame16738`). O payload RSC não expõe JSON das listagens — **parse do DOM**.
- **Busca:** `/busca/venda/sao-paulo/vila-nova-conceicao`. Cards server-rendered; `?pagina=`/`?page=` são ignorados; scroll não carrega mais (volume pequeno, ~11 anúncios no bairro). O scraper rola até estabilizar por segurança.
- **Card** (`a[href*="/imovel/venda/"]`, innerText): `Venda / [Novidade] / {Tipo} / {Bairro} / {N}m² / {N} quartos / {N} vagas / R$ {preço}`. ⚠️ **Card não tem suítes.**
- **Detalhe** (1 visita por anúncio, delay ~2,7s): suítes no padrão `"3 quartos (1 suites)"` — regex `\((\d+)\s*su[ií]tes?\)` com fallback `(\d+)\s*su[ií]tes?`. **Condomínio e IPTU** (best-effort): regex `Condom[ií]nio...R$ N` e `IPTU...R$ N` → `parse_preco_brl`; ausência mantém `None`.
- **Código do anúncio:** último segmento do path (`/imovel/venda/sao-paulo/vila-nova-conceicao/apartamento/425933` → `anglo-425933`).
- Cards de destaque de outros bairros aparecem na página → filtrar `href` contendo `/vila-nova-conceicao/`.

---

## Convenções comuns

- `coletar() -> list[Imovel]` em cada módulo; sem efeitos colaterais fora do retorno.
- Delay de ≥1s entre requisições por host (`util.http_get`); user-agent identificável com sufixo `vnc-imoveis-dashboard`.
- Parse de preço/área em `util.py` (`parse_preco_brl`, `parse_area_m2`) — trata `R$`, `\xa0`, milhar `.` e decimal `,`.
- Anúncio sem preço ou sem área → descartar (sem R$/m² não serve à avaliação); contagem logada por fonte.
- `run.py` deduplica por `id` e ordena por `preco_m2`; falha de uma fonte não aborta as outras (`fontes_com_falha` no envelope).
- Normalização em `novo_imovel` (models.py): `dormitorios=0` com `suites>0` vira `dormitorios=None` — algumas fontes não contam a suíte como dormitório, e suíte é dormitório por definição; o total real é desconhecido, não zero.
- `python scraper/validate_data.py` valida schema/integridade e imprime relatório de qualidade (roda também no CI, junto com os testes de `scraper/tests/`). Inclui cobertura de condomínio/IPTU por fonte.
- **`scraper/backfill_extras.py`** — script pontual (exceção à regra "o scraper sobrescreve o JSON por completo"): reaproveita `coletar()` de cada fonte para preencher **só** `condominio`/`iptu` por `id` e reescrever os títulos da VNC a partir dos campos já presentes. **Não altera preço, área nem `atualizado_em`.** Foi como os campos novos entraram no `imoveis.json` sem uma re-coleta completa (que mudaria preços). Coletas futuras via `run.py` já trazem os campos nativamente.

## Como debugar

```bash
cd scraper
python -c "from sites import vnc; [print(i.id, i.preco_m2) for i in vnc.coletar()[:3]]"
python -c "from sites import ph15; [print(i.id, i.preco_m2) for i in ph15.coletar()[:3]]"
# Anglo com browser visível: trocar headless=True -> False em sites/angloamericana.py
```
