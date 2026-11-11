/* 首页右侧的双螺旋：慢慢转，会跟着指针偏，按住会亮 */
(function () {
  const cv = document.getElementById('heroHelix');
  if (!cv) return;
  const S = 520;
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const N = 46;

  /* 螺旋周围的粒子尘：40 颗，慢慢漂，靠近时亮一点 */
  const P = 64;
  const dust = [];
  for (let i = 0; i < P; i++) {
    dust.push({
      a: Math.random() * Math.PI * 2,        // 角度
      r: 0.58 + Math.random() * 0.36,        // 相对半径（只在外圈，中心留空）
      s: 0.0008 + Math.random() * 0.0022,    // 角速度
      z: Math.random(),                      // 层次
      tw: Math.random() * Math.PI * 2,       // 闪烁相位
    });
  }

  let t = 0, vel = 0.006, tilt = 0, target = 0, press = 0, breathT = 0;

  function draw() {
    g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    const amp = S * 0.34 * (1 + press * 0.10);
    const top = S * 0.05, span = S * 0.90;
    const roll = (t * 0.45) % 1;
    const breath = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(breathT * 0.8));
    const strands = [[], []];

    for (let i = 0; i < N; i++) {
      const u = (i + roll) / N;
      const y = top + u * span;
      const fade = Math.min(1, Math.min(u, 1 - u) * 6);
      const phase = u * Math.PI * 3.2 + t * 1.2;
      const dx = Math.sin(phase) * amp;
      const z = Math.cos(phase);
      strands[0].push({x: cx + dx * (1 + tilt * 0.35), y, z, a: fade});
      strands[1].push({x: cx - dx * (1 - tilt * 0.35), y, z: -z, a: fade});
    }

    for (let i = 0; i < N; i += 2) {
      const a = strands[0][i], b = strands[1][i];
      const d = (a.z + b.z) / 2;
      g.strokeStyle = 'rgba(232,23,61,' + ((0.06 + 0.12 * (d + 1) / 2) * a.a * breath).toFixed(3) + ')';
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    const all = [...strands[0], ...strands[1]].sort((p1, p2) => p1.z - p2.z);
    all.forEach(p1 => {
      const near = (p1.z + 1) / 2;
      const r = (2.0 + 3.4 * near) * (1 + press * 0.22);
      const grd = g.createRadialGradient(p1.x, p1.y, 0, p1.x, p1.y, r * 4.5);
      grd.addColorStop(0, 'rgba(232,23,61,' + ((0.10 + 0.22 * near) * p1.a * breath).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(232,23,61,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(p1.x, p1.y, r * 4.5, 0, 7); g.fill();
      g.fillStyle = 'rgba(232,23,61,' + Math.min(1, (0.40 + 0.55 * near) * p1.a * (0.8 + 0.3 * breath)).toFixed(3) + ')';
      g.beginPath(); g.arc(p1.x, p1.y, Math.max(1.2, r * 0.6), 0, 7); g.fill();
    });

    /* 粒子尘 */
    const cx2 = S / 2, cy2 = S / 2;
    for (const d of dust) {
      const ang = d.a + t * d.s * 9;
      const wob = 1 + 0.06 * Math.sin(t * 1.7 + d.tw);
      const rr = S * d.r * wob;
      let px = cx2 + Math.cos(ang) * rr * 0.62;
      let py = cy2 + Math.sin(ang) * rr;
      // 螺旋中心那块留空，粒子只在外围飘
      if (Math.abs(px - cx2) < S * 0.19 && Math.abs(py - cy2) < S * 0.13) continue;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2.4 + d.tw));
      const al = (0.22 + 0.55 * d.z) * tw * breath;
      const rad = 2.0 + 4.2 * d.z;
      g.fillStyle = 'rgba(232,23,61,' + al.toFixed(3) + ')';
      g.beginPath(); g.arc(px, py, rad, 0, 7); g.fill();
      if (d.z > 0.72) {
        g.fillStyle = 'rgba(255,255,255,' + (al * 0.5).toFixed(3) + ')';
        g.beginPath(); g.arc(px, py, rad * 0.45, 0, 7); g.fill();
      }
    }
  }

  function tick() {
    if (!reduce) { t += vel; breathT += 0.016; }
    tilt += (target - tilt) * 0.06;
    press *= 0.94;
    draw();
    requestAnimationFrame(tick);
  }
  tick();

  const onMove = (e) => {
    const r = cv.getBoundingClientRect();
    target = ((e.clientX - r.left) / r.width - 0.5) * 1.4;
  };
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerdown', onMove);
  cv.addEventListener('pointerleave', () => { target = 0; });
})();
