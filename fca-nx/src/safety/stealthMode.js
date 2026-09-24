"use strict";
/**
 * stealthMode.js — Rate limiting with human-like pauses
 * Source: fca-unofficial lib/safety/StealthMode.js (adapted to CJS)
 * Conservative defaults: 20 req/min, 2000 req/day, 2% random pause probability
 */
class StealthMode {
  constructor(opts = {}) {
    this.opts = {
      maxRequestsPerMinute: 20,
      enableRandomPauses: true,
      pauseProbability: 0.02,
      minPauseMinutes: 1,
      maxPauseMinutes: 5,
      dailyRequestLimit: 2000,
      ...opts
    };
    this.history = [];
    this.dailyCount = 0;
    this.lastReset = Date.now();
    this.inPause = false;
    this.pauseUntil = 0;
  }

  canProceed() {
    const now = Date.now();
    if (this.inPause) {
      if (now < this.pauseUntil) return { allowed: false, waitMs: this.pauseUntil - now, reason: "Human pause active" };
      this.inPause = false;
    }
    if (now - this.lastReset > 86400000) { this.dailyCount = 0; this.lastReset = now; }
    if (this.dailyCount >= this.opts.dailyRequestLimit) return { allowed: false, waitMs: 3600000, reason: "Daily limit reached" };
    this.history = this.history.filter(ts => now - ts < 60000);
    if (this.history.length >= this.opts.maxRequestsPerMinute) return { allowed: false, waitMs: 60000 - (now - this.history[0]) + 1000, reason: "Rate limit exceeded" };
    return { allowed: true, waitMs: 0 };
  }

  recordAction() {
    this.history.push(Date.now());
    this.dailyCount++;
    if (this.opts.enableRandomPauses && Math.random() < this.opts.pauseProbability) {
      const dur = Math.floor(Math.random() * (this.opts.maxPauseMinutes - this.opts.minPauseMinutes) * 60000) + this.opts.minPauseMinutes * 60000;
      this.inPause = true;
      this.pauseUntil = Date.now() + dur;
    }
  }

  async waitIfNeeded() {
    while (true) {
      const s = this.canProceed();
      if (s.allowed) { this.recordAction(); return; }
      await new Promise(r => setTimeout(r, s.waitMs));
    }
  }
}

module.exports = { StealthMode };
