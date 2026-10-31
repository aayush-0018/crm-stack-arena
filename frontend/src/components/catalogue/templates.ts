import { ComponentType, lazy } from 'react';
import type { CatalogueTemplate, PublicCatalogue } from '../../types';

/**
 * Every catalogue design. To add one: build a component that takes { cat }, add its key here and to the
 * CHECK on catalogues.template (a migration) and to CATALOGUE_TEMPLATES in the backend.
 */
export const CATALOGUE_TEMPLATES: Record<CatalogueTemplate, { label: string; description: string; Component: ComponentType<{ cat: PublicCatalogue }> }> = {
  classic: {
    label: 'Classic',
    description: 'A printed-booklet look: cover with your logo, contents, a section per category, and your stores at the back.',
    // Loaded only on the catalogue page, so its styles never touch the rest of the app.
    Component: lazy(() => import('./ClassicCatalogue')),
  },
};
