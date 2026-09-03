/**
 * Date and Timestamp parsing utilities
 *
 * Handles conversion of various date formats from:
 * - ASTPP MySQL (zero-dates '0000-00-00', invalid dates, etc.)
 * - Kafka Debezium CDC events (epoch milliseconds, epoch microseconds, epoch days, numeric strings)
 * - JavaScript Date objects (including Invalid Date)
 *
 * Returns clean SQL-compatible values (string 'YYYY-MM-DD' or Date object, or null)
 * to prevent PostgreSQL syntax errors:
 * - invalid input syntax for type date: "0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN"
 * - date/time field value out of range: "1788107212000"
 */

/**
 * Parses any date representation into 'YYYY-MM-DD' or null for PostgreSQL DATE columns.
 */
export function parseDateOrNull(value: any): string | null {
  if (value === null || value === undefined) return null;

  // If already a Date object
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const year = value.getFullYear();
    if (year <= 1000 || year > 9999) return null;
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // If number (Debezium epoch days, seconds, milliseconds, or microseconds)
  if (typeof value === 'number') {
    if (isNaN(value) || value <= 0) return null;
    let date: Date;
    if (value < 100000) {
      // Debezium io.debezium.time.Date: days since Unix epoch (1970-01-01)
      date = new Date(value * 86400000);
    } else if (value < 10000000000) {
      // Epoch seconds (10 digits)
      date = new Date(value * 1000);
    } else if (value < 10000000000000) {
      // Epoch milliseconds (13 digits)
      date = new Date(value);
    } else {
      // Epoch microseconds (16 digits)
      date = new Date(Math.floor(value / 1000));
    }

    if (isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    if (year <= 1000 || year > 9999) return null;
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // If string
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      !trimmed ||
      trimmed === '0' ||
      trimmed.startsWith('0000-00-00') ||
      trimmed === 'Invalid Date' ||
      trimmed.includes('NaN') ||
      trimmed.toLowerCase() === 'null' ||
      trimmed.toLowerCase() === 'undefined'
    ) {
      return null;
    }

    // If numeric string (e.g. "1788107212000" or "9215")
    if (/^-?\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      return parseDateOrNull(num);
    }

    // Direct YYYY-MM-DD pattern check
    const dateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
      const year = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10);
      const day = parseInt(dateMatch[3], 10);
      if (year <= 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
      }
      return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    }

    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    const year = parsed.getUTCFullYear();
    if (year <= 1000 || year > 9999) return null;
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Parses any date/timestamp representation into a valid Date object or null
 * for PostgreSQL TIMESTAMPTZ / TIMESTAMP columns.
 */
export function parseTimestampOrNull(value: any): Date | null {
  if (value === null || value === undefined) return null;

  // If already a Date object
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const year = value.getFullYear();
    if (year <= 1000 || year > 9999) return null;
    return value;
  }

  // If number (Debezium epoch days, seconds, milliseconds, or microseconds)
  if (typeof value === 'number') {
    if (isNaN(value) || value <= 0) return null;
    let date: Date;
    if (value < 100000) {
      // Debezium io.debezium.time.Date: days since Unix epoch
      date = new Date(value * 86400000);
    } else if (value < 10000000000) {
      // Epoch seconds (10 digits)
      date = new Date(value * 1000);
    } else if (value < 10000000000000) {
      // Epoch milliseconds (13 digits)
      date = new Date(value);
    } else {
      // Epoch microseconds (16 digits)
      date = new Date(Math.floor(value / 1000));
    }

    if (isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    if (year <= 1000 || year > 9999) return null;
    return date;
  }

  // If string
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      !trimmed ||
      trimmed === '0' ||
      trimmed.startsWith('0000-00-00') ||
      trimmed === 'Invalid Date' ||
      trimmed.includes('NaN') ||
      trimmed.toLowerCase() === 'null' ||
      trimmed.toLowerCase() === 'undefined'
    ) {
      return null;
    }

    // If numeric string (e.g. "1788107212000")
    if (/^-?\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      return parseTimestampOrNull(num);
    }

    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    const year = parsed.getUTCFullYear();
    if (year <= 1000 || year > 9999) return null;
    return parsed;
  }

  return null;
}
