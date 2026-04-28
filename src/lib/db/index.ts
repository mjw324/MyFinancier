import * as schema from "./schema";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;

export function setTestDb(testDb: DB | null) {
  _db = testDb;
}

function getDb(): DB {
  if (_db) return _db;
  const client = postgres(process.env.DATABASE_URL!);
  _db = drizzle(client, { schema });
  return _db;
}

export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
}) as DB;
