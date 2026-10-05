# SasaPay Logging System

## Overview

The SasaPay logger provides dedicated, detailed logging for all SasaPay API interactions, stored in separate files for easy review and troubleshooting.

## Log Location

```
logs/sasapay/sasapay-YYYY-MM-DD.jsonl
```

Example: `logs/sasapay/sasapay-2026-10-05.jsonl`

## Log Format

Logs are stored in **JSON Lines format** (JSONL), with one JSON object per line. This format is:
- Easy to parse with tools like `jq`, `grep`, or log aggregators
- Supports streaming and incremental processing
- Human-readable when pretty-printed

## Log Entry Structure

Each log entry contains:

```typescript
{
  timestamp: string;           // ISO 8601 timestamp
  operation: string;           // Operation type (see below)
  method?: string;             // HTTP method (GET, POST)
  url?: string;                // API endpoint URL
  statusCode?: number;         // HTTP response status code
  requestPayload?: unknown;    // Request body (sensitive data redacted)
  responsePayload?: unknown;   // Response body (sensitive data redacted)
  error?: unknown;             // Error details if applicable
  customerId?: number;         // Customer ID if available
  applicationId?: number;      // Application ID if available
  metadata?: Record<string, unknown>; // Additional context
}
```

## Operation Types

| Operation | Description |
|-----------|-------------|
| `AUTH_TOKEN` | OAuth token acquisition |
| `ONBOARDING_INITIATE` | Initial personal onboarding (sends OTP) |
| `ONBOARDING_CONFIRM` | OTP confirmation and account creation |
| `KYC_UPLOAD` | KYC document upload to SasaPay |
| `CUSTOMER_DETAILS` | Fetch customer details |
| `CUSTOMER_UPDATE` | Update customer information |
| `CALLBACK_RECEIVED` | Incoming callback from SasaPay |
| `KYC_IMAGE_UPLOAD` | Local KYC image storage (before PSP upload) |

## Sensitive Data Protection

The logger automatically **redacts sensitive fields**:
- `password`
- `token`, `access_token`, `accessToken`
- `Authorization` header
- `client_secret`, `clientSecret`
- `otp`, `confirmationCode`

These fields are replaced with `[REDACTED]` in the logs.

## Usage Examples

### Viewing Logs

#### 1. View all logs for today
```bash
cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl
```

#### 2. Pretty-print logs with jq
```bash
cat logs/sasapay/sasapay-2026-10-05.jsonl | jq '.'
```

#### 3. Filter by operation type
```bash
# Show only callbacks
cat logs/sasapay/sasapay-2026-10-05.jsonl | jq 'select(.operation == "CALLBACK_RECEIVED")'

# Show only errors
cat logs/sasapay/sasapay-2026-10-05.jsonl | jq 'select(.error != null)'
```

#### 4. Filter by customer ID
```bash
cat logs/sasapay/sasapay-2026-10-05.jsonl | jq 'select(.customerId == 12345)'
```

#### 5. Show only failed requests (4xx, 5xx)
```bash
cat logs/sasapay/sasapay-2026-10-05.jsonl | jq 'select(.statusCode >= 400)'
```

#### 6. Extract specific fields
```bash
# Show operation, timestamp, and status code
cat logs/sasapay/sasapay-2026-10-05.jsonl | jq '{operation, timestamp, statusCode}'
```

#### 7. Count operations by type
```bash
cat logs/sasapay/sasapay-2026-10-05.jsonl | jq -r '.operation' | sort | uniq -c
```

### Searching Logs

#### 1. Find specific request ID
```bash
grep "request-id-123" logs/sasapay/sasapay-2026-10-05.jsonl | jq '.'
```

#### 2. Find all rejections
```bash
grep -i "reject" logs/sasapay/sasapay-2026-10-05.jsonl | jq '.'
```

#### 3. Search across multiple days
```bash
grep "customer_id_123" logs/sasapay/sasapay-2026-10-*.jsonl | jq '.'
```

### Monitoring

#### 1. Tail logs in real-time
```bash
tail -f logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq '.'
```

#### 2. Watch for errors
```bash
tail -f logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq 'select(.error != null)'
```

#### 3. Monitor specific customer
```bash
tail -f logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq 'select(.customerId == 12345)'
```

## Integration Points

### 1. SasaPay WaaS Service
Logs all outgoing API requests and responses:
- Authentication (token acquisition)
- Personal onboarding initiation
- OTP confirmation
- Customer details fetch/update
- KYC document upload to SasaPay

### 2. SasaPay KYC Service
Logs:
- Incoming callbacks from SasaPay
- Local KYC image uploads (customer → your system)
- Document validation and storage

### 3. Admin Operations
Any admin-initiated SasaPay operations are also logged through the same system.

## Log Analysis Tips

### Debugging Failed Onboarding

```bash
# Find all onboarding attempts for a customer
cat logs/sasapay/*.jsonl | jq 'select(.customerId == 12345 and (.operation | contains("ONBOARDING")))'

# Check callback status
cat logs/sasapay/*.jsonl | jq 'select(.operation == "CALLBACK_RECEIVED" and .metadata.callbackStatus == "REJECTED")'
```

### Tracking Request-Response Pairs

```bash
# Find request and response for a specific operation
CUSTOMER_ID=12345
cat logs/sasapay/sasapay-2026-10-05.jsonl | jq "select(.customerId == $CUSTOMER_ID)" | jq -s 'sort_by(.timestamp)'
```

### Audit Trail

```bash
# Generate audit report for date range
for date in 2026-10-{01..05}; do
  echo "=== $date ==="
  if [ -f "logs/sasapay/sasapay-$date.jsonl" ]; then
    cat "logs/sasapay/sasapay-$date.jsonl" | jq -r '[.timestamp, .operation, .customerId, .statusCode] | @csv'
  fi
done
```

## Retention and Rotation

- Logs are **automatically rotated daily** based on the date
- Old logs are **not automatically deleted** — implement your own retention policy
- Consider archiving logs older than 90 days to cold storage

### Example Cleanup Script

```bash
# Delete logs older than 90 days
find logs/sasapay/ -name "sasapay-*.jsonl" -type f -mtime +90 -delete
```

## Security Considerations

1. **Access Control**: Logs contain customer data. Restrict access to authorized personnel only.
2. **Retention Compliance**: Ensure log retention complies with data protection regulations (GDPR, etc.)
3. **Sensitive Data**: While sensitive fields are redacted, logs still contain customer information.
4. **Transport Security**: If shipping logs to external systems, use encrypted channels.

## Troubleshooting

### Missing Logs

If logs aren't being created:

1. **Check directory permissions**:
   ```bash
   ls -la logs/sasapay/
   ```

2. **Verify service is running**:
   ```bash
   pm2 logs customer-management-service
   ```

3. **Check for errors in main logs**:
   ```bash
   grep "SASAPAY-LOGGER" logs/*.log
   ```

### Parsing Errors

If you encounter JSON parsing errors:

```bash
# Validate JSONL format
cat logs/sasapay/sasapay-2026-10-05.jsonl | jq empty
```

## Performance Impact

The logger is designed for minimal performance impact:
- Asynchronous file writes
- Efficient JSON serialization
- No blocking operations
- Automatic buffering by Node.js file system

Typical overhead: < 1ms per log entry.

## Future Enhancements

Potential improvements:
- [ ] Structured logging aggregation (e.g., Elasticsearch, CloudWatch)
- [ ] Real-time alerting on errors
- [ ] Log compression for archived files
- [ ] Correlation ID tracking across services
- [ ] Performance metrics extraction

## Support

For issues or questions about SasaPay logging:
1. Check this README
2. Review the service code: `src/core/logging/sasapay-logger.service.ts`
3. Contact the platform team
