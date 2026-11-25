import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { resolveCommand } from "../src/resolve-command.ts";

// Seam: resolveCommand, the platform rule for starting Pi. Windows is simulated with `platform: "win32"`.

let bin: string;

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "aha-bin-"));
});

afterEach(() => rmSync(bin, { recursive: true, force: true }));

/** What npm's cmd-shim writes for a global `pi`. */
const npmShim = (script: string) =>
  `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n` +
  `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*\r\n`;

test("a JavaScript file runs with this Node on every platform", () => {
  for (const platform of ["win32", "darwin", "linux"] as const) {
    expect(resolveCommand("C:\\aha\\fake-pi.mjs", ["--mode", "rpc"], { platform, env: {} })).toEqual({
      command: process.execPath,
      args: ["C:\\aha\\fake-pi.mjs", "--mode", "rpc"],
    });
  }
});

test("outside Windows a bare command is spawned as it is", () => {
  expect(resolveCommand("pi", ["--mode", "rpc"], { platform: "darwin", env: { PATH: bin } })).toEqual({ command: "pi", args: ["--mode", "rpc"] });
});

test("on Windows, npm's pi.cmd on PATH runs the script it points at with this Node", () => {
  mkdirSync(join(bin, "node_modules", "pi", "dist"), { recursive: true });
  writeFileSync(join(bin, "node_modules", "pi", "dist", "cli.js"), "");
  writeFileSync(join(bin, "pi.cmd"), npmShim("node_modules\\pi\\dist\\cli.js"));
  const env = { Path: `C:\\nowhere;${bin}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  expect(resolveCommand("pi", ["-e", "C:\\My Folder\\bridge.ts", "--mode", "rpc"], { platform: "win32", env })).toEqual({
    command: process.execPath,
    args: [join(bin, "node_modules", "pi", "dist", "cli.js"), "-e", "C:\\My Folder\\bridge.ts", "--mode", "rpc"],
  });
});

test("on Windows, another .cmd runs through cmd.exe with every argument quoted", () => {
  writeFileSync(join(bin, "pi.cmd"), "@echo off\r\nnode somewhere.js %*\r\n");
  const resolved = resolveCommand("pi", ["-e", "C:\\My Folder\\bridge.ts"], { platform: "win32", env: { PATH: bin, PATHEXT: ".cmd", ComSpec: "C:\\Windows\\cmd.exe" } });
  expect(resolved).toEqual({
    command: "C:\\Windows\\cmd.exe",
    args: ["/d", "/s", "/c", `""${join(bin, "pi.cmd")}" "-e" "C:\\My Folder\\bridge.ts""`],
    windowsVerbatimArguments: true,
  });
});

test("on Windows, a command that is nowhere stays as it is, so starting it fails as missing", () => {
  expect(resolveCommand("pi", [], { platform: "win32", env: { PATH: bin } })).toEqual({ command: "pi", args: [] });
});
