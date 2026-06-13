// ---------------------------------------------------------------------------
// Entry point. Boot order: HUD (so we can show progress) → Discord auth →
// renderer → audio → input → WebSocket join. The game orchestrator is created
// when the server's welcome message arrives; the rAF loop drives it from then
// on. Any boot failure lands on the HUD connection screen.
// ---------------------------------------------------------------------------

import { vortexPortal } from '../../shared/maps/vortexportal';
import { createRenderer } from './render/scene';
import { createHud } from './hud';
import { createAudio } from './audio';
import { initDiscord } from './discord';
import { createInput, type InputSys } from './input';
import { connectNet, type NetClient } from './net';
import { createGame, type Game } from './game';
import type { AudioSys, Hud, Settings } from './types';

async function boot(): Promise<void> {
  const bootEl = document.getElementById('boot');
  let hud: Hud | null = null;

  try {
    const hudRoot = document.getElementById('hud');
    const appRoot = document.getElementById('app');
    if (!hudRoot || !appRoot) throw new Error('Missing #hud / #app containers');

    // input/audio don't exist yet when the HUD is created — late-bind them.
    let input: InputSys | null = null;
    let audio: AudioSys | null = null;

    hud = createHud(hudRoot, {
      onResume: () => {
        // This runs inside a click gesture — the only reliable place to
        // unlock the AudioContext (the pause overlay swallows canvas clicks).
        audio?.resume();
        input?.requestLock();
      },
      onSettingsChange: (s: Settings) => {
        input?.setSensitivity(s.sensitivity);
        audio?.setMasterVolume(s.volume);
        // fov is read from hud.getSettings() every frame by the game.
      },
    });

    hud.setConnectionMessage('Connecting to Discord…');
    const discord = await initDiscord();

    const renderer = createRenderer(vortexPortal, appRoot);
    window.addEventListener('resize', () => renderer.resize());

    audio = createAudio();
    input = createInput(appRoot, {
      onLockChange: (locked) => hud!.setPauseVisible(!locked),
      onScoreboard: (v) => hud!.setScoreboardVisible(v),
      onInteract: () => audio!.resume(),
    });
    const initial = hud.getSettings();
    input.setSensitivity(initial.sensitivity);
    audio.setMasterVolume(initial.volume);

    hud.setConnectionMessage('Joining match…');
    let game: Game | null = null;
    let net: NetClient | null = null;
    // Server rejections (room full / auth failed) arrive BEFORE any welcome
    // and are followed by a close — show them instead of the generic
    // disconnect text.
    let fatalServerError = false;
    // connectNet resolves on socket open; the welcome message that creates
    // the game arrives strictly after (socket messages are macrotasks, the
    // await continuation is a microtask), so `net` is always set by then.
    net = await connectNet(discord, {
      onSnapshot: (snap) => game?.onSnapshot(snap),
      onMessage: (msg) => {
        if (msg.type === 'error' && !game) {
          fatalServerError = true;
          hud!.setConnectionMessage(msg.message);
          return;
        }
        if (msg.type === 'welcome') {
          if (game || !net) return;
          game = createGame({
            net,
            input: input!,
            renderer,
            hud: hud!,
            audio: audio!,
            discord,
            map: vortexPortal,
            welcome: msg,
          });
          bootEl?.remove();
          hud!.setPauseVisible(true); // "click to play" until pointer lock
          if (discord.isMobile) {
            hud!.showMessage('QuakeLite is best played on desktop', 6000);
          }
        } else {
          game?.onServerMsg(msg);
        }
      },
      onDisconnect: () => {
        game?.onDisconnect();
        if (!fatalServerError) {
          hud!.setConnectionMessage('Disconnected from server — reload to rejoin');
        }
      },
    });

    const tick = (now: number): void => {
      requestAnimationFrame(tick);
      game?.frame(now);
    };
    requestAnimationFrame(tick);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (hud) {
      hud.setConnectionMessage(`Failed to start: ${text}`);
      bootEl?.remove();
    } else if (bootEl) {
      bootEl.textContent = `FAILED TO START — ${text}`;
    }
    console.error('[quakelite] boot failed:', err);
  }
}

void boot();
