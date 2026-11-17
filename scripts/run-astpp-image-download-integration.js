'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const astppId = process.argv[2] || process.env.ASTPP_IMAGE_TEST_ASTPP_ID || '31553';
if (!/^\d+$/.test(astppId) || Number(astppId) < 1) {
  throw new Error('Provide a positive ASTPP ID, for example: npm run test:astpp-image-download -- 31553');
}

const testFile = path.resolve(__dirname, '..', 'test', 'astpp-image-download.test.js');
const result = spawnSync(process.execPath, ['--test', testFile], {
  cwd: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    ASTPP_IMAGE_INTEGRATION_TEST: '1',
    ASTPP_IMAGE_TEST_ASTPP_ID: astppId,
  },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
