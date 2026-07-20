/* Export .xlsx das transações filtradas (ADR-007/011).
   Usa SheetJS vendorizado em assets/vendor/xlsx.min.js (sem CDN). */
"use strict";

function baixarExcelTransacoes(transacoes) {
  const linhas = transacoes.map((t) => ({
    "Data": t.data,
    "Endereço": t.endereco,
    "Referência": t.referencia || "",
    "Bairro": t.bairro,
    "CEP": t.cep || "",
    "Natureza": t.natureza,
    "Tipo de ativo": t.tipo_ativo || "",
    "Integral (100%)": t.integral ? "sim" : "não",
    "Valor declarado (R$)": t.valor,
    "Proporção (%)": t.proporcao,
    "Valor equiv. 100% (R$)": t.valor_100pct,
    "Área construída (m²)": t.area_construida_m2 ?? "",
    "R$/m² constr. equiv.": t.valor_m2 ?? "",
    "À venda no prédio": t.tem_venda ? `sim (${t.venda_qtde})` : "",
    "Área útil (m²)": t.area_util_m2 ?? "",
    "Fonte área útil": t.area_util_fonte === "manual" ? "manual" : (t.area_util_fonte === "ref" ? "ref. prédio" : ""),
    "R$/m² útil (aprox.)": t.valor_m2_util ?? "",
    "Uso (IPTU)": t.descricao_uso || "",
    "Padrão (IPTU)": t.descricao_padrao || "",
    "ACC (ano constr.)": t.acc ?? "",
    "Valor venal ref. (R$)": t.valor_venal_referencia ?? "",
    "Valor/Venal": t.razao_valor_venal ?? "",
    "Área terreno (m²)": t.area_terreno_m2 ?? "",
    "SQL": t.sql,
  }));
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws["!cols"] = [
    { wch: 11 }, { wch: 40 }, { wch: 24 }, { wch: 20 }, { wch: 11 }, { wch: 26 }, // Data..Natureza
    { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, // Tipo..Área constr.
    { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 13 }, { wch: 16 },              // R$/m² constr., À venda, Área útil, Fonte, R$/m² útil
    { wch: 40 }, { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, // Uso..Área terreno
    { wch: 14 },                                                                  // SQL
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transações VNC");
  const hoje = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `transacoes-itbi-vila-nova-conceicao-${hoje}.xlsx`);
}
