import { journey, step } from '@elastic/synthetics';
import { createHash } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DEFAULT_SITE_URL = "https://a0983439343-dot.github.io/WatchTogether";
const DEFAULT_BUG_SERVICE_URL = "https://watchtogether-youtube-proxy-2026.onrender.com";

function clean(value, max = 1800) {
  return String(value == null ? "" : value)
    .replace(/[\\u0000-\\u001f\\u007f]/g, " ")
    .replace(/\\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parseServiceAccount() {
  const raw = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    ""
  ).trim();

  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON 未設定");
  }

  if (raw.startsWith("{")) {
    return JSON.parse(raw);
  }

  return JSON.parse(
    Buffer.from(raw, "base64").toString("utf8")
  );
}

function getFirebaseDatabase() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(parseServiceAccount()),
      databaseURL:
        String(
          process.env.FIREBASE_DATABASE_URL ||
          "https://watchtogether-3f4f9-default-rtdb.asia-southeast1.firebasedatabase.app"
        ).trim()
    });
  }

  return getDatabase();
}

function fingerprint(parts) {
  return createHash("sha256")
    .update(
      parts
        .map(value => clean(value, 1200).toLowerCase())
        .join("\n")
    )
    .digest("hex")
    .slice(0, 48);
}

function categoryFor(name, details) {
  const value = (String(name || "") + " " + String(details || "")).toLowerCase();

  if (/playback|player|video|seek|pause|play/.test(value)) return "playback";
  if (/search|youtube search|query/.test(value)) return "search";
  if (/room|member|control|sync/.test(value)) return "room";
  if (/chat|message/.test(value)) return "chat";
  if (/account|auth|login|logout|profile/.test(value)) return "account";
  if (/ui|button|selector|render|asset|script/.test(value)) return "ui";
  return "other";
}

function parseAiResponse(value) {
  if (!value || typeof value !== "object") return null;
  if (!value.analysis || typeof value.analysis !== "object") return null;

  return {
    aiStatus: clean(value.analysis.status, 60),
    aiConfidence: Math.max(
      0,
      Math.min(1, Number(value.analysis.confidence || 0))
    ),
    aiTitle: clean(value.analysis.title, 220),
    aiSummary: clean(value.analysis.summary, 900),
    aiRootCause: clean(value.analysis.rootCause, 900),
    aiSuggestion: clean(value.analysis.suggestion, 900),
    aiModel: clean(value.model, 120),
    aiCheckedAt: Date.now()
  };
}

async function analyzeWithAi(aiUrl, report, evidence) {
  try {
    const response = await fetch(aiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phase: "detect",
        report,
        evidence,
        current: {
          healthy: false,
          stableChecks: 0,
          autoVerifyEnabled: true
        }
      })
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        aiStatus: "inconclusive",
        aiConfidence: 0,
        aiSummary: clean(json?.error || "AI 分析失敗", 900),
        aiCheckedAt: Date.now()
      };
    }

    return parseAiResponse(json) || {
      aiStatus: "inconclusive",
      aiConfidence: 0,
      aiSummary: "AI 沒有回傳有效分析結果",
      aiCheckedAt: Date.now()
    };
  } catch (error) {
    return {
      aiStatus: "inconclusive",
      aiConfidence: 0,
      aiSummary: clean(error?.message || "AI 請求失敗", 900),
      aiCheckedAt: Date.now()
    };
  }
}

async function saveFinding(finding, context) {
  const db = getFirebaseDatabase();
  const ref = db.ref("reports/" + finding.reportId);
  const now = Date.now();
  const existingSnap = await ref.get();
  const existing = existingSnap.exists() ? existingSnap.val() || {} : {};

  const base = {
    uid: "server-scanner",
    category: finding.category,
    details: clean(finding.details, 2000),
    page: clean(context.siteUrl, 1000),
    userAgent: clean(context.userAgent, 500),
    source: "scanner",
    autoScanner: true,
    autoVerifyEnabled: true,
    verificationState: "monitoring",
    verificationStableChecks: 0,
    fingerprint: finding.fingerprint,
    buildVersion: clean(context.buildVersion, 100),
    firstSeenAt: Number(existing.firstSeenAt || now),
    lastSeenAt: now,
    occurrences: Math.max(1, Number(existing.occurrences || 0) + 1),
    updatedAt: now,
    status: existing.status === "in_progress" ? "in_progress" : "open"
  };

  if (existing.status === "resolved") {
    base.status = "open";
    base.reopenedAt = now;
  }

  if (!existing.createdAt) {
    base.createdAt = now;
  }

  const reportBeforeAi = {
    ...existing,
    ...base
  };

  const ai = await analyzeWithAi(
    context.aiUrl,
    {
      category: base.category,
      details: base.details,
      page: base.page,
      fingerprint: base.fingerprint,
      source: base.source
    },
    context.evidence
  );

  const finalData = {
    ...reportBeforeAi,
    ...ai
  };

  await ref.set(finalData);

  const historyRef = db.ref(
    "reportHistory/" +
    finding.reportId
  ).push();

  await historyRef.set({
    event: existingSnap.exists()
      ? "scanner_repeat"
      : "scanner_created",
    createdAt: now,
    actorUid: "server-scanner",
    actorEmail: "server-scanner@watchtogether.monitor",
    source: "watchdog",
    details: clean(
      existingSnap.exists()
        ? "自主掃描再次發現：" + (ai.aiTitle || finding.details)
        : "自主掃描發現：" + (ai.aiTitle || finding.details),
      500
    )
  });

  return finalData;
}

journey("WatchTogether 24/7 autonomous bug monitor", async ({ page, params, request }) => {
  const siteUrl = String(
    params?.siteUrl ||
    process.env.WATCHTOGETHER_SITE_URL ||
    DEFAULT_SITE_URL
  )
    .trim()
    .replace(/\\/+$ /, "");

  const bugServiceUrl = String(
    params?.bugServiceUrl ||
    process.env.WATCHTOGETHER_BUG_SERVICE_URL ||
    DEFAULT_BUG_SERVICE_URL
  )
    .trim()
    .replace(/\\/+$ /, "");

  const verifyUrl =
    bugServiceUrl.replace(/\\/+$ /, "") +
    "/verify?category=all";

  const aiUrl =
    bugServiceUrl.replace(/\\/+$ /, "") +
    "/ai/analyze";

  const findings = [];
  const browserErrors = [];
  const networkErrors = [];
  const pageStart = Date.now();

  const pushFinding = (name, details) => {
    const category = categoryFor(name, details);
    const normalized = clean(details, 1600);
    const fp = fingerprint([
      "synthetic",
      category,
      name,
      normalized
    ]);

    findings.push({
      reportId: "synthetic-" + fp.slice(0, 24),
      fingerprint: fp,
      category,
      details: clean(name + ": " + normalized, 2000)
    });
  };

  page.on("pageerror", error => {
    const message = clean(error?.message || error || "pageerror", 1200);
    browserErrors.push(message);
  });

  page.on("console", message => {
    if (message.type() !== "error") return;
    const value = clean(message.text(), 1200);

    if (
      /favicon|ResizeObserver|third-party cookie|downloadable font|preload.*not used/i.test(
        value
      )
    ) {
      return;
    }

    browserErrors.push(value);
  });

  page.on("requestfailed", requestItem => {
    const failure = clean(
      requestItem.failure()?.errorText || "request_failed",
      500
    );
    const url = clean(requestItem.url(), 1000);

    if (
      /a0983439343-dot\\.github\\.io|watchtogether-youtube-proxy-2026\\.onrender\\.com|firebasedatabase\\.app/i.test(
        url
      )
    ) {
      networkErrors.push(url + " -> " + failure);
    }
  });

  const evidence = {
    startedAt: pageStart,
    siteUrl,
    browser: "chromium",
    browserErrors,
    networkErrors
  };

  try {
    await step("deployment health check", async () => {
      const response = await request.get(verifyUrl);
      const verify = await response.json();

      if (!response.ok) {
        pushFinding(
          "deployment_verification_http",
          "Verify endpoint 回傳 HTTP " + response.status()
        );
        return;
      }

      evidence.deploymentVerification = verify;

      if (!verify?.ok) {
        const failed = Array.isArray(verify?.failedChecks)
          ? verify.failedChecks
          : Array.isArray(verify?.checks)
            ? verify.checks.filter(item => !item.ok)
            : [];

        if (failed.length) {
          for (const item of failed.slice(0, 10)) {
            pushFinding(
              item?.name || "deployment_check_failed",
              JSON.stringify({
                status: item?.status || 0,
                missing: item?.missing || [],
                forbidden: item?.forbidden || [],
                error: item?.error || ""
              })
            );
          }
        } else {
          pushFinding(
            "deployment_verification",
            "網站部署檢查未通過"
          );
        }
      }
    });

    await step("homepage and critical controls", async () => {
      const response = await page.goto(siteUrl + "/", {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });

      if (!response || !response.ok()) {
        pushFinding(
          "homepage_http",
          "首頁 HTTP " + (response?.status?.() || 0)
        );
        return;
      }

      await page.locator("#createRoomBtn").waitFor({
        state: "visible",
        timeout: 15000
      });

      const selectors = [
        "#createRoomBtn",
        "#joinCodeInput",
        "#joinRoomBtn",
        "#videoSearchInput",
        "#searchVideoBtn",
        "#chatForm",
        "#chatInput",
        "#directVideo"
      ];

      for (const selector of selectors) {
        if (await page.locator(selector).count() === 0) {
          pushFinding(
            "ui_selector",
            "找不到 " + selector
          );
        }
      }

      const title = clean(await page.title(), 220);
      if (!title) {
        pushFinding(
          "page_title",
          "首頁沒有有效 title"
        );
      }

      const versionScripts = await page.locator(
        'script[src*="app.js"],script[src*="enhancements.js"],script[src*="styles.css"],script[src*="bug-monitor.js"]'
      ).evaluateAll(elements =>
        elements.map(element => element.getAttribute("src") || "")
      );

      evidence.assetVersions = versionScripts;
      evidence.buildVersion =
        versionScripts
          .map(src => {
            const match = src.match(/[?&]v=([^&]+)/);
            return match ? match[1] : "";
          })
          .filter(Boolean)
          .sort()[0] || "";
    });

    await step("search interaction", async () => {
      const input = page.locator("#videoSearchInput");
      const button = page.locator("#searchVideoBtn");

      if (
        await input.count() === 0 ||
        await button.count() === 0
      ) {
        return;
      }

      await input.fill("WatchTogether synthetic monitor");
      await button.click();

      await page.waitForTimeout(2500);

      const resultsText = clean(
        await page.locator("#videoSearchResults").innerText().catch(() => ""),
        1600
      );

      const hintText = clean(
        await page.locator("#searchHint").innerText().catch(() => ""),
        600
      );

      evidence.search = {
        resultsText,
        hintText
      };

      if (!resultsText && !hintText) {
        pushFinding(
          "search_interaction",
          "搜尋操作後沒有結果區內容或狀態提示"
        );
      }
    });

    await step("runtime error check", async () => {
      if (browserErrors.length) {
        for (const error of browserErrors.slice(0, 8)) {
          pushFinding(
            "browser_runtime_error",
            error
          );
        }
      }

      if (networkErrors.length) {
        for (const error of networkErrors.slice(0, 8)) {
          pushFinding(
            "network_error",
            error
          );
        }
      }
    });
  } catch (error) {
    pushFinding(
      "synthetic_journey_exception",
      clean(error?.stack || error?.message || error, 1800)
    );
  }

  if (!findings.length) {
    return;
  }

  const context = {
    siteUrl,
    userAgent: await page.evaluate(() => navigator.userAgent).catch(() => "chromium"),
    buildVersion: evidence.buildVersion || "",
    aiUrl,
    evidence: {
      ...evidence,
      browserErrors: browserErrors.slice(0, 12),
      networkErrors: networkErrors.slice(0, 12),
      durationMs: Date.now() - pageStart
    }
  };

  const unique = new Map(
    findings.map(item => [item.reportId, item])
  );

  const stored = [];

  for (const finding of [...unique.values()].slice(0, 12)) {
    try {
      stored.push(await saveFinding(finding, context));
    } catch (error) {
      console.error(
        "[firebase-report]",
        finding.reportId,
        error?.stack || error?.message || error
      );
    }
  }

  if (
    [...unique.values()].length &&
    stored.length === 0
  ) {
    throw new Error(
      "偵測到問題，但 Firebase 回報沒有成功寫入"
    );
  }

  throw new Error(
    "Synthetic monitor detected " +
    String(unique.size) +
    " finding(s)"
  );
});
