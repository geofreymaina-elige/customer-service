'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PinResetService } = require('../dist/src/modules/auth/services/pin-reset.service.js');
const {
  KafkaNotificationService,
} = require('../dist/src/core/notifications/kafka-notification.service.js');

test('PIN reset OTP correlation IDs use the unique reset session UUID', async () => {
  const sessionUuids = [
    '0e9fb92a-c687-4dde-9c52-14e66d3bf511',
    '75e775ad-b817-41c4-9264-9a11940cd0bf',
  ];
  const sentCorrelationIds = [];
  const database = {
    queryOne: async (sql) => {
      if (sql.includes('FROM customers c')) {
        return {
          id: 1,
          uuid: 'customer-uuid',
          astpp_id: 31553,
          phone_number: '254711470771',
          document_number: 'ID123',
        };
      }

      if (sql.includes('INSERT INTO customer_pin_reset_sessions')) {
        assert.match(sql, /RETURNING uuid/);
        return { uuid: sessionUuids.shift() };
      }

      throw new Error(`Unexpected queryOne: ${sql}`);
    },
    query: async () => ({}),
  };
  const notifications = {
    sendOtpSms: async (_phoneNumber, _otp, _purpose, correlationId) => {
      sentCorrelationIds.push(correlationId);
    },
  };
  const service = new PinResetService(
    database,
    { hashOtp: () => 'hashed-otp' },
    {},
    notifications,
  );
  const request = { astpp_id: '31553', id_number: 'ID123' };

  await service.initiateReset(request);
  await service.initiateReset(request);

  assert.deepEqual(sentCorrelationIds, [
    '0e9fb92a-c687-4dde-9c52-14e66d3bf511',
    '75e775ad-b817-41c4-9264-9a11940cd0bf',
  ]);
});

test('notification helper correlation IDs use distinct database-generated UUIDs', async () => {
  const generatedUuids = [
    '0e9fb92a-c687-4dde-9c52-14e66d3bf511',
    '75e775ad-b817-41c4-9264-9a11940cd0bf',
  ];
  const payloads = [];
  const service = Object.create(KafkaNotificationService.prototype);
  service.db = {
    queryOne: async (sql) => {
      assert.equal(sql, 'SELECT uuid_generate_v4() AS uuid');
      return { uuid: generatedUuids.shift() };
    },
  };
  service.sendNotification = async (payload) => payloads.push(payload);

  await service.sendPinSetNotification('31553');
  await service.sendPinSetNotification('31553');

  assert.deepEqual(
    payloads.map(({ correlationId }) => correlationId),
    [
      'pin_set_0e9fb92a-c687-4dde-9c52-14e66d3bf511',
      'pin_set_75e775ad-b817-41c4-9264-9a11940cd0bf',
    ],
  );
});
