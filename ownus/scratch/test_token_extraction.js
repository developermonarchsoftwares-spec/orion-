function extractTokens(res) {
  const accessToken = res?.accessToken || res?.tokens?.accessToken || res?.data?.accessToken || res?.data?.tokens?.accessToken;
  const refreshToken = res?.refreshToken || res?.tokens?.refreshToken || res?.data?.refreshToken || res?.data?.tokens?.refreshToken;
  const userData = res?.user || res?.data?.user;
  return { accessToken, refreshToken, userData };
}

// Format 1: Direct unwrapped response (Gateway / NestJS standard)
const payload1 = {
  accessToken: 'access_token_123',
  refreshToken: 'refresh_token_456',
  user: { id: 'usr_1', email: 'test@example.com' }
};

// Format 2: Nested under tokens object
const payload2 = {
  tokens: {
    accessToken: 'access_token_789',
    refreshToken: 'refresh_token_012'
  },
  user: { id: 'usr_2', email: 'test2@example.com' }
};

// Format 3: Wrapped in data
const payload3 = {
  data: {
    accessToken: 'access_token_abc',
    refreshToken: 'refresh_token_def',
    user: { id: 'usr_3', email: 'test3@example.com' }
  }
};

// Format 4: Dual format (both top-level and tokens object)
const payload4 = {
  accessToken: 'access_token_dual',
  refreshToken: 'refresh_token_dual',
  tokens: {
    accessToken: 'access_token_dual',
    refreshToken: 'refresh_token_dual'
  },
  user: { id: 'usr_4', email: 'test4@example.com' }
};

console.log('--- Testing Payload Format 1 (Direct Unwrapped) ---');
const r1 = extractTokens(payload1);
console.log('Result 1:', r1);
if (r1.accessToken === 'access_token_123' && r1.refreshToken === 'refresh_token_456' && r1.userData.id === 'usr_1') {
  console.log('PASS Format 1');
} else {
  console.error('FAIL Format 1');
}

console.log('--- Testing Payload Format 2 (Nested under tokens) ---');
const r2 = extractTokens(payload2);
console.log('Result 2:', r2);
if (r2.accessToken === 'access_token_789' && r2.refreshToken === 'refresh_token_012' && r2.userData.id === 'usr_2') {
  console.log('PASS Format 2');
} else {
  console.error('FAIL Format 2');
}

console.log('--- Testing Payload Format 3 (Wrapped in data) ---');
const r3 = extractTokens(payload3);
console.log('Result 3:', r3);
if (r3.accessToken === 'access_token_abc' && r3.refreshToken === 'refresh_token_def' && r3.userData.id === 'usr_3') {
  console.log('PASS Format 3');
} else {
  console.error('FAIL Format 3');
}

console.log('--- Testing Payload Format 4 (Dual Format) ---');
const r4 = extractTokens(payload4);
console.log('Result 4:', r4);
if (r4.accessToken === 'access_token_dual' && r4.refreshToken === 'refresh_token_dual' && r4.userData.id === 'usr_4') {
  console.log('PASS Format 4');
} else {
  console.error('FAIL Format 4');
}

console.log('--- Testing Undefined Response ---');
const rUndefined = extractTokens(undefined);
console.log('Result Undefined:', rUndefined);
if (rUndefined.accessToken === undefined && rUndefined.refreshToken === undefined && rUndefined.userData === undefined) {
  console.log('PASS Undefined Handling (No TypeError thrown!)');
} else {
  console.error('FAIL Undefined Handling');
}
