# Pipeline de transações ITBI (dados da Prefeitura de SP)

Segunda camada de dados do projeto, **independente** da de imóveis à venda: mostra as
transações que **efetivamente ocorreram** (preço realizado) em Vila Nova Conceição, a
partir dos dados públicos de **ITBI-IV** da Prefeitura de São Paulo. Ver ADR-011.

```
itbi/raw/*.xlsx  ──build.py──▶  data/transacoes.json  ──fetch──▶  transacoes.html + assets/itbi.js
(brutos, fora do git)          (derivado, commitado)              (vanilla JS, GitHub Pages)
```

## Fonte e como atualizar

- Portal: **Prefeitura de SP → ITBI-IV → "Dados das Transações Imobiliárias com recolhimento de ITBI"**. Cada `.xlsx` reúne as 12 abas mensais de um ano; o ano corrente é atualizado mensalmente (mês anterior).
- **Os `.xlsx` NUNCA são commitados** (~65 MB e crescem todo mês; `itbi/raw/` e `*.xlsx` no `.gitignore`). Só `data/transacoes.json` (derivado, ~400 linhas) entra no repo.

```bash
# baixar os .xlsx do portal e colocar em itbi/raw/
cd itbi && pip install -r requirements.txt
python build.py                 # gera ../data/transacoes.json (só VNC)
python validate_data.py         # relatório de qualidade + validação de schema
python -m unittest discover tests
```

`build.py [dir_raw] [saida_json]` aceita caminhos alternativos; defaults `itbi/raw/` e `data/transacoes.json`.

## O que é uma linha

Cada linha da planilha = uma **DTI (Declaração de Transações Imobiliárias) paga** no mês de
referência da aba. A **data de transação** (celebração do instrumento/escritura) é
independente do mês de pagamento — por isso o **ano da análise vem de `Data de Transação`**,
não da aba. Um arquivo de "pagas em 2026" contém transações datadas de 2025 ou antes.

## As 28 colunas (mapeamento em `build.py::COL`)

| Planilha | Interno | Uso |
|---|---|---|
| Nº do Cadastro (SQL) | `sql` | id + dedup |
| Nome do Logradouro / Número / Complemento | `logradouro`/`numero`/`complemento` → `endereco` | endereço composto |
| Bairro | `bairro` | **filtro VNC** (inconfiável — ver abaixo) |
| Referência | `referencia` | nome do prédio/condomínio |
| CEP | `cep` | **filtro VNC** (âncora confiável) |
| Natureza de Transação | `natureza` | filtro (default "Compra e venda") |
| Valor de Transação (declarado) | `valor` | valor declarado (parcial) |
| Data de Transação | `data`→`ano`/`mes` | eixo temporal |
| Valor Venal de Referência | `valor_venal_referencia` | `razao_valor_venal` |
| Proporção Transmitida (%) | `proporcao` | **ajuste p/ 100%** |
| Base de Cálculo adotada | `base_calculo` | referência |
| Área do Terreno (m2) / Área Construída (m2) | `area_terreno_m2` / `area_construida_m2` | R$/m² usa a construída |
| Uso (IPTU) / Descrição do uso | `uso` / `descricao_uso` | filtro + flag `residencial` |
| Padrão (IPTU) / Descrição do padrão | `padrao` / `descricao_padrao` | filtro |
| ACC (IPTU) | `acc` | **ano de construção** ("ano do imóvel") |
| Matrícula do Imóvel | (só no id) | dedup |

Campos derivados (única fonte de verdade em `models.novo`): `valor_100pct = valor ÷ (proporção/100)`,
`valor_m2 = valor_100pct ÷ área construída` (None se área ausente), `razao_valor_venal = valor ÷ VVR`,
`residencial = uso ∈ {10,20,21,25}`.

## Armadilha nº 1 — o campo `Bairro` mistura bairros homônimos

Vários rótulos contêm "Conceição" mas são **outros bairros**:

O campo `Bairro` é preenchido pelo contribuinte e falha **nos dois sentidos**:

- **Inclui demais:** rotula como "Nova Conceição" endereços de Itaim Bibi/Vila Olímpia (`04522`+:
  Av. JK, Dr. Eduardo de Souza Aranha, Fadlo Haidar, João Cachoeira…) e de Vila **Nossa Senhora**
  da Conceição (`0518x`) e Sítio Conceição (`0847x`).
- **Exclui demais:** ~1600 transações em ruas nitidamente de VNC (Afonso Braz, Jacques Felix,
  Diogo Jácome…) vêm com o bairro rotulado de outra forma (em branco, "Moema", etc.).

Por isso **não se usa o rótulo para incluir** — o critério é **CEP + logradouro** (ADR-012):

1. **Faixa de CEP:** `04500-000`–`04515-999` (a faixa larga `045xxxxx` pega Itaim/VO em `04522+`).
   Mas o CEP sozinho não basta: `04514`/`04515` são **compartilhados** com Moema (ruas de nome de
   ave: Sabiá, Pintassilgo, Tuim, Jacutinga…) — Av. Lavandisca (VNC) e Av. Sabiá (Moema) são ambas
   `04515`. Só o logradouro separa.
2. **Allowlist de logradouros (`build.py`, 2 passagens):** semeia-se o conjunto de ruas que
   aparecem com rótulo "Nova Conceição" **e** CEP na faixa (alta confiança, ~31 ruas). Inclui-se
   então **todo** registro na faixa cujo logradouro está no allowlist — independentemente do
   rótulo. Isso recupera as ~900 transações de VNC que o rótulo escondia.
3. **Blocklist (`util._RUAS_NAO_VNC`):** ruas confirmadas de bairro vizinho (Itaim/VO, ruas de ave
   de Moema) e a **Av. Santo Amaro** — arterial de divisa que mistura VNC/Indianópolis/Vila Olímpia
   no mesmo CEP (04505) e não se resolve por CEP+rua — nunca entram.
4. **Rótulo de outro bairro (`util.bairro_outro`):** mesmo numa rua do allowlist, um registro cujo
   Bairro nomeia explicitamente outro bairro (Indianópolis, Itaim, Moema…) **não** é recuperado
   (só não vale contra um rótulo "Conceição").
5. **Ambíguos:** CEP na faixa mas logradouro **não** confirmado (ex.: Correia de Oliveira,
   Natividade) → **não** são incluídos; ficam listados na auditoria do `build.py` para revisão
   manual. Nunca se aceita ambíguo por default.

**Classificação de uso (`models.TIPO_POR_USO`):** mapeia todos os códigos da aba "Tabela de USOS"
(0–85), inclusive hotel (80), flat comercial (85), garagem comercial (23). Código novo cai em
"Outro" e é sinalizado. Unidade residencial de mercado (KPIs) = uso 20/25/10.

O `validate_data.py` confere que nenhum CEP fora de `04500`–`04515` passou, e o `build.py` imprime
a auditoria completa (allowlist, aceitas, excluídas por CEP/rua, ambíguas, delta vs JSON anterior).

## Armadilha nº 2 — transferências parciais distorcem R$/m²

~37% das transações têm **proporção < 100%** (mínimo visto: 0,01%): vende-se uma fração do
imóvel. O valor declarado é o da fração, mas a área é a do imóvel inteiro → R$/m² apareceria
artificialmente baixo. Por isso a **métrica principal usa `valor_100pct`** (valor extrapolado
para 100%). A tabela mostra a coluna "Prop." e marca as parciais; há filtro "só proporção 100%".

**O gráfico (valor × área), porém, plota só transações de 100%.** A extrapolação de proporções
ínfimas explode: `valor_100pct` chega a dezenas de bilhões (p90 já é R$ 344 mi), o que esmagaria
a escala. As de 100% dão o preço real da unidade inteira sem extrapolar; as parciais seguem na
tabela (com o valor ajustado) e o gráfico anota quantas ficaram de fora. Uma rede de segurança
extra corta pelo p98 os raros cadastros **prediais** (uso 21: área = prédio inteiro, ~21.000 m²).

## Armadilha nº 3 — sem área construída não há R$/m²

~18% das linhas têm **área construída = 0** (terrenos ou cadastro incompleto). Essas ficam com
`area_construida_m2 = null` e `valor_m2 = null`: aparecem na tabela, mas **fora do gráfico e da
mediana de R$/m²**.

## Conciliação com a oferta e área útil (ADR-013)

O ITBI traz **área construída** (IPTU, inclui garagem/áreas comuns), não a **área útil** (privativa) usada no dashboard de imóveis. Para aproximar as duas, `assets/conciliacao.js` liga transação e anúncio **pelo prédio** (`logradouro normalizado + número`), 100% no navegador — nada é gravado em `transacoes.json`.

- **Selo 🏙️ "à venda":** transações cujo prédio tem anúncio ativo na oferta (`data/imoveis.json`, buscado pela própria página). Filtro "só prédios c/ imóvel à venda".
- **Área útil (aproximada):** os anúncios **não têm número de apartamento**, então não dá para casar a transação com a unidade exata — só com o prédio. A coluna "Área útil" é preenchida com a **mediana da área útil dos anúncios do prédio** (só para transações residenciais), marcada como *ref.*; o **R$/m² útil** (marcado com `~`) = `valor equivalente a 100% ÷ área útil`.
- **Override manual:** o usuário pode digitar a área útil real por transação (útil onde não há anúncio conciliado ou para corrigir a referência). Fica em **localStorage** (`assets/area-util.js`, chave `vnc-imoveis:areautil`) + export/import — **nunca** no repo. Isso amenda a decisão do ADR-011 de "sem camada de anotações" nesta página.

Continua valendo: **não** há comparação direta de **preço** oferta×realizado (exigiria controlar por área/tipo/idade/padrão/período/vagas). A conciliação acima é só de localização e área.

## Escopo e resiliência

- Só **Vila Nova Conceição** (ADR-005 estende-se aqui). O default do dashboard mostra o grupo
  **residencial** (uso 10/20/21/25) — arrematação/dação/integralização e garagem/loja/terreno
  corrompem o sinal de preço de mercado; tudo continua filtrável.
- Linha inválida (sem valor, sem data, schema) é **logada e pulada**, não derruba a execução.
- Dedup por `id` estável = hash de `sql|matrícula|data|valor` (mesma transação repetida entre
  abas/arquivos conta uma vez).
