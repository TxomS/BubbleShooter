import type { Sound } from '../audio/sound';
import { savePrefs } from '../storage/scores';
import { $, openDialog } from './dialog';

type Channel = 'music' | 'sfx';

/**
 * The settings dialog: Music and Sound effects, each with its own on/off switch
 * and volume slider. The two are independent, so music can play with the sound
 * effects off, and the other way round.
 */
export class Settings {
  private dlg = $<HTMLDialogElement>('dlg-settings');
  private listeners = new Set<() => void>();

  private rows: Record<Channel, { sw: HTMLInputElement; range: HTMLInputElement; out: HTMLElement }> = {
    music: { sw: $('sw-music'), range: $('rg-music'), out: $('out-music') },
    sfx: { sw: $('sw-sfx'), range: $('rg-sfx'), out: $('out-sfx') },
  };

  constructor(private sound: Sound) {
    for (const ch of ['music', 'sfx'] as const) {
      const { sw, range } = this.rows[ch];
      const on = ch === 'music' ? 'musicOn' : 'sfxOn';

      sw.addEventListener('change', () => {
        this.sound.unlock();
        this.sound.apply({ [on]: sw.checked });
        savePrefs({ [on]: sw.checked });
        this.paint();
      });

      range.addEventListener('input', () => {
        const v = Number(range.value) / 100;
        this.sound.apply({ [ch]: v });
        savePrefs({ [ch]: v });
        this.paint();
      });
      // On release, play a sample so you can hear the level you picked.
      range.addEventListener('change', () => {
        this.sound.unlock();
        this.sound.preview(ch);
      });
    }
    this.sync();
  }

  /** Called whenever a setting changes (so the HUD speaker button can follow). */
  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  get sfxOn(): boolean {
    return this.sound.settings.sfxOn;
  }

  /** The speaker button in the game: sound effects on or off. Music has its own switch here. */
  setSfxOn(on: boolean) {
    this.sound.unlock();
    this.sound.apply({ sfxOn: on });
    savePrefs({ sfxOn: on });
    this.paint();
  }

  open(stack = false) {
    this.sync();
    openDialog(this.dlg, stack);
  }

  /** Make the controls show the sound's current settings. */
  sync() {
    const a = this.sound.settings;
    this.rows.music.sw.checked = a.musicOn;
    this.rows.music.range.value = String(Math.round(a.music * 100));
    this.rows.sfx.sw.checked = a.sfxOn;
    this.rows.sfx.range.value = String(Math.round(a.sfx * 100));
    this.paint(false);
  }

  private paint(notify = true) {
    const a = this.sound.settings;
    const on: Record<Channel, boolean> = { music: a.musicOn, sfx: a.sfxOn };
    for (const ch of ['music', 'sfx'] as const) {
      const { sw, range, out } = this.rows[ch];
      const v = Number(range.value);
      sw.checked = on[ch];
      range.style.setProperty('--pct', `${v}%`);
      range.disabled = !on[ch];
      out.textContent = `${v}%`;
      sw.closest('.setting')?.classList.toggle('off', !on[ch]);
    }
    if (notify) for (const fn of this.listeners) fn();
  }
}
