#!/usr/bin/env node
"use strict";

var http = require("http");
var https = require("https");
var url = require("url");

var HELP = [
  "xapi-doctor ping — check LRS reachability, headers, and version handshake",
  "",
  "Usage: xapi-doctor ping <lrs-url> [--auth user:pass] [--json] [--timeout ms]",
  "",
  "The URL should be the LRS base (e.g. https://lrs.example.com/data/xAPI/).",
  "Checks: DNS, TCP, TLS (for https), X-Experience-API-Version header support,",
  "auth response, CORS preflight visibility.",
  "",
  "Exit codes: 0 reachable + handshakes OK, 1 reachable with warnings, 2 unreachable / fatal.",
].join("\n");

function parseArgs(argv) {
  var out = { positional: [], json: false, timeout: 8000 };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--auth") out.auth = argv[++i];
    else if (a === "--timeout") out.timeout = parseInt(argv[++i], 10) || 8000;
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
      timeout: opts.timeout,
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

function basicAuthHeader(creds) {
  return "Basic " + Buffer.from(creds).toString("base64");
}

async function main() {
  var args = parseArgs(process.argv.slice(2));
  if (args.help || args.positional.length === 0) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }
  var target = args.positional[0];
  if (!/^https?:\/\//i.test(target)) {
    console.error("xapi-doctor ping: URL must start with http:// or https://");
    process.exit(2);
  }

  var findings = [];
  function add(level, id, text) { findings.push({ level: level, id: id, text: text }); }

  var headers = {
    "X-Experience-API-Version": "1.0.3",
    "Accept": "application/json",
  };
  if (args.auth) headers["Authorization"] = basicAuthHeader(args.auth);

  // 1. GET /about — the canonical LRS health endpoint
  var aboutUrl = target.replace(/\/+$/, "") + "/about";
  var about = await request({ url: aboutUrl, method: "GET", headers: { "X-Experience-API-Version": "1.0.3" }, timeout: args.timeout });
  if (!about.ok) {
    add("error", "lrs-unreachable", "could not reach " + aboutUrl + ": " + (about.error || about.code));
  } else {
    if (about.status >= 200 && about.status < 300) {
      add("info", "about-ok", "GET /about → " + about.status);
      try {
        var aboutJson = JSON.parse(about.body);
        if (Array.isArray(aboutJson.version) && aboutJson.version.length > 0) {
          add("info", "about-versions", "LRS supports xAPI: " + aboutJson.version.join(", "));
          if (aboutJson.version.indexOf("1.0.3") < 0) {
            add("warning", "no-1.0.3", "LRS does not advertise 1.0.3 — clients defaulting to that version may be rejected");
          }
        } else {
          add("warning", "about-no-version", "/about response did not include a version array");
        }
      } catch (e) {
        add("warning", "about-not-json", "/about returned a non-JSON body");
      }
    } else if (about.status === 401 || about.status === 403) {
      add("error", "auth-required", "GET /about → " + about.status + " (auth required for /about — unusual; usually anonymous)");
    } else {
      add("error", "about-bad-status", "GET /about → " + about.status);
    }
    // CORS visibility
    var allowOrigin = about.headers["access-control-allow-origin"];
    if (allowOrigin) add("info", "cors-present", "Access-Control-Allow-Origin: " + allowOrigin);
    else add("warning", "cors-missing", "no Access-Control-Allow-Origin header — browser-based clients will fail");
  }

  // 2. HEAD /statements with auth — verify credentials are valid
  if (args.auth && about.ok) {
    var stUrl = target.replace(/\/+$/, "") + "/statements?limit=1";
    var stRes = await request({ url: stUrl, method: "GET", headers: headers, timeout: args.timeout });
    if (!stRes.ok) {
      add("error", "stmt-unreachable", "GET /statements failed: " + (stRes.error || stRes.code));
    } else if (stRes.status === 401) {
      add("error", "auth-bad", "GET /statements → 401 — credentials rejected");
    } else if (stRes.status === 403) {
      add("error", "auth-forbidden", "GET /statements → 403 — credentials valid but lack read scope");
    } else if (stRes.status >= 200 && stRes.status < 300) {
      add("info", "stmt-ok", "GET /statements → " + stRes.status + " — credentials and read scope OK");
      var version = stRes.headers["x-experience-api-version"];
      if (version) add("info", "version-echo", "LRS echoed X-Experience-API-Version: " + version);
      else add("warning", "no-version-echo", "LRS did not echo X-Experience-API-Version — non-compliant with §6.2");
    } else {
      add("warning", "stmt-bad-status", "GET /statements → " + stRes.status);
    }
  } else if (!args.auth && about.ok) {
    add("info", "no-auth", "no --auth supplied; skipping authenticated /statements probe");
  }

  var errors = findings.filter(function (f) { return f.level === "error"; });
  var warnings = findings.filter(function (f) { return f.level === "warning"; });

  if (args.json) {
    console.log(JSON.stringify({ url: target, errors: errors.length, warnings: warnings.length, findings: findings }, null, 2));
  } else {
    console.log("xapi-doctor ping " + target);
    findings.forEach(function (f) {
      var marker = f.level === "error" ? "✗" : (f.level === "warning" ? "!" : "·");
      console.log("  " + marker + " [" + f.level + "] " + f.id + ": " + f.text);
    });
    console.log("");
    console.log("  " + errors.length + " error(s), " + warnings.length + " warning(s)");
  }

  if (errors.length > 0) process.exit(2);
  if (warnings.length > 0) process.exit(1);
  process.exit(0);
}

main();
