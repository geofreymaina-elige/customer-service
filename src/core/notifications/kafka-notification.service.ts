import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';

export interface NotificationPayload {
  astpp_id?: string;
  channels: ('sms' | 'push' | 'websocket' | 'email')[];
  title: string;
  body: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  correlationId: string;
  sourceService: string;
  type: string;
  notifyTopic: boolean;
  context?: Record<string, any>;
  contact?: {
    phoneNumber?: string;
    emailAddress?: string;
  };
  metadata?: Record<string, any>;
}

@Injectable()
export class KafkaNotificationService {
  private readonly logger = new Logger(KafkaNotificationService.name);
  private producer: Producer;
  private readonly topic = 'customer_management_notifications';
  private isConnected = false;

  constructor(private readonly config: ConfigService) {
    this.initializeKafka();
  }

  private async initializeKafka() {
    try {
      const brokers = this.config.get<string>('kafka.brokers') || [];
      const clientId = this.config.get<string>('kafka.clientId') || 'customer-service';

      const kafka = new Kafka({
        clientId,
        brokers: Array.isArray(brokers) ? brokers : brokers.split(','),
      });

      this.producer = kafka.producer();
      await this.producer.connect();
      this.isConnected = true;
      this.logger.log(`Kafka producer connected to topic: ${this.topic}`);
    } catch (error) {
      this.logger.error(`Failed to connect Kafka producer: ${error.message}`);
      this.isConnected = false;
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Kafka producer not connected. Skipping notification.');
      return;
    }

    try {
      await this.producer.send({
        topic: this.topic,
        messages: [
          {
            key: payload.correlationId,
            value: JSON.stringify(payload),
          },
        ],
      });

      this.logger.log(
        `Notification sent to Kafka: ${payload.type} - ${payload.title} (${payload.channels.join(', ')})`
      );
    } catch (error) {
      this.logger.error(`Failed to send notification to Kafka: ${error.message}`, error.stack);
    }
  }

  /**
   * Send OTP via SMS
   */
  async sendOtpSms(
    phoneNumber: string,
    otp: string,
    purpose: 'device_recovery' | 'pin_reset' | 'wallet_verification',
    correlationId: string,
    astppId: string
  ): Promise<void> {
    const messages = {
      device_recovery: `Your Ambia Pay device recovery code is ${otp}. Valid for 10 minutes. Do not share this code.`,
      pin_reset: `Your Ambia Pay PIN reset code is ${otp}. Valid for 10 minutes. Keep this code confidential.`,
      wallet_verification: `Your Ambia Pay wallet verification code is ${otp}. Enter this code to complete your wallet setup.`,
    };

    const titles = {
      device_recovery: 'Device Recovery Code',
      pin_reset: 'PIN Reset Code',
      wallet_verification: 'Wallet Verification Code',
    };

    await this.sendNotification({
      astpp_id: astppId,
      channels: ['sms'],
      title: titles[purpose],
      body: messages[purpose],
      priority: 'urgent',
      correlationId,
      sourceService: 'customer_service',
      type: 'otp',
      notifyTopic: true,
      context: {
        purpose,
        otp,
      },
      contact: {
        phoneNumber,
      },
      metadata: {
        expiresInMinutes: 10,
      },
    });
  }

  /**
   * Send SasaPay wallet onboarding notifications (push + websocket)
   */
  async sendWalletOnboardingNotification(
    astppId: string,
    status: 'approved' | 'rejected' | 'pending',
    accountNumber?: string,
    reason?: string,
    phoneNumber?: string,
    emailAddress?: string
  ): Promise<void> {
    const messages = {
      approved: `Welcome to Ambia Pay! Your wallet has been successfully created. Account: ${accountNumber}`,
      rejected: `Wallet onboarding was not successful. ${reason || 'Please contact support for assistance.'}`,
      pending: 'Your wallet is being set up. You will be notified once it is ready.',
    };

    const titles = {
      approved: 'Wallet Ready',
      rejected: 'Wallet Onboarding Failed',
      pending: 'Wallet Setup in Progress',
    };

    await this.sendNotification({
      astpp_id: astppId,
      channels: ['websocket', 'push'],
      title: titles[status],
      body: messages[status],
      priority: 'high',
      correlationId: `wallet_onboarding_${astppId}_${Date.now()}`,
      sourceService: 'customer_service',
      type: 'wallet_onboarding',
      notifyTopic: true,
      context: {
        status,
        accountNumber: accountNumber || null,
        reason: reason || null,
      },
      contact: {
        phoneNumber,
        emailAddress,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Send device registered notification
   */
  async sendDeviceRegisteredNotification(
    astppId: string,
    deviceModel: string,
    phoneNumber?: string,
    emailAddress?: string
  ): Promise<void> {
    await this.sendNotification({
      astpp_id: astppId,
      channels: ['websocket', 'push'],
      title: 'New Device Registered',
      body: `Your account has been accessed from a new device: ${deviceModel}`,
      priority: 'high',
      correlationId: `device_registered_${astppId}_${Date.now()}`,
      sourceService: 'customer_service',
      type: 'security',
      notifyTopic: true,
      context: {
        deviceModel,
      },
      contact: {
        phoneNumber,
        emailAddress,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Send PIN set notification
   */
  async sendPinSetNotification(
    astppId: string,
    phoneNumber?: string,
    emailAddress?: string
  ): Promise<void> {
    await this.sendNotification({
      astpp_id: astppId,
      channels: ['websocket', 'push'],
      title: 'PIN Created',
      body: 'Your wallet PIN has been successfully set. You can now access all wallet features.',
      priority: 'high',
      correlationId: `pin_set_${astppId}_${Date.now()}`,
      sourceService: 'customer_service',
      type: 'security',
      notifyTopic: true,
      context: {},
      contact: {
        phoneNumber,
        emailAddress,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Send PIN changed notification
   */
  async sendPinChangedNotification(
    astppId: string,
    phoneNumber?: string,
    emailAddress?: string
  ): Promise<void> {
    await this.sendNotification({
      astpp_id: astppId,
      channels: ['websocket', 'push'],
      title: 'PIN Changed',
      body: 'Your wallet PIN has been successfully changed.',
      priority: 'high',
      correlationId: `pin_changed_${astppId}_${Date.now()}`,
      sourceService: 'customer_service',
      type: 'security',
      notifyTopic: true,
      context: {},
      contact: {
        phoneNumber,
        emailAddress,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Send device revoked notification
   */
  async sendDeviceRevokedNotification(
    astppId: string,
    reason: string,
    phoneNumber?: string,
    emailAddress?: string
  ): Promise<void> {
    await this.sendNotification({
      astpp_id: astppId,
      channels: ['websocket', 'push'],
      title: 'Device Session Ended',
      body: `Your device session has been ended. ${reason}`,
      priority: 'high',
      correlationId: `device_revoked_${astppId}_${Date.now()}`,
      sourceService: 'customer_service',
      type: 'security',
      notifyTopic: true,
      context: {
        reason,
      },
      contact: {
        phoneNumber,
        emailAddress,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    });
  }

  async onModuleDestroy() {
    if (this.isConnected && this.producer) {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    }
  }
}
