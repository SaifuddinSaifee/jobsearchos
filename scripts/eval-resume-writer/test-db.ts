import "dotenv/config";

// Imported first by the resume writer eval: its usage records go to the test database, so eval runs never mix with the
// app's own on the AI usage page. `--dev-db` keeps the dev database.
if (!process.argv.includes("--dev-db")) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set in .env (or pass --dev-db to record in the dev database)");
  process.env.DATABASE_URL = url;
}
