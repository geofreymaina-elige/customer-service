'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventService } = require('../dist/src/core/events/event.service.js');
const { EventType } = require('../dist/src/core/events/event-type.enum.js');

test('onboarding state events are logged only when lifecycle state changes', async () => {
  const rows = [];
  let nextId = 1;
  const database = {
    transaction: async (run) => run({
      query: async (sql, params) => {
        if (sql.includes("payload->'state'")) {
          const previous = rows.filter((row) =>
            row.eventType === params[0]
            && row.aggregateType === params[1]
            && row.aggregateId === params[2]
          ).at(-1);
          const stateMatches = previous
            && JSON.stringify(previous.payload.state) === params[3];
          return { rows: previous ? [{ state_matches: stateMatches }] : [] };
        }

        if (sql.includes('INSERT INTO events')) {
          const event = {
            eventType: params[0],
            aggregateType: params[1],
            aggregateId: params[2],
            payload: JSON.parse(params[3]),
            uuid: `event-${nextId++}`,
          };
          rows.push(event);
          return { rows: [{ uuid: event.uuid }] };
        }

        return { rows: [] };
      },
    }),
  };
  const events = new EventService(database);
  const initialState = {
    applicationStatus: 'pending',
    walletStatus: null,
    nextAction: { type: 'wait_for_update' },
    requiredDocuments: [],
  };

  assert.equal(
    await events.publishStateChange(EventType.CustomerOnboardingStateChanged, 'Customer', '42', initialState),
    'event-1',
  );
  assert.equal(
    await events.publishStateChange(EventType.CustomerOnboardingStateChanged, 'Customer', '42', initialState),
    null,
  );
  assert.equal(
    await events.publishStateChange(EventType.CustomerOnboardingStateChanged, 'Customer', '42', {
      ...initialState,
      applicationStatus: 'requires_kyc_upload',
      nextAction: { type: 'upload_kyc_documents' },
      requiredDocuments: ['document_front'],
    }),
    'event-2',
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[1].eventType, EventType.CustomerOnboardingStateChanged);
  assert.equal(rows[1].payload.state.applicationStatus, 'requires_kyc_upload');
});
