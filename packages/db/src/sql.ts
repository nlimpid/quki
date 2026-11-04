/** Split a migration script into statements. Strips `--` comments. */

export function splitSql(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    if (quote) {
      current += char ?? "";
      if (char === quote) {
        if (script[i + 1] === quote) {
          current += script[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "-" && script[i + 1] === "-") {
      const newline = script.indexOf("\n", i);
      i = newline === -1 ? script.length : newline;
      continue;
    }
    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }
    current += char ?? "";
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
