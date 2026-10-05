#!/usr/bin/env node

/**
 * Test script to verify SasaPay logging is working correctly
 * Usage: node scripts/test-sasapay-logging.js
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs', 'sasapay');
const TODAY = new Date().toISOString().split('T')[0];
const LOG_FILE = path.join(LOG_DIR, `sasapay-${TODAY}.jsonl`);

console.log('🔍 SasaPay Logging Verification\n');
console.log('================================\n');

// Check 1: Directory exists
console.log('✓ Checking log directory...');
if (!fs.existsSync(LOG_DIR)) {
  console.error('❌ Log directory does not exist:', LOG_DIR);
  console.log('   The directory will be created automatically when the first log is written.');
} else {
  console.log('✅ Log directory exists:', LOG_DIR);
}

// Check 2: Log file exists
console.log('\n✓ Checking today\'s log file...');
if (!fs.existsSync(LOG_FILE)) {
  console.log('⚠️  No log file for today yet:', LOG_FILE);
  console.log('   This is normal if no SasaPay operations have occurred today.');
} else {
  console.log('✅ Log file exists:', LOG_FILE);
  
  // Check 3: File is readable
  console.log('\n✓ Checking log file readability...');
  try {
    const stats = fs.statSync(LOG_FILE);
    console.log('✅ File size:', (stats.size / 1024).toFixed(2), 'KB');
    console.log('✅ Last modified:', stats.mtime.toISOString());
  } catch (error) {
    console.error('❌ Cannot read file stats:', error.message);
    process.exit(1);
  }
  
  // Check 4: Parse log entries
  console.log('\n✓ Parsing log entries...');
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);
    
    console.log('✅ Total entries:', lines.length);
    
    if (lines.length === 0) {
      console.log('⚠️  No log entries found');
    } else {
      // Parse each line
      const entries = [];
      const errors = [];
      
      lines.forEach((line, index) => {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);
        } catch (error) {
          errors.push({ line: index + 1, error: error.message });
        }
      });
      
      if (errors.length > 0) {
        console.log('\n⚠️  Parse errors found:', errors.length);
        errors.slice(0, 5).forEach(err => {
          console.log(`   Line ${err.line}: ${err.error}`);
        });
      } else {
        console.log('✅ All entries are valid JSON');
      }
      
      // Check 5: Analyze entries
      console.log('\n✓ Analyzing log entries...');
      
      // Count operations
      const operations = {};
      const statusCodes = {};
      const customers = new Set();
      let errorsFound = 0;
      
      entries.forEach(entry => {
        // Count operations
        if (entry.operation) {
          operations[entry.operation] = (operations[entry.operation] || 0) + 1;
        }
        
        // Count status codes
        if (entry.statusCode) {
          statusCodes[entry.statusCode] = (statusCodes[entry.statusCode] || 0) + 1;
        }
        
        // Track customers
        if (entry.customerId) {
          customers.add(entry.customerId);
        }
        
        // Count errors
        if (entry.error) {
          errorsFound++;
        }
      });
      
      console.log('\n📊 Statistics:');
      console.log('   Unique customers:', customers.size);
      console.log('   Entries with errors:', errorsFound);
      
      console.log('\n📋 Operations:');
      Object.entries(operations)
        .sort((a, b) => b[1] - a[1])
        .forEach(([op, count]) => {
          console.log(`   ${op}: ${count}`);
        });
      
      if (Object.keys(statusCodes).length > 0) {
        console.log('\n🌐 HTTP Status Codes:');
        Object.entries(statusCodes)
          .sort((a, b) => a[0] - b[0])
          .forEach(([code, count]) => {
            const emoji = code >= 200 && code < 300 ? '✅' : code >= 400 ? '❌' : '⚠️';
            console.log(`   ${emoji} ${code}: ${count}`);
        });
      }
      
      // Check 6: Show sample entries
      console.log('\n✓ Sample log entries (last 3):');
      entries.slice(-3).forEach((entry, index) => {
        console.log(`\n   Entry ${entries.length - 2 + index}:`);
        console.log('   Timestamp:', entry.timestamp);
        console.log('   Operation:', entry.operation || 'N/A');
        console.log('   Status:', entry.statusCode || 'N/A');
        console.log('   Customer ID:', entry.customerId || 'N/A');
        if (entry.error) {
          console.log('   ❌ Error:', entry.error.message || JSON.stringify(entry.error).slice(0, 100));
        }
      });
      
      // Check 7: Verify sensitive data redaction
      console.log('\n✓ Checking sensitive data redaction...');
      const sensitiveFields = ['password', 'token', 'otp', 'client_secret'];
      let redactionIssues = [];
      
      entries.forEach((entry, index) => {
        const payload = JSON.stringify(entry);
        sensitiveFields.forEach(field => {
          // Check if field exists and is NOT redacted
          const regex = new RegExp(`"${field}"\\s*:\\s*"(?!\\[REDACTED\\])`, 'i');
          if (regex.test(payload)) {
            redactionIssues.push({
              line: index + 1,
              field,
              timestamp: entry.timestamp
            });
          }
        });
      });
      
      if (redactionIssues.length > 0) {
        console.log('⚠️  Potential redaction issues found:', redactionIssues.length);
        redactionIssues.slice(0, 5).forEach(issue => {
          console.log(`   Line ${issue.line} at ${issue.timestamp}: ${issue.field} may not be redacted`);
        });
      } else {
        console.log('✅ No sensitive data redaction issues found');
      }
    }
  } catch (error) {
    console.error('❌ Error reading log file:', error.message);
    process.exit(1);
  }
}

// Check 8: List all log files
console.log('\n✓ Available log files:');
if (fs.existsSync(LOG_DIR)) {
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith('sasapay-') && f.endsWith('.jsonl'))
    .sort()
    .reverse();
  
  if (files.length === 0) {
    console.log('   No log files found yet');
  } else {
    files.slice(0, 10).forEach(file => {
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      const size = (stats.size / 1024).toFixed(2);
      console.log(`   ${file} (${size} KB)`);
    });
    
    if (files.length > 10) {
      console.log(`   ... and ${files.length - 10} more`);
    }
  }
} else {
  console.log('   Directory does not exist yet');
}

console.log('\n================================');
console.log('✅ Verification complete!\n');

// Recommendations
console.log('💡 Recommendations:');
console.log('   • View logs: cat logs/sasapay/sasapay-' + TODAY + '.jsonl | jq \'.\'');
console.log('   • Monitor live: tail -f logs/sasapay/sasapay-' + TODAY + '.jsonl | jq \'.\'');
console.log('   • Find errors: cat logs/sasapay/*.jsonl | jq \'select(.error != null)\'');
console.log('   • See docs: cat src/core/logging/README.md');
console.log('   • Quick ref: cat docs/sasapay-logging-quick-reference.md\n');
