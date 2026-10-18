"use strict";

const { createMemoryTable } = require("../utils/memoryTable");

module.exports = function () {
  return createMemoryTable("userID");
};
