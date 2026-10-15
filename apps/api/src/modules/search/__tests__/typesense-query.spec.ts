import { buildTypesenseFilter, DEFAULT_TYPESENSE_SORT, safeTypesenseSort, typesenseValue } from '../typesense-query';

describe('Typesense query building (SG-09: user values cannot add clauses)', () => {
  it('always starts with the fixed published-only clause', () => {
    expect(buildTypesenseFilter({})).toBe('status:=PUBLISHED');
    expect(buildTypesenseFilter({ city: 'Pune' })).toMatch(/^status:=PUBLISHED && city:=/);
  });

  it('quotes every value, so an injected clause stays inside the value', () => {
    const f = buildTypesenseFilter({ city: 'Pune && status:=DRAFT', state: 'x`|| status:=DRAFT', industryId: '1) || (status:=DRAFT' });
    expect(f).toContain('city:=`Pune && status:=DRAFT`');
    // the backtick that would close the quote was removed, so the whole payload remains one quoted value
    expect(f).toContain('state:=`x|| status:=DRAFT`');
    // split into clauses the way Typesense reads them: ` && ` inside a backtick-quoted value is literal text
    const clauses: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < f.length; i++) {
      if (f[i] === '`') quoted = !quoted;
      if (!quoted && f.startsWith(' && ', i)) {
        clauses.push(cur);
        cur = '';
        i += 3;
      } else cur += f[i];
    }
    clauses.push(cur);
    expect(clauses).toHaveLength(1 + 3); // the fixed clause plus exactly the three filters that were asked for
    expect(clauses[0]).toBe('status:=PUBLISHED');
    expect(clauses.filter((c) => c.startsWith('status:='))).toEqual(['status:=PUBLISHED']); // no injected clause of its own
    expect(quoted).toBe(false); // every quote is closed: nothing stayed open to swallow the rest
  });

  it('strips quote-breaking and control characters from values', () => {
    expect(typesenseValue('a`b\\c\nd\u0000e')).toBe('`abcde`');
    expect(typesenseValue('  padded  ')).toBe('`padded`');
  });

  it('ignores empty and non-string values, coerces booleans, and clamps scores to finite numbers in range', () => {
    const f = buildTypesenseFilter({ city: '   ', state: 5 as any, hasWebsite: 'yes' as any, hasEmail: true, minOrionScore: -50, maxOrionScore: Infinity as any });
    expect(f).not.toContain('city:=');
    expect(f).not.toContain('state:=');
    expect(f).toContain('has_website:=false');
    expect(f).toContain('has_email:=true');
    expect(f).toContain('orion_score:[0..100]');
    expect(buildTypesenseFilter({ minOrionScore: '40' as any, maxOrionScore: 9999 })).toContain('orion_score:[40..100]');
  });

  describe('sorting', () => {
    it('keeps allowlisted fields and directions', () => {
      expect(safeTypesenseSort('orion_score:desc,created_at:desc')).toBe('orion_score:desc,created_at:desc');
      expect(safeTypesenseSort('name:asc')).toBe('name:asc');
      expect(safeTypesenseSort('Created_At:ASC')).toBe('created_at:asc');
      expect(safeTypesenseSort('orion_score')).toBe('orion_score:desc');
    });
    it('maps the friendly names the UI uses', () => {
      expect(safeTypesenseSort('newest')).toBe('created_at:desc');
      expect(safeTypesenseSort('oldest')).toBe('created_at:asc');
      expect(safeTypesenseSort('name_asc')).toBe('name:asc');
      expect(safeTypesenseSort('recently_updated')).toBe('updated_at:desc');
    });
    it('falls back to the default for anything else, without failing the request', () => {
      for (const bad of [undefined, '', 'password:asc', 'orion_score:sideways', 'a:b:c', 'name:asc;DROP', '_eval(x):desc', 'orion_score:desc,created_at:desc,name:asc,updated_at:asc', '`x`']) {
        expect(safeTypesenseSort(bad as any)).toBe(DEFAULT_TYPESENSE_SORT);
      }
    });
  });
});
