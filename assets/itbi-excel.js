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
    "Valor declarado (R$)": t.valor,
    "Proporção (%)": t.proporcao,
    "Valor 100% (R$)": t.valor_100pct,
    "Área construída (m²)": t.area_construida_m2 ?? "",
    "R$/m² (100%)": t.valor_m2 ?? "",
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
    { wch: 11 }, { wch: 40 }, { wch: 24 }, { wch: 20 }, { wch: 11 }, { wch: 26 },
    { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 40 },
    { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transações VNC");
  const hoje = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `transacoes-itbi-vila-nova-conceicao-${hoje}.xlsx`);
}
