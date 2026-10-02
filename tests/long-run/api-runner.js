const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const { buildRequest, loadMobileRequests, safeGetClass, safeRoute } = require('./postman-collection');

function responseSummary(value) {
  if (!value || typeof value !== 'object') return {};
  const data = value.data && typeof value.data === 'object' ? value.data : {};
  return {
    success: typeof value.success === 'boolean' ? value.success : undefined,
    code: typeof value.code === 'string' ? value.code : undefined,
    applicationStatus: typeof data.applicationStatus === 'string' ? data.applicationStatus : undefined,
    nextAction: typeof data.nextAction?.type === 'string' ? data.nextAction.type : undefined,
    walletStatus: typeof data.wallet?.status === 'string' ? data.wallet.status : undefined,
  };
}

class ApiRunner {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.requests = loadMobileRequests(config.collectionPath);
    this.lastRun = new Map();
    this.byName = new Map(this.requests.map((request) => [request.name, request]));
    this.tokenRefreshFailed = false;
    this.nextTransactionTokenRefreshAt = Date.now() +
      Math.max(30, config.initialTransactionTokenTtlSeconds - 60) * 1000;
  }

  logPlan() {
    const scheduled = this.requests
      .filter((request) => ['status', 'wallet', 'sessions', 'app_config', 'balance', 'read_once', 'token_refresh', 'device_signin'].includes(safeGetClass(request)))
      .map((request) => ({
        name: request.name,
        method: request.method,
        requestClass: safeGetClass(request),
        enabled: safeGetClass(request) === 'balance'
          ? this.config.balanceApiEnabled
          : safeGetClass(request) === 'token_refresh'
            ? this.config.pinRefreshEnabled
            : safeGetClass(request) === 'device_signin'
              ? this.config.deviceSignInOnStart
            : true,
      }));
    const stateChanging = this.requests
      .filter((request) => ['mutation', 'device_signin', 'token_refresh'].includes(safeGetClass(request)))
      .map((request) => ({
        name: request.name,
        requestClass: safeGetClass(request),
        enabled: safeGetClass(request) === 'device_signin'
          ? this.config.deviceSignInOnStart
          : safeGetClass(request) === 'token_refresh' && this.config.pinRefreshEnabled,
      }));

    this.logger.info('api_test_plan', {
      targetHost: new URL(this.config.baseUrl).host,
      astppId: this.config.variables.astppId,
      scheduledRequests: scheduled,
      stateChangingRequests: stateChanging,
      balanceIntervalMs: this.config.balanceIntervalMs,
      balanceApiEnabled: this.config.balanceApiEnabled,
      requestTimeoutMs: this.config.requestTimeoutMs,
    });
  }

  async runStartupRequests() {
    const startupReads = this.requests.filter((request) => safeGetClass(request) === 'read_once');
    for (const request of startupReads) await this.execute(request, 'startup_read');

    for (const request of this.requests.filter((item) => safeGetClass(item) === 'mutation')) {
      this.logger.info('api_mutation_skipped', {
        requestName: request.name,
        reason: 'state-changing mobile endpoints are disabled in this worker',
      });
    }
    if (this.config.deviceSignInOnStart) {
      const statusRequest = this.requests.find((item) => safeGetClass(item) === 'status');
      const deviceRequest = this.requests.find((item) => safeGetClass(item) === 'device_signin');
      const statusResult = statusRequest
        ? await this.execute(statusRequest, 'device_signin_preflight')
        : null;
      if (statusResult?.success && ['active', 'locked', 'frozen'].includes(statusResult.summary?.walletStatus)) {
        await this.execute(deviceRequest, 'one_shot_existing_wallet_device_signin');
      } else {
        this.logger.warn('device_signin_skipped', {
          astppId: this.config.variables.astppId,
          reason: 'preflight did not confirm an existing wallet; no device registration request was sent',
          statusCode: statusResult?.statusCode,
          walletStatus: statusResult?.summary?.walletStatus,
        });
      }
    } else {
      const deviceRequest = this.requests.find((item) => safeGetClass(item) === 'device_signin');
      if (deviceRequest) {
        this.logger.info('api_mutation_skipped', {
          requestName: deviceRequest.name,
          reason: 'set LONGRUN_RUN_DEVICE_SIGNIN_ON_START=true to run once after confirming an existing wallet',
        });
      }
    }
    if (!this.config.pinRefreshEnabled) {
      const tokenRefreshRequest = this.requests.find((item) => safeGetClass(item) === 'token_refresh');
      if (tokenRefreshRequest) {
        this.logger.info('api_mutation_skipped', {
          requestName: tokenRefreshRequest.name,
          reason: 'set LONGRUN_ENABLE_PIN_REFRESH=true with a dedicated test account to refresh balance token',
        });
      }
    }
    if (!this.config.balanceApiEnabled) {
      const balanceRequest = this.requests.find((item) => safeGetClass(item) === 'balance');
      if (balanceRequest) {
        this.logger.info('api_request_skipped', {
          requestName: balanceRequest.name,
          method: balanceRequest.method,
          route: safeRoute(new URL(balanceRequest.url.replace(/\{\{baseUrl\}\}/g, this.config.baseUrl), this.config.baseUrl).toString()),
          reason: 'balance calls SasaPay and requires explicit PSP opt-in',
        });
      }
    }
  }

  async runCycle(now = Date.now()) {
    if (this.config.pinRefreshEnabled && !this.tokenRefreshFailed) {
      const tokenMissing = !this.config.variables.transactionToken;
      if (tokenMissing || now >= this.nextTransactionTokenRefreshAt) {
        const refreshRequest = this.requests.find((item) => safeGetClass(item) === 'token_refresh');
        if (refreshRequest) await this.execute(refreshRequest, 'token_refresh');
      }
    }

    const classes = [
      ['status', 0],
      ['wallet', this.config.walletIntervalMs],
      ['sessions', this.config.sessionsIntervalMs],
      ['app_config', this.config.appConfigIntervalMs],
      ['balance', this.config.balanceIntervalMs],
    ];

    for (const [requestClass, intervalMs] of classes) {
      if (requestClass === 'balance' && !this.config.balanceApiEnabled) continue;
      const previousRun = this.lastRun.get(requestClass);
      if (previousRun === undefined) {
        this.lastRun.set(requestClass, now);
        if (requestClass === 'balance') continue;
      } else if (now - previousRun < intervalMs) {
        continue;
      }
      const request = this.requests.find((item) => safeGetClass(item) === requestClass);
      if (!request) continue;
      await this.execute(request, 'periodic');
      this.lastRun.set(requestClass, now);
    }
  }

  async execute(request, phase) {
    const built = buildRequest(request, this.config.baseUrl, this.config.variables);
    const route = safeRoute(new URL(request.url.replace(/\{\{baseUrl\}\}/g, this.config.baseUrl), this.config.baseUrl).toString());
    if (built.missing) {
      this.logger.info('api_request_skipped', {
        requestName: request.name,
        method: request.method,
        route,
        phase,
        missingVariables: built.missing,
      });
      return { skipped: true };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const startedAt = performance.now();
    const requestStartedAt = new Date().toISOString();
    const correlationId = randomUUID();
    try {
      const response = await fetch(built.url, {
        method: built.method,
        headers: {
          ...built.headers,
          'X-Correlation-ID': correlationId,
          'User-Agent': 'customer-management-long-run-worker/1.0',
        },
        body: built.body,
        signal: controller.signal,
        redirect: 'manual',
      });
      const responseText = await response.text();
      let summary = {};
      let responseJson;
      try {
        responseJson = JSON.parse(responseText);
        summary = responseSummary(responseJson);
      } catch {
        summary = { responseType: 'non_json' };
      }
      const durationMs = Math.round(performance.now() - startedAt);
      const fields = {
        requestName: request.name,
        method: request.method,
        route,
        phase,
        correlationId,
        requestStartedAt,
        targetHost: new URL(built.url).host,
        statusCode: response.status,
        durationMs,
        responseBytes: Buffer.byteLength(responseText),
        responseSummary: summary,
        kongRequestId: response.headers.get('x-kong-request-id') || response.headers.get('x-request-id') || undefined,
        kongProxyLatencyMs: response.headers.get('x-kong-proxy-latency') || undefined,
        kongUpstreamLatencyMs: response.headers.get('x-kong-upstream-latency') || undefined,
        kongUpstreamStatus: response.headers.get('x-kong-upstream-status') || undefined,
      };
      if (!response.ok || summary.success === false) this.logger.error('api_request_failed', fields);
      else this.logger.info('api_request_completed', fields);

      if (safeGetClass(request) === 'token_refresh') {
        const token = responseJson?.data?.token?.accessToken;
        const expiresInSeconds = Number(responseJson?.data?.token?.expiresInSeconds);
        if (!response.ok || summary.success === false || typeof token !== 'string' || !token) {
          this.tokenRefreshFailed = true;
          this.logger.error('transaction_token_refresh_stopped', {
            reason: 'refresh failed; automatic retries stopped to avoid repeated PIN failures',
            statusCode: response.status,
          });
        } else {
          this.config.variables.transactionToken = token;
          const ttl = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
            ? expiresInSeconds
            : this.config.initialTransactionTokenTtlSeconds;
          this.nextTransactionTokenRefreshAt = Date.now() + Math.max(30, ttl - 60) * 1000;
          this.logger.info('transaction_token_refreshed', { expiresInSeconds: ttl });
        }
      }
      return { statusCode: response.status, durationMs, success: response.ok && summary.success !== false, summary };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      this.logger.error('api_request_error', {
        requestName: request.name,
        method: request.method,
        route,
        phase,
        correlationId,
        requestStartedAt,
        targetHost: new URL(this.config.baseUrl).host,
        responseReceived: false,
        durationMs,
        errorName: error.name,
        errorCode: error.cause?.code || error.code,
        errorMessage: error.name === 'AbortError' ? 'request_timeout' : error.message,
      });
      if (safeGetClass(request) === 'token_refresh') this.tokenRefreshFailed = true;
      return { error: true, durationMs };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { ApiRunner, responseSummary };