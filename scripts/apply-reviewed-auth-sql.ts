/**
 * Review list only. This process does not open a database.
 * It is not `pnpm migrate` and it does not read every file in db/migrations,
 * so it cannot sweep 0006_auth.sql.
 *
 * A later reviewed execution would apply only these paths, in this order:
 *   db/review/0009_auth_identities.sql
 *   db/migrations/0008_auth_holdings.sql
 */
const FILES = [
  "db/review/0009_auth_identities.sql",
  "db/migrations/0008_auth_holdings.sql",
] as const;

if (process.argv.includes("--execute")) {
  console.error(
    "Refusing to execute. Production applied state was NOT CHECKED. This is not pnpm migrate.",
  );
  process.exit(2);
}

for (const file of FILES) {
  if (file.includes("0006_auth.sql")) {
    console.error("Refusing to include 0006_auth.sql.");
    process.exit(2);
  }
}

console.log("Review only. Not executed.");
for (const file of FILES) console.log(file);
