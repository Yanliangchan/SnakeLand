/**
 * A throwaway in-memory SQLite database per request, for the SQL-injection
 * challenges. It is completely separate from the app's Postgres: nothing here
 * can read or change real data, and the database is discarded when the request
 * ends. The queries are built by naive string concatenation on purpose.
 */

// node:sqlite is built into Node 22.5+. Imported lazily so a missing build
// doesn't crash the whole API at boot.
type SqliteRow = Record<string, unknown>;
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): SqliteRow[] };
  close(): void;
}

let DatabaseSync: (new (path: string) => SqliteDb) | null | undefined;
async function sqlite(): Promise<(new (path: string) => SqliteDb) | null> {
  if (DatabaseSync !== undefined) return DatabaseSync;
  try {
    const mod = (await import("node:sqlite")) as unknown as { DatabaseSync: new (path: string) => SqliteDb };
    DatabaseSync = mod.DatabaseSync;
  } catch {
    DatabaseSync = null;
  }
  return DatabaseSync;
}

export const sqliteAvailable = async () => (await sqlite()) !== null;

const esc = (s: string) => s.replace(/'/g, "''");

/** Run `build(query)` against a fresh seeded database. Read-only, time-boxed. */
async function withDb<T>(flag: string, seed: (db: SqliteDb) => void, run: (db: SqliteDb) => T): Promise<T> {
  const Ctor = await sqlite();
  if (!Ctor) throw new Error("SQLITE_UNAVAILABLE");
  const db = new Ctor(":memory:");
  try {
    seed(db);
    return run(db);
  } finally {
    db.close();
  }
}

export interface LoginResult {
  ok: boolean;
  query: string;
  rows: { username: string; note: string }[];
}

/**
 * Login-bypass challenge. The flag is the admin account's note; a normal login
 * needs the (unknown) password, but the query is injectable.
 */
export async function sqliLogin(flag: string, username: string, password: string): Promise<LoginResult> {
  return withDb(
    flag,
    (db) => {
      db.exec(`CREATE TABLE users (id INTEGER, username TEXT, password TEXT, note TEXT);`);
      db.exec(
        `INSERT INTO users VALUES ` +
          `(1,'admin','${esc(randomPw())}','${esc(flag)}'),` +
          `(2,'guest','guest','welcome, guest'),` +
          `(3,'dealer','${esc(randomPw())}','shift notes');`,
      );
    },
    (db) => {
      // The classic vulnerable string-concat login query.
      const query = `SELECT username, note FROM users WHERE username = '${username}' AND password = '${password}'`;
      let rows: { username: string; note: string }[] = [];
      try {
        rows = db.prepare(query).all() as unknown as { username: string; note: string }[];
      } catch {
        rows = [];
      }
      return { ok: rows.length > 0, query, rows };
    },
  );
}

export interface SearchResult {
  query: string;
  columns: string[];
  rows: unknown[][];
  error: string | null;
}

/**
 * Product-search challenge. The flag lives in a separate `secrets` table, so a
 * UNION-based injection is needed to read it out through the 3-column result.
 */
export async function sqliSearch(flag: string, term: string): Promise<SearchResult> {
  return withDb(
    flag,
    (db) => {
      db.exec(`CREATE TABLE products (id INTEGER, name TEXT, price INTEGER);`);
      db.exec(
        `INSERT INTO products VALUES (1,'Snake Plush',1200),(2,'Chip Set',3400),(3,'Poker Mat',2100),(4,'Dice Cup',800);`,
      );
      db.exec(`CREATE TABLE secrets (id INTEGER, name TEXT, value TEXT);`);
      db.exec(`INSERT INTO secrets VALUES (1,'vault_flag','${esc(flag)}');`);
    },
    (db) => {
      const query = `SELECT id, name, price FROM products WHERE name LIKE '%${term}%'`;
      try {
        const rows = db.prepare(query).all() as SqliteRow[];
        const columns = rows.length ? Object.keys(rows[0]!) : ["id", "name", "price"];
        return { query, columns, rows: rows.map((r) => Object.values(r)), error: null };
      } catch (e) {
        return { query, columns: [], rows: [], error: (e as Error).message };
      }
    },
  );
}

function randomPw(): string {
  // A long random password so the admin row can't be guessed, only bypassed.
  return Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
}
