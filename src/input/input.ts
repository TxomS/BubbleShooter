import { LAUNCH_X, LAUNCH_Y } from '../game/config';
import type { Point } from '../game/grid';
import type { Game } from '../game/state';

/**
 * One control scheme for mouse, touch and keyboard.
 *  - Mouse: move to aim, click to shoot.
 *  - Touch: touch and drag to aim, lift to shoot. Drag back below the launcher to cancel.
 *  - Keyboard: left/right arrows aim, space or enter shoots.
 */
export class Input {
  private down = false;

  constructor(
    canvas: HTMLCanvasElement,
    private game: Game,
    private toLogical: (clientX: number, clientY: number) => Point,
    private onGesture: () => void,
    /** False while the menu is up, so stray taps and keys can't fire shots at an invisible board. */
    private enabled: () => boolean = () => true,
  ) {
    canvas.addEventListener('pointerdown', (e) => {
      this.onGesture();
      if (!this.enabled()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.down = true;
      try {
        canvas.setPointerCapture(e.pointerId); // keep receiving moves if the finger drifts off the canvas
      } catch {
        // Not fatal: aiming still works while the pointer stays over the canvas.
      }
      this.aimAt(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled()) return;
      if (e.pointerType === 'mouse' || this.down) this.aimAt(e);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!this.down) return;
      this.down = false;
      if (this.aimAt(e)) this.game.fire();
    });
    canvas.addEventListener('pointercancel', () => {
      this.down = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      this.onGesture();
      if (!this.enabled()) return;
      const step = e.shiftKey ? 0.1 : 0.035;
      if (e.key === 'ArrowLeft') this.game.setAngle(this.game.angle + step);
      else if (e.key === 'ArrowRight') this.game.setAngle(this.game.angle - step);
      else if (e.key === ' ' || e.key === 'Enter') this.game.fire();
      else return;
      e.preventDefault();
    });
  }

  /** Point the launcher at the pointer. Returns false if the pointer is below the launcher (no valid shot). */
  private aimAt(e: PointerEvent): boolean {
    const p = this.toLogical(e.clientX, e.clientY);
    const dx = p.x - LAUNCH_X;
    const dy = LAUNCH_Y - p.y;
    if (dy < 14) return false;
    this.game.setAngle(Math.atan2(dy, dx));
    return true;
  }
}
