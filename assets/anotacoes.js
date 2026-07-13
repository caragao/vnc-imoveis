/* Camada de anotações do usuário (ADR-006).
   Fonte da verdade no navegador: localStorage. Backup/seed: data/anotacoes.json
   (commitado manualmente). Merge no boot: atualizado_em mais recente vence.
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

  function _sanitizar(anot) {
    // dados podem vir de JSON externo (repo/import) — normaliza tipos antes de
    // qualquer uso: score inteiro 0-5, strings de fato strings, boolean de fato boolean
    if (typeof anot !== "object" || anot === null) return null;
    return {
      endereco_completo: String(anot.endereco_completo ?? ""),
      comentario: String(anot.comentario ?? ""),
      score: Math.max(0, Math.min(5, Math.trunc(Number(anot.score) || 0))),
      visitado: anot.visitado === true,
      atualizado_em: String(anot.atualizado_em ?? ""),
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
    let doRepo = {};
    try {
      const r = await fetch("data/anotacoes.json", { cache: "no-store" });
      if (r.ok) doRepo = await r.json();
    } catch { /* offline ou arquivo ausente: segue só com localStorage */ }
    // duas passadas para sanitizar os DOIS lados (repo e localStorage)
    cache = _mesclar(_mesclar({}, doRepo), _lerLocal());
    _persistir();
    return cache;
  }

  function obter(id) {
    return cache[id] || { endereco_completo: "", comentario: "", score: 0, visitado: false };
  }

  function salvar(id, campos) {
    cache[id] = { ...obter(id), ...campos, atualizado_em: new Date().toISOString() };
    _persistir();
    return cache[id];
  }

  function todas() { return cache; }

  function exportar() {
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
      cache = _mesclar(cache, dados);
      _persistir();
      return Object.keys(dados).length;
    });
  }

  function persistiu() { return persistindo; }

  return { carregar, obter, salvar, todas, exportar, importar, persistiu };
})();
