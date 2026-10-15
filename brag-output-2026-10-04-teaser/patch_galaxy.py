import re
p = r'D:\ownus\brag-output-2026-10-04-teaser\composition\index.html'
s = open(p, encoding='utf8').read()

# ---- CSS
s = re.sub(r"      \.blob \{.*?\.dot \{[^\n]*\n",
           "      .gx { position:absolute; left:-90px; top:-85px; width:2100px; height:1250px; }\n      .tw { position:absolute; border-radius:50%; background:#fff; }\n",
           s, flags=re.S)
s = s.replace("transform-origin:960px 440px;", "transform-origin:960px 510px;")
s = s.replace(".star .halo { position:absolute; left:-110px; top:-110px; width:220px; height:220px;",
              ".star .halo { position:absolute; left:-70px; top:-70px; width:140px; height:140px;")
s = s.replace("rgba(233,226,255,.38),rgba(167,139,250,.14) 38%,transparent 70%",
              "rgba(233,226,255,.30),rgba(167,139,250,.10) 40%,transparent 70%")
s = s.replace(".star .fh { left:-90px; top:-1.5px; width:180px; height:3px; }",
              ".star .fh { left:-60px; top:-1px; width:120px; height:2px; }")
s = s.replace(".star .fv { left:-1.5px; top:-90px; width:3px; height:180px;",
              ".star .fv { left:-1px; top:-60px; width:2px; height:120px;")
s = s.replace("stroke-width:2.5;", "stroke-width:2;")
s = s.replace("    </style>",
              "      .nm { position:absolute; font-family:var(--mono); font-size:17px; letter-spacing:.22em; color:rgba(196,181,253,.8); white-space:nowrap; opacity:0; }\n    </style>")

# ---- HTML
s = re.sub(r'      <div id="b1" class="blob abs">.*?<div id="dust3" class="dust"></div>\n',
           '      <canvas id="g1" class="gx" width="2100" height="1250"></canvas>\n'
           '      <canvas id="g2" class="gx" width="2100" height="1250"></canvas>\n'
           '      <canvas id="g3" class="gx" width="2100" height="1250"></canvas>\n'
           '      <div id="twk"></div>\n', s, flags=re.S)

# ---- JS block
a = s.index("      // seeded dust (deterministic)")
b = s.index("      // text 1")
new = open(r'D:\ownus\brag-output-2026-10-04-teaser\galaxy_block.js', encoding='utf8').read()
s = s[:a] + new + s[b:]
open(p, 'w', encoding='utf8').write(s)
print('ok')
