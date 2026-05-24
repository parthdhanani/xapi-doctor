#!/usr/bin/env node
"use strict";

var path = require("path");
var { spawnSync } = require("child_process");

var SUBCOMMANDS = {
  lint: "../src/lint.js",
  ping: "../src/ping.js",
  send: "../src/send.js",
};

var HELP = [
  "xapi-doctor — diagnose xAPI statements and LRS connectivity",
  "",
  "Usage: xapi-doctor <command> [args]",
  "",
  "Commands:",
  "  lint <file.json>                  validate xAPI statement(s) against the 1.0.3 spec",
  "                                    (and the cmi5 profile with --profile cmi5)",
  "  ping <lrs-url> [--auth u:p]       check LRS reachability, headers, version handshake",
  "  send <file.json> <lrs-url>        POST statement(s) to the LRS and report the result",
  "                                    [--auth u:p]",
  "",
  "Exit codes: 0 clean, 1 warnings only, 2 errors.",
  "All commands accept --json for CI pipelines.",
].join("\n");

function main(argv) {
  var args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    console.log(HELP);
    process.exit(args.length === 0 ? 2 : 0);
  }
  if (args[0] === "--version" || args[0] === "-v") {
    var pkg = require("../package.json");
    console.log("xapi-doctor " + pkg.version);
    process.exit(0);
  }
  var sub = args.shift();
  var script = SUBCOMMANDS[sub];
  if (!script) {
    console.error("xapi-doctor: unknown command '" + sub + "'");
    console.error("Run `xapi-doctor --help` for the list of commands.");
    process.exit(2);
  }
  var full = path.resolve(__dirname, script);
  var res = spawnSync(process.execPath, [full].concat(args), { stdio: "inherit" });
  process.exit(res.status == null ? 1 : res.status);
}

main(process.argv);
