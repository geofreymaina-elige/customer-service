import {
  CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

export interface NormalizedPhoneNumber {
  countryCallingCode: string;
  nationalNumber: string;
  internationalDigits: string;
}

export function normalizePhoneNumber(phoneNumber: string, countryCode: string): NormalizedPhoneNumber {
  const normalizedCountryCode = countryCode.trim().toUpperCase();
  let region: CountryCode | undefined;
  let callingCode: string;

  if (/^[A-Z]{2}$/.test(normalizedCountryCode)) {
    region = normalizedCountryCode as CountryCode;
    try {
      callingCode = getCountryCallingCode(region);
    } catch {
      throw new Error('Customer country code is invalid for phone number validation.');
    }
  } else {
    callingCode = normalizedCountryCode.replace(/^\+/, '');
    if (!/^\d{1,3}$/.test(callingCode)) {
      throw new Error('Customer country calling code is missing or invalid.');
    }

    const matchingRegions = getCountries().filter(
      (candidate) => getCountryCallingCode(candidate) === callingCode,
    );
    if (matchingRegions.length === 1) {
      region = matchingRegions[0];
    } else if (matchingRegions.length === 0) {
      throw new Error('Customer country calling code is not supported.');
    }
  }

  const trimmedPhoneNumber = phoneNumber.trim();
  if (!trimmedPhoneNumber || !/^\+?[\d\s().-]+$/.test(trimmedPhoneNumber)) {
    throw new Error('Customer phone number is missing or invalid.');
  }

  let parsed = parsePhoneNumberFromString(trimmedPhoneNumber, region);
  if (!region && !trimmedPhoneNumber.startsWith('+')) {
    const digits = trimmedPhoneNumber.replace(/\D/g, '');
    if (digits.startsWith(callingCode)) {
      const international = parsePhoneNumberFromString(`+${digits}`);
      if (international?.isValid() && international.countryCallingCode === callingCode) {
        parsed = international;
      }
    }

    if (!parsed?.isValid()) {
      const matchingRegions = getCountries().filter(
        (candidate) => getCountryCallingCode(candidate) === callingCode,
      );
      const validInterpretations = matchingRegions
        .map((candidate) => parsePhoneNumberFromString(trimmedPhoneNumber, candidate))
        .filter((candidate) =>
          candidate?.isValid() && candidate.countryCallingCode === callingCode,
        );
      const uniqueNumbers = new Set(validInterpretations.map((candidate) => candidate.number));

      if (uniqueNumbers.size > 1) {
        throw new Error('Customer phone number is ambiguous for the stored country calling code.');
      }
      if (uniqueNumbers.size === 1) {
        parsed = validInterpretations[0];
      }
    }
  }

  if (!parsed || !parsed.isValid()) {
    throw new Error('Customer phone number is invalid for the stored country code.');
  }
  if (parsed.countryCallingCode !== callingCode) {
    throw new Error('Customer phone number country code does not match the stored country code.');
  }

  return {
    countryCallingCode: parsed.countryCallingCode,
    nationalNumber: parsed.formatNational().replace(/\D/g, ''),
    internationalDigits: parsed.number.slice(1),
  };
}
