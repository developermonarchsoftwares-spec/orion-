import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, sanitizeHeader, getPasswordResetHtml, getAdminOtpHtml } from '../email-service.ts';

// S-17 proof: user-controlled values are HTML-escaped in email bodies; subject headers strip CR/LF.
describe('S-17 email template escaping', () => {
  it('escapeHtml neutralises markup', () => {
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(escapeHtml(`"'&<>`), '&quot;&#39;&amp;&lt;&gt;');
  });

  it('sanitizeHeader strips CR/LF (header injection)', () => {
    assert.equal(sanitizeHeader('Subject\r\nBcc: victim@example.com'), 'Subject Bcc: victim@example.com');
  });

  it('password reset body escapes an injected name and email', () => {
    const html = getPasswordResetHtml('https://app.example/reset?token=abc', '<b>e@x.com</b>', '<script>bad</script>');
    assert.ok(!html.includes('<script>bad</script>'), 'raw script must not appear');
    assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'), 'name is escaped');
    assert.ok(!html.includes('<b>e@x.com</b>'), 'raw email markup must not appear');
  });

  it('admin OTP body escapes the recipient email', () => {
    const html = getAdminOtpHtml('123456', '<i>a@b.com</i>', 5);
    assert.ok(!html.includes('<i>a@b.com</i>'));
    assert.ok(html.includes('&lt;i&gt;a@b.com&lt;/i&gt;'));
  });
});
