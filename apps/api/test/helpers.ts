import { randomUUID } from "node:crypto";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";

export function testDb() {
  return createDb(process.env.DATABASE_URL!);
}

export async function createUser(db: ReturnType<typeof testDb>["db"], opts: { anonymous?: boolean } = {}) {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    name: "Test",
    email: `${id}@example.test`,
    isAnonymous: opts.anonymous ?? false,
  });
  return id;
}
