const { getType } = require("../src/utils/format");
const { setOptions } = require("./options");
const { loadConfig } = require("./config");
const { checkAndUpdateVersion } = require("../func/checkUpdate");
const loginHelper = require("./loginHelper");
const logger = require("../func/logger");
const { DEFAULT_IDENTITY } = require("../src/utils/clientIdentity");

const { config } = loadConfig();
// HIGH-01 FIX: استخدم || {} بدلاً من الإسناد المباشر حتى لا تُمحى الخصائص
// الموجودة مسبقاً مثل _errorHandlersInstalled، مما كان يُسبّب TypeError عند
// قراءة global.fca._errorHandlersInstalled في الـ guard التالي.
global.fca = global.fca || {};
global.fca.config = config;

// Global error handlers to prevent bot crashes
// Handle unhandled promise rejections (e.g., fetch timeouts, network errors)
// BUG-01 FIX: إذا سجَّل main.js handlers بالفعل، لا نسجِّل مجدداً
if (!global.fca._errorHandlersInstalled && !global.__mainErrorHandlersInstalled) {
  global.fca._errorHandlersInstalled = true;

  process.on("unhandledRejection", (reason, promise) => {
    try {
      // Check if it's a fetch/network timeout error
      if (reason && typeof reason === "object") {
        const errorCode = reason.code || reason.cause?.code;
        const errorMessage = reason.message || String(reason);

        // Suppress Sequelize instance errors (handled gracefully in getBackupModel)
        if (errorMessage.includes("No Sequelize instance passed")) {
          return; // Silently ignore - already handled
        }

        // Handle fetch timeout errors gracefully
        if (errorCode === "UND_ERR_CONNECT_TIMEOUT" ||
            errorCode === "ETIMEDOUT" ||
            errorMessage.includes("Connect Timeout") ||
            errorMessage.includes("fetch failed")) {
          logger(`Network timeout error caught (non-fatal): ${errorMessage}`, "warn");
          return; // Don't crash, just log
        }

        // Handle other network errors
        if (errorCode === "ECONNREFUSED" ||
            errorCode === "ENOTFOUND" ||
            errorCode === "ECONNRESET" ||
            errorMessage.includes("ECONNREFUSED") ||
            errorMessage.includes("ENOTFOUND")) {
          logger(`Network connection error caught (non-fatal): ${errorMessage}`, "warn");
          return; // Don't crash, just log
        }
      }

      // Include the stack (when available) - logging only `.message` made
      // real bugs impossible to trace back to where they were thrown.
      const errorDetail = reason && reason.stack ? reason.stack : (reason && reason.message ? reason.message : String(reason));
      logger(`Unhandled promise rejection (non-fatal): ${errorDetail}`, "error");
    } catch (e) {
      // Logger itself failed - fall back to stderr so this isn't silently lost.
      try { console.error("logger failed while handling unhandledRejection:", e, reason); } catch { }
    }
  });

  // Handle uncaught exceptions (last resort)
  process.on("uncaughtException", (error) => {
    try {
      const errorMessage = error.message || String(error);
      const errorCode = error.code;

      // Suppress Sequelize instance errors (handled gracefully in getBackupModel)
      if (errorMessage.includes("No Sequelize instance passed")) {
        return; // Silently ignore - already handled
      }

      // Handle fetch/network errors
      if (errorCode === "UND_ERR_CONNECT_TIMEOUT" ||
          errorCode === "ETIMEDOUT" ||
          errorMessage.includes("Connect Timeout") ||
          errorMessage.includes("fetch failed")) {
        logger(`Uncaught network timeout error (non-fatal): ${errorMessage}`, "warn");
        return; // Don't crash
      }

      // Include the stack trace - without it these were undebuggable in production.
      logger(`Uncaught exception (attempting to continue): ${error && error.stack ? error.stack : errorMessage}`, "error");
      // Note: We don't exit here to allow bot to continue running.
      // This trades crash-safety for the (small) risk of continuing in a
      // partially-inconsistent process state. If you run this under a process
      // manager (pm2/systemd) that auto-restarts on crash, consider calling
      // process.exit(1) here instead for a clean restart on truly unknown errors.
    } catch (e) {
      // Logger itself failed - fall back to stderr so this isn't silently lost.
      try { console.error("logger failed while handling uncaughtException:", e, error); } catch { }
    }
  });
}

// Prevent multiple simultaneous login attempts for the same account.
// Keyed by whatever identifies the account in loginData (email, or the
// c_user/i_user value pulled out of an appstate/cookie string) so that
// calling login() twice in a row for the same account before the first
// call resolves can't race and produce two half-initialized sessions
// fighting over the same cookies.
if (!global.fca._activeLogins) global.fca._activeLogins = new Set();

function extractLoginKey(loginData) {
  if (!loginData) return null;
  if (loginData.email) return `email:${String(loginData.email).toLowerCase()}`;
  const findUid = (str) => {
    const m = String(str || "").match(/(?:c_user|i_user)=(\d+)/);
    return m ? m[1] : null;
  };
  if (Array.isArray(loginData.appState)) {
    const c = loginData.appState.find(c => c && (c.key === "c_user" || c.key === "i_user" || c.name === "c_user" || c.name === "i_user"));
    if (c) return `uid:${c.value}`;
  } else if (typeof loginData.appState === "string") {
    const uid = findUid(loginData.appState);
    if (uid) return `uid:${uid}`;
  }
  if (loginData.Cookie) {
    const uid = findUid(loginData.Cookie);
    if (uid) return `uid:${uid}`;
  }
  return null;
}

function login(loginData, options, callback) {
  if (getType(options) === "Function" || getType(options) === "AsyncFunction") {
    callback = options;
    options = {};
  }
  const globalOptions = {
    selfListen: false,
    selfListenEvent: false,
    listenEvents: false,
    listenTyping: false,
    updatePresence: false,
    forceLogin: false,
    autoMarkRead: false,
    autoReconnect: true,
    online: true,
    emitReady: false,
    // Single source of truth for the default identity - see src/utils/clientIdentity.js.
    // This used to be hard-coded independently here (Chrome/121), in
    // module/options.js (Chrome/125), src/utils/headers.js (Chrome/139) and
    // src/api/messaging/uploadAttachment.js (Chrome/143), which meant a single
    // session could send contradictory browser-version fingerprints between
    // different requests. All four now derive from the same identity module.
    userAgent: DEFAULT_IDENTITY.userAgent
  };
  setOptions(globalOptions, options);
  let prCallback = null;
  let rejectFunc = null;
  let resolveFunc = null;
  let returnPromise = null;
  if (getType(callback) !== "Function" && getType(callback) !== "AsyncFunction") {
    returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });
    prCallback = function (error, api) {
      if (error) return rejectFunc(error);
      return resolveFunc(api);
    };
    callback = prCallback;
  }
  const loginKey = extractLoginKey(loginData);
  if (loginKey && global.fca._activeLogins.has(loginKey)) {
    const err = new Error("A login attempt for this account is already in progress.");
    err.error = "login_in_progress";
    callback(err);
    return returnPromise;
  }
  if (loginKey) global.fca._activeLogins.add(loginKey);
  const releaseLoginKey = () => { if (loginKey) global.fca._activeLogins.delete(loginKey); };
  const wrappedCallback = (error, api) => {
    releaseLoginKey();
    callback(error, api);
  };

  const proceed = () => loginHelper(loginData.appState, loginData.Cookie, loginData.email, loginData.password, globalOptions, wrappedCallback, prCallback);
  if (config && config.autoUpdate) {
    const p = checkAndUpdateVersion();
    if (p && typeof p.then === "function") {
      p.then(proceed).catch(err => { releaseLoginKey(); callback(err); });
    } else {
      proceed();
    }
  } else {
    proceed();
  }
  return returnPromise;
}

module.exports = login;
