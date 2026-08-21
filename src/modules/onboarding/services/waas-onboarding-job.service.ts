import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../../core/database/database.service';
import { SasaPayWaasService } from './sasapay-waas.service';
// import { Client as SSHClient } from 'ssh2'; // TODO: Install ssh2 package when implementing image fetch
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
// import FormData from 'form-data'; // TODO: Install form-data if needed

interface OnboardingJobPayload {
  customerId: number;
  astppId: number;
  applicationId: number | null;
}

interface OnboardingJobState {
  step: 'sasapay_init' | 'awaiting_otp' | 'fetch_images' | 'upload_kyc' | 'completed';
  sasapay_request_id?: string;
  sasapay_account_number?: string;
  sasapay_account_status?: string;
  images?: {
    front?: string; // Local path after SSH fetch
    back?: string;
    selfie?: string;
  };
  error?: string;
}

@Injectable()
export class WaasOnboardingJobService {
  private readonly logger = new Logger(WaasOnboardingJobService.name);

  // SSH Configuration for ASTPP server
  private readonly sshHost: string;
  private readonly sshPort: number;
  private readonly sshUsername: string;
  private readonly sshPrivateKeyPath: string;
  private readonly astppImagesPath: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly sasapayWaas: SasaPayWaasService,
    private readonly config: ConfigService,
  ) {
    this.sshHost = this.config.get<string>('astpp.ssh.host') || 'localhost';
    this.sshPort = this.config.get<number>('astpp.ssh.port') || 22;
    this.sshUsername = this.config.get<string>('astpp.ssh.username') || 'jeff';
    this.sshPrivateKeyPath = this.config.get<string>('astpp.ssh.privateKeyPath') || '';
    this.astppImagesPath = this.config.get<string>('astpp.imagesPath') || '/var/www/html/astpp/application_images';
  }

  /**
   * Step 1: Initiate SasaPay WaaS Personal Onboarding
   * Sends SMS OTP to customer and stores requestId
   */
  async step1_InitiateSasaPayWaaS(payload: OnboardingJobPayload): Promise<OnboardingJobState> {
    this.logger.log(`[STEP 1] Initiating SasaPay WaaS for customer ${payload.customerId}`);

    // Fetch customer data from DB
    const customer = await this.db.queryOne(
      `SELECT id, astpp_id, phone_number, first_name, last_name, email 
       FROM customers WHERE id = $1`,
      [payload.customerId]
    );

    if (!customer) {
      throw new Error(`Customer ${payload.customerId} not found`);
    }

    // Fetch primary KYC details
    const primaryKyc = await this.db.queryOne(
      `SELECT cad.document_type, cad.document_number
       FROM customer_applications ca
       JOIN customer_applicant_details cad ON ca.id = cad.application_id
       WHERE ca.customer_id = $1 AND ca.application_type = 'primary_kyc'
       LIMIT 1`,
      [payload.customerId]
    );

    // Call SasaPay WaaS API
    const result = await this.sasapayWaas.initiatePersonalOnboardingAuto({
      customerId: customer.id,
      firstName: customer.first_name,
      middleName: '',
      lastName: customer.last_name,
      countryCode: '254',
      mobileNumber: customer.phone_number.replace(/^\+?254/, '0'),
      documentType: this.mapDocTypeToSasaPay(primaryKyc?.document_type || 'NATIONAL_ID'),
      documentNumber: primaryKyc?.document_number || `ID${customer.astpp_id}`,
      email: customer.email,
    });

    // Store the request ID in customer_applications
    await this.db.query(
      `INSERT INTO customer_applications (
        customer_id, application_type, sasapay_request_id, kyc_status, submitted_at, created_at, updated_at
      )
      VALUES ($1, 'wallet_kyc', $2, 'pending', NOW(), NOW(), NOW())
      ON CONFLICT (customer_id, application_type) 
      DO UPDATE SET sasapay_request_id = $2, kyc_status = 'pending', submitted_at = NOW(), updated_at = NOW()`,
      [customer.id, result.requestId]
    );

    return {
      step: 'awaiting_otp',
      sasapay_request_id: result.requestId,
    };
  }

  /**
   * Step 2: Fetch KYC Images via SSH from ASTPP Server
   * Executed after OTP confirmation
   */
  async step2_FetchKycImagesViaSSH(payload: OnboardingJobPayload, state: OnboardingJobState): Promise<OnboardingJobState> {
    this.logger.log(`[STEP 2] Fetching KYC images via SSH for application ${payload.applicationId}`);

    if (!payload.applicationId) {
      throw new Error('Application ID is required to fetch KYC images');
    }

    // Query ASTPP MySQL for wallet KYC images (prioritized)
    const astppMysql = this.db; // Assuming AstppMysqlService is injected or we use the existing MySQL connection
    const walletImages = await this.db.query(
      `SELECT filename, image_type, description, mime_type
       FROM wallet_application_images
       WHERE application_id = $1 AND status = 1 AND purpose = 'wallet_kyc'
       ORDER BY upload_date DESC`,
      [payload.applicationId]
    );

    let frontImage: string | null = null;
    let backImage: string | null = null;
    let selfieImage: string | null = null;

    if (walletImages.rows.length > 0) {
      // Prioritize wallet KYC images
      frontImage = walletImages.rows.find((img) => img.image_type === 'identity_document')?.filename;
      backImage = walletImages.rows.find((img) => img.image_type === 'identity_document_back')?.filename;
      selfieImage = walletImages.rows.find((img) => img.image_type === 'passport_photo')?.filename;
    } else {
      // Fallback to primary KYC images from applicant_details
      const primaryKyc = await this.db.queryOne(
        `SELECT identity_document, identity_document_back, id_verification
         FROM applicant_details
         WHERE application_id = $1`,
        [payload.applicationId]
      );

      if (primaryKyc) {
        frontImage = primaryKyc.identity_document;
        backImage = primaryKyc.identity_document_back;
        selfieImage = primaryKyc.id_verification;
      }
    }

    if (!frontImage || !backImage || !selfieImage) {
      throw new Error(`Missing required KYC images for application ${payload.applicationId}`);
    }

    // SSH into ASTPP server and download images
    const localTempDir = path.join(os.tmpdir(), `kyc_${payload.customerId}_${Date.now()}`);
    await fs.mkdir(localTempDir, { recursive: true });

    const remoteDir = `${this.astppImagesPath}/${payload.applicationId}`;
    const localFrontPath = path.join(localTempDir, frontImage);
    const localBackPath = path.join(localTempDir, backImage);
    const localSelfiePath = path.join(localTempDir, selfieImage);

    await this.sshDownloadFile(remoteDir, frontImage, localFrontPath);
    await this.sshDownloadFile(remoteDir, backImage, localBackPath);
    await this.sshDownloadFile(remoteDir, selfieImage, localSelfiePath);

    return {
      ...state,
      step: 'upload_kyc',
      images: {
        front: localFrontPath,
        back: localBackPath,
        selfie: localSelfiePath,
      },
    };
  }

  /**
   * Step 3: Upload KYC Images to SasaPay WaaS
   */
  async step3_UploadKycToSasaPay(payload: OnboardingJobPayload, state: OnboardingJobState): Promise<OnboardingJobState> {
    this.logger.log(`[STEP 3] Uploading KYC documents to SasaPay for customer ${payload.customerId}`);

    if (!state.images || !state.images.front || !state.images.back || !state.images.selfie) {
      throw new Error('KYC images not found in job state');
    }

    // Get customer phone number
    const customer = await this.db.queryOne(
      `SELECT phone_number FROM customers WHERE id = $1`,
      [payload.customerId]
    );

    // Upload to SasaPay using multipart/form-data
    await this.sasapayWaas.uploadKycDocuments(
      customer.phone_number.replace(/^\+?254/, ''),
      state.images.front,
      state.images.back,
      state.images.selfie
    );

    // Clean up temporary files
    await fs.rm(path.dirname(state.images.front), { recursive: true, force: true });

    // Update customer_applications status
    await this.db.query(
      `UPDATE customer_applications
       SET kyc_status = 'requires_kyc_upload', updated_at = NOW()
       WHERE customer_id = $1 AND application_type = 'wallet_kyc'`,
      [payload.customerId]
    );

    return {
      ...state,
      step: 'completed',
    };
  }

  /**
   * SSH Helper: Download file from remote ASTPP server
   * TODO: Implement when ssh2 package is installed
   */
  private async sshDownloadFile(remoteDir: string, filename: string, localPath: string): Promise<void> {
    /* TODO: Install ssh2 package first: npm install ssh2 @types/ssh2
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();

      conn.on('ready', () => {
        const remotePath = `${remoteDir}/${filename}`;
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          const readStream = sftp.createReadStream(remotePath);
          const writeStream = require('fs').createWriteStream(localPath);

          readStream.on('error', (error) => {
            conn.end();
            reject(error);
          });

          writeStream.on('error', (error) => {
            conn.end();
            reject(error);
          });

          writeStream.on('finish', () => {
            conn.end();
            resolve();
          });

          readStream.pipe(writeStream);
        });
      });

      conn.on('error', reject);

      conn.connect({
        host: this.sshHost,
        port: this.sshPort,
        username: this.sshUsername,
        privateKey: require('fs').readFileSync(this.sshPrivateKeyPath),
      });
    });
    */
    throw new Error('SSH functionality not yet implemented. Install ssh2 package first.');
  }

  /**
   * Map document type enum to SasaPay WaaS document type codes
   */
  private mapDocTypeToSasaPay(docType: string): string {
    const mapping = {
      NATIONAL_ID: '1',
      SERVICE_CARD: '1',
      ALIEN_CARD: '2',
      PASSPORT: '3',
    };
    return mapping[docType] || '1';
  }
}
