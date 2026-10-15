import { classifyRole, normalizeTitle } from '../classification/role-classifier';

describe('role classification', () => {
  describe('title normalisation', () => {
    it('expands aliases and strips punctuation', () => {
      expect(normalizeTitle('Founder & CEO')).toBe('founder and ceo');
      expect(normalizeTitle('Co-Founder')).toBe('cofounder');
      expect(normalizeTitle('Chief Executive Officer')).toBe('ceo');
      expect(normalizeTitle('Vice-President, Sales')).toBe('vp sales');
      expect(normalizeTitle('Human Resources Manager')).toBe('hr manager');
      expect(normalizeTitle('  Purchasing   Head ')).toBe('purchase head');
    });

    it('handles empty input', () => {
      expect(normalizeTitle(null)).toBe('');
      expect(normalizeTitle(undefined)).toBe('');
      expect(classifyRole('').seniorityLevel).toBe('UNKNOWN');
      expect(classifyRole('').decisionMakerType).toBeNull();
    });
  });

  describe('spec examples', () => {
    it('Founder & CEO -> EXECUTIVE / EXECUTIVE / FOUNDER_CEO', () => {
      const r = classifyRole('Founder & CEO');
      expect(r).toMatchObject({
        seniorityLevel: 'EXECUTIVE',
        department: 'EXECUTIVE',
        decisionMakerType: 'FOUNDER_CEO',
        relationshipType: 'FOUNDER',
      });
    });

    it('Head of Procurement -> HEAD / PROCUREMENT / PROCUREMENT_DECISION_MAKER', () => {
      expect(classifyRole('Head of Procurement')).toMatchObject({
        seniorityLevel: 'HEAD',
        department: 'PROCUREMENT',
        decisionMakerType: 'PROCUREMENT_DECISION_MAKER',
      });
    });
  });

  describe.each([
    // title, seniority, department, decision-maker type
    ['Co-Founder', 'EXECUTIVE', 'EXECUTIVE', 'FOUNDER_CEO'],
    ['Owner', 'EXECUTIVE', 'EXECUTIVE', 'FOUNDER_CEO'],
    ['Proprietor', 'EXECUTIVE', 'EXECUTIVE', 'FOUNDER_CEO'],
    ['CEO', 'EXECUTIVE', 'EXECUTIVE', 'FOUNDER_CEO'],
    ['Managing Director', 'EXECUTIVE', 'EXECUTIVE', 'MANAGING_DIRECTOR'],
    ['Chairman', 'EXECUTIVE', 'EXECUTIVE', 'MANAGING_DIRECTOR'],
    ['Director', 'DIRECTOR', 'EXECUTIVE', 'DIRECTOR_PARTNER'],
    ['Partner', 'EXECUTIVE', 'EXECUTIVE', 'DIRECTOR_PARTNER'],
    ['General Manager', 'HEAD', 'EXECUTIVE', 'GENERAL_MANAGER'],
    ['General Manager - Sales', 'HEAD', 'SALES', 'SALES_DECISION_MAKER'],
    ['Head of Sales', 'HEAD', 'SALES', 'SALES_DECISION_MAKER'],
    ['Sales Director', 'DIRECTOR', 'SALES', 'SALES_DECISION_MAKER'],
    ['VP Sales', 'HEAD', 'SALES', 'SALES_DECISION_MAKER'],
    ['Head of Marketing', 'HEAD', 'MARKETING', 'MARKETING_DECISION_MAKER'],
    ['Marketing Director', 'DIRECTOR', 'MARKETING', 'MARKETING_DECISION_MAKER'],
    ['Director of Marketing', 'DIRECTOR', 'MARKETING', 'MARKETING_DECISION_MAKER'],
    ['CMO', 'EXECUTIVE', 'MARKETING', 'MARKETING_DECISION_MAKER'],
    ['CTO', 'EXECUTIVE', 'TECHNOLOGY', 'TECHNOLOGY_DECISION_MAKER'],
    ['Chief Information Officer', 'EXECUTIVE', 'TECHNOLOGY', 'TECHNOLOGY_DECISION_MAKER'],
    ['IT Head', 'HEAD', 'TECHNOLOGY', 'TECHNOLOGY_DECISION_MAKER'],
    ['COO', 'EXECUTIVE', 'OPERATIONS', 'OPERATIONS_DECISION_MAKER'],
    ['Head of Operations', 'HEAD', 'OPERATIONS', 'OPERATIONS_DECISION_MAKER'],
    ['CFO', 'EXECUTIVE', 'FINANCE', 'FINANCE_DECISION_MAKER'],
    ['HR Head', 'HEAD', 'HR', 'HR_DECISION_MAKER'],
    ['HR Manager', 'MANAGER', 'HR', 'HR_DECISION_MAKER'],
    ['Purchase Manager', 'MANAGER', 'PROCUREMENT', 'PROCUREMENT_DECISION_MAKER'],
    ['Business Development Head', 'HEAD', 'BUSINESS_DEVELOPMENT', 'BUSINESS_DEVELOPMENT_DECISION_MAKER'],
    ['Vice President of Engineering', 'HEAD', 'TECHNOLOGY', 'TECHNOLOGY_DECISION_MAKER'],
  ])('%s', (title, seniority, department, type) => {
    it(`-> ${seniority} / ${department} / ${type}`, () => {
      expect(classifyRole(title)).toMatchObject({
        seniorityLevel: seniority,
        department,
        decisionMakerType: type,
      });
    });
  });

  describe('non decision-making roles', () => {
    it.each([
      ['Sales Manager', 'MANAGER', 'SALES'],
      ['Software Engineer', 'STAFF', 'TECHNOLOGY'],
      ['Accounts Executive', 'STAFF', 'FINANCE'],
      ['Marketing Executive', 'STAFF', 'MARKETING'],
      ['Assistant Manager - Purchase', 'STAFF', 'PROCUREMENT'],
      ['Executive Assistant to the CEO', 'STAFF', 'EXECUTIVE'],
    ])('%s is not a decision maker', (title, seniority, department) => {
      const r = classifyRole(title);
      expect(r.decisionMakerType).toBeNull();
      expect(r.seniorityLevel).toBe(seniority);
      expect(r.department).toBe(department);
    });

    it('does not mistake staff roles for ownership', () => {
      expect(classifyRole('Product Owner').decisionMakerType).toBeNull();
      expect(classifyRole('HR Business Partner').seniorityLevel).not.toBe('EXECUTIVE');
      expect(classifyRole('Channel Partner Manager').decisionMakerType).toBeNull();
    });

    it('does not classify unknown titles', () => {
      const r = classifyRole('Consultant of Vibes');
      expect(r.decisionMakerType).toBeNull();
    });
  });

  it('labels the decision-maker type for the UI', () => {
    expect(classifyRole('Head of Sales').decisionMakerLabel).toBe('Sales Head');
    expect(classifyRole('Clerk').decisionMakerLabel).toBeNull();
  });

  it('is deterministic (pipeline can rely on it)', () => {
    expect(classifyRole('Founder & CEO')).toEqual(classifyRole('founder & ceo'));
    expect(classifyRole('Co Founder').normalizedTitle).toBe(classifyRole('Co-Founder').normalizedTitle);
  });
});
