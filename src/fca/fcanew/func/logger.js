"use strict";

// Plain stderr logger (no colors / gradients)
module.exports = (text, type) => {
  const s = String(type || "info").toLowerCase();
  const tag = s === "warn" ? "FCA-WARN" : s === "error" ? "FCA-ERROR" : s === "info" ? "FCA" : s.toUpperCase();
  process.stderr.write(`[ ${tag} ] > ${text}\n`);
};
