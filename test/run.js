"use strict";

// xapi-doctor test suite — zero deps, runs with `node test/run.js`.

var fs = require("fs");
var path = require("path");
var http = require("http");
var { spawnSync, spawn } = require("child_process");

var ROOT = path.resolve(__dirname, "..");
var BIN  = path.resolve(ROOT, "bin/xapi-doctor.js");
var FIX  = path.resolve(ROOT, "fixtures");

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  ✓ " + name); passed++; }
  catch (e) { console.log("  ✗ " + name + "\n      " + (e.stack || e.message)); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

function run(args, input) {
  var res = spawnSync(process.execPath, [BIN].concat(args), {
    input: input,
    encoding: "utf8",
    timeout: 25000,
  });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

// Async equivalent for tests that need the parent event loop to keep running
// (e.g. when the parent is also hosting a mock HTTP server).
function runAsync(args, input) {
  return new Promise(function (resolve) {
    var p = spawn(process.execPath, [BIN].concat(args), { stdio: ["pipe", "pipe", "pipe"] });
    var stdout = "", stderr = "";
    p.stdout.on("data", function (c) { stdout += c.toString("utf8"); });
    p.stderr.on("data", function (c) { stderr += c.toString("utf8"); });
    p.on("close", function (code) { resolve({ status: code, stdout: stdout, stderr: stderr }); });
    if (input) p.stdin.write(input);
    p.stdin.end();
    setTimeout(function () { try { p.kill("SIGKILL"); } catch (e) {} resolve({ status: null, stdout: stdout, stderr: stderr }); }, 25000);
  });
}

console.log("xapi-doctor test suite\n");

// -------- CLI surface --------
test("--help exits 0", function () {
  var r = run(["--help"]);
  assert(r.status === 0, "exit " + r.status);
  assert(/Usage: xapi-doctor/.test(r.stdout));
});

test("unknown command exits 2", function () {
  var r = run(["nope"]);
  assert(r.status === 2);
});

test("--version prints version from package.json", function () {
  var r = run(["--version"]);
  assert(r.status === 0);
  assert(/^xapi-doctor \d+\.\d+\.\d+/.test(r.stdout.trim()));
});

// -------- lint --------
test("lint: --help exits 0", function () {
  var r = run(["lint", "--help"]);
  assert(r.status === 0);
});

test("lint: valid cmi5 statement is clean", function () {
  var r = run(["lint", path.join(FIX, "valid-cmi5-completed.json"), "--profile", "cmi5"]);
  assert(r.status === 0, "exit " + r.status + " stdout=" + r.stdout);
  assert(/clean/.test(r.stdout));
});

test("lint: missing-required fires stmt-actor + stmt-verb + stmt-object", function () {
  var r = run(["lint", path.join(FIX, "missing-required.json")]);
  assert(r.status === 2);
  assert(/stmt-actor-missing/.test(r.stdout), "missing actor finding");
  assert(/stmt-verb-missing/.test(r.stdout), "missing verb finding");
  assert(/stmt-object-missing/.test(r.stdout), "missing object finding");
});

test("lint: multi-IFI actor + non-UUID id + non-IRI object id + bad scaled + bad duration all fire", function () {
  var r = run(["lint", path.join(FIX, "bad-actor-multi-ifi.json")]);
  assert(r.status === 2);
  assert(/actor-multiple-ifi/.test(r.stdout));
  assert(/stmt-id-not-uuid/.test(r.stdout));
  assert(/object-id-not-iri/.test(r.stdout));
  assert(/result-score-range/.test(r.stdout));
  assert(/result-duration-bad/.test(r.stdout));
  assert(/ctx-registration-uuid/.test(r.stdout));
});

test("lint: cmi5 'passed' without moveon category warns", function () {
  var r = run(["lint", path.join(FIX, "cmi5-missing-moveon.json"), "--profile", "cmi5"]);
  // result is warning level (1) — actor.mbox without account is also a cmi5 warn
  assert(r.status === 1 || r.status === 2, "exit " + r.status);
  assert(/cmi5-cat-activity/.test(r.stdout), "missing moveon finding");
  assert(/cmi5-no-account/.test(r.stdout), "mbox-without-account warn");
});

test("lint: batch (array) is parsed and each statement checked", function () {
  var r = run(["lint", path.join(FIX, "batch.json"), "--profile", "cmi5"]);
  assert(/2 statements/.test(r.stdout) || /2 statement/.test(r.stdout));
});

test("lint: --json output is valid JSON with expected shape", function () {
  var r = run(["lint", path.join(FIX, "bad-actor-multi-ifi.json"), "--json"]);
  var parsed = JSON.parse(r.stdout);
  assert(typeof parsed.errors === "number" && parsed.errors > 0);
  assert(Array.isArray(parsed.findings));
  assert(parsed.findings.some(function (f) { return f.id === "actor-multiple-ifi"; }));
});

test("lint: malformed JSON exits 2 with clear error", function () {
  var tmp = path.join(FIX, ".tmp-bad.json");
  fs.writeFileSync(tmp, "{this is not json");
  var r = run(["lint", tmp]);
  fs.unlinkSync(tmp);
  assert(r.status === 2);
  assert(/parse error/i.test(r.stderr) || /parse error/i.test(r.stdout));
});

// -------- ping (against a local mock HTTP server) --------
function startMockLrs(handler) {
  return new Promise(function (resolve) {
    var server = http.createServer(handler);
    server.listen(0, "127.0.0.1", function () {
      var addr = server.address();
      resolve({ server: server, url: "http://127.0.0.1:" + addr.port });
    });
  });
}

// Promise-based async tests
function asyncTest(name, fn) {
  return fn().then(
    function () { console.log("  ✓ " + name); passed++; },
    function (e) { console.log("  ✗ " + name + "\n      " + (e.stack || e.message)); failed++; }
  );
}

async function asyncTests() {
  await asyncTest("ping: valid /about reports versions and credentials work", async function () {
    var mock = await startMockLrs(function (req, res) {
      if (req.url === "/about") {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ version: ["1.0.0", "1.0.3"] }));
      } else if (req.url.indexOf("/statements") === 0) {
        var auth = req.headers["authorization"];
        if (auth !== "Basic " + Buffer.from("user:pass").toString("base64")) {
          res.writeHead(401); res.end(); return;
        }
        res.writeHead(200, { "X-Experience-API-Version": "1.0.3" });
        res.end("[]");
      } else { res.writeHead(404); res.end(); }
    });
    try {
      var r = await runAsync(["ping", mock.url, "--auth", "user:pass"]);
      assert(/about-versions/.test(r.stdout), "no about-versions in: " + r.stdout);
      assert(/stmt-ok/.test(r.stdout), "no stmt-ok in: " + r.stdout);
      assert(r.status === 0 || r.status === 1, "exit " + r.status);
    } finally { mock.server.close(); }
  });

  await asyncTest("ping: 401 on /statements is reported as auth-bad", async function () {
    var mock = await startMockLrs(function (req, res) {
      if (req.url === "/about") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: ["1.0.3"] }));
      } else if (req.url.indexOf("/statements") === 0) {
        res.writeHead(401); res.end();
      } else { res.writeHead(404); res.end(); }
    });
    try {
      var r = await runAsync(["ping", mock.url, "--auth", "wrong:wrong"]);
      assert(/auth-bad/.test(r.stdout), "stdout=" + r.stdout);
      assert(r.status === 2);
    } finally { mock.server.close(); }
  });

  await asyncTest("ping: unreachable host fails fast with lrs-unreachable", async function () {
    var r = await runAsync(["ping", "http://127.0.0.1:1", "--timeout", "1500"]);
    assert(/lrs-unreachable/.test(r.stdout));
    assert(r.status === 2);
  });

  await asyncTest("send: posts batch and parses returned ids", async function () {
    var mock = await startMockLrs(function (req, res) {
      if (req.method === "POST" && req.url.indexOf("/statements") === 0) {
        var body = "";
        req.on("data", function (c) { body += c; });
        req.on("end", function () {
          var stmts = JSON.parse(body);
          var ids = stmts.map(function (s) { return s.id; });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(ids));
        });
      } else { res.writeHead(404); res.end(); }
    });
    try {
      var r = await runAsync(["send", path.join(FIX, "batch.json"), mock.url, "--auth", "u:p"]);
      assert(r.status === 0, "exit " + r.status + " stdout=" + r.stdout);
      assert(/LRS accepted/.test(r.stdout));
      assert(/2 statement/.test(r.stdout));
    } finally { mock.server.close(); }
  });

  await asyncTest("send: lint errors block POST unless --no-validate", async function () {
    var hit = false;
    var mock = await startMockLrs(function (req, res) { hit = true; res.writeHead(200); res.end("[]"); });
    try {
      var r = await runAsync(["send", path.join(FIX, "missing-required.json"), mock.url]);
      assert(r.status === 2);
      assert(/refusing to POST/.test(r.stdout) || /lint found/.test(r.stdout));
      assert(hit === false, "should not have POSTed");
    } finally { mock.server.close(); }
  });

  await asyncTest("send: explains 401 from LRS clearly", async function () {
    var mock = await startMockLrs(function (req, res) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("unauthorized");
    });
    try {
      var r = await runAsync(["send", path.join(FIX, "valid-cmi5-completed.json"), mock.url, "--profile", "cmi5"]);
      assert(r.status === 2);
      assert(/401 Unauthorized/.test(r.stdout), "stdout=" + r.stdout);
    } finally { mock.server.close(); }
  });

  console.log("");
  console.log(passed + " passed, " + failed + " failed (" + (passed + failed) + " total)");
  process.exit(failed === 0 ? 0 : 1);
}

asyncTests();
