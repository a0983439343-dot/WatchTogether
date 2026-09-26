import fs from "node:fs/promises";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {cert, getApps, initializeApp} from "firebase-admin/app";
import {getDatabase} from "firebase-admin/database";

const execFileAsync = promisify(execFile);
const ROOT = process.env.GITHUB_WORKSPACE || process.cwd();
const SITE_URL = String(process.env.WATCHTOGETHER_SITE_URL || "https://a0983439343-dot.github.io/WatchTogether").trim().replace(/\/+$/, "");
const BUG_SERVICE_URL = String(process.env.WATCHTOGETHER_BUG_SERVICE_URL || "https://watchtogether-youtube-proxy-2026.onrender.com").trim().replace(/\/+$/, "");
const FIREBASE_DATABASE_URL = String(process.env.FIREBASE_DATABASE_URL || "https://watchtogether-3f4f9-default-rtdb.asia-southeast1.firebasedatabase.app").trim();
const REPOSITORY = String(process.env.GITHUB_REPOSITORY || "").trim();
const MAX_REPORTS = Math.max(
  1,
  Math.min(5, Number(process.env.AUTONOMOUS_REPAIR_MAX_REPORTS || 3))
);
const MAX_ATTEMPTS = 3;
const MIN_AUTO_CONFIDENCE = 0.82;
const MIN_REPAIR_CONFIDENCE = 0.86;
const STABLE_CHECK_GAP_MS = 20_000;
const DEPLOY_WAIT_MS = 8 * 60_000;
const MAX_BATCH_DURATION_MS = 50 * 60_000;

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON 未設定");
if (!REPOSITORY) throw new Error("GITHUB_REPOSITORY 未設定");

function firebaseCredential() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (raw.startsWith("{")) return JSON.parse(raw);
  return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
}

function db() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(firebaseCredential()),
      databaseURL: FIREBASE_DATABASE_URL
    });
  }
  return getDatabase();
}

function clean(value, max = 1800) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .slice(0, max);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeCategory(value) {
  const allowed = new Set(["playback","search","room","chat","account","ui","other"]);
  return allowed.has(String(value || "").trim().toLowerCase())
    ? String(value).trim().toLowerCase()
    : "other";
}

function allowedPaths(category) {
  const base = new Set([
    "index.html",
    "src/js/app.js",
    "src/js/enhancements.js",
    "src/js/bug-monitor.js",
    "sw.js",
    "admin/admin.js",
    "admin/admin.html",
    "admin/admin.css"
  ]);
  if (category === "room" || category === "account") base.add("config/database.rules.json");
  if (category === "playback" || category === "search") base.add("youtube-proxy/server.js");
  return base;
}

function publicPath(file) {
  return file
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

async function readRepoFile(file) {
  const full = path.join(ROOT, file);
  const value = await fs.readFile(full, "utf8");
  if (value.length > 180000) throw new Error("檔案過大，拒絕自動修復：" + file);
  return value;
}

async function git(args) {
  const {stdout} = await execFileAsync("git", args, {cwd: ROOT, maxBuffer: 2_000_000});
  return String(stdout || "").trim();
}

async function writeHistory(database, reportId, event, details) {
  await database.ref("reportHistoryEvents/" + reportId).push({
    reportId: String(reportId).slice(0, 128),
    event,
    createdAt: Date.now(),
    actorUid: "autonomous-repair",
    actorEmail: "watchtogether-autorepair@github-actions",
    source: "autonomous_repair",
    details: clean(details, 700)
  });
}

async function updateReport(database, reportId, updates) {
  await database.ref("reports/" + reportId).update(updates);
}

async function acquireLock(database) {
  const ref = database.ref("system/autonomousRepairLock");
  const owner = randomUUID();
  const now = Date.now();
  const expiresAt = now + 65 * 60_000;
  let committed = false;
  const result = await ref.transaction(current => {
    if (current && Number(current.expiresAt || 0) > now) return;
    committed = true;
    return {owner, startedAt: now, expiresAt};
  });
  if (!result.committed || !committed) return null;
  return {ref, owner};
}

async function releaseLock(lock) {
  if (!lock) return;
  try {
    await lock.ref.transaction(current => {
      if (current && current.owner === lock.owner) return null;
      return current;
    });
  } catch (_) {}
}

function candidateReports(reports) {
  const seenFingerprints = new Set();

  return Object.entries(reports || {})
    .filter(([, report]) => {
      if (!report || typeof report !== "object") return false;
      if (report.autoVerifyEnabled !== true) return false;
      const status = String(report.status || "open");
      if (status === "resolved") return false;
      const attempts = Number(report.repairAttempts || 0);
      if (attempts >= MAX_ATTEMPTS) return false;
      const requested = Number(report.repairRequestedAt || 0) > 0;
      const aiConfirmed = ["confirmed","still_present"].includes(String(report.aiStatus || ""));
      const confidence = Number(report.aiConfidence || 0);
      if (!requested && (!aiConfirmed || confidence < MIN_AUTO_CONFIDENCE)) return false;
      const lastAttempt = Number(report.repairLastAttemptAt || 0);
      if (lastAttempt && Date.now() - lastAttempt < 15 * 60_000) return false;

      const fingerprint = String(report.fingerprint || "").trim();
      if (fingerprint) {
        if (seenFingerprints.has(fingerprint)) return false;
        seenFingerprints.add(fingerprint);
      }

      return true;
    })
    .sort((a,b) => {
      const ar = Number(a[1]?.repairRequestedAt || 0) > 0 ? 1 : 0;
      const br = Number(b[1]?.repairRequestedAt || 0) > 0 ? 1 : 0;
      if (ar !== br) return br - ar;

      const ac = Number(a[1]?.aiConfidence || 0);
      const bc = Number(b[1]?.aiConfidence || 0);
      if (ac !== bc) return bc - ac;

      const ao = Number(a[1]?.occurrences || 0);
      const bo = Number(b[1]?.occurrences || 0);
      if (ao !== bo) return bo - ao;

      const al = Number(a[1]?.lastSeenAt || a[1]?.createdAt || 0);
      const bl = Number(b[1]?.lastSeenAt || b[1]?.createdAt || 0);
      return bl - al;
    })
    .slice(0, MAX_REPORTS);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 30_000));
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
    const json = await response.json().catch(() => ({}));
    return {ok: response.ok, status: response.status, json};
  } finally {
    clearTimeout(timer);
  }
}

async function verify(category) {
  return await fetchJson(BUG_SERVICE_URL + "/verify?category=" + encodeURIComponent(category), {timeoutMs: 30_000});
}

async function requestRepair(report, verification, files) {
  const payload = {
    phase: "repair",
    report: {
      category: normalizeCategory(report.category),
      details: clean(report.details, 2400),
      fingerprint: clean(report.fingerprint, 120),
      buildVersion: clean(report.buildVersion, 120),
      source: clean(report.source || "manual", 60),
      occurrences: Number(report.occurrences || 1) || 1,
      createdAt: Number(report.createdAt || 0)
    },
    evidence: {
      deployment: verification?.json || verification || {},
      repairRequested: Boolean(report.repairRequestedAt),
      previousAi: {
        status: clean(report.aiStatus, 60),
        confidence: Number(report.aiConfidence || 0),
        title: clean(report.aiTitle, 300),
        summary: clean(report.aiSummary, 1200),
        rootCause: clean(report.aiRootCause, 1200),
        suggestion: clean(report.aiSuggestion, 1200)
      }
    },
    current: {
      repository: REPOSITORY,
      branch: "main",
      files
    }
  };
  const result = await fetchJson(BUG_SERVICE_URL + "/ai/analyze", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
    timeoutMs: 60_000
  });
  if (!result.ok || !result.json?.ok || !result.json?.analysis) {
    throw new Error(clean(result.json?.error || "AI 自動修復分析失敗", 900));
  }
  return {
    ...result.json.analysis,
    model: result.json.model || ""
  };
}

function normalizePatch(patch, allow) {
  const file = String(patch?.path || "").trim().replace(/^\//, "");
  const find = String(patch?.find || "");
  const replace = String(patch?.replace || "");
  const reason = clean(patch?.reason, 700);
  if (!allow.has(file)) throw new Error("AI 嘗試修改未允許檔案：" + file);
  if (!find || find.length < 8) throw new Error("AI patch 的 find 太短：" + file);
  if (find.length > 24_000 || replace.length > 24_000) throw new Error("AI patch 過大：" + file);
  if (/\.github\/|package\.json|package-lock\.json|node_modules|\.env|credentials|secret/i.test(file)) {
    throw new Error("AI patch 命中禁止檔案：" + file);
  }
  return {file, find, replace, reason};
}

async function applyPatches(patches, allow) {
  const changed = new Map();
  const original = new Map();
  const normalized = patches.map(patch => normalizePatch(patch, allow));
  if (!normalized.length || normalized.length > 8) throw new Error("AI 沒有提供有效 patch 或 patch 數量過多");

  for (const patch of normalized) {
    const before = changed.has(patch.file) ? changed.get(patch.file) : await readRepoFile(patch.file);
    if (!original.has(patch.file)) original.set(patch.file, before);
    const count = before.split(patch.find).length - 1;
    if (count !== 1) throw new Error("find 無法唯一匹配：" + patch.file + "，匹配數：" + count);
    const after = before.replace(patch.find, patch.replace);
    if (after === before) throw new Error("patch 沒有產生變更：" + patch.file);
    if (after.length > 220000) throw new Error("修復後檔案過大：" + patch.file);
    changed.set(patch.file, after);
  }

  if (changed.has("config/database.rules.json")) {
    const before = JSON.parse(original.get("config/database.rules.json"));
    const after = JSON.parse(changed.get("config/database.rules.json"));
    if (after?.rules?.[".read"] === true || after?.rules?.[".write"] === true) {
      throw new Error("拒絕自動開放 Firebase 根節點公開讀寫");
    }
    if (after?.rules?.["reports"]?.[".write"] === true && before?.rules?.["reports"]?.[".write"] !== true) {
      throw new Error("拒絕自動將 reports 設為公開寫入");
    }
  }

  for (const [file, content] of changed) {
    await fs.writeFile(path.join(ROOT, file), content, "utf8");
  }

  return {changed, normalized, original};
}

async function validateChangedFiles(changed) {
  for (const file of changed.keys()) {
    if (/\.js$/i.test(file)) {
      await execFileAsync(process.execPath, ["--check", path.join(ROOT, file)], {cwd: ROOT, maxBuffer: 1_000_000});
    }
    if (file === "config/database.rules.json") {
      JSON.parse(await fs.readFile(path.join(ROOT, file), "utf8"));
    }
  }

  if (changed.has("index.html") || changed.has("src/js/app.js") || changed.has("src/js/enhancements.js") || changed.has("sw.js")) {
    const index = await readRepoFile("index.html");
    const sw = await readRepoFile("sw.js");
    const app = await readRepoFile("src/js/app.js");
    const enh = await readRepoFile("src/js/enhancements.js");

    const appVersion = index.match(/app\.js\?v=([^"'&]+)/)?.[1];
    const enhVersion = index.match(/enhancements\.js\?v=([^"'&]+)/)?.[1];
    const cssVersion = index.match(/enhancements\.css\?v=([^"'&]+)/)?.[1];
    const stylesVersion = index.match(/styles\.css\?v=([^"'&]+)/)?.[1];
    const swVersion = index.match(/sw\.js\?v=([^"'&]+)/)?.[1];
    const cacheVersion = sw.match(/wt-shell-(\d{8}-v[^"\s]+)/)?.[1];

    if (!appVersion || appVersion !== enhVersion || appVersion !== cssVersion || appVersion !== stylesVersion || appVersion !== swVersion) {
      throw new Error("前端資產版本未同步");
    }
    if (cacheVersion !== appVersion.replace("formal-", "")) {
      throw new Error("Service Worker cache version 未同步");
    }

    if (!app.includes("buildYoutubeNativePlayer") || !app.includes("createYoutubeNativePlayer")) {
      throw new Error("Native YouTube playback adapter missing");
    }
    if (/new\s+YT\.Player|youtube\.com\/iframe_api|loadYoutubeIframeApi|createYoutubeIframePlayer/.test(app)) {
      throw new Error("Legacy YouTube IFrame path detected");
    }
    if (!app.includes("requestPlaybackControl(") || !app.includes("attachPlaybackControlRequestListener(")) {
      throw new Error("Synchronized room control architecture missing");
    }
    if (/AIza[0-9A-Za-z_-]{20,}/.test(app)) {
      throw new Error("Possible exposed Google API key detected");
    }
  }

  if (changed.has("config/database.rules.json")) {
    const test = await execFileAsync("npm", ["run", "test:rules"], {
      cwd: ROOT,
      maxBuffer: 2_000_000
    });
    return String(test.stdout || "").slice(-5000);
  }

  return "validation passed";
}

async function restoreChanged(changed) {
  for (const file of changed.keys()) {
    try {
      await execFileAsync("git", ["checkout", "--", file], {cwd: ROOT});
    } catch (_) {}
  }
}

async function commitAndPush(changedFiles) {
  const name = "WatchTogether Autonomous Repair";
  const email = "watchtogether-autorepair@users.noreply.github.com";
  await git(["config", "user.name", name]);
  await git(["config", "user.email", email]);
  await execFileAsync("git", ["add", "--", ...changedFiles], {cwd: ROOT});
  await git(["diff", "--cached", "--check"]);
  const staged = await git(["diff", "--cached", "--name-only"]);
  if (!staged) throw new Error("沒有可提交的修復變更");
  const commitMessage = "fix: autonomous repair";
  const commitSha = await git(["commit", "-m", commitMessage]);
  await execFileAsync("git", ["push", "origin", "HEAD:main"], {cwd: ROOT, maxBuffer: 2_000_000});
  const sha = await git(["rev-parse", "HEAD"]);
  return {commitSha: String(commitSha || "").slice(-80), sha, files: staged.split(/\r?\n/).filter(Boolean)};
}

async function publicFileHash(file) {
  const url = SITE_URL + "/" + publicPath(file);
  try {
    const response = await fetch(url, {cache: "no-store", redirect: "follow"});
    if (!response.ok) return null;
    const text = await response.text();
    return sha256(text);
  } catch (_) {
    return null;
  }
}

async function waitForFrontendDeployment(changed) {
  const expected = [];
  for (const [file, content] of changed) {
    if (file === "youtube-proxy/server.js") continue;
    expected.push([file, sha256(content)]);
  }
  if (!expected.length) {
    await sleep(90_000);
    return true;
  }

  const deadline = Date.now() + DEPLOY_WAIT_MS;
  while (Date.now() < deadline) {
    let all = true;
    for (const [file, hash] of expected) {
      const actual = await publicFileHash(file);
      if (actual !== hash) {
        all = false;
        break;
      }
    }
    if (all) return true;
    await sleep(30_000);
  }
  return false;
}

async function firebaseRulesCredentialsFile() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON 未設定");
  const credentials = raw.startsWith("{")
    ? JSON.parse(raw)
    : JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  const file = path.join("/tmp", "watchtogether-firebase-service-account.json");
  await fs.writeFile(file, JSON.stringify(credentials), {encoding:"utf8", mode:0o600});
  return file;
}

async function deployFirebaseRules() {
  const credentialsFile = await firebaseRulesCredentialsFile();
  const firebaseBin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "firebase.cmd" : "firebase"
  );
  try {
    const result = await execFileAsync(
      firebaseBin,
      ["deploy", "--only", "database", "--project", "watchtogether-3f4f9", "--json"],
      {
        cwd: ROOT,
        env: {...process.env, GOOGLE_APPLICATION_CREDENTIALS: credentialsFile},
        maxBuffer: 2_000_000
      }
    );
    return String(result.stdout || "").slice(-4000);
  } finally {
    await fs.rm(credentialsFile, {force:true}).catch(() => {});
  }
}

async function stableRecheck(report, category, changed, commitSha) {
  const first = await verify(category);
  if (!first.ok || !first.json?.ok) return {ok:false, verification:first.json || first};
  if (!(await waitForFrontendDeployment(changed))) {
    return {ok:false, verification:{ok:false, reason:"frontend_deploy_timeout"}};
  }
  await sleep(STABLE_CHECK_GAP_MS);
  const second = await verify(category);
  if (!second.ok || !second.json?.ok) return {ok:false, verification:second.json || second};

  const aiPayload = {
    phase: "recheck",
    report: {
      category,
      details: clean(report.details, 2400),
      fingerprint: clean(report.fingerprint, 120),
      buildVersion: clean(report.buildVersion, 120),
      source: clean(report.source || "manual", 60),
      occurrences: Number(report.occurrences || 1) || 1,
      createdAt: Number(report.createdAt || 0)
    },
    evidence: {
      deployment: second.json,
      changedFiles: [...changed.keys()],
      commitSha,
      stableChecks: 2
    },
    current: {
      healthy: true,
      stableChecks: 2,
      autoVerifyEnabled: true
    }
  };
  const ai = await fetchJson(BUG_SERVICE_URL + "/ai/analyze", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(aiPayload),
    timeoutMs: 60_000
  });
  return {
    ok: Boolean(ai.ok && ai.json?.ok && ai.json?.analysis),
    verification: second.json,
    analysis: ai.json?.analysis || null,
    model: ai.json?.model || ""
  };
}

async function revertCommit(sha) {
  try {
    await git(["revert", "--no-edit", sha]);
    await execFileAsync("git", ["push", "origin", "HEAD:main"], {cwd: ROOT, maxBuffer: 2_000_000});
    return true;
  } catch (error) {
    console.error("自動回滾失敗", error?.stderr || error?.message || error);
    return false;
  }
}

async function repairOne(database, reportId, report, batchId, batchPosition, batchTotal) {
  const category = normalizeCategory(report.category);
  const allow = allowedPaths(category);
  const beforeVerification = await verify(category);
  if (!beforeVerification.json) throw new Error("驗證服務無回應");

  await updateReport(database, reportId, {
    status: "in_progress",
    repairState: "analyzing",
    repairBatchId: batchId,
    repairBatchPosition: batchPosition,
    repairBatchTotal: batchTotal,
    repairAttempts: Number(report.repairAttempts || 0) + 1,
    repairLastAttemptAt: Date.now(),
    repairStartedAt: Date.now(),
    repairActor: "github-actions-autorepair"
  });
  await writeHistory(
    database,
    reportId,
    "repair_started",
    "自動修復引擎開始分析 · 批次 " + batchPosition + "/" + batchTotal + " · " + batchId
  );

  const files = {};
  for (const file of allow) {
    files[file] = await readRepoFile(file);
  }

  const repair = await requestRepair(report, beforeVerification, files);
  await updateReport(database, reportId, {
    repairState: repair.repairStatus === "repairable" ? "patch_proposed" : "not_repairable",
    repairConfidence: Number(repair.confidence || 0),
    repairSummary: clean(repair.summary, 1400),
    repairModel: clean(repair.model || "", 120),
    repairCheckedAt: Date.now()
  });

  if (repair.repairStatus !== "repairable" || Number(repair.confidence || 0) < MIN_REPAIR_CONFIDENCE || !Array.isArray(repair.patches) || !repair.patches.length) {
    await writeHistory(database, reportId, "repair_not_applied", "AI 判定目前無法安全自動修復");
    return false;
  }

  const applied = await applyPatches(repair.patches, allow);
  try {
    await validateChangedFiles(applied.changed);
  } catch (error) {
    await restoreChanged(applied.changed);
    await updateReport(database, reportId, {
      repairState: "validation_failed",
      repairError: clean(error?.stderr || error?.message || error, 1200),
      repairFinishedAt: Date.now()
    });
    await writeHistory(database, reportId, "repair_validation_failed", clean(error?.stderr || error?.message || error, 700));
    return false;
  }

  const commit = await commitAndPush([...applied.changed.keys()]);
  if (applied.changed.has("config/database.rules.json")) {
    try {
      await deployFirebaseRules();
      await writeHistory(database, reportId, "firebase_rules_deployed", "Firebase Rules 已通過測試並自動部署");
    } catch (error) {
      const reverted = await revertCommit(commit.sha);
      if (reverted) {
        await deployFirebaseRules().catch(() => {});
      }
      await updateReport(database, reportId, {
        status: "in_progress",
        repairState: reverted ? "firebase_deploy_failed_reverted" : "firebase_deploy_failed_rollback_failed",
        repairError: clean(error?.stderr || error?.message || error, 1200),
        repairFinishedAt: Date.now()
      });
      await writeHistory(database, reportId, reverted ? "firebase_deploy_failed" : "firebase_deploy_rollback_failed", reverted ? "Firebase Rules 部署失敗，程式碼已自動回滾" : "Firebase Rules 部署失敗且自動回滾失敗");
      return false;
    }
  }
  await updateReport(database, reportId, {
    repairState: "committed",
    repairCommit: commit.sha,
    repairFiles: commit.files,
    repairFinishedAt: Date.now()
  });
  await writeHistory(database, reportId, "repair_committed", "自動修復已提交：" + commit.sha);

  const recheck = await stableRecheck(report, category, applied.changed, commit.sha);
  if (recheck.ok && recheck.analysis?.status === "resolved_candidate" && Number(recheck.analysis?.confidence || 0) >= 0.75) {
    await updateReport(database, reportId, {
      status: "resolved",
      autoResolvedAt: Date.now(),
      autoResolveReason: "自動修復後連續穩定檢查通過，AI 確認 resolved_candidate",
      verificationState: "approved",
      verificationStableChecks: 2,
      verification: {
        state: "approved",
        approved: true,
        checkedAt: Date.now(),
        deterministicPassed: true,
        stableChecks: 2,
        deploymentChecks: Array.isArray(recheck.verification?.checks) ? recheck.verification.checks : [],
        mode: "autonomous_repair"
      },
      aiStatus: "resolved_candidate",
      aiConfidence: Number(recheck.analysis.confidence || 0),
      aiTitle: clean(recheck.analysis.title, 220),
      aiSummary: clean(recheck.analysis.summary, 900),
      aiRootCause: clean(recheck.analysis.rootCause, 900),
      aiSuggestion: clean(recheck.analysis.suggestion, 900),
      aiModel: clean(recheck.model, 120),
      aiCheckedAt: Date.now()
    });
    await writeHistory(database, reportId, "repair_verified", "修復後連續 2 次驗證通過，AI 確認可結案");
    return true;
  }

  const reverted = await revertCommit(commit.sha);
  if (reverted && applied.changed.has("config/database.rules.json")) {
    await deployFirebaseRules().catch(() => {});
  }
  await updateReport(database, reportId, {
    status: "in_progress",
    repairState: reverted ? "reverted_after_failed_recheck" : "recheck_failed_rollback_failed",
    repairError: clean(recheck.analysis?.summary || recheck.verification?.reason || "修復後驗證未通過", 1200),
    verificationState: "failed",
    verificationStableChecks: 0,
    repairFinishedAt: Date.now()
  });
  await writeHistory(database, reportId, reverted ? "repair_reverted" : "repair_rollback_failed", reverted ? "修復後驗證未通過，已自動回滾" : "修復後驗證未通過，但自動回滾失敗");
  return false;
}

async function main() {
  const database = db();
  const batchId = randomUUID();
  const batchStartedAt = Date.now();
  const lock = await acquireLock(database);
  if (!lock) {
    console.log("已有其他自動修復工作執行中");
    return;
  }

  try {
    const snapshot = await database.ref("reports").once("value");
    const reports = snapshot.val() || {};
    const candidates = candidateReports(reports);
    console.log(
      "自動修復批次 " + batchId + " · 候選 " + candidates.length + " · 上限 " + MAX_REPORTS
    );

    for (let index = 0; index < candidates.length; index += 1) {
      if (Date.now() - batchStartedAt >= MAX_BATCH_DURATION_MS) {
        console.log("已達批次時間上限，剩餘問題留待下一輪：" + (candidates.length - index));
        for (const [remainingId] of candidates.slice(index)) {
          await writeHistory(
            database,
            remainingId,
            "repair_deferred",
            "本批次已達時間上限，留待下一輪自動修復 · 批次 " + batchId
          ).catch(() => {});
        }
        break;
      }

      const [id, report] = candidates[index];
      const position = index + 1;
      try {
        const resolved = await repairOne(
          database,
          id,
          report,
          batchId,
          position,
          candidates.length
        );
        console.log(
          "批次 " + position + "/" + candidates.length + " · " + id + " · " +
          (resolved ? "resolved" : "not_resolved")
        );
      } catch (error) {
        console.error("repair", id, error?.stack || error?.message || error);
        await updateReport(database, id, {
          repairState: "failed",
          repairError: clean(error?.message || error, 1200),
          repairFinishedAt: Date.now()
        }).catch(() => {});
        await writeHistory(
          database,
          id,
          "repair_failed",
          "批次 " + position + "/" + candidates.length + " · " +
          clean(error?.message || error, 700)
        ).catch(() => {});
      }
    }

    console.log(
      "自動修復批次完成 · " + batchId + " · 耗時 " +
      Math.round((Date.now() - batchStartedAt) / 1000) + " 秒"
    );
  } finally {
    await releaseLock(lock);
  }
}

await main();
