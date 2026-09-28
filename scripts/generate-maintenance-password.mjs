import crypto from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error("用法：node scripts/generate-maintenance-password.mjs <密碼>");
  process.exit(1);
}

const N = 16384;
const r = 8;
const p = 1;
const salt = crypto.randomBytes(16);
const digest = crypto.scryptSync(password, salt, 32, {
  N,
  r,
  p,
  maxmem: 128 * 1024 * 1024
});

console.log("MAINTENANCE_PASSWORD_HASH=" + [
  "scrypt", N, r, p, salt.toString("hex"), digest.toString("hex")
].join("$"));
