/* =========================================================
   Tumbang Lata — a Filipino street game in vanilla JS
   Roles switch: if the thrower gets tagged, they become TAYA.
   ========================================================= */
(() => {
  'use strict';

  // ---------- Setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const FIELD = { x: 20, y: 20, w: W - 40, h: H - 40 };
  const LINE_Y = 465;                         // throw line (safe zone is below)
  const CIRCLE = { x: W / 2, y: 135, r: 36 }; // where the can stands
  const GUARD_SPOT = { x: CIRCLE.x + 55, y: CIRCLE.y + 10 };
  const PLAYER_R = 16;
  const TAYA_R = 18;
  const CAN_R = 12;
  const SLIP_R = 12;
  const MAX_DRAG = 160;
  const MAX_POWER = 950;
  const FRICTION_K = Math.log(4);             // slipper: v *= 0.25^dt
  const PLAYER_SPEED = 250;
  const CPU_AIM_TIME = 1.1;

  const USER_COLOR = '#2f7de1';
  const CPU_COLOR = '#c8352a';

  const $ = (id) => document.getElementById(id);
  const ui = {
    score: $('score'), level: $('level'), lives: $('lives'), best: $('best'), role: $('role'),
    overlay: $('overlay'), title: $('ovTitle'), text: $('ovText'), btn: $('startBtn'),
  };

  let best = 0;
  try { best = parseInt(localStorage.getItem('tumbang-lata-best'), 10) || 0; } catch (e) { /* storage blocked */ }

  // Random pebbles for the dirt field (generated once)
  const pebbles = Array.from({ length: 160 }, () => ({
    x: FIELD.x + Math.random() * FIELD.w,
    y: FIELD.y + Math.random() * FIELD.h,
    r: 1 + Math.random() * 2.5,
    a: 0.08 + Math.random() * 0.18,
  }));

  // ---------- Helpers ----------
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function moveToward(obj, target, speed, dt) {
    const dx = target.x - obj.x;
    const dy = target.y - obj.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return true;
    const step = Math.min(d, speed * dt);
    obj.x += (dx / d) * step;
    obj.y += (dy / d) * step;
    obj.fx = dx / d;
    obj.fy = dy / d;
    return step >= d;
  }

  function applyMove(obj, mx, my, speed, dt) {
    const len = Math.hypot(mx, my);
    if (len < 0.01) return;
    obj.fx = mx / len;
    obj.fy = my / len;
    obj.x += obj.fx * speed * dt;
    obj.y += obj.fy * speed * dt;
  }

  function clampToField(o) {
    o.x = clamp(o.x, FIELD.x + o.r, FIELD.x + FIELD.w - o.r);
    o.y = clamp(o.y, FIELD.y + o.r, FIELD.y + FIELD.h - o.r);
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Game state ----------
  let S = null;
  const keys = { up: false, down: false, left: false, right: false };
  const pointer = { down: false, aiming: false, x: 0, y: 0, sx: 0, sy: 0 };

  const level = () => 1 + Math.floor(S.score / 3);
  const cpuTayaSpeed = () => Math.min(150 + (level() - 1) * 16, 275);
  const cpuRunSpeed = () => Math.min(205 + (level() - 1) * 10, 265);
  const leash = () => Math.min(210 + (level() - 1) * 18, 370);
  const userIsThrower = () => S.userRole === 'thrower';

  function newGame() {
    S = {
      running: false,
      score: 0,
      lives: 3,
      userRole: 'thrower', // 'thrower' | 'taya'
      phase: 'aim',        // aim | flying | run | return | wait
      knocked: false,      // was the can knocked down this round?
      pause: 0,
      pending: null,       // what happens after the pause: swap / gameover
      shake: 0,
      lastLevel: 1,
      messages: [],
      particles: [],
      thrower: { x: 0, y: 0, r: PLAYER_R, fx: 0, fy: -1 },
      taya: { x: 0, y: 0, r: TAYA_R, fx: 0, fy: 1, mode: 'guard', delay: 0 },
      can: { x: 0, y: 0, vx: 0, vy: 0, up: true, carried: false, angle: 0, spin: 0 },
      slip: { x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0, held: true },
      cpu: { spotX: W / 2, aim: null, timer: 0, bold: 0 },
    };
    resetRound();
    updateHUD();
  }

  function resetRound() {
    const { thrower: p, taya: t, can: c, slip: sl, cpu } = S;
    p.x = W / 2; p.y = 530; p.fx = 0; p.fy = -1;
    t.x = GUARD_SPOT.x; t.y = GUARD_SPOT.y; t.mode = 'guard'; t.delay = 0;
    Object.assign(c, { x: CIRCLE.x, y: CIRCLE.y, vx: 0, vy: 0, up: true, carried: false, angle: 0, spin: 0 });
    Object.assign(sl, { vx: 0, vy: 0, held: true, spin: 0 });
    Object.assign(cpu, { spotX: rand(220, W - 220), aim: null, timer: 0, bold: 0 });
    S.phase = 'aim';
    S.knocked = false;
    pointer.aiming = false;
  }

  function say(text, x, y, color = '#fff', size = 30) {
    S.messages.push({ text, x, y, color, size, life: 1.4, max: 1.4 });
  }

  function dust(x, y, n = 18, color = '210,180,130') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(40, 220);
      S.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 0.9), r: rand(2, 5), color });
    }
  }

  function updateHUD() {
    ui.score.textContent = S.score;
    ui.level.textContent = level();
    ui.lives.textContent = '♥'.repeat(Math.max(0, S.lives)) + '♡'.repeat(Math.max(0, 3 - S.lives));
    ui.best.textContent = best;
    ui.role.textContent = userIsThrower() ? 'Tagahagis' : 'Taya';
    ui.role.classList.toggle('is-taya', !userIsThrower());
  }

  function checkLevel() {
    if (level() > S.lastLevel) {
      S.lastLevel = level();
      say(`LEVEL ${level()}!`, W / 2, H / 2 + 40, '#ffc83d', 30);
    }
  }

  function showOverlay(title, html, btnText) {
    ui.title.innerHTML = title;
    ui.text.innerHTML = html;
    ui.btn.textContent = btnText;
    ui.overlay.classList.remove('hidden');
  }

  function start() {
    newGame();
    S.running = true;
    ui.overlay.classList.add('hidden');
  }

  function gameOver() {
    S.running = false;
    if (S.score > best) {
      best = S.score;
      try { localStorage.setItem('tumbang-lata-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHUD();
    showOverlay(
      'Game <span>Over</span>',
      `You scored <b>${S.score}</b> point${S.score === 1 ? '' : 's'} · Best: <b>${best}</b>`,
      'Laro ulit!'
    );
  }

  // ---------- Input ----------
  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };
  window.addEventListener('keydown', (e) => {
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
  });
  window.addEventListener('blur', () => { Object.keys(keys).forEach((k) => (keys[k] = false)); });

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!S || !S.running) return;
    canvas.setPointerCapture(e.pointerId);
    const pt = toCanvas(e);
    pointer.down = true;
    pointer.x = pointer.sx = pt.x;
    pointer.y = pointer.sy = pt.y;
    pointer.aiming = userIsThrower() && S.phase === 'aim' && S.pause <= 0;
  });

  canvas.addEventListener('pointermove', (e) => {
    const pt = toCanvas(e);
    pointer.x = pt.x;
    pointer.y = pt.y;
  });

  canvas.addEventListener('pointerup', () => {
    if (pointer.aiming && S && userIsThrower() && S.phase === 'aim') {
      const a = aimVector();
      if (a.len >= 15) doThrow(S.thrower, a.dx, a.dy, a.power);
    }
    pointer.down = false;
    pointer.aiming = false;
  });
  canvas.addEventListener('pointercancel', () => { pointer.down = false; pointer.aiming = false; });

  ui.btn.addEventListener('click', start);

  // movement vector from keyboard or hold-to-run pointer
  function userInput(ent) {
    let mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let my = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (pointer.down && !pointer.aiming) {
      const dx = pointer.x - ent.x;
      const dy = pointer.y - ent.y;
      if (Math.hypot(dx, dy) > 8) { mx = dx; my = dy; }
    }
    return [mx, my];
  }

  function aimVector() {
    const dx = pointer.sx - pointer.x;
    const dy = pointer.sy - pointer.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return { dx: 0, dy: 0, len: 0, power: 0 };
    const l = Math.min(len, MAX_DRAG);
    return { dx: dx / len, dy: dy / len, len: l, power: l / MAX_DRAG };
  }

  function doThrow(p, dx, dy, power) {
    const speed = power * MAX_POWER;
    Object.assign(S.slip, {
      x: p.x + dx * 14, y: p.y + dy * 14,
      vx: dx * speed, vy: dy * speed,
      held: false, angle: Math.atan2(dy, dx), spin: rand(10, 18) * (Math.random() < 0.5 ? -1 : 1),
    });
    S.phase = 'flying';
  }

  // ---------- Update ----------
  function update(dt) {
    S.particles.forEach((pt) => {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= Math.pow(0.05, dt); pt.vy *= Math.pow(0.05, dt);
      pt.life -= dt;
    });
    S.particles = S.particles.filter((pt) => pt.life > 0);
    S.messages.forEach((m) => { m.life -= dt; m.y -= 30 * dt; });
    S.messages = S.messages.filter((m) => m.life > 0);
    S.shake = Math.max(0, S.shake - 40 * dt);

    if (!S.running) return;

    // short freeze after a tag, then switch roles / end game
    if (S.pause > 0) {
      S.pause -= dt;
      if (S.pause <= 0) finishPause();
      return;
    }

    updateThrower(dt);
    updateSlipper(dt);
    updateCan(dt);
    if (userIsThrower()) updateCpuTaya(dt);
    else updateUserTaya(dt);
    checkRound();
  }

  function finishPause() {
    const next = S.pending;
    S.pending = null;
    if (next === 'gameover') { gameOver(); return; }
    if (next === 'to-taya') S.userRole = 'taya';
    if (next === 'to-thrower') S.userRole = 'thrower';
    resetRound();
    updateHUD();
    if (next === 'to-taya') say('Ikaw na ang TAYA!', W / 2, H / 2, '#ff8a7a', 38);
    if (next === 'to-thrower') say('Ikaw na ulit ang maghahagis!', W / 2, H / 2, '#8dc4ff', 32);
  }

  // The thrower got tagged by the taya
  function caught() {
    const p = S.thrower;
    S.shake = 16;
    S.pause = 1.4;
    dust(p.x, p.y, 22, '255,120,100');
    if (userIsThrower()) {
      S.lives -= 1;
      say('Huli ka!', p.x, p.y - 34, '#ff6b5b', 36);
      S.pending = S.lives <= 0 ? 'gameover' : 'to-taya';
    } else {
      S.score += 2;
      say('Huli! +2', p.x, p.y - 34, '#8dff9a', 36);
      S.pending = 'to-thrower';
      checkLevel();
    }
    updateHUD();
  }

  function standCan() {
    Object.assign(S.can, { x: CIRCLE.x, y: CIRCLE.y, vx: 0, vy: 0, up: true, carried: false, angle: 0, spin: 0 });
    S.taya.mode = 'guard';
    say('Tayo na ang lata!', CIRCLE.x, CIRCLE.y - 50, '#ff8a7a', 20);
  }

  // ----- Thrower (user or CPU) -----
  function updateThrower(dt) {
    const p = S.thrower;
    let mx, my, speed;
    if (userIsThrower()) {
      [mx, my] = userInput(p);
      speed = PLAYER_SPEED;
    } else {
      [mx, my] = cpuThrowerSteer(dt);
      speed = cpuRunSpeed();
    }
    applyMove(p, mx, my, speed, dt);
    clampToField(p);

    // Can't leave the safe zone until the slipper is thrown
    if (S.phase === 'aim' || S.phase === 'flying' || S.phase === 'wait') {
      p.y = Math.max(p.y, LINE_Y + p.r + 4);
    }

    // pick up the slipper
    const sl = S.slip;
    if (S.phase === 'run' && !sl.held && dist(p, sl) < p.r + SLIP_R + 4) {
      sl.held = true;
      S.phase = 'return';
      if (userIsThrower()) say('Kuha!', p.x, p.y - 30, '#ffe08a', 22);
    }
  }

  function cpuThrowerSteer(dt) {
    const p = S.thrower;
    const sl = S.slip;
    const c = S.can;
    const t = S.taya;
    const cpu = S.cpu;

    if (S.phase === 'aim') {
      const spot = { x: cpu.spotX, y: 530 };
      if (dist(p, spot) > 4) return [spot.x - p.x, spot.y - p.y];
      if (!cpu.aim) {
        const err = Math.max(0.03, 0.14 - (level() - 1) * 0.012);
        const ang = Math.atan2(c.y - p.y, c.x - p.x) + rand(-err, err);
        const reach = dist(p, c) + rand(30, 170);
        cpu.aim = { ang, power: Math.min(1, (reach * FRICTION_K) / MAX_POWER) };
        cpu.timer = CPU_AIM_TIME;
      }
      p.fx = Math.cos(cpu.aim.ang);
      p.fy = Math.sin(cpu.aim.ang);
      cpu.timer -= dt;
      if (cpu.timer <= 0) {
        doThrow(p, p.fx, p.fy, cpu.aim.power);
        cpu.aim = null;
        cpu.bold = 0;
        cpu.spotX = rand(220, W - 220);
      }
      return [0, 0];
    }

    if (S.phase === 'flying' || S.phase === 'wait') return [0, 0];

    // run / return: go for the slipper, then home — but dodge the taya
    cpu.bold += dt;
    const goal = sl.held ? { x: p.x, y: LINE_Y + 60 } : sl;
    let gx = goal.x - p.x;
    let gy = goal.y - p.y;
    const gl = Math.hypot(gx, gy) || 1;
    gx /= gl; gy /= gl;

    if (c.up && p.y < LINE_Y + 10) {
      const d = dist(p, t) || 1;
      // gets braver the longer it waits, so it can't be stalled forever
      const danger = Math.max(0, (170 - d) / 170) * Math.max(0, 1.8 - cpu.bold * 0.2);
      gx += ((p.x - t.x) / d) * danger * 1.8;
      gy += ((p.y - t.y) / d) * danger * 1.8;
    }
    return [gx, gy];
  }

  // ----- Slipper & can physics -----
  function updateSlipper(dt) {
    const sl = S.slip;
    const c = S.can;
    if (sl.held) {
      sl.x = S.thrower.x + 12;
      sl.y = S.thrower.y + 6;
      return;
    }

    sl.x += sl.vx * dt;
    sl.y += sl.vy * dt;
    const fr = Math.pow(0.25, dt);
    sl.vx *= fr; sl.vy *= fr;
    sl.angle += sl.spin * dt;
    sl.spin *= Math.pow(0.2, dt);

    if (sl.x < FIELD.x + SLIP_R) { sl.x = FIELD.x + SLIP_R; sl.vx = Math.abs(sl.vx) * 0.5; }
    if (sl.x > FIELD.x + FIELD.w - SLIP_R) { sl.x = FIELD.x + FIELD.w - SLIP_R; sl.vx = -Math.abs(sl.vx) * 0.5; }
    if (sl.y < FIELD.y + SLIP_R) { sl.y = FIELD.y + SLIP_R; sl.vy = Math.abs(sl.vy) * 0.5; }
    if (sl.y > FIELD.y + FIELD.h - SLIP_R) { sl.y = FIELD.y + FIELD.h - SLIP_R; sl.vy = -Math.abs(sl.vy) * 0.5; }

    const speed = Math.hypot(sl.vx, sl.vy);

    // TUMBA! — knock the can
    if (c.up && !c.carried && speed > 60 && dist(sl, c) < SLIP_R + CAN_R) {
      c.up = false;
      c.vx = sl.vx * 0.9 + rand(-80, 80);
      c.vy = sl.vy * 0.9 + rand(-40, 40);
      c.spin = rand(-14, 14);
      sl.vx *= -0.25; sl.vy *= -0.25;
      S.knocked = true;
      S.phase = 'run';
      S.shake = 12;
      S.taya.mode = 'fetch';
      S.taya.delay = 0.45;
      dust(c.x, c.y, 26);
      say('TUMBA!', c.x, c.y - 30, '#ffc83d', 40);
    }

    if (speed < 25 && S.phase === 'flying') {
      sl.vx = sl.vy = 0;
      S.phase = 'run';
    }
  }

  function updateCan(dt) {
    const c = S.can;
    if (c.up || c.carried) return;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    const fr = Math.pow(0.18, dt);
    c.vx *= fr; c.vy *= fr;
    c.angle += c.spin * dt;
    c.spin *= Math.pow(0.15, dt);

    if (c.x < FIELD.x + CAN_R) { c.x = FIELD.x + CAN_R; c.vx = Math.abs(c.vx) * 0.6; }
    if (c.x > FIELD.x + FIELD.w - CAN_R) { c.x = FIELD.x + FIELD.w - CAN_R; c.vx = -Math.abs(c.vx) * 0.6; }
    if (c.y < FIELD.y + CAN_R) { c.y = FIELD.y + CAN_R; c.vy = Math.abs(c.vy) * 0.6; }
    if (c.y > FIELD.y + FIELD.h - CAN_R) { c.y = FIELD.y + FIELD.h - CAN_R; c.vy = -Math.abs(c.vy) * 0.6; }
  }

  function carryCan(t) {
    const c = S.can;
    c.x = t.x + t.fx * 14;
    c.y = t.y + t.fy * 14;
    c.angle = Math.atan2(t.fy, t.fx);
  }

  // ----- Taya controlled by the user -----
  function updateUserTaya(dt) {
    const t = S.taya;
    const c = S.can;
    const p = S.thrower;

    const [mx, my] = userInput(t);
    applyMove(t, mx, my, c.carried ? PLAYER_SPEED * 0.8 : PLAYER_SPEED, dt);
    clampToField(t);
    t.y = Math.min(t.y, LINE_Y - t.r - 2); // the taya can't enter the safe zone

    // grab the fallen can
    if (!c.up && !c.carried && dist(t, c) < t.r + CAN_R + 4) {
      c.carried = true;
      c.vx = c.vy = 0;
    }
    // bring it back to the circle
    if (c.carried) {
      carryCan(t);
      if (dist(t, CIRCLE) < CIRCLE.r) standCan();
    }
    // tag! (only while the can is standing and the thrower is past the line)
    if (c.up && p.y < LINE_Y - 2 && dist(t, p) < t.r + p.r - 2) caught();
  }

  // ----- Taya controlled by the CPU -----
  function updateCpuTaya(dt) {
    const t = S.taya;
    const c = S.can;
    const p = S.thrower;
    const sp = cpuTayaSpeed();

    if (t.delay > 0) { t.delay -= dt; return; }

    if (t.mode === 'fetch') {
      moveToward(t, c, sp * 1.05, dt);
      if (dist(t, c) < t.r + CAN_R + 2) {
        t.mode = 'carry';
        c.carried = true;
      }
      return;
    }

    if (t.mode === 'carry') {
      const arrived = moveToward(t, CIRCLE, sp * 0.75, dt);
      carryCan(t);
      if (arrived) standCan();
      return;
    }

    // guard / chase — only allowed to tag while the can is standing
    const vulnerable = c.up && p.y < LINE_Y - 2;
    if (vulnerable) {
      t.mode = 'chase';
      let target = { x: p.x, y: p.y };
      const L = leash();
      const d = dist(target, CIRCLE);
      if (d > L) {
        target = { x: CIRCLE.x + ((p.x - CIRCLE.x) / d) * L, y: CIRCLE.y + ((p.y - CIRCLE.y) / d) * L };
      }
      moveToward(t, target, sp, dt);
      t.y = Math.min(t.y, LINE_Y - t.r - 2);
      if (dist(t, p) < t.r + p.r - 2) caught();
    } else {
      t.mode = 'guard';
      moveToward(t, GUARD_SPOT, sp * 0.6, dt);
    }
  }

  function checkRound() {
    const p = S.thrower;
    if (S.phase === 'return' && p.y > LINE_Y + p.r) {
      if (S.knocked) {
        if (userIsThrower()) {
          S.score += 1;
          say('+1 Ligtas!', p.x, p.y - 34, '#8dff9a', 30);
          checkLevel();
          updateHUD();
        } else {
          say('Nakaligtas siya!', p.x, p.y - 34, '#ffb3aa', 22);
        }
      } else if (userIsThrower()) {
        say('Ligtas!', p.x, p.y - 34, '#ffffff', 22);
      }
      S.knocked = false;
      S.phase = S.can.up ? 'aim' : 'wait';
    }
    if (S.phase === 'wait' && S.can.up) S.phase = 'aim';
  }

  // ---------- Drawing ----------
  function drawField() {
    ctx.fillStyle = '#4f8a3a';
    ctx.fillRect(0, 0, W, H);

    const g = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, W * 0.65);
    g.addColorStop(0, '#d2a565');
    g.addColorStop(1, '#a87a43');
    ctx.fillStyle = g;
    roundRectPath(FIELD.x, FIELD.y, FIELD.w, FIELD.h, 18);
    ctx.fill();

    pebbles.forEach((pb) => {
      ctx.fillStyle = `rgba(60,35,15,${pb.a})`;
      ctx.beginPath();
      ctx.arc(pb.x, pb.y, pb.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // safe zone
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(FIELD.x, LINE_Y, FIELD.w, FIELD.y + FIELD.h - LINE_Y);

    // chalk throw line
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(FIELD.x + 10, LINE_Y);
    ctx.lineTo(FIELD.x + FIELD.w - 10, LINE_Y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('LINYA', FIELD.x + 14, LINE_Y + 18);

    // can circle (glows when you're taya and carrying the can)
    const glow = S && !userIsThrower() && S.can.carried;
    ctx.strokeStyle = glow ? 'rgba(255,200,61,0.95)' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = glow ? 5 : 4;
    ctx.beginPath();
    ctx.arc(CIRCLE.x, CIRCLE.y, CIRCLE.r, 0, Math.PI * 2);
    ctx.stroke();

    // CPU taya's reach (only matters while the can stands)
    if (S && userIsThrower() && S.can.up) {
      ctx.strokeStyle = 'rgba(200,40,30,0.22)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.arc(CIRCLE.x, CIRCLE.y, leash() + TAYA_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawShadow(x, y, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 5, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCan(c) {
    if (c.up) {
      drawShadow(c.x, c.y, CAN_R + 2, CAN_R);
      const g = ctx.createRadialGradient(c.x - 4, c.y - 4, 2, c.x, c.y, CAN_R + 2);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, '#c9ced4');
      g.addColorStop(1, '#7d848c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, CAN_R + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5d636a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, CAN_R - 3, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    if (!c.carried) drawShadow(0, 0, 16, 9);
    ctx.rotate(c.angle);
    const g = ctx.createLinearGradient(0, -9, 0, 9);
    g.addColorStop(0, '#f2f4f6');
    g.addColorStop(0.5, '#a5abb2');
    g.addColorStop(1, '#6b7178');
    ctx.fillStyle = g;
    roundRectPath(-16, -9, 32, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#d23b2f';
    ctx.fillRect(-7, -9, 14, 18);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(-7, -2, 14, 4);
    ctx.restore();
  }

  function drawSlipper(sl) {
    ctx.save();
    ctx.translate(sl.x, sl.y);
    ctx.rotate(sl.held ? -0.6 : sl.angle);
    const s = sl.held ? 0.75 : 1;
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRectPath(-12, -4, 28, 14, 7);
    ctx.fill();
    ctx.fillStyle = '#1f6fd6';
    roundRectPath(-14, -7, 28, 14, 7);
    ctx.fill();
    ctx.fillStyle = '#9cc6ff';
    roundRectPath(-12, -5, 24, 10, 5);
    ctx.fill();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, -5);
    ctx.lineTo(6, 0);
    ctx.lineTo(-4, 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawPerson(o, shirt, label, labelColor) {
    drawShadow(o.x, o.y, o.r, o.r * 0.7);
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const hx = o.x + o.fx * 3;
    const hy = o.y + o.fy * 3;
    ctx.fillStyle = '#e2ae74';
    ctx.beginPath();
    ctx.arc(hx + o.fx * 3, hy + o.fy * 3, o.r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a1c12';
    ctx.beginPath();
    ctx.arc(hx - o.fx, hy - o.fy, o.r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(label, o.x, o.y - o.r - 8);
    ctx.fillStyle = labelColor;
    ctx.fillText(label, o.x, o.y - o.r - 8);
  }

  function drawArrow(x, y, dx, dy, reach, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([2, 10]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * reach, y + dy * reach);
    ctx.stroke();
    ctx.setLineDash([]);
    const ex = x + dx * reach;
    const ey = y + dy * reach;
    const ang = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(ang) * 10, ey + Math.sin(ang) * 10);
    ctx.lineTo(ex + Math.cos(ang + 2.5) * 10, ey + Math.sin(ang + 2.5) * 10);
    ctx.lineTo(ex + Math.cos(ang - 2.5) * 10, ey + Math.sin(ang - 2.5) * 10);
    ctx.fill();
  }

  function drawAim() {
    if (S.phase !== 'aim') return;
    const p = S.thrower;

    // CPU telegraphs its throw so you can get ready
    if (!userIsThrower()) {
      const aim = S.cpu.aim;
      if (!aim) return;
      const reach = (aim.power * MAX_POWER) / FRICTION_K;
      const alpha = 0.35 + 0.35 * Math.sin(performance.now() / 90);
      drawArrow(p.x, p.y, Math.cos(aim.ang), Math.sin(aim.ang), reach, `rgba(255,90,70,${alpha})`);
      return;
    }

    if (!pointer.aiming) return;
    const a = aimVector();
    if (a.len < 5) return;
    const reach = (a.power * MAX_POWER) / FRICTION_K; // exact stopping distance
    drawArrow(p.x, p.y, a.dx, a.dy, reach, `rgba(255,${Math.round(230 - a.power * 160)},80,0.9)`);

    const bw = 120;
    const bx = W - bw - 40;
    const by = H - 46;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRectPath(bx - 4, by - 4, bw + 8, 16, 6);
    ctx.fill();
    ctx.fillStyle = `hsl(${120 - a.power * 120}, 85%, 55%)`;
    roundRectPath(bx, by, Math.max(8, bw * a.power), 8, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('LAKAS', bx - 10, by + 8);
  }

  function hintText() {
    if (userIsThrower()) {
      return {
        aim: 'I-drag pabalik at bitawan para ihagis ang tsinelas',
        flying: '',
        run: 'Kunin ang tsinelas mo!',
        return: 'Bumalik sa likod ng linya!',
        wait: 'Hinihintay itayo ng taya ang lata...',
      }[S.phase];
    }
    const c = S.can;
    if (!c.up && !c.carried) return 'Kunin ang lata!';
    if (c.carried) return 'Ibalik ang lata sa bilog!';
    if (S.thrower.y < LINE_Y - 2) return 'Habulin at taya-in siya!';
    if (S.phase === 'aim') return 'Ikaw ang TAYA — bantayan ang lata!';
    return '';
  }

  function drawHint() {
    if (!S.running || S.pause > 0) return;
    const text = hintText();
    if (!text) return;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 28;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRectPath(W / 2 - w / 2, H - 50, w, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, W / 2, H - 31);
  }

  function draw() {
    ctx.save();
    if (S.shake > 0) ctx.translate(rand(-S.shake, S.shake) * 0.5, rand(-S.shake, S.shake) * 0.5);

    drawField();

    if (!S.can.carried) drawCan(S.can);
    if (!S.slip.held) drawSlipper(S.slip);

    const userThrows = userIsThrower();
    drawPerson(S.taya, userThrows ? CPU_COLOR : USER_COLOR,
      userThrows ? 'TAYA' : 'IKAW · TAYA', userThrows ? '#ffb3aa' : '#cfe4ff');
    drawPerson(S.thrower, userThrows ? USER_COLOR : CPU_COLOR,
      userThrows ? 'IKAW' : 'KALABAN', userThrows ? '#cfe4ff' : '#ffb3aa');

    if (S.slip.held) drawSlipper(S.slip);
    if (S.can.carried) drawCan(S.can);

    S.particles.forEach((pt) => {
      ctx.fillStyle = `rgba(${pt.color},${Math.max(0, pt.life)})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
    });

    drawAim();

    S.messages.forEach((m) => {
      ctx.globalAlpha = Math.min(1, m.life / (m.max * 0.5));
      ctx.font = `900 ${m.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(m.text, m.x, m.y);
      ctx.fillStyle = m.color;
      ctx.fillText(m.text, m.x, m.y);
      ctx.globalAlpha = 1;
    });

    drawHint();
    ctx.restore();
  }

  // ---------- Loop ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  newGame();
  requestAnimationFrame(loop);
})();
