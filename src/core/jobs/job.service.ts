import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface JobRecord {
  id: number;
  uuid: string;
  job_type: string;
  payload: any;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  attempts: number;
  max_attempts: number;
  available_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
}

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Enqueue a durable job into PostgreSQL
   */
  async enqueue(jobType: string, payload: Record<string, any>, delaySeconds: number = 0): Promise<string> {
    const availableAt = new Date(Date.now() + delaySeconds * 1000);
    const result = await this.db.queryOne(
      `INSERT INTO jobs (job_type, payload, status, attempts, max_attempts, available_at, created_at, updated_at)
       VALUES ($1, $2, 'PENDING', 0, 5, $3, NOW(), NOW())
       RETURNING uuid`,
      [jobType, JSON.stringify(payload), availableAt]
    );

    this.logger.log(`Enqueued job ${jobType} (${result.uuid})`);
    return result.uuid;
  }

  /**
   * Concurrently claim available pending jobs using PostgreSQL FOR UPDATE SKIP LOCKED
   */
  async claimNextJob(workerId: string): Promise<JobRecord | null> {
    return this.db.transaction(async (client) => {
      const selectSql = `
        SELECT id, uuid, job_type, payload, status, attempts, max_attempts, available_at, locked_at, locked_by, last_error
        FROM jobs
        WHERE status = 'PENDING' AND available_at <= NOW()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;

      const result = await client.query(selectSql);
      if (result.rows.length === 0) {
        return null;
      }

      const job = result.rows[0] as JobRecord;

      await client.query(
        `UPDATE jobs
         SET status = 'RUNNING', attempts = attempts + 1, locked_at = NOW(), locked_by = $1, updated_at = NOW()
         WHERE id = $2`,
        [workerId, job.id]
      );

      job.status = 'RUNNING';
      job.attempts += 1;
      return job;
    });
  }

  async markCompleted(jobId: number): Promise<void> {
    await this.db.query(
      `UPDATE jobs
       SET status = 'COMPLETED', completed_at = NOW(), locked_at = NULL, locked_by = NULL, updated_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
  }

  async markFailed(jobId: number, error: string, retryDelaySeconds: number = 60): Promise<void> {
    const job = await this.db.queryOne(`SELECT attempts, max_attempts FROM jobs WHERE id = $1`, [jobId]);
    if (!job) return;

    if (job.attempts >= job.max_attempts) {
      await this.db.query(
        `UPDATE jobs
         SET status = 'FAILED', last_error = $1, locked_at = NULL, locked_by = NULL, updated_at = NOW()
         WHERE id = $2`,
        [error, jobId]
      );
      this.logger.error(`Job ID ${jobId} failed permanently after ${job.attempts} attempts: ${error}`);
    } else {
      const nextAttemptAt = new Date(Date.now() + retryDelaySeconds * 1000);
      await this.db.query(
        `UPDATE jobs
         SET status = 'PENDING', available_at = $1, last_error = $2, locked_at = NULL, locked_by = NULL, updated_at = NOW()
         WHERE id = $3`,
        [nextAttemptAt, error, jobId]
      );
      this.logger.warn(`Job ID ${jobId} retrying in ${retryDelaySeconds}s: ${error}`);
    }
  }
}
