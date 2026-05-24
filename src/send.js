#!/usr/bin/env node
"use strict";

var fs = require("fs");
var http = require("http");
var https = require("https");
var url = require("url");
var { validateStatement } = require("./statement.js");

var HELP = [
  "xapi-doctor send — POST xAPI statement(s) to an LRS and report",
  "",
  "Usage: xapi-doctor send <file.json> <lrs-url> [--auth user:pass] [--profile cmi5]",
  "                       [--json] [--no-validate]",
  "",
  "By default, statements are validated locally before POST. --no-validate skips the lint pass.",
  "Exit codes: 0 LRS accepted, 1 partial / warnings, 2 lint failure or LRS rejection.",
].join("\n");

function parseArgs(argv) {
  var out = { positional: [], json: false, validate: true };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--auth") out.auth = argv[++i];
    else if (a === "--profile") out.profile = argv[++i];
    else if (a === "--no-validate") out.validate = false;
    else if (a === "-h" || a === "--help") out.help = true;
    else out.positional.push(a);
  }
  return out;
}

function request(opts, body) {
  return new Promise(function (resolve) {
    var u = url.parse(opts.url);
    var lib = u.protocol === "https:" ? https : http;
    var req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.path,
      method: opts.method,
      headers: opts.headers,
      timeout: opts.timeout || 10000,
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        resolve({ ok: true, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", function (e) { resolve({ ok: false, error: e.message, code: e.code }); });
    req.on("timeout", function () { req.destroy(); resolve({ ok: false, error: "timeout", code: "ETIMEDOUT" }); });
    if (body) req.write(body);
    req.end();
  });
}

function basicAuthHeader(creds) { return "Basic " + Buffer.from(creds).toString("base64"); }

function explainStatus(s, body) {
  if (s === 400) return "400 Bad Request — malformed statement; LRS returned: " + body.slice(0, 240);
  if (s === 401) return "401 Unauthorized — missing or wrong credentials";
  if (s === 403) return "403 Forbidden — credentials lack write scope on /statements";
  if (s === 404) return "404 Not Found — wrong LRS URL? Should end at /xAPI/ (or equivalent)";
  if (s === 409) return "409 Conflict — statement with this id already stored with different content (xAPI §7.2.2)";
  if (s === 413) return "413 Payload Too Large — batch too big for LRS; split into smaller batches";
  if (s === 415) return "415 Unsupported Media Type — Content-Type must be application/json";
  if (s >= 500) return s + " — LRS internal error; check LRS-side logs";
  return s + " — unexpected status";
}

async function main() {
  var args = parseArgs(process.argv.slice(2));
  if (args.help || args.positional.length < 2) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }
  var file = args.positional[0];
  var target = args.positional[1];
  if (!/^https?:\/\//i.test(target)) {
    console.error("xapi-doctor send: URL must start with http:// or https://");
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error("xapi-doctor send: file not found: " + file);
    process.exit(2);
  }
  var data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error("xapi-doctor send: JSON parse error: " + e.message); process.exit(2); }
  var statements = Array.isArray(data) ? data : [data];

  if (args.validate) {
    var lintFindings = [];
    for (var i = 0; i < statements.length; i++) {
      var f = validateStatement(statements[i], "statement[" + i + "]", { profile: args.profile });
      lintFindings = lintFindings.concat(f);
    }
    var lintErrors = lintFindings.filter(function (f) { return f.level === "error"; });
    if (lintErrors.length > 0) {
      if (args.json) {
        console.log(JSON.stringify({ phase: "lint", errors: lintErrors.length, findings: lintFindings }, null, 2));
      } else {
        console.log("xapi-doctor send: refusing to POST; lint found " + lintErrors.length + " error(s):");
        lintErrors.forEach(function (f) { console.log("  ✗ " + f.where + "  " + f.id + ": " + f.text); });
        console.log("  (use --no-validate to override)");
      }
      process.exit(2);
    }
  }

  var headers = {
    "Content-Type": "application/json",
    "X-Experience-API-Version": "1.0.3",
  };
  if (args.auth) headers["Authorization"] = basicAuthHeader(args.auth);

  var endpoint = target.replace(/\/+$/, "") + "/statements";
  var body = JSON.stringify(statements);
  var res = await request({ url: endpoint, method: "POST", headers: headers }, body);

  if (!res.ok) {
    if (args.json) console.log(JSON.stringify({ phase: "post", error: res.error, code: res.code }));
    else console.log("xapi-doctor send: network error — " + res.error);
    process.exit(2);
  }

  if (args.json) {
    var out = { phase: "post", url: endpoint, status: res.status, statements: statements.length, body: res.body };
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log("xapi-doctor send → " + endpoint);
    console.log("  " + statements.length + " statement(s) posted; status " + res.status);
    if (res.status >= 200 && res.status < 300) {
      console.log("  ✓ LRS accepted");
      try {
        var ids = JSON.parse(res.body);
        if (Array.isArray(ids)) console.log("  assigned ids: " + ids.slice(0, 3).join(", ") + (ids.length > 3 ? " …" : ""));
      } catch (e) { /* not JSON, that's fine */ }
    } else {
      console.log("  ✗ " + explainStatus(res.status, res.body || ""));
    }
  }

  if (res.status >= 200 && res.status < 300) process.exit(0);
  process.exit(2);
}

main();
