import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { ensureSchema } from "@/server/db/bootstrap";
import * as schema from "@/server/db/schema";

type DatabaseSingleton = {
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle<typeof schema>>;
  filePath: string;
};

declare global {
  var __karaokeDbSingleton: DatabaseSingleton | undefined;
}

function createDatabaseSingleton(): DatabaseSingleton {
  const filePath = path.resolve(
    process.env.DB_FILE ??
      path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "karaoke.db"),
  );

  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  ensureSchema(sqlite);

  const db = drizzle(sqlite, {
    schema,
  });

  return {
    sqlite,
    db,
    filePath,
  };
}

export function getDatabase() {
  if (!global.__karaokeDbSingleton) {
    global.__karaokeDbSingleton = createDatabaseSingleton();
  }

  return global.__karaokeDbSingleton;
}
