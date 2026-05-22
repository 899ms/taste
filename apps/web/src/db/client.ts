import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { AppConfigError } from "@/config";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

let cachedDb: Database | null = null;

export function getDb(): Database {
  if (cachedDb) return cachedDb;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new AppConfigError(["DATABASE_URL"]);
  }
  cachedDb = drizzle(neon(databaseUrl), { schema });
  return cachedDb;
}

export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(getDb() as object, property, receiver);
  },
});
