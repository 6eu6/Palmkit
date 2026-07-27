import { atom, map } from 'nanostores';
import Cookies from 'js-cookie';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('LogStore');

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  details?: Record<string, any>;
  category:
    | 'system'
    | 'provider'
    | 'user'
    | 'error'
    | 'api'
    | 'auth'
    | 'database'
    | 'network'
    | 'performance'
    | 'settings'
    | 'task'
    | 'update'
    | 'feature';
  subCategory?: string;
  duration?: number;
  statusCode?: number;
  source?: string;
  stack?: string;
  metadata?: {
    component?: string;
    action?: string;
    userId?: string;
    sessionId?: string;
    previousValue?: any;
    newValue?: any;
  };
}

interface LogDetails extends Record<string, any> {
  type: string;
  message: string;
}

/*
 * ROOT FIX: moved log storage from cookie to localStorage.
 *
 * OLD DESIGN (BROKEN): stored ALL logs as a JSON cookie:
 *   Cookies.set('eventLogs', JSON.stringify(currentLogs));
 * With MAX_LOGS=1000, each entry ~200-500 bytes, this cookie could reach
 * 200-500KB — FAR exceeding the browser's 4KB cookie limit. When a cookie
 * exceeds the limit, browsers silently reject ALL cookies for the domain,
 * which breaks Supabase auth (sb-*-auth-token cookie) and prevents login.
 * This is why the user couldn't access the site — the eventLogs cookie had
 * grown too large and was blocking all other cookies.
 *
 * NEW DESIGN (ROOT FIX): store logs in localStorage (no size limit issues):
 *   localStorage.setItem('palmkit_eventLogs', JSON.stringify(currentLogs))
 * Cookies are only for small values (auth tokens, session IDs).
 *
 * On load, if a legacy 'eventLogs' cookie exists, migrate it to localStorage
 * and DELETE the cookie to prevent future breakage.
 */
const MAX_LOGS = 200; // Reduced from 1000 to 200 (still plenty for debugging)
const LOGS_STORAGE_KEY = 'palmkit_eventLogs';
const MAX_STORAGE_BYTES = 500_000; // 500KB safety limit for localStorage

class LogStore {
  private _logs = map<Record<string, LogEntry>>({});
  showLogs = atom(true);
  private _readLogs = new Set<string>();

  constructor() {
    this._loadLogs();

    if (typeof window !== 'undefined') {
      this._loadReadLogs();
    }
  }

  get logs() {
    return this._logs;
  }

  private _loadLogs() {
    /*
     * MIGRATION: if a legacy 'eventLogs' cookie exists, migrate it to
     * localStorage and DELETE the cookie. This prevents the cookie from
     * growing too large and blocking all other cookies (the root cause
     * of the "can't access the site" bug).
     */
    if (typeof document !== 'undefined') {
      const legacyCookie = Cookies.get('eventLogs');

      if (legacyCookie) {
        try {
          const parsed = JSON.parse(legacyCookie);
          this._logs.set(parsed);

          // Save to localStorage (the new home)
          try {
            localStorage.setItem(LOGS_STORAGE_KEY, legacyCookie);
          } catch {
            // localStorage might be full — clear old logs and start fresh
            this._logs.set({});
          }
        } catch {
          // Corrupted cookie — start fresh
          this._logs.set({});
        }

        // DELETE the legacy cookie — this is the critical fix!
        Cookies.remove('eventLogs', { path: '/' });
        logger.info('Migrated eventLogs from cookie to localStorage (root fix for login issue)');

        return;
      }
    }

    // Load from localStorage (the new storage location)
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOGS_STORAGE_KEY);

        if (saved) {
          this._logs.set(JSON.parse(saved));
        }
      } catch {
        // Corrupted localStorage — start fresh
        this._logs.set({});
      }
    }
  }

  private _loadReadLogs() {
    if (typeof window === 'undefined') {
      return;
    }

    const savedReadLogs = localStorage.getItem('palmkit_read_logs');

    if (savedReadLogs) {
      try {
        const parsedReadLogs = JSON.parse(savedReadLogs);
        this._readLogs = new Set(parsedReadLogs);
      } catch (error) {
        logger.error('Failed to parse read logs:', error);
      }
    }
  }

  /*
   * ROOT FIX: save to localStorage (NOT cookie).
   * Cookies have a 4KB limit — storing 200 log entries as JSON
   * would exceed this and break all cookies (including auth).
   */
  private _saveLogs() {
    if (typeof window === 'undefined') {
      return;
    }

    const currentLogs = this._logs.get();

    try {
      const serialized = JSON.stringify(currentLogs);

      // Safety check: if serialized logs exceed the limit, trim aggressively
      if (serialized.length > MAX_STORAGE_BYTES) {
        // Keep only the most recent 50 logs
        const sorted = Object.entries(currentLogs)
          .sort(([, a], [, b]) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 50);
        this._logs.set(Object.fromEntries(sorted));
        localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(Object.fromEntries(sorted)));
      } else {
        localStorage.setItem(LOGS_STORAGE_KEY, serialized);
      }
    } catch {
      // localStorage might be full (quota exceeded) — clear old logs
      try {
        localStorage.removeItem(LOGS_STORAGE_KEY);
      } catch {
        // give up silently — logs are best-effort, never crash the app
      }
    }
  }

  private _saveReadLogs() {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem('palmkit_read_logs', JSON.stringify(Array.from(this._readLogs)));
  }

  private _generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private _trimLogs() {
    const currentLogs = Object.entries(this._logs.get());

    if (currentLogs.length > MAX_LOGS) {
      const sortedLogs = currentLogs.sort(
        ([, a], [, b]) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      const newLogs = Object.fromEntries(sortedLogs.slice(0, MAX_LOGS));
      this._logs.set(newLogs);
    }
  }

  private _addLog(
    message: string,
    level: LogEntry['level'],
    category: LogEntry['category'],
    details?: Record<string, any>,
    metadata?: LogEntry['metadata'],
  ) {
    const id = this._generateId();
    const entry: LogEntry = {
      id,
      timestamp: new Date().toISOString(),
      level,
      message,
      details,
      category,
      metadata,
    };

    this._logs.setKey(id, entry);
    this._trimLogs();
    this._saveLogs();

    return id;
  }

  private _addApiLog(
    message: string,
    method: string,
    url: string,
    details: {
      method: string;
      url: string;
      statusCode: number;
      duration: number;
      request: any;
      response: any;
    },
  ) {
    const statusCode = details.statusCode;
    return this._addLog(message, statusCode >= 400 ? 'error' : 'info', 'api', details, {
      component: 'api',
      action: method,
    });
  }

  logSystem(message: string, details?: Record<string, any>) {
    return this._addLog(message, 'info', 'system', details);
  }

  logProvider(message: string, details?: Record<string, any>) {
    return this._addLog(message, 'info', 'provider', details);
  }

  logUserAction(message: string, details?: Record<string, any>) {
    return this._addLog(message, 'info', 'user', details);
  }

  logAPIRequest(endpoint: string, method: string, duration: number, statusCode: number, details?: Record<string, any>) {
    const message = `${method} ${endpoint} - ${statusCode} (${duration}ms)`;
    const level = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warning' : 'info';

    return this._addLog(message, level, 'api', {
      ...details,
      endpoint,
      method,
      duration,
      statusCode,
      timestamp: new Date().toISOString(),
    });
  }

  logAuth(
    action: 'login' | 'logout' | 'token_refresh' | 'key_validation',
    success: boolean,
    details?: Record<string, any>,
  ) {
    const message = `Auth ${action} - ${success ? 'Success' : 'Failed'}`;
    const level = success ? 'info' : 'error';

    return this._addLog(message, level, 'auth', {
      ...details,
      action,
      success,
      timestamp: new Date().toISOString(),
    });
  }

  logNetworkStatus(status: 'online' | 'offline' | 'reconnecting' | 'connected', details?: Record<string, any>) {
    const message = `Network ${status}`;
    const level = status === 'offline' ? 'error' : status === 'reconnecting' ? 'warning' : 'info';

    return this._addLog(message, level, 'network', {
      ...details,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  logDatabase(operation: string, success: boolean, duration: number, details?: Record<string, any>) {
    const message = `DB ${operation} - ${success ? 'Success' : 'Failed'} (${duration}ms)`;
    const level = success ? 'info' : 'error';

    return this._addLog(message, level, 'database', {
      ...details,
      operation,
      success,
      duration,
      timestamp: new Date().toISOString(),
    });
  }

  logError(message: string, error?: Error | unknown, details?: Record<string, any>) {
    const errorDetails =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            ...details,
          }
        : { error, ...details };

    return this._addLog(message, 'error', 'error', errorDetails);
  }

  logWarning(message: string, details?: Record<string, any>) {
    return this._addLog(message, 'warning', 'system', details);
  }

  logDebug(message: string, details?: Record<string, any>) {
    return this._addLog(message, 'debug', 'system', details);
  }

  clearLogs() {
    this._logs.set({});
    this._saveLogs();
  }

  getLogs() {
    return Object.values(this._logs.get()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  getFilteredLogs(level?: LogEntry['level'], category?: LogEntry['category'], searchQuery?: string) {
    return this.getLogs().filter((log) => {
      const matchesLevel = !level || level === 'debug' || log.level === level;
      const matchesCategory = !category || log.category === category;
      const matchesSearch =
        !searchQuery ||
        log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        JSON.stringify(log.details).toLowerCase().includes(searchQuery.toLowerCase());

      return matchesLevel && matchesCategory && matchesSearch;
    });
  }

  markAsRead(logId: string) {
    this._readLogs.add(logId);
    this._saveReadLogs();
  }

  isRead(logId: string): boolean {
    return this._readLogs.has(logId);
  }

  clearReadLogs() {
    this._readLogs.clear();
    this._saveReadLogs();
  }

  logApiCall(
    method: string,
    endpoint: string,
    statusCode: number,
    duration: number,
    requestData?: any,
    responseData?: any,
  ) {
    return this._addLog(
      `API ${method} ${endpoint}`,
      statusCode >= 400 ? 'error' : 'info',
      'api',
      {
        method,
        endpoint,
        statusCode,
        duration,
        request: requestData,
        response: responseData,
      },
      {
        component: 'api',
        action: method,
      },
    );
  }

  logNetworkRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    requestData?: any,
    responseData?: any,
  ) {
    return this._addLog(
      `${method} ${url}`,
      statusCode >= 400 ? 'error' : 'info',
      'network',
      {
        method,
        url,
        statusCode,
        duration,
        request: requestData,
        response: responseData,
      },
      {
        component: 'network',
        action: method,
      },
    );
  }

  logAuthEvent(event: string, success: boolean, details?: Record<string, any>) {
    return this._addLog(
      `Auth ${event} ${success ? 'succeeded' : 'failed'}`,
      success ? 'info' : 'error',
      'auth',
      details,
      {
        component: 'auth',
        action: event,
      },
    );
  }

  logPerformance(operation: string, duration: number, details?: Record<string, any>) {
    return this._addLog(
      `Performance: ${operation}`,
      duration > 1000 ? 'warning' : 'info',
      'performance',
      {
        operation,
        duration,
        ...details,
      },
      {
        component: 'performance',
        action: 'metric',
      },
    );
  }

  logErrorWithStack(error: Error, category: LogEntry['category'] = 'error', details?: Record<string, any>) {
    return this._addLog(
      error.message,
      'error',
      category,
      {
        ...details,
        name: error.name,
        stack: error.stack,
      },
      {
        component: category,
        action: 'error',
      },
    );
  }

  refreshLogs() {
    const currentLogs = this._logs.get();
    this._logs.set({ ...currentLogs });
  }

  logInfo(message: string, details: LogDetails) {
    return this._addLog(message, 'info', 'system', details);
  }

  logSuccess(message: string, details: LogDetails) {
    return this._addLog(message, 'info', 'system', { ...details, success: true });
  }

  logApiRequest(
    method: string,
    url: string,
    details: {
      method: string;
      url: string;
      statusCode: number;
      duration: number;
      request: any;
      response: any;
    },
  ) {
    return this._addApiLog(`API ${method} ${url}`, method, url, details);
  }

  logSettingsChange(component: string, setting: string, oldValue: any, newValue: any) {
    return this._addLog(
      `Settings changed in ${component}: ${setting}`,
      'info',
      'settings',
      {
        setting,
        previousValue: oldValue,
        newValue,
      },
      {
        component,
        action: 'settings_change',
        previousValue: oldValue,
        newValue,
      },
    );
  }

  logFeatureToggle(featureId: string, enabled: boolean) {
    return this._addLog(
      `Feature ${featureId} ${enabled ? 'enabled' : 'disabled'}`,
      'info',
      'feature',
      { featureId, enabled },
      {
        component: 'features',
        action: 'feature_toggle',
      },
    );
  }

  logTaskOperation(taskId: string, operation: string, status: string, details?: any) {
    return this._addLog(
      `Task ${taskId}: ${operation} - ${status}`,
      'info',
      'task',
      { taskId, operation, status, ...details },
      {
        component: 'task-manager',
        action: 'task_operation',
      },
    );
  }

  logProviderAction(provider: string, action: string, success: boolean, details?: any) {
    return this._addLog(
      `Provider ${provider}: ${action} - ${success ? 'Success' : 'Failed'}`,
      success ? 'info' : 'error',
      'provider',
      { provider, action, success, ...details },
      {
        component: 'providers',
        action: 'provider_action',
      },
    );
  }

  logPerformanceMetric(component: string, operation: string, duration: number, details?: any) {
    return this._addLog(
      `Performance: ${component} - ${operation} took ${duration}ms`,
      duration > 1000 ? 'warning' : 'info',
      'performance',
      { component, operation, duration, ...details },
      {
        component,
        action: 'performance_metric',
      },
    );
  }
}

export const logStore = new LogStore();
