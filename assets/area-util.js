/* Camada de área útil informada pelo usuário no dashboard de transações (ADR-013).
   Espelha assets/anotacoes.js: fonte da verdade é o localStorage do navegador;
   backup só por export/import manual de JSON. O ITBI (build.py) NUNCA lê nem
   escreve estes dados e transacoes.json não é tocado — a conciliação só consegue
   sugerir a área útil no NÍVEL DO PRÉDIO (os anúncios não têm nº de apartamento),
   então o usuário pode informar a área útil real por transação aqui.

   Chave localStorage separada da de anotações. Estrutura:
     { <id da transação>: { area_util: Number, atualizado_em: ISO } } */
"use strict";

const AreaUtil = (() => {
  const LS_KEY = "vnc-imoveis:areautil";
  let cache = {};
  let persistindo = true;

  function _lerLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
    catch { return {}; }
  }

  function _persistir() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cache));
      persistindo = true;
    } catch (e) {
      persistindo = false;
      console.warn("área útil: localStorage indisponível, mantendo só em memória", e);
    }
    return persistindo;
  }

  function _normalizarData(v) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? "" : new Date(t).toISOString();
  }

  function _sanitizar(reg) {
    // pode vir de JSON externo (import/localStorage adulterado): força tipos
    if (typeof reg !== "object" || reg === null) return null;
    const n = Number(reg.area_util);
    // área útil só faz sentido como número finito > 0; qualquer outra coisa descarta o registro
    if (!Number.isFinite(n) || n <= 0) return null;
    return {
      area_util: Math.round(n * 100) / 100, // 2 casas (m²)
      atualizado_em: _normalizarData(reg.atualizado_em),
    };
  }

  function _mesclar(a, b) {
    const saida = { ...a };
    for (const [id, bruto] of Object.entries(b)) {
      const reg = _sanitizar(bruto);
      if (!reg) continue;
      const atual = saida[id];
      if (!atual || (reg.atualizado_em || "") > (atual.atualizado_em || "")) {
        saida[id] = reg;
      }
    }
    return saida;
  }

  async function carregar() {
    cache = _mesclar({}, _lerLocal());
    _persistir();
    return cache;
  }

  function obter(id) {
    return cache[id] || null;
  }

  function valor(id) {
    const r = cache[id];
    return r ? r.area_util : null;
  }

  function _sincronizar() {
    cache = _mesclar(cache, _lerLocal());
  }

  // salvar(id, null | "" | <=0) remove o registro (volta a usar a sugestão da conciliação)
  function salvar(id, areaUtil) {
    _sincronizar();
    const n = Number(areaUtil);
    if (areaUtil === null || areaUtil === "" || !Number.isFinite(n) || n <= 0) {
      delete cache[id];
    } else {
      cache[id] = { area_util: Math.round(n * 100) / 100, atualizado_em: new Date().toISOString() };
    }
    _persistir();
    return cache[id] || null;
  }

  function todas() { return cache; }

  function exportar() {
    _sincronizar();
    const blob = new Blob([JSON.stringify(cache, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "areas-uteis.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importar(arquivo) {
    return arquivo.text().then((texto) => {
      const dados = JSON.parse(texto);
      if (typeof dados !== "object" || Array.isArray(dados)) {
        throw new Error("formato inválido: esperado objeto {id: {area_util}}");
      }
      _sincronizar();
      cache = _mesclar(cache, dados);
      _persistir();
      return Object.keys(dados).length;
    });
  }

  function persistiu() { return persistindo; }

  return { carregar, obter, valor, salvar, todas, exportar, importar, persistiu };
})();

if (typeof module !== "undefined" && module.exports) module.exports = AreaUtil;
