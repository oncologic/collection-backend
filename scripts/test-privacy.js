#!/usr/bin/env node

/**
 * Privacy Test Runner for Vector Search Functions
 *
 * This script runs comprehensive privacy tests for the vector search system
 * to ensure proper tenant isolation, permission filtering, and data access control.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function colorize(text, color) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function printHeader() {
  console.log(colorize('\n🔐 VECTOR SEARCH PRIVACY TEST SUITE', 'cyan'));
  console.log(colorize('='.repeat(50), 'cyan'));
  console.log('Testing privacy controls for:');
  console.log('• Tenant isolation');
  console.log('• Permission-based access control');
  console.log('• User data segregation');
  console.log('• Collaboration access');
  console.log('• Security edge cases');
  console.log(colorize('='.repeat(50), 'cyan'));
}

function printTestCategories() {
  console.log(colorize('\n📋 TEST CATEGORIES:', 'yellow'));
  console.log('1. Collection Search Privacy');
  console.log('2. Resource Search Privacy (Community/Kidney tenant rules)');
  console.log('3. Comprehensive Search Privacy');
  console.log('4. Permission Filter Unit Tests');
  console.log('5. Security Edge Cases');
  console.log('6. AI Integration Privacy');
}

async function runPrivacyTests() {
  printHeader();
  printTestCategories();

  console.log(colorize('\n🚀 Starting privacy tests...', 'green'));

  return new Promise((resolve, reject) => {
    const testProcess = spawn(
      'npm',
      [
        'test',
        '--',
        'src/services/__tests__/vectorService.privacy.test.js',
        '--watchman=false',
        '--runInBand',
        '--forceExit',
        '--verbose',
      ],
      {
        cwd: projectRoot,
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          // Ensure test environment variables
          COMMUNITY_TENANT: 'community-tenant-id',
          KIDNEY_TENANT_ID: 'kidney-tenant-id',
        },
      }
    );

    let output = '';
    let errorOutput = '';

    testProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    testProcess.stderr.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      process.stderr.write(text);
    });

    testProcess.on('close', (code) => {
      console.log(colorize('\n' + '='.repeat(50), 'cyan'));

      if (code === 0) {
        console.log(colorize('✅ ALL PRIVACY TESTS PASSED!', 'green'));
        console.log(
          colorize('🛡️  Your vector search system is properly secured', 'green')
        );

        // Print summary of what was tested
        console.log(colorize('\n📊 PRIVACY COMPLIANCE VERIFIED:', 'green'));
        console.log('✓ Tenant isolation working correctly');
        console.log('✓ Permission filters preventing unauthorized access');
        console.log('✓ User data properly segregated');
        console.log('✓ Collaboration access controls functional');
        console.log('✓ Security edge cases handled safely');
        console.log('✓ AI integration maintains privacy');

        resolve(code);
      } else {
        console.log(colorize('❌ PRIVACY TESTS FAILED!', 'red'));
        console.log(
          colorize('🚨 SECURITY ISSUE DETECTED - Review failures above', 'red')
        );

        // Analyze common failure patterns
        if (output.includes('should only return public collections')) {
          console.log(
            colorize(
              '\n⚠️  Collection visibility filtering may be broken',
              'yellow'
            )
          );
        }
        if (output.includes('should enforce community tenant privacy')) {
          console.log(
            colorize(
              '⚠️  Community tenant isolation may be compromised',
              'yellow'
            )
          );
        }
        if (
          output.includes(
            'should not return collections from unauthorized tenants'
          )
        ) {
          console.log(
            colorize('⚠️  Tenant isolation may be failing', 'yellow')
          );
        }
        if (output.includes('should handle malicious tenant ID injection')) {
          console.log(
            colorize('⚠️  SQL injection vulnerability detected', 'red')
          );
        }

        reject(new Error(`Privacy tests failed with code ${code}`));
      }

      console.log(colorize('='.repeat(50), 'cyan'));
    });

    testProcess.on('error', (error) => {
      console.error(
        colorize(`❌ Failed to run tests: ${error.message}`, 'red')
      );
      reject(error);
    });
  });
}

async function runQuickPrivacyCheck() {
  console.log(colorize('\n🔍 Running Quick Privacy Check...', 'blue'));

  // This would run a subset of critical privacy tests
  return new Promise((resolve, reject) => {
    const testProcess = spawn(
      'npm',
      [
        'test',
        '--',
        'src/services/__tests__/vectorService.privacy.test.js',
        '--watchman=false',
        '--runInBand',
        '--forceExit',
        '--testNamePattern="should only return public collections|should enforce community tenant privacy|should not return collections from unauthorized tenants"',
      ],
      {
        cwd: projectRoot,
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'test',
        },
      }
    );

    let passed = 0;
    let failed = 0;

    testProcess.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('✓')) passed++;
      if (text.includes('✗')) failed++;
      process.stdout.write(text);
    });

    testProcess.on('close', (code) => {
      if (code === 0) {
        console.log(
          colorize(`\n✅ Quick check passed! (${passed} tests)`, 'green')
        );
      } else {
        console.log(
          colorize(`\n❌ Quick check failed! (${failed} failures)`, 'red')
        );
      }
      resolve(code);
    });
  });
}

// Command line interface
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    switch (command) {
      case 'quick':
        await runQuickPrivacyCheck();
        break;
      case 'full':
      default:
        await runPrivacyTests();
        break;
    }
  } catch (error) {
    console.error(
      colorize(`\n💥 Test execution failed: ${error.message}`, 'red')
    );
    process.exit(1);
  }
}

// Help text
if (args.includes('--help') || args.includes('-h')) {
  console.log(colorize('\n🔐 Privacy Test Runner', 'cyan'));
  console.log('\nUsage:');
  console.log('  node scripts/test-privacy.js [command]');
  console.log('\nCommands:');
  console.log('  full (default)  Run all privacy tests');
  console.log('  quick          Run critical privacy tests only');
  console.log('\nOptions:');
  console.log('  --help, -h     Show this help message');
  console.log('\nExamples:');
  console.log('  node scripts/test-privacy.js');
  console.log('  node scripts/test-privacy.js quick');
  console.log('  npm run test:privacy');
  process.exit(0);
}

main();
