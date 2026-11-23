import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function verifyBackup(backupDir) {
  // Check a throwaway local copy so the backup itself is never opened over SMB or modified.
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "karaoke-backup-check-"));
  let db;
  try {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const source = path.join(backupDir, `karaoke.db${suffix}`);
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, path.join(temporaryDir, `karaoke.db${suffix}`));
      } else if (!suffix) {
        throw new Error("Backup database is missing");
      }
    }
    db = new Database(path.join(temporaryDir, "karaoke.db"), { fileMustExist: true });
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`SQLite integrity check failed: ${integrity}`);
    }
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    return {
      rooms: count("rooms"),
      profiles: count("profiles"),
      favorites: count("favorites"),
      history: count("playback_history"),
    };
  } finally {
    db?.close();
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

const backupDir = process.argv[2];
if (!backupDir) {
  console.error("Usage: node verify-deployment-backup.mjs <backup directory>");
  process.exitCode = 1;
} else {
  try {
    const { rooms, profiles, favorites, history } = verifyBackup(backupDir);
    console.log(
      `Backup integrity OK: ${rooms} rooms, ${profiles} profiles, ${favorites} favorites, ${history} history entries.`,
    );
  } catch (error) {
    console.error(`Backup verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
