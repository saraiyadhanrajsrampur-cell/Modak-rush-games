(function(){
"use strict";

/* ============ SETUP & DPI-SAFE CANVAS ============ */
const wrap = document.getElementById('game-wrap');
const shakeLayer = document.getElementById('shakeLayer');
const bgCanvas = document.getElementById('bgCanvas');
const gameCanvas = document.getElementById('gameCanvas');
const bctx = bgCanvas.getContext('2d');
const gctx = gameCanvas.getContext('2d');
const blessVignette = document.getElementById('blessVignette');

let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

const track = {y:0, left:40, right:400, laneX:[0,0,0]};
const mushak = {x:0, y:0, w:56, h:34, targetX:0, lane:1, tilt:0, wobble:0, invincible:0, magnet:0, slowmo:0, blessing:0};

function resize(){
  const rect = wrap.getBoundingClientRect();
  W = rect.width; H = rect.height;
  [bgCanvas, gameCanvas].forEach(c=>{
    c.width = W * DPR; c.height = H * DPR;
    c.getContext('2d').setTransform(DPR,0,0,DPR,0,0);
  });
  track.y = H - 118;
  track.left = 44; track.right = W - 44;
  const span = track.right-track.left;
  track.laneX = [track.left+span*0.16, track.left+span*0.5, track.left+span*0.84];
  if(!mushak.x){ mushak.x = track.laneX[1]; mushak.targetX = track.laneX[1]; }
  buildRangoli();
  buildBunting();
  buildStars();
}
window.addEventListener('resize', resize);

/* ============ AUDIO (procedural, no external files) ============ */
let actx = null, musicGain=null, sfxGain=null, muted=false, musicTimer=null;
function ensureAudio(){
  if(actx) return;
  actx = new (window.AudioContext||window.webkitAudioContext)();
  musicGain = actx.createGain(); musicGain.gain.value = 0.06; musicGain.connect(actx.destination);
  sfxGain = actx.createGain(); sfxGain.gain.value = 0.22; sfxGain.connect(actx.destination);
  startMusic();
}
function tone(freq, dur, type, gainNode, startDelay, vol){
  if(!actx) return;
  const t0 = actx.currentTime + (startDelay||0);
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = type||'sine';
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol!==undefined?vol:0.5, t0+0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t0+dur);
  osc.connect(g); g.connect(gainNode);
  osc.start(t0); osc.stop(t0+dur+0.05);
}
function sfxCollect(){ tone(880,0.12,'triangle',sfxGain,0,0.5); tone(1320,0.14,'triangle',sfxGain,0.05,0.4); }
function sfxCoin(){ tone(1046,0.09,'square',sfxGain,0,0.35); tone(1568,0.12,'square',sfxGain,0.06,0.3); }
function sfxHit(){ tone(160,0.25,'sawtooth',sfxGain,0,0.5); tone(90,0.3,'sawtooth',sfxGain,0.05,0.4); }
function sfxPower(){ [523,659,784,1046].forEach((f,i)=>tone(f,0.15,'triangle',sfxGain,i*0.06,0.4)); }
function sfxLevel(){ [392,523,659,784,1046].forEach((f,i)=>tone(f,0.18,'sine',sfxGain,i*0.07,0.4)); }
function sfxGameOver(){ [392,349,294,247].forEach((f,i)=>tone(f,0.35,'sawtooth',sfxGain,i*0.16,0.35)); }
function sfxVictory(){ [523,659,784,1046,1318].forEach((f,i)=>tone(f,0.3,'triangle',sfxGain,i*0.12,0.45)); }
function sfxCombo(){ [660,880,1100].forEach((f,i)=>tone(f,0.12,'square',sfxGain,i*0.05,0.35)); }
function sfxBlessing(){ [392,494,587,659,784,988].forEach((f,i)=>tone(f,0.28,'triangle',sfxGain,i*0.08,0.4)); }
function sfxLane(){ tone(500,0.05,'square',sfxGain,0,0.15); }

const scale = [261.6,293.7,329.6,392.0,440.0,523.2,587.3,659.2];
function musicStep(){
  if(muted || !actx || document.hidden) return;
  const n1 = scale[Math.floor(Math.random()*scale.length)];
  const n2 = scale[Math.floor(Math.random()*scale.length)]/2;
  tone(n1,0.5,'sine',musicGain,0,0.3);
  tone(n2,0.9,'sine',musicGain,0,0.18);
}
function startMusic(){
  if(musicTimer) return;
  musicStep();
  musicTimer = setInterval(musicStep, 500);
}
document.getElementById('muteBtn').addEventListener('click', ()=>{
  muted = !muted;
  document.getElementById('muteBtn').textContent = muted ? '🔇' : '🔊';
  if(musicGain) musicGain.gain.value = muted ? 0 : 0.06;
  if(sfxGain) sfxGain.gain.value = muted ? 0 : 0.22;
});
function vibrate(pattern){ if(navigator.vibrate){ try{ navigator.vibrate(pattern); }catch(e){} } }

/* ============ HIGH SCORE ============ */
let highScore = 0;
try{ highScore = parseInt(localStorage.getItem('modakRushHighScore')||'0',10) || 0; }catch(e){ highScore=0; }
function saveHighScore(s){
  if(s>highScore){ highScore=s; try{ localStorage.setItem('modakRushHighScore', String(highScore)); }catch(e){} return true; }
  return false;
}
document.getElementById('bestBadgeStart').textContent = 'Best: '+highScore;

/* ============ GAME STATE ============ */
let state = 'start';
let score=0, coins=0, lives=3, level=1;
let combo=0, comboMax=1, comboMult=1;
let fallSpeedBase = 2.1, spawnInterval = 920, lastSpawn=0;
let items=[], particles=[], petals=[], fireworks=[], stars=[];
let levelScoreTarget = 400;
const MAX_LEVEL = 5;
let lastFrame=0;
let shakeAmt=0;
let blessingTimer=0;

const scoreVal=document.getElementById('scoreVal');
const coinVal=document.getElementById('coinVal');
const levelVal=document.getElementById('levelVal');
const livesRow=document.getElementById('livesRow');
const powerBar=document.getElementById('powerBar');
const flashBanner=document.getElementById('flashBanner');
const comboBadge=document.getElementById('comboBadge');
const ultimateFill=document.getElementById('ultimateFill');
const ultimateBtn=document.getElementById('ultimateBtn');

function renderHearts(){
  livesRow.innerHTML='';
  for(let i=0;i<3;i++){
    const s=document.createElement('span');
    s.className='heart'+(i<lives?'':' dead');
    s.textContent='🔶';
    livesRow.appendChild(s);
  }
}
function flash(text){
  flashBanner.textContent = text;
  flashBanner.classList.remove('show'); void flashBanner.offsetWidth;
  flashBanner.classList.add('show');
  clearTimeout(flash._t);
  flash._t = setTimeout(()=>flashBanner.classList.remove('show'), 850);
}
function updatePowerBar(){
  powerBar.innerHTML='';
  if(mushak.magnet>0){ const d=document.createElement('div'); d.className='power-chip'; d.textContent='🧲 Magnet '+Math.ceil(mushak.magnet/1000)+'s'; powerBar.appendChild(d); }
  if(mushak.invincible>0){ const d=document.createElement('div'); d.className='power-chip'; d.textContent='🪔 Shield '+Math.ceil(mushak.invincible/1000)+'s'; powerBar.appendChild(d); }
  if(mushak.slowmo>0){ const d=document.createElement('div'); d.className='power-chip'; d.textContent='🍃 Slow-mo '+Math.ceil(mushak.slowmo/1000)+'s'; powerBar.appendChild(d); }
}
function updateComboBadge(){
  if(comboMult>1){
    comboBadge.textContent = 'COMBO x'+comboMult.toFixed(1).replace('.0','');
    comboBadge.classList.add('show');
  } else {
    comboBadge.classList.remove('show');
  }
}
function screenShake(amt){ shakeAmt = Math.max(shakeAmt, amt); }

/* ============ BACKGROUND: pandal, rangoli, bunting, diyas, stars ============ */
let rangoliPoints=[];
function buildRangoli(){
  rangoliPoints=[];
  const cx=W/2, cy=H-40, layers=3;
  for(let l=1;l<=layers;l++){
    const r=l*16, n=8*l;
    for(let i=0;i<n;i++){
      const a=(i/n)*Math.PI*2;
      rangoliPoints.push({x:cx+Math.cos(a)*r, y:cy+Math.sin(a)*r*0.32, r:3.2, hue:(l*70+i*10)%360});
    }
  }
}
let buntingFlags=[];
function buildBunting(){
  buntingFlags=[];
  const n = Math.ceil(W/34);
  for(let i=0;i<n;i++) buntingFlags.push({x:i*34+17, hue:[350,28,45,190,300][i%5]});
}
function buildStars(){
  stars=[];
  for(let i=0;i<40;i++) stars.push({x:Math.random()*W, y:Math.random()*H*0.5, r:0.6+Math.random()*1.4, ph:Math.random()*10});
}
let diyaFlicker=0;

const SKY_THEMES = [
  {top:'#3A1049', mid:'#7A2255', bot:'#FF8A3D'},
  {top:'#2C0C3E', mid:'#7A1E4E', bot:'#FF7A3D'},
  {top:'#210A34', mid:'#6B1E52', bot:'#FF9A3D'},
  {top:'#160726', mid:'#521A4E', bot:'#E86A3D'},
  {top:'#0C0420', mid:'#3A1450', bot:'#B94A5C'}
];
function applySkyTheme(lv){
  const th = SKY_THEMES[Math.min(lv-1, SKY_THEMES.length-1)];
  wrap.style.setProperty('--sky-top', th.top);
  wrap.style.setProperty('--sky-mid', th.mid);
  wrap.style.setProperty('--sky-bot', th.bot);
}

function spawnFirework(x,y){
  const hue = Math.random()*360;
  for(let i=0;i<22;i++){
    const a = (i/22)*Math.PI*2;
    const sp = 1.6+Math.random()*1.6;
    fireworks.push({x,y,vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:1, hue:hue+Math.random()*40-20});
  }
}
function updateFireworks(dt){
  fireworks.forEach(f=>{
    f.x+=f.vx*dt*0.06; f.y+=f.vy*dt*0.06; f.vy+=0.015*dt; f.life-=0.018*dt;
  });
  fireworks = fireworks.filter(f=>f.life>0);
}
function drawFireworks(){
  fireworks.forEach(f=>{
    bctx.globalAlpha = Math.max(f.life,0);
    bctx.fillStyle = `hsl(${f.hue},90%,65%)`;
    bctx.beginPath(); bctx.arc(f.x,f.y,2.4,0,Math.PI*2); bctx.fill();
    bctx.globalAlpha=1;
  });
}

function drawBackground(t){
  bctx.clearRect(0,0,W,H);
  const glow = bctx.createRadialGradient(W/2,H*0.32,10,W/2,H*0.32,W*0.6);
  glow.addColorStop(0,'rgba(255,178,56,0.35)');
  glow.addColorStop(1,'rgba(255,178,56,0)');
  bctx.fillStyle=glow; bctx.fillRect(0,0,W,H);

  if(level>=3){
    stars.forEach(s=>{
      const tw = 0.5+0.5*Math.sin(t/300+s.ph);
      bctx.globalAlpha = 0.4+0.5*tw;
      bctx.fillStyle='#FFF3DD';
      bctx.beginPath(); bctx.arc(s.x,s.y,s.r,0,Math.PI*2); bctx.fill();
      bctx.globalAlpha=1;
    });
  }

  const pillarW=26, archY=H*0.10, pillarH=H*0.42;
  [40, W-40-pillarW].forEach(px=>{
    const grad = bctx.createLinearGradient(px,0,px+pillarW,0);
    grad.addColorStop(0,'#7A1030'); grad.addColorStop(0.5,'#B3153A'); grad.addColorStop(1,'#7A1030');
    bctx.fillStyle=grad;
    bctx.fillRect(px, archY, pillarW, pillarH);
    for(let i=0;i<5;i++){
      bctx.fillStyle = i%2===0 ? 'rgba(255,210,92,.85)' : 'rgba(255,255,255,.15)';
      bctx.fillRect(px+4, archY+14+i*(pillarH/5), pillarW-8, 6);
    }
  });
  bctx.beginPath();
  bctx.moveTo(30,archY+6);
  bctx.quadraticCurveTo(W/2, archY-60, W-30, archY+6);
  bctx.lineTo(W-30, archY+30);
  bctx.quadraticCurveTo(W/2, archY-30, 30, archY+30);
  bctx.closePath();
  const archGrad=bctx.createLinearGradient(0,archY-60,0,archY+30);
  archGrad.addColorStop(0,'#FFD25C'); archGrad.addColorStop(1,'#FF8A3D');
  bctx.fillStyle=archGrad; bctx.fill();
  bctx.strokeStyle='rgba(122,16,48,.6)'; bctx.lineWidth=3; bctx.stroke();

  buntingFlags.forEach((f,i)=>{
    const bob = Math.sin(t/500 + i)*3;
    bctx.beginPath();
    bctx.moveTo(f.x-9, archY-4+bob);
    bctx.lineTo(f.x+9, archY-4+bob);
    bctx.lineTo(f.x, archY+14+bob);
    bctx.closePath();
    bctx.fillStyle = `hsl(${f.hue},80%,60%)`;
    bctx.fill();
  });

  diyaFlicker = t;
  const diyaY = H-58, n=Math.floor(W/56);
  for(let i=0;i<n;i++){
    const dx = 28+i*56 + 28;
    const flick = 1+Math.sin(diyaFlicker/120+i)*0.18;
    bctx.beginPath();
    bctx.ellipse(dx, diyaY, 13,7,0,0,Math.PI*2);
    bctx.fillStyle='#B3153A'; bctx.fill();
    bctx.beginPath();
    bctx.ellipse(dx, diyaY-14*flick, 4*flick,8*flick,0,0,Math.PI*2);
    const fgrad=bctx.createRadialGradient(dx,diyaY-14*flick,0,dx,diyaY-14*flick,10);
    fgrad.addColorStop(0,'#FFF3B0'); fgrad.addColorStop(0.5,'#FFB238'); fgrad.addColorStop(1,'rgba(255,140,20,0)');
    bctx.fillStyle=fgrad; bctx.fill();
  }

  rangoliPoints.forEach(p=>{
    bctx.beginPath();
    bctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    bctx.fillStyle=`hsl(${p.hue},85%,60%)`;
    bctx.fill();
  });
  bctx.beginPath(); bctx.arc(W/2,H-40,7,0,Math.PI*2);
  bctx.fillStyle='#FFD25C'; bctx.fill();

  const gGrad = bctx.createLinearGradient(0,H-30,0,H);
  gGrad.addColorStop(0,'rgba(122,16,48,.5)'); gGrad.addColorStop(1,'rgba(58,18,32,.9)');
  bctx.fillStyle=gGrad; bctx.fillRect(0,H-30,W,30);

  // lane guides (subtle, modern-runner cue)
  track.laneX.forEach(lx=>{
    bctx.strokeStyle='rgba(255,243,221,.10)';
    bctx.setLineDash([6,10]);
    bctx.lineWidth=2;
    bctx.beginPath(); bctx.moveTo(lx, archY+40); bctx.lineTo(lx, H-30); bctx.stroke();
    bctx.setLineDash([]);
  });

  drawFireworks();
}

/* ============ PETALS ============ */
function seedPetals(){
  petals=[];
  for(let i=0;i<16;i++){
    petals.push({x:Math.random()*W, y:Math.random()*H, s:4+Math.random()*4, sp:0.4+Math.random()*0.6, sway:Math.random()*Math.PI*2, hue:[350,28,320][i%3]});
  }
}
function drawPetals(dt){
  petals.forEach(p=>{
    p.y += p.sp*dt*0.05;
    p.sway += 0.02*dt;
    p.x += Math.sin(p.sway)*0.3;
    if(p.y>H+10){ p.y=-10; p.x=Math.random()*W; }
    gctx.save();
    gctx.translate(p.x,p.y);
    gctx.rotate(p.sway);
    gctx.fillStyle=`hsl(${p.hue},80%,70%)`;
    gctx.beginPath();
    gctx.ellipse(0,0,p.s,p.s*0.6,0,0,Math.PI*2);
    gctx.fill();
    gctx.restore();
  });
}

/* ============ MUSHAK (player) ============ */
function drawMushak(){
  const {x,w,h} = mushak;
  const y = track.y;
  const bob = Math.sin(mushak.wobble)*3;
  gctx.save();
  gctx.translate(x, y+bob);
  gctx.rotate(mushak.tilt);

  if(mushak.invincible>0 || mushak.blessing>0){
    gctx.beginPath(); gctx.arc(0,-6,34,0,Math.PI*2);
    gctx.strokeStyle=`rgba(255,210,92,${0.4+0.3*Math.sin(mushak.wobble*3)})`;
    gctx.lineWidth=4; gctx.stroke();
  }
  gctx.strokeStyle='#B98A6B'; gctx.lineWidth=3; gctx.lineCap='round';
  gctx.beginPath();
  gctx.moveTo(w*0.42,4);
  gctx.quadraticCurveTo(w*0.75,-6,w*0.66,-20);
  gctx.stroke();
  const bodyGrad = gctx.createLinearGradient(-w/2,-h,w/2,h/2);
  bodyGrad.addColorStop(0,'#9C8272'); bodyGrad.addColorStop(1,'#6E5548');
  gctx.fillStyle=bodyGrad;
  gctx.beginPath();
  gctx.ellipse(0,-h*0.25, w*0.42, h*0.42, 0,0,Math.PI*2);
  gctx.fill();
  gctx.fillStyle='#7A5F50';
  gctx.beginPath(); gctx.ellipse(-w*0.28,-h*0.62,9,9,0,0,Math.PI*2); gctx.fill();
  gctx.beginPath(); gctx.ellipse(w*0.02,-h*0.7,9,9,0,0,Math.PI*2); gctx.fill();
  gctx.fillStyle='#E7B8AE';
  gctx.beginPath(); gctx.ellipse(-w*0.28,-h*0.62,4.5,4.5,0,0,Math.PI*2); gctx.fill();
  gctx.beginPath(); gctx.ellipse(w*0.02,-h*0.7,4.5,4.5,0,0,Math.PI*2); gctx.fill();
  gctx.fillStyle='#8A6C5C';
  gctx.beginPath(); gctx.ellipse(w*0.32,-h*0.2,10,7,0,0,Math.PI*2); gctx.fill();
  gctx.fillStyle='#3A1220';
  gctx.beginPath(); gctx.arc(w*0.42,-h*0.2,2.3,0,Math.PI*2); gctx.fill();
  gctx.beginPath(); gctx.arc(w*0.06,-h*0.42,2.3,0,Math.PI*2); gctx.fill();
  gctx.fillStyle='#FF8A3D';
  gctx.beginPath(); gctx.moveTo(-w*0.06,-h*0.85); gctx.lineTo(-w*0.14,-h*0.68); gctx.lineTo(w*0.02,-h*0.68); gctx.closePath(); gctx.fill();
  gctx.strokeStyle='#6E5548'; gctx.lineWidth=5; gctx.lineCap='round';
  gctx.beginPath(); gctx.moveTo(-w*0.2,h*0.05); gctx.lineTo(-w*0.24,h*0.22); gctx.stroke();
  gctx.beginPath(); gctx.moveTo(w*0.14,h*0.05); gctx.lineTo(w*0.2,h*0.22); gctx.stroke();
  gctx.restore();
}

/* ============ ITEMS ============ */
const TYPES = {
  modak:{score:10, r:15, weight:34},
  coin:{score:5, r:12, weight:26, coin:true},
  flower:{score:2, r:10, weight:18},
  obstacle:{score:0, r:15, weight:16, bad:true},
  powerMagnet:{score:0, r:15, weight:2, power:'magnet'},
  powerShield:{score:0, r:15, weight:2, power:'shield'},
  powerSlow:{score:0, r:15, weight:2, power:'slow'}
};
function pickType(){
  const entries = Object.entries(TYPES);
  const total = entries.reduce((s,[,v])=>s+v.weight,0);
  let r = Math.random()*total;
  for(const [k,v] of entries){ r-=v.weight; if(r<=0) return k; }
  return 'modak';
}
function spawnItem(){
  const key = pickType();
  const def = TYPES[key];
  const lane = Math.floor(Math.random()*3);
  items.push({
    key, r:def.r, lane,
    x: track.laneX[lane],
    y: -20,
    vy: fallSpeedBase * (0.85+Math.random()*0.4) * (mushak.slowmo>0?0.45:1),
    rot: Math.random()*Math.PI*2,
    rotSp: (Math.random()-0.5)*0.06
  });
}
function drawItem(it){
  gctx.save();
  gctx.translate(it.x,it.y);
  gctx.rotate(it.rot);
  const asModak = mushak.blessing>0 && !TYPES[it.key].bad && !TYPES[it.key].power;
  switch(asModak ? 'modak' : it.key){
    case 'modak': {
      const g = gctx.createLinearGradient(0,-14,0,12);
      g.addColorStop(0,'#FFF7E6'); g.addColorStop(1,'#F2D9A8');
      gctx.fillStyle=g;
      gctx.beginPath();
      gctx.moveTo(0,-14);
      gctx.bezierCurveTo(12,-10, 13,10, 0,14);
      gctx.bezierCurveTo(-13,10, -12,-10, 0,-14);
      gctx.fill();
      gctx.strokeStyle='rgba(180,130,60,.4)'; gctx.lineWidth=1;
      for(let i=-8;i<=8;i+=4){ gctx.beginPath(); gctx.moveTo(i,-11); gctx.lineTo(i*0.4,12); gctx.stroke(); }
      gctx.fillStyle='#FF8A3D';
      gctx.beginPath(); gctx.arc(0,-14,3,0,Math.PI*2); gctx.fill();
      if(mushak.blessing>0){
        gctx.strokeStyle='rgba(255,210,92,.8)'; gctx.lineWidth=2;
        gctx.beginPath(); gctx.arc(0,0,17,0,Math.PI*2); gctx.stroke();
      }
      break;
    }
    case 'coin': {
      const g = gctx.createRadialGradient(-3,-3,1,0,0,13);
      g.addColorStop(0,'#FFF4C2'); g.addColorStop(0.6,'#FFD25C'); g.addColorStop(1,'#C98A1E');
      gctx.fillStyle=g;
      gctx.beginPath(); gctx.arc(0,0,12,0,Math.PI*2); gctx.fill();
      gctx.strokeStyle='#C98A1E'; gctx.lineWidth=2; gctx.stroke();
      gctx.fillStyle='#9C5F14'; gctx.font='bold 12px Baloo 2, sans-serif'; gctx.textAlign='center'; gctx.textBaseline='middle';
      gctx.fillText('ॐ',0,1);
      break;
    }
    case 'flower': {
      const hue = 340;
      for(let i=0;i<5;i++){
        gctx.save(); gctx.rotate(i*(Math.PI*2/5));
        gctx.fillStyle=`hsl(${hue},75%,68%)`;
        gctx.beginPath(); gctx.ellipse(0,-7,4.5,7,0,0,Math.PI*2); gctx.fill();
        gctx.restore();
      }
      gctx.fillStyle='#FFD25C'; gctx.beginPath(); gctx.arc(0,0,3.4,0,Math.PI*2); gctx.fill();
      break;
    }
    case 'obstacle': {
      gctx.fillStyle='#2E5B3E';
      gctx.beginPath(); gctx.arc(0,0,11,0,Math.PI*2); gctx.fill();
      gctx.strokeStyle='#173822'; gctx.lineWidth=2;
      for(let i=0;i<8;i++){
        const a=i*(Math.PI*2/8);
        gctx.beginPath();
        gctx.moveTo(Math.cos(a)*10,Math.sin(a)*10);
        gctx.lineTo(Math.cos(a)*17,Math.sin(a)*17);
        gctx.stroke();
      }
      break;
    }
    case 'powerMagnet': case 'powerShield': case 'powerSlow': {
      const glow = gctx.createRadialGradient(0,0,2,0,0,20);
      const c = it.key==='powerMagnet' ? '255,150,90' : it.key==='powerShield' ? '255,210,92' : '150,220,170';
      glow.addColorStop(0,`rgba(${c},0.9)`); glow.addColorStop(1,`rgba(${c},0)`);
      gctx.fillStyle=glow; gctx.beginPath(); gctx.arc(0,0,20,0,Math.PI*2); gctx.fill();
      gctx.font='18px sans-serif'; gctx.textAlign='center'; gctx.textBaseline='middle';
      gctx.fillText(it.key==='powerMagnet'?'🧲':it.key==='powerShield'?'🪔':'🍃', 0,1);
      break;
    }
  }
  gctx.restore();
}

/* ============ PARTICLES ============ */
function burst(x,y,color,n){
  for(let i=0;i<(n||10);i++){
    particles.push({x,y,vx:(Math.random()-0.5)*4,vy:(Math.random()-0.5)*4-1,life:1,color});
  }
}
function drawParticles(dt){
  particles.forEach(p=>{
    p.x+=p.vx*dt*0.06; p.y+=p.vy*dt*0.06; p.vy+=0.01*dt; p.life-=0.02*dt*0.06*16;
    gctx.globalAlpha=Math.max(p.life,0);
    gctx.fillStyle=p.color;
    gctx.beginPath(); gctx.arc(p.x,p.y,3,0,Math.PI*2); gctx.fill();
    gctx.globalAlpha=1;
  });
  particles = particles.filter(p=>p.life>0);
}

/* ============ INPUT (lane-based swipe) ============ */
function goLane(delta){
  const newLane = Math.max(0, Math.min(2, mushak.lane+delta));
  if(newLane!==mushak.lane){ mushak.lane = newLane; mushak.targetX = track.laneX[newLane]; sfxLane(); vibrate(8); }
}
let touchStartX=null, touchStartY=null, touchStartT=0;
gameCanvas.addEventListener('pointerdown', e=>{ touchStartX=e.clientX; touchStartY=e.clientY; touchStartT=performance.now(); });
gameCanvas.addEventListener('pointerup', e=>{
  if(touchStartX===null || state!=='playing') return;
  const dx = e.clientX-touchStartX, dy = e.clientY-touchStartY;
  const dt = performance.now()-touchStartT;
  if(Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) && dt<600){
    goLane(dx>0 ? 1 : -1);
  }
  touchStartX=null;
});
document.getElementById('leftZone').addEventListener('pointerdown', ()=>{ if(state==='playing') goLane(-1); });
document.getElementById('rightZone').addEventListener('pointerdown', ()=>{ if(state==='playing') goLane(1); });
window.addEventListener('keydown', e=>{
  if(state!=='playing') return;
  if(e.key==='ArrowLeft') goLane(-1);
  if(e.key==='ArrowRight') goLane(1);
});
ultimateBtn.addEventListener('click', activateBlessing);

/* ============ SCREEN MANAGEMENT ============ */
const screens = {
  start: document.getElementById('startScreen'),
  howto: document.getElementById('howToScreen'),
  pause: document.getElementById('pauseScreen'),
  over: document.getElementById('overScreen'),
  victory: document.getElementById('victoryScreen')
};
function showScreen(name){
  Object.values(screens).forEach(s=>s.classList.add('hidden'));
  if(name) screens[name].classList.remove('hidden');
}

document.getElementById('startBtn').addEventListener('click', ()=>{ ensureAudio(); startGame(); });
document.getElementById('howToBtn').addEventListener('click', ()=> showScreen('howto'));
document.getElementById('backToStartBtn').addEventListener('click', ()=> showScreen('start'));
document.getElementById('pauseBtn').addEventListener('click', ()=>{ if(state==='playing') pauseGame(); else if(state==='paused') resumeGame(); });
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('restartFromPauseBtn').addEventListener('click', ()=>{ ensureAudio(); startGame(); });
document.getElementById('retryBtn').addEventListener('click', ()=>{ ensureAudio(); startGame(); });
document.getElementById('victoryRetryBtn').addEventListener('click', ()=>{ ensureAudio(); startGame(); });

function pauseGame(){ state='paused'; showScreen('pause'); }
function resumeGame(){ state='playing'; showScreen(null); lastFrame=performance.now(); }

function startGame(){
  score=0; coins=0; lives=3; level=1;
  combo=0; comboMax=1; comboMult=1;
  fallSpeedBase=2.1; spawnInterval=920; levelScoreTarget=400;
  items=[]; particles=[]; fireworks=[];
  mushak.lane=1; mushak.x=track.laneX[1]; mushak.targetX=track.laneX[1];
  mushak.invincible=0; mushak.magnet=0; mushak.slowmo=0; mushak.blessing=0;
  blessingTimer=0;
  scoreVal.textContent='0'; coinVal.textContent='0'; levelVal.textContent='1';
  renderHearts(); updatePowerBar(); updateComboBadge();
  ultimateFill.style.width='0%'; ultimateBtn.classList.remove('ready');
  blessVignette.classList.remove('active');
  applySkyTheme(1);
  state='playing';
  showScreen(null);
  lastFrame = performance.now();
  lastSpawn = 0;
}

function endGame(){
  state='over';
  const isBest = saveHighScore(score);
  document.getElementById('finalScore').textContent=score;
  document.getElementById('finalCoins').textContent=coins;
  document.getElementById('finalCombo').textContent='x'+comboMax.toFixed(1).replace('.0','');
  document.getElementById('finalLevel').textContent=level;
  document.getElementById('bestBadgeOver').textContent='Best: '+highScore;
  document.getElementById('newBestOver').style.display = isBest ? 'block' : 'none';
  document.getElementById('bestBadgeStart').textContent = 'Best: '+highScore;
  showScreen('over');
  sfxGameOver();
}
function winGame(){
  state='victory';
  const isBest = saveHighScore(score);
  document.getElementById('victoryScore').textContent=score;
  document.getElementById('victoryCoins').textContent=coins;
  document.getElementById('victoryCombo').textContent='x'+comboMax.toFixed(1).replace('.0','');
  document.getElementById('newBestVictory').style.display = isBest ? 'block' : 'none';
  document.getElementById('bestBadgeStart').textContent = 'Best: '+highScore;
  showScreen('victory');
  sfxVictory();
  spawnFirework(W/2,H*0.3);
}

/* ============ COMBO & ULTIMATE ============ */
function registerCatch(){
  combo++;
  comboMult = Math.min(3, 1 + Math.floor(combo/5)*0.5);
  comboMax = Math.max(comboMax, comboMult);
  updateComboBadge();
  if(combo>0 && combo%5===0){
    flash('COMBO x'+comboMult.toFixed(1).replace('.0','')+'!');
    sfxCombo(); vibrate([10,20,10]);
    spawnFirework(mushak.x, track.y-40);
  }
}
function breakCombo(){
  combo=0; comboMult=1; updateComboBadge();
}
function addBlessingMeter(amt){
  mushak.blessing = mushak.blessing; // no-op guard
  blessingCharge = Math.min(100, blessingCharge+amt);
  ultimateFill.style.width = blessingCharge+'%';
  if(blessingCharge>=100) ultimateBtn.classList.add('ready'); else ultimateBtn.classList.remove('ready');
}
let blessingCharge = 0;
function activateBlessing(){
  if(blessingCharge<100 || mushak.blessing>0) return;
  blessingCharge=0;
  ultimateFill.style.width='0%';
  ultimateBtn.classList.remove('ready');
  mushak.blessing = 5000;
  mushak.invincible = Math.max(mushak.invincible, 5000);
  flash("BAPPA'S BLESSING!");
  sfxBlessing(); vibrate([20,30,20,30,40]);
  spawnFirework(mushak.x, track.y-40);
  spawnFirework(W*0.25,H*0.25);
  spawnFirework(W*0.75,H*0.25);
}

/* ============ LEVEL PROGRESSION ============ */
function checkLevelUp(){
  if(score>=levelScoreTarget && level<MAX_LEVEL){
    level++;
    levelScoreTarget += 500 + level*60;
    fallSpeedBase += 0.55;
    spawnInterval = Math.max(430, spawnInterval-90);
    levelVal.textContent=level;
    applySkyTheme(level);
    flash('LEVEL '+level+'!');
    sfxLevel();
    spawnFirework(mushak.x, track.y-60);
  } else if(score>=levelScoreTarget && level>=MAX_LEVEL){
    winGame();
  }
}

/* ============ MAIN LOOP ============ */
function update(dt, t){
  mushak.wobble += dt*0.008;
  mushak.tilt = (mushak.targetX-mushak.x)*0.0022;
  mushak.x += (mushak.targetX-mushak.x)*Math.min(1,dt*0.018);
  if(mushak.invincible>0) mushak.invincible = Math.max(0, mushak.invincible-dt);
  if(mushak.magnet>0) mushak.magnet = Math.max(0, mushak.magnet-dt);
  if(mushak.slowmo>0) mushak.slowmo = Math.max(0, mushak.slowmo-dt);
  if(mushak.blessing>0){ mushak.blessing = Math.max(0, mushak.blessing-dt); blessVignette.classList.add('active'); }
  else blessVignette.classList.remove('active');
  updatePowerBar();
  updateFireworks(dt);
  if(shakeAmt>0){
    shakeAmt = Math.max(0, shakeAmt-dt*0.012);
    const ox=(Math.random()-0.5)*shakeAmt, oy=(Math.random()-0.5)*shakeAmt;
    shakeLayer.style.transform = `translate(${ox}px,${oy}px)`;
  } else {
    shakeLayer.style.transform='translate(0,0)';
  }

  lastSpawn += dt;
  if(lastSpawn > spawnInterval){ lastSpawn=0; spawnItem(); }

  const slowFactor = mushak.slowmo>0 ? 0.45 : (mushak.blessing>0 ? 0.7 : 1);
  items.forEach(it=>{
    if(mushak.magnet>0 && !TYPES[it.key].bad){
      const dx = mushak.x-it.x, dy = track.y-it.y;
      const dist = Math.hypot(dx,dy);
      if(dist<160){ it.x += dx*0.05; it.y += dy*0.02; }
    }
    it.y += it.vy*dt*0.06*slowFactor;
    it.rot += it.rotSp*dt*0.06;
  });

  const py = track.y-10;
  items = items.filter(it=>{
    const dx = it.x-mushak.x, dy = it.y-py;
    const hit = Math.hypot(dx,dy) < (it.r+22);
    if(hit){
      const def = TYPES[it.key];
      const isBad = def.bad && mushak.blessing<=0;
      if(isBad){
        if(mushak.invincible<=0){
          lives--; renderHearts(); sfxHit(); breakCombo(); screenShake(10); vibrate(35);
          burst(it.x,it.y,'#B3153A',12);
          if(lives<=0){ endGame(); }
        } else {
          burst(it.x,it.y,'#FFD25C',8);
        }
      } else if(def.power){
        sfxPower();
        if(def.power==='magnet') mushak.magnet=6000;
        if(def.power==='shield') mushak.invincible=6000;
        if(def.power==='slow') mushak.slowmo=6000;
        flash(def.power==='magnet'?'MAGNET!':def.power==='shield'?'SHIELD!':'SLOW-MO!');
        addBlessingMeter(10);
        burst(it.x,it.y,'#FFD25C',14);
      } else {
        const gained = Math.round(def.score * comboMult) || (def.bad?0:2);
        score += gained;
        if(def.coin){ coins++; coinVal.textContent=coins; sfxCoin(); }
        else sfxCollect();
        scoreVal.textContent=score;
        registerCatch();
        addBlessingMeter(def.coin?5:8);
        burst(it.x,it.y, def.coin?'#FFD25C':'#FF8A3D', 10);
        checkLevelUp();
      }
      return false;
    }
    if(it.y > H+30){
      if(!TYPES[it.key].bad && !TYPES[it.key].power) breakCombo();
      return false;
    }
    return true;
  });
}

function render(t){
  drawBackground(t);
  gctx.clearRect(0,0,W,H);
  drawPetals(16);
  items.forEach(drawItem);
  drawMushak();
  drawParticles(16);
}

function loop(now){
  requestAnimationFrame(loop);
  if(state!=='playing'){ lastFrame=now; return; }
  const dt = Math.min(now-lastFrame, 40);
  lastFrame = now;
  update(dt, now);
  render(now);
}
function idleLoop(now){
  if(state!=='playing'){
    drawBackground(now);
    gctx.clearRect(0,0,W,H);
    drawPetals(16);
    drawMushak();
  }
  requestAnimationFrame(idleLoop);
}

document.addEventListener('visibilitychange', ()=>{
  if(document.hidden && state==='playing') pauseGame();
});

/* ============ INIT ============ */
resize();
seedPetals();
renderHearts();
applySkyTheme(1);
showScreen('start');
requestAnimationFrame(loop);
requestAnimationFrame(idleLoop);

})();
