/**
 * Calculators menu: one row per garment calculator (ui/calculators.js), each
 * opening the Calculators dialog on its tab. Sits between Library and Export.
 */

import { registerMenu } from '../../core/registry.js';
import { mdiCalculator } from '../../icons.js';
import { h } from '../dom.js';
import { menuItem } from '../menu.js';
import { CALCULATORS, openCalculator } from '../calculators.js';

function build(api) {
  return h(
    'div',
    {},
    ...CALCULATORS.map((c) =>
      menuItem({
        icon: c.icon,
        label: c.label,
        note: c.title,
        onclick: () => {
          api.close();
          openCalculator(c.id);
        },
      })
    )
  );
}

registerMenu({
  id: 'calculators',
  label: 'Calculators',
  title: 'Size the panel for a garment from body measurements',
  icon: mdiCalculator,
  order: 15,
  build,
});
