'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizePhoneNumber } = require('../dist/src/core/utils/phone-number.util.js');

test('formats a valid Kenyan national phone number with its stored country calling code', () => {
  assert.deepEqual(normalizePhoneNumber('0713 726 384', '254'), {
    countryCallingCode: '254',
    nationalNumber: '0713726384',
    internationalDigits: '254713726384',
  });
  assert.deepEqual(normalizePhoneNumber('713726384', '+254'), {
    countryCallingCode: '254',
    nationalNumber: '0713726384',
    internationalDigits: '254713726384',
  });
});

test('keeps an existing international country code without duplicating it', () => {
  assert.equal(normalizePhoneNumber('+254713726384', '254').internationalDigits, '254713726384');
  assert.equal(normalizePhoneNumber('254713726384', 'KE').internationalDigits, '254713726384');
});

test('validates national and international numbers for a shared calling code', () => {
  assert.equal(normalizePhoneNumber('4155552671', '1').internationalDigits, '14155552671');
  assert.equal(normalizePhoneNumber('+14155552671', '1').internationalDigits, '14155552671');
});

test('rejects invalid numbers and mismatched stored country codes', () => {
  assert.throws(
    () => normalizePhoneNumber('+254713726384', '255'),
    /does not match the stored country code/,
  );
  assert.throws(
    () => normalizePhoneNumber('12345', '254'),
    /invalid for the stored country code/,
  );
  assert.throws(
    () => normalizePhoneNumber('713726384', ''),
    /calling code is missing or invalid/,
  );
});
