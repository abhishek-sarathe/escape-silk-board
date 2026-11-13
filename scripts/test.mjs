// Runs Vitest from the canonical project path. On Windows, a shell opened at "d:\..." while Node's
// real path is "D:\..." makes Vitest load itself twice and every suite fails with
// "Cannot read properties of undefined (reading 'config')". Starting from the real path avoids that.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

const cwd = realpathSync.native(process.cwd());
const bin = join(cwd, "node_modules", "vitest", "vitest.mjs");
const args = process.argv.slice(2);
const { status } = spawnSync(process.execPath, [bin, ...(args.length ? args : ["run"])], { cwd, stdio: "inherit" });
process.exit(status ?? 1);
