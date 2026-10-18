"use strict";

// Small in-process table (replaces the old Sequelize/SQLite cache).
// Rows mimic the old shape: { [idField]: id, data, updatedAt, createdAt }.
const MAX_ROWS = 5000;

function validateId(value, field) {
  if (value == null) throw new Error(`${field} is required and cannot be undefined`);
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Invalid ${field}: must be a string or number`);
  }
  return String(value);
}

function createMemoryTable(idField) {
  const rows = new Map();

  function put(id, patch) {
    const now = new Date();
    const prev = rows.get(id);
    const row = Object.assign({ [idField]: id, createdAt: prev ? prev.createdAt : now }, prev, patch, { updatedAt: now });
    rows.delete(id);
    rows.set(id, row);
    if (rows.size > MAX_ROWS) rows.delete(rows.keys().next().value);
    return row;
  }

  return {
    async create(id, data) {
      id = validateId(id, idField);
      if (rows.has(id)) return { [idField === "userID" ? "user" : "thread"]: rows.get(id), created: false };
      return { [idField === "userID" ? "user" : "thread"]: put(id, data || {}), created: true };
    },
    async get(id) {
      id = validateId(id, idField);
      return rows.get(id) || null;
    },
    async update(id, data) {
      id = validateId(id, idField);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid data: must be a non-empty object");
      const existed = rows.has(id);
      return { [idField === "userID" ? "user" : "thread"]: put(id, data), created: !existed };
    },
    async del(id) { return rows.delete(validateId(id, idField)) ? 1 : 0; },
    async delAll() { const n = rows.size; rows.clear(); return n; },
    async getAll() { return Array.from(rows.values()); }
  };
}

module.exports = { createMemoryTable };
