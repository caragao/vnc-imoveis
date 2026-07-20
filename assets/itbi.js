/* Dashboard de transações ITBI — vanilla JS, sem build.
   Carrega data/transacoes.json, aplica filtros, renderiza KPIs, scatter SVG
   (valor × área construída, cor por ano) e tabela ordenável. Read-only:
   dado público, sem camada de anotações (ver ADR-011). */
"use strict";

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtM2 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtPct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

// paleta por ano: reaproveita os slots categóricos da style.css.
// anos além dos mapeados caem no cinza neutro.
const CORES_ANO = { 2024: "var(--serie-ph15)", 2025: "var(--serie-anglo)", 2026: "var(--serie-vnc)" };
function corAno(ano) { return CORES_ANO[ano] || "var(--muted)"; }

const estado = {
  transacoes: [],
  ordenacao: { col: "data", asc: false }, // mais recentes primeiro por padrão
  naturezaPadrao: "", // "1.Compra e venda" se existir — default de "mercado residencial"
  // conciliação com a oferta (ADR-013): Map(chave de prédio -> {qtde, areas:[área útil]})
  imoveisPorPredio: new Map(),
};

// ---------- boot ----------
async function boot() {
  const resp = await fetch("data/transacoes.json");
  const dados = await resp.json();
  estado.transacoes = dados.transacoes;

  // conciliação com a oferta (nunca fatal) + área útil informada pelo usuário
  await carregarImoveis();
  try { await AreaUtil.carregar(); } catch (e) { console.warn("área útil indisponível", e); }
  decorarTransacoes();

  const per = dados.periodo;
  document.getElementById("atualizado-em").textContent =
    `${dados.total} transações · ${fmtData(per.de)} a ${fmtData(per.ate)}`;

  // preenche a seção de metodologia (P2.3)
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt("m-fonte", dados.fonte || "—");
  setTxt("m-periodo", `${fmtData(per.de)} a ${fmtData(per.ate)}`);
  setTxt("m-atualizado", dados.atualizado_em ? fmtData(dados.atualizado_em.slice(0, 10)) : "—");

  popularSelects();
  ligarFiltros();
  ligarOrdenacao();
  ligarAcoesAreas();
  aplicarDeepLink();
  document.getElementById("chk-zero").addEventListener("change", render);
  document.getElementById("btn-excel").addEventListener("click", () =>
    baixarExcelTransacoes(ordenar(filtrar()))
  );
  render();
}

// ---------- conciliação com a oferta (ADR-013) ----------
async function carregarImoveis() {
  try {
    const resp = await fetch("data/imoveis.json");
    const dados = await resp.json();
    // anotações (mesmo localStorage do dashboard de venda) dão o endereço de
    // fallback dos anúncios sem endereço coletado (Anglo/PH15)
    let anotacoes = {};
    try { anotacoes = await Anotacoes.carregar(); } catch (e) { /* segue sem fallback */ }
    const idx = Conciliacao.indexarPorPredio(
      dados.imoveis || [],
      (im) => Conciliacao.chaveImovel(im, anotacoes[im.id])
    );
    estado.imoveisPorPredio = new Map();
    for (const [chave, arr] of idx) {
      estado.imoveisPorPredio.set(chave, {
        qtde: arr.length,
        areas: arr.map((im) => im.area_util_m2).filter((a) => a > 0),
      });
    }
  } catch (e) {
    console.warn("oferta indisponível, seguindo sem conciliação", e);
    estado.imoveisPorPredio = new Map();
  }
}

// Anexa campos derivados a cada transação (sem tocar no JSON de origem):
//   tem_venda / venda_qtde  — prédio tem anúncio ativo na oferta
//   area_util_ref           — mediana das áreas úteis dos anúncios do prédio (só residencial)
//   area_util_m2            — override manual (AreaUtil) OU a sugestão (ref.)
//   area_util_fonte         — "manual" | "ref" | null
//   valor_m2_util           — valor equivalente a 100% ÷ área útil (aproximado)
// Recalculado no boot e sempre que o usuário edita/importa uma área útil.
function decorarTransacoes() {
  for (const t of estado.transacoes) {
    const chave = Conciliacao.chaveTransacao(t);
    const venda = chave ? estado.imoveisPorPredio.get(chave) : null;
    t.tem_venda = !!venda;
    t.venda_qtde = venda ? venda.qtde : 0;
    // sugestão de área útil só faz sentido para unidades residenciais (não vaga/loja)
    const ref = (venda && t.residencial && venda.areas.length) ? mediana(venda.areas) : null;
    t.area_util_ref = ref;
    const manual = AreaUtil.valor(t.id);
    const au = manual != null ? manual : ref;
    t.area_util_m2 = au != null ? au : null;
    t.area_util_fonte = manual != null ? "manual" : (ref != null ? "ref" : null);
    t.valor_m2_util = (au && au > 0) ? Math.round(t.valor_100pct / au) : null;
  }
}

// ?rua=<core>&num=<n> vindos do dashboard de venda: pré-preenche a busca pela rua.
function aplicarDeepLink() {
  const p = new URLSearchParams(location.search);
  const rua = p.get("rua");
  if (rua) document.getElementById("f-busca").value = rua;
}

function ligarAcoesAreas() {
  document.getElementById("btn-exportar-areas").addEventListener("click", () => AreaUtil.exportar());
  document.getElementById("input-importar-areas").addEventListener("change", async (ev) => {
    const arq = ev.target.files[0];
    if (!arq) return;
    try {
      const n = await AreaUtil.importar(arq);
      decorarTransacoes();
      render();
      alert(`${n} áreas úteis importadas e mescladas.`);
    } catch (e) {
      alert("Falha ao importar: " + e.message);
    }
    ev.target.value = "";
  });
}

function popularSelects() {
  const anos = [...new Set(estado.transacoes.map((t) => t.ano))].sort((a, b) => b - a);
  addOpcoes("f-ano", anos.map((a) => [String(a), String(a)]));

  const naturezas = [...new Set(estado.transacoes.map((t) => t.natureza))].sort();
  addOpcoes("f-natureza", naturezas.map((n) => [n, n]));
  // default "mercado residencial" = Compra e venda (a natureza de mercado por excelência)
  estado.naturezaPadrao = naturezas.find((n) => n.includes("Compra e venda")) || "";
  document.getElementById("f-natureza").value = estado.naturezaPadrao;

  const padroes = [...new Set(estado.transacoes.map((t) => t.descricao_padrao).filter(Boolean))].sort();
  addOpcoes("f-padrao", padroes.map((p) => [p, p]));

  // segmentação por tipo de ativo (P2.1) — acrescenta os tipos após "residencial"/"todos"
  const tipos = [...new Set(estado.transacoes.map((t) => t.tipo_ativo).filter(Boolean))].sort();
  addOpcoes("f-uso", tipos.map((t) => [`tipo:${t}`, t]));
}

function addOpcoes(selId, pares) {
  const sel = document.getElementById(selId);
  for (const [valor, rotulo] of pares) {
    const o = document.createElement("option");
    o.value = valor; o.textContent = rotulo;
    sel.appendChild(o);
  }
}

// ---------- filtros ----------
function valNum(id) {
  const v = document.getElementById(id).value;
  return v === "" ? null : Number(v);
}

function filtrosAtuais() {
  return {
    ano: document.getElementById("f-ano").value || null,
    natureza: document.getElementById("f-natureza").value || null,
    uso: document.getElementById("f-uso").value, // "" (todos) ou "residencial"
    padrao: document.getElementById("f-padrao").value || null,
    areaMin: valNum("f-area-min"), areaMax: valNum("f-area-max"),
    valorMin: valNum("f-valor-min") !== null ? valNum("f-valor-min") * 1000 : null,
    valorMax: valNum("f-valor-max") !== null ? valNum("f-valor-max") * 1000 : null,
    pm2Min: valNum("f-pm2-min") !== null ? valNum("f-pm2-min") * 1000 : null,
    pm2Max: valNum("f-pm2-max") !== null ? valNum("f-pm2-max") * 1000 : null,
    accMin: valNum("f-acc-min"), accMax: valNum("f-acc-max"),
    busca: document.getElementById("f-busca").value.trim().toLowerCase(),
    so100: document.getElementById("f-100").checked,
    soVenda: document.getElementById("f-venda").checked,
  };
}

function casaBusca(t, termo) {
  if (!termo) return true;
  return (`${t.endereco} ${t.referencia || ""} ${t.bairro}`).toLowerCase().includes(termo);
}

// filtro de uso/tipo: "residencial" (unidades de mercado), "" (todos) ou "tipo:X"
function casaUso(t, uso) {
  if (uso === "residencial") return t.residencial;
  if (uso === "" || uso == null) return true;
  if (uso.startsWith("tipo:")) return t.tipo_ativo === uso.slice(5);
  return true;
}

function filtrar() {
  const f = filtrosAtuais();
  return estado.transacoes.filter((t) =>
    (f.ano === null || String(t.ano) === f.ano) &&
    (f.natureza === null || t.natureza === f.natureza) &&
    casaUso(t, f.uso) &&
    (f.padrao === null || t.descricao_padrao === f.padrao) &&
    (f.areaMin === null || (t.area_construida_m2 ?? -1) >= f.areaMin) &&
    (f.areaMax === null || (t.area_construida_m2 ?? Infinity) <= f.areaMax) &&
    (f.valorMin === null || t.valor >= f.valorMin) &&
    (f.valorMax === null || t.valor <= f.valorMax) &&
    (f.pm2Min === null || (t.valor_m2 ?? -1) >= f.pm2Min) &&
    (f.pm2Max === null || (t.valor_m2 ?? Infinity) <= f.pm2Max) &&
    (f.accMin === null || (t.acc ?? -1) >= f.accMin) &&
    (f.accMax === null || (t.acc ?? Infinity) <= f.accMax) &&
    (!f.so100 || t.proporcao >= 100) &&
    (!f.soVenda || t.tem_venda) &&
    casaBusca(t, f.busca)
  );
}

function ligarFiltros() {
  document.querySelectorAll(".filtros input, .filtros select").forEach((el) =>
    el.addEventListener("input", render)
  );
  document.getElementById("btn-limpar").addEventListener("click", () => {
    document.querySelectorAll('.filtros input[type="number"]').forEach((el) => (el.value = ""));
    document.getElementById("f-busca").value = "";
    document.getElementById("f-100").checked = false;
    document.getElementById("f-venda").checked = false;
    document.getElementById("f-ano").value = "";
    document.getElementById("f-natureza").value = estado.naturezaPadrao;
    document.getElementById("f-uso").value = "residencial";
    document.getElementById("f-padrao").value = "";
    render();
  });
}

// ---------- render ----------
function render() {
  const vis = filtrar();
  renderKpis(vis);
  renderScatter(vis);
  renderTabela(vis);
}

function mediana(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function renderKpis(vis) {
  const el = document.getElementById("kpis");
  // Metodologia (P1.2): os KPIs de preço só consideram transferências INTEGRAIS
  // (100% do imóvel) — parciais são frações/heranças/reorganizações, não a compra
  // da unidade no mercado. As parciais seguem na tabela e são contadas aqui.
  const integrais = vis.filter((t) => t.integral);
  const nParciais = vis.length - integrais.length;
  const comM2 = integrais.filter((t) => t.valor_m2);
  const medM2 = mediana(comM2.map((t) => t.valor_m2));
  const medArea = mediana(integrais.filter((t) => t.area_construida_m2).map((t) => t.area_construida_m2));
  const valores = integrais.map((t) => t.valor);

  // tendência: mediana de R$/m² equivalente por ano (só integrais com área)
  const anos = [...new Set(comM2.map((t) => t.ano))].sort();
  const porAno = anos.map((a) => [a, mediana(comM2.filter((t) => t.ano === a).map((t) => t.valor_m2))]);
  const trend = porAno.length
    ? porAno.map(([a, m]) => `${a}: ${m ? fmtBRL.format(m) : "—"}`).join(" · ")
    : "sem dados";

  const kpis = [
    { rotulo: "Transações", valor: fmtNum.format(vis.length),
      compl: `${integrais.length} integrais · ${nParciais} parciais` },
    { rotulo: "Mediana R$/m²", valor: medM2 ? fmtBRL.format(medM2) : "—",
      compl: `equivalente 100% · ${comM2.length} integrais c/ área` },
    { rotulo: "R$/m² por ano", valor: porAno.length ? fmtBRL.format(porAno[porAno.length - 1][1] || 0) : "—", compl: trend },
    { rotulo: "Faixa de valor", valor: valores.length ? fmtBRL.format(Math.min(...valores)) : "—",
      compl: valores.length ? "a " + fmtBRL.format(Math.max(...valores)) + " (integrais)" : "" },
    { rotulo: "Mediana de área", valor: medArea ? fmtM2.format(medArea) + " m²" : "—", compl: "integrais, área construída" },
  ];
  el.innerHTML = kpis.map((k) => `
    <div class="kpi">
      <div class="rotulo">${k.rotulo}</div>
      <div class="valor">${k.valor}</div>
      <div class="compl">${escapeHtml(k.compl)}</div>
    </div>`).join("");
}

// ---------- scatter SVG (valor × área construída) ----------
const SVG_NS = "http://www.w3.org/2000/svg";

// escala "redonda" (passo 1-2-5) ajustada ao range — idêntica ao dashboard de imóveis.
function escalaNice(min, max, iniciarNoZero) {
  if (iniciarNoZero) min = 0;
  if (!(max > min)) {
    const base = max || 1;
    min = iniciarNoZero ? 0 : base * 0.9;
    max = base * 1.1 || 1;
  }
  const pad = (max - min) * 0.05;
  const domMin = iniciarNoZero ? 0 : Math.max(0, min - pad);
  const domMax = max + pad;
  const bruto = (domMax - domMin) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const norm = bruto / mag;
  const passo = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(domMin / passo) * passo; v <= domMax + passo * 0.001; v += passo) ticks.push(v);
  return { min: domMin, max: domMax, ticks };
}

// percentil de uma lista já ordenada (interpolação linear)
function quantil(ordenada, q) {
  if (!ordenada.length) return 0;
  const pos = (ordenada.length - 1) * q;
  const base = Math.floor(pos), resto = pos - base;
  return ordenada[base + 1] !== undefined
    ? ordenada[base] + resto * (ordenada[base + 1] - ordenada[base])
    : ordenada[base];
}

function renderScatter(vis) {
  const wrap = document.getElementById("scatter");
  const legenda = document.getElementById("legenda-anos");
  wrap.innerHTML = "";
  // O gráfico mostra só transações INTEGRAIS (100% do imóvel): aí o valor declarado
  // é o da unidade inteira, sem extrapolação. Transferências parciais, quando
  // estendidas p/ 100% (valor ÷ proporção), explodem para valores absurdos com
  // proporções ínfimas (0,3% → bilhões) e esmagariam a escala — seguem na tabela.
  const comArea = vis.filter((t) => t.area_construida_m2 && t.valor_m2);
  const dados = comArea.filter((t) => t.integral);
  const parciais = comArea.length - dados.length;
  const anosVis = [...new Set(dados.map((t) => t.ano))].sort();
  legenda.innerHTML = anosVis.map((a) =>
    `<span class="leg-item"><span class="dot" style="background:${corAno(a)}"></span>${a}</span>`).join(" ");

  if (!dados.length) { wrap.innerHTML = '<p class="rodape">Nenhuma transação de 100% com área construída nos filtros atuais.</p>'; return; }

  const iniciarNoZero = document.getElementById("chk-zero")?.checked ?? false;
  const W = 960, H = 340, M = { top: 12, right: 20, bottom: 34, left: 72 };
  // rede de segurança: mesmo entre as de 100%, um cadastro predial (área do prédio
  // inteiro) pode destoar — o domínio vai até o p98 e o resto fica fora, na tabela.
  const xsOrd = dados.map((t) => t.area_construida_m2).sort((a, b) => a - b);
  const ysOrd = dados.map((t) => t.valor).sort((a, b) => a - b);
  const xTeto = quantil(xsOrd, 0.98), yTeto = quantil(ysOrd, 0.98);
  const ex = escalaNice(xsOrd[0], xTeto, iniciarNoZero);
  const ey = escalaNice(ysOrd[0], yTeto, iniciarNoZero);
  const x = (v) => M.left + ((v - ex.min) / (ex.max - ex.min)) * (W - M.left - M.right);
  const y = (v) => H - M.bottom - ((v - ey.min) / (ey.max - ey.min)) * (H - M.top - M.bottom);
  const noGrafico = dados.filter((t) =>
    t.area_construida_m2 >= ex.min && t.area_construida_m2 <= ex.max &&
    t.valor >= ey.min && t.valor <= ey.max);
  const foraEscala = dados.length - noGrafico.length;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Dispersão de valor por área construída das transações filtradas");

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
  rotX.textContent = "área construída (m²)";
  svg.appendChild(rotX);

  const eixo = document.createElementNS(SVG_NS, "line");
  eixo.setAttribute("class", "eixo");
  eixo.setAttribute("x1", M.left); eixo.setAttribute("x2", W - M.right);
  eixo.setAttribute("y1", H - M.bottom); eixo.setAttribute("y2", H - M.bottom);
  svg.appendChild(eixo);

  for (const t of noGrafico) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("class", "ponto");
    c.setAttribute("cx", x(t.area_construida_m2));
    c.setAttribute("cy", y(t.valor));
    c.setAttribute("r", 4.5);
    c.setAttribute("fill", corAno(t.ano));
    c.setAttribute("stroke", "var(--surface-1)");
    c.setAttribute("stroke-width", "1.5");
    c.addEventListener("mousemove", (ev) => mostrarTooltip(ev, t));
    c.addEventListener("mouseleave", esconderTooltip);
    svg.appendChild(c);
  }
  wrap.appendChild(svg);

  const avisos = [];
  if (parciais > 0) avisos.push(`${parciais} transferência(s) parcial(is) só na tabela`);
  if (foraEscala > 0) avisos.push(`${foraEscala} fora da escala (área/valor extremo)`);
  if (avisos.length) {
    const nota = document.createElement("p");
    nota.className = "rodape";
    nota.textContent = `${dados.length} transações de 100% no gráfico · ${avisos.join(" · ")}.`;
    wrap.appendChild(nota);
  }
}

// ---------- tooltip ----------
const tooltip = () => document.getElementById("tooltip");

function mostrarTooltip(ev, t) {
  const el = tooltip();
  el.innerHTML = `
    <div class="t-titulo">${escapeHtml(t.endereco)}</div>
    ${t.referencia ? `<div class="t-linha">${escapeHtml(t.referencia)}</div>` : ""}
    <div class="t-linha">${escapeHtml(t.natureza)} · ${fmtData(t.data)}</div>
    <div class="t-linha">${fmtM2.format(t.area_construida_m2)} m² · ${fmtBRL.format(t.valor)}${t.integral ? "" : " (declarado)"} · ${fmtBRL.format(t.valor_m2)}/m² equiv.</div>
    ${t.integral ? "" : `<div class="t-linha">transf. de ${fmtPct.format(t.proporcao)}% · equiv. 100% = ${fmtBRL.format(t.valor_100pct)}</div>`}
    <div class="t-linha">${escapeHtml(t.descricao_uso || "—")}${t.acc ? " · " + t.acc : ""}</div>`;
  el.hidden = false;
  const margem = 14;
  let px = ev.clientX + margem, py = ev.clientY + margem;
  const r = el.getBoundingClientRect();
  if (px + r.width > innerWidth - 8) px = ev.clientX - r.width - margem;
  if (py + r.height > innerHeight - 8) py = ev.clientY - r.height - margem;
  el.style.left = px + "px"; el.style.top = py + "px";
}
function esconderTooltip() { tooltip().hidden = true; }

// ---------- tabela ----------
function ligarOrdenacao() {
  document.querySelectorAll("thead th[data-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (estado.ordenacao.col === col) estado.ordenacao.asc = !estado.ordenacao.asc;
      else estado.ordenacao = { col, asc: true };
      render();
    });
  });
}

function ordenar(vis) {
  const { col, asc } = estado.ordenacao;
  const dir = asc ? 1 : -1;
  return [...vis].sort((a, b) => {
    const va = a[col], vb = b[col];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "pt-BR") * dir;
  });
}

function renderTabela(vis) {
  const corpo = document.querySelector("#tabela tbody");
  const ordenados = ordenar(vis);

  document.querySelectorAll("thead th[data-col]").forEach((th) => {
    const base = th.textContent.replace(/ [▲▼]$/, "");
    th.innerHTML = escapeHtml(base) +
      (th.dataset.col === estado.ordenacao.col
        ? ` <span class="seta">${estado.ordenacao.asc ? "▲" : "▼"}</span>` : "");
  });

  corpo.innerHTML = ordenados.map((t) => {
    const parcial = t.proporcao < 100;
    const seloV = t.tem_venda
      ? ` <a class="selo-venda" href="index.html" title="${escapeHtml(t.venda_qtde + " imóvel(is) à venda neste prédio (ver dashboard de imóveis)")}">🏙️ à venda (${t.venda_qtde})</a>`
      : "";
    const ref = t.area_util_ref;
    const manual = AreaUtil.valor(t.id);
    const ph = ref != null ? fmtNum.format(Math.round(ref)) + " ref." : "";
    const tituloAU = ref != null
      ? `Sugestão do prédio (mediana dos anúncios): ${fmtM2.format(ref)} m². Digite para corrigir; vazio volta à sugestão.`
      : "Sem anúncio conciliado — informe a área útil (fica só no seu navegador).";
    return `
    <tr${parcial ? ' class="dup"' : ""}>
      <td class="num">${fmtData(t.data)}</td>
      <td class="col-titulo">${escapeHtml(t.endereco)}${seloV}${t.cep ? `<br><span class="rodape">${escapeHtml(t.cep)}</span>` : ""}</td>
      <td>${escapeHtml(t.referencia || "—")}</td>
      <td>${escapeHtml(t.natureza)}</td>
      <td class="num">${fmtBRL.format(t.valor)}</td>
      <td class="num">${parcial ? `<span class="selo-dup" title="Transferência parcial — fora dos KPIs; R$/m² usa o valor equivalente a 100% (extrapolado)">${fmtPct.format(t.proporcao)}%</span>` : "100%"}</td>
      <td class="num">${t.area_construida_m2 != null ? fmtM2.format(t.area_construida_m2) : "—"}</td>
      <td class="num">${t.valor_m2 != null ? fmtBRL.format(t.valor_m2) : "—"}</td>
      <td class="num col-areautil">
        <input type="number" class="au-input" data-id="${escapeHtml(t.id)}" min="0" step="0.01" inputmode="decimal"
          value="${manual != null ? manual : ""}" placeholder="${escapeHtml(ph)}" title="${escapeHtml(tituloAU)}" aria-label="área útil (m²)">
      </td>
      <td class="num">${t.valor_m2_util != null
        ? `<span title="R$/m² sobre a área útil (aproximado)${t.area_util_fonte === "ref" ? " — área útil de referência do prédio" : ""}">~${fmtBRL.format(t.valor_m2_util)}${t.area_util_fonte === "ref" ? ' <span class="tag-ref">ref.</span>' : ""}</span>`
        : "—"}</td>
      <td>${escapeHtml(t.descricao_uso || "—")}</td>
      <td>${escapeHtml(t.descricao_padrao || "—")}</td>
      <td class="num">${t.acc ?? "—"}</td>
    </tr>`;
  }).join("");

  // editor inline de área útil: commit no blur/enter (change), sem re-render por tecla
  corpo.querySelectorAll(".au-input").forEach((inp) =>
    inp.addEventListener("change", () => {
      AreaUtil.salvar(inp.dataset.id, inp.value);
      decorarTransacoes();
      render();
    })
  );

  document.getElementById("rodape").textContent =
    `${vis.length} transações exibidas · ordenado por ${estado.ordenacao.col.replace("_", " ")} ` +
    `(${estado.ordenacao.asc ? "crescente" : "decrescente"}) · R$/m² = valor equivalente a 100% ÷ área`;
}

// ---------- util ----------
function fmtData(iso) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

boot();
