import { MODE_IDS, MODES, type ModeId } from '../game/modes';
import { rankFor } from '../game/score';
import type { Game, GameEvent } from '../game/state';
import { ORB_STYLES, SPRITE_L, paintOrb } from '../render/sprites';
import { savePrefs, type ScoreStore } from '../storage/scores';
import { $, anyDialogOpen, openDialog } from './dialog';
import type { Settings } from './settings';

export interface HudActions {
  /** Leave the run and go back to the menu. */
  quit(): void;
}

type ResultKind = 'lost' | 'complete';

/** Score, rank, buttons and dialogs. Everything that is HTML rather than canvas lives here. */
export class Hud {
  private el = {
    hud: $('hud'),
    modeLabel: $('mode-label'),
    score: $('score'),
    best: $('best'),
    rankName: $('rank-name'),
    rankFill: $('rank-fill'),
    levelLabel: $('level-label'),
    toast: $('toast'),
    sound: $<HTMLButtonElement>('btn-sound'),
    help: $<HTMLDialogElement>('dlg-help'),
    top: $<HTMLDialogElement>('dlg-top'),
    topTabs: $('top-tabs'),
    topList: $('top-list'),
    topEmpty: $('top-empty'),
    clear: $<HTMLButtonElement>('btn-clear'),
    pause: $<HTMLDialogElement>('dlg-pause'),
    over: $<HTMLDialogElement>('dlg-over'),
    overTitle: $('over-title'),
    overScore: $('over-score'),
    overMeta: $('over-meta'),
    overNote: $('over-note'),
    overNameWrap: $('over-name-wrap'),
    overName: $<HTMLInputElement>('over-name'),
    overAgain: $<HTMLButtonElement>('over-again'),
    win: $<HTMLDialogElement>('dlg-win'),
    winBonus: $('win-bonus'),
    winNext: $('win-next'),
    restart: $<HTMLDialogElement>('dlg-restart'),
  };

  private shown = 0; // score currently displayed (animates towards game.score)
  private tween = 0;
  private pending = 0; // timer for delayed win / game-over dialogs
  private clearArmed = 0;
  private topMode: ModeId = 'endless';
  private result: { kind: ResultKind; level: number; score: number } = { kind: 'lost', level: 1, score: 0 };

  constructor(
    private game: Game,
    private store: ScoreStore,
    private settings: Settings,
    private actions: HudActions,
    name: string,
  ) {
    this.el.overName.value = name;
    this.buildLegend();
    this.buildTabs();
    this.setSoundButton();
    settings.onChange(() => this.setSoundButton());

    $('btn-restart').addEventListener('click', () => this.askRestart());
    // The speaker is the sound-effects switch. Music has its own switch in Settings, so it keeps playing.
    this.el.sound.addEventListener('click', () => this.settings.setSfxOn(!this.settings.sfxOn));
    $('btn-settings').addEventListener('click', () => this.settings.open());
    $('btn-menu').addEventListener('click', () => this.pauseGame());
    $('p-settings').addEventListener('click', () => this.settings.open(true));
    $('p-help').addEventListener('click', () => openDialog(this.el.help, true));
    this.el.clear.addEventListener('click', () => this.clearScores());

    this.el.pause.addEventListener('close', () => {
      const quit = this.el.pause.returnValue === 'quit';
      this.el.pause.returnValue = '';
      if (quit) this.leave();
    });
    this.el.restart.addEventListener('close', () => {
      if (this.el.restart.returnValue === 'restart') this.game.newGame();
      this.el.restart.returnValue = '';
    });
    this.el.help.addEventListener('close', () => savePrefs({ seenHelp: true }));

    // The win and game-over dialogs are decisions, not something to Esc away.
    for (const d of [this.el.win, this.el.over]) d.addEventListener('cancel', (e) => e.preventDefault());
    this.el.win.addEventListener('close', () => {
      const choice = this.el.win.returnValue;
      this.el.win.returnValue = '';
      if (choice === 'menu') this.leave();
      else this.game.nextLevel();
    });
    this.el.over.addEventListener('close', () => {
      const choice = this.el.over.returnValue;
      this.el.over.returnValue = '';
      this.saveResult();
      if (choice === 'menu') this.leave();
      else this.game.newGame(this.game.mode.id, this.result.kind === 'lost' && this.game.mode.levels ? this.result.level : 1);
    });

    game.on((e) => this.onEvent(e));
  }

  /** Bottom edge of the HUD in CSS pixels: the board fits below it. */
  bottom(): number {
    return this.el.hud.getBoundingClientRect().bottom;
  }

  setVisible(visible: boolean) {
    this.el.hud.hidden = !visible;
  }

  showHelp() {
    openDialog(this.el.help);
  }

  pauseGame() {
    if (this.game.phase === 'won' || this.game.phase === 'lost') return;
    openDialog(this.el.pause);
  }

  showLeaderboard(mode: ModeId) {
    this.topMode = mode;
    this.renderTop();
    openDialog(this.el.top);
  }

  private leave() {
    window.clearTimeout(this.pending);
    this.actions.quit();
  }

  private setSoundButton() {
    const on = this.settings.sfxOn;
    this.el.sound.setAttribute('aria-pressed', String(on));
    this.el.sound.setAttribute('aria-label', on ? 'Sound effects on' : 'Sound effects off');
    this.el.sound.title = on ? 'Sound effects on' : 'Sound effects off';
  }

  private onEvent(e: GameEvent) {
    const mode = this.game.mode;
    switch (e.type) {
      case 'score':
        this.setScore(e.score, e.delta === 0);
        break;
      case 'level': {
        window.clearTimeout(this.pending);
        const cfg = mode.config(e.level);
        this.el.modeLabel.textContent = mode.name;
        this.el.levelLabel.textContent = mode.levels ? `Level ${e.level}/${mode.levels}` : `Wave ${e.level}`;
        this.updateRank();
        this.el.best.textContent = Math.max(this.store.best(mode.id), this.game.score).toLocaleString();
        if (mode.levels) this.toast(`Level ${e.level}`, `${mode.name} · ${cfg.colors} planets`);
        else if (e.level > 1) this.toast(`Wave ${e.level}`, `${cfg.colors} planets`);
        break;
      }
      case 'rankUp':
        this.toast('Rank up', e.rank.name);
        break;
      case 'won':
        if (e.endless) {
          this.toast('Board cleared', `+${e.bonus.toLocaleString()}`);
        } else if (e.final) {
          this.later(() => this.showResult('complete', this.game.score, e.level), 1300);
        } else {
          this.later(() => this.showWin(e.level, e.bonus), 1300);
        }
        break;
      case 'lost':
        this.later(() => this.showResult('lost', e.score, e.level), 1300);
        break;
      default:
        break;
    }
  }

  /** Runs `fn` after a pause, waiting for any other dialog to close first. Does nothing if the run was restarted meanwhile. */
  private later(fn: () => void, ms: number) {
    window.clearTimeout(this.pending);
    const attempt = () => {
      if (this.game.phase !== 'won' && this.game.phase !== 'lost') return;
      if (anyDialogOpen()) {
        this.pending = window.setTimeout(attempt, 250);
        return;
      }
      fn();
    };
    this.pending = window.setTimeout(attempt, ms);
  }

  // ---- score / rank -----------------------------------------------------------

  private setScore(score: number, immediate: boolean) {
    const best = Math.max(this.store.best(this.game.mode.id), score);
    this.el.best.textContent = best.toLocaleString();
    this.updateRank();
    window.cancelAnimationFrame(this.tween);
    if (immediate) {
      this.shown = score;
      this.el.score.textContent = score.toLocaleString();
      return;
    }
    this.el.score.classList.remove('bump');
    void this.el.score.offsetWidth;
    this.el.score.classList.add('bump');
    const from = this.shown;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      this.shown = Math.round(from + (score - from) * (1 - (1 - k) ** 3));
      this.el.score.textContent = this.shown.toLocaleString();
      if (k < 1) this.tween = requestAnimationFrame(step);
    };
    this.tween = requestAnimationFrame(step);
  }

  private updateRank() {
    const info = rankFor(this.game.score);
    this.el.rankName.textContent = info.rank.name;
    this.el.rankFill.style.width = `${Math.round(info.progress * 100)}%`;
  }

  private toast(title: string, sub = '') {
    const t = this.el.toast;
    t.querySelector('b')!.textContent = title;
    t.querySelector('span')!.textContent = sub;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }

  // ---- dialogs ----------------------------------------------------------------

  private askRestart() {
    if (this.game.score === 0 && this.game.phase === 'aiming' && this.game.misses === 0) {
      this.game.newGame();
      return;
    }
    openDialog(this.el.restart);
  }

  private showWin(level: number, bonus: number) {
    this.el.winBonus.textContent = `+${bonus.toLocaleString()}`;
    this.el.winNext.textContent = `Next up: Level ${level + 1} of ${this.game.mode.levels}`;
    openDialog(this.el.win);
  }

  /** Game over (`lost`) or the last level of a mission cleared (`complete`). Both end the run and may make the leaderboard. */
  private showResult(kind: ResultKind, score: number, level: number) {
    const mode = this.game.mode;
    const info = rankFor(score);
    const qualifies = this.store.qualifies(mode.id, score);
    this.result = { kind, level, score };

    this.el.overTitle.textContent = kind === 'complete' ? 'Mission complete!' : 'Signal lost';
    this.el.overScore.textContent = score.toLocaleString();
    const where = mode.levels ? `Level ${level}/${mode.levels}` : `Wave ${level}`;
    this.el.overMeta.textContent = `${mode.name} · ${info.rank.name} · ${where}`;
    this.el.overNote.textContent =
      score > this.store.best(mode.id) && score > 0 ? 'New personal best!' : qualifies ? 'You made the leaderboard!' : '';
    this.el.overNameWrap.hidden = !qualifies;
    this.el.overAgain.textContent = kind === 'lost' && mode.levels ? `Retry level ${level}` : 'Play again';
    openDialog(this.el.over);
  }

  private saveResult() {
    const { score, level } = this.result;
    const mode = this.game.mode.id;
    if (!this.store.qualifies(mode, score)) return;
    const name = this.el.overName.value.trim() || 'Pilot';
    this.store.add(mode, { name, score, level, date: Date.now() });
    savePrefs({ name });
  }

  private buildTabs() {
    this.el.topTabs.replaceChildren(
      ...MODE_IDS.map((id) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.role = 'tab';
        b.textContent = MODES[id].name;
        b.dataset.mode = id;
        b.addEventListener('click', () => {
          this.topMode = id;
          this.renderTop();
        });
        return b;
      }),
    );
  }

  private renderTop() {
    const mode = this.topMode;
    for (const b of this.el.topTabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));

    const campaign = MODES[mode].levels !== null;
    const list = this.store.top(mode);
    this.el.topList.replaceChildren(
      ...list.map((entry) => {
        const li = document.createElement('li');
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = entry.name;
        const sec = document.createElement('span');
        sec.className = 'sec';
        sec.textContent = `${campaign ? 'L' : 'W'}${entry.level}`;
        const pts = document.createElement('span');
        pts.className = 'pts';
        pts.textContent = entry.score.toLocaleString();
        li.append(nm, sec, pts);
        return li;
      }),
    );
    this.el.topEmpty.hidden = list.length > 0;
    this.el.clear.hidden = list.length === 0;
    this.el.clear.dataset.armed = '';
    this.el.clear.textContent = 'Clear scores';
    window.clearTimeout(this.clearArmed);
  }

  /** Two taps to wipe a mode's leaderboard, so it can't be done by accident. */
  private clearScores() {
    if (this.el.clear.dataset.armed === '1') {
      this.store.clear(this.topMode);
      this.renderTop();
      this.setScore(this.game.score, true);
      return;
    }
    this.el.clear.dataset.armed = '1';
    this.el.clear.textContent = 'Tap again to confirm';
    window.clearTimeout(this.clearArmed);
    this.clearArmed = window.setTimeout(() => {
      this.el.clear.dataset.armed = '';
      this.el.clear.textContent = 'Clear scores';
    }, 3000);
  }

  /** The "six planets" strip in the help dialog, drawn with the same code as the game. */
  private buildLegend() {
    const legend = $('legend');
    const px = Math.round(48 * Math.min(window.devicePixelRatio || 1, 2));
    for (const style of ORB_STYLES) {
      const fig = document.createElement('figure');
      const cv = document.createElement('canvas');
      cv.width = cv.height = px;
      const ctx = cv.getContext('2d')!;
      ctx.scale(px / SPRITE_L, px / SPRITE_L);
      paintOrb(ctx, style, SPRITE_L / 2, SPRITE_L / 2);
      const cap = document.createElement('figcaption');
      cap.textContent = style.name;
      fig.append(cv, cap);
      legend.append(fig);
    }
  }
}
