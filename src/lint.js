#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var { validateStatement } = require("./statement.js");

var HELP = [
  "xapi-doctor lint — validate xAPI statement(s)",
  "",
  "Usage: xapi-doctor lint <file.json> [--profile cmi5] [--json]",
  "",
  "Input may be a single statement object or a JSON array of statements.",
  "Exit codes: 0 clean, 1 warnings only, 2 errors (or parse failure).",
].join("\n");

function parseArgs(argv) {
  var out = { positional: [], json: false, profile: null };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--profile") out.profile = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
    else out.positional.push(a);
  }
  return out;
}

function main() {
  var args = parseArgs(process.argv.slice(2));
  if (args.help || args.positional.length === 0) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }
  var file = args.positional[0];
  var raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (e) { console.error("xapi-doctor lint: cannot read " + file + ": " + e.message); process.exit(2); }

  var data;
  try { data = JSON.parse(raw); }
  catch (e) {
    if (args.json) {
      console.log(JSON.stringify({ file: file, parseError: e.message, errors: 1, warnings: 0, findings: [] }));
    } else {
      console.error("xapi-doctor lint: JSON parse error in " + file);
      console.error("  " + e.message);
    }
    process.exit(2);
  }

  var statements = Array.isArray(data) ? data : [data];
  var allFindings = [];
  for (var i = 0; i < statements.length; i++) {
    var where = "statement[" + i + "]";
    var f = validateStatement(statements[i], where, { profile: args.profile });
    allFindings = allFindings.concat(f);
  }

  var errors = allFindings.filter(function (f) { return f.level === "error"; });
  var warnings = allFindings.filter(function (f) { return f.level === "warning"; });

  if (args.json) {
    console.log(JSON.stringify({
      file: path.resolve(file),
      profile: args.profile,
      statements: statements.length,
      errors: errors.length,
      warnings: warnings.length,
      findings: allFindings,
    }, null, 2));
  } else {
    console.log("xapi-doctor lint " + path.relative(process.cwd(), file)
      + (args.profile ? "  (profile: " + args.profile + ")" : "")
      + "  — " + statements.length + " statement" + (statements.length === 1 ? "" : "s"));
    if (allFindings.length === 0) {
      console.log("  ✓ clean");
    } else {
      allFindings.forEach(function (f) {
        var marker = f.level === "error" ? "✗" : "!";
        console.log("  " + marker + " [" + f.level + "] " + f.where + "  " + f.id + ": " + f.text);
      });
    }
    console.log("");
    console.log("  " + errors.length + " error(s), " + warnings.length + " warning(s)");
  }

  if (errors.length > 0) process.exit(2);
  if (warnings.length > 0) process.exit(1);
  process.exit(0);
}

main();
