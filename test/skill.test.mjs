import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

test("skill installer preserves local source arguments through the platform launcher", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "jevgrep-skill-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const checkoutRoot = fileURLToPath(new URL("../", import.meta.url));
  const checkoutScratch = await mkdtemp(join(tmpdir(), ".tmp-skill-"));
  t.after(() => rm(checkoutScratch, { recursive: true, force: true }));
  await symlink(
    join(checkoutRoot, "node_modules"),
    join(checkoutScratch, "node_modules"),
    "junction",
  );
  const bin = join(home, "installer with spaces");
  await mkdir(bin);
  const fixture = fileURLToPath(new URL("./fixtures/skill-installer.mjs", import.meta.url));
  const windows = process.platform === "win32";
  await writeFile(
    join(bin, windows ? "npx.cmd" : "npx"),
    windows
      ? `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`,
    { mode: 0o755 },
  );

  let cli = process.env.JEVGREP_TEST_CLI;
  let packageDist;
  if (cli) {
    packageDist = dirname(dirname(cli));
  } else {
    packageDist = join(checkoutScratch, "cli bundle & with spaces", "dist");
    await cp(fileURLToPath(new URL("../apps/cli/dist", import.meta.url)), packageDist, {
      recursive: true,
    });
    cli = join(packageDist, "bin", "index.js");
  }
  const source = await realpath(join(packageDist, "skills", "jevgrep"));
  const result = await promisify(execFile)(
    process.execPath,
    [cli, "skill", "--agent", "claude-code", "--agent", "codex", "--global", "--yes"],
    {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: home,
        XDG_CACHE_HOME: join(home, "cache"),
        PATH: [bin, dirname(process.execPath), process.env.PATH].join(delimiter),
        JEVGREP_INSTALLER_EXIT: "7",
      },
      timeout: 10000,
    },
  ).then(
    () => assert.fail("The installer exit status must reach the CLI"),
    (error) => error,
  );
  assert.equal(result.code, 7);
  assert.equal(result.stdout, "Installer completed.\n");
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(await readFile(join(home, "installed-skill.json"), "utf8")), [
    "--yes",
    "--ignore-scripts",
    "skills@1.7.0",
    "add",
    source,
    "--skill",
    "jevgrep",
    "--agent",
    "claude-code",
    "--agent",
    "codex",
    "--global",
    "--yes",
  ]);
});
