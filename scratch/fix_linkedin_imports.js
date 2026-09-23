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
];

const root = path.join(__dirname, '..');

files.forEach((relPath) => {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, 'utf8');

  // Remove Linkedin from lucide-react import
  content = content.replace(/,\s*Linkedin\r?\n/g, '\n');
  content = content.replace(/\r?\n\s*Linkedin,/g, '');
  content = content.replace(/,\s*Linkedin\s*}/g, ' }');

  // Add import { Linkedin } from '@/components/ui/linkedin-icon'; if not already present
  if (!content.includes("@/components/ui/linkedin-icon")) {
    content = `import { Linkedin } from '@/components/ui/linkedin-icon';\n` + content;
  }

  fs.writeFileSync(fullPath, content, 'utf8');
  console.log('Updated:', relPath);
});
