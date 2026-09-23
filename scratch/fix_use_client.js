const fs = require('fs');
const path = require('path');

const files = [
  'ownus/src/app/(app)/discover/page.tsx',
  'ownus/src/components/discover/discover-filters.tsx',
  'ownus/src/components/admin/modals/business-details-modal.tsx',
  'ownus/src/components/admin/modals/business-validation-modal.tsx',
  'ownus/src/components/admin/views/business-records-view.tsx',
  'ownus/src/components/admin/views/data-validation-view.tsx',
  'ownus/src/components/admin/views/published-businesses-view.tsx',
  'ownus/src/components/admin/admin-active-filters.tsx',
  'ownus/src/components/ui/linkedin-icon.tsx'
];

const root = path.join(__dirname, '..');

files.forEach((relPath) => {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, 'utf8');

  if (content.includes("'use client'") || content.includes('"use client"')) {
    // Remove all occurrences of 'use client' or "use client"
    content = content.replace(/(['"]use client['"];?\r?\n?)/g, '');
    // Put 'use client'; at the very top
    content = `'use client';\n` + content.trimStart();
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log('Fixed use client order in:', relPath);
  }
});
