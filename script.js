/* Neon Dash — Vanilla JS
   - Uses canvas and requestAnimationFrame
   - Organised: Input, GameState, Renderer, Audio, Entities
   - Comments explain what's going on
*/

/* -------------------------
   Setup & Globals
   ------------------------- */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
let DPR = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvas() {
  DPR = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * DPR);
  canvas.height = Math.floor(window.innerHeight * DPR);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

/* -------------------------
   UI Elements
   ------------------------- */
const startScreen = document.getElementById('startScreen');
const btnPlay = document.getElementById('btnPlay');
const levelSelect = document.getElementById('levelSelect');
const colorPicker = document.getElementById('colorPicker');
const musicToggle = document.getElementById('musicToggle');
const hud = document.getElementById('hud');
const progressFill = document.getElementById('progressFill');
const percentText = document.getElementById('percent');
const highScoreText = document.getElementById('highScore');
const pauseScreen = document.getElementById('pauseScreen');
const deathScreen = document.getElementById('deathScreen');
const deathStat = document.getElementById('deathStat');
const btnPause = document.getElementById('btnPause');
const btnRestart = document.getElementById('btnRestart');
const btnResume = document.getElementById('btnResume');
const btnQuit = document.getElementById('btnQuit');
const btnRetry = document.getElementById('btnRetry');
const btnToMenu = document.getElementById('btnToMenu');

let highScore = parseFloat(localStorage.getItem('neon_highscore') || '0');
highScoreText.textContent = Math.round(highScore) + '%';

/* -------------------------
   Input Handling
   ------------------------- */
const input = {
  press: false,
  tapped: false,
  started: false
};

function onPointerDown(e) {
  input.press = true;
  input.tapped = true;
}
function onPointerUp(e) {
  input.press = false;
}
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    input.press = true;
    input.tapped = true;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') input.press = false;
});

/* Mobile-safe touch */
window.addEventListener('touchstart', (e) => { input.press = true; input.tapped = true; }, {passive:false});
window.addEventListener('touchend', (e) => { input.press = false; }, {passive:false});

/* -------------------------
   Audio (WebAudio) — synthy jump & death
   ------------------------- */
const AudioSystem = (function(){
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let musicOn = true;
  let musicNode = null;

  function toggleMusic(on){
    musicOn = !!on;
    if (musicOn) startMusic();
    else stopMusic();
  }

  function startMusic(){
    if (!musicOn) return;
    stopMusic();
    // Simple layered synth: pulse + pads
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 88;
    g.gain.value = 0.02;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    musicNode = { o, g };
    // subtle LFO on gain to keep it alive
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.25;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.01;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    lfo.start();
  }
  function stopMusic(){
    if (!musicNode) return;
    try { musicNode.o.stop(); } catch(e){}
    try { musicNode.g.disconnect(); } catch(e){}
    musicNode = null;
  }

  function playJump(){
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(550, now);
    o.frequency.exponentialRampToValueAtTime(220, now + 0.3);
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(now + 0.4);
  }

  function playDeath(){
    const now = ctx.currentTime;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square';
    o1.frequency.setValueAtTime(220, now);
    o2.frequency.setValueAtTime(110, now);
    g.gain.setValueAtTime(0.01, now);
    g.gain.exponentialRampToValueAtTime(0.8, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    o1.connect(g); o2.connect(g);
    g.connect(ctx.destination);
    o1.start(); o2.start();
    o1.stop(now + 0.6); o2.stop(now + 0.6);
  }

  return { toggleMusic, startMusic, stopMusic, playJump, playDeath, ctx };
})();

/* Hook up UI music toggle */
musicToggle.addEventListener('change', (e) => {
  AudioSystem.toggleMusic(e.target.checked);
});
if (musicToggle.checked) AudioSystem.startMusic();

/* -------------------------
   Particle System
   ------------------------- */
class Particle {
  constructor(x,y,vx,vy,life,color,size){
    this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.life = life; this.maxLife = life;
    this.color = color; this.size = size;
  }
  update(dt){
    this.life -= dt;
    this.vy += 900 * dt; // gravity for particles
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
  draw(ctx, camX, camY){
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x - camX, this.y - camY, this.size * alpha, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
const Particles = {
  list: [],
  spawn(x,y,count,color,spread=60){
    for(let i=0;i<count;i++){
      const ang = Math.random()*Math.PI - Math.PI/2;
      const speed = 60 + Math.random()*220;
      const vx = Math.cos(ang)*speed;
      const vy = Math.sin(ang)*speed - 60;
      const size = 2 + Math.random()*3;
      const life = 0.4 + Math.random()*0.8;
      this.list.push(new Particle(x,y,vx,vy,life,color,size));
    }
  },
  update(dt){
    for(let i=this.list.length-1;i>=0;i--){
      this.list[i].update(dt);
      if(this.list[i].life <= 0) this.list.splice(i,1);
    }
  },
  draw(ctx, camX, camY){
    ctx.save();
    for(const p of this.list) p.draw(ctx, camX, camY);
    ctx.restore();
  }
};

/* -------------------------
   Entities: Player, Obstacles
   ------------------------- */
class Player {
  constructor(x,y,size, color){
    this.x = x; this.y = y; this.w = size; this.h = size;
    this.vx = 0; this.vy = 0;
    this.grounded = false;
    this.color = color;
    this.dead = false;
    this.jumpPower = -420; // negative up
  }
  update(dt, world){
    // Horizontal is controlled by world scroll; player stays mostly horizontally fixed
    // Vertical physics:
    this.vy += world.gravity * dt;
    this.y += this.vy * dt;

    // ground collision (simple floor at certain y)
    const floorY = world.groundY - this.h;
    if (this.y > floorY) {
      this.y = floorY;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // input-based jump
    if (input.tapped && this.grounded && !this.dead) {
      this.vy = this.jumpPower;
      this.grounded = false;
      Particles.spawn(this.x + this.w/2, this.y + this.h, 18, this.color);
      AudioSystem.playJump();
    }
    // small hop: if user releases quickly, reduce upward velocity for short hops
    if (!input.press && this.vy < -90) {
      // dampen upward motion for short press
      this.vy *= 0.6;
    }
  }
  draw(ctx, camX, camY){
    ctx.save();
    // neon fill and outline
    const x = Math.round(this.x - camX);
    const y = Math.round(this.y - camY);
    ctx.shadowBlur = 18;
    ctx.shadowColor = this.color;
    ctx.fillStyle = this.color;
    ctx.fillRect(x, y, this.w, this.h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeRect(x+0.5, y+0.5, this.w-1, this.h-1);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

class Obstacle {
  constructor(x,y,w,h,type='block'){
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.type = type;
  }
  update(dt, speed){
    // obstacles don't need internal update other than moving left with camera speed
    this.x -= speed * dt;
  }
  draw(ctx, camX, camY){
    const sx = this.x - camX, sy = this.y - camY;
    ctx.save();
    // main block
    ctx.fillStyle = '#0a0a0a';
    ctx.shadowColor = '#ff3d81';
    ctx.shadowBlur = 18;
    ctx.fillRect(Math.round(sx), Math.round(sy), this.w, this.h);
    ctx.shadowBlur = 0;

    // draw spikes if type spike
    if (this.type === 'spike') {
      const spikeW = 12;
      ctx.fillStyle = '#ff3d81';
      ctx.beginPath();
      for (let i = 0; i < Math.ceil(this.w / spikeW); i++) {
        const tx = sx + i*spikeW;
        ctx.moveTo(tx, sy + this.h);
        ctx.lineTo(tx + spikeW/2, sy);
        ctx.lineTo(tx + spikeW, sy + this.h);
      }
      ctx.fill();
    }
    ctx.restore();
  }
}

/* -------------------------
   Levels: simple data for patterns
   ------------------------- */
const LEVELS = [
  // level 0: shorter, slower
  { name:'Warmup', length:1200, baseSpeed:230, spawnRate: 1.05, obstaclePatterns:[
    // array of [distance, type]
    [120, 'block'], [260,'spike'], [420,'block'], [560,'spike'], [720,'block']
  ]},
  { name:'Speedrun', length:2000, baseSpeed:320, spawnRate: 0.85, obstaclePatterns:[
    [200,'spike'], [360,'spike'], [520,'block'], [650,'block'], [820,'spike'], [950,'spike']
  ]},
  { name:'Spike Gauntlet', length:2600, baseSpeed:300, spawnRate: 0.7, obstaclePatterns:[
    [140,'spike'], [220,'spike'], [300,'spike'], [380,'spike'], [460,'block'], [540,'spike'],
    [620,'spike'], [700,'spike'], [900,'spike'], [1100,'spike']
  ]}
];

/* -------------------------
   World / GameState
   ------------------------- */
const Game = {
  running: false,
  paused: false,
  lastTime: 0,
  cameraX: 0,
  cameraY: 0,
  speed: 240, // world scroll speed px/s
  gravity: 1600,
  groundY: 0, // updated on resize
  player: null,
  obstacles: [],
  distance: 0, // how far progressed in level
  level: 0,
  levelLength: 1200,
  spawnTimer: 0,
  particles: Particles,
  cameraLerp: 0.06
};

function startLevel(levelIndex){
  const level = LEVELS[levelIndex];
  Game.level = levelIndex;
  Game.levelLength = level.length;
  Game.speed = level.baseSpeed;
  Game.obstacles = [];
  Game.distance = 0;
  Game.cameraX = 0;
  Game.cameraY = 0;
  Game.player = new Player(120, 0, 48, colorPicker.value);
  Game.lastTime = performance.now();
  Game.running = true;
  Game.paused = false;
  input.tapped = false;
  startScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  deathScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  updateGroundY();
  // preload obstacles according to pattern
  spawnObstaclesFromPattern(level.obstaclePatterns);
  if (musicToggle.checked) AudioSystem.startMusic();
}

function endGame(died){
  Game.running = false;
  // display death UI
  hud.classList.add('hidden');
  deathScreen.classList.remove('hidden');
  const percent = Math.min(100, Math.round((Game.distance / Game.levelLength) * 100));
  deathStat.textContent = `Progress: ${percent}%`;
  // update local high score
  if (percent > highScore) {
    highScore = percent;
    localStorage.setItem('neon_highscore', highScore.toString());
    highScoreText.textContent = Math.round(highScore) + '%';
  }
  // sound & particles
  AudioSystem.playDeath();
  Particles.spawn(Game.player.x + Game.player.w/2, Game.player.y + Game.player.h/2, 36, Game.player.color, 160);
}

/* -------------------------
   Obstacle spawning helpers
   ------------------------- */
function spawnObstaclesFromPattern(pattern){
  // pattern: array [distance, type]
  // place obstacles at positions relative to start
  for(const [dist, type] of pattern){
    const x = 600 + dist; // spawn ahead of player start
    const w = (type === 'spike') ? 120 : 56;
    const h = (type === 'spike') ? 48 : 56;
    const y = Game.groundY - h;
    Game.obstacles.push(new Obstacle(x, y, w, h, type));
  }
}

/* -------------------------
   Collision detection (AABB)
   ------------------------- */
function rectsCollide(a,b){
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

/* -------------------------
   Camera smoothing
   ------------------------- */
function updateCamera(dt){
  // camera follows the world; player stays visually at around x = 120
  const targetCamX = Game.player.x - 120;
  Game.cameraX += (targetCamX - Game.cameraX) * Math.min(1, Game.cameraLerp * 60 * dt);
  // small vertical camera bob based on player vy
  const targetCamY = Math.max(0, Game.player.vy * 0.02);
  Game.cameraY += (targetCamY - Game.cameraY) * 0.08;
}

/* -------------------------
   Main Loop & Update
   ------------------------- */
function gameLoop(now){
  if (!Game.running || Game.paused) {
    Game.lastTime = now;
    requestAnimationFrame(gameLoop);
    return;
  }
  const dt = Math.min(1/30, (now - Game.lastTime) / 1000);
  Game.lastTime = now;

  // increase difficulty slightly over time by increasing speed
  Game.speed += 0.02 * dt * Game.speed;

  // update distance travelled
  Game.distance += Game.speed * dt;

  // update player
  Game.player.update(dt, Game);

  // update obstacles
  for(let i=Game.obstacles.length-1;i>=0;i--){
    const obs = Game.obstacles[i];
    obs.update(dt, Game.speed);
    // collision check with player (AABB)
    if (rectsCollide(Game.player, obs)) {
      Game.player.dead = true;
      Game.running = false;
      endGame(true);
      break;
    }
    // cleanup off-screen obstacles
    if (obs.x + obs.w < Game.cameraX - 200) Game.obstacles.splice(i,1);
  }

  // simple spawning for long levels: spawn more obstacles as game goes
  spawnDynamicObstacles(dt);

  // update particles
  Particles.update(dt);

  // update camera
  updateCamera(dt);

  // update UI
  const pct = Math.round((Game.distance / Game.levelLength) * 100);
  progressFill.style.width = Math.min(100, pct) + '%';
  percentText.textContent = Math.min(100, pct) + '%';

  // check win
  if (Game.distance >= Game.levelLength) {
    Game.running = false;
    // treat as finished — show deathScreen as success
    hud.classList.add('hidden');
    deathScreen.classList.remove('hidden');
    deathStat.textContent = `Level Complete! 100%`;
    Particles.spawn(Game.player.x + Game.player.w/2, Game.player.y + Game.player.h/2, 80, Game.player.color, 260);
  }

  render();
  input.tapped = false;
  requestAnimationFrame(gameLoop);
}

/* -------------------------
   Dynamic obstacle spawning (keeps things interesting)
   ------------------------- */
let dynamicSpawnCooldown = 0;
function spawnDynamicObstacles(dt){
  dynamicSpawnCooldown -= dt;
  if (dynamicSpawnCooldown <= 0) {
    dynamicSpawnCooldown = Math.max(0.35, 1.2 - (Game.speed / 600)); // faster speed → more frequent
    // spawn obstacle ahead relative to cameraX
    const ahead = Game.cameraX + canvas.width / DPR + 180 + Math.random() * 200;
    const type = (Math.random() < 0.45 && Game.speed > 260) ? 'spike'
               : (Math.random() < 0.25) ? 'spike' : 'block';
    const w = (type === 'spike') ? (80 + Math.random()*80) : (40 + Math.random()*80);
    const h = (type === 'spike') ? 48 : (40 + Math.random()*60);
    const y = Game.groundY - h;
    Game.obstacles.push(new Obstacle(ahead, y, w, h, type));
  }
}

/* -------------------------
   Rendering
   ------------------------- */
function render(){
  // clear background
  ctx.fillStyle = '#07101b';
  ctx.fillRect(0,0, canvas.width / DPR, canvas.height / DPR);

  // background parallax layers
  drawBackground();

  // ground
  ctx.save();
  ctx.fillStyle = '#071018';
  ctx.fillRect(0, Game.groundY - 8 - Game.cameraY, canvas.width/DPR, 8);
  ctx.restore();

  // draw obstacles
  for(const obs of Game.obstacles) obs.draw(ctx, Game.cameraX, Game.cameraY);

  // draw player
  if (Game.player) Game.player.draw(ctx, Game.cameraX, Game.cameraY);

  // draw particles
  Particles.draw(ctx, Game.cameraX, Game.cameraY);

  // optional subtle vignette
  ctx.save();
  const w = canvas.width / DPR, h = canvas.height / DPR;
  const g = ctx.createLinearGradient(0,0,0,h);
  g.addColorStop(0, 'rgba(0,0,0,0.0)');
  g.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,w,h);
  ctx.restore();
}

function drawBackground(){
  const w = canvas.width / DPR, h = canvas.height / DPR;
  // moving grid
  ctx.save();
  const spacing = 48;
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#00f5ff';
  ctx.lineWidth = 1;
  const offset = (Game.cameraX * 0.12) % spacing;
  for (let gx = -offset; gx < w; gx += spacing) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  const offsetY = (performance.now() * 0.02) % spacing;
  for (let gy = -offsetY; gy < h; gy += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // animated rounded shapes
  ctx.save();
  const grd = ctx.createRadialGradient(w*0.2 + Math.sin(performance.now()*0.0006)*200, h*0.3, 60, w*0.2, h*0.3, w*0.9);
  grd.addColorStop(0, 'rgba(0,245,255,0.04)');
  grd.addColorStop(1, 'rgba(255,61,129,0.02)');
  ctx.fillStyle = grd;
  ctx.fillRect(0,0,w,h);
  ctx.restore();
}

/* -------------------------
   Helpers: ground and UI wiring
   ------------------------- */
function updateGroundY(){
  // keep ground at ~70% of screen height
  Game.groundY = Math.round((canvas.height / DPR) * 0.72);
  if (Game.player) {
    Game.player.y = Math.min(Game.player.y, Game.groundY - Game.player.h);
  }
}

/* -------------------------
   UI wiring & Buttons
   ------------------------- */
btnPlay.addEventListener('click', () => {
  const idx = parseInt(levelSelect.value,10);
  startLevel(idx);
});

btnPause.addEventListener('click', () => {
  Game.paused = !Game.paused;
  if (Game.paused) {
    pauseScreen.classList.remove('hidden');
    hud.classList.add('hidden');
    Game.prevRunning = Game.running;
    Game.running = false;
  } else {
    pauseScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    Game.running = true;
    Game.lastTime = performance.now();
  }
});

btnRestart.addEventListener('click', () => {
  // restart current level
  startLevel(Game.level);
});

btnResume.addEventListener('click', () => {
  Game.paused = false;
  pauseScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  Game.running = true;
  Game.lastTime = performance.now();
});

btnQuit.addEventListener('click', () => {
  // quit to menu
  hud.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  Game.running = false;
});

btnRetry.addEventListener('click', () => {
  startLevel(Game.level);
});

btnToMenu.addEventListener('click', () => {
  hud.classList.add('hidden');
  deathScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
});

colorPicker.addEventListener('input', () => {
  if (Game.player) Game.player.color = colorPicker.value;
});

/* show high score at start */
highScoreText.textContent = Math.round(highScore) + '%';

/* -------------------------
   Initialization: make start screen interactive
   ------------------------- */
function showStartScreen(){
  startScreen.classList.remove('hidden');
  hud.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  deathScreen.classList.add('hidden');
}
showStartScreen();
updateGroundY();

/* Start an initial render loop for background when not running to keep it alive */
(function idleLoop(t){
  if (!Game.running) {
    render();
  }
  requestAnimationFrame(idleLoop);
})(0);

/* Hook pointer interactions for tap-to-start on start screen */
canvas.addEventListener('pointerdown', (e) => {
  if (!Game.running && !startScreen.classList.contains('hidden')) {
    // allow tapping canvas to start
    btnPlay.click();
  }
});

/* Ensure audio context unlock on user gesture (autoplay rules) */
window.addEventListener('pointerdown', function unlock(){ 
  try { AudioSystem.ctx.resume(); } catch(e){}
  window.removeEventListener('pointerdown', unlock);
});

/* Kick off game loop */
requestAnimationFrame(gameLoop);

/* -------------------------
   Comments & Notes
   - The code separates rendering and logic reasonably.
   - Uses requestAnimationFrame for smooth updates.
   - Obstacles are simple rectangles/spikes; feel free to add sprite art.
   - Difficulty increases via gradual speed increase and spawn frequency.
   - Score = percent progress through level; stored in localStorage.
   - For more polish: add level-specific music tracks, save color presets, more obstacle types.
*/
