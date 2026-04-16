#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertContains(filePath, haystack, needle, testName) {
  totalTests++;
  if (haystack.includes(needle)) {
    console.log(`${GREEN}✓${RESET} ${testName}`);
    passedTests++;
  } else {
    console.log(`${RED}✗${RESET} ${testName}`);
    console.log(`  Missing: ${needle}`);
    console.log(`  File: ${filePath}`);
    failedTests++;
  }
}

function readFile(relPath) {
  const absPath = path.resolve(SERVER_ROOT, relPath);
  return fs.readFileSync(absPath, 'utf8');
}

console.log(`${BLUE}🧪 MetaboLights Structured Content Regression Tests${RESET}`);

const toolExpectations = [
  {
    path: 'src/tools/code-mode.ts',
    required: ['createSearchTool', 'createExecuteTool', 'metabolightsCatalog'],
  },
  {
    path: 'src/tools/query-data.ts',
    required: ['createQueryDataHandler', 'metabolights_query_data', 'METABOLIGHTS_DATA_DO'],
  },
  {
    path: 'src/tools/get-schema.ts',
    required: ['createGetSchemaHandler', 'metabolights_get_schema', 'METABOLIGHTS_DATA_DO'],
  },
  {
    path: 'src/spec/catalog.ts',
    required: ['metabolightsCatalog', 'ebi.ac.uk/metabolights'],
  },
];

for (const { path: filePath, required } of toolExpectations) {
  const content = readFile(filePath);
  for (const token of required) {
    assertContains(filePath, content, token, `${filePath} includes ${token}`);
  }
}

const indexContent = readFile('src/index.ts');
assertContains('src/index.ts', indexContent, 'MetabolightsDataDO', 'index.ts exports MetabolightsDataDO');
assertContains('src/index.ts', indexContent, 'McpAgent', 'index.ts uses McpAgent');

console.log(`\n${BLUE}📊 Test Results Summary${RESET}`);
console.log(`Total tests: ${totalTests}`);
console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
console.log(`${RED}Failed: ${failedTests}${RESET}`);

if (failedTests > 0) {
  console.log(`\n${RED}❌ Regression tests failed.${RESET}`);
  process.exit(1);
}

console.log(`\n${GREEN}✅ MetaboLights structured content regression tests passed.${RESET}`);
