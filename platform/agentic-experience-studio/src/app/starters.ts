/**
 * Starter templates — governed, ready-to-clone capability bodies that solve the
 * blank-canvas problem. An author picks one; the Studio creates a new draft
 * capability from its body and drops them into the matching designer to refine.
 *
 * Scoped to self-contained kinds (forms, pages) whose bodies carry no external
 * capability references, so a cloned starter is always valid with no unmet deps.
 */
export interface StarterTemplate {
  readonly id: string;
  readonly kind: 'form' | 'page';
  readonly title: string;
  readonly description: string;
  /** Material icon ligature (self-hosted font). */
  readonly icon: string;
  readonly glyph: string;
  /** Base for the generated capability name (a short unique suffix is appended). */
  readonly nameBase: string;
  readonly body: Record<string, unknown>;
}

/** Which list route owns a starter's kind, for post-clone navigation to its designer. */
export const STARTER_ROUTE: Readonly<Record<StarterTemplate['kind'], string>> = {
  form: 'forms',
  page: 'pages',
};

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  // ── Forms ──────────────────────────────────────────────────────────────────
  {
    id: 'contact-form', kind: 'form', title: 'Contact form', icon: 'mail', glyph: '✉',
    description: 'Name, email and message — the classic intake form.',
    nameBase: 'contact-form',
    body: {
      description: 'Contact form',
      schema: {
        fields: [
          { name: 'name', label: 'Full name', type: 'text', required: true },
          { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'message', label: 'Message', type: 'textarea', required: true },
        ],
      },
    },
  },
  {
    id: 'feedback-form', kind: 'form', title: 'Feedback form', icon: 'star', glyph: '★',
    description: 'A rating plus free-text comments — quick sentiment capture.',
    nameBase: 'feedback-form',
    body: {
      description: 'Feedback form',
      schema: {
        fields: [
          { name: 'rating', label: 'Rating', type: 'select', required: true, options: ['1', '2', '3', '4', '5'] },
          { name: 'comments', label: 'Comments', type: 'textarea' },
        ],
      },
    },
  },
  {
    id: 'signup-form', kind: 'form', title: 'Signup form', icon: 'person_add', glyph: '⊕',
    description: 'Name, email, organization and a role selector.',
    nameBase: 'signup-form',
    body: {
      description: 'Signup form',
      schema: {
        fields: [
          { name: 'fullName', label: 'Full name', type: 'text', required: true },
          { name: 'email', label: 'Work email', type: 'email', required: true },
          { name: 'org', label: 'Organization', type: 'text' },
          { name: 'role', label: 'Role', type: 'select', options: ['Admin', 'Editor', 'Viewer'] },
        ],
      },
    },
  },
  // ── Pages ──────────────────────────────────────────────────────────────────
  {
    id: 'two-column-page', kind: 'page', title: 'Two-column page', icon: 'view_column', glyph: '▥',
    description: 'A content page with left and right regions ready to fill.',
    nameBase: 'two-column-page',
    body: { title: 'Two-column page', type: 'content', layout: 'two-column', regions: { left: [], right: [] }, access: { personas: [], scopes: [] } },
  },
  {
    id: 'sidebar-page', kind: 'page', title: 'Sidebar page', icon: 'view_sidebar', glyph: '▦',
    description: 'Main content with a right-hand sidebar region.',
    nameBase: 'sidebar-page',
    body: { title: 'Sidebar page', type: 'content', layout: 'sidebar-right', regions: { main: [], aside: [] }, access: { personas: [], scopes: [] } },
  },
  {
    id: 'dashboard-grid-page', kind: 'page', title: 'Dashboard grid', icon: 'dashboard', glyph: '▤',
    description: 'A three-cell grid layout for a metrics dashboard.',
    nameBase: 'dashboard-page',
    body: { title: 'Dashboard', type: 'content', layout: 'grid', regions: { a: [], b: [], c: [] }, access: { personas: [], scopes: [] } },
  },
];
