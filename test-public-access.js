#!/usr/bin/env node

/**
 * Test script for public access to resources
 * Run with: node test-public-access.js
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.API_URL || 'http://localhost:3002/api';

async function testPublicAccess() {
  console.log('🧪 Testing Public Access to Resources API\n');
  console.log(`Base URL: ${BASE_URL}\n`);

  const tests = [
    {
      name: 'Get all resources (public)',
      endpoint: '/resources',
      method: 'GET',
    },
    {
      name: 'Get resource types (public)',
      endpoint: '/metadata/resource-types',
      method: 'GET',
    },
    {
      name: 'Get sensitivity levels (public)',
      endpoint: '/metadata/sensitivity-levels',
      method: 'GET',
    },
    {
      name: 'Get expertise levels (public)',
      endpoint: '/metadata/expertise-levels',
      method: 'GET',
    },
    {
      name: 'Get organizations (public)',
      endpoint: '/organizations',
      method: 'GET',
    },
    {
      name: 'Get tags (public)',
      endpoint: '/tags',
      method: 'GET',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`📝 Testing: ${test.name}`);
      console.log(`   Endpoint: ${test.endpoint}`);
      
      const response = await fetch(`${BASE_URL}${test.endpoint}`, {
        method: test.method,
        headers: {
          'Content-Type': 'application/json',
          // No authorization header - testing public access
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`   ✅ Success! Status: ${response.status}`);
        console.log(`   📊 Response contains ${Array.isArray(data) ? data.length : 'object'} item(s)\n`);
        passed++;
      } else {
        console.log(`   ❌ Failed! Status: ${response.status}`);
        const errorText = await response.text();
        console.log(`   Error: ${errorText}\n`);
        failed++;
      }
    } catch (error) {
      console.log(`   ❌ Failed with error: ${error.message}\n`);
      failed++;
    }
  }

  console.log('\n📊 Test Results:');
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Success Rate: ${((passed / tests.length) * 100).toFixed(1)}%`);

  // Test authenticated access for comparison
  if (process.env.TEST_AUTH_TOKEN) {
    console.log('\n🔒 Testing with Authentication for comparison...\n');
    
    try {
      const authResponse = await fetch(`${BASE_URL}/resources`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.TEST_AUTH_TOKEN}`,
        },
      });

      if (authResponse.ok) {
        const data = await authResponse.json();
        console.log(`   ✅ Authenticated access successful`);
        console.log(`   📊 Response contains ${data.length} items (may include more than public access)\n`);
      }
    } catch (error) {
      console.log(`   ⚠️  Could not test authenticated access: ${error.message}\n`);
    }
  }

  // Test rate limiting
  console.log('🚦 Testing Rate Limiting...\n');
  const rateLimitPromises = [];
  for (let i = 0; i < 10; i++) {
    rateLimitPromises.push(
      fetch(`${BASE_URL}/resources`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })
    );
  }

  const rateLimitResults = await Promise.all(rateLimitPromises);
  const rateLimited = rateLimitResults.filter(r => r.status === 429);
  
  if (rateLimited.length > 0) {
    console.log(`   ⚠️  Rate limiting active: ${rateLimited.length} requests were rate limited`);
  } else {
    console.log(`   ✅ All ${rateLimitPromises.length} requests succeeded (rate limit not reached)`);
  }
}

// Run the tests
testPublicAccess().catch(console.error);