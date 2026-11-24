export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const anyDialogOpen = (): boolean => !!document.querySelector('dialog[open]');

/**
 * Opens a modal dialog. Normally it refuses if another one is already up, so a
 * timer can't stack a "level cleared" box on top of a pause menu. Pass `stack`
 * when the new dialog is opened from the one underneath (pause -> settings).
 */
export function openDialog(d: HTMLDialogElement, stack = false): boolean {
  if (d.open) return false;
  if (!stack && anyDialogOpen()) return false;
  d.showModal();
  return true;
}
