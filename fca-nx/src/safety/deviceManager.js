"use strict";
/**
 * deviceManager.js — Stable device identity persistence
 * Source: fca-unofficial lib/safety/device-manager.js (adapted to CJS)
 * Ensures the same UA/deviceId is used across restarts for the same account.
 */
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
];

class DeviceManager {
  constructor(options = {}) {
    const rawPath = options.filePath ?? path.join(process.env.STATE_DIR || process.cwd(), ".device-profile.json");
    const resolved = path.resolve(rawPath);
    const allowed = path.resolve(process.cwd());
    if (!resolved.startsWith(allowed + path.sep) && resolved !== allowed) {
      throw new Error(`DeviceManager: filePath outside working directory: ${resolved}`);
    }
    this.options = { enabled: options.enabled !== false, filePath: resolved, rotateOnStart: options.rotateOnStart ?? false };
    this._profile = null;
  }

  async init() {
    if (!this.options.enabled) return this;
    try {
      if (!this.options.rotateOnStart && fs.existsSync(this.options.filePath)) {
        this._profile = JSON.parse(fs.readFileSync(this.options.filePath, "utf8"));
      } else {
        this._profile = this._generate();
        this._save();
      }
    } catch (_) {
      this._profile = this._generate();
    }
    return this;
  }

  /** Returns a deterministic identity for a given account UID */
  static forAccount(uid) {
    const pool = DEFAULT_USER_AGENTS;
    const hash = String(uid).split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
    return pool[Math.abs(hash) % pool.length];
  }

  get userAgent() { return this._profile?.userAgent ?? DEFAULT_USER_AGENTS[0]; }
  get deviceId()  { return this._profile?.deviceId  ?? "unknown"; }
  get profile()   { return { ...this._profile }; }

  _generate() {
    const id = crypto.randomUUID().replace(/-/g, "");
    return {
      deviceId: `fca_${id}`,
      familyDeviceId: `fca_fam_${crypto.randomUUID().replace(/-/g, "")}`,
      userAgent: DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)],
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
  }

  _save() {
    try {
      if (!this._profile) return;
      this._profile.lastSeenAt = new Date().toISOString();
      const dir = path.dirname(this.options.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.options.filePath, JSON.stringify(this._profile, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch (_) {}
  }
}

module.exports = { DeviceManager };
