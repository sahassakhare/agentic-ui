import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent, type ConfirmData } from '../components/confirm-dialog.component';

/**
 * Opens a themed confirm dialog and resolves to the user's choice — the
 * app-wide replacement for the native `confirm()`. Returns a Promise so it drops
 * into both async flows and `CanDeactivate` guards.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  ask(data: ConfirmData): Promise<boolean> {
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmData, boolean>(ConfirmDialogComponent, {
      data,
      width: '440px',
      maxWidth: '92vw',
      autoFocus: 'dialog',
      restoreFocus: true,
    });
    return new Promise((resolve) => ref.afterClosed().subscribe((v) => resolve(v === true)));
  }
}
