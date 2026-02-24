// @ts-nocheck
const { logger: defaultLogger } = require("../logger");

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return defaultValue;
}

function parseRedisConnection(redisUrl) {
  try {
    const u = new URL(redisUrl);
    const out = {
      host: u.hostname,
      port: Number(u.port || 6379)
    };
    if (u.username) out.username = decodeURIComponent(u.username);
    if (u.password) out.password = decodeURIComponent(u.password);
    const dbRaw = String(u.pathname || "").replace(/^\//, "");
    if (dbRaw) out.db = Number(dbRaw);
    if (u.protocol === "rediss:") out.tls = {};
    return out;
  } catch {
    return null;
  }
}

class ExecutionQueue {
  constructor({ manager, logger = defaultLogger } = {}) {
    this.manager = manager;
    this.logger = logger;
    this.enabled = parseBool(process.env.WABA_QUEUE_ENABLED, false);
    this.redisUrl = String(process.env.REDIS_URL || "").trim();
    this.queueName = String(process.env.WABA_QUEUE_NAME || "waba-execution");
    this.attempts = Math.max(1, Number(process.env.WABA_QUEUE_ATTEMPTS || 3));
    this.backoffMs = Math.max(100, Number(process.env.WABA_QUEUE_BACKOFF_MS || 1000));
    this.concurrency = Math.max(1, Number(process.env.WABA_QUEUE_CONCURRENCY || 2));
    this.defaultTimeoutMs = Math.max(1_000, Number(process.env.WABA_QUEUE_TIMEOUT_MS || 45_000));

    this.ready = false;
    this.startPromise = null;
    this.queue = null;
    this.worker = null;
    this.queueEvents = null;
    this._warned = false;
  }

  async ensureReady() {
    if (!this.enabled) return false;
    if (this.ready) return true;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start();
    const ok = await this.startPromise;
    this.startPromise = null;
    return ok;
  }

  async start() {
    if (!this.enabled) return false;
    if (!this.redisUrl) {
      this.warnOnce("WABA_QUEUE_ENABLED=true but REDIS_URL is missing; using direct execution.");
      return false;
    }

    const connection = parseRedisConnection(this.redisUrl);
    if (!connection) {
      this.warnOnce("Invalid REDIS_URL for queue execution; using direct execution.");
      return false;
    }

    try {
      const { Queue, Worker, QueueEvents } = require("bullmq");

      this.queue = new Queue(this.queueName, { connection });
      this.queueEvents = new QueueEvents(this.queueName, { connection });
      await this.queueEvents.waitUntilReady();

      this.worker = new Worker(
        this.queueName,
        async (job) => this.processJob(job.data),
        {
          connection,
          concurrency: this.concurrency
        }
      );

      this.worker.on("failed", (job, err) => {
        this.logger.warn(
          `queue job failed id=${job?.id || "?"} name=${job?.name || "?"} error=${err?.message || err}`
        );
      });

      const safeShutdown = async () => {
        try {
          if (this.worker) await this.worker.close();
          if (this.queueEvents) await this.queueEvents.close();
          if (this.queue) await this.queue.close();
        } catch (err) {
          this.logger.warn(`queue shutdown failed: ${err?.message || err}`);
        }
      };

      process.once("SIGINT", safeShutdown);
      process.once("SIGTERM", safeShutdown);
      process.once("beforeExit", safeShutdown);

      this.ready = true;
      this.logger.info(`Execution queue enabled (BullMQ) name=${this.queueName} concurrency=${this.concurrency}`);
      return true;
    } catch (err) {
      const msg = String(err?.message || err);
      if (/Cannot find module/i.test(msg) && msg.includes("bullmq")) {
        this.warnOnce("BullMQ not installed; using direct execution. Install `bullmq` to enable queue mode.");
      } else {
        this.warnOnce(`Execution queue init failed; using direct execution. reason=${msg}`);
      }
      return false;
    }
  }

  warnOnce(message) {
    if (this._warned) return;
    this._warned = true;
    this.logger.warn(message);
  }

  async resolveSession({ sessionId, client, language }) {
    let s = await this.manager.get(sessionId);
    if (s) return s;
    // Rehydrate from persistent memory if session is not in memory.
    s = await this.manager.start({
      sessionId,
      client: client || "default",
      language: language || "en"
    });
    return s;
  }

  async processJob(payload) {
    const s = await this.resolveSession(payload || {});
    if (!s) throw new Error("session_not_found");

    if (payload?.actionId) {
      return await s.executePendingById(payload.actionId, {
        allowHighRisk: !!payload.allowHighRisk
      });
    }

    return await s.executeActions(Array.isArray(payload?.actions) ? payload.actions : [], {
      allowHighRisk: !!payload.allowHighRisk
    });
  }

  async execute(payload = {}) {
    const ready = await this.ensureReady();
    if (!ready) {
      const execution = await this.processJob(payload);
      return { execution, queue: { enabled: false } };
    }

    const timeoutMs = Math.max(1_000, Number(payload.timeoutMs || this.defaultTimeoutMs));
    const data = {
      sessionId: payload.sessionId,
      client: payload.client,
      language: payload.language,
      actionId: payload.actionId || null,
      actions: Array.isArray(payload.actions) ? payload.actions : [],
      allowHighRisk: !!payload.allowHighRisk
    };

    const job = await this.queue.add("session.execute", data, {
      attempts: this.attempts,
      backoff: { type: "exponential", delay: this.backoffMs },
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 86400, count: 1000 }
    });

    const execution = await job.waitUntilFinished(this.queueEvents, timeoutMs);
    return {
      execution,
      queue: {
        enabled: true,
        name: this.queueName,
        jobId: String(job.id || ""),
        attempts: this.attempts
      }
    };
  }
}

function createExecutionQueue(params) {
  return new ExecutionQueue(params);
}

module.exports = {
  createExecutionQueue,
  ExecutionQueue
};
