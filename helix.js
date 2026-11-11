/* 首页右侧的双螺旋：慢慢转，会跟着指针偏，按住会亮 */
(function () {
  const cv = document.getElementById('heroHelix');
  if (!cv) return;
  const S = 520;
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const N = 46;
  let t = 0, vel = 0.006, tilt = 0, target = 0, press = 0, breathT = 0;

  function draw() {
    g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    const amp = S * 0.26 * (1 + press * 0.10);
    const top = S * 0.07, span = S * 0.86;
    const roll = (t * 0.45) % 1;
    const breath = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(breathT * 0.8));
    const strands = [[], []];

    for (let i = 0; i < N; i++) {
      const u = (i + roll) / N;
      const y = top + u * span;
      const fade = Math.min(1, Math.min(u, 1 - u) * 6);
      const phase = u * Math.PI * 2.6 + t * 1.2;
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
