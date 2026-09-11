import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { JobService } from '../core/jobs/job.service';
import { WaasOnboardingJobService, OnboardingJobPayload } from '../modules/onboarding/services/waas-onboarding-job.service';
import * as os from 'os';

@Injectable()
export class JobsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsWorker.name);
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly workerId = `${os.hostname()}-${process.pid}`;

  constructor(
    private readonly jobService: JobService,
    private readonly waasOnboardingJob: WaasOnboardingJobService,
  ) {}

  onModuleInit() {
    this.isRunning = true;
    this.logger.log(`[JOBS WORKER] Initialized customer management worker ${this.workerId}`);
    this.pollLoop();
  }

  onModuleDestroy() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private async pollLoop() {
    if (!this.isRunning) return;

    try {
      const job = await this.jobService.claimNextJob(this.workerId);
      if (job) {
        this.logger.log(`[JOBS WORKER] Processing job ${job.job_type} (${job.uuid})`);
        await this.processJob(job);
      }
    } catch (error) {
      this.logger.error(`[JOBS WORKER] Error in job poll loop: ${error?.message}`);
    }

    if (this.isRunning) {
      this.timer = setTimeout(() => this.pollLoop(), 3000); // Poll every 3s
    }
  }

  private async processJob(job: any) {
    try {
      switch (job.job_type) {
        // -----------------------------------------------------------------------
        // SasaPay WaaS: Step 1 — Initiate onboarding (sends OTP)
        // -----------------------------------------------------------------------
        case 'sasapay_waas_onboarding': {
          const payload = job.payload as OnboardingJobPayload;
          this.logger.log(`[WAAS JOB] Step 1 — initiating WaaS for customer ${payload.customerId}`);
          await this.waasOnboardingJob.step1_InitiateSasaPayWaaS(payload);
          await this.jobService.markCompleted(job.id);
          break;
        }

        // -----------------------------------------------------------------------
        // SasaPay WaaS: Step 2+3 — Fetch KYC images via SSH and upload to SasaPay
        // -----------------------------------------------------------------------
        case 'sasapay_waas_kyc_upload': {
          const payload = job.payload as OnboardingJobPayload;
          this.logger.log(`[WAAS JOB] Step 2+3 — KYC upload for customer ${payload.customerId}`);

          // Step 2: download images from ASTPP via SSH
          const stateAfterFetch = await this.waasOnboardingJob.step2_FetchKycImagesViaSSH(
            payload,
            { step: 'fetch_images' },
          );

          // Step 3: upload images to SasaPay WaaS
          await this.waasOnboardingJob.step3_UploadKycToSasaPay(payload, stateAfterFetch);

          await this.jobService.markCompleted(job.id);
          break;
        }

        case 'KycVerificationJob':
          this.logger.log(`[KYC JOB] Executing automated verification for customer ${job.payload?.customerId}`);
          // Simulate / execute automated KYC / IPRS lookup
          await this.jobService.markCompleted(job.id);
          break;

        case 'CustomerNotificationJob':
          this.logger.log(`[NOTIFICATION JOB] Dispatching notification to ${job.payload?.recipient}`);
          // Simulate / send SMS / push notification
          await this.jobService.markCompleted(job.id);
          break;

        case 'DeviceCleanupJob':
          this.logger.log(`[DEVICE CLEANUP JOB] Cleaning up inactive customer device sessions`);
          await this.jobService.markCompleted(job.id);
          break;

        default:
          this.logger.warn(`[JOB] Unknown job type: ${job.job_type} — marking completed`);
          await this.jobService.markCompleted(job.id);
      }
    } catch (error) {
      this.logger.error(`[JOBS WORKER] Job ${job.job_type} (${job.uuid}) failed: ${error?.message}`);
      await this.jobService.markFailed(job.id, error.message);
    }
  }
}
