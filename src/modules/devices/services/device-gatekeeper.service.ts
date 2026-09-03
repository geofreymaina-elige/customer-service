import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { SecureJwtService } from '../../../core/auth/jwt.service';
import { MessageService } from '../../../core/messages/message.service';
import { EventService } from '../../../core/events/event.service';
import { DeviceMetadataDto } from '../dto/device.dto';
import { DeviceConflictException } from '../../../core/errors/app.exception';

@Injectable()
export class DeviceGatekeeperService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: SecureJwtService,
    private readonly messages: MessageService,
    private readonly events: EventService,
  ) {}

  /**
   * Register or verify device for a customer, strictly enforcing single active device rule.
   * If customer has PIN set and a different device is active -> throws 409 Conflict.
   * If customer has no PIN set -> marks old device inactive and registers new device.
   */
  async registerOrVerifyDevice(
    customerId: number,
    deviceData: DeviceMetadataDto,
    ipAddress: string = '127.0.0.1'
  ): Promise<{
    deviceId: string;
    deviceHash: string;
    isNewDevice: boolean;
  }> {
    const deviceHash = this.jwtService.hashDevice(
      deviceData.deviceIdentifier,
      deviceData.deviceModel,
      deviceData.mobileType
    );

    // Check if customer has PIN set
    const pinRecord = await this.db.queryOne(
      `SELECT id FROM customer_pins WHERE customer_id = $1`,
      [customerId]
    );
    const hasPinSet = !!pinRecord;

    // Check for currently active device
    const activeDevice = await this.db.queryOne(
      `SELECT id, uuid, device_uuid_hash FROM customer_devices WHERE customer_id = $1 AND status = 'active'`,
      [customerId]
    );

    if (activeDevice) {
      // Case 1: Same device -> update activity timestamp
      if (activeDevice.device_uuid_hash === deviceHash) {
        await this.db.query(
          `UPDATE customer_devices
           SET last_active_at = NOW(), ip_address = $1, app_version = $2,
               callkit_token = $3, apns_token = $4, fcm_token = $5, updated_at = NOW()
           WHERE id = $6`,
          [
            ipAddress,
            deviceData.appVersion,
            deviceData.callkitToken || null,
            deviceData.apnsToken || null,
            deviceData.fcmToken || null,
            activeDevice.id,
          ]
        );

        return {
          deviceId: activeDevice.uuid,
          deviceHash,
          isNewDevice: false,
        };
      }

      // Case 2: Different device AND PIN is set -> 409 Conflict (Must do explicit device logout)
      if (hasPinSet) {
        throw new DeviceConflictException(this.messages.get('devices.sessionConflict'));
      }

      // Case 3: Different device AND PIN not set -> Invalidate old device and activate new device
      await this.db.query(
        `UPDATE customer_devices SET status = 'inactive', updated_at = NOW() WHERE customer_id = $1 AND status = 'active'`,
        [customerId]
      );
    }

    // Insert new active device
    const newDevice = await this.db.queryOne(
      `INSERT INTO customer_devices (
        customer_id, device_uuid_hash, device_identifier, device_model,
        device_os, mobile_type, app_version, callkit_token, apns_token, fcm_token,
        status, ip_address, last_active_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, NOW(), NOW(), NOW())
      RETURNING id, uuid`,
      [
        customerId,
        deviceHash,
        deviceData.deviceIdentifier,
        deviceData.deviceModel,
        deviceData.deviceOs,
        deviceData.mobileType,
        deviceData.appVersion,
        deviceData.callkitToken || null,
        deviceData.apnsToken || null,
        deviceData.fcmToken || null,
        ipAddress,
      ]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details, ip_address)
       VALUES ($1, 'DEVICE_REGISTERED', 'CUSTOMER', $2, $3::jsonb, $4)`,
      [
        customerId,
        String(customerId),
        JSON.stringify({
          deviceModel: deviceData.deviceModel,
          mobileType: deviceData.mobileType,
          appVersion: deviceData.appVersion,
        }),
        ipAddress,
      ]
    );

    await this.events.publish('customer.device_registered', 'CustomerDevice', String(customerId), {
      customerId,
      deviceUuid: newDevice.uuid,
      deviceModel: deviceData.deviceModel,
    });

    return {
      deviceId: newDevice.uuid,
      deviceHash,
      isNewDevice: true,
    };
  }

  /**
   * Revoke a specific device session
   */
  async revokeDevice(customerId: number, deviceUuid: string) {
    const device = await this.db.queryOne(
      `SELECT id, uuid, status FROM customer_devices WHERE customer_id = $1 AND uuid::text = $2`,
      [customerId, deviceUuid]
    );

    if (!device) {
      throw new NotFoundException(this.messages.get('common.notFound'));
    }

    await this.db.query(
      `UPDATE customer_devices SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [device.id]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'DEVICE_REVOKED', 'CUSTOMER', $2, $3::jsonb)`,
      [customerId, String(customerId), JSON.stringify({ deviceUuid })]
    );

    await this.events.publish('customer.device_revoked', 'CustomerDevice', String(customerId), {
      customerId,
      deviceUuid,
    });

    return {
      success: true,
      message: this.messages.get('devices.deviceRevoked'),
    };
  }

  /**
   * Record periodic device heartbeat/touch
   */
  async recordHeartbeat(customerId: number, ipAddress: string = '127.0.0.1') {
    await this.db.query(
      `UPDATE customer_devices
       SET last_active_at = NOW(), ip_address = $1, updated_at = NOW()
       WHERE customer_id = $2 AND status = 'active'`,
      [ipAddress, customerId]
    );

    return {
      success: true,
      message: this.messages.get('devices.heartbeatSuccess'),
    };
  }

  async getCustomerDevices(customerId: number) {
    const devices = await this.db.query(
      `SELECT uuid, device_identifier, device_model, device_os, mobile_type, app_version, status, last_active_at, created_at, revoked_at
       FROM customer_devices
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [customerId]
    );
    return devices.rows;
  }
}
