"use strict";

// Connection pool — TLS session ticket reuse reduces "new client" signal
// Source: fca-unofficial analysis + hardening guide
const _https = require("https");
const _http  = require("http");
const _sharedHttpsAgent = new _https.Agent({
  keepAlive: true, keepAliveMsecs: 30_000,
  maxSockets: 4, maxFreeSockets: 2, timeout: 30_000
});
const _sharedHttpAgent = new _http.Agent({ keepAlive: true, maxSockets: 4 });


const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const jar = new CookieJar();
const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    timeout: 60000,
    validateStatus: (s) => s >= 200 && s < 600,
    maxRedirects: 5,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  })
);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  jar,
  client,
  delay,
};
