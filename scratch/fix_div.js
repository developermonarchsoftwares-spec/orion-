const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../ownus/src/app/(app)/discover/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const target = `<Linkedin className="w-3 h-3" />
                               </div>
                              </div>`;

if (content.includes('</div>\r\n                              </div>')) {
  content = content.replace('</div>\r\n                              </div>', '</div>');
  console.log('Replaced CRLF version');
} else if (content.includes('</div>\n                              </div>')) {
  content = content.replace('</div>\n                              </div>', '</div>');
  console.log('Replaced LF version');
} else {
  // Regex fallback
  content = content.replace(/(<Linkedin className="w-3 h-3" \/>\s*<\/div>)\s*<\/div>/, '$1');
  console.log('Replaced regex version');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done');
