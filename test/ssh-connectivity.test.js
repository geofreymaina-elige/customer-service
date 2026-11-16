'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { WaasOnboardingJobService } = require('../dist/src/modules/onboarding/services/waas-onboarding-job.service.js');

test('missing SSH settings are reported without blocking service initialization', () => {
  const service = new WaasOnboardingJobService(
    {},
    {},
    {},
    {},
    { get: () => undefined },
  );

  assert.doesNotThrow(() => service.onModuleInit());
});
