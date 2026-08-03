import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('stream-recovery');

export interface StreamRecoveryOptions {
  maxRetries?: number;
  timeout?: number;
  onTimeout?: () => void;
  onRecovery?: () => void;
}

export class StreamRecoveryManager {
  private _retryCount = 0;
  private _timeoutHandle: NodeJS.Timeout | null = null;
  private _lastActivity: number = Date.now();
  private _isActive = true;

  constructor(private _options: StreamRecoveryOptions = {}) {
    this._options = {
      maxRetries: 3,
      timeout: 30000, // 30 seconds default
      ..._options,
    };
  }

  startMonitoring() {
    this._resetTimeout();
  }

  /**
   * Data is flowing — push the deadline back.
   *
   * Called once per streamed chunk, which is once per token: a page-sized
   * answer is a few thousand calls. Rescheduling the timer on every one of
   * them meant a few thousand clearTimeout/setTimeout pairs per request, all
   * to answer a question ("has anything arrived in the last two minutes?")
   * that cannot change more than once a second.
   *
   * So this only records the time. The timer is left alone, and decides for
   * itself when it fires: if data arrived since it was set, it reschedules
   * for the remaining time instead of declaring a timeout. Cheap to feed,
   * and the deadline is still measured from the last chunk rather than from
   * whenever the timer happened to be rebuilt.
   */
  updateActivity() {
    this._lastActivity = Date.now();
  }

  private _resetTimeout(delay = this._options.timeout) {
    if (this._timeoutHandle) {
      clearTimeout(this._timeoutHandle);
    }

    if (!this._isActive) {
      return;
    }

    this._timeoutHandle = setTimeout(() => {
      if (!this._isActive) {
        return;
      }

      /*
       * The timer is a floor, not a verdict. Silence is what indicates a
       * hang, so ask how long it has actually been since a chunk arrived.
       */
      const idle = Date.now() - this._lastActivity;
      const timeout = this._options.timeout ?? 30000;

      if (idle < timeout) {
        this._resetTimeout(timeout - idle);
        return;
      }

      logger.warn('Stream timeout detected');
      this._handleTimeout();
    }, delay);
  }

  private _handleTimeout() {
    if (this._retryCount >= (this._options.maxRetries || 3)) {
      logger.error('Max retries reached for stream recovery');
      this.stop();

      return;
    }

    this._retryCount++;
    logger.info(`Attempting stream recovery (attempt ${this._retryCount})`);

    if (this._options.onTimeout) {
      this._options.onTimeout();
    }

    // Reset monitoring after recovery attempt
    this._resetTimeout();

    if (this._options.onRecovery) {
      this._options.onRecovery();
    }
  }

  stop() {
    this._isActive = false;

    if (this._timeoutHandle) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }
  }

  getStatus() {
    return {
      isActive: this._isActive,
      retryCount: this._retryCount,
      lastActivity: this._lastActivity,
      timeSinceLastActivity: Date.now() - this._lastActivity,
    };
  }
}
