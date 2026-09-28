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

const masterToken = {
  email: MASTER_EMAIL,
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
                audit__delete: true
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
        },
        featureFlags: {
          "rooms__manage": {
            enabled: true,
            reason: "",
            updatedAt: Date.now(),
            updatedByUid: MASTER_UID
          }
        },
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
      },
      friendships: {
        [USER_UID]: {
          [OTHER_UID]: {since: 1}
        },
        [OTHER_UID]: {
          [USER_UID]: {since: 1}
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
test("chat moderation: permitted admin can read and delete messages, viewer cannot moderate", async () => {
  const admin = db(ADMIN_UID, adminToken);
  const viewer = db(VIEWER_UID, viewerToken);
  const user = db(USER_UID, userToken);
  const messageRef = user.ref("chat/ABC123").push();

  await assertSucceeds(messageRef.set({
    uid: USER_UID,
    name: "User",
    type: "text",
    text: "moderation target",
    createdAt: Date.now()
  }));

  await assertSucceeds(admin.ref("chat/ABC123").once("value"));
  await assertFails(viewer.ref("chat/ABC123").once("value"));
  await assertSucceeds(admin.ref("chat/ABC123/" + messageRef.key).remove());
  await assertFails(viewer.ref("chat/ABC123/" + messageRef.key).remove());
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

test("audit logs: admin can append, cannot modify, and audit.delete controls deletion", async () => {
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

  const viewerRef = db(ADMIN_UID, adminToken).ref("admin/auditLogs").push();
  await assertSucceeds(viewerRef.set({
    action: "viewer-delete-test",
    actorUid: ADMIN_UID,
    actorEmail: "admin@example.com",
    actorRole: "admin",
    targetUid: USER_UID,
    targetName: "User",
    details: "viewer delete must fail",
    createdAt: Date.now()
  }));

  await assertFails(
    db(VIEWER_UID, viewerToken).ref("admin/auditLogs/" + viewerRef.key).remove()
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

test("2.0 access control: custom administrator can manage user blocks", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const customAdmin = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });

  await assertSucceeds(master.ref("admin/access/roles/block-manager").set({
    name: "Block Manager",
    permissions: {
      admin__read: true,
      users__read: true,
      users__restrict: true,
      audit__write: true
    }
  }));
  await assertSucceeds(master.ref("admin/access/roleByUid/" + OTHER_UID).set("block-manager"));

  await assertSucceeds(customAdmin.ref("admin/blocksByUid/" + USER_UID).set({
    uid: USER_UID,
    email: "user@example.com",
    displayName: "User",
    permanent: false,
    blockedUntil: Date.now() + 3600000,
    blockedAt: Date.now(),
    blockedByUid: OTHER_UID,
    blockedByEmail: "other@example.com",
    blockedByRole: "admin"
  }));

  await assertSucceeds(customAdmin.ref("admin/blocksByUid/" + USER_UID).remove());

  await assertSucceeds(master.ref("admin/access/roleByUid/" + OTHER_UID).remove());
  await assertSucceeds(master.ref("admin/access/roles/block-manager").remove());
});

test("2.0 access control: user restriction and block writes require audit.write", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const restrictedAdmin = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });

  await assertSucceeds(master.ref("admin/access/roles/restrict-only").set({
    name: "Restrict Only",
    permissions: {
      admin__read: true,
      users__read: true,
      users__restrict: true
    }
  }));
  await assertSucceeds(master.ref("admin/access/roleByUid/" + OTHER_UID).set("restrict-only"));

  await assertFails(restrictedAdmin.ref(
    "admin/access/restrictionsByUid/" + USER_UID + "/youtube__search"
  ).set({
    enabled: true,
    permanent: false,
    until: Date.now() + 3600000,
    reason: "test without audit permission",
    createdAt: Date.now(),
    createdByUid: OTHER_UID,
    createdByEmail: "other@example.com"
  }));

  await assertFails(restrictedAdmin.ref("admin/blocksByUid/" + USER_UID).set({
    uid: USER_UID,
    email: "user@example.com",
    displayName: "User",
    permanent: false,
    blockedUntil: Date.now() + 3600000,
    blockedAt: Date.now(),
    blockedByUid: OTHER_UID,
    blockedByEmail: "other@example.com",
    blockedByRole: "admin"
  }));

  await assertSucceeds(master.ref("admin/access/roleByUid/" + OTHER_UID).remove());
  await assertSucceeds(master.ref("admin/access/roles/restrict-only").remove());
});

test("room 2.0: application lifecycle and cohost role are owner controlled", async () => {
  const ownerDb = db(USER_UID, userToken);
  await assertSucceeds(ownerDb.ref("roomMeta/ABC123").set({
    owner: USER_UID,
    name: "Test Room",
    settings: {
      locked: false,
      maxMembers: 10,
      controlMode: "host",
      visibility: "private",
      joinPolicy: "application"
    },
    createdAt: Date.now()
  }));

  const applicant = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });

  await assertFails(
    applicant.ref("members/ABC123/" + OTHER_UID).set({
      name: "Applicant",
      joinedAt: Date.now(),
      online: true,
      lastSeen: Date.now()
    })
  );

  await assertSucceeds(applicant.ref("roomApplications/ABC123/" + OTHER_UID).set({
    uid: OTHER_UID,
    name: "Applicant",
    createdAt: Date.now(),
    status: "pending"
  }));

  await assertFails(
    applicant.ref("roomRoles/ABC123/" + OTHER_UID).set({
      uid: OTHER_UID,
      role: "cohost",
      updatedAt: Date.now(),
      updatedByUid: OTHER_UID
    })
  );

  await assertSucceeds(
    ownerDb.ref("roomApplications/ABC123/" + OTHER_UID).update({
      status: "approved",
      updatedAt: Date.now(),
      reviewedByUid: USER_UID,
      reviewedAt: Date.now()
    })
  );

  await assertSucceeds(
    ownerDb.ref("members/ABC123/" + OTHER_UID).set({
      name: "Applicant",
      joinedAt: Date.now(),
      online: true,
      lastSeen: Date.now()
    })
  );

  await assertSucceeds(
    ownerDb.ref("roomRoles/ABC123/" + OTHER_UID).set({
      uid: OTHER_UID,
      role: "cohost",
      updatedAt: Date.now(),
      updatedByUid: USER_UID
    })
  );

  await assertSucceeds(ownerDb.ref("roomRoles/ABC123/" + OTHER_UID).remove());
  await assertSucceeds(ownerDb.ref("roomApplications/ABC123/" + OTHER_UID).remove());
  await assertSucceeds(ownerDb.ref("members/ABC123/" + OTHER_UID).remove());
  await assertSucceeds(db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true}).ref("roomMeta/ABC123").remove());
});

test("chat media messages: image and audio payloads pass validation", async () => {
  const imageRef = db(USER_UID, userToken).ref("chat/ABC123/media-image-test");
  const audioRef = db(USER_UID, userToken).ref("chat/ABC123/media-audio-test");

  await assertSucceeds(imageRef.set({
    uid: USER_UID,
    name: "User",
    type: "image",
    mediaUrl: "https://example.com/image.webp",
    mediaPath: "chatMedia/" + USER_UID + "/" + OTHER_UID + "/image.webp",
    mediaName: "image.webp",
    mediaSize: 128000,
    createdAt: Date.now()
  }));

  await assertSucceeds(audioRef.set({
    uid: USER_UID,
    name: "User",
    type: "audio",
    mediaUrl: "https://example.com/voice.webm",
    mediaPath: "chatMedia/" + USER_UID + "/" + OTHER_UID + "/voice.webm",
    mediaName: "voice.webm",
    mediaSize: 256000,
    duration: 12,
    createdAt: Date.now()
  }));
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

  await assertSucceeds(master.ref("admin/access/roleByUid/" + USER_UID).remove());
  await assertSucceeds(master.ref("admin/access/roles/custom2").remove());
  await assertSucceeds(master.ref("admin/access/permissionsByUid/" + USER_UID + "/rooms__manage").remove());
  await assertSucceeds(master.ref("admin/access/restrictionsByUid/" + USER_UID + "/chat__send").remove());
  await assertSucceeds(master.ref("admin/featureFlags/chat__send").remove());
});

test("2.0 access control: per-user deny overrides legacy admin and allow grants a single permission", async () => {
  const masterDb = db(MASTER_UID, masterToken);
  await assertSucceeds(
    masterDb.ref("admin/access/permissionsByUid/" + ADMIN_UID + "/reports__read").set("deny")
  );
  await assertFails(
    db(ADMIN_UID, adminToken).ref("reports").once("value")
  );

  await assertSucceeds(
    masterDb.ref("admin/access/permissionsByUid/" + OTHER_UID + "/reports__read").set("allow")
  );
  await assertSucceeds(
    db(OTHER_UID, {
      email: "other@example.com",
      email_verified: true
    }).ref("reports").once("value")
  );
});

test("2.0 access control: explicit users.restrict deny blocks legacy admin restriction writes", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const admin = db(ADMIN_UID, adminToken);

  await assertSucceeds(
    master.ref("admin/access/permissionsByUid/" + ADMIN_UID + "/users__restrict").set("deny")
  );

  await assertFails(
    admin.ref("admin/access/restrictionsByUid/" + USER_UID + "/chat__send").set({
      enabled: true,
      permanent: true,
      until: 0,
      reason: "should be blocked by explicit deny",
      createdAt: Date.now(),
      createdByUid: ADMIN_UID,
      createdByEmail: "admin@example.com"
    })
  );

  await assertSucceeds(
    master.ref("admin/access/permissionsByUid/" + ADMIN_UID + "/users__restrict").remove()
  );
});

test("2.0 access control: ai.agent is independently assignable", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const other = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });

  await assertSucceeds(master.ref("admin/access/roles/agent-operator").set({
    name: "Agent Operator",
    permissions: {
      admin__read: true,
      ai__agent: true
    }
  }));
  await assertSucceeds(master.ref("admin/access/roleByUid/" + OTHER_UID).set("agent-operator"));

  await assertSucceeds(
    other.ref("admin/access/roleByUid/" + OTHER_UID).once("value")
  );

  const override = other.ref("admin/access/permissionsByUid/" + OTHER_UID + "/ai__agent");
  await assertFails(override.set("allow"));

  await assertSucceeds(
    master.ref("admin/access/permissionsByUid/" + OTHER_UID + "/ai__agent").set("deny")
  );
});

test("2.0 access control: management permissions cover maintenance, feature flags and settings", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const operator = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });

  await assertSucceeds(master.ref("admin/access/roles/ops-manager").set({
    name: "Operations Manager",
    permissions: {
      admin__read: true,
      maintenance__manage: true,
      featureflags__manage: true,
      settings__manage: true,
      audit__write: true
    }
  }));
  await assertSucceeds(master.ref("admin/access/roleByUid/" + OTHER_UID).set("ops-manager"));

  await assertSucceeds(operator.ref("site/maintenance").set({
    enabled: false,
    reason: "test",
    restoreAt: 0,
    updatedAt: Date.now(),
    updatedByUid: OTHER_UID
  }));

  await assertSucceeds(operator.ref("admin/featureFlags/test__flag").set({
    enabled: true,
    reason: "test",
    updatedAt: Date.now(),
    updatedByUid: OTHER_UID
  }));

  await assertSucceeds(operator.ref("site/settings").set({
    siteName: "WatchTogether",
    siteDescription: "Test",
    announcementEnabled: false,
    announcementText: "",
    updatedAt: Date.now(),
    updatedByUid: OTHER_UID
  }));

  await assertSucceeds(
    master.ref("admin/access/permissionsByUid/" + OTHER_UID + "/maintenance__manage").set("deny")
  );
  await assertFails(operator.ref("site/maintenance").set({
    enabled: false,
    reason: "blocked",
    restoreAt: 0,
    updatedAt: Date.now(),
    updatedByUid: OTHER_UID
  }));

  await assertSucceeds(
    master.ref("admin/access/permissionsByUid/" + OTHER_UID + "/maintenance__manage").remove()
  );
  await assertSucceeds(master.ref("admin/access/roleByUid/" + OTHER_UID).remove());
  await assertSucceeds(master.ref("admin/access/roles/ops-manager").remove());
  await assertSucceeds(master.ref("admin/access/permissionsByUid/" + OTHER_UID + "/maintenance__manage").remove());
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

test("2.0 access control: audit.delete is separate from audit.write", async () => {
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

  const customDeleteRef = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true}).ref("admin/auditLogs").push();
  await assertSucceeds(customDeleteRef.set({
    action: "delete-permission-test",
    actorUid: MASTER_UID,
    actorEmail: MASTER_EMAIL,
    actorRole: "master",
    targetUid: USER_UID,
    targetName: "User",
    details: "master seed",
    createdAt: Date.now()
  }));
  await assertSucceeds(
    db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true})
      .ref("admin/auditLogs/" + customDeleteRef.key).remove()
  );

  const writeOnlyRole = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  await assertSucceeds(writeOnlyRole.ref("admin/access/roles/write-only").set({
    name: "Write Only",
    permissions: {audit__write: true}
  }));
  await assertSucceeds(writeOnlyRole.ref("admin/access/roleByUid/" + OTHER_UID).set("write-only"));

  const otherRef = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  }).ref("admin/auditLogs").push();
  await assertSucceeds(otherRef.set({
    action: "write-only",
    actorUid: OTHER_UID,
    actorEmail: "other@example.com",
    actorRole: "write-only",
    targetUid: USER_UID,
    targetName: "User",
    details: "write only",
    createdAt: Date.now()
  }));
  await assertFails(
    db(OTHER_UID, {
      email: "other@example.com",
      email_verified: true
    }).ref("admin/auditLogs/" + otherRef.key).remove()
  );
});

test("2.0 access control: room.join restriction and feature flag block membership creation", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const target = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });
  const ownerDb = db(USER_UID, userToken);
  const roomRef = ownerDb.ref("rooms/ZJOIN1");
  await assertSucceeds(roomRef.set({
    owner: USER_UID,
    name: "Join Guard",
    sourceType: "youtube",
    video: {
      id: "join-guard",
      platform: "youtube",
      title: "Join Guard",
      thumbnail: "",
      channel: ""
    }
  }));
  const memberRef = target.ref("members/ZJOIN1/" + OTHER_UID);

  await assertSucceeds(master.ref("admin/access/restrictionsByUid/" + OTHER_UID + "/room__join").set({
    enabled: true,
    permanent: true,
    until: 0,
    reason: "join restricted",
    createdAt: Date.now(),
    createdByUid: MASTER_UID,
    createdByEmail: MASTER_EMAIL
  }));

  await assertFails(memberRef.set({
    name: "Other",
    joinedAt: Date.now(),
    online: true,
    lastSeen: Date.now()
  }));

  await assertSucceeds(
    master.ref("admin/access/restrictionsByUid/" + OTHER_UID + "/room__join").remove()
  );

  await assertSucceeds(master.ref("admin/featureFlags/room__join").set({
    enabled: false,
    reason: "join disabled",
    updatedAt: Date.now(),
    updatedByUid: MASTER_UID
  }));

  await assertFails(memberRef.set({
    name: "Other",
    joinedAt: Date.now(),
    online: true,
    lastSeen: Date.now()
  }));

  await assertSucceeds(master.ref("admin/featureFlags/room__join").remove());
  await assertSucceeds(master.ref("rooms/ZJOIN1").remove());
});

test("2.0 access control: chat.dm restriction and feature flag block private-chat writes", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const other = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });
  const conversationId = [USER_UID, OTHER_UID].sort().join("_");
  const conversationRef = other.ref("conversations/" + conversationId);

  await assertSucceeds(master.ref("admin/access/restrictionsByUid/" + OTHER_UID + "/chat__dm").set({
    enabled: true,
    permanent: true,
    until: 0,
    reason: "dm restricted",
    createdAt: Date.now(),
    createdByUid: MASTER_UID,
    createdByEmail: MASTER_EMAIL
  }));

  await assertFails(conversationRef.set({
    userA: USER_UID,
    userB: OTHER_UID,
    createdAt: Date.now()
  }));

  await assertSucceeds(master.ref("admin/access/restrictionsByUid/" + OTHER_UID + "/chat__dm").remove());

  await assertSucceeds(master.ref("admin/access/restrictionsByUid/" + OTHER_UID + "/chat__send").set({
    enabled: true,
    permanent: true,
    until: 0,
    reason: "send restricted",
    createdAt: Date.now(),
    createdByUid: MASTER_UID,
    createdByEmail: MASTER_EMAIL
  }));

  await assertFails(conversationRef.child("messages/message-send-1").set({
    uid: OTHER_UID,
    type: "text",
    text: "blocked by chat.send",
    createdAt: Date.now()
  }));

  await assertSucceeds(master.ref("admin/access/restrictionsByUid/" + OTHER_UID + "/chat__send").remove());

  await assertSucceeds(conversationRef.set({
    userA: USER_UID,
    userB: OTHER_UID,
    createdAt: Date.now()
  }));

  await assertSucceeds(master.ref("admin/featureFlags/chat__dm").set({
    enabled: false,
    reason: "dm disabled",
    updatedAt: Date.now(),
    updatedByUid: MASTER_UID
  }));

  await assertFails(other.ref("conversations/" + conversationId + "/messages/message-1").set({
    uid: OTHER_UID,
    type: "text",
    text: "blocked",
    createdAt: Date.now()
  }));

  await assertSucceeds(master.ref("admin/featureFlags/chat__dm").remove());
});

test("site settings: authenticated users can read, only master can write", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const user = db(USER_UID, userToken);
  const viewer = db(VIEWER_UID, viewerToken);
  const payload = {
    siteName: "WatchTogether｜一起看",
    siteDescription: "System settings test",
    announcementEnabled: true,
    announcementText: "Test announcement",
    updatedAt: Date.now(),
    updatedByUid: MASTER_UID
  };

  await assertSucceeds(master.ref("site/settings").set(payload));
  await assertSucceeds(user.ref("site/settings").once("value"));
  await assertSucceeds(viewer.ref("site/settings").once("value"));

  await assertFails(user.ref("site/settings").set({
    ...payload,
    siteName: "forged",
    updatedAt: Date.now(),
    updatedByUid: USER_UID
  }));

  await assertFails(viewer.ref("site/settings").set({
    ...payload,
    siteName: "forged-viewer",
    updatedAt: Date.now(),
    updatedByUid: VIEWER_UID
  }));
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
