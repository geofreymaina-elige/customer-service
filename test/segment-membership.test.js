'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BadRequestException } = require('@nestjs/common');
const { GUARDS_METADATA } = require('@nestjs/common/constants');
const axios = require('axios');
const { SegmentMembershipController } = require('../dist/src/modules/segments/segment-membership.controller.js');
const { SegmentMembershipService } = require('../dist/src/modules/segments/segment-membership.service.js');
const { AdminApiKeyGuard } = require('../dist/src/core/auth/admin-api-key.guard.js');

const settings = {
  'clickhouse.protocol': 'http',
  'clickhouse.host': 'clickhouse.example.test',
  'clickhouse.port': 8123,
  'clickhouse.database': 'analytics',
  'clickhouse.user': 'reader',
  'clickhouse.password': 'secret',
  'clickhouse.timeoutMs': 3000,
};

function createService() {
  return new SegmentMembershipService({
    get: (key) => settings[key],
  });
}

test('exempts the endpoint from the general API key and requires the admin API key guard', () => {
  assert.equal(Reflect.getMetadata('isPublic', SegmentMembershipController), true);
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, SegmentMembershipController),
    [AdminApiKeyGuard],
  );
});

async function withClickHouseResponse(response, callback) {
  const originalPost = axios.post;
  axios.post = async (...args) => {
    withClickHouseResponse.lastCall = args;
    if (response instanceof Error) throw response;
    return { data: response };
  };

  try {
    return await callback();
  } finally {
    axios.post = originalPost;
  }
}

test('returns all memberships in rank order and identifies the primary segment', async () => {
  const rows = [
    {
      segmentId: 17,
      slug: 'high-value-topups',
      name: 'High-value top-ups',
      priorityRank: 10,
      evaluatedAt: '2026-10-31 10:00:00',
      runId: 'run-1',
    },
    {
      segmentId: 21,
      slug: 'kenya-active-callers',
      name: 'Kenya active callers',
      priorityRank: 20,
      evaluatedAt: '2026-10-31 10:00:00',
      runId: 'run-2',
    },
  ];

  const result = await withClickHouseResponse(
    { data: rows },
    () => createService().getMemberships('12345'),
  );

  assert.deepEqual(result, {
    astppId: '12345',
    memberships: rows,
    primarySegment: {
      segmentId: 17,
      slug: 'high-value-topups',
      name: 'High-value top-ups',
      priorityRank: 10,
    },
  });

  const [url, query, options] = withClickHouseResponse.lastCall;
  assert.equal(url, 'http://clickhouse.example.test:8123/');
  assert.match(query, /membership\.astpp_id = \{astpp_id:UInt64\}/);
  assert.match(query, /analytics\.dim_segments FINAL/);
  assert.equal(options.params.param_astpp_id, '12345');
  assert.equal(options.auth.username, 'reader');
  assert.equal(options.timeout, 3000);
});

test('returns a valid empty result when the account has no memberships', async () => {
  const result = await withClickHouseResponse(
    { data: [] },
    () => createService().getMemberships('12345'),
  );

  assert.deepEqual(result, {
    astppId: '12345',
    memberships: [],
    primarySegment: null,
  });
});

test('rejects invalid ASTPP IDs before making a ClickHouse request', async () => {
  const originalPost = axios.post;
  let called = false;
  axios.post = async () => {
    called = true;
    return { data: { data: [] } };
  };

  try {
    await assert.rejects(
      createService().getMemberships('0'),
      (error) => error instanceof BadRequestException &&
        error.getResponse().code === 'INVALID_ASTPP_ID',
    );
    assert.equal(called, false);
  } finally {
    axios.post = originalPost;
  }
});

test('returns empty memberships when ClickHouse is unavailable, without throwing', async () => {
  const originalError = console.error;
  console.error = () => {};

  try {
    const result = await withClickHouseResponse(
      Object.assign(new Error('database connection refused'), { code: 'ECONNREFUSED' }),
      () => createService().getMemberships('12345'),
    );

    assert.deepEqual(result, {
      astppId: '12345',
      memberships: [],
      primarySegment: null,
    });
  } finally {
    console.error = originalError;
  }
});

test('returns empty memberships when ClickHouse config is invalid, without throwing', async () => {
  const originalPost = axios.post;
  const originalError = console.error;
  let called = false;
  axios.post = async () => {
    called = true;
    return { data: { data: [] } };
  };
  console.error = () => {};

  try {
    const service = new SegmentMembershipService({
      get: (key) => key === 'clickhouse.database' ? 'other' : settings[key],
    });

    const result = await service.getMemberships('12345');

    assert.deepEqual(result, {
      astppId: '12345',
      memberships: [],
      primarySegment: null,
    });
    assert.equal(called, false);
  } finally {
    axios.post = originalPost;
    console.error = originalError;
  }
});
