/** Explicit, test-only values. Not credentials for anything. Never print them. */
export const TEST_SECRETS = {
  jwtAccess: 'e2e-test-only-jwt-access-secret-0123456789abcdef',
  jwtRefresh: 'e2e-test-only-jwt-refresh-secret-fedcba9876543210',
  razorpayKeyId: 'rzp_test_e2e_only_key_id',
  razorpayKeySecret: 'e2e-test-only-razorpay-key-secret-0123456789',
  razorpayWebhookSecret: 'e2e-test-only-razorpay-webhook-secret-0123456789',
} as const;
