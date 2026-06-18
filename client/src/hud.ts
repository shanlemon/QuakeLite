// ---------------------------------------------------------------------------
// QuakeLite HUD — pure DOM, no canvas. Implements the Hud contract from
// types.ts. All CSS is injected via a <style> tag; the root (#hud) overlay is
// pointer-events:none with interactive panels (pause) opting back in.
// setStats() runs every frame, so every per-frame write is diffed against a
// cached value to avoid layout/style thrash.
// ---------------------------------------------------------------------------

import type {
  CreateHud,
  CrosshairStyle,
  Hud,
  HudCallbacks,
  HudStats,
  ScoreRow,
  Settings,
} from './types';
import { GAME, playerColor } from '../../shared/constants';
import { MAX_PLAYER_NAME_LENGTH } from '../../shared/playerName';
import { SENSITIVITY_MAX, SENSITIVITY_MIN } from './inputState';
import {
  CROSSHAIR_GAP_MAX,
  CROSSHAIR_GAP_MIN,
  CROSSHAIR_OPACITY_MAX,
  CROSSHAIR_OPACITY_MIN,
  CROSSHAIR_SIZE_MAX,
  CROSSHAIR_SIZE_MIN,
  clampNumber,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from './settings';
import {
  cooldownFrac,
  formatClock,
  formatPing,
  formatRespawnCountdown,
  formatRestartCountdown,
  leaderText,
  podiumVisualOrder,
  presentSpeed,
  sortScoreRows,
  sortStandings,
} from './hudPresenter';

function colorHex(idx: number): string {
  return '#' + playerColor(idx).toString(16).padStart(6, '0');
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

const FONT = `'Rajdhani','Segoe UI',Consolas,'Courier New',monospace`;
const SENSITIVITY_STEP = 0.05;
const CROSSHAIR_STYLE_LABELS: Record<CrosshairStyle, string> = {
  cross: 'CROSS',
  dot: 'DOT',
  ring: 'RING',
};

function formatSensitivity(v: number): string {
  return v < 1 ? v.toFixed(2) : v.toFixed(1);
}

const CSS = `
.ql-hud-root{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:10;
  font-family:${FONT};color:#dff6ff;-webkit-user-select:none;user-select:none;}
.ql-hud-root *{box-sizing:border-box;margin:0;padding:0;}
.ql-hidden{display:none !important;}
.ql-glow{text-shadow:0 0 8px rgba(120,220,255,0.55),0 1px 2px rgba(0,0,0,0.85);}

/* ---- crosshair ---- */
.ql-xhair{position:absolute;left:50%;top:50%;width:0;height:0;
  --xh-color:#fff;--xh-size:4px;--xh-gap:5px;--xh-thick:2px;--xh-opacity:1;
  --xh-dot-size:3px;--xh-dot-offset:-1.5px;--xh-thick-offset:-1px;--xh-arm-offset:-9px;
  --xh-dot-only-size:6px;--xh-dot-only-offset:-3px;--xh-ring-size:18px;--xh-ring-offset:-9px;
  opacity:var(--xh-opacity);}
.ql-xhair span{position:absolute;background:var(--xh-color);box-shadow:0 0 0 1px rgba(0,0,0,0.78);}
.ql-xh-dot{width:var(--xh-dot-size);height:var(--xh-dot-size);left:var(--xh-dot-offset);top:var(--xh-dot-offset);border-radius:50%;}
.ql-xh-t{width:var(--xh-thick);height:var(--xh-size);left:var(--xh-thick-offset);top:var(--xh-arm-offset);}
.ql-xh-b{width:var(--xh-thick);height:var(--xh-size);left:var(--xh-thick-offset);top:var(--xh-gap);}
.ql-xh-l{width:var(--xh-size);height:var(--xh-thick);left:var(--xh-arm-offset);top:var(--xh-thick-offset);}
.ql-xh-r{width:var(--xh-size);height:var(--xh-thick);left:var(--xh-gap);top:var(--xh-thick-offset);}
.ql-xh-ring{display:none;width:var(--xh-ring-size);height:var(--xh-ring-size);left:var(--xh-ring-offset);top:var(--xh-ring-offset);
  border:var(--xh-thick) solid var(--xh-color);border-radius:50%;background:transparent !important;}
.ql-xhair.xh-dot .ql-xh-t,.ql-xhair.xh-dot .ql-xh-b,.ql-xhair.xh-dot .ql-xh-l,.ql-xhair.xh-dot .ql-xh-r,.ql-xhair.xh-dot .ql-xh-ring{display:none;}
.ql-xhair.xh-dot .ql-xh-dot{display:block;width:var(--xh-dot-only-size);height:var(--xh-dot-only-size);
  left:var(--xh-dot-only-offset);top:var(--xh-dot-only-offset);}
.ql-xhair.xh-ring .ql-xh-dot,.ql-xhair.xh-ring .ql-xh-t,.ql-xhair.xh-ring .ql-xh-b,.ql-xhair.xh-ring .ql-xh-l,.ql-xhair.xh-ring .ql-xh-r{display:none;}
.ql-xhair.xh-ring .ql-xh-ring{display:block;}

/* ---- top bar ---- */
.ql-clock{position:absolute;top:14px;left:50%;transform:translateX(-50%);
  font-size:26px;font-weight:700;letter-spacing:3px;padding:2px 16px;
  background:rgba(5,10,20,0.65);border:1px solid rgba(150,175,205,0.35);}
.ql-frags{position:absolute;top:14px;right:16px;text-align:right;padding:6px 14px;
  background:rgba(5,10,20,0.65);border:1px solid rgba(150,175,205,0.35);}
.ql-frags-big{font-size:28px;font-weight:700;letter-spacing:1px;line-height:1.1;}
.ql-frags-big b{color:#46e6ff;font-weight:800;}
.ql-leader{font-size:13px;letter-spacing:2px;color:#9fb6c8;margin-top:2px;}

/* ---- kill feed ---- */
.ql-feed{position:absolute;top:14px;left:16px;display:flex;flex-direction:column;gap:4px;max-width:42vw;}
.ql-kill{display:flex;gap:7px;align-items:center;font-size:15px;font-weight:600;padding:3px 10px;
  background:rgba(5,10,20,0.65);border:1px solid rgba(150,175,205,0.3);
  opacity:1;transform:translateX(0);transition:opacity .4s ease,transform .4s ease;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ql-kill.me{border-color:rgba(125,225,255,0.85);box-shadow:0 0 10px rgba(70,230,255,0.25);}
.ql-kill.out{opacity:0;transform:translateX(-16px);}
.ql-bolt{color:#ffd60a;text-shadow:0 0 5px rgba(255,214,10,0.7);}

/* ---- rail cooldown ---- */
.ql-cd{position:absolute;bottom:26px;left:50%;transform:translateX(-50%);width:220px;height:10px;
  background:rgba(5,10,20,0.65);border:1px solid rgba(150,175,205,0.35);}
.ql-cd-fill{height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);
  background:rgba(80,165,205,0.55);}
.ql-cd.full{border-color:rgba(125,235,255,0.8);}
.ql-cd.full .ql-cd-fill{background:#46e6ff;box-shadow:0 0 10px rgba(70,230,255,0.85);}
.ql-cd.pulse{animation:ql-cd-pulse .3s ease-out;}
@keyframes ql-cd-pulse{
  0%{box-shadow:0 0 20px rgba(70,230,255,0.95);transform:translateX(-50%) scaleY(1.5);}
  100%{box-shadow:none;transform:translateX(-50%) scaleY(1);}}

/* ---- speedometer ---- */
.ql-speed{position:absolute;bottom:22px;left:18px;}
.ql-speed-text{font-size:20px;font-weight:700;letter-spacing:1px;
  text-shadow:0 0 8px rgba(120,220,255,0.4),0 1px 2px rgba(0,0,0,0.85);}
.ql-speed-track{width:150px;height:6px;margin-top:4px;
  background:rgba(5,10,20,0.65);border:1px solid rgba(150,175,205,0.35);}
.ql-speed-fill{height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);
  background:#cfe8f5;}
.ql-speed.fast .ql-speed-fill{background:#46e6ff;box-shadow:0 0 8px rgba(70,230,255,0.7);}
.ql-speed.fast .ql-speed-text{color:#7df0ff;}

/* ---- ping ---- */
.ql-ping{position:absolute;bottom:22px;right:18px;font-size:16px;font-weight:600;
  letter-spacing:2px;color:#9fb6c8;text-shadow:0 1px 2px rgba(0,0,0,0.85);}

/* ---- center message ---- */
.ql-msg{position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);
  font-size:34px;font-weight:800;letter-spacing:5px;text-transform:uppercase;white-space:nowrap;
  color:#eafcff;text-shadow:0 0 16px rgba(70,230,255,0.8),0 2px 5px rgba(0,0,0,0.85);
  opacity:0;transition:opacity .18s ease;}
.ql-msg.show{opacity:1;}

/* ---- death state ---- */
.ql-vignette{position:absolute;inset:0;z-index:2;
  background:radial-gradient(ellipse at center,rgba(120,0,0,0) 40%,rgba(150,0,12,0.55) 100%);}
.ql-respawn{position:absolute;bottom:18%;left:50%;transform:translateX(-50%);z-index:2;
  font-size:24px;font-weight:700;letter-spacing:3px;white-space:nowrap;
  color:#ff9090;text-shadow:0 0 12px rgba(255,60,60,0.7),0 1px 3px rgba(0,0,0,0.85);}

/* ---- fullscreen flash ---- */
.ql-flash{position:absolute;inset:0;z-index:3;opacity:0.55;}

/* ---- scoreboard ---- */
.ql-score{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;}
.ql-score-panel{min-width:480px;max-width:680px;max-height:80vh;overflow-y:auto;padding:18px 26px;
  background:rgba(5,10,20,0.78);border:1px solid rgba(150,175,205,0.4);
  box-shadow:0 0 50px rgba(0,0,0,0.6);}
.ql-score-title{font-size:20px;font-weight:700;letter-spacing:3px;text-align:center;
  color:#46e6ff;text-shadow:0 0 10px rgba(70,230,255,0.5);margin-bottom:12px;white-space:nowrap;}
.ql-table{width:100%;border-collapse:collapse;font-size:16px;}
.ql-table th{font-size:12px;font-weight:600;letter-spacing:2px;color:#8fa9bd;text-align:left;
  padding:4px 10px;border-bottom:1px solid rgba(150,175,205,0.3);}
.ql-table td{padding:5px 10px;border-bottom:1px solid rgba(150,175,205,0.12);}
.ql-table th.num,.ql-table td.num{text-align:right;font-variant-numeric:tabular-nums;}
.ql-table .ql-name{font-weight:700;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ql-row-local{background:rgba(70,230,255,0.10);box-shadow:inset 3px 0 0 #46e6ff;}
.ql-av{width:28px;height:28px;border-radius:50%;display:block;object-fit:cover;}
.ql-av-fb{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-weight:800;font-size:14px;color:rgba(0,0,0,0.82);}

/* ---- pause overlay ---- */
.ql-pause{position:absolute;inset:0;z-index:7;display:flex;align-items:center;justify-content:center;
  background:rgba(2,5,12,0.72);pointer-events:auto;}
.ql-pause-panel{width:430px;max-height:92vh;overflow-y:auto;padding:26px 30px;text-align:center;
  background:rgba(5,10,20,0.85);border:1px solid rgba(150,175,205,0.4);
  box-shadow:0 0 60px rgba(0,0,0,0.7);}
.ql-title{font-size:42px;font-weight:800;letter-spacing:9px;color:#eafcff;
  text-shadow:0 0 20px rgba(70,230,255,0.7),0 2px 4px rgba(0,0,0,0.9);}
.ql-sub{font-size:15px;letter-spacing:3px;color:#9fb6c8;margin:4px 0 20px;}
.ql-btn{pointer-events:auto;cursor:pointer;display:block;width:100%;padding:12px 0;margin:0 0 20px;
  font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:3px;
  color:#06121e;background:#46e6ff;border:1px solid #7df0ff;}
.ql-btn:hover{background:#7df0ff;box-shadow:0 0 18px rgba(70,230,255,0.6);}
.ql-btn:active{transform:translateY(1px);}
.ql-set-row{display:grid;grid-template-columns:106px 1fr 58px;gap:10px;align-items:center;
  margin:10px 0;font-size:14px;letter-spacing:1px;color:#cfe3f0;text-align:left;}
.ql-set-row input[type=range]{width:100%;accent-color:#46e6ff;cursor:pointer;background:transparent;}
.ql-set-row input[type=text],.ql-set-row select{width:100%;min-width:0;padding:7px 8px;
  color:#eaffff;background:rgba(2,6,14,0.72);border:1px solid rgba(150,175,205,0.42);
  font:700 14px/1 ${FONT};letter-spacing:1px;outline:none;}
.ql-set-row input[type=text]:focus,.ql-set-row select:focus{border-color:#46e6ff;box-shadow:0 0 10px rgba(70,230,255,0.22);}
.ql-set-row select{appearance:auto;cursor:pointer;}
.ql-set-row input[type=color]{width:100%;height:32px;min-width:0;padding:2px;cursor:pointer;
  background:rgba(2,6,14,0.72);border:1px solid rgba(150,175,205,0.42);}
.ql-set-row input[type=color]:focus{border-color:#46e6ff;box-shadow:0 0 10px rgba(70,230,255,0.22);outline:none;}
.ql-set-val{text-align:right;color:#46e6ff;font-weight:700;font-variant-numeric:tabular-nums;}
.ql-legend{margin-top:18px;font-size:13px;color:#9fb6c8;letter-spacing:1px;line-height:1.7;}
.ql-tip{margin-top:10px;font-size:12px;color:#6f8ba0;font-style:italic;line-height:1.5;}

/* ---- match end ---- */
.ql-end{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;
  background:rgba(2,5,12,0.68);}
.ql-end-panel{width:540px;max-height:88vh;overflow-y:auto;padding:24px 30px;text-align:center;
  background:rgba(5,10,20,0.85);border:1px solid rgba(150,175,205,0.4);
  box-shadow:0 0 60px rgba(0,0,0,0.7);}
.ql-end-title{font-size:32px;font-weight:800;letter-spacing:7px;color:#eafcff;
  text-shadow:0 0 18px rgba(70,230,255,0.7);}
.ql-podium{display:flex;justify-content:center;align-items:flex-end;gap:14px;margin:18px 0 16px;}
.ql-pod{flex:1;min-width:0;padding:10px 8px;background:rgba(5,10,20,0.7);border:1px solid rgba(150,175,205,0.35);}
.ql-pod .rank{font-size:12px;font-weight:700;letter-spacing:2px;}
.ql-pod .pname{font-weight:700;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:2px 0;}
.ql-pod .pfrags{font-size:22px;font-weight:800;color:#eafcff;font-variant-numeric:tabular-nums;}
.ql-pod-1{border-color:#ffd60a;box-shadow:0 0 16px rgba(255,214,10,0.35);padding:18px 8px;}
.ql-pod-1 .rank{color:#ffd60a;}
.ql-pod-1 .pname{font-size:19px;}
.ql-pod-1 .pfrags{font-size:32px;}
.ql-pod-2{border-color:#c0c8d0;}
.ql-pod-2 .rank{color:#c0c8d0;}
.ql-pod-3{border-color:#cd7f32;}
.ql-pod-3 .rank{color:#cd7f32;}
.ql-end-count{margin-top:14px;font-size:18px;font-weight:700;letter-spacing:2px;color:#46e6ff;
  text-shadow:0 0 8px rgba(70,230,255,0.5);}

/* ---- connection screen ---- */
.ql-connect{position:absolute;inset:0;z-index:9;display:flex;align-items:center;justify-content:center;
  background:#040810;}
.ql-connect-text{font-size:24px;font-weight:700;letter-spacing:5px;text-transform:uppercase;
  color:#9fdcef;text-shadow:0 0 14px rgba(70,230,255,0.5);text-align:center;padding:0 24px;
  animation:ql-pulse 1.4s ease-in-out infinite;}
@keyframes ql-pulse{0%,100%{opacity:0.4;}50%{opacity:1;}}
@media (max-width:760px),(pointer:coarse){
  .ql-clock{top:max(8px,env(safe-area-inset-top));font-size:18px;letter-spacing:2px;padding:2px 10px;}
  .ql-frags{top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));padding:4px 9px;}
  .ql-frags-big{font-size:20px;}
  .ql-leader{font-size:11px;letter-spacing:1px;}
  .ql-feed{top:calc(max(8px,env(safe-area-inset-top)) + 42px);left:max(8px,env(safe-area-inset-left));max-width:58vw;}
  .ql-kill{font-size:12px;padding:3px 7px;}
  .ql-cd{bottom:max(14px,env(safe-area-inset-bottom));width:150px;height:8px;}
  .ql-speed{bottom:calc(max(24px,env(safe-area-inset-bottom)) + 126px);left:max(18px,env(safe-area-inset-left));}
  .ql-speed-text{font-size:16px;}
  .ql-speed-track{width:112px;height:5px;}
  .ql-ping{display:none;}
  .ql-msg{top:24%;font-size:22px;letter-spacing:3px;max-width:92vw;white-space:normal;text-align:center;}
  .ql-respawn{bottom:22%;font-size:18px;letter-spacing:2px;}
  .ql-score-panel{min-width:0;width:min(94vw,560px);max-height:78vh;padding:14px 12px;}
  .ql-score-title{font-size:16px;letter-spacing:2px;}
  .ql-table{font-size:13px;}
  .ql-table th{font-size:10px;padding:4px 6px;}
  .ql-table td{padding:4px 6px;}
  .ql-table .ql-name{max-width:34vw;}
  .ql-av,.ql-av-fb{width:24px;height:24px;}
  .ql-pause-panel{width:min(92vw,430px);padding:20px 18px;}
  .ql-title{font-size:34px;letter-spacing:5px;}
  .ql-sub{font-size:13px;letter-spacing:2px;margin-bottom:14px;}
  .ql-btn{font-size:18px;margin-bottom:14px;}
  .ql-set-row{grid-template-columns:92px 1fr 48px;gap:8px;font-size:12px;}
  .ql-legend{font-size:12px;line-height:1.45;}
  .ql-tip{font-size:11px;}
  .ql-end-panel{width:min(94vw,540px);padding:18px 14px;}
  .ql-end-title{font-size:24px;letter-spacing:4px;}
  .ql-podium{gap:8px;}
  .ql-pod .pname{font-size:13px;}
  .ql-pod .pfrags{font-size:20px;}
  .ql-pod-1 .pname{font-size:15px;}
  .ql-pod-1 .pfrags{font-size:26px;}
}
`;

export const createHud: CreateHud = (root: HTMLElement, cb: HudCallbacks): Hud => {
  if (!document.getElementById('ql-hud-style')) {
    const style = document.createElement('style');
    style.id = 'ql-hud-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  root.classList.add('ql-hud-root');

  let settings = loadSettings();

  // --- crosshair -----------------------------------------------------------
  const xhair = el('div', 'ql-xhair', root);
  for (const c of ['ql-xh-dot', 'ql-xh-t', 'ql-xh-b', 'ql-xh-l', 'ql-xh-r', 'ql-xh-ring']) {
    el('span', c, xhair);
  }
  applyCrosshairSettings();

  // --- top: clock / frags / kill feed -------------------------------------
  const clockEl = el('div', 'ql-clock ql-glow', root);
  clockEl.textContent = '0:00';

  const fragsBox = el('div', 'ql-frags', root);
  const fragsBig = el('div', 'ql-frags-big ql-glow', fragsBox);
  fragsBig.appendChild(document.createTextNode('FRAGS '));
  const fragsNum = el('b', undefined, fragsBig);
  fragsNum.textContent = '0';
  fragsBig.appendChild(document.createTextNode(` / ${GAME.FRAG_LIMIT}`));
  const leaderEl = el('div', 'ql-leader ql-hidden', fragsBox);

  const feedEl = el('div', 'ql-feed', root);

  // --- bottom: cooldown / speed / ping -------------------------------------
  const cdEl = el('div', 'ql-cd', root);
  const cdFill = el('div', 'ql-cd-fill', cdEl);

  const speedEl = el('div', 'ql-speed', root);
  const speedText = el('div', 'ql-speed-text', speedEl);
  speedText.textContent = '0 ups';
  const speedTrack = el('div', 'ql-speed-track', speedEl);
  const speedFill = el('div', 'ql-speed-fill', speedTrack);

  const pingEl = el('div', 'ql-ping', root);
  pingEl.textContent = 'PING 0';

  // --- center message / death state ----------------------------------------
  const msgEl = el('div', 'ql-msg', root);
  const vignetteEl = el('div', 'ql-vignette ql-hidden', root);
  const respawnEl = el('div', 'ql-respawn ql-hidden', root);

  // --- scoreboard ----------------------------------------------------------
  const scoreEl = el('div', 'ql-score ql-hidden', root);
  const scorePanel = el('div', 'ql-score-panel', scoreEl);
  const scoreTitle = el('div', 'ql-score-title', scorePanel);
  scoreTitle.textContent = 'THE LONGEST YARD - FREE FOR ALL';
  const scoreTable = el('table', 'ql-table', scorePanel);
  const scoreHead = el('thead', undefined, scoreTable);
  {
    const tr = el('tr', undefined, scoreHead);
    for (const [text, cls] of [
      ['', ''],
      ['PLAYER', ''],
      ['FRAGS', 'num'],
      ['DEATHS', 'num'],
      ['PING', 'num'],
    ] as const) {
      const th = el('th', cls || undefined, tr);
      th.textContent = text;
    }
  }
  const scoreBody = el('tbody', undefined, scoreTable);

  function fallbackAvatar(colorIdx: number, name: string): HTMLElement {
    const d = el('div', 'ql-av-fb');
    d.style.background = colorHex(colorIdx);
    d.textContent = (name.trim().charAt(0) || '?').toUpperCase();
    return d;
  }

  // --- pause overlay --------------------------------------------------------
  const pauseEl = el('div', 'ql-pause ql-hidden', root);
  const pausePanel = el('div', 'ql-pause-panel', pauseEl);
  const titleEl = el('div', 'ql-title', pausePanel);
  titleEl.textContent = 'QUAKELITE';
  const subEl = el('div', 'ql-sub', pausePanel);
  subEl.textContent = 'The Longest Yard - Instagib FFA';
  const resumeBtn = el('button', 'ql-btn', pausePanel);
  resumeBtn.type = 'button';
  resumeBtn.textContent = 'PLAY / RESUME';
  resumeBtn.addEventListener('click', () => cb.onResume());

  function applySettings(): void {
    settings = normalizeSettings(settings);
    saveSettings(settings);
    applyCrosshairSettings();
    cb.onSettingsChange({ ...settings });
  }

  function applyCrosshairSettings(): void {
    const thick = Math.max(2, Math.round(settings.crosshairSize * 0.25));
    const dotSize = thick + 1;
    const dotOnlySize = settings.crosshairSize + thick;
    const armOffset = -(settings.crosshairGap + settings.crosshairSize);
    const ringSize = (settings.crosshairGap + settings.crosshairSize) * 2;

    xhair.classList.remove('xh-cross', 'xh-dot', 'xh-ring');
    xhair.classList.add(`xh-${settings.crosshairStyle}`);
    xhair.style.setProperty('--xh-color', settings.crosshairColor);
    xhair.style.setProperty('--xh-size', `${settings.crosshairSize}px`);
    xhair.style.setProperty('--xh-gap', `${settings.crosshairGap}px`);
    xhair.style.setProperty('--xh-thick', `${thick}px`);
    xhair.style.setProperty('--xh-opacity', String(settings.crosshairOpacity));
    xhair.style.setProperty('--xh-dot-size', `${dotSize}px`);
    xhair.style.setProperty('--xh-dot-offset', `${-dotSize / 2}px`);
    xhair.style.setProperty('--xh-dot-only-size', `${dotOnlySize}px`);
    xhair.style.setProperty('--xh-dot-only-offset', `${-dotOnlySize / 2}px`);
    xhair.style.setProperty('--xh-thick-offset', `${-thick / 2}px`);
    xhair.style.setProperty('--xh-arm-offset', `${armOffset}px`);
    xhair.style.setProperty('--xh-ring-size', `${ringSize}px`);
    xhair.style.setProperty('--xh-ring-offset', `${-ringSize / 2}px`);
  }

  function sliderRow(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    fmt: (v: number) => string,
    onInput: (v: number) => void,
  ): void {
    const row = el('div', 'ql-set-row', pausePanel);
    const lab = el('span', undefined, row);
    lab.textContent = label;
    const input = el('input', undefined, row);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const valEl = el('span', 'ql-set-val', row);
    valEl.textContent = fmt(value);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (!isFinite(v)) return;
      valEl.textContent = fmt(v);
      onInput(v);
    });
  }

  function nameRow(): void {
    const row = el('div', 'ql-set-row', pausePanel);
    const lab = el('span', undefined, row);
    lab.textContent = 'NAME';
    const input = el('input', undefined, row);
    input.type = 'text';
    input.maxLength = MAX_PLAYER_NAME_LENGTH;
    input.placeholder = 'Player';
    input.value = settings.playerName;
    const valEl = el('span', 'ql-set-val', row);
    valEl.textContent = `${input.value.length}/${MAX_PLAYER_NAME_LENGTH}`;
    input.addEventListener('input', () => {
      settings = { ...settings, playerName: input.value };
      const normalized = saveAndGetSettings();
      if (input.value !== normalized.playerName) input.value = normalized.playerName;
      valEl.textContent = `${input.value.length}/${MAX_PLAYER_NAME_LENGTH}`;
      cb.onSettingsChange({ ...normalized });
    });
  }

  function crosshairStyleRow(): void {
    const row = el('div', 'ql-set-row', pausePanel);
    const lab = el('span', undefined, row);
    lab.textContent = 'XHAIR';
    const select = el('select', undefined, row);
    for (const style of ['cross', 'dot', 'ring'] as const) {
      const opt = el('option', undefined, select);
      opt.value = style;
      opt.textContent = CROSSHAIR_STYLE_LABELS[style];
    }
    select.value = settings.crosshairStyle;
    const valEl = el('span', 'ql-set-val', row);
    valEl.textContent = CROSSHAIR_STYLE_LABELS[settings.crosshairStyle];
    select.addEventListener('change', () => {
      settings = { ...settings, crosshairStyle: select.value as CrosshairStyle };
      applySettings();
      select.value = settings.crosshairStyle;
      valEl.textContent = CROSSHAIR_STYLE_LABELS[settings.crosshairStyle];
    });
  }

  function crosshairColorRow(): void {
    const row = el('div', 'ql-set-row', pausePanel);
    const lab = el('span', undefined, row);
    lab.textContent = 'COLOR';
    const input = el('input', undefined, row);
    input.type = 'color';
    input.value = settings.crosshairColor;
    const valEl = el('span', 'ql-set-val', row);
    valEl.textContent = settings.crosshairColor.toUpperCase();
    input.addEventListener('input', () => {
      settings = { ...settings, crosshairColor: input.value };
      applySettings();
      input.value = settings.crosshairColor;
      valEl.textContent = settings.crosshairColor.toUpperCase();
    });
  }

  function saveAndGetSettings(): Settings {
    settings = normalizeSettings(settings);
    saveSettings(settings);
    return settings;
  }

  nameRow();
  sliderRow('FOV', 90, 130, 1, settings.fov, (v) => String(Math.round(v)), (v) => {
    settings = { ...settings, fov: clampNumber(Math.round(v), 90, 130) };
    applySettings();
  });
  sliderRow('RENDER SCALE', 50, 100, 5, Math.round(settings.renderScale * 100), (v) => `${Math.round(v)}%`, (v) => {
    settings = { ...settings, renderScale: clampNumber(v / 100, 0.5, 1) };
    applySettings();
  });
  sliderRow('SENSITIVITY', SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_STEP, settings.sensitivity, formatSensitivity, (v) => {
    settings = { ...settings, sensitivity: clampNumber(v, SENSITIVITY_MIN, SENSITIVITY_MAX) };
    applySettings();
  });
  sliderRow('VOLUME', 0, 100, 1, Math.round(settings.volume * 100), (v) => `${Math.round(v)}%`, (v) => {
    settings = { ...settings, volume: clampNumber(v / 100, 0, 1) };
    applySettings();
  });
  crosshairStyleRow();
  crosshairColorRow();
  sliderRow('SIZE', CROSSHAIR_SIZE_MIN, CROSSHAIR_SIZE_MAX, 1, settings.crosshairSize, (v) => String(Math.round(v)), (v) => {
    settings = { ...settings, crosshairSize: clampNumber(Math.round(v), CROSSHAIR_SIZE_MIN, CROSSHAIR_SIZE_MAX) };
    applySettings();
  });
  sliderRow('GAP', CROSSHAIR_GAP_MIN, CROSSHAIR_GAP_MAX, 1, settings.crosshairGap, (v) => String(Math.round(v)), (v) => {
    settings = { ...settings, crosshairGap: clampNumber(Math.round(v), CROSSHAIR_GAP_MIN, CROSSHAIR_GAP_MAX) };
    applySettings();
  });
  sliderRow(
    'OPACITY',
    Math.round(CROSSHAIR_OPACITY_MIN * 100),
    Math.round(CROSSHAIR_OPACITY_MAX * 100),
    5,
    Math.round(settings.crosshairOpacity * 100),
    (v) => `${Math.round(v)}%`,
    (v) => {
      settings = { ...settings, crosshairOpacity: clampNumber(v / 100, CROSSHAIR_OPACITY_MIN, CROSSHAIR_OPACITY_MAX) };
      applySettings();
    },
  );

  const legendEl = el('div', 'ql-legend', pausePanel);
  legendEl.textContent =
    'WASD / left stick move - SPACE / JUMP to bunny hop - MOUSE / drag aim - CLICK / FIRE shoot - TAB / SCORE standings';
  const tipEl = el('div', 'ql-tip', pausePanel);
  tipEl.textContent =
    'Tip: in the air, hold forward + one strafe key and smoothly turn the mouse the same way — you gain speed past 320 ups.';

  // --- match end overlay ----------------------------------------------------
  const endEl = el('div', 'ql-end ql-hidden', root);
  const endPanel = el('div', 'ql-end-panel', endEl);
  const endTitle = el('div', 'ql-end-title', endPanel);
  endTitle.textContent = 'MATCH COMPLETE';
  const podiumEl = el('div', 'ql-podium', endPanel);
  const endTable = el('table', 'ql-table', endPanel);
  const endHead = el('thead', undefined, endTable);
  {
    const tr = el('tr', undefined, endHead);
    for (const [text, cls] of [
      ['#', ''],
      ['PLAYER', ''],
      ['FRAGS', 'num'],
      ['DEATHS', 'num'],
    ] as const) {
      const th = el('th', cls || undefined, tr);
      th.textContent = text;
    }
  }
  const endBody = el('tbody', undefined, endTable);
  const endCount = el('div', 'ql-end-count', endPanel);
  let endTimer: number | null = null;
  let lastEndCountText = '';

  // --- connection screen ----------------------------------------------------
  const connectEl = el('div', 'ql-connect ql-hidden', root);
  const connectText = el('div', 'ql-connect-text', connectEl);

  // --- per-frame stat cache --------------------------------------------------
  const last = {
    clockText: '',
    frags: NaN,
    leaderText: null as string | null,
    cdFrac: -1,
    cdFull: false,
    speed: NaN,
    speedFast: false,
    speedBar: -1,
    ping: NaN,
    alive: true,
    respawnText: '',
  };

  let msgTimer: number | null = null;

  return {
    setStats(s: HudStats): void {
      // clock
      const clockText = formatClock(s.timeLeftMs);
      if (clockText !== last.clockText) {
        last.clockText = clockText;
        clockEl.textContent = clockText;
      }
      // frags
      if (s.frags !== last.frags) {
        last.frags = s.frags;
        fragsNum.textContent = String(s.frags);
      }
      // leader
      const lead = leaderText(s.topEnemyFrags);
      if (lead !== last.leaderText) {
        last.leaderText = lead;
        if (lead === null) {
          leaderEl.classList.add('ql-hidden');
        } else {
          leaderEl.textContent = lead;
          leaderEl.classList.remove('ql-hidden');
        }
      }
      // cooldown
      const frac = cooldownFrac(s.cooldownFrac);
      if (Math.abs(frac - last.cdFrac) > 0.0005) {
        last.cdFrac = frac;
        cdFill.style.transform = `scaleX(${frac.toFixed(4)})`;
      }
      const full = frac >= 1;
      if (full !== last.cdFull) {
        last.cdFull = full;
        if (full) {
          cdEl.classList.add('full');
          // restart the one-shot pulse animation
          cdEl.classList.remove('pulse');
          void cdEl.offsetWidth;
          cdEl.classList.add('pulse');
        } else {
          cdEl.classList.remove('full', 'pulse');
        }
      }
      // speed
      const sp = presentSpeed(s.speed);
      if (sp.value !== last.speed) {
        last.speed = sp.value;
        speedText.textContent = sp.text;
        if (Math.abs(sp.barFrac - last.speedBar) > 0.001) {
          last.speedBar = sp.barFrac;
          speedFill.style.transform = `scaleX(${sp.barFrac.toFixed(4)})`;
        }
        if (sp.fast !== last.speedFast) {
          last.speedFast = sp.fast;
          speedEl.classList.toggle('fast', sp.fast);
        }
      }
      // ping
      const pg = Math.max(0, Math.round(s.ping));
      if (pg !== last.ping) {
        last.ping = pg;
        pingEl.textContent = formatPing(s.ping);
      }
      // death state
      if (s.alive !== last.alive) {
        last.alive = s.alive;
        vignetteEl.classList.toggle('ql-hidden', s.alive);
        respawnEl.classList.toggle('ql-hidden', s.alive);
        if (s.alive) last.respawnText = '';
      }
      if (!s.alive) {
        const t = formatRespawnCountdown(s.respawnInMs);
        if (t !== last.respawnText) {
          last.respawnText = t;
          respawnEl.textContent = t;
        }
      }
    },

    addKill(killerName, killerColorIdx, victimName, victimColorIdx, localInvolved): void {
      const row = el('div', localInvolved ? 'ql-kill me' : 'ql-kill');
      const k = el('span', undefined, row);
      k.textContent = killerName;
      k.style.color = colorHex(killerColorIdx);
      const bolt = el('span', 'ql-bolt', row);
      bolt.textContent = '⚡';
      const v = el('span', undefined, row);
      v.textContent = victimName;
      v.style.color = colorHex(victimColorIdx);
      feedEl.appendChild(row);
      while (feedEl.children.length > 5) feedEl.firstElementChild?.remove();
      window.setTimeout(() => {
        row.classList.add('out');
        window.setTimeout(() => row.remove(), 450);
      }, 4000);
    },

    showMessage(text: string, ms: number): void {
      msgEl.textContent = text;
      msgEl.classList.add('show');
      if (msgTimer !== null) window.clearTimeout(msgTimer);
      msgTimer = window.setTimeout(() => {
        msgEl.classList.remove('show');
        msgTimer = null;
      }, Math.max(0, ms));
    },

    setScoreboardVisible(v: boolean): void {
      scoreEl.classList.toggle('ql-hidden', !v);
    },

    updateScoreboard(rows: ScoreRow[]): void {
      const sorted = sortScoreRows(rows);
      const frag = document.createDocumentFragment();
      for (const r of sorted) {
        const tr = document.createElement('tr');
        if (r.isLocal) tr.className = 'ql-row-local';
        const avTd = el('td', undefined, tr);
        if (r.avatarUrl) {
          const img = el('img', 'ql-av', avTd);
          img.alt = '';
          img.onerror = () => {
            img.replaceWith(fallbackAvatar(r.colorIdx, r.name));
          };
          img.src = r.avatarUrl;
        } else {
          avTd.appendChild(fallbackAvatar(r.colorIdx, r.name));
        }
        const nameTd = el('td', 'ql-name', tr);
        nameTd.textContent = r.name;
        nameTd.style.color = colorHex(r.colorIdx);
        for (const n of [String(r.frags), String(r.deaths), r.afk ? 'AFK' : String(r.ping)]) {
          const td = el('td', 'num', tr);
          td.textContent = n;
        }
        frag.appendChild(tr);
      }
      scoreBody.replaceChildren(frag);
    },

    flash(cssColor: string, durationMs: number): void {
      // a fresh element per call keeps overlapping flashes independent
      const f = el('div', 'ql-flash', root);
      f.style.background = cssColor;
      f.style.transition = `opacity ${Math.max(16, durationMs)}ms ease-out`;
      void f.offsetWidth; // flush so the transition actually runs
      f.style.opacity = '0';
      window.setTimeout(() => f.remove(), durationMs + 150);
    },

    setPauseVisible(v: boolean): void {
      pauseEl.classList.toggle('ql-hidden', !v);
    },

    showMatchEnd(standings, restartInMs): void {
      const sorted = sortStandings(standings);

      podiumEl.replaceChildren();
      const top3 = sorted.slice(0, 3);
      const ranks = ['1ST', '2ND', '3RD'];
      // visual order: 2nd, 1st, 3rd (winner in the middle, raised)
      const order = podiumVisualOrder(top3.length);
      for (const i of order) {
        const s = top3[i];
        if (!s) continue;
        const pod = el('div', `ql-pod ql-pod-${i + 1}`, podiumEl);
        const rank = el('div', 'rank', pod);
        rank.textContent = ranks[i] ?? '';
        const pname = el('div', 'pname', pod);
        pname.textContent = s.name;
        pname.style.color = colorHex(s.colorIdx);
        const pfrags = el('div', 'pfrags', pod);
        pfrags.textContent = String(s.frags);
      }

      const frag = document.createDocumentFragment();
      sorted.forEach((s, i) => {
        const tr = document.createElement('tr');
        const rankTd = el('td', 'num', tr);
        rankTd.textContent = String(i + 1);
        const nameTd = el('td', 'ql-name', tr);
        nameTd.textContent = s.name;
        nameTd.style.color = colorHex(s.colorIdx);
        const fragsTd = el('td', 'num', tr);
        fragsTd.textContent = String(s.frags);
        const deathsTd = el('td', 'num', tr);
        deathsTd.textContent = String(s.deaths);
        frag.appendChild(tr);
      });
      endBody.replaceChildren(frag);

      const endAt = performance.now() + Math.max(0, restartInMs);
      const update = (): void => {
        const text = formatRestartCountdown(endAt - performance.now());
        if (text !== lastEndCountText) {
          lastEndCountText = text;
          endCount.textContent = text;
        }
      };
      if (endTimer !== null) window.clearInterval(endTimer);
      lastEndCountText = '';
      update();
      endTimer = window.setInterval(update, 200);
      endEl.classList.remove('ql-hidden');
    },

    hideMatchEnd(): void {
      if (endTimer !== null) {
        window.clearInterval(endTimer);
        endTimer = null;
      }
      endEl.classList.add('ql-hidden');
    },

    setConnectionMessage(text: string): void {
      document.getElementById('boot')?.remove();
      if (text) {
        connectText.textContent = text;
        connectEl.classList.remove('ql-hidden');
      } else {
        connectEl.classList.add('ql-hidden');
      }
    },

    getSettings(): Settings {
      return { ...settings };
    },
  };
};
