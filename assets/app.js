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

const estado = {
  imoveis: [],
  ordenacao: { col: "preco_m2", asc: true },
  // fase 4 pluga aqui: anotacoes por id
  anotacoes: {},
};

// ---------- boot ----------
async function boot() {
  const resp = await fetch("data/imoveis.json");
  const dados = await resp.json();
  estado.imoveis = dados.imoveis;
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
  render();
  document.dispatchEvent(new CustomEvent("dashboard:pronto"));
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
    fontes,
  };
}

// fase 4 substitui/estende este hook para filtrar por score/visitado
let filtroExtra = () => true;
function definirFiltroExtra(fn) { filtroExtra = fn; }

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
    filtroExtra(i)
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
    document.dispatchEvent(new CustomEvent("dashboard:limpar"));
    render();
  });
}

// ---------- render ----------
function render() {
  const visiveis = filtrar();
  renderKpis(visiveis);
  renderScatter(visiveis);
  renderTabela(visiveis);
  document.dispatchEvent(new CustomEvent("dashboard:render", { detail: { visiveis } }));
}

function mediana(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function renderKpis(vis) {
  const el = document.getElementById("kpis");
  const medPm2 = mediana(vis.map((i) => i.preco_m2));
  const medArea = mediana(vis.map((i) => i.area_util_m2));
  const precos = vis.map((i) => i.preco);
  const kpis = [
    { rotulo: "Imóveis", valor: fmtNum.format(vis.length), compl: `de ${fmtNum.format(estado.imoveis.length)}` },
    { rotulo: "Mediana R$/m²", valor: medPm2 ? fmtBRL.format(medPm2) : "—", compl: "dos filtrados" },
    { rotulo: "Faixa de preço", valor: precos.length ? fmtBRL.format(Math.min(...precos)) : "—", compl: precos.length ? "a " + fmtBRL.format(Math.max(...precos)) : "" },
    { rotulo: "Mediana de área", valor: medArea ? fmtM2.format(medArea) + " m²" : "—", compl: "dos filtrados" },
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

function renderScatter(vis) {
  const wrap = document.getElementById("scatter");
  wrap.innerHTML = "";
  if (!vis.length) { wrap.innerHTML = '<p class="rodape">Nenhum imóvel com os filtros atuais.</p>'; return; }

  const W = 960, H = 340, M = { top: 12, right: 20, bottom: 34, left: 64 };
  const xs = vis.map((i) => i.area_util_m2), ys = vis.map((i) => i.preco);
  const xMax = Math.max(...xs) * 1.05, yMax = Math.max(...ys) * 1.05;
  const x = (v) => M.left + (v / xMax) * (W - M.left - M.right);
  const y = (v) => H - M.bottom - (v / yMax) * (H - M.top - M.bottom);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Dispersão de preço por área dos imóveis filtrados");

  // gridlines horizontais + rótulos do eixo y
  const yTicks = 4;
  for (let t = 0; t <= yTicks; t++) {
    const v = (yMax / yTicks) * t;
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
  const xTicks = 6;
  for (let t = 0; t <= xTicks; t++) {
    const v = (xMax / xTicks) * t;
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
  for (const im of vis) {
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

// ---------- tooltip ----------
const tooltip = () => document.getElementById("tooltip");

function mostrarTooltip(ev, im) {
  const t = tooltip();
  t.innerHTML = `
    <div class="t-titulo">${escapeHtml(im.titulo)}</div>
    <div class="t-linha">${FONTES[im.fonte].rotulo} · ${escapeHtml(im.tipo)}</div>
    <div class="t-linha">${fmtM2.format(im.area_util_m2)} m² · ${fmtBRL.format(im.preco)} · ${fmtBRL.format(im.preco_m2)}/m²</div>
    <div class="t-linha">${im.dormitorios ?? "?"} dorm · ${im.suites ?? "?"} suítes · ${im.vagas ?? "?"} vagas</div>`;
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

  corpo.innerHTML = ordenados.map((im) => `
    <tr data-id="${escapeHtml(im.id)}">
      <td><span class="fonte-tag"><span class="dot" style="background:${FONTES[im.fonte].cor}"></span>${FONTES[im.fonte].rotulo}</span></td>
      <td>${escapeHtml(im.tipo)}</td>
      <td class="col-titulo"><a class="titulo-link" href="${escapeHtml(im.url)}" target="_blank" rel="noopener">${escapeHtml(im.titulo)}</a>${im.endereco ? `<br><span class="rodape">${escapeHtml(im.endereco)}</span>` : ""}</td>
      <td class="num">${fmtM2.format(im.area_util_m2)}</td>
      <td class="num">${fmtBRL.format(im.preco)}</td>
      <td class="num">${fmtBRL.format(im.preco_m2)}</td>
      <td class="num">${im.dormitorios ?? "—"}</td>
      <td class="num">${im.suites ?? "—"}</td>
      <td class="num">${im.vagas ?? "—"}</td>
      <td><a class="abrir" href="${escapeHtml(im.url)}" target="_blank" rel="noopener">abrir ↗</a></td>
    </tr>`).join("");

  document.getElementById("rodape").textContent =
    `${vis.length} imóveis exibidos · ordenado por ${estado.ordenacao.col.replace("_", " ")} ` +
    `(${estado.ordenacao.asc ? "crescente" : "decrescente"})`;
}

// ---------- util ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

boot();
