/* Dashboard de imóveis — vanilla JS, sem build.
   Carrega data/imoveis.json, aplica filtros, renderiza KPIs, scatter SVG e tabela. */
"use strict";

const FONTES = {
  angloamericana: { rotulo: "Anglo", cor: "var(--serie-anglo)" },
  vnc: { rotulo: "VNC", cor: "var(--serie-vnc)" },
  ph15: { rotulo: "PH15", cor: "var(--serie-ph15)" },
};

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtM2 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

// prioridade para escolher o imóvel "primário" de um grupo duplicado
const PRIORIDADE_FONTE = { vnc: 0, ph15: 1, angloamericana: 2 };

const estado = {
  imoveis: [],
  ordenacao: { col: "preco_m2", asc: true },
  anotacoes: {},
  editando: null, // id do imóvel com painel de edição aberto
  // conciliação com transações ITBI (ADR-013): Map(chave de prédio -> {qtde, anos})
  // só com transações de 2025/2026; e Map(id do imóvel -> chave de prédio).
  transacoesPorPredio: new Map(),
  chavePredio: new Map(),
};

// chave de duplicidade: mesma área arredondada + mesmo preço.
// Arredondamento meio-para-cima explícito (floor(x+0,5)) para bater exatamente
// com scraper/validate_data.py — Math.round e o round() do Python divergem em
// .5 (round(26.5) é 26 no Python, 27 no JS). Manter as duas regras idênticas.
function arredondarArea(area) {
  return Math.floor(area + 0.5);
}

function chaveDup(im) {
  return arredondarArea(im.area_util_m2) + "|" + im.preco;
}

function agruparPorChave(lista) {
  const grupos = new Map();
  for (const im of lista) {
    const k = chaveDup(im);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(im);
  }
  return grupos;
}

// Dentro de um bucket (mesma área+preço), quais anúncios representam unidades
// REAIS: os da fonte com mais anúncios (desempate por prioridade). Fontes
// diferentes anunciam a MESMA unidade (ecos cross-source); a mesma fonte lista
// unidades DIFERENTES. Para bucket de fonte única, são todos reais.
function unidadesReais(grupo) {
  const porFonte = new Map();
  for (const im of grupo) {
    if (!porFonte.has(im.fonte)) porFonte.set(im.fonte, []);
    porFonte.get(im.fonte).push(im);
  }
  let dominante = null;
  for (const [fonte, lst] of porFonte) {
    const atual = dominante ? porFonte.get(dominante) : null;
    if (!atual || lst.length > atual.length ||
        (lst.length === atual.length &&
         (PRIORIDADE_FONTE[fonte] ?? 9) < (PRIORIDADE_FONTE[dominante] ?? 9))) {
      dominante = fonte;
    }
  }
  return porFonte.get(dominante);
}

// Análise de duplicados ENTRE fontes para UMA lista — SEMPRE recomputada sobre o
// conjunto visível (respeita filtros), então marcação e contagem nunca divergem:
// se um filtro esconde a fonte-irmã, o que sobra deixa de ser tratado como
// duplicado. Retorna:
//   manter — Set de ids das unidades reais (KPIs/scatter contam só esses)
//   info   — id -> { fontesIrmas, ehPrimario } só para buckets com ≥2 fontes
//            (ehPrimario = unidade real; os demais são ecos esmaecidos na tabela)
function analisarDuplicados(lista) {
  const info = {};
  const manter = new Set();
  for (const grupo of agruparPorChave(lista).values()) {
    const reais = unidadesReais(grupo);
    for (const im of reais) manter.add(im.id);
    const fontes = new Set(grupo.map((i) => i.fonte));
    if (fontes.size < 2) continue; // só marca duplicados ENTRE fontes
    const idsReais = new Set(reais.map((i) => i.id));
    for (const im of grupo) {
      info[im.id] = {
        fontesIrmas: [...fontes].filter((f) => f !== im.fonte),
        ehPrimario: idsReais.has(im.id),
      };
    }
  }
  return { info, manter };
}

// ---------- boot ----------
async function boot() {
  const resp = await fetch("data/imoveis.json");
  const dados = await resp.json();
  estado.imoveis = dados.imoveis;
  try {
    // a camada de anotações nunca pode impedir a listagem de carregar
    estado.anotacoes = await Anotacoes.carregar();
  } catch (e) {
    console.warn("anotações indisponíveis, seguindo somente leitura", e);
    estado.anotacoes = {};
  }
  // conciliação: transações fechadas por prédio (2025/2026) — nunca fatal
  await carregarTransacoes();
  recomputarChavesPredio();
  const dt = new Date(dados.atualizado_em);
  document.getElementById("atualizado-em").textContent =
    "dados de " + dt.toLocaleDateString("pt-BR") + " " +
    dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  // popular select de tipos
  const tipos = [...new Set(estado.imoveis.map((i) => i.tipo))].sort();
  const selTipo = document.getElementById("f-tipo");
  for (const t of tipos) {
    const o = document.createElement("option");
    o.value = t; o.textContent = t;
    selTipo.appendChild(o);
  }

  ligarFiltros();
  ligarOrdenacao();
  ligarAcoes();
  render();
  document.dispatchEvent(new CustomEvent("dashboard:pronto"));
}

// ---------- conciliação com transações ITBI (ADR-013) ----------
async function carregarTransacoes() {
  try {
    const resp = await fetch("data/transacoes.json");
    const dados = await resp.json();
    // marca só transações recentes (2025/2026), por prédio
    const recentes = (dados.transacoes || []).filter((t) => t.ano === 2025 || t.ano === 2026);
    const idx = Conciliacao.indexarPorPredio(recentes, Conciliacao.chaveTransacao);
    estado.transacoesPorPredio = new Map();
    for (const [chave, arr] of idx) {
      estado.transacoesPorPredio.set(chave, {
        qtde: arr.length,
        anos: [...new Set(arr.map((t) => t.ano))].sort(),
      });
    }
  } catch (e) {
    console.warn("transações indisponíveis, seguindo sem marca de transação", e);
    estado.transacoesPorPredio = new Map();
  }
}

// Chave de prédio por imóvel, com PROPAGAÇÃO dentro de cada bucket de duplicados:
// só a VNC traz endereço, então o eco de Anglo/PH15 (mesma área+preço) herda a
// chave do irmão VNC e passa a exibir a marca de transação (ADR-013). Recomputado
// sobre TODOS os imóveis (não só os visíveis) para o filtro e a marca baterem.
function recomputarChavesPredio() {
  const chaveDe = new Map();
  for (const im of estado.imoveis) {
    chaveDe.set(im.id, Conciliacao.chaveImovel(im, estado.anotacoes[im.id]));
  }
  for (const grupo of agruparPorChave(estado.imoveis).values()) {
    const comChave = grupo.map((im) => chaveDe.get(im.id)).find(Boolean);
    if (!comChave) continue;
    for (const im of grupo) if (!chaveDe.get(im.id)) chaveDe.set(im.id, comChave);
  }
  estado.chavePredio = chaveDe;
}

// Info de transação recente do prédio de um imóvel, ou null.
function transDoImovel(im) {
  const chave = estado.chavePredio.get(im.id);
  return chave ? (estado.transacoesPorPredio.get(chave) || null) : null;
}

// ---------- ações do topo (excel / export / import) ----------
function ligarAcoes() {
  document.getElementById("chk-zero").addEventListener("change", render);
  document.getElementById("btn-excel").addEventListener("click", () => {
    const lista = ordenar(filtrar());
    // info de transação por imóvel para a coluna do Excel (respeita o filtro atual)
    const transInfo = {};
    for (const im of lista) {
      const t = transDoImovel(im);
      if (t) transInfo[im.id] = t;
    }
    // marca duplicados sobre a mesma lista exportada (respeita o filtro atual)
    baixarExcel(lista, Anotacoes.todas(), analisarDuplicados(lista).info, transInfo);
  });
  document.getElementById("btn-exportar").addEventListener("click", () => Anotacoes.exportar());
  document.getElementById("input-importar").addEventListener("change", async (ev) => {
    const arq = ev.target.files[0];
    if (!arq) return;
    try {
      const n = await Anotacoes.importar(arq);
      estado.anotacoes = Anotacoes.todas();
      render();
      alert(`${n} anotações importadas e mescladas.`);
    } catch (e) {
      alert("Falha ao importar: " + e.message);
    }
    ev.target.value = "";
  });
}

// ---------- filtros ----------
function valNum(id) {
  const v = document.getElementById(id).value;
  return v === "" ? null : Number(v);
}

function filtrosAtuais() {
  const fontes = [...document.querySelectorAll("#f-fontes input:checked")].map((c) => c.value);
  return {
    areaMin: valNum("f-area-min"), areaMax: valNum("f-area-max"),
    precoMin: valNum("f-preco-min") !== null ? valNum("f-preco-min") * 1000 : null,
    precoMax: valNum("f-preco-max") !== null ? valNum("f-preco-max") * 1000 : null,
    pm2Min: valNum("f-pm2-min") !== null ? valNum("f-pm2-min") * 1000 : null,
    pm2Max: valNum("f-pm2-max") !== null ? valNum("f-pm2-max") * 1000 : null,
    suitesMin: valNum("f-suites"),
    tipo: document.getElementById("f-tipo").value || null,
    scoreMin: valNum("f-score"),
    visitado: document.getElementById("f-visitado").value || null,
    soTrans: document.getElementById("f-trans").checked,
    fontes,
  };
}

function filtroExtra(im, f) {
  const a = estado.anotacoes[im.id];
  if (f.scoreMin !== null && (a?.score || 0) < f.scoreMin) return false;
  if (f.visitado === "sim" && !a?.visitado) return false;
  if (f.visitado === "nao" && a?.visitado) return false;
  return true;
}

function filtrar() {
  const f = filtrosAtuais();
  return estado.imoveis.filter((i) =>
    f.fontes.includes(i.fonte) &&
    (f.tipo === null || i.tipo === f.tipo) &&
    (f.areaMin === null || i.area_util_m2 >= f.areaMin) &&
    (f.areaMax === null || i.area_util_m2 <= f.areaMax) &&
    (f.precoMin === null || i.preco >= f.precoMin) &&
    (f.precoMax === null || i.preco <= f.precoMax) &&
    (f.pm2Min === null || i.preco_m2 >= f.pm2Min) &&
    (f.pm2Max === null || i.preco_m2 <= f.pm2Max) &&
    (f.suitesMin === null || (i.suites ?? 0) >= f.suitesMin) &&
    (!f.soTrans || transDoImovel(i) != null) &&
    filtroExtra(i, f)
  );
}

function ligarFiltros() {
  document.querySelectorAll(".filtros input, .filtros select").forEach((el) =>
    el.addEventListener("input", render)
  );
  document.getElementById("btn-limpar").addEventListener("click", () => {
    document.querySelectorAll('.filtros input[type="number"]').forEach((el) => (el.value = ""));
    document.querySelectorAll("#f-fontes input").forEach((el) => (el.checked = true));
    document.getElementById("f-suites").value = "";
    document.getElementById("f-tipo").value = "";
    document.getElementById("f-score").value = "";
    document.getElementById("f-visitado").value = "";
    document.getElementById("f-trans").checked = false;
    document.dispatchEvent(new CustomEvent("dashboard:limpar"));
    render();
  });
}

// ---------- render ----------
function render() {
  // recomputa as chaves de prédio antes de filtrar (anotações podem ter mudado
  // o endereço de fallback via editor/import), para filtro e marca baterem
  recomputarChavesPredio();
  const visiveis = filtrar();
  // uma única análise de duplicados por render, sobre o conjunto visível —
  // KPIs, scatter e tabela partem exatamente do mesmo resultado
  const dup = analisarDuplicados(visiveis);
  renderKpis(visiveis, dup);
  renderScatter(visiveis, dup);
  renderTabela(visiveis, dup);
  document.dispatchEvent(new CustomEvent("dashboard:render", { detail: { visiveis } }));
}

function mediana(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function renderKpis(vis, dup) {
  const el = document.getElementById("kpis");
  // KPIs contam cada grupo duplicado entre fontes uma vez só (não inflar)
  const unicos = vis.filter((im) => dup.manter.has(im.id));
  const nDup = vis.length - unicos.length;
  const medPm2 = mediana(unicos.map((i) => i.preco_m2));
  const medArea = mediana(unicos.map((i) => i.area_util_m2));
  const precos = unicos.map((i) => i.preco);
  const kpis = [
    { rotulo: "Imóveis", valor: fmtNum.format(unicos.length),
      compl: `de ${fmtNum.format(estado.imoveis.length)}` + (nDup ? ` · ${nDup} dup. entre fontes` : "") },
    { rotulo: "Mediana R$/m²", valor: medPm2 ? fmtBRL.format(medPm2) : "—", compl: "sem duplicados" },
    { rotulo: "Faixa de preço", valor: precos.length ? fmtBRL.format(Math.min(...precos)) : "—", compl: precos.length ? "a " + fmtBRL.format(Math.max(...precos)) : "" },
    { rotulo: "Mediana de área", valor: medArea ? fmtM2.format(medArea) + " m²" : "—", compl: "sem duplicados" },
  ];
  el.innerHTML = kpis.map((k) => `
    <div class="kpi">
      <div class="rotulo">${k.rotulo}</div>
      <div class="valor">${k.valor}</div>
      <div class="compl">${k.compl}</div>
    </div>`).join("");
}

// ---------- scatter SVG (preço × área) ----------
const SVG_NS = "http://www.w3.org/2000/svg";

// Escala "redonda" (passo 1-2-5) ajustada ao range dos dados.
// Sem iniciarNoZero, o eixo começa perto do menor valor (não desperdiça
// espaço quando, p.ex., o filtro de área ≥150 afasta tudo da origem).
function escalaNice(min, max, iniciarNoZero) {
  if (iniciarNoZero) min = 0;
  if (!(max > min)) { // degenerado (um ponto só ou range zero)
    const base = max || 1;
    min = iniciarNoZero ? 0 : base * 0.9;
    max = base * 1.1 || 1;
  }
  // domínio com 5% de folga; o início NÃO é preso ao passo (senão um passo
  // grande arrastaria o eixo de volta ao zero quando o mínimo é pequeno)
  const pad = (max - min) * 0.05;
  const domMin = iniciarNoZero ? 0 : Math.max(0, min - pad);
  const domMax = max + pad;
  // passo "redondo" (1-2-5) só para os rótulos/gridlines
  const bruto = (domMax - domMin) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const norm = bruto / mag;
  const passo = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(domMin / passo) * passo; v <= domMax + passo * 0.001; v += passo) ticks.push(v);
  return { min: domMin, max: domMax, ticks };
}

function renderScatter(vis, dup) {
  const wrap = document.getElementById("scatter");
  wrap.innerHTML = "";
  if (!vis.length) { wrap.innerHTML = '<p class="rodape">Nenhum imóvel com os filtros atuais.</p>'; return; }

  // um ponto por grupo duplicado entre fontes (consistente com os KPIs)
  const dados = vis.filter((im) => dup.manter.has(im.id));
  const iniciarNoZero = document.getElementById("chk-zero")?.checked ?? false;

  const W = 960, H = 340, M = { top: 12, right: 20, bottom: 34, left: 64 };
  const xs = dados.map((i) => i.area_util_m2), ys = dados.map((i) => i.preco);
  const ex = escalaNice(Math.min(...xs), Math.max(...xs), iniciarNoZero);
  const ey = escalaNice(Math.min(...ys), Math.max(...ys), iniciarNoZero);
  const x = (v) => M.left + ((v - ex.min) / (ex.max - ex.min)) * (W - M.left - M.right);
  const y = (v) => H - M.bottom - ((v - ey.min) / (ey.max - ey.min)) * (H - M.top - M.bottom);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Dispersão de preço por área dos imóveis filtrados");

  // gridlines horizontais + rótulos do eixo y
  for (const v of ey.ticks) {
    const linha = document.createElementNS(SVG_NS, "line");
    linha.setAttribute("class", "gridline");
    linha.setAttribute("x1", M.left); linha.setAttribute("x2", W - M.right);
    linha.setAttribute("y1", y(v)); linha.setAttribute("y2", y(v));
    svg.appendChild(linha);
    const txt = document.createElementNS(SVG_NS, "text");
    txt.setAttribute("x", M.left - 8); txt.setAttribute("y", y(v) + 4);
    txt.setAttribute("text-anchor", "end");
    txt.textContent = v >= 1e6 ? fmtNum.format(v / 1e6) + " mi" : fmtNum.format(v / 1e3) + " mil";
    svg.appendChild(txt);
  }
  // eixo x: rótulos de área
  for (const v of ex.ticks) {
    const txt = document.createElementNS(SVG_NS, "text");
    txt.setAttribute("x", x(v)); txt.setAttribute("y", H - M.bottom + 18);
    txt.setAttribute("text-anchor", "middle");
    txt.textContent = fmtNum.format(v);
    svg.appendChild(txt);
  }
  const rotX = document.createElementNS(SVG_NS, "text");
  rotX.setAttribute("x", W - M.right); rotX.setAttribute("y", H - 6);
  rotX.setAttribute("text-anchor", "end");
  rotX.textContent = "área útil (m²)";
  svg.appendChild(rotX);

  const eixo = document.createElementNS(SVG_NS, "line");
  eixo.setAttribute("class", "eixo");
  eixo.setAttribute("x1", M.left); eixo.setAttribute("x2", W - M.right);
  eixo.setAttribute("y1", H - M.bottom); eixo.setAttribute("y2", H - M.bottom);
  svg.appendChild(eixo);

  // pontos: ≥8px de alvo com anel de 2px da superfície (marks-and-anatomy)
  for (const im of dados) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("class", "ponto");
    c.setAttribute("cx", x(im.area_util_m2));
    c.setAttribute("cy", y(im.preco));
    c.setAttribute("r", 4.5);
    c.setAttribute("fill", FONTES[im.fonte].cor);
    c.setAttribute("stroke", "var(--surface-1)");
    c.setAttribute("stroke-width", "1.5");
    c.addEventListener("mousemove", (ev) => mostrarTooltip(ev, im));
    c.addEventListener("mouseleave", esconderTooltip);
    c.addEventListener("click", () => window.open(im.url, "_blank", "noopener"));
    svg.appendChild(c);
  }
  wrap.appendChild(svg);
}

// Selo (link) para o prédio que teve transação recente de ITBI. Aponta para o
// dashboard de transações já filtrado pelo logradouro do prédio.
function seloTransacao(im) {
  const info = transDoImovel(im);
  if (!info) return "";
  const chave = estado.chavePredio.get(im.id);
  const [core, num] = chave.split("#");
  const href = `transacoes.html?rua=${encodeURIComponent(core)}&num=${encodeURIComponent(num)}`;
  const titulo = `Prédio com ${info.qtde} transação(ões) de ITBI em ${info.anos.join("/")} — clique para ver as transações`;
  return ` <a class="selo-trans" href="${href}" title="${escapeHtml(titulo)}">🧾 transação ${info.anos.join("/")}</a>`;
}

// ---------- tooltip ----------
const tooltip = () => document.getElementById("tooltip");

function mostrarTooltip(ev, im) {
  const t = tooltip();
  const info = transDoImovel(im);
  t.innerHTML = `
    <div class="t-titulo">${escapeHtml(im.titulo)}</div>
    <div class="t-linha">${FONTES[im.fonte].rotulo} · ${escapeHtml(im.tipo)}</div>
    <div class="t-linha">${fmtM2.format(im.area_util_m2)} m² · ${fmtBRL.format(im.preco)} · ${fmtBRL.format(im.preco_m2)}/m²</div>
    <div class="t-linha">${im.dormitorios ?? "?"} dorm · ${im.suites ?? "?"} suítes · ${im.vagas ?? "?"} vagas</div>
    <div class="t-linha">cond. ${im.condominio != null ? fmtBRL.format(im.condominio) : "—"} · IPTU ${im.iptu != null ? fmtBRL.format(im.iptu) : "—"}</div>
    ${info ? `<div class="t-linha">🧾 prédio c/ ${info.qtde} transação(ões) ITBI em ${info.anos.join("/")}</div>` : ""}`;
  t.hidden = false;
  const margem = 14;
  let px = ev.clientX + margem, py = ev.clientY + margem;
  const r = t.getBoundingClientRect();
  if (px + r.width > innerWidth - 8) px = ev.clientX - r.width - margem;
  if (py + r.height > innerHeight - 8) py = ev.clientY - r.height - margem;
  t.style.left = px + "px"; t.style.top = py + "px";
}
function esconderTooltip() { tooltip().hidden = true; }

// ---------- tabela ----------
function ligarOrdenacao() {
  document.querySelectorAll("thead th[data-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (col === "_link") return;
      if (estado.ordenacao.col === col) estado.ordenacao.asc = !estado.ordenacao.asc;
      else estado.ordenacao = { col, asc: true };
      render();
    });
  });
}

function ordenar(vis) {
  const { col, asc } = estado.ordenacao;
  const dir = asc ? 1 : -1;
  const valor = (im) => col === "_score" ? (estado.anotacoes[im.id]?.score || 0) : im[col];
  return [...vis].sort((a, b) => {
    const va = valor(a), vb = valor(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "pt-BR") * dir;
  });
}

function renderTabela(vis, analise) {
  const corpo = document.querySelector("#tabela tbody");
  const ordenados = ordenar(vis);

  document.querySelectorAll("thead th[data-col]").forEach((th) => {
    const base = th.textContent.replace(/ [▲▼]$/, "");
    th.innerHTML = escapeHtml(base) +
      (th.dataset.col === estado.ordenacao.col
        ? ` <span class="seta">${estado.ordenacao.asc ? "▲" : "▼"}</span>` : "");
  });

  corpo.innerHTML = ordenados.map((im) => {
    const a = estado.anotacoes[im.id];
    const dup = analise.info[im.id];
    const classes = [a?.visitado ? "visitado" : "", dup && !dup.ehPrimario ? "dup" : ""].filter(Boolean).join(" ");
    const selo = dup
      ? `<span class="selo-dup" title="Mesma área e preço em outra fonte — contado uma vez nos KPIs">↔ também em ${dup.fontesIrmas.map((f) => FONTES[f].rotulo).join(", ")}</span>`
      : "";
    const seloTrans = seloTransacao(im);
    const linha = `
    <tr data-id="${escapeHtml(im.id)}"${classes ? ` class="${classes}"` : ""}>
      <td><span class="fonte-tag"><span class="dot" style="background:${FONTES[im.fonte].cor}"></span>${FONTES[im.fonte].rotulo}</span></td>
      <td>${escapeHtml(im.tipo)}</td>
      <td class="col-titulo"><a class="titulo-link" href="${escapeHtml(im.url)}" target="_blank" rel="noopener">${escapeHtml(im.titulo)}</a>${selo}${seloTrans}${im.endereco ? `<br><span class="rodape">${escapeHtml(im.endereco)}</span>` : ""}${a?.endereco_completo ? `<br><span class="rodape">📍 ${escapeHtml(a.endereco_completo)}</span>` : ""}${a?.comentario ? `<br><span class="rodape comentario">💬 ${escapeHtml(a.comentario)}</span>` : ""}</td>
      <td class="num">${fmtM2.format(im.area_util_m2)}</td>
      <td class="num">${fmtBRL.format(im.preco)}</td>
      <td class="num">${fmtBRL.format(im.preco_m2)}</td>
      <td class="num">${im.dormitorios ?? "—"}</td>
      <td class="num">${im.suites ?? "—"}</td>
      <td class="num">${im.vagas ?? "—"}</td>
      <td class="num">${im.condominio != null ? fmtBRL.format(im.condominio) : "—"}</td>
      <td class="num">${im.iptu != null ? fmtBRL.format(im.iptu) : "—"}</td>
      <td class="col-score"><button type="button" class="score-btn" data-editar="${escapeHtml(im.id)}" title="Anotar este imóvel">${estrelas(a?.score || 0)}${a?.visitado ? ' <span class="check">✓</span>' : ""}</button></td>
      <td><a class="abrir" href="${escapeHtml(im.url)}" target="_blank" rel="noopener">abrir ↗</a></td>
    </tr>`;
    return estado.editando === im.id ? linha + linhaEditor(im) : linha;
  }).join("");

  corpo.querySelectorAll("[data-editar]").forEach((btn) =>
    btn.addEventListener("click", () => {
      estado.editando = estado.editando === btn.dataset.editar ? null : btn.dataset.editar;
      render();
    })
  );
  ligarEditor(corpo);

  document.getElementById("rodape").textContent =
    `${vis.length} imóveis exibidos · ordenado por ${estado.ordenacao.col.replace("_", " ")} ` +
    `(${estado.ordenacao.asc ? "crescente" : "decrescente"})`;
}

// ---------- editor de anotações ----------
function estrelas(n) {
  // score pode vir de JSON importado — nunca confiar: força número inteiro 0-5
  n = Math.max(0, Math.min(5, Math.trunc(Number(n) || 0)));
  let s = "";
  for (let i = 1; i <= 5; i++) s += i <= n ? "★" : "☆";
  return `<span class="estrelas" aria-label="score ${n} de 5">${s}</span>`;
}

function linhaEditor(im) {
  const a = Anotacoes.obter(im.id);
  const estrelasEdit = [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="estrela-btn${n <= (a.score || 0) ? " ativa" : ""}" data-score="${n}" aria-label="score ${n}">★</button>`
  ).join("");
  return `
    <tr class="linha-editor" data-editor-de="${escapeHtml(im.id)}">
      <td colspan="13">
        <div class="editor">
          <div class="editor-campo">
            <label>Endereço completo</label>
            <input type="text" id="ed-endereco" value="${escapeHtml(a.endereco_completo || "")}" placeholder="Rua, número, apto...">
          </div>
          <div class="editor-campo editor-comentario">
            <label>Comentário</label>
            <textarea id="ed-comentario" rows="2" placeholder="Impressões da visita, condomínio, sol, reforma...">${escapeHtml(a.comentario || "")}</textarea>
          </div>
          <div class="editor-campo">
            <label>Score</label>
            <div class="estrelas-edit">${estrelasEdit}<button type="button" class="estrela-limpar" data-score="0" title="limpar score">×</button></div>
          </div>
          <div class="editor-campo">
            <label>Visitado</label>
            <label class="visitado-chk"><input type="checkbox" id="ed-visitado"${a.visitado ? " checked" : ""}> já visitei</label>
          </div>
          <div class="editor-campo editor-status">
            <span class="rodape" id="ed-status">salvo automaticamente no navegador</span>
            <button type="button" class="acao" id="ed-fechar">fechar</button>
          </div>
        </div>
      </td>
    </tr>`;
}

function ligarEditor(corpo) {
  const linha = corpo.querySelector(".linha-editor");
  if (!linha) return;
  const id = linha.dataset.editorDe;
  const salvar = (campos) => {
    Anotacoes.salvar(id, campos);
    estado.anotacoes = Anotacoes.todas();
    linha.querySelector("#ed-status").textContent = Anotacoes.persistiu()
      ? "salvo às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "⚠ navegador sem armazenamento — anotações valem só nesta aba; use Exportar";
  };
  linha.querySelector("#ed-endereco").addEventListener("input", (e) => salvar({ endereco_completo: e.target.value }));
  linha.querySelector("#ed-comentario").addEventListener("input", (e) => salvar({ comentario: e.target.value }));
  linha.querySelector("#ed-visitado").addEventListener("change", (e) => { salvar({ visitado: e.target.checked }); render(); });
  linha.querySelectorAll("[data-score]").forEach((b) =>
    b.addEventListener("click", () => {
      salvar({ score: Number(b.dataset.score) });
      render(); // re-render para refletir estrelas na linha e no editor
      // reabre foco visual no editor
    })
  );
  linha.querySelector("#ed-fechar").addEventListener("click", () => {
    estado.editando = null;
    render();
  });
}

// ---------- util ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

boot();
