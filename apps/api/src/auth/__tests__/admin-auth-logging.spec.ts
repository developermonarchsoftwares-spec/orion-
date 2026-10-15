import * as fs from 'fs';
import * as path from 'path';

/**
 * L-7: administrator authentication must log through the application logger (which scrubs e-mail addresses, tokens and connection strings
 * before output), never through `console.*` (which does not). This is a STRUCTURAL check of the source, not a behavioural one: it cannot
 * see what a future code path prints, only that this controller and its helper no longer call `console`.
 */
const AUTH_DIR = path.resolve(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(AUTH_DIR, f), 'utf8');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('administrator authentication logging (L-7)', () => {
  it('the admin controller and OTP helper never call console.*', () => {
    for (const f of ['admin-auth.controller.ts', 'admin-otp.util.ts']) {
      expect(codeOnly(read(f))).not.toMatch(/\bconsole\.(log|error|warn|info|debug)\b/);
    }
  });

  it('the admin controller owns a named Nest Logger', () => {
    expect(read('admin-auth.controller.ts')).toMatch(/new Logger\(AdminAuthController\.name\)/);
  });

  it('the comment stripper used above really removes comments and keeps code', () => {
    expect(codeOnly('// console.log("x")\nconst a = 1;')).not.toContain('console');
    expect(codeOnly('/* console.error(1) */ const b = 2;')).not.toContain('console');
    expect(codeOnly('console.log("kept");')).toContain('console.log');
  });
});
