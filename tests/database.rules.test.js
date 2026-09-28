const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require("@firebase/rules-unit-testing");

const RULES = fs.readFileSync("config/database.rules.json", "utf8");

const MASTER_UID = "35d45a23-b648-4caf-a6d5-a69112860551";
const MASTER_EMAIL = "a0983439343@gmail.com";

const ADMIN_UID = "test-admin";
const VIEWER_UID = "test-viewer";
const USER_UID = "test-user";
const OTHER_UID = "test-other";

let env;

const adminToken = {
  email: "admin@example.com",
  email_verified: true
};

const viewerToken = {
  email: "viewer@example.com",
  email_verified: true
};

const userToken = {
  email: "user@example.com",
  email_verified: true
};

function db(uid, token = {}) {
  return env.authenticatedContext(uid, token).database();
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref().set({
      admin: {
        whitelistByUid: {
          [ADMIN_UID]: {
            uid: ADMIN_UID,
            email: "admin@example.com",
            enabled: true,
            role: "admin",
            addedAt: 1,
            addedByUid: MASTER_UID,
            addedByEmail: MASTER_EMAIL
          },
          [VIEWER_UID]: {
            uid: VIEWER_UID,
            email: "viewer@example.com",
            enabled: true,
            role: "viewer",
            addedAt: 1,
            addedByUid: MASTER_UID,
            addedByEmail: MASTER_EMAIL
          }
        },
        access: {
          roles: {
            custom: {
              name: "自訂測試角色",
              permissions: {
                admin__read: true,
                users__read: true,
                users__update: true,
                users__restrict: true,
                reports__read: true,
                reports__manage: true,
                audit__read: true,
                audit__write: true,
                audit__delete: true,
                maintenance__manage: true
              }
            }
          },
          roleByUid: {
            [ADMIN_UID]: "custom"
          },
          permissionsByUid: {
            [USER_UID]: {
              "chat__send": "deny"
            }
          },
          restrictionsByUid: {
            [USER_UID]: {
              "room__queue": {
                enabled: true,
                permanent: false,
                until: Date.now() + 3600000,
                reason: "queue restriction",
                createdAt: Date.now(),
                createdByUid: ADMIN_UID,
                createdByEmail: "admin@example.com"
              }
            }
          }
        },
        featureFlags: {
          "rooms__manage": {
            enabled: true,
            reason: "",
            updatedAt: Date.now(),
            updatedByUid: MASTER_UID
          }
        },
        blocksByUid: {
          [USER_UID]: {
            uid: USER_UID,
            email: "user@example.com",
            displayName: "User",
            permanent: true,
            blockedUntil: 0,
            blockedAt: 1,
            blockedByUid: ADMIN_UID,
            blockedByEmail: "admin@example.com",
            blockedByRole: "admin"
          },
          [OTHER_UID]: {
            uid: OTHER_UID,
            email: "other@example.com",
            displayName: "Other",
            permanent: true,
            blockedUntil: 0,
            blockedAt: 1,
            blockedByUid: VIEWER_UID,
            blockedByEmail: "viewer@example.com",
            blockedByRole: "viewer"
          }
        }
      },
      reports: {
        existing: {
          uid: USER_UID,
          category: "other",
          details: "existing report",
          createdAt: 1,
          status: "open"
        }
      },
      rooms: {
        ABC123: {
          owner: USER_UID,
          name: "Test Room",
          sourceType: "youtube",
          video: {
            id: "video-1",
            platform: "youtube",
            title: "Test",
            thumbnail: "",
            channel: ""
          }
        }
      },
      members: {
        ABC123: {
          [USER_UID]: {
            name: "User",
            joinedAt: 1,
            online: true,
            lastSeen: 1
          }
        }
      }
    });
  });
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-watchtogether-rules",
    database: {
      rules: RULES
    }
  });
});

test.beforeEach(async () => {
  await seed();
});

test.after(async () => {
  await env.cleanup();
});

test("reports: manually submitted reports can store verification but cannot self-resolve before approval", async () => {
  const ref = db(USER_UID, userToken).ref("reports/manual-verify");
  await assertSucceeds(ref.set({
    uid: USER_UID,
    category: "playback",
    details: "manual verification target",
    createdAt: Date.now(),
    status: "open",
    source: "manual",
    autoVerifyEnabled: true,
    verificationState: "monitoring",
    fingerprint: "manual-verify-123456"
  }));

  await assertSucceeds(ref.child("verification").set({
    state: "passed",
    checkedAt: Date.now(),
    deterministicPassed: true,
    stableChecks: 1
  }));

  await assertFails(ref.child("status").set("resolved"));

  await assertSucceeds(ref.child("verification").update({
    state: "approved",
    approved: true,
    stableChecks: 2,
    checkedAt: Date.now()
  }));

  await assertSucceeds(ref.child("status").set("resolved"));
});

test("reports: authenticated user can create only their own report", async () => {
  const ref = db(USER_UID, userToken).ref("reports/new-report");

  await assertSucceeds(ref.set({
    uid: USER_UID,
    category: "other",
    details: "new report",
    createdAt: Date.now()
  }));

  await assertFails(db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  }).ref("reports/foreign-report").set({
    uid: USER_UID,
    category: "other",
    details: "forged",
    createdAt: Date.now()
  }));
});

test("reports: automatic bug records can be reopened and updated only by their owner", async () => {
  const ref = db(USER_UID, userToken).ref("reports/auto-report");
  await assertSucceeds(ref.set({
    uid: USER_UID,
    category: "ui",
    details: "automatic error",
    createdAt: Date.now(),
    status: "open",
    source: "auto",
    autoDetected: true,
    autoVerifyEnabled: true,
    fingerprint: "1234567890abcdef",
    buildVersion: "formal-test-v1",
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    occurrences: 1
  }));

  await assertFails(ref.update({
    status: "resolved"
  }));

  await assertSucceeds(ref.child("verification").set({
    approved: true,
    state: "approved",
    checkedAt: Date.now(),
    stableChecks: 2
  }));

  await assertSucceeds(ref.update({
    status: "resolved",
    lastSeenAt: Date.now(),
    occurrences: 1,
    autoResolvedAt: Date.now(),
    autoResolvedBuild: "formal-test-v2",
    autoResolveReason: "stable"
  }));

  await assertFails(
    db(OTHER_UID, {
      email: "other@example.com",
      email_verified: true
    }).ref("reports/auto-report").update({
      status: "open"
    })
  );
});

test("report history: owner and admin can append, non-owner cannot append, admin can delete", async () => {
  const ref = db(USER_UID, userToken).ref("reports/history-target");
  await assertSucceeds(ref.set({
    uid: USER_UID,
    category: "other",
    details: "history target",
    createdAt: Date.now(),
    source: "auto",
    fingerprint: "abcdef1234567890"
  }));

  const event = db(USER_UID, userToken).ref("reportHistoryEvents/history-target").push();
  await assertSucceeds(event.set({
    reportId: "history-target",
    event: "created",
    createdAt: Date.now(),
    actorUid: USER_UID,
    actorEmail: "",
    source: "watchdog",
    details: "created"
  }));

  await assertFails(
    db(OTHER_UID, {
      email: "other@example.com",
      email_verified: true
    }).ref("reportHistoryEvents/history-target").push().set({
      reportId: "history-target",
      event: "forged",
      createdAt: Date.now(),
      actorUid: OTHER_UID,
      actorEmail: "other@example.com",
      source: "watchdog",
      details: "forged"
    })
  );

  const adminEvent = db(ADMIN_UID, adminToken).ref("reportHistoryEvents/history-target").push();
  await assertSucceeds(adminEvent.set({
    reportId: "history-target",
    event: "manual_status",
    createdAt: Date.now(),
    actorUid: ADMIN_UID,
    actorEmail: "admin@example.com",
    source: "admin",
    details: "resolved"
  }));

  await assertSucceeds(
    adminEvent.remove()
  );
});
test("reports: normal users cannot read the collection", async () => {
  await assertFails(
    db(USER_UID, userToken).ref("reports").once("value")
  );
});

test("reports: admin and viewer can read, but viewer cannot modify", async () => {
  await assertSucceeds(
    db(ADMIN_UID, adminToken).ref("reports").once("value")
  );

  await assertSucceeds(
    db(VIEWER_UID, viewerToken).ref("reports").once("value")
  );

  await assertFails(
    db(VIEWER_UID, viewerToken).ref("reports/existing").update({
      status: "resolved"
    })
  );
});

test("audit logs: admin with audit.delete can append and delete but cannot modify", async () => {
  const ref = db(ADMIN_UID, adminToken).ref("admin/auditLogs");

  await assertSucceeds(ref.push({
    action: "test",
    actorUid: ADMIN_UID,
    actorEmail: "admin@example.com",
    actorRole: "admin",
    targetUid: USER_UID,
    targetName: "User",
    details: "test audit",
    createdAt: Date.now()
  }));

  const existingRef = db(ADMIN_UID, adminToken)
    .ref("admin/auditLogs")
    .push();

  const existing = existingRef.key;

  await assertSucceeds(existingRef.set({
    action: "test-existing",
    actorUid: ADMIN_UID,
    actorEmail: "admin@example.com",
    actorRole: "admin",
    targetUid: USER_UID,
    targetName: "User",
    details: "existing",
    createdAt: Date.now()
  }));

  await assertFails(
    db(ADMIN_UID, adminToken).ref("admin/auditLogs/" + existing).set({
      action: "tampered",
      actorUid: ADMIN_UID,
      actorEmail: "admin@example.com",
      actorRole: "admin",
      targetUid: USER_UID,
      targetName: "User",
      details: "tampered",
      createdAt: Date.now()
    })
  );

  await assertSucceeds(
    db(ADMIN_UID, adminToken).ref("admin/auditLogs/" + existing).remove()
  );
});

test("audit logs: viewer can read but cannot append", async () => {
  await assertSucceeds(
    db(VIEWER_UID, viewerToken).ref("admin/auditLogs").once("value")
  );

  await assertFails(
    db(VIEWER_UID, viewerToken).ref("admin/auditLogs").push({
      action: "viewer-test",
      actorUid: VIEWER_UID,
      actorEmail: "viewer@example.com",
      actorRole: "admin",
      targetUid: USER_UID,
      targetName: "User",
      details: "invalid",
      createdAt: Date.now()
    })
  );
});

test("2.0 access control: custom admin role can read and write its permitted admin data", async () => {
  const adminDb = db(ADMIN_UID, {
    email: "admin@example.com",
    email_verified: true
  });

  await assertSucceeds(adminDb.ref("accounts/" + USER_UID).once("value"));
  await assertSucceeds(adminDb.ref("profiles/" + USER_UID).once("value"));
  await assertSucceeds(adminDb.ref("reports").once("value"));
  await assertSucceeds(adminDb.ref("reportHistoryEvents/history-target").once("value"));
  await assertSucceeds(adminDb.ref("admin/blocksByUid/" + USER_UID).once("value"));

  const log = adminDb.ref("admin/auditLogs").push();
  await assertSucceeds(log.set({
    action: "custom.role.audit",
    actorUid: ADMIN_UID,
    actorEmail: "admin@example.com",
    actorRole: "custom",
    targetUid: USER_UID,
    targetName: "User",
    details: "custom role audit",
    createdAt: Date.now()
  }));
});

test("2.0 maintenance: normal users are blocked while admin users keep access", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});

  await assertSucceeds(
    master.ref("site/maintenance").set({
      enabled: true,
      reason: "maintenance test",
      restoreAt: Date.now() + 3600000,
      updatedAt: Date.now(),
      updatedByUid: MASTER_UID,
      updatedByEmail: MASTER_EMAIL
    })
  );

  const queueItem = {
    id: "maintenance-normal",
    platform: "youtube",
    title: "Maintenance Test",
    thumbnail: "",
    channel: "",
    addedBy: USER_UID,
    addedByName: "User",
    addedAt: Date.now()
  };

  await assertFails(
    db(USER_UID, userToken)
      .ref("queue/ABC123/maintenance-normal")
      .set(queueItem)
  );

  await assertSucceeds(
    master.ref("admin/access/roles/maintenance-admin").set({
      name: "Maintenance Admin",
      permissions: {
        "admin__read": true,
        "room__queue": true
      }
    })
  );
  await assertSucceeds(
    master.ref("admin/access/roleByUid/" + USER_UID).set("maintenance-admin")
  );

  await assertSucceeds(
    db(USER_UID, userToken)
      .ref("queue/ABC123/maintenance-admin")
      .set({
        ...queueItem,
        id: "maintenance-admin"
      })
  );
});

test("2.0 maintenance: direct client writes remain blocked even with maintenance.manage", async () => {
  await assertFails(
    db(ADMIN_UID, adminToken).ref("site/maintenance").set({
      enabled: true,
      reason: "direct client write",
      restoreAt: Date.now() + 3600000,
      updatedAt: Date.now(),
      updatedByUid: ADMIN_UID
    })
  );

  await assertSucceeds(
    db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true})
      .ref("site/maintenance").set({
        enabled: false,
        reason: "test reset",
        restoreAt: 0,
        updatedAt: Date.now(),
        updatedByUid: MASTER_UID
      })
  );
});

test("2.0 access control: master can manage roles, permissions, restrictions and feature flags", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  await assertSucceeds(master.ref("admin/access/roles/custom2").set({
    name: "Custom 2",
    permissions: {"rooms__read": true}
  }));
  await assertSucceeds(master.ref("admin/access/roleByUid/" + USER_UID).set("custom2"));
  await assertSucceeds(master.ref("admin/access/permissionsByUid/" + USER_UID + "/rooms__manage").set("deny"));
  await assertSucceeds(master.ref("admin/access/restrictionsByUid/" + USER_UID + "/chat__send").set({
    enabled: true,
    permanent: true,
    until: 0,
    reason: "test restriction",
    createdAt: Date.now(),
    createdByUid: MASTER_UID,
    createdByEmail: MASTER_EMAIL
  }));
  await assertSucceeds(master.ref("admin/featureFlags/chat__send").set({
    enabled: false,
    reason: "test flag",
    updatedAt: Date.now(),
    updatedByUid: MASTER_UID
  }));
});

test("2.0 access control: viewer cannot modify policy and user cannot forge their restriction", async () => {
  await assertFails(
    db(VIEWER_UID, viewerToken).ref("admin/access/roleByUid/" + USER_UID).set("admin")
  );
  await assertFails(
    db(USER_UID, userToken).ref("admin/access/restrictionsByUid/" + USER_UID + "/chat__send").set({
      enabled: false,
      permanent: false,
      until: 0,
      reason: "forged",
      createdAt: Date.now(),
      createdByUid: USER_UID,
      createdByEmail: "user@example.com"
    })
  );
});

test("2.0 access control: Allow and Deny overrides affect admin user updates", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});

  await assertSucceeds(master.ref("admin/access/roles/user-manager").set({
    name: "User Manager",
    permissions: {
      "users__update": true
    }
  }));
  await assertSucceeds(
    master.ref("admin/access/roleByUid/" + USER_UID).set("user-manager")
  );

  await assertSucceeds(
    db(USER_UID, userToken)
      .ref("accounts/" + OTHER_UID + "/displayName")
      .set("Updated By Role")
  );

  await assertSucceeds(
    master.ref("admin/access/permissionsByUid/" + USER_UID + "/users__update").set("deny")
  );

  await assertFails(
    db(USER_UID, userToken)
      .ref("accounts/" + OTHER_UID + "/displayName")
      .set("Should Fail")
  );

  await assertSucceeds(
    master.ref("admin/access/permissionsByUid/" + USER_UID + "/users__update").set("allow")
  );

  await assertSucceeds(
    db(USER_UID, userToken)
      .ref("accounts/" + OTHER_UID + "/displayName")
      .set("Updated By Override")
  );
});

test("2.0 access control: Allow and Deny overrides affect Firebase writes", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});

  await assertSucceeds(master.ref("admin/access/roles/queue-manager").set({
    name: "Queue Manager",
    permissions: {
      "room__queue": true
    }
  }));
  await assertSucceeds(
    master.ref("admin/access/roleByUid/" + USER_UID).set("queue-manager")
  );

  const queueItem = {
    id: "override-test",
    platform: "youtube",
    title: "Override Test",
    thumbnail: "",
    channel: "",
    addedBy: USER_UID,
    addedByName: "User",
    addedAt: Date.now()
  };

  await assertSucceeds(
    db(USER_UID, userToken)
      .ref("queue/ABC123/override-test")
      .set(queueItem)
  );

  await assertSucceeds(
    master.ref("admin/access/permissionsByUid/" + USER_UID + "/room__queue").set("deny")
  );

  await assertFails(
    db(USER_UID, userToken)
      .ref("queue/ABC123/override-test-deny")
      .set({
        ...queueItem,
        id: "override-test-deny"
      })
  );

  await assertSucceeds(
    master.ref("admin/access/permissionsByUid/" + USER_UID + "/room__queue").set("allow")
  );

  await assertSucceeds(
    db(USER_UID, userToken)
      .ref("queue/ABC123/override-test-allow")
      .set({
        ...queueItem,
        id: "override-test-allow"
      })
  );
});

test("2.0 access control: server-side restriction and feature flag block room writes", async () => {
  const ref = db(USER_UID, userToken).ref("rooms/ZXY789");
  await assertSucceeds(ref.set({
    owner: USER_UID,
    name: "Guard Test",
    sourceType: "youtube",
    video: {
      id: "video-guard",
      platform: "youtube",
      title: "Guard",
      thumbnail: "",
      channel: ""
    }
  }));
  await assertSucceeds(
    db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true})
      .ref("admin/featureFlags/rooms__manage")
      .update({
        enabled: false,
        reason: "disabled",
        updatedAt: Date.now(),
        updatedByUid: MASTER_UID
      })
  );
  await assertFails(
    db(USER_UID, userToken).ref("rooms/ZXY789").remove()
  );
});

test("2.0 access control: audit.delete follows the assigned permission", async () => {
  const ref = db(ADMIN_UID, adminToken).ref("admin/auditLogs").push();
  await assertSucceeds(ref.set({
    action: "delete-test",
    actorUid: ADMIN_UID,
    actorEmail: "admin@example.com",
    actorRole: "admin",
    targetUid: USER_UID,
    targetName: "User",
    details: "delete test",
    createdAt: Date.now()
  }));
  await assertSucceeds(
    db(ADMIN_UID, adminToken).ref("admin/auditLogs/" + ref.key).remove()
  );

  const viewerRef = db(VIEWER_UID, viewerToken).ref("admin/auditLogs").push();
  await assertSucceeds(viewerRef.set({
    action: "viewer-delete-test",
    actorUid: VIEWER_UID,
    actorEmail: "viewer@example.com",
    actorRole: "viewer",
    targetUid: USER_UID,
    targetName: "User",
    details: "viewer target",
    createdAt: Date.now()
  }));
  await assertFails(
    db(VIEWER_UID, viewerToken).ref("admin/auditLogs/" + viewerRef.key).remove()
  );

  const masterRef = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true})
    .ref("admin/auditLogs").push();
  await assertSucceeds(masterRef.set({
    action: "master-delete-test",
    actorUid: MASTER_UID,
    actorEmail: MASTER_EMAIL,
    actorRole: "master",
    targetUid: USER_UID,
    targetName: "User",
    details: "master target",
    createdAt: Date.now()
  }));
  await assertSucceeds(
    db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true})
      .ref("admin/auditLogs/" + masterRef.key).remove()
  );
});

test("blocks: blocked user cannot mutate their own higher-role block", async () => {
  await assertFails(
    db(USER_UID, userToken).ref("admin/blocksByUid/" + USER_UID).remove()
  );
});

test("blocks: master account cannot be blocked", async () => {
  await assertFails(
    db(ADMIN_UID, adminToken).ref("admin/blocksByUid/" + MASTER_UID).set({
      uid: MASTER_UID,
      email: MASTER_EMAIL,
      displayName: "Master",
      permanent: true,
      blockedUntil: 0,
      blockedAt: Date.now(),
      blockedByUid: ADMIN_UID,
      blockedByEmail: "admin@example.com",
      blockedByRole: "admin"
    })
  );
});

test("unauthenticated users cannot access protected admin paths", async () => {
  const unauth = env.unauthenticatedContext();

  await assertFails(
    unauth.database().ref("reports").once("value")
  );

  await assertFails(
    unauth.database().ref("admin/auditLogs").once("value")
  );

  await assertFails(
    unauth.database().ref("admin/whitelistByUid").once("value")
  );
});
