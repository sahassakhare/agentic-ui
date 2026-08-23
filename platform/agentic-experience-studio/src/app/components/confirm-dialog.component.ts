import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

/** Content for a confirm dialog. Opened via {@link ConfirmService}. */
export interface ConfirmData {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Style the confirm button as destructive (maps the button's primary → --danger). */
  readonly danger?: boolean;
}

/**
 * A themed replacement for the native `confirm()` — first Angular Material
 * adoption per docs/material-adoption.md (overlays). MatDialog reads the M3
 * system tokens remapped to the Studio tokens, so it matches the Studio in both
 * themes with no extra styling.
 */
@Component({
  selector: 'aes-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content><p class="msg">{{ data.message }}</p></mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="close(false)">{{ data.cancelLabel ?? 'Cancel' }}</button>
      <button matButton="filled" [class.danger]="data.danger" (click)="close(true)" cdkFocusInitial>
        {{ data.confirmLabel ?? 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .msg { margin:0; color:var(--text-muted); font-size:var(--fs-sm); line-height:1.55; max-width:46ch; }
    /* Destructive confirm: retint the filled button's primary to the Studio danger token. */
    button.danger { --mat-sys-primary: var(--danger); --mat-sys-on-primary: #fff; }
  `],
})
export class ConfirmDialogComponent {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ConfirmDialogComponent, boolean>);
  protected close(result: boolean): void { this.ref.close(result); }
}
