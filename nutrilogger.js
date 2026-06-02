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

  function addEntry(level, source, message, data) {
    const entry = {
      ts:      new Date().toISOString().slice(11, 23),  // HH:MM:SS.mmm
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
