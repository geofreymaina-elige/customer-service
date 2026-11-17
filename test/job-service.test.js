'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { JobService } = require('../dist/src/core/jobs/job.service.js');

test('markCompleted clears the previous job error', async () => {
  let executedSql;
  const service = new JobService({
    query: async (sql) => {
      executedSql = sql;
      return {
        rowCount: 1,
        rows: [{ id: 1, uuid: 'job-uuid', job_type: 'sasapay_waas_kyc_upload' }],
      };
    },
  });
  service.logger = { log: () => {} };

  await service.markCompleted(1);

  assert.match(executedSql, /last_error\s*=\s*NULL/);
});
