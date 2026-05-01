import { agenticWidget } from '@maverick/agentic-ui';
import { z } from 'zod';
import { RedactionEditorComponent } from './redaction-editor.component';

export const redactionEditorWidget = agenticWidget({
  name: 'redactionEditor',
  component: RedactionEditorComponent,
  propsSchema: z.object({
    documentId: z.string(),
    fileName: z.string(),
    page: z.number().int().min(1),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    reason: z.string(),
    allRedactions: z.array(
      z.object({
        page: z.number(),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        reason: z.string(),
      }),
    ),
  }),
});
