"use strict";

const login = require("./module/login");

// CommonJS default export: the login function (classic FCA compatible)
module.exports = login;
module.exports.login = login;
module.exports.default = login;
