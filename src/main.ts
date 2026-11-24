import '@fontsource-variable/space-grotesk';
import './style.css';
import { Sound } from './audio/sound';
import type { ModeId } from './game/modes';
import { Game } from './game/state';
import { Input } from './input/input';
import { Renderer } from './render/renderer';
import { LocalScoreStore, loadPrefs, savePrefs } from './storage/scores';
import { anyDialogOpen } from './ui/dialog';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { Settings } from './ui/settings';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const prefs = loadPrefs();
const store = new LocalScoreStore();

const game = new Game();
const renderer = new Renderer(canvas, game);
const sound = new Sound({ musicOn: prefs.musicOn, music: prefs.music, sfxOn: prefs.sfxOn, sfx: prefs.sfx });
const settings = new Settings(sound);

// 'menu': title and mission screens over a drifting nebula. 'game': the board and HUD.
let scene: 'menu' | 'game' = 'menu';

const hud = new Hud(game, store, settings, { quit: leaveGame }, prefs.name);
const menu = new Menu({
  play: (mode) => startGame(mode),
  openLeaderboard: () => hud.showLeaderboard(loadPrefs().lastMode),
  openSettings: () => settings.open(),
  openHelp: () => hud.showHelp(),
});

game.on((e) => sound.handle(e));

new Input(
  canvas,
  game,
  (x, y) => renderer.toLogical(x, y),
  () => sound.unlock(),
  () => scene === 'game',
);

// Audio can only start after a tap or key press, and the menu has no canvas to tap.
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => sound.unlock(), { capture: true });
document.addEventListener('click', (e) => {
  if ((e.target as Element | null)?.closest?.('button')) sound.click();
});

// Esc during a game opens the pause menu (inside a dialog, Esc closes it as usual).
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && scene === 'game' && !anyDialogOpen()) hud.pauseGame();
});

/** Always a fresh run from the first level, whether or not that mode was finished before. */
function startGame(mode: ModeId) {
  scene = 'game';
  savePrefs({ lastMode: mode });
  menu.hide();
  hud.setVisible(true);
  layout(); // the HUD has a height now, so the board can fit below it
  renderer.setScene('game');
  game.newGame(mode, 1);
  if (!loadPrefs().seenHelp) hud.showHelp();
}

function leaveGame() {
  scene = 'menu';
  hud.setVisible(false);
  renderer.setScene('menu');
  menu.show('main');
}

function layout() {
  renderer.resize(hud.bottom());
}
layout();
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);
// Re-measure once the web font has loaded (it can change the HUD's height slightly).
void document.fonts?.ready.then(layout);

menu.show('main');

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // The game stands still while the menu is up or any dialog (pause, settings, results) is open.
  if (scene === 'game' && !anyDialogOpen()) game.update(dt);
  renderer.frame(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev-only hooks for poking at the game from the browser console. `step` advances
// the simulation and drawing by hand, which is handy when the tab is throttled.
if (import.meta.env.DEV) {
  const step = (frames = 1, dt = 1 / 60) => {
    for (let i = 0; i < frames; i++) {
      if (scene === 'game') game.update(dt);
      renderer.frame(dt);
    }
  };
  Object.assign(window, { game, renderer, step, menu, startGame, sound });
}
