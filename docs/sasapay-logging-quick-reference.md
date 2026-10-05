# SasaPay Logging Quick Reference

## Log File Location

```
logs/sasapay/sasapay-YYYY-MM-DD.jsonl
```

## Quick Commands

### View Logs

```bash
# Today's logs (pretty-printed)
cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq '.'

# Real-time monitoring
tail -f logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq '.'

# All logs from this week
cat logs/sasapay/sasapay-2026-10-*.jsonl | jq '.'
```

### Filter Operations

```bash
# Callbacks only
cat logs/sasapay/*.jsonl | jq 'select(.operation == "CALLBACK_RECEIVED")'

# Onboarding operations
cat logs/sasapay/*.jsonl | jq 'select(.operation | contains("ONBOARDING"))'

# KYC uploads
cat logs/sasapay/*.jsonl | jq 'select(.operation == "KYC_UPLOAD")'

# Authentication
cat logs/sasapay/*.jsonl | jq 'select(.operation == "AUTH_TOKEN")'
```

### Find Issues

```bash
# All errors
cat logs/sasapay/*.jsonl | jq 'select(.error != null)'

# Failed requests (4xx, 5xx)
cat logs/sasapay/*.jsonl | jq 'select(.statusCode >= 400)'

# Rejections
grep -i "reject" logs/sasapay/*.jsonl | jq '.'

# Specific error message
grep "error message text" logs/sasapay/*.jsonl | jq '.'
```

### Filter by Customer/Application

```bash
# By customer ID
cat logs/sasapay/*.jsonl | jq 'select(.customerId == 12345)'

# By application ID
cat logs/sasapay/*.jsonl | jq 'select(.applicationId == 67890)'

# Customer timeline (sorted)
cat logs/sasapay/*.jsonl | jq 'select(.customerId == 12345)' | jq -s 'sort_by(.timestamp)'
```

### Statistics

```bash
# Count by operation type
cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq -r '.operation' | sort | uniq -c

# Count by status code
cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq -r '.statusCode' | sort | uniq -c

# Total requests today
cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | wc -l

# Error rate
TOTAL=$(cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | wc -l)
ERRORS=$(cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq 'select(.error != null)' | wc -l)
echo "Error rate: $ERRORS / $TOTAL"
```

### Debugging Workflows

```bash
# Trace complete onboarding flow for customer
cat logs/sasapay/*.jsonl | \
  jq 'select(.customerId == 12345 and (.operation | contains("ONBOARDING") or .operation == "CALLBACK_RECEIVED"))' | \
  jq -s 'sort_by(.timestamp)'

# Find failed KYC uploads
cat logs/sasapay/*.jsonl | jq 'select(.operation == "KYC_IMAGE_UPLOAD" and .error != null)'

# Check callback response status
cat logs/sasapay/*.jsonl | jq 'select(.operation == "CALLBACK_RECEIVED") | {timestamp, customerId, status: .metadata.callbackStatus, reason: .metadata.reason}'
```

## Operation Types

| Operation | What It Logs |
|-----------|--------------|
| `AUTH_TOKEN` | OAuth token requests |
| `ONBOARDING_INITIATE` | OTP send requests |
| `ONBOARDING_CONFIRM` | OTP confirmation |
| `KYC_UPLOAD` | Documents sent to SasaPay |
| `CUSTOMER_DETAILS` | Customer info fetch |
| `CUSTOMER_UPDATE` | Customer info update |
| `CALLBACK_RECEIVED` | Incoming SasaPay webhooks |
| `KYC_IMAGE_UPLOAD` | Local image storage |

## Redacted Fields

These fields are automatically replaced with `[REDACTED]`:
- `password`, `token`, `access_token`, `Authorization`
- `client_secret`, `otp`, `confirmationCode`

## Export/Share

```bash
# Export specific customer's journey
cat logs/sasapay/*.jsonl | jq 'select(.customerId == 12345)' > customer-12345-logs.jsonl

# Export errors to CSV
cat logs/sasapay/*.jsonl | jq -r 'select(.error != null) | [.timestamp, .operation, .customerId, .statusCode, .error.message] | @csv' > errors.csv

# Export daily summary
cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq -r '[.timestamp, .operation, .statusCode, .customerId] | @csv' > daily-summary.csv
```

## Maintenance

```bash
# Check log file sizes
du -h logs/sasapay/*

# Count lines per file
wc -l logs/sasapay/*

# Delete old logs (90+ days)
find logs/sasapay/ -name "sasapay-*.jsonl" -type f -mtime +90 -delete

# Archive old logs (30+ days)
tar -czf logs/sasapay/archive-$(date +%Y-%m).tar.gz logs/sasapay/sasapay-$(date +%Y-%m)-*.jsonl
find logs/sasapay/ -name "sasapay-*.jsonl" -type f -mtime +30 -delete
```

## Validation

```bash
# Validate JSONL format
cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq empty

# Find invalid lines
awk '{if(!/"timestamp"/) print NR": "$0}' logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl
```

## Advanced Analysis

```bash
# Average response time (if logged)
cat logs/sasapay/*.jsonl | jq 'select(.metadata.duration) | .metadata.duration' | awk '{sum+=$1; n++} END {print sum/n}'

# Requests per hour
cat logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq -r '.timestamp' | cut -c12-13 | sort | uniq -c

# Top 10 customers by API usage
cat logs/sasapay/*.jsonl | jq -r '.customerId' | sort | uniq -c | sort -rn | head -10
```

## Integration with Tools

### grep + jq
```bash
grep "12345" logs/sasapay/*.jsonl | jq '.'
```

### awk + jq
```bash
awk '/ERROR/' logs/sasapay/*.jsonl | jq '.'
```

### sed + jq
```bash
sed -n '/2026-10-05T09/,/2026-10-05T10/p' logs/sasapay/*.jsonl | jq '.'
```

## Troubleshooting

### No logs appearing?
```bash
# Check directory exists
ls -la logs/sasapay/

# Check permissions
ls -la logs/

# Check service is running
pm2 list

# Check main logs for errors
grep "SASAPAY-LOGGER" logs/*.log
```

### Can't parse JSON?
```bash
# Validate format
jq empty < logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl

# Find problematic lines
grep -n '[^}]$' logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl
```

## Pro Tips

1. **Use `jq -c`** for compact single-line output
2. **Use `jq -r`** for raw string output (no quotes)
3. **Use `jq -s`** to slurp all entries into an array
4. **Pipe through `less -R`** for color output with scrolling
5. **Use `watch`** for auto-refreshing: `watch 'tail -20 logs/sasapay/sasapay-$(date +%Y-%m-%d).jsonl | jq .'`

## Resources

- Full documentation: `src/core/logging/README.md`
- Service code: `src/core/logging/sasapay-logger.service.ts`
- jq manual: https://stedolan.github.io/jq/manual/
