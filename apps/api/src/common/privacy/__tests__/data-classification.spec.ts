import {
  DATA_CLASSES,
  DISCLOSURE_POLICY,
  classifyEmail,
  classifyIdentifier,
  classifyPhone,
  contactKind,
  discloseIdentifier,
  isFreeMailDomain,
  maskEmail,
  maskPhone,
  presentCompanyContact,
} from '../data-classification';

/** Synthetic data only: reserved example domains and invented names. */
describe('data classification (Phase 10)', () => {
  it('defines the eight classes the policy names', () => {
    expect([...DATA_CLASSES]).toEqual([
      'PUBLIC_BUSINESS_DATA', 'BUSINESS_CONTACT_DATA', 'INDIVIDUAL_WORK_CONTACT', 'PERSONAL_CONTACT_DATA',
      'SENSITIVE_INTERNAL_DATA', 'CUSTOMER_ACCOUNT_DATA', 'PAYMENT_DATA', 'SECURITY_DATA',
    ]);
  });

  describe('e-mail', () => {
    it.each(['info', 'sales', 'support', 'hello', 'accounts', 'hr', 'contact'])('role mailbox %s@ a company domain is business contact data', (local) => {
      const c = classifyEmail(`${local}@acme-example.com`, { contactName: 'Asha Verma' });
      expect(c.dataClass).toBe('BUSINESS_CONTACT_DATA');
      expect(c.basis).toBe('ROLE_MAILBOX');
      expect(c.inferred).toBe(true);
    });

    it('a role mailbox on the company own domain has higher confidence than on an unrelated domain', () => {
      expect(classifyEmail('info@acme-example.com', { companyDomains: ['www.acme-example.com'] }).confidence).toBe('HIGH');
      expect(classifyEmail('info@acme-example.com').confidence).toBe('MEDIUM');
    });

    it.each([
      ['asha.verma@acme-example.com', 'Asha Verma'],
      ['averma@acme-example.com', 'Asha Verma'],
      ['asha@acme-example.com', 'Asha Verma'],
      ['verma.asha@acme-example.com', 'Asha Verma'],
      ['asha_v@acme-example.com', 'Dr. Asha Verma'],
    ])('%s for %s is an individual work contact', (email, name) => {
      expect(classifyEmail(email, { contactName: name }).dataClass).toBe('INDIVIDUAL_WORK_CONTACT');
    });

    it('a name-shaped address with no matching contact is an individual work contact with LOW confidence', () => {
      const c = classifyEmail('kiran.rao@acme-example.com', { contactName: 'Somebody Else' });
      expect(c.dataClass).toBe('INDIVIDUAL_WORK_CONTACT');
      expect(c.confidence).toBe('LOW');
    });

    it('a corporate-domain address with no recognisable pattern is UNKNOWN, not automatically non-personal', () => {
      for (const e of ['x7q@acme-example.com', 'k9@acme-example.com', 'mgmt42@acme-example.com']) {
        const c = classifyEmail(e, { contactName: 'Asha Verma' });
        expect(c.dataClass).toBe('UNKNOWN');
      }
    });

    it('a free-mail address tied to the contact name is personal contact data (MEDIUM, inferred)', () => {
      const c = classifyEmail('asha.verma@gmail.com', { contactName: 'Asha Verma' });
      expect(c.dataClass).toBe('PERSONAL_CONTACT_DATA');
      expect(c.confidence).toBe('MEDIUM');
      expect(c.inferred).toBe(true);
    });

    it('a free-mail address with no tie to the contact is UNKNOWN, never assumed personal and never assumed business', () => {
      expect(classifyEmail('randomname77@gmail.com', { contactName: 'Asha Verma' }).dataClass).toBe('UNKNOWN');
      expect(classifyEmail('info@gmail.com', { contactName: 'Asha Verma' }).dataClass).toBe('UNKNOWN');
      expect(classifyEmail('acmetraders@yahoo.in').dataClass).toBe('UNKNOWN');
    });

    it('unparseable values are UNKNOWN', () => {
      for (const e of ['', null, undefined, 'not-an-email', 'a@b', 'a b@c.com', '@x.com']) expect(classifyEmail(e as any).dataClass).toBe('UNKNOWN');
    });

    it('a plus tag does not hide the name', () => {
      expect(classifyEmail('asha+crm@acme-example.com', { contactName: 'Asha Verma' }).dataClass).toBe('INDIVIDUAL_WORK_CONTACT');
    });

    it('recognises free-mail providers', () => {
      expect(isFreeMailDomain('GMAIL.com')).toBe(true);
      expect(isFreeMailDomain('rediffmail.com')).toBe(true);
      expect(isFreeMailDomain('acme-example.com')).toBe(false);
    });
  });

  describe('phone', () => {
    it('toll-free and landline-format numbers are business contact data', () => {
      expect(classifyPhone('1800 123 4567').dataClass).toBe('BUSINESS_CONTACT_DATA');
      expect(classifyPhone('1800-123-4567').basis).toBe('TOLL_FREE');
      expect(classifyPhone('022 2345 6789').dataClass).toBe('BUSINESS_CONTACT_DATA');
      expect(classifyPhone('+91 22 2345 6789').dataClass).toBe('BUSINESS_CONTACT_DATA');
    });

    it('a mobile-format number belongs to a person; whether it is a work line is not knowable', () => {
      const c = classifyPhone('+91 9000000001');
      expect(c.dataClass).toBe('INDIVIDUAL_WORK_CONTACT');
      expect(c.confidence).toBe('LOW');
      expect(classifyPhone('9000000001', { isDirectDial: true }).confidence).toBe('MEDIUM');
      expect(classifyPhone('09000000001').dataClass).toBe('BUSINESS_CONTACT_DATA'); // trunk-zero format reads as a landline
    });

    it('foreign, short, empty and odd values are UNKNOWN', () => {
      for (const p of ['+44 20 7946 0958', '12345', '', null, 'abc', '+91 12345']) expect(classifyPhone(p as any).dataClass).toBe('UNKNOWN');
    });
  });

  describe('identifiers', () => {
    it('registry numbers are public business data', () => {
      for (const t of ['CIN', 'LEI', 'REG_NO', 'UDYAM']) expect(classifyIdentifier(t, 'X1234').dataClass).toBe('PUBLIC_BUSINESS_DATA');
    });
    it('a company PAN is business contact data; an individual PAN is personal; an unparseable PAN is treated as sensitive', () => {
      expect(classifyIdentifier('PAN', 'AAACA1234B').dataClass).toBe('BUSINESS_CONTACT_DATA');
      expect(classifyIdentifier('PAN', 'ABCPD1234E').dataClass).toBe('PERSONAL_CONTACT_DATA');
      expect(classifyIdentifier('PAN', 'garbage').dataClass).toBe('PERSONAL_CONTACT_DATA');
      expect(classifyIdentifier('PAN', 'garbage').confidence).toBe('LOW');
    });
    it('a GSTIN is public unless it embeds an individual PAN', () => {
      expect(classifyIdentifier('GSTIN', '27AAACA1234B1Z5').dataClass).toBe('PUBLIC_BUSINESS_DATA');
      expect(classifyIdentifier('GSTIN', '27ABCPD1234E1Z5').dataClass).toBe('PERSONAL_CONTACT_DATA');
      expect(classifyIdentifier('GSTIN', 'bad').dataClass).toBe('UNKNOWN');
    });
    it('discloses by class: nothing identifying before unlock, individual PAN never in full', () => {
      expect(discloseIdentifier('CIN', 'U12345MH2010PTC123456', false)).toBe('U12345MH2010PTC123456');
      expect(discloseIdentifier('PAN', 'AAACA1234B', false)).not.toMatch(/[A-Z0-9]/);
      expect(discloseIdentifier('GSTIN', '27AAACA1234B1Z5', false)).toMatch(/^27\*+$/);
      expect(discloseIdentifier('PAN', 'AAACA1234B', true)).toBe('AAACA1234B');
      expect(discloseIdentifier('GSTIN', '27AAACA1234B1Z5', true)).toBe('27AAACA1234B1Z5');
      const pan = discloseIdentifier('PAN', 'ABCPD1234E', true);
      expect(pan).toBe('*********E');
      expect(pan).not.toContain('1234');
      const gst = discloseIdentifier('GSTIN', '27ABCPD1234E1Z5', true);
      expect(gst).toBe('27**********1Z5');
      expect(gst).not.toContain('ABCPD');
      expect(DISCLOSURE_POLICY.individualPanAfterUnlock).toBe(false);
    });
  });

  describe('masking', () => {
    const personal = classifyEmail('rajesh@gmail.com', { contactName: 'Rajesh Kumar' });
    it('a personal address keeps the first character and the provider only', () => {
      expect(maskEmail('rajesh@gmail.com', personal)).toBe('r*****@gmail.com');
    });
    it('an individual work address keeps the first character and masks the company domain', () => {
      const cls = classifyEmail('asha.verma@acme-example.com', { contactName: 'Asha Verma' });
      const m = maskEmail('asha.verma@acme-example.com', cls)!;
      expect(m).toBe('a*****@a***e.com');
      expect(m).not.toContain('verma');
      expect(m).not.toContain('acme');
    });
    it('a role mailbox keeps its role name, never the person-like characters of another address', () => {
      const cls = classifyEmail('info@acme-example.com');
      expect(maskEmail('info@acme-example.com', cls)).toBe('info@a***e.com');
    });
    it('the last character of a personal local part is no longer revealed', () => {
      const m = maskEmail('abcdefg@acme-example.com', classifyEmail('abcdefg@acme-example.com'))!;
      expect(m.split('@')[0]).toBe('a*****');
    });
    it('every masked address contains the placeholder, including awkward input', () => {
      for (const e of ['a@b.com', 'ab@cd.in', 'x@y.co.in', 'broken', 'user@localhost']) {
        expect(maskEmail(e, classifyEmail(e))).toContain('***');
      }
      expect(maskEmail(null, classifyEmail(null))).toBeNull();
    });
    it('a mobile number shows only the country code and the last two digits; a business line also keeps the first two', () => {
      expect(maskPhone('+91 9876543210', classifyPhone('+91 9876543210'))).toBe('+91 ********10');
      expect(maskPhone('+91 22 2345 6789', classifyPhone('+91 22 2345 6789'))).toBe('+91 22******89');
      expect(maskPhone('1800 123 4567', classifyPhone('1800 123 4567'))).toBe('18*******67');
      expect(maskPhone('12345', classifyPhone('12345'))).toBe('***-***-****');
      expect(maskPhone('+91 9876543210', classifyPhone('+91 9876543210'))).not.toContain('9876');
      expect(maskPhone('+44 20 7946 0958', classifyPhone('+44 20 7946 0958'))).toMatch(/^\+\*+58$/);
    });
  });

  describe('disclosure', () => {
    const row = { fullName: 'Asha Verma', title: 'Director', email: 'asha.verma@gmail.com', phone: '+91 9000000001', linkedinUrl: 'https://www.linkedin.com/in/asha-test', isPrimary: true, isDecisionMaker: true };

    it('before unlock: masked values, masked name and profile link, kinds shown, nothing raw', () => {
      const p = presentCompanyContact(row, { unlocked: false }) as any;
      expect(p.isLocked).toBe(true);
      expect(p.email).toBe('a*****@gmail.com');
      expect(p.phone).toBe('+91 ********01');
      expect(p.fullName).toBe('Asha ***');
      expect(p.linkedinUrl).toBe('https://linkedin.com/in/***');
      expect(p.emailKind).toBe('PERSONAL');
      expect(p.phoneKind).toBe('INDIVIDUAL_WORK');
      const json = JSON.stringify(p);
      for (const raw of ['asha.verma@gmail.com', '9000000001', 'Verma', 'asha-test']) expect(json).not.toContain(raw);
    });

    it('after unlock: the full values (current product rule), with the same kinds', () => {
      const p = presentCompanyContact(row, { unlocked: true }) as any;
      expect(p.isLocked).toBe(false);
      expect(p.email).toBe(row.email);
      expect(p.phone).toBe(row.phone);
      expect(p.fullName).toBe('Asha Verma');
      expect(p.emailRestricted).toBeUndefined();
    });

    it('only listed fields leave: a new database column or metadata can never leak through the presenter', () => {
      const withExtras = { ...row, metadata: { note: 'internal' }, sourceId: 'src-1', id: 'abc', businessId: 'b-1', confidenceScore: 77, adminNotes: 'x' } as any;
      for (const unlocked of [true, false]) {
        const keys = Object.keys(presentCompanyContact(withExtras, { unlocked }));
        for (const k of ['metadata', 'sourceId', 'id', 'businessId', 'confidenceScore', 'adminNotes']) expect(keys).not.toContain(k);
      }
    });

    it('classification never reports a verified state: the class is inferred', () => {
      expect(classifyEmail('a.b@acme-example.com').inferred).toBe(true);
      expect(classifyPhone('9000000001').inferred).toBe(true);
      expect(classifyIdentifier('PAN', 'AAACA1234B').inferred).toBe(true);
    });

    it('policy switch: if personal contacts were withheld after unlock, the presenter keeps them masked and says so', () => {
      const policy = DISCLOSURE_POLICY as { personalContactAfterUnlock: boolean };
      const before = policy.personalContactAfterUnlock;
      policy.personalContactAfterUnlock = false;
      try {
        const p = presentCompanyContact(row, { unlocked: true }) as any;
        expect(p.email).toBe('a*****@gmail.com');
        expect(p.emailRestricted).toBe(true);
        expect(p.phone).toBe(row.phone); // an individual work number is not personal data under the policy
        expect(p.isLocked).toBe(false);
      } finally {
        policy.personalContactAfterUnlock = before;
      }
    });

    it('contactKind maps classes to the coarse customer label', () => {
      expect(contactKind(classifyEmail('info@acme-example.com'))).toBe('BUSINESS');
      expect(contactKind(classifyEmail('x7q@acme-example.com'))).toBe('UNKNOWN');
    });
  });
});
