/* Camada de anotações do usuário (ADR-006, revisado pelo ADR-008).
   Fonte da verdade: localStorage do navegador. Backup: SOMENTE export/import
   manual de JSON, guardado localmente pelo usuário — o repo e o GitHub Pages
   são PÚBLICOS, então anotações pessoais (endereço, comentários, score) nunca
   são commitadas nem buscadas do repositório.
   O scraper NUNCA lê nem escreve estes dados. */
"use strict";

const Anotacoes = (() => {
  const LS_KEY = "vnc-imoveis:anotacoes";
  let cache = {};
  let persistindo = true; // false quando o navegador nega escrita (privado/quota)

  function _lerLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
    catch { return {}; }
  }

  function _persistir() {
    // escrita pode falhar (modo privado, quota, storage desabilitado) — o
    // dashboard segue funcionando com as anotações só em memória nesta sessão
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cache));
      persistindo = true;
    } catch (e) {
      persistindo = false;
      console.warn("anotações: localStorage indisponível, mantendo só em memória", e);
    }
    return persistindo;
  }

  function _normalizarData(v) {
    // aceita qualquer formato que Date.parse entenda e normaliza para ISO UTC;
    // inválido vira "" (perde qualquer disputa de merge) — nunca comparar
    // lexicalmente string de data não validada
    const t = Date.parse(v);
    return Number.isNaN(t) ? "" : new Date(t).toISOString();
  }

  function _sanitizar(anot) {
    // dados podem vir de JSON externo (import/localStorage adulterado) —
    // normaliza tipos antes de qualquer uso
    if (typeof anot !== "object" || anot === null) return null;
    return {
      endereco_completo: String(anot.endereco_completo ?? ""),
      comentario: String(anot.comentario ?? ""),
      score: Math.max(0, Math.min(5, Math.trunc(Number(anot.score) || 0))),
      visitado: anot.visitado === true,
      atualizado_em: _normalizarData(anot.atualizado_em),
    };
  }

  function _mesclar(a, b) {
    // b vence quando for mais recente (campo atualizado_em, ISO 8601)
    const saida = { ...a };
    for (const [id, bruto] of Object.entries(b)) {
      const anot = _sanitizar(bruto);
      if (!anot) continue;
      const atual = saida[id];
      if (!atual || (anot.atualizado_em || "") > (atual.atualizado_em || "")) {
        saida[id] = anot;
      }
    }
    return saida;
  }

  async function carregar() {
    // ADR-008: nada é buscado do repositório (público). Só localStorage,
    // sanitizado porque pode ter sido escrito por versões antigas
    cache = _mesclar({}, _lerLocal());
    _persistir();
    return cache;
  }

  function obter(id) {
    return cache[id] || { endereco_completo: "", comentario: "", score: 0, visitado: false };
  }

  function _sincronizar() {
    // outra aba pode ter escrito depois do nosso boot — re-mescla o storage
    // atual (timestamp mais recente vence) antes de qualquer escrita, para
    // _persistir() nunca sobrescrever anotações alheias com cache velho
    cache = _mesclar(cache, _lerLocal());
  }

  function salvar(id, campos) {
    _sincronizar();
    cache[id] = { ...obter(id), ...campos, atualizado_em: new Date().toISOString() };
    _persistir();
    return cache[id];
  }

  function todas() { return cache; }

  function exportar() {
    _sincronizar(); // backup sempre com a visão mais completa entre abas
    const blob = new Blob([JSON.stringify(cache, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "anotacoes.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importar(arquivo) {
    return arquivo.text().then((texto) => {
      const dados = JSON.parse(texto);
      if (typeof dados !== "object" || Array.isArray(dados)) {
        throw new Error("formato inválido: esperado objeto {id: anotação}");
      }
      _sincronizar();
      cache = _mesclar(cache, dados);
      _persistir();
      return Object.keys(dados).length;
    });
  }

  function persistiu() { return persistindo; }

  return { carregar, obter, salvar, todas, exportar, importar, persistiu };
})();
