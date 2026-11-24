import { MODE_IDS, MODES, type ModeDef, type ModeId } from '../game/modes';
import { CLUSTER_L, ORB_STYLES, SPRITE_L, paintCluster, paintOrb } from '../render/sprites';
import { $ } from './dialog';

export type MenuScreen = 'main' | 'modes';

export interface MenuActions {
  /** Start a fresh run of a mode, from its first level. */
  play(mode: ModeId): void;
  openLeaderboard(): void;
  openSettings(): void;
  openHelp(): void;
}

/** The title screen and the mission list (Easy to Impossible, then Endless). */
export class Menu {
  private root = $('menu');
  private screens: Record<MenuScreen, HTMLElement> = {
    main: $('screen-main'),
    modes: $('screen-modes'),
  };
  private current: MenuScreen = 'main';

  constructor(private actions: MenuActions) {
    $('m-play').addEventListener('click', () => this.show('modes'));
    $('m-top').addEventListener('click', () => this.actions.openLeaderboard());
    $('m-help').addEventListener('click', () => this.actions.openHelp());
    $('m-settings').addEventListener('click', () => this.actions.openSettings());

    for (const b of this.root.querySelectorAll<HTMLElement>('[data-back]')) b.addEventListener('click', () => this.show('main'));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.visible && this.current === 'modes' && !document.querySelector('dialog[open]')) this.show('main');
    });

    // Built once: every mission is always available, so there is nothing to refresh.
    $('mode-list').replaceChildren(...MODE_IDS.map((id) => this.modeCard(MODES[id])));
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(screen: MenuScreen = 'main') {
    this.root.hidden = false;
    this.current = screen;
    for (const [name, el] of Object.entries(this.screens)) el.hidden = name !== screen;
    const target = this.screens[screen].querySelector<HTMLElement>(screen === 'main' ? '.big-btn.primary' : '.mode-card');
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }

  hide() {
    this.root.hidden = true;
  }

  private modeCard(mode: ModeDef): HTMLElement {
    const style = ORB_STYLES[mode.planet];

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'mode-card';
    card.style.setProperty('--c', style.base);
    card.setAttribute('aria-label', `${mode.name}. ${mode.tagline}`);

    const px = Math.round(56 * Math.min(window.devicePixelRatio || 1, 2));
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const ctx = cv.getContext('2d')!;
    if (mode.icon === 'cluster') {
      ctx.scale(px / CLUSTER_L, px / CLUSTER_L);
      paintCluster(ctx);
    } else {
      ctx.scale(px / SPRITE_L, px / SPRITE_L);
      paintOrb(ctx, style, SPRITE_L / 2, SPRITE_L / 2);
    }

    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'm-name';
    name.textContent = mode.name;
    const desc = document.createElement('span');
    desc.className = 'm-desc';
    desc.textContent = mode.tagline;
    text.append(name, desc);

    card.append(cv, text);
    card.addEventListener('click', () => this.actions.play(mode.id));
    return card;
  }
}
