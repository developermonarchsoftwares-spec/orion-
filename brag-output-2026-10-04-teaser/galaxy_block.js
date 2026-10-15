      // ---------- galaxy (seeded, drawn once) ----------
      let sd = 20261004; const rnd = () => (sd = (sd * 1664525 + 1013904223) % 4294967296) / 4294967296;
      const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(6.2831853 * rnd());
      const CW = 2100, CH = 1250, ANG = -0.5; // band rises to the right
      const cos = Math.cos(ANG), sin = Math.sin(ANG);
      const bandPt = (t, o) => [CW / 2 + t * cos - o * sin, CH / 2 + t * sin + o * cos];
      const cols = ["#ffffff", "#ffffff", "#dbe6ff", "#c9d8ff", "#ffe9d2", "#e4d9ff"];
      const ctx = (id) => $("#" + id).getContext("2d");
      const dot = (g, x, y, r, a, col) => { g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
      const glowEllipse = (g, cx, cy, rx, ry, rgba, rot) => {
        g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(rx / ry, 1);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, ry); gr.addColorStop(0, rgba); gr.addColorStop(1, "rgba(10,10,10,0)");
        g.fillStyle = gr; g.fillRect(-ry * 3, -ry, ry * 6, ry * 2); g.restore();
      };
      // layer 1: deep field + galactic band glow
      (() => {
        const g = ctx("g1");
        g.fillStyle = "#0a0a0a"; g.fillRect(0, 0, CW, CH);
        glowEllipse(g, CW / 2, CH / 2, 1500, 330, "rgba(74,52,150,.22)", ANG);
        glowEllipse(g, CW / 2, CH / 2, 1250, 200, "rgba(124,58,237,.20)", ANG);
        glowEllipse(g, CW / 2, CH / 2, 900, 105, "rgba(196,181,253,.13)", ANG);
        glowEllipse(g, CW / 2 - 150, CH / 2 + 60, 380, 80, "rgba(255,228,200,.07)", ANG);
        for (let i = 0; i < 46; i++) {
          const [x, y] = bandPt((rnd() - .5) * 2400, gauss() * 120);
          glowEllipse(g, x, y, 60 + rnd() * 90, 30 + rnd() * 50, "rgba(" + (rnd() < .5 ? "150,120,240" : "110,130,255") + "," + (.03 + rnd() * .04) + ")", ANG + (rnd() - .5) * .6);
        }
        glowEllipse(g, CW / 2, CH / 2 + 18, 1400, 26, "rgba(6,5,12,.55)", ANG);
        for (let i = 0; i < 2600; i++) {
          let x, y;
          if (rnd() < .5) { [x, y] = bandPt((rnd() - .5) * 2600, gauss() * 190); } else { x = rnd() * CW; y = rnd() * CH; }
          dot(g, x, y, rnd() * .5 + .3, .22 + rnd() * .38, cols[(rnd() * cols.length) | 0]);
        }
        g.globalAlpha = 1;
      })();
      // layer 2: mid stars
      (() => {
        const g = ctx("g2");
        for (let i = 0; i < 1700; i++) {
          let x, y;
          if (rnd() < .45) { [x, y] = bandPt((rnd() - .5) * 2500, gauss() * 230); } else { x = rnd() * CW; y = rnd() * CH; }
          dot(g, x, y, rnd() * .7 + .5, .4 + rnd() * .5, cols[(rnd() * cols.length) | 0]);
        }
        g.globalAlpha = 1;
      })();
      // layer 3: bright stars with soft glow
      const bright = [];
      (() => {
        const g = ctx("g3");
        for (let i = 0; i < 260; i++) {
          let x, y;
          if (rnd() < .4) { [x, y] = bandPt((rnd() - .5) * 2400, gauss() * 260); } else { x = rnd() * CW; y = rnd() * CH; }
          const r = rnd() * .9 + .9, col = cols[(rnd() * cols.length) | 0];
          const gr = g.createRadialGradient(x, y, 0, x, y, r * 5); gr.addColorStop(0, "rgba(255,255,255,.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
          g.globalAlpha = .5 + rnd() * .5; g.fillStyle = gr; g.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
          dot(g, x, y, r, .95, col);
          if (i < 60) bright.push([x - 90, y - 85]);
        }
        g.globalAlpha = 1;
      })();
      // twinkle layer (finite, seek-safe)
      bright.forEach(([x, y]) => {
        if (x < 0 || x > 1920 || y < 0 || y > 1080) return;
        const d = document.createElement("div"); d.className = "tw";
        const r = 1.6 + rnd() * 1.4; d.style.cssText = "left:" + (x - r / 2) + "px;top:" + (y - r / 2) + "px;width:" + r + "px;height:" + r + "px;opacity:.2;box-shadow:0 0 " + (r * 4) + "px " + r + "px rgba(214,200,255,.55)";
        $("#twk").appendChild(d);
        tl.to(d, { opacity: 1, duration: 0.9 + rnd() * 1.4, ease: "sine.inOut", yoyo: true, repeat: 7 }, rnd() * 3);
      });
      tl.fromTo(["#g1", "#g2", "#g3"], { opacity: 0 }, { opacity: 1, duration: 2.4, ease: "sine.inOut" }, 0);
      tl.to("#g1", { x: 28, y: -14, duration: 18, ease: "none" }, 0);
      tl.to("#g2", { x: 56, y: -28, duration: 18, ease: "none" }, 0);
      tl.to("#g3", { x: 96, y: -48, duration: 18, ease: "none" }, 0);
      tl.to("#twk", { x: 96, y: -48, duration: 18, ease: "none" }, 0);

      // ---------- complete Orion constellation ----------
      const X0 = 520, Y0 = 110, W = 880, H = 800;
      const P = (nx, ny) => [X0 + nx * W, Y0 + ny * H];
      // name: [point, scale, ignite time, label]
      const defs = {
        alnilam: [P(.51, .50), 1.15, 0.3, "ALNILAM"], alnitak: [P(.44, .52), .95, 4.23, "ALNITAK"], mintaka: [P(.58, .48), .9, 4.5, "MINTAKA"],
        sw1: [P(.51, .60), .5, 4.76], sw2: [P(.51, .66), .62, 5.0], sw3: [P(.51, .72), .5, 5.28],
        betel: [P(.34, .16), 1.4, 5.5, "BETELGEUSE"], bella: [P(.68, .19), 1.0, 5.8, "BELLATRIX"], meissa: [P(.50, .04), .7, 6.07, "MEISSA"],
        arm1: [P(.22, .09), .55, 6.34], arm2: [P(.14, .17), .5, 6.55],
        sh1: [P(.84, .15), .55, 6.86], sh2: [P(.90, .30), .55, 7.07], sh3: [P(.92, .46), .55, 7.28], sh4: [P(.88, .60), .5, 7.5],
        saiph: [P(.38, .88), .95, 7.7, "SAIPH"], rigel: [P(.70, .84), 1.45, 7.92, "RIGEL"],
      };
      const cam = $("#cam"), svg = $("#lines");
      Object.entries(defs).forEach(([name, [[x, y], sc, t, label]]) => {
        const s = document.createElement("div"); s.className = "star"; s.id = "st_" + name;
        s.style.left = x + "px"; s.style.top = y + "px";
        s.innerHTML = '<div class="halo"></div><div class="fh"></div><div class="fv"></div><div class="core"></div>';
        cam.appendChild(s);
        tl.fromTo(s, { opacity: 0, scale: 0 }, { opacity: 1, scale: sc, duration: 0.6, ease: "back.out(2.2)" }, t);
        tl.to(s.querySelector(".halo"), { scale: 1.25, duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: 5 }, t + 0.6);
        if (label && name !== "alnilam") {
          const n = document.createElement("div"); n.className = "nm"; n.textContent = label;
          const right = x > 960; n.style.left = (right ? x + 26 : x - 26) + "px"; n.style.top = (y - 10) + "px";
          if (!right) n.style.transform = "translateX(-100%)";
          cam.appendChild(n); tl.to(n, { opacity: 1, duration: 0.6, ease }, t + 0.35);
        }
      });
      const segs = [
        ["alnitak","alnilam"],["alnilam","mintaka"],["alnilam","sw1"],["sw1","sw2"],["sw2","sw3"],
        ["betel","alnitak"],["bella","mintaka"],["betel","meissa"],["meissa","bella"],
        ["betel","arm1"],["arm1","arm2"],["bella","sh1"],["sh1","sh2"],["sh2","sh3"],["sh3","sh4"],
        ["alnitak","saiph"],["mintaka","rigel"],
      ];
      segs.forEach(([a, b]) => {
        const pa = defs[a][0], pb = defs[b][0];
        const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", "M" + pa[0] + " " + pa[1] + " L" + pb[0] + " " + pb[1]);
        p.setAttribute("stroke-dasharray", len); p.setAttribute("stroke-dashoffset", len);
        svg.appendChild(p);
        tl.to(p, { attr: { "stroke-dashoffset": 0 }, duration: 0.5, ease: "power2.out" }, Math.max(defs[a][2], defs[b][2]) + 0.12);
      });

