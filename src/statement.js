"use strict";

// xAPI 1.0.3 statement validation + cmi5 profile checks.
// Spec: https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Data.md
// cmi5 profile constraints: https://aicc.github.io/CMI-5_Spec_Current/

var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})$/;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var IRI_RE  = /^[a-z][a-z0-9+.\-]*:\S+$/i;
var MBOX_RE = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/;
var DURATION_RE = /^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

// cmi5-defined verbs. cmi5 reserves these IRIs and constrains where they appear.
var CMI5_VERBS = {
  "http://adlnet.gov/expapi/verbs/launched":   "Launched",
  "http://adlnet.gov/expapi/verbs/initialized": "Initialized",
  "http://adlnet.gov/expapi/verbs/completed":  "Completed",
  "http://adlnet.gov/expapi/verbs/passed":     "Passed",
  "http://adlnet.gov/expapi/verbs/failed":     "Failed",
  "http://adlnet.gov/expapi/verbs/abandoned":  "Abandoned",
  "http://adlnet.gov/expapi/verbs/waived":     "Waived",
  "http://adlnet.gov/expapi/verbs/terminated": "Terminated",
  "http://adlnet.gov/expapi/verbs/satisfied":  "Satisfied",
};

var RULES = [
  // ---- Statement-level required fields ----
  { id: "stmt-actor-missing",     level: "error",   text: "statement.actor is required" },
  { id: "stmt-verb-missing",      level: "error",   text: "statement.verb is required" },
  { id: "stmt-object-missing",    level: "error",   text: "statement.object is required" },
  { id: "stmt-id-not-uuid",       level: "error",   text: "statement.id must be a UUID (RFC 4122)" },
  { id: "stmt-timestamp-bad",     level: "error",   text: "statement.timestamp must be ISO-8601 with timezone" },
  { id: "stmt-stored-bad",        level: "error",   text: "statement.stored must be ISO-8601 with timezone" },
  { id: "stmt-version-bad",       level: "warning", text: "statement.version must look like 1.0.x" },
  // ---- Actor ----
  { id: "actor-objectType-bad",   level: "error",   text: "actor.objectType, if present, must be Agent or Group" },
  { id: "actor-no-ifi",           level: "error",   text: "actor needs exactly one IFI: mbox, mbox_sha1sum, openid, or account" },
  { id: "actor-multiple-ifi",     level: "error",   text: "actor has more than one IFI — exactly one required" },
  { id: "actor-mbox-bad",         level: "error",   text: "actor.mbox must look like mailto:user@host.tld" },
  { id: "actor-account-bad",      level: "error",   text: "actor.account requires homePage (IRI) and name (string)" },
  { id: "actor-openid-bad",       level: "error",   text: "actor.openid must be an IRI" },
  // ---- Verb ----
  { id: "verb-id-missing",        level: "error",   text: "verb.id is required" },
  { id: "verb-id-not-iri",        level: "error",   text: "verb.id must be an IRI" },
  { id: "verb-display-missing",   level: "warning", text: "verb.display is a strongly-recommended language map" },
  { id: "verb-display-lang",      level: "warning", text: "verb.display should include an 'en' entry — LMSs default to en" },
  // ---- Object (Activity) ----
  { id: "object-id-missing",      level: "error",   text: "object.id is required" },
  { id: "object-id-not-iri",      level: "error",   text: "object.id must be an IRI" },
  { id: "object-objectType-bad",  level: "warning", text: "object.objectType, when set, should be Activity for cmi5/SCORM-style statements" },
  { id: "object-def-type-bad",    level: "error",   text: "object.definition.type must be an IRI when present" },
  // ---- Result ----
  { id: "result-score-range",     level: "error",   text: "result.score.scaled must be in [-1.0, 1.0]; raw must be between min and max" },
  { id: "result-duration-bad",    level: "error",   text: "result.duration must be ISO-8601 duration (e.g. PT4M33S)" },
  // ---- Context ----
  { id: "ctx-registration-uuid",  level: "error",   text: "context.registration must be a UUID" },
  { id: "ctx-revision-on-agent",  level: "error",   text: "context.revision is only valid when object is an Activity" },
  { id: "ctx-platform-on-agent",  level: "error",   text: "context.platform is only valid when object is an Activity" },
  // ---- cmi5 profile ----
  { id: "cmi5-reserved-verb",     level: "warning", text: "cmi5-reserved verb used outside the cmi5 lifecycle (Launched → Initialized → ... → Terminated)" },
  { id: "cmi5-no-registration",   level: "error",   text: "cmi5 statements must carry context.registration (the launch session)" },
  { id: "cmi5-cat-activity",      level: "warning", text: "cmi5 statements must include the 'moveOn' / 'masteryScore' cmi5 category context activity for completion-bearing verbs" },
  { id: "cmi5-no-account",        level: "warning", text: "cmi5 LMSs always use actor.account (not mbox) — mbox here may not match the LMS-assigned actor" },
];

function isIri(s) { return typeof s === "string" && IRI_RE.test(s); }
function isUuid(s) { return typeof s === "string" && UUID_RE.test(s); }
function isIsoDate(s) { return typeof s === "string" && ISO_DATE_RE.test(s); }
function isMbox(s) { return typeof s === "string" && MBOX_RE.test(s); }
function isIsoDuration(s) { return typeof s === "string" && DURATION_RE.test(s); }

function add(findings, id, where, extra) {
  var rule = RULES.find(function (r) { return r.id === id; });
  findings.push({
    id: id,
    level: rule ? rule.level : "error",
    where: where || "",
    text: (rule ? rule.text : id) + (extra ? " — " + extra : ""),
  });
}

function countIfis(actor) {
  var n = 0;
  if (actor.mbox != null) n++;
  if (actor.mbox_sha1sum != null) n++;
  if (actor.openid != null) n++;
  if (actor.account != null) n++;
  return n;
}

function validateActor(actor, where, findings) {
  if (!actor || typeof actor !== "object") { add(findings, "stmt-actor-missing", where); return; }
  if (actor.objectType != null && actor.objectType !== "Agent" && actor.objectType !== "Group") {
    add(findings, "actor-objectType-bad", where, JSON.stringify(actor.objectType));
  }
  var ifis = countIfis(actor);
  if (actor.objectType === "Group" && Array.isArray(actor.member)) {
    // Anonymous group: no IFI required; identified group: 1 IFI. Either is OK.
  } else if (ifis === 0) {
    add(findings, "actor-no-ifi", where);
  } else if (ifis > 1) {
    add(findings, "actor-multiple-ifi", where);
  }
  if (actor.mbox != null && !isMbox(actor.mbox)) add(findings, "actor-mbox-bad", where, actor.mbox);
  if (actor.openid != null && !isIri(actor.openid)) add(findings, "actor-openid-bad", where, actor.openid);
  if (actor.account != null) {
    if (!actor.account.homePage || !isIri(actor.account.homePage) || typeof actor.account.name !== "string") {
      add(findings, "actor-account-bad", where);
    }
  }
}

function validateVerb(verb, where, findings) {
  if (!verb || typeof verb !== "object") { add(findings, "stmt-verb-missing", where); return; }
  if (verb.id == null) add(findings, "verb-id-missing", where);
  else if (!isIri(verb.id)) add(findings, "verb-id-not-iri", where, verb.id);
  if (verb.display == null) add(findings, "verb-display-missing", where);
  else if (typeof verb.display !== "object" || verb.display.en == null) add(findings, "verb-display-lang", where);
}

function validateObject(obj, where, findings) {
  if (!obj || typeof obj !== "object") { add(findings, "stmt-object-missing", where); return; }
  if (obj.objectType != null && obj.objectType !== "Activity" && obj.objectType !== "Agent"
      && obj.objectType !== "Group" && obj.objectType !== "SubStatement" && obj.objectType !== "StatementRef") {
    add(findings, "object-objectType-bad", where, JSON.stringify(obj.objectType));
  }
  if (obj.objectType == null || obj.objectType === "Activity") {
    if (obj.id == null) add(findings, "object-id-missing", where);
    else if (!isIri(obj.id)) add(findings, "object-id-not-iri", where, obj.id);
    if (obj.definition && obj.definition.type != null && !isIri(obj.definition.type)) {
      add(findings, "object-def-type-bad", where, obj.definition.type);
    }
  }
}

function validateResult(result, where, findings) {
  if (!result) return;
  if (result.score) {
    var s = result.score;
    if (s.scaled != null && (typeof s.scaled !== "number" || s.scaled < -1 || s.scaled > 1)) {
      add(findings, "result-score-range", where, "scaled=" + s.scaled);
    }
    if (s.raw != null && s.min != null && s.raw < s.min) add(findings, "result-score-range", where, "raw<" + s.min);
    if (s.raw != null && s.max != null && s.raw > s.max) add(findings, "result-score-range", where, "raw>" + s.max);
  }
  if (result.duration != null && !isIsoDuration(result.duration)) {
    add(findings, "result-duration-bad", where, result.duration);
  }
}

function validateContext(stmt, where, findings) {
  var ctx = stmt.context;
  if (!ctx) return;
  if (ctx.registration != null && !isUuid(ctx.registration)) add(findings, "ctx-registration-uuid", where, ctx.registration);
  var objType = stmt.object && stmt.object.objectType;
  var isAgent = objType === "Agent" || objType === "Group";
  if (isAgent) {
    if (ctx.revision != null) add(findings, "ctx-revision-on-agent", where);
    if (ctx.platform != null) add(findings, "ctx-platform-on-agent", where);
  }
}

function cmi5Checks(stmt, where, findings) {
  var verbId = stmt.verb && stmt.verb.id;
  var isCmi5Verb = verbId != null && Object.prototype.hasOwnProperty.call(CMI5_VERBS, verbId);
  if (!isCmi5Verb) {
    if (stmt.actor && stmt.actor.mbox != null && stmt.actor.account == null) {
      add(findings, "cmi5-no-account", where);
    }
    return;
  }
  if (!stmt.context || stmt.context.registration == null) add(findings, "cmi5-no-registration", where, verbId);
  if (stmt.actor && stmt.actor.mbox != null && stmt.actor.account == null) add(findings, "cmi5-no-account", where);
  // For Passed / Failed / Completed, cmi5 requires the "moveOn" category activity
  if (verbId === "http://adlnet.gov/expapi/verbs/passed"
      || verbId === "http://adlnet.gov/expapi/verbs/failed"
      || verbId === "http://adlnet.gov/expapi/verbs/completed") {
    var cats = stmt.context && stmt.context.contextActivities && stmt.context.contextActivities.category;
    var hasMoveOn = Array.isArray(cats) && cats.some(function (a) {
      return a && typeof a.id === "string" && /https:\/\/w3id\.org\/xapi\/cmi5\/context\/categories\/moveon/i.test(a.id);
    });
    if (!hasMoveOn) add(findings, "cmi5-cat-activity", where, verbId);
  }
}

function validateStatement(stmt, where, opts) {
  var findings = [];
  if (stmt == null || typeof stmt !== "object" || Array.isArray(stmt)) {
    return [{ id: "stmt-not-object", level: "error", where: where, text: "statement must be a JSON object" }];
  }
  if (stmt.id != null && !isUuid(stmt.id)) add(findings, "stmt-id-not-uuid", where, stmt.id);
  if (stmt.timestamp != null && !isIsoDate(stmt.timestamp)) add(findings, "stmt-timestamp-bad", where, stmt.timestamp);
  if (stmt.stored != null && !isIsoDate(stmt.stored)) add(findings, "stmt-stored-bad", where, stmt.stored);
  if (stmt.version != null && !/^1\.0(\.\d+)?$/.test(String(stmt.version))) add(findings, "stmt-version-bad", where, stmt.version);
  validateActor(stmt.actor, where, findings);
  validateVerb(stmt.verb, where, findings);
  validateObject(stmt.object, where, findings);
  validateResult(stmt.result, where, findings);
  validateContext(stmt, where, findings);
  if (opts && opts.profile === "cmi5") cmi5Checks(stmt, where, findings);
  return findings;
}

module.exports = { validateStatement, RULES, CMI5_VERBS };
