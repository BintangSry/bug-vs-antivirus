/* ============================================================
   Bug vs Antivirus – game.js
   Full game logic: Canvas rendering, physics, AI, sounds, UI
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const GAME_DURATION  = 60;          // seconds
const BUG_MAX_HP     = 80;
const AV_MAX_HP      = 120;
const BUG_SPEED      = 3.5;
const AV_SPEED       = 2.2;
const BULLET_SPEED   = 7;
const AV_BULLET_SPEED= 5.5;
const BULLET_DMG_BUG = 8;          // bug's bullets deal
const BULLET_DMG_AV  = 10;         // av's bullets deal
const TELEPORT_CD    = 5000;       // ms
const SHIELD_CD      = 10000;      // ms – shield cooldown
const SHIELD_DUR     = 4000;       // ms – shield active duration
const POWERUP_INTERVAL = 12000;    // ms
const POWERUP_DURATION = 8000;     // ms

// ─────────────────────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────────────────────
const startScreen = document.getElementById('startScreen');
const gameScreen  = document.getElementById('gameScreen');
const winScreen   = document.getElementById('winScreen');
const canvas      = document.getElementById('gameCanvas');
const ctx         = canvas.getContext('2d');
const flashOverlay = document.getElementById('flashOverlay');

// HUD refs
const bugHpBar    = document.getElementById('bugHpBar');
const avHpBar     = document.getElementById('avHpBar');
const bugHpText   = document.getElementById('bugHpText');
const avHpText    = document.getElementById('avHpText');
const timerDisplay= document.getElementById('timerDisplay');
const killFeed    = document.getElementById('killFeed');
const statusMsg   = document.getElementById('statusMsg');
const bugTeleportCd = document.getElementById('bugTeleportCd');
const avScanCd    = document.getElementById('avScanCd');
const bugTeleportCard = document.getElementById('bugTeleportCard');
const avScanCard  = document.getElementById('avScanCard');

// Win screen refs
const winIcon     = document.getElementById('winIcon');
const winTitle    = document.getElementById('winTitle');
const winSubtitle = document.getElementById('winSubtitle');
const winReason   = document.getElementById('winReason');
const winBg       = document.getElementById('winBg');
const bugFinalHp  = document.getElementById('bugFinalHp');
const avFinalHp   = document.getElementById('avFinalHp');

// ─────────────────────────────────────────────────────────────
// AUDIO ENGINE (Web Audio API – no files needed)
// ─────────────────────────────────────────────────────────────
let audioCtx = null;
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTone(freq, type, dur, vol = 0.3, startFreq = null, endFreq = null) {
  if (!audioCtx) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = type;
  const now = audioCtx.currentTime;
  osc.frequency.setValueAtTime(startFreq || freq, now);
  if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, now + dur);
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.start(now);
  osc.stop(now + dur);
}

const SFX = {
  bugShoot:     () => playTone(800, 'square', 0.08, 0.15, 800, 400),
  avShoot:      () => playTone(300, 'sawtooth', 0.12, 0.2, 400, 200),
  bugTeleport:  () => {
    playTone(1200, 'sine', 0.3, 0.25, 1200, 2400);
    setTimeout(() => playTone(2400, 'sine', 0.2, 0.2, 2400, 4800), 150);
  },
  avShieldUp:   () => {
    // Rising crystalline chord – shield raise
    playTone(440,  'sine',     0.4, 0.25, 440, 880);
    playTone(554,  'triangle', 0.4, 0.18, 554, 1108);
    setTimeout(() => playTone(880, 'sine', 0.3, 0.2, 880, 1760), 100);
  },
  avShieldBreak:() => {
    // Shattering glass descend
    playTone(1200, 'sawtooth', 0.25, 0.3, 1200, 200);
    setTimeout(() => playTone(600, 'square', 0.2, 0.25, 600, 100), 100);
  },
  shieldBlock:  () => playTone(800, 'triangle', 0.06, 0.2, 800, 1200),
  hit:          (isBig = false) => playTone(isBig ? 200 : 350, 'square', 0.1, isBig ? 0.35 : 0.2),
  powerup:      () => { playTone(523, 'sine', 0.1, 0.3); setTimeout(() => playTone(659, 'sine', 0.1, 0.3), 100); setTimeout(() => playTone(784, 'sine', 0.2, 0.3), 200); },
  winBug:       () => { [523,659,784,1047].forEach((f,i) => setTimeout(() => playTone(f,'sine',0.3,0.4), i*120)); },
  winAV:        () => { [392,494,587,784].forEach((f,i) => setTimeout(() => playTone(f,'sawtooth',0.3,0.4), i*120)); },
  timeTick:     () => playTone(440, 'sine', 0.05, 0.15),
};

// ─────────────────────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────────────────────
let state = {};
let keysDown = {};
let animId = null;
let lastTime = 0;

// ─────────────────────────────────────────────────────────────
// CANVAS RESIZE
// ─────────────────────────────────────────────────────────────
function resizeCanvas() {
  const container = canvas.parentElement;
  canvas.width  = container.clientWidth;
  canvas.height = container.clientHeight;
  if (state.running) buildObstacles();
}
window.addEventListener('resize', resizeCanvas);

// ─────────────────────────────────────────────────────────────
// OBSTACLES (server racks, firewalls)
// ─────────────────────────────────────────────────────────────
function buildObstacles() {
  const W = canvas.width, H = canvas.height;
  state.obstacles = [
    // Center server rack (big)
    { x: W/2 - 50, y: H/2 - 80, w: 100, h: 160, type: 'server' },
    // Top-left firewall
    { x: W * 0.15, y: H * 0.2,  w: 60,  h: 100, type: 'firewall' },
    // Top-right firewall
    { x: W * 0.75, y: H * 0.2,  w: 60,  h: 100, type: 'firewall' },
    // Bottom-left server
    { x: W * 0.15, y: H * 0.65, w: 80,  h: 60,  type: 'server' },
    // Bottom-right server
    { x: W * 0.7,  y: H * 0.65, w: 80,  h: 60,  type: 'server' },
    // Mid-left short wall
    { x: W * 0.3,  y: H * 0.4,  w: 40,  h: 80,  type: 'wall' },
    // Mid-right short wall
    { x: W * 0.6,  y: H * 0.4,  w: 40,  h: 80,  type: 'wall' },
  ];
}

// ─────────────────────────────────────────────────────────────
// INIT GAME
// ─────────────────────────────────────────────────────────────
function initGame() {
  initAudio();
  resizeCanvas();
  const W = canvas.width, H = canvas.height;

  state = {
    running: true,
    timer: GAME_DURATION,
    timerMs: 0,

    bug: {
      x: W * 0.15, y: H * 0.5,
      w: 48, h: 48,
      hp: BUG_MAX_HP, maxHp: BUG_MAX_HP,
      speed: BUG_SPEED,
      angle: 0,
      teleportCd: 0,
      teleportMax: TELEPORT_CD,
      isTeleporting: false,
      teleportFlash: 0,
      invincible: 0,
      powerup: null,
      powerupTimer: 0,
      shootCd: 0,
    },

    av: {
      x: W * 0.82, y: H * 0.5,
      w: 54, h: 54,
      hp: AV_MAX_HP, maxHp: AV_MAX_HP,
      speed: AV_SPEED,
      angle: Math.PI,
      shieldCd: 0,
      shieldMax: SHIELD_CD,
      shieldActive: false,
      shieldTimer: 0,
      invincible: 0,
      powerup: null,
      powerupTimer: 0,
      shootCd: 0,
    },

    bullets: [],           // { x,y,vx,vy,owner:'bug'|'av',r,dmg, trail:[] }
    particles: [],         // { x,y,vx,vy,life,color,r }
    powerups: [],          // { x,y,r,type,timer }
    powerupTimer: 5000,  // First powerup spawns at 5s
    obstacles: [],

    shieldEffect: null,     // { rings:[], alpha } – visual burst on activation
    teleportEffect: null,  // { x,y,alpha }

    winner: null,
  };

  buildObstacles();
  updateHUD();
}

// ─────────────────────────────────────────────────────────────
// COLLISION HELPERS
// ─────────────────────────────────────────────────────────────
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX, dy = cy - nearY;
  return dx*dx + dy*dy < cr*cr;
}

function clampToArena(entity) {
  const W = canvas.width, H = canvas.height;
  const hw = entity.w / 2, hh = entity.h / 2;
  entity.x = Math.max(hw, Math.min(W - hw, entity.x));
  entity.y = Math.max(hh, Math.min(H - hh, entity.y));
}

function resolveObstacles(entity) {
  for (const ob of state.obstacles) {
    if (rectOverlap(
      entity.x - entity.w/2, entity.y - entity.h/2, entity.w, entity.h,
      ob.x, ob.y, ob.w, ob.h
    )) {
      // Push out – find smallest overlap
      const left  = (entity.x + entity.w/2) - ob.x;
      const right = (ob.x + ob.w) - (entity.x - entity.w/2);
      const top   = (entity.y + entity.h/2) - ob.y;
      const bot   = (ob.y + ob.h) - (entity.y - entity.h/2);
      const min   = Math.min(left, right, top, bot);
      if      (min === left)  entity.x -= left;
      else if (min === right) entity.x += right;
      else if (min === top)   entity.y -= top;
      else                    entity.y += bot;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// MOVEMENT
// ─────────────────────────────────────────────────────────────
function moveBug(dt) {
  const b = state.bug;
  if (b.isTeleporting) return;
  let dx = 0, dy = 0;
  if (keysDown['KeyW'] || keysDown['w']) dy -= 1;
  if (keysDown['KeyS'] || keysDown['s']) dy += 1;
  if (keysDown['KeyA'] || keysDown['a']) dx -= 1;
  if (keysDown['KeyD'] || keysDown['d']) dx += 1;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const spd = b.speed * (b.powerup === 'speed' ? 1.6 : 1);
    dx = dx/len * spd;
    dy = dy/len * spd;
    b.x += dx; b.y += dy;
    b.angle = Math.atan2(dy, dx);
  }
  clampToArena(b);
  resolveObstacles(b);
}

function moveAV(dt) {
  const a = state.av;
  let dx = 0, dy = 0;
  if (keysDown['ArrowUp'])    dy -= 1;
  if (keysDown['ArrowDown'])  dy += 1;
  if (keysDown['ArrowLeft'])  dx -= 1;
  if (keysDown['ArrowRight']) dx += 1;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const spd = a.speed * (a.powerup === 'speed' ? 1.6 : 1);
    dx = dx/len * spd;
    dy = dy/len * spd;
    a.x += dx; a.y += dy;
    a.angle = Math.atan2(dy, dx);
  }
  clampToArena(a);
  resolveObstacles(a);
}

// ─────────────────────────────────────────────────────────────
// SHOOTING
// ─────────────────────────────────────────────────────────────
function spawnBullet(owner, x, y, angle, speed, dmg, r = 6) {
  state.bullets.push({
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    owner, r, dmg,
    trail: [],
    life: 120,
  });
}

function handleShooting(dt) {
  const b = state.bug, a = state.av;

  // Bug shoot – Space
  b.shootCd = Math.max(0, b.shootCd - dt);
  if ((keysDown['Space']) && b.shootCd <= 0) {
    b.shootCd = 300;
    // Shoot toward AV
    const ang = Math.atan2(a.y - b.y, a.x - b.x);
    // Three spread bullets for bug (virus spray)
    for (let s = -0.15; s <= 0.15; s += 0.15) {
      spawnBullet('bug', b.x, b.y, ang + s, BULLET_SPEED * (b.powerup === 'attack' ? 1.4 : 1),
        BULLET_DMG_BUG * (b.powerup === 'attack' ? 1.5 : 1), 5);
    }
    SFX.bugShoot();
    spawnParticles(b.x, b.y, 5, '#00ff88', 3, 60);
  }

  // AV shoot – Ctrl
  a.shootCd = Math.max(0, a.shootCd - dt);
  if ((keysDown['ControlRight'] || keysDown['ControlLeft']) && a.shootCd <= 0) {
    a.shootCd = 400;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    spawnBullet('av', a.x, a.y, ang, AV_BULLET_SPEED * (a.powerup === 'attack' ? 1.4 : 1),
      BULLET_DMG_AV * (a.powerup === 'attack' ? 1.5 : 1), 7);
    SFX.avShoot();
    spawnParticles(a.x, a.y, 4, '#00aaff', 3, 60);
  }
}

// ─────────────────────────────────────────────────────────────
// SKILLS
// ─────────────────────────────────────────────────────────────
function handleTeleport() {
  const b = state.bug;
  if (b.teleportCd > 0 || b.isTeleporting) return;
  b.isTeleporting = true;
  b.teleportFlash = 1;
  b.invincible = 600;

  // Flash effect
  doFlash('#00ff88aa', 200);
  SFX.bugTeleport();

  // Old position particles
  spawnParticles(b.x, b.y, 20, '#00ff88', 5, 90);

  // Teleport to random valid spot
  const W = canvas.width, H = canvas.height;
  let nx, ny, tries = 0;
  do {
    nx = 60 + Math.random() * (W - 120);
    ny = 60 + Math.random() * (H - 120);
    tries++;
  } while (tries < 30 && state.obstacles.some(ob =>
    rectOverlap(nx - 18, ny - 18, 36, 36, ob.x, ob.y, ob.w, ob.h)
  ));

  setTimeout(() => {
    b.x = nx; b.y = ny;
    b.isTeleporting = false;
    spawnParticles(nx, ny, 20, '#00ff88', 5, 90);
    doFlash('#00ff8866', 150);
    addKillMessage('⚡ BUG TELEPORT!', '#00ff88');
  }, 200);

  b.teleportCd = b.teleportMax;
}

function handleShield() {
  const a = state.av;
  if (a.shieldCd > 0 || a.shieldActive) return;

  a.shieldActive = true;
  a.shieldTimer  = SHIELD_DUR;
  a.shieldCd     = a.shieldMax;
  a.invincible   = SHIELD_DUR;  // full immunity for shield duration

  // Spawn expanding ring burst visual
  state.shieldEffect = {
    rings: [{ r: 0, maxR: 90, alpha: 1 }, { r: 0, maxR: 70, alpha: 1 }, { r: 0, maxR: 50, alpha: 1 }],
    x: a.x, y: a.y,
  };

  SFX.avShieldUp();
  doFlash('#4488ffcc', 200);
  addKillMessage('🛡️ ANTIVIRUS SHIELD!', '#00aaff');
}

// ─────────────────────────────────────────────────────────────
// DAMAGE & HP
// ─────────────────────────────────────────────────────────────
function dealDamage(target, amount) {
  const entity = target === 'bug' ? state.bug : state.av;
  if (entity.invincible > 0) return;
  entity.hp = Math.max(0, entity.hp - amount);
  entity.invincible = 300;
  SFX.hit(amount >= 20);
  updateHUD();
  shakeHPBar(target);

  if (entity.hp <= 0) {
    endGame(target === 'bug' ? 'av' : 'bug');
  }
}

function shakeHPBar(target) {
  const el = target === 'bug' ? bugHpBar : avHpBar;
  el.classList.add('hp-low');
  setTimeout(() => el.classList.remove('hp-low'), 500);
}

// ─────────────────────────────────────────────────────────────
// BULLETS UPDATE
// ─────────────────────────────────────────────────────────────
function updateBullets(dt) {
  const b = state.bug, a = state.av;

  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const bl = state.bullets[i];
    bl.trail.push({ x: bl.x, y: bl.y });
    if (bl.trail.length > 6) bl.trail.shift();
    bl.x += bl.vx;
    bl.y += bl.vy;
    bl.life--;

    // Wall bounds
    if (bl.x < 0 || bl.x > canvas.width || bl.y < 0 || bl.y > canvas.height || bl.life <= 0) {
      state.bullets.splice(i, 1); continue;
    }

    // Obstacle collision
    let hitOb = false;
    for (const ob of state.obstacles) {
      if (circleRect(bl.x, bl.y, bl.r, ob.x, ob.y, ob.w, ob.h)) {
        spawnParticles(bl.x, bl.y, 5, bl.owner === 'bug' ? '#00ff88' : '#00aaff', 3, 40);
        state.bullets.splice(i, 1);
        hitOb = true; break;
      }
    }
    if (hitOb) continue;

    // Hit bug
    if (bl.owner === 'av') {
      const dx = bl.x - b.x, dy = bl.y - b.y;
      if (Math.hypot(dx, dy) < bl.r + b.w/2 && b.invincible <= 0 && !b.isTeleporting) {
        dealDamage('bug', bl.dmg);
        spawnParticles(bl.x, bl.y, 8, '#ff3366', 4, 70);
        state.bullets.splice(i, 1);
        continue;
      }
    }

    // Hit AV
    if (bl.owner === 'bug') {
      const dx = bl.x - a.x, dy = bl.y - a.y;
      if (Math.hypot(dx, dy) < bl.r + a.w/2 && a.invincible <= 0) {
        dealDamage('av', bl.dmg);
        spawnParticles(bl.x, bl.y, 8, '#ff6600', 4, 70);
        state.bullets.splice(i, 1);
        continue;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// PARTICLES
// ─────────────────────────────────────────────────────────────
function spawnParticles(x, y, count, color, speed, life) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = Math.random() * speed;
    state.particles.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life, maxLife: life,
      color,
      r: 1.5 + Math.random() * 2.5,
    });
  }
}

function updateParticles() {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.93; p.vy *= 0.93;
    p.life--;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

// ─────────────────────────────────────────────────────────────
// POWER-UPS
// ─────────────────────────────────────────────────────────────
const POWERUP_TYPES = ['hp', 'speed', 'attack', 'shield'];

function spawnPowerup() {
  const W = canvas.width, H = canvas.height;
  let x, y, tries = 0;
  do {
    x = 80 + Math.random() * (W - 160);
    y = 80 + Math.random() * (H - 160);
    tries++;
  } while (tries < 20 && state.obstacles.some(ob =>
    circleRect(x, y, 20, ob.x, ob.y, ob.w, ob.h)
  ));
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  state.powerups.push({ x, y, r: 14, type, timer: POWERUP_DURATION, pulse: 0 });
}

function updatePowerups(dt) {
  state.powerupTimer -= dt;
  if (state.powerupTimer <= 0 && state.powerups.length < 3) {
    state.powerupTimer = POWERUP_INTERVAL;
    spawnPowerup();
  }

  for (let i = state.powerups.length - 1; i >= 0; i--) {
    const pu = state.powerups[i];
    pu.timer -= dt;
    pu.pulse = (pu.pulse + 0.08) % (Math.PI * 2);
    if (pu.timer <= 0) { state.powerups.splice(i, 1); continue; }

    const pick = (entity, who) => {
      const dx = pu.x - entity.x, dy = pu.y - entity.y;
      if (Math.hypot(dx, dy) < pu.r + entity.w/2) {
        applyPowerup(entity, who, pu.type);
        spawnParticles(pu.x, pu.y, 20, powerupColor(pu.type), 5, 80);
        SFX.powerup();
        addKillMessage(powerupMsg(pu.type, who), powerupColor(pu.type));
        state.powerups.splice(i, 1);
      }
    };
    pick(state.bug, 'bug');
    if (i < state.powerups.length) pick(state.av, 'av');
  }

  // Tick powerup timers
  for (const who of ['bug', 'av']) {
    const e = state[who];
    if (e.powerup) {
      e.powerupTimer -= dt;
      if (e.powerupTimer <= 0) { e.powerup = null; e.powerupTimer = 0; }
    }
  }
}

function applyPowerup(entity, who, type) {
  if (type === 'hp') {
    entity.hp = Math.min(entity.maxHp, entity.hp + (who === 'bug' ? 25 : 35));
    updateHUD();
  } else if (type === 'shield') {
    entity.invincible = 3000;
  } else {
    entity.powerup = type;
    entity.powerupTimer = POWERUP_DURATION;
  }
}

function powerupColor(type) {
  return { hp:'#ff4488', speed:'#ffdd00', attack:'#ff5500', shield:'#88aaff' }[type] || '#fff';
}
function powerupLabel(type) {
  // Text labels that render reliably in canvas (no emoji needed)
  return { hp:'HP', speed:'SPD', attack:'ATK', shield:'DEF' }[type] || '?';
}
function powerupIcon(type) {
  // Used in DOM elements – emoji OK here
  return { hp:'+HP', speed:'SPD', attack:'ATK', shield:'DEF' }[type] || '?';
}
function powerupMsg(type, who) {
  const w = who === 'bug' ? 'BUG' : 'ANTIVIRUS';
  const msgs = { hp:`${w} +HP!`, speed:`${w} SPEED UP!`, attack:`${w} POWER UP!`, shield:`${w} SHIELD!` };
  return msgs[type] || '';
}

// ─────────────────────────────────────────────────────────────
// SHIELD EFFECT UPDATE
// ─────────────────────────────────────────────────────────────
function updateShieldEffect(dt) {
  const a = state.av;

  // Tick active timer
  if (a.shieldActive) {
    a.shieldTimer -= dt;
    if (a.shieldTimer <= 0) {
      a.shieldActive = false;
      // invincible already expires naturally
      SFX.avShieldBreak();
      spawnParticles(a.x, a.y, 30, '#88aaff', 5, 80);
      addKillMessage('🛡️ SHIELD EXPIRED', '#6677aa');
    }
  }

  // Animate burst rings on activation
  if (state.shieldEffect) {
    const sf = state.shieldEffect;
    let anyAlive = false;
    for (const ring of sf.rings) {
      ring.r     += 5;
      ring.alpha -= 0.04;
      if (ring.alpha > 0) anyAlive = true;
    }
    if (!anyAlive) state.shieldEffect = null;
  }
}

// ─────────────────────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────────────────────
function updateTimer(dt) {
  if (!state.running) return;
  state.timerMs += dt;
  if (state.timerMs >= 1000) {
    state.timerMs -= 1000;
    state.timer--;
    SFX.timeTick();
    timerDisplay.textContent = state.timer;

    if (state.timer <= 10) {
      timerDisplay.classList.add('timer-warn');
    }
    if (state.timer <= 0) {
      endGame('bug'); // Bug survived → Bug wins
    }
  }
}

// ─────────────────────────────────────────────────────────────
// COOLDOWN UPDATES
// ─────────────────────────────────────────────────────────────
function updateCooldowns(dt) {
  const b = state.bug, a = state.av;
  if (b.teleportCd > 0) {
    b.teleportCd = Math.max(0, b.teleportCd - dt);
    const pct = b.teleportCd / b.teleportMax;
    bugTeleportCard.style.opacity = pct > 0 ? 0.5 : 1;
    bugTeleportCd.textContent = b.teleportCd > 0 ? (b.teleportCd/1000).toFixed(1)+'s' : '';
  }
  if (a.shieldCd > 0) {
    a.shieldCd = Math.max(0, a.shieldCd - dt);
    const pct = a.shieldCd / a.shieldMax;
    avScanCard.style.opacity = pct > 0 ? 0.5 : 1;
    avScanCd.textContent = a.shieldCd > 0 ? (a.shieldCd/1000).toFixed(1)+'s' : '' ;
  }
  if (b.invincible > 0) b.invincible = Math.max(0, b.invincible - dt);
  // AV invincible ticks normally (shield manages its own timer)
  if (a.invincible > 0 && !a.shieldActive) a.invincible = Math.max(0, a.invincible - dt);
}

// ─────────────────────────────────────────────────────────────
// HUD UPDATE
// ─────────────────────────────────────────────────────────────
function updateHUD() {
  const b = state.bug, a = state.av;
  const bPct = (b.hp / b.maxHp) * 100;
  const aPct = (a.hp / a.maxHp) * 100;
  bugHpBar.style.width  = bPct + '%';
  avHpBar.style.width   = aPct + '%';
  bugHpText.textContent = `${b.hp}/${b.maxHp}`;
  avHpText.textContent  = `${a.hp}/${a.maxHp}`;

  // Color shifts for low HP
  if (bPct < 30) bugHpBar.style.background = 'linear-gradient(90deg,#ff3366,#ff6600)';
  else           bugHpBar.style.background = 'linear-gradient(90deg,#00ff88,#39ff14)';
  if (aPct < 30) avHpBar.style.background  = 'linear-gradient(90deg,#ff3366,#ff6600)';
  else           avHpBar.style.background  = 'linear-gradient(90deg,#0044ff,#00aaff)';
}

// ─────────────────────────────────────────────────────────────
// KILL FEED
// ─────────────────────────────────────────────────────────────
function addKillMessage(msg, color) {
  const el = document.createElement('div');
  el.className = 'kill-msg';
  el.textContent = msg;
  el.style.color = color;
  el.style.border = `1px solid ${color}44`;
  el.style.background = `${color}11`;
  killFeed.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ─────────────────────────────────────────────────────────────
// FLASH OVERLAY
// ─────────────────────────────────────────────────────────────
function doFlash(color, duration) {
  flashOverlay.style.background = color;
  flashOverlay.style.opacity = '1';
  setTimeout(() => { flashOverlay.style.opacity = '0'; }, duration);
}

// ─────────────────────────────────────────────────────────────
// ──────────────────── RENDERING ──────────────────────────────
// ─────────────────────────────────────────────────────────────

// ── Arena background
function drawArena() {
  const W = canvas.width, H = canvas.height;

  // Base
  ctx.fillStyle = '#060d1a';
  ctx.fillRect(0, 0, W, H);

  // Circuit grid
  ctx.strokeStyle = '#0a2040';
  ctx.lineWidth = 1;
  const gs = 40;
  for (let x = 0; x < W; x += gs) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += gs) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Dot nodes at intersections
  ctx.fillStyle = '#0a3060';
  for (let x = 0; x < W; x += gs) {
    for (let y = 0; y < H; y += gs) {
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI*2); ctx.fill();
    }
  }

  // Arena border neon
  const edgeGrad = ctx.createLinearGradient(0, 0, W, H);
  edgeGrad.addColorStop(0,   '#00ff8833');
  edgeGrad.addColorStop(0.5, '#00aaff33');
  edgeGrad.addColorStop(1,   '#00ff8833');
  ctx.strokeStyle = edgeGrad;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W-4, H-4);

  // Corner accents
  const corners = [[0,0,1,1],[W,0,-1,1],[0,H,1,-1],[W,H,-1,-1]];
  ctx.strokeStyle = '#00ff88aa'; ctx.lineWidth = 3;
  corners.forEach(([cx,cy,sx,sy]) => {
    ctx.beginPath(); ctx.moveTo(cx + sx*30, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy*30); ctx.stroke();
  });
}

// ── Obstacles
function drawObstacles() {
  for (const ob of state.obstacles) {
    if (ob.type === 'server') drawServer(ob);
    else if (ob.type === 'firewall') drawFirewall(ob);
    else drawWall(ob);
  }
}

function drawServer(ob) {
  const { x, y, w, h } = ob;
  // Body
  const g = ctx.createLinearGradient(x, y, x+w, y+h);
  g.addColorStop(0, '#0d2040');
  g.addColorStop(1, '#1a3860');
  ctx.fillStyle = g;
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();

  // Glow border
  ctx.shadowColor = '#00aaff';
  ctx.shadowBlur = 10;
  ctx.strokeStyle = '#00aaff66';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Rack lights
  const slots = Math.floor(h / 18);
  for (let i = 0; i < slots; i++) {
    const ly = y + 8 + i * 18;
    ctx.fillStyle = (Math.sin(Date.now() * 0.003 + i) > 0.5) ? '#00ff88' : '#003311';
    ctx.beginPath(); ctx.arc(x + 12, ly, 3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#1a4080';
    ctx.fillRect(x + 20, ly - 3, w - 30, 6);
  }
}

function drawFirewall(ob) {
  const { x, y, w, h } = ob;
  // Flame effect
  const t = Date.now() * 0.004;
  const g = ctx.createLinearGradient(x, y+h, x, y);
  g.addColorStop(0, '#ff440088');
  g.addColorStop(0.5, '#ff880055');
  g.addColorStop(1, '#ffaa0011');
  ctx.fillStyle = g;
  ctx.fillRect(x - 4, y - 8, w + 8, h + 8);

  // Core
  const bg = ctx.createLinearGradient(x, y, x+w, y+h);
  bg.addColorStop(0, '#200500');
  bg.addColorStop(1, '#400a00');
  ctx.fillStyle = bg;
  ctx.beginPath(); roundRect(ctx, x, y, w, h, 4); ctx.fill();

  // Neon border
  ctx.shadowColor = '#ff4400';
  ctx.shadowBlur = 15;
  ctx.strokeStyle = '#ff6600';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Flame particles
  for (let i = 0; i < 4; i++) {
    const fx = x + (i / 3) * w;
    const fy = y - Math.abs(Math.sin(t + i)) * 15 - 5;
    const fr = 4 + Math.sin(t * 2 + i) * 2;
    ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI*2);
    ctx.fillStyle = `hsla(${20 + i*10}, 100%, 60%, ${0.4 + Math.sin(t+i)*0.3})`;
    ctx.fill();
  }

  // Label
  ctx.fillStyle = '#ff6600';
  ctx.font = 'bold 9px Orbitron, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('FIREWALL', x + w/2, y + h/2 + 3);
}

function drawWall(ob) {
  const { x, y, w, h } = ob;
  ctx.fillStyle = '#0a1828';
  ctx.beginPath(); roundRect(ctx, x, y, w, h, 4); ctx.fill();
  ctx.strokeStyle = '#1a3050'; ctx.lineWidth = 1.5; ctx.stroke();
}

// Canvas roundRect helper
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

// ── Bug character
function drawBug(b) {
  const { x, y, w, angle, hp, maxHp, invincible, isTeleporting, powerup } = b;
  if (isTeleporting && Math.floor(Date.now()/80) % 2 === 0) return; // blink when teleporting

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const r = w / 2;
  const alpha = invincible > 0 && Math.floor(Date.now()/60) % 2 === 0 ? 0.4 : 1;
  ctx.globalAlpha = alpha;

  // Powerup glow ring
  if (powerup) {
    ctx.shadowColor = powerupColor(powerup);
    ctx.shadowBlur = 20;
    ctx.strokeStyle = powerupColor(powerup);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Body glow
  ctx.shadowColor = '#00ff88';
  ctx.shadowBlur = 15;

  // Main body (virus blob)
  const bodyGrad = ctx.createRadialGradient(-3, -4, 2, 0, 0, r);
  bodyGrad.addColorStop(0, '#aaffcc');
  bodyGrad.addColorStop(0.5, '#00ee66');
  bodyGrad.addColorStop(1, '#005522');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();

  // Virus spikes
  ctx.fillStyle = '#00cc55';
  const spikes = 6;
  for (let i = 0; i < spikes; i++) {
    const sa = (i / spikes) * Math.PI * 2;
    const sx = Math.cos(sa) * (r + 5);
    const sy = Math.sin(sa) * (r + 5);
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI*2); ctx.fill();
  }

  // Eyes
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-5, -4, 5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( 5, -4, 5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#001100';
  ctx.beginPath(); ctx.arc(-4, -3, 3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( 6, -3, 3, 0, Math.PI*2); ctx.fill();
  // Eye glow
  ctx.fillStyle = '#00ff88';
  ctx.beginPath(); ctx.arc(-3.5, -2.5, 1, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( 6.5, -2.5, 1, 0, Math.PI*2); ctx.fill();

  // Mouth (evil smile)
  ctx.strokeStyle = '#002200';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 4, 5, 0.1*Math.PI, 0.9*Math.PI);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Antivirus character
function drawAV(a) {
  const { x, y, w, angle, hp, maxHp, invincible, powerup } = a;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const r = w / 2;
  // Only blink when hit-invincible, NOT while shield is active
  const isShielding = a.shieldActive;
  const blinkHit = invincible > 0 && !isShielding && Math.floor(Date.now()/60) % 2 === 0;
  const alpha = blinkHit ? 0.4 : 1;
  ctx.globalAlpha = alpha;

  // Powerup ring
  if (powerup) {
    ctx.shadowColor = powerupColor(powerup);
    ctx.shadowBlur = 20;
    ctx.strokeStyle = powerupColor(powerup);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r + 10, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Active shield visual – layered pulsing hexagon barrier
  if (isShielding) {
    const t = Date.now() * 0.004;
    const shieldR = r + 16;
    // Outer glow
    ctx.shadowColor = '#44aaff';
    ctx.shadowBlur = 30;
    ctx.strokeStyle = `rgba(68,170,255,${0.7 + Math.sin(t * 3) * 0.3})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + t * 0.5;
      const px = Math.cos(ang) * shieldR, py = Math.sin(ang) * shieldR;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    // Inner glow fill
    ctx.globalAlpha = 0.08 + Math.sin(t * 2) * 0.04;
    ctx.fillStyle = '#44aaff';
    ctx.fill();
    ctx.globalAlpha = alpha;
    // Second spinning inner ring
    ctx.shadowBlur = 12;
    ctx.strokeStyle = `rgba(170,220,255,${0.5 + Math.sin(t * 5) * 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 - t * 0.8;
      const px = Math.cos(ang) * (shieldR - 5), py = Math.sin(ang) * (shieldR - 5);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.shadowColor = '#00aaff';
  ctx.shadowBlur = 15;

  // Robot body (hexagon-ish)
  const bodyGrad = ctx.createRadialGradient(-4, -5, 3, 0, 0, r);
  bodyGrad.addColorStop(0, '#aaddff');
  bodyGrad.addColorStop(0.5, '#0088dd');
  bodyGrad.addColorStop(1, '#002244');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 - Math.PI/6;
    const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();

  // Hex border
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#00ccff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Visor / scanner eye
  ctx.fillStyle = '#000022';
  ctx.beginPath(); ctx.ellipse(0, -5, 10, 6, 0, 0, Math.PI*2); ctx.fill();
  // Scan line
  const scanT = Date.now() * 0.005;
  const scanX = Math.sin(scanT) * 8;
  ctx.strokeStyle = '#00ffff';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(scanX - 3, -5); ctx.lineTo(scanX + 3, -5); ctx.stroke();
  ctx.shadowBlur = 0;

  // Shield icon on chest
  ctx.fillStyle = '#003366';
  ctx.beginPath();
  ctx.moveTo(0, -1); ctx.lineTo(-7, 2); ctx.lineTo(-7, 10); ctx.lineTo(0, 14); ctx.lineTo(7, 10); ctx.lineTo(7, 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#00aaff'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#00aaff';
  ctx.font = 'bold 8px Orbitron';
  ctx.textAlign = 'center';
  ctx.fillText('AV', 0, 10);

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Bullets
function drawBullets() {
  for (const bl of state.bullets) {
    const color = bl.owner === 'bug' ? '#00ff88' : '#00aaff';
    const core  = bl.owner === 'bug' ? '#aaffcc' : '#aaddff';

    // Trail
    for (let t = 0; t < bl.trail.length; t++) {
      const pt = bl.trail[t];
      const a = (t / bl.trail.length) * 0.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, bl.r * (t / bl.trail.length) * 0.8, 0, Math.PI*2);
      ctx.fillStyle = color + Math.floor(a * 255).toString(16).padStart(2,'0');
      ctx.fill();
    }

    // Core
    ctx.shadowColor = color;
    ctx.shadowBlur  = 12;
    ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI*2);
    ctx.fillStyle = core; ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// ── Particles
function drawParticles() {
  for (const p of state.particles) {
    const a = p.life / p.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * a, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── Power-ups
function drawPowerups() {
  for (const pu of state.powerups) {
    const color = powerupColor(pu.type);
    const pulseFactor = 1 + Math.sin(pu.pulse) * 0.2;
    const r = pu.r * pulseFactor;

    // Outer ring
    ctx.shadowColor = color;
    ctx.shadowBlur  = 20;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.arc(pu.x, pu.y, r + 8, 0, Math.PI*2); ctx.stroke();

    // Dark bg
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#050a0f';
    ctx.beginPath(); ctx.arc(pu.x, pu.y, r + 2, 0, Math.PI*2); ctx.fill();

    // Colored fill
    const pg = ctx.createRadialGradient(pu.x - r*0.3, pu.y - r*0.3, 1, pu.x, pu.y, r);
    pg.addColorStop(0, color + 'ee');
    pg.addColorStop(1, color + '44');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(pu.x, pu.y, r, 0, Math.PI*2); ctx.fill();

    // Text label (reliable across all browsers)
    ctx.shadowColor = '#000';
    ctx.shadowBlur  = 4;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(r * 0.9)}px 'Orbitron', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(powerupLabel(pu.type), pu.x, pu.y);
    ctx.textBaseline = 'alphabetic';
    ctx.shadowBlur = 0;
  }
}

// ── Shield burst rings (activation animation)
function drawShieldEffect() {
  if (!state.shieldEffect) return;
  const sf = state.shieldEffect;
  ctx.save();
  for (const ring of sf.rings) {
    if (ring.alpha <= 0) continue;
    ctx.globalAlpha = ring.alpha * 0.8;
    ctx.strokeStyle = '#44aaff';
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = '#44aaff';
    ctx.shadowBlur  = 18;
    // Draw expanding hexagon ring
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const px = sf.x + Math.cos(ang) * ring.r;
      const py = sf.y + Math.sin(ang) * ring.r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

// ── HP bar + name label above characters
function drawCharHP(entity, color, name) {
  const { x, y, w, h, hp, maxHp } = entity;
  const bw = w + 24, bh = 6;
  const bx = x - bw/2, by = y - h/2 - 18;
  const pct = hp / maxHp;

  // Name label
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.font = `bold 9px 'Orbitron', monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(name, x, by - 4);
  ctx.shadowBlur = 0;

  // Bar background
  ctx.fillStyle = '#000000cc';
  ctx.beginPath(); roundRect(ctx, bx-1, by-1, bw+2, bh+2, 4); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); roundRect(ctx, bx, by, bw, bh, 3); ctx.fill();

  // HP fill
  if (pct > 0) {
    const hpColor = pct < 0.3 ? '#ff3366' : color;
    ctx.fillStyle = hpColor;
    ctx.shadowColor = hpColor; ctx.shadowBlur = 8;
    ctx.beginPath(); roundRect(ctx, bx, by, bw * pct, bh, 3); ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN GAME LOOP
// ─────────────────────────────────────────────────────────────
function gameLoop(ts) {
  if (!state.running) return;
  const dt = Math.min(ts - lastTime, 50); // cap at 50ms
  lastTime = ts;

  // Update
  moveBug(dt);
  moveAV(dt);
  handleShooting(dt);
  updateBullets(dt);
  updateParticles();
  updatePowerups(dt);
  updateShieldEffect(dt);
  updateCooldowns(dt);
  updateTimer(dt);

  // Draw
  drawArena();
  drawObstacles();
  drawShieldEffect();
  drawPowerups();
  drawBullets();
  drawParticles();

  // Characters
  drawBug(state.bug);
  drawAV(state.av);

  // In-canvas HP bars + name labels
  drawCharHP(state.bug, '#00ff88', 'BUG');
  drawCharHP(state.av, '#00aaff', 'ANTIVIRUS');

  animId = requestAnimationFrame(gameLoop);
}

// ─────────────────────────────────────────────────────────────
// END GAME
// ─────────────────────────────────────────────────────────────
function endGame(winner) {
  state.running = false;
  state.winner = winner;
  cancelAnimationFrame(animId);
  timerDisplay.classList.remove('timer-warn');

  const bugHp = state.bug.hp;
  const avHp  = state.av.hp;

  setTimeout(() => {
    gameScreen.classList.add('hidden');
    winScreen.classList.remove('hidden');

    bugFinalHp.textContent = `HP: ${bugHp}/${BUG_MAX_HP}`;
    avFinalHp.textContent  = `HP: ${avHp}/${AV_MAX_HP}`;

    if (winner === 'bug') {
      winIcon.textContent  = '🦠';
      winTitle.textContent = 'BUG MENANG!';
      winTitle.style.background = 'linear-gradient(135deg,#00ff88,#39ff14)';
      winTitle.style.webkitBackgroundClip = 'text';
      winTitle.style.webkitTextFillColor  = 'transparent';
      winSubtitle.textContent = 'Bug berhasil bertahan dari serangan Antivirus!';
      winReason.textContent   = 'Survived the full 60 seconds';
      winBg.className = 'absolute inset-0 win-bug';
      SFX.winBug();
    } else {
      winIcon.textContent  = '🛡️';
      winTitle.textContent = 'ANTIVIRUS MENANG!';
      winTitle.style.background = 'linear-gradient(135deg,#00aaff,#0044ff)';
      winTitle.style.webkitBackgroundClip = 'text';
      winTitle.style.webkitTextFillColor  = 'transparent';
      winSubtitle.textContent = 'Antivirus berhasil mengeliminasi Bug!';
      winReason.textContent   = 'Bug eliminated';
      winBg.className = 'absolute inset-0 win-av';
      SFX.winAV();
    }
  }, 500);
}

// ─────────────────────────────────────────────────────────────
// INPUT HANDLING
// ─────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  keysDown[e.code] = true;

  // Prevent default for game keys
  const gameCodes = ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Enter','ControlLeft','ControlRight'];
  if (gameCodes.includes(e.code)) e.preventDefault();

  if (!state.running) return;

  // Bug teleport – Shift
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
    handleTeleport();
  }
  // AV shield – Enter
  if (e.code === 'Enter') {
    handleShield();
  }
});

window.addEventListener('keyup', (e) => {
  keysDown[e.code] = false;
});

// ─────────────────────────────────────────────────────────────
// SCREEN TRANSITIONS
// ─────────────────────────────────────────────────────────────
function startGame() {
  initAudio();
  startScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  winScreen.classList.add('hidden');
  keysDown = {};
  initGame();
  lastTime = performance.now();
  animId = requestAnimationFrame(gameLoop);
}

function goToMenu() {
  winScreen.classList.add('hidden');
  gameScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  cancelAnimationFrame(animId);
  keysDown = {};
}

// Buttons
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);
document.getElementById('menuBtn').addEventListener('click', goToMenu);

// Enter key on start screen
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !startScreen.classList.contains('hidden')) {
    startGame();
  }
});

// ─────────────────────────────────────────────────────────────
// INITIAL RESIZE
// ─────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  resizeCanvas();
});
