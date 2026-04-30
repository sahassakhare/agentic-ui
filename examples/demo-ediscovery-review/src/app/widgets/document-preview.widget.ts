import { agenticWidget } from '@maverick/agentic-ui';
import { z } from 'zod';
import { DocumentPreviewComponent } from './document-preview.component';

export const documentPreviewWidget = agenticWidget({
  name: 'documentPreview',
  component: DocumentPreviewComponent,
  propsSchema: z.object({
    documentId: z.string(),
    fileName: z.string(),
    custodianId: z.string(),
    authoredBy: z.string(),
    authoredAt: z.string(),
    contentSnippet: z.string(),
    tags: z.array(z.string()),
    privilegeReason: z.string().nullable(),
  }),
});
