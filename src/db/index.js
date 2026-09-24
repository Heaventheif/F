"use strict";
// قاعدة البيانات معطّلة بالكامل
export const connectDB         = async () => false;
export const disconnectDB      = async () => {};
export const flushAllAndDisconnect = async () => {};
export const saveUserData      = async () => {};
export const loadUserData      = async () => null;
export const isConnected       = () => false;

// ─ CRITICAL-01 FIX ─────────────────────────────────────────────────────────
// Context.js يستورد هاتين الدالتين ديناميكياً عبر:
//   const { addBanDB, removeBanDB } = await import("../db/index.js");
// غيابهما يُسبّب TypeError صامتاً يُعطّل كل أوامر الحظر.
// ستُستبدل هذه الـ stub بتطبيقات حقيقية عند تفعيل MongoDB.
export const addBanDB    = async (_type, _id, _by, _reason) => {};
export const removeBanDB = async (_type, _id) => {};
// ───────────────────────────────────────────────────────────────────────────

export default { connectDB, disconnectDB, flushAllAndDisconnect, isConnected, addBanDB, removeBanDB };
