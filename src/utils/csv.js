function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function toCsv(rows) {
  const data = Array.isArray(rows) ? rows : [];
  if (!data.length) return "";
  const columns = Array.from(
    data.reduce((acc, row) => {
      Object.keys(row || {}).forEach((k) => acc.add(k));
      return acc;
    }, new Set())
  );
  const header = columns.map(escapeCell).join(",");
  const lines = data.map((row) => columns.map((col) => escapeCell(row?.[col])).join(","));
  return [header, ...lines].join("\n");
}
