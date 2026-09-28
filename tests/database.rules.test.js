const fs = require("node:fs");
const test = require("node:test");
const serialTest = (name, fn) => test(name, { concurrency: false }, fn);
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
                chat__moderate: true,
                audit__read: true,
                audit__write: true,
                audit__delete: true
              }
            }
          },
          roleByUid: {
            [ADMIN_UID]: "custom"
          },
          permissionsByUid: {},
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

serialTest("reports: manually submitted reports can store verification but cannot self-resolve before approval", async () => {
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

serialTest("reports: authenticated user can create only their own report", async () => {
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

serialTest("reports: automatic bug records can be reopened and updated only by their owner", async () => {
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

serialTest("report history: owner and admin can append, non-owner cannot append, admin can delete", async () => {
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
serialTest("chat moderation: permitted admin can read and delete messages, viewer cannot moderate", async () => {
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


serialTest("room chat rich metadata: members can reply and edit their own messages, owners can pin, others cannot", async () => {
  const user = db(USER_UID, userToken);
  const other = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });
  const master = db(MASTER_UID, masterToken);

  await assertSucceeds(master.ref("rooms/RICH01").set({
    owner: USER_UID,
    name: "Rich Chat Test",
    sourceType: "youtube",
    video: {
      id: "rich-chat-video",
      platform: "youtube",
      title: "Rich Chat",
      thumbnail: "",
      channel: ""
    }
  }));

  await assertSucceeds(master.ref("members/RICH01/" + USER_UID).set({
    name: "User",
    joinedAt: Date.now(),
    online: true,
    lastSeen: Date.now()
  }));
  await assertSucceeds(master.ref("members/RICH01/" + OTHER_UID).set({
    name: "Other",
    joinedAt: Date.now(),
    online: true,
    lastSeen: Date.now()
  }));

  const messageRef = user.ref("chat/RICH02/reaction-message");
  await assertSucceeds(messageRef.set({
    uid: USER_UID,
    name: "User",
    type: "text",
    text: "原始房間訊息",
    createdAt: Date.now()
  }));

  const replyRef = user.ref("roomChatReplies/RICH01").push();
  await assertSucceeds(replyRef.set({
    uid: USER_UID,
    name: "User",
    replyToId: messageRef.key,
    replyToName: "User",
    replyToText: "原始房間訊息",
    replyToType: "text",
    text: "我的回覆",
    createdAt: Date.now()
  }));

  await assertSucceeds(user.ref("roomChatEdits/RICH01/" + messageRef.key).set({
    uid: USER_UID,
    text: "編輯後的房間訊息",
    editedAt: Date.now()
  }));

  await assertSucceeds(user.ref("roomChatPins/RICH01/" + messageRef.key).set({
    pinned: true,
    uid: USER_UID,
    updatedAt: Date.now()
  }));

  await assertFails(other.ref("roomChatEdits/RICH01/" + messageRef.key).set({
    uid: OTHER_UID,
    text: "不應該能改",
    editedAt: Date.now()
  }));

  await assertFails(other.ref("roomChatPins/RICH01/" + messageRef.key).set({
    pinned: false,
    uid: OTHER_UID,
    updatedAt: Date.now()
  }));

  await assertSucceeds(master.ref("rooms/RICH01").remove());
});

serialTest("room chat reactions: members may change their own reaction only", async () => {
  const user = db(USER_UID, userToken);
  const other = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });
  const master = db(MASTER_UID, masterToken);

  await assertSucceeds(master.ref("rooms/RICH02").set({
    owner: USER_UID,
    name: "Reaction Test",
    sourceType: "youtube",
    video: {
      id: "reaction-video",
      platform: "youtube",
      title: "Reaction",
      thumbnail: "",
      channel: ""
    }
  }));
  await assertSucceeds(master.ref("members/RICH02/" + USER_UID).set({
    name: "User",
    joinedAt: Date.now(),
    online: true,
    lastSeen: Date.now()
  }));
  await assertSucceeds(master.ref("chat/RICH02/reaction-message").set({
    uid: USER_UID,
    name: "User",
    type: "text",
    text: "reaction target",
    createdAt: Date.now()
  }));

  const ref = user.ref("roomChatReactions/RICH02/reaction-message/" + USER_UID);
  await assertSucceeds(ref.set({
    emoji: "👍",
    updatedAt: Date.now()
  }));

  await assertSucceeds(ref.remove());

  await assertFails(
    other.ref("roomChatReactions/RICH02/reaction-message/" + USER_UID).set({
      emoji: "🔥",
      updatedAt: Date.now()
    })
  );

  await assertSucceeds(master.ref("rooms/RICH02").remove());
});

serialTest("reports: normal users cannot read the collection", async () => {
  await assertFails(
    db(USER_UID, userToken).ref("reports").once("value")
  );
});

serialTest("reports: admin and viewer can read, but viewer cannot modify", async () => {
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

serialTest("chat moderation deletion can be atomic with its Audit Log", async () => {
  const admin = db(ADMIN_UID, adminToken);
  const user = db(USER_UID, userToken);
  const messageKey = user.ref("chat/ABC123").push().key;
  const auditKey = admin.ref("admin/auditLogs").push().key;
  assert.ok(messageKey);
  assert.ok(auditKey);

  await assertSucceeds(user.ref("chat/ABC123/" + messageKey).set({
    uid: USER_UID,
    name: "User",
    type: "text",
    text: "atomic moderation target",
    createdAt: Date.now()
  }));

  await assertSucceeds(admin.ref().update({
    ["chat/ABC123/" + messageKey]: null,
    ["admin/auditLogs/" + auditKey]: {
      action: "chat.message.delete",
      actorUid: ADMIN_UID,
      actorEmail: "admin@example.com",
      actorRole: "custom",
      targetUid: USER_UID,
      targetName: "User",
      details: "atomic chat moderation test",
      createdAt: Date.now()
    }
  }));
});

serialTest("atomic access and report updates require matching Audit permissions", async () => {
  const master = db(MASTER_UID, masterToken);
  const admin = db(ADMIN_UID, adminToken);
  const viewer = db(VIEWER_UID, viewerToken);
  const reportHistoryId = "atomic-history";
  const historyKey = admin.ref("reportHistoryEvents/" + reportHistoryId).push().key;
  const auditKey = admin.ref("admin/auditLogs").push().key;
  assert.ok(historyKey);
  assert.ok(auditKey);

  const atomicUpdates = {
    ["admin/access/restrictionsByUid/" + OTHER_UID + "/chat__send"]: {
      enabled: true,
      permanent: false,
      until: Date.now() + 3600000,
      reason: "atomic test restriction",
      createdAt: Date.now(),
      createdByUid: ADMIN_UID,
      createdByEmail: "admin@example.com"
    },
    ["reportHistoryEvents/" + reportHistoryId + "/" + historyKey]: {
      reportId: reportHistoryId,
      event: "manual_status",
      createdAt: Date.now(),
      actorUid: ADMIN_UID,
      actorEmail: "admin@example.com",
      source: "admin",
      details: "atomic report history"
    },
    ["admin/auditLogs/" + auditKey]: {
      action: "access.user.restriction",
      actorUid: ADMIN_UID,
      actorEmail: "admin@example.com",
      actorRole: "custom",
      targetUid: OTHER_UID,
      targetName: "atomic test",
      details: "atomic access test",
      createdAt: Date.now()
    }
  };

  await assertSucceeds(admin.ref().update(atomicUpdates));
  await assertSucceeds(master.ref("admin/access/restrictionsByUid/" + OTHER_UID + "/chat__send").remove());
  await assertFails(viewer.ref().update({
    ["admin/access/restrictionsByUid/" + OTHER_UID + "/chat__send"]: {
      enabled: true,
      permanent: false,
      until: Date.now() + 3600000,
      reason: "viewer should fail",
      createdAt: Date.now(),
      createdByUid: VIEWER_UID,
      createdByEmail: "viewer@example.com"
    },
    ["admin/auditLogs/" + viewer.ref("admin/auditLogs").push().key]: {
      action: "access.user.restriction",
      actorUid: VIEWER_UID,
      actorEmail: "viewer@example.com",
      actorRole: "viewer",
      targetUid: OTHER_UID,
      targetName: "viewer test",
      details: "must be rejected",
      createdAt: Date.now()
    }
  }));
});

serialTest("audit logs: admin can append, cannot modify, and audit.delete controls deletion", async () => {
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

serialTest("audit logs: viewer can read but cannot append", async () => {
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

serialTest("2.0 access control: custom administrator can manage user blocks", async () => {
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

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + OTHER_UID + "/users__restrict"
  ).set("deny"));

  await assertFails(customAdmin.ref("admin/blocksByUid/" + USER_UID).set({
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

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + OTHER_UID + "/users__restrict"
  ).remove());

  await assertSucceeds(master.ref("admin/access/roleByUid/" + OTHER_UID).remove());
  await assertSucceeds(master.ref("admin/access/roles/block-manager").remove());
});

serialTest("2.0 access control: user restriction and block writes require audit.write", async () => {
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

serialTest("room 2.0: application lifecycle and cohost role are owner controlled", async () => {
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

serialTest("chat media messages: image and audio payloads pass validation", async () => {
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

serialTest("2.0 access control: custom admin role can read and write its permitted admin data", async () => {
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

serialTest("2.0 access control: master can manage roles, permissions, restrictions and feature flags", async () => {
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

serialTest("2.0 access control: per-user deny overrides legacy admin and allow grants a single permission", async () => {
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

serialTest("2.0 access control: explicit users.restrict deny blocks legacy admin restriction writes", async () => {
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

serialTest("2.0 access control: ai.agent is independently assignable", async () => {
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

serialTest("2.0 access control: management permissions cover maintenance, feature flags and settings", async () => {
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

serialTest("2.0 access control: viewer cannot modify policy and user cannot forge their restriction", async () => {
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

serialTest("2.0 access control: server-side restriction and feature flag block room writes", async () => {
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
  await assertSucceeds(
    db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true})
      .ref("admin/featureFlags/rooms__manage").remove()
  );
});

serialTest("2.0 access control: audit.delete is separate from audit.write", async () => {
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

serialTest("2.0 access control: per-user deny overrides room, chat, queue and playback permissions", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const user = db(USER_UID, userToken);
  const other = db(OTHER_UID, {
    email: "other@example.com",
    email_verified: true
  });

  const roomRef = user.ref("rooms/ODNY01");
  await assertSucceeds(roomRef.set({
    owner: USER_UID,
    name: "Override Guard",
    sourceType: "youtube",
    video: {
      id: "override-video",
      platform: "youtube",
      title: "Override",
      thumbnail: "",
      channel: ""
    }
  }));

  await assertSucceeds(other.ref("members/ODNY01/" + OTHER_UID).set({
    name: "Other",
    joinedAt: Date.now(),
    online: true,
    lastSeen: Date.now()
  }));

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + OTHER_UID + "/room__join"
  ).set("deny"));

  await assertSucceeds(other.ref("members/ODNY01/" + OTHER_UID).remove());

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + OTHER_UID + "/room__join"
  ).remove());

  await assertSucceeds(other.ref("members/ODNY01/" + OTHER_UID).set({
    name: "Other",
    joinedAt: Date.now(),
    online: true,
    lastSeen: Date.now()
  }));

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + OTHER_UID + "/chat__send"
  ).set("deny"));

  await assertFails(other.ref("chat/ODNY01/override-chat").set({
    uid: OTHER_UID,
    name: "Other",
    type: "text",
    text: "blocked by override",
    createdAt: Date.now()
  }));

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + OTHER_UID + "/chat__send"
  ).remove());

  await assertSucceeds(other.ref("chat/ODNY01/override-chat-ok").set({
    uid: OTHER_UID,
    name: "Other",
    type: "text",
    text: "allowed after override removal",
    createdAt: Date.now()
  }));

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + USER_UID + "/room__queue"
  ).set("deny"));

  await assertFails(user.ref("queue/ODNY01/override-queue").set({
    id: "override-queue-video",
    platform: "youtube",
    title: "Override Queue",
    thumbnail: "",
    channel: "",
    addedBy: USER_UID,
    addedByName: "User",
    addedAt: Date.now()
  }));

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + USER_UID + "/room__queue"
  ).remove());

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + USER_UID + "/sync__control"
  ).set("deny"));

  await assertFails(user.ref("playback/ODNY01").set({
    action: "pause",
    position: 0,
    videoId: "override-video",
    platform: "youtube",
    issuedAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: USER_UID,
    eventId: "override-playback",
    playing: false,
    playbackRate: 1
  }));

  await assertSucceeds(master.ref(
    "admin/access/permissionsByUid/" + USER_UID + "/sync__control"
  ).remove());

  await assertSucceeds(user.ref("playback/ODNY01").set({
    action: "pause",
    position: 0,
    videoId: "override-video",
    platform: "youtube",
    issuedAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: USER_UID,
    eventId: "override-playback-ok",
    playing: false,
    playbackRate: 1
  }));

  await assertSucceeds(master.ref("rooms/ODNY01").remove());
  await assertSucceeds(master.ref("admin/access/permissionsByUid/" + OTHER_UID + "/chat__send").remove());
});
serialTest("2.0 access control: room.join restriction and feature flag block membership creation", async () => {
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

serialTest("2.0 access control: chat.dm restriction and feature flag block private-chat writes", async () => {
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

serialTest("site settings: authenticated users can read, only master can write", async () => {
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

serialTest("blocks: blocked user cannot mutate their own higher-role block", async () => {
  await assertFails(
    db(USER_UID, userToken).ref("admin/blocksByUid/" + USER_UID).remove()
  );
});

serialTest("blocks: disabled accounts cannot write site data", async () => {
  const master = db(MASTER_UID, {email: MASTER_EMAIL, email_verified: true});
  const user = db(USER_UID, userToken);

  await assertSucceeds(master.ref("admin/blocksByUid/" + USER_UID).set({
    uid: USER_UID,
    email: "user@example.com",
    displayName: "User",
    permanent: false,
    blockedUntil: Date.now() + 3600000,
    blockedAt: Date.now(),
    blockedByUid: MASTER_UID,
    blockedByEmail: MASTER_EMAIL,
    blockedByRole: "master"
  }));

  await assertFails(user.ref("rooms/ABC123").remove());

  await assertFails(user.ref("chat/ABC123/blocked-message").set({
    uid: USER_UID,
    name: "User",
    type: "text",
    text: "blocked",
    createdAt: Date.now()
  }));

  await assertFails(user.ref("queue/ABC123/blocked-queue").set({
    id: "blocked-video",
    platform: "youtube",
    title: "Blocked",
    thumbnail: "",
    channel: "",
    addedBy: USER_UID,
    addedByName: "User",
    addedAt: Date.now()
  }));

  await assertFails(user.ref("playback/ABC123").set({
    action: "pause",
    position: 0,
    videoId: "video-1",
    platform: "youtube",
    issuedAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: USER_UID,
    eventId: "blocked-playback",
    playing: false,
    playbackRate: 1
  }));

  await assertSucceeds(master.ref("admin/blocksByUid/" + USER_UID).remove());
});

serialTest("blocks: master account cannot be blocked", async () => {
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

serialTest("unauthenticated users cannot access protected admin paths", async () => {
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
