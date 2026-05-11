#!/usr/bin/env node

/**
 * Test script to verify backend endpoints match frontend expectations
 * Based on the frontend requirements document
 * Run with: node test-frontend-compatibility.js
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3002/api';
const KIDNEY_TENANT_ID = process.env.KIDNEY_TENANT_ID || 'kidney_tenant_id';

// Use dynamic import for node-fetch
async function runTests() {
  const fetch = (await import('node-fetch')).default;
  
  console.log('🧪 Testing Backend API Compatibility with Frontend\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Kidney Tenant ID: ${KIDNEY_TENANT_ID}\n`);

  const tests = [
    {
      name: 'GET /api/resources',
      endpoint: '/resources',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Ids': KIDNEY_TENANT_ID
      },
      expectedStatus: 200,
      checkResponse: (data) => Array.isArray(data)
    },
    {
      name: 'GET /api/resource-types',
      endpoint: '/resource-types',
      headers: {
        'Content-Type': 'application/json'
      },
      expectedStatus: 200,
      checkResponse: (data) => Array.isArray(data)
    },
    {
      name: 'GET /api/tags',
      endpoint: '/tags',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Ids': KIDNEY_TENANT_ID
      },
      expectedStatus: 200,
      checkResponse: (data) => Array.isArray(data)
    },
    {
      name: 'GET /api/expertise-levels',
      endpoint: '/expertise-levels',
      headers: {
        'Content-Type': 'application/json'
      },
      expectedStatus: 200,
      checkResponse: (data) => Array.isArray(data)
    },
    {
      name: 'GET /api/sensitivity-levels',
      endpoint: '/sensitivity-levels',
      headers: {
        'Content-Type': 'application/json'
      },
      expectedStatus: 200,
      checkResponse: (data) => Array.isArray(data)
    },
    {
      name: 'GET /api/organizations',
      endpoint: '/organizations',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Ids': KIDNEY_TENANT_ID
      },
      expectedStatus: 200,
      checkResponse: (data) => Array.isArray(data)
    }
  ];

  console.log('📋 Running Frontend Compatibility Tests:\n');
  
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const test of tests) {
    try {
      console.log(`📝 Testing: ${test.name}`);
      console.log(`   URL: ${BASE_URL}${test.endpoint}`);
      console.log(`   Headers: ${JSON.stringify(test.headers)}`);
      
      const response = await fetch(`${BASE_URL}${test.endpoint}`, {
        method: 'GET',
        headers: test.headers
      });

      const responseText = await response.text();
      let data;
      
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        data = responseText;
      }

      if (response.status === test.expectedStatus) {
        if (test.checkResponse && typeof data === 'object') {
          if (test.checkResponse(data)) {
            console.log(`   ✅ Success! Status: ${response.status}`);
            if (Array.isArray(data)) {
              console.log(`   📊 Response: Array with ${data.length} items`);
              if (data.length > 0) {
                console.log(`   📄 Sample: ${JSON.stringify(data[0], null, 2).substring(0, 200)}...`);
              }
            }
            passed++;
            results.push({ test: test.name, status: 'PASSED', details: `${data.length || 0} items` });
          } else {
            console.log(`   ❌ Failed! Response validation failed`);
            console.log(`   Response: ${JSON.stringify(data).substring(0, 200)}`);
            failed++;
            results.push({ test: test.name, status: 'FAILED', details: 'Invalid response format' });
          }
        } else {
          console.log(`   ✅ Success! Status: ${response.status}`);
          passed++;
          results.push({ test: test.name, status: 'PASSED', details: response.status });
        }
      } else {
        console.log(`   ❌ Failed! Expected status ${test.expectedStatus}, got ${response.status}`);
        console.log(`   Response: ${responseText.substring(0, 200)}`);
        failed++;
        results.push({ test: test.name, status: 'FAILED', details: `Status ${response.status}: ${responseText.substring(0, 100)}` });
      }
      
      console.log('');
    } catch (error) {
      console.log(`   ❌ Failed with error: ${error.message}\n`);
      failed++;
      results.push({ test: test.name, status: 'ERROR', details: error.message });
    }
  }

  // Test a specific resource if we found any
  if (passed > 0) {
    try {
      console.log('📝 Testing: GET /api/resources/{id} (if resources exist)');
      const resourcesResponse = await fetch(`${BASE_URL}/resources`, {
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Ids': KIDNEY_TENANT_ID
        }
      });
      
      if (resourcesResponse.ok) {
        const resources = await resourcesResponse.json();
        if (resources.length > 0) {
          const firstResourceId = resources[0].id;
          console.log(`   Testing with resource ID: ${firstResourceId}`);
          
          const resourceResponse = await fetch(`${BASE_URL}/resources/${firstResourceId}`, {
            headers: {
              'Content-Type': 'application/json',
              'X-Tenant-Ids': KIDNEY_TENANT_ID
            }
          });
          
          if (resourceResponse.ok) {
            const resource = await resourceResponse.json();
            console.log(`   ✅ Success! Got resource: ${resource.name || resource.title}`);
            passed++;
            results.push({ test: 'GET /api/resources/{id}', status: 'PASSED', details: resource.name });
          } else {
            console.log(`   ❌ Failed! Status: ${resourceResponse.status}`);
            failed++;
            results.push({ test: 'GET /api/resources/{id}', status: 'FAILED', details: `Status ${resourceResponse.status}` });
          }
        } else {
          console.log('   ⚠️  No resources found to test individual resource endpoint');
        }
      }
    } catch (error) {
      console.log(`   ❌ Error testing individual resource: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  
  console.log('\n📋 Detailed Results:');
  results.forEach(r => {
    const icon = r.status === 'PASSED' ? '✅' : '❌';
    console.log(`${icon} ${r.test}: ${r.status} - ${r.details}`);
  });
  
  console.log('\n📈 Statistics:');
  console.log(`   ✅ Passed: ${passed}/${tests.length + 1}`);
  console.log(`   ❌ Failed: ${failed}/${tests.length + 1}`);
  console.log(`   📊 Success Rate: ${((passed / (tests.length + 1)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! Backend is compatible with frontend expectations.');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the implementation.');
  }
  
  // Check if required environment variables are set
  console.log('\n🔧 Environment Check:');
  if (process.env.KIDNEY_TENANT_ID) {
    console.log(`   ✅ KIDNEY_TENANT_ID is set: ${process.env.KIDNEY_TENANT_ID}`);
  } else {
    console.log(`   ⚠️  KIDNEY_TENANT_ID is not set in environment`);
  }
}

// Run the tests
runTests().catch(console.error);