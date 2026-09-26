import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

// Works both from src/ (tsx) and from the bundled dist/ output.
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, here.endsWith("dist") ? "../drizzle" : "../../drizzle");

const { db, pool } = createDb(url);
await migrate(db, { migrationsFolder });
await pool.end();
console.log("migrations applied");
