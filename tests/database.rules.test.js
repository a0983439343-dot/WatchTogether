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
  await seed();
});

test.after(async () => {
  await env.cleanup();
});


test("public room join approval: requester can apply but cannot self-approve", async () => {
  const roomId = "APR123";
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref("rooms/" + roomId).set({
      owner: USER_UID,
      name: "Approval Room",
      sourceType: "youtube"
    });
    await context.database().ref("roomMeta/" + roomId).set({
      owner: USER_UID,
      name: "Approval Room",
      visibility: "public",
      joinMode: "approval",
      settings: { locked: false, maxMembers: 10, controlMode: "host" },
      createdAt: Date.now()
    });
  });

  const requestRef = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  }).ref("roomJoinRequests/" + roomId + "/" + OTHER_UID);

  await assertSucceeds(requestRef.set({
    uid: OTHER_UID,
    name: "Other",
    status: "pending",
    approved: false,
    requestedAt: Date.now()
  }));

  await assertFails(requestRef.update({
    status: "approved",
    approved: true,
    approvedAt: Date.now(),
    approvedBy: OTHER_UID
  }));

  await assertSucceeds(requestRef.remove());
});

test("public room join approval: owner can approve and approved user can become a member", async () => {
  const roomId = "APR456";
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref("rooms/" + roomId).set({
      owner: USER_UID,
      name: "Approval Room 2",
      sourceType: "youtube"
    });
    await context.database().ref("roomMeta/" + roomId).set({
      owner: USER_UID,
      name: "Approval Room 2",
      visibility: "public",
      joinMode: "approval",
      settings: { locked: false, maxMembers: 10, controlMode: "host" },
      createdAt: Date.now()
    });
  });

  const requester = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });
  const owner = db(USER_UID, userToken);

  await assertSucceeds(
    requester.ref("roomJoinRequests/" + roomId + "/" + OTHER_UID).set({
      uid: OTHER_UID,
      name: "Other",
      status: "pending",
      approved: false,
      requestedAt: Date.now()
    })
  );

  await assertSucceeds(
    owner.ref("roomJoinRequests/" + roomId + "/" + OTHER_UID).update({
      status: "approved",
      approved: true,
      approvedAt: Date.now(),
      approvedBy: USER_UID
    })
  );

  await assertSucceeds(
    requester.ref("members/" + roomId + "/" + OTHER_UID).set({
      name: "Other",
      joinedAt: Date.now(),
      online: true,
      lastSeen: Date.now()
    })
  );
});

test("personal room: an offline former owner cannot be replaced through the owner-takeover write path", async () => {
  const roomId = "PER123";
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref("rooms/" + roomId).set({
      owner: USER_UID,
      name: "Personal",
      sourceType: "youtube"
    });
    await context.database().ref("roomMeta/" + roomId).set({
      owner: USER_UID,
      name: "Personal",
      visibility: "personal",
      joinMode: "invite_only",
      settings: { locked: false, maxMembers: 10, controlMode: "host" },
      createdAt: Date.now()
    });
    await context.database().ref("members/" + roomId + "/" + USER_UID).set({
      name: "User", joinedAt: 1, online: false, lastSeen: 1
    });
    await context.database().ref("members/" + roomId + "/" + OTHER_UID).set({
      name: "Other", joinedAt: Date.now(), online: true, lastSeen: Date.now()
    });
  });

  await assertFails(
    db(OTHER_UID, {
      email: "other@example.com",
      email_verified: true
    }).ref("rooms/" + roomId + "/owner").set(OTHER_UID)
  );
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

test("audit logs: admin can append but cannot modify or delete", async () => {
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

  await assertFails(
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


test("2.0: maintenance state is public-readable but admin-write only", async () => {
  await assertSucceeds(db(USER_UID, userToken).ref("system/maintenance").once("value"));
  await assertFails(
    db(USER_UID, userToken).ref("system/maintenance").set({
      enabled: true,
      mode: "maintenance",
      message: "forged",
      updatedAt: Date.now(),
      updatedBy: USER_UID
    })
  );
  await assertSucceeds(
    db(ADMIN_UID, adminToken).ref("system/maintenance").set({
      enabled: true,
      mode: "maintenance",
      message: "test",
      startedAt: Date.now(),
      endsAt: 0,
      updatedAt: Date.now(),
      updatedBy: ADMIN_UID
    })
  );

  await assertSucceeds(
    db(ADMIN_UID, adminToken).ref("system/maintenance").set({
      enabled: false,
      updatedAt: Date.now(),
      updatedBy: ADMIN_UID
    })
  );
});

test("2.0: user feature restrictions can only be written by admin", async () => {
  const path = "admin/restrictionsByUid/" + USER_UID;
  await assertFails(
    db(USER_UID, userToken).ref(path).set({
      features: { chat: true },
      reason: "self",
      blockedUntil: 0,
      updatedAt: Date.now(),
      updatedBy: USER_UID
    })
  );
  await assertSucceeds(
    db(ADMIN_UID, adminToken).ref(path).set({
      features: { chat: true, create_room: true },
      reason: "test restriction",
      blockedUntil: 0,
      updatedAt: Date.now(),
      updatedBy: ADMIN_UID
    })
  );
  await assertSucceeds(db(USER_UID, userToken).ref(path).once("value"));
});

test("2.0: role definitions and assignments are master-only writes", async () => {
  await assertFails(
    db(ADMIN_UID, adminToken).ref("admin/roles/core_admin").set({
      name: "Core Admin",
      permissions: { "rooms.manage": true },
      updatedAt: Date.now()
    })
  );
  await assertSucceeds(
    db(MASTER_UID, { email: MASTER_EMAIL, email_verified: true }).ref("admin/roles/core_admin").set({
      name: "Core Admin",
      permissions: { "rooms.manage": true, "users.view": true },
      updatedAt: Date.now()
    })
  );
  await assertSucceeds(
    db(MASTER_UID, { email: MASTER_EMAIL, email_verified: true }).ref("admin/userRoles/" + ADMIN_UID).set({
      roleId: "core_admin",
      updatedAt: Date.now()
    })
  );
});

test("2.0: public room index is readable but owner-controlled", async () => {
  await assertSucceeds(
    db(USER_UID, userToken).ref("publicRooms/ABC123").set({
      roomId: "ABC123",
      name: "Public Test",
      sourceType: "youtube",
      memberCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  );
  await assertSucceeds(
    db(OTHER_UID, { email: "other@example.com", email_verified: true })
      .ref("publicRooms/ABC123")
      .once("value")
  );
  await assertFails(
    db(OTHER_UID, { email: "other@example.com", email_verified: true })
      .ref("publicRooms/ABC123")
      .update({ name: "forged" })
  );
});


test("2.0: approval join requests are requester-creatable and owner-approvable", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref("rooms/REQ123").set({
      owner: ADMIN_UID,
      name: "Approval Room",
      sourceType: "youtube"
    });
    await context.database().ref("roomMeta/REQ123").set({
      owner: ADMIN_UID,
      name: "Approval Room",
      visibility: "public",
      joinMode: "approval",
      settings: { locked: false, maxMembers: 10, controlMode: "host" },
      createdAt: Date.now()
    });
  });

  const requestPath = "roomJoinRequests/REQ123/" + USER_UID;
  await assertSucceeds(
    db(USER_UID, userToken).ref(requestPath).set({
      uid: USER_UID,
      name: "User",
      status: "pending",
      approved: false,
      requestedAt: Date.now()
    })
  );

  await assertSucceeds(
    db(ADMIN_UID, adminToken).ref(requestPath).update({
      status: "approved",
      approved: true,
      approvedAt: Date.now(),
      approvedBy: ADMIN_UID
    })
  );

  await assertFails(
    db(OTHER_UID, { email: "other@example.com", email_verified: true })
      .ref(requestPath)
      .update({ status: "approved", approved: true })
  );
});


test("2.0: co-host can reorder but cannot rewrite queue item", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref("roomRoles/ABC123/" + ADMIN_UID).set({
      role: "cohost",
      updatedAt: 1,
      updatedBy: USER_UID
    });
    await context.database().ref("queue/ABC123/item1").set({
      id: "video-1",
      platform: "youtube",
      title: "Original",
      thumbnail: "",
      channel: "YouTube",
      addedBy: USER_UID,
      addedByName: "User",
      addedAt: 1,
      queueOrder: 1
    });
    await context.database().ref("rooms/ABC123/owner").set(USER_UID);
    await context.database().ref("members/ABC123/" + ADMIN_UID).set({
      name: "Admin",
      joinedAt: 1,
      online: true,
      lastSeen: 1
    });
  });

  await assertSucceeds(
    db(ADMIN_UID, adminToken).ref("queue/ABC123/item1/queueOrder").set(2)
  );

  await assertFails(
    db(ADMIN_UID, adminToken).ref("queue/ABC123/item1").update({
      title: "forged"
    })
  );
});
