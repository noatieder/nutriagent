/**
 * ============================================================
 * NUTRIAGENT — nutrilogger.js
 * Centralized debug logger — loaded FIRST before all other scripts.
 *
 * Usage from browser console:
 *   nutriLogs()          — print all captured log entries
 *   nutriLogs('ERROR')   — filter by level
 *   nutriLogs('API')     — filter by source
 *   window.NutriLogger.clear()  — reset buffer
 * ============================================================
 */

(function () {
  'use strict';

  const MAX_ENTRIES = 300;

  const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

  const STYLES = {
    DEBUG: 'color:#888',
    INFO:  'color:#22d3ee;font-weight:bold',
    WARN:  'color:#f59e0b;font-weight:bold',
    ERROR: 'color:#ef4444;font-weight:bold',
  };

  const entries = [];

  // Relay to local dev server when running on localhost (fire-and-forget)
  const DEV_LOG_URL = (() => {
    try {
      const h = window.location.hostname;
      return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:3131/log' : null;
    } catch { return null; }
  })();

  function relayToTerminal(level, source, message, data, timestamp) {
    if (!DEV_LOG_URL) return;
    try {
      fetch(DEV_LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: level.toLowerCase(), module: source, message, data, timestamp }),
      }).catch(() => {}); // silent fail — server may not be running
    } catch { /* silent */ }
  }

  function addEntry(level, source, message, data) {
    const entry = {
      ts:        new Date().toISOString().slice(11, 23),  // HH:MM:SS.mmm
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      data,
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();

    // Mirror to browser console with styling
    const prefix = `[${entry.ts}][${level}][${source}]`;
    if (data !== undefined) {
      console.log(`%c${prefix} ${message}`, STYLES[level], data);
    } else {
      console.log(`%c${prefix} ${message}`, STYLES[level]);
    }

    // Relay to terminal log server (dev only)
    relayToTerminal(level, source, message, data, entry.timestamp);
  }

  const NutriLogger = {
    debug(source, message, data) { addEntry('DEBUG', source, message, data); },
    info (source, message, data) { addEntry('INFO',  source, message, data); },
    warn (source, message, data) { addEntry('WARN',  source, message, data); },
    error(source, message, data) { addEntry('ERROR', source, message, data); },

    dump(filter) {
      const filtered = filter
        ? entries.filter(e => e.level === filter.toUpperCase() || e.source.toUpperCase().includes(filter.toUpperCase()))
        : entries;

      console.group(`🔍 NutriAgent Logs (${filtered.length}/${entries.length} entries)${filter ? ` — filter: "${filter}"` : ''}`);
      filtered.forEach(e => {
        const line = `[${e.ts}][${e.level}][${e.source}] ${e.message}`;
        if (e.data !== undefined) {
          console.groupCollapsed(`%c${line}`, STYLES[e.level]);
          console.log(e.data);
          console.groupEnd();
        } else {
          console.log(`%c${line}`, STYLES[e.level]);
        }
      });
      console.groupEnd();
      return filtered;
    },

    clear() {
      entries.length = 0;
      console.log('%c[NutriLogger] Log buffer cleared', 'color:#888');
    },

    get entries() { return [...entries]; },
  };

  // Global access
  window.NutriLogger = NutriLogger;

  // Shortcut: nutriLogs() or nutriLogs('ERROR') or nutriLogs('API')
  window.nutriLogs = (filter) => NutriLogger.dump(filter);

  // Intercept unhandled errors
  window.addEventListener('error', (event) => {
    NutriLogger.error('WINDOW', `Unhandled error: ${event.message}`, {
      file:    event.filename,
      line:    event.lineno,
      col:     event.colno,
      stack:   event.error?.stack,
    });
  });

  // Intercept unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    NutriLogger.error('PROMISE', `Unhandled rejection: ${event.reason}`, {
      reason: String(event.reason),
      stack:  event.reason?.stack,
    });
  });

  NutriLogger.info('LOGGER', 'NutriAgent Logger initialized — type nutriLogs() in console to view logs');
})();
