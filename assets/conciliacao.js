/* Conciliação entre os dois dashboards por PRÉDIO (ADR-013).
   Módulo compartilhado por app.js (venda) e itbi.js (transações): funções puras
   que reduzem um endereço a uma "chave de prédio" = logradouro normalizado +
   número. A mesma função roda nos dois lados, então a comparação é consistente
   mesmo quando um lado escreve "R JACQUES FELIX" e o outro "Rua Jacques Félix".

   Sem estado, sem I/O — carregável no navegador (global Conciliacao) e nos
   testes Node via vm (mesmo padrão de anotacoes.js). */
"use strict";

const Conciliacao = (() => {
  // prefixos de tipo de logradouro removidos antes de comparar. Removê-los dos
  // DOIS lados faz "R JACQUES FELIX" (ITBI) casar com "Rua Jacques Félix" (VNC)
  // e também com "Jacques Felix" (endereço sem o tipo).
  const PREFIXOS = new Set([
    "R", "RUA", "AV", "AVN", "AVENIDA", "AL", "ALAMEDA", "PC", "PCA", "PRACA",
    "TR", "TV", "TRAVESSA", "LARGO", "LGO", "EST", "ESTR", "ESTRADA",
    "ROD", "RODOVIA", "VIA", "VIADUTO", "VD",
  ]);

  // Maiúsculas, sem acento, só [A-Z0-9 ], sem o prefixo de tipo, espaços colapsados.
  // Porta em JS do itbi/util.py::normalizar + remoção de prefixo.
  function normalizarLogradouro(s) {
    if (s == null) return "";
    const limpo = String(s)
      .normalize("NFKD").replace(/[̀-ͯ]/g, "") // tira acentos
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!limpo) return "";
    const toks = limpo.split(" ");
    // remove só o PRIMEIRO token se for prefixo de tipo (não remove miolo)
    if (toks.length > 1 && PREFIXOS.has(toks[0])) toks.shift();
    return toks.join(" ");
  }

  // só os dígitos do número ("709" -> "709", "1.234" -> "1234", "s/n" -> "")
  function soDigitos(v) {
    return String(v == null ? "" : v).replace(/\D+/g, "");
  }

  // "CORE#DIGITOS" ou null quando faltar logradouro ou número.
  function chaveEndereco(logradouro, numero) {
    const core = normalizarLogradouro(logradouro);
    const num = soDigitos(numero);
    if (!core || !num) return null;
    return core + "#" + num;
  }

  // Texto livre -> { rua, numero }. Aceita "Rua Afonso Braz, 692, apto 51",
  // "Avenida Santo Amaro 835" e variações. Campos ausentes vêm como "".
  function parseEnderecoLivre(texto) {
    if (!texto) return { rua: "", numero: "" };
    const s = String(texto).trim();
    // forma preferida: "<rua>, <número>[, ...]"
    let m = s.match(/^(.*?),\s*(\d[\d.]*)/);
    if (m) return { rua: m[1], numero: soDigitos(m[2]) };
    // fallback: "<rua> <número>" (número seguido de fim ou não-dígito)
    m = s.match(/^(.+?)[\s,]+(\d[\d.]*)\b/);
    if (m) return { rua: m[1], numero: soDigitos(m[2]) };
    return { rua: s, numero: "" };
  }

  // Chave de prédio de um imóvel à venda. Só a VNC traz `endereco`; para os
  // demais usa-se o `endereco_completo` das anotações como fallback (ADR-013).
  function chaveImovel(imovel, anotacao) {
    const bruto = (imovel && imovel.endereco) || (anotacao && anotacao.endereco_completo) || "";
    const { rua, numero } = parseEnderecoLivre(bruto);
    return chaveEndereco(rua, numero);
  }

  // Chave de prédio de uma transação (logradouro/numero já separados no JSON).
  function chaveTransacao(t) {
    return chaveEndereco(t && t.logradouro, t && t.numero);
  }

  // Map(chave -> itens[]) ignorando itens sem chave.
  function indexarPorPredio(itens, keyFn) {
    const idx = new Map();
    for (const item of itens) {
      const k = keyFn(item);
      if (!k) continue;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(item);
    }
    return idx;
  }

  return {
    normalizarLogradouro,
    soDigitos,
    chaveEndereco,
    parseEnderecoLivre,
    chaveImovel,
    chaveTransacao,
    indexarPorPredio,
  };
})();

// export opcional p/ Node (testes) sem quebrar o uso como <script> no navegador
if (typeof module !== "undefined" && module.exports) module.exports = Conciliacao;
