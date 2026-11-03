/**
 * Exporter registrations.
 *
 * Each exporter is self-contained and registered, so adding a format (a
 * punchcard sheet, a DAK file, a PDF chart) means adding one entry here and
 * touching nothing else (CLAUDE.md 3.3).
 *
 * `scope` is 'panel' (the whole finished piece) or 'tile' (just the repeat,
 * letting silver-reed-write do the tiling from patternConfig).
 */

import { registerExporter } from '../core/registry.js';
import {
  mdiCheckerboard, mdiCodeJson, mdiPackageVariantClosed, mdiImageOutline,
  mdiPrinterOutline, mdiTextBoxOutline, mdiContentSaveOutline,
} from '../icons.js';
import { expandPanel, serialize } from '../model/project.js';
import { decompose, buildPayload, buildKnittingPlan } from './silverreed.js';
import {
  colorPNG, monoPNG, previewPNG, download, downloadJSON, downloadText, safeName,
} from './png.js';

const EXPORTERS = [
  {
    id: 'srw-mono-png',
    icon: mdiCheckerboard,
    label: '1-bit PNG for silver-reed-write',
    order: 10,
    description:
      'The needle-selection image. White takes the contrast feeder. One pixel ' +
      'per stitch - do not resize it.',
    async run(project, { scope = 'panel' } = {}) {
      const { bits } = decompose(project, scope);
      download(await monoPNG(bits), `${safeName(project.name)}-${scope}-1bit.png`);
    },
  },

  {
    id: 'srw-json',
    icon: mdiCodeJson,
    label: 'silver-reed-write JSON',
    order: 20,
    description:
      'bitmap + per-row yarn pairs + patternConfig, matching that project’s types.',
    run(project, { scope = 'panel' } = {}) {
      downloadJSON(buildPayload(project, scope), `${safeName(project.name)}.srw.json`);
    },
  },

  {
    id: 'srw-bundle',
    icon: mdiPackageVariantClosed,
    label: 'Full machine bundle',
    order: 30,
    description:
      'Everything needed at the machine: 1-bit PNG, JSON, color reference and ' +
      'a plain-text knitting plan.',
    async run(project, { scope = 'panel' } = {}) {
      const base = safeName(project.name);
      const { bits } = decompose(project, scope);
      const grid = scope === 'tile' ? project.tile : expandPanel(project);

      download(await monoPNG(bits), `${base}-${scope}-1bit.png`);
      download(await colorPNG(grid, project.palette), `${base}-${scope}-color.png`);
      downloadJSON(buildPayload(project, scope), `${base}.srw.json`);
      downloadText(buildKnittingPlan(project, scope), `${base}-plan.txt`);
    },
  },

  {
    id: 'color-png',
    icon: mdiImageOutline,
    label: 'Color chart PNG',
    order: 40,
    description: 'One pixel per stitch, in the design colors. For reference and sharing.',
    async run(project, { scope = 'panel' } = {}) {
      const grid = scope === 'tile' ? project.tile : expandPanel(project);
      download(
        await colorPNG(grid, project.palette),
        `${safeName(project.name)}-${scope}-color.png`
      );
    },
  },

  {
    id: 'chart-png',
    icon: mdiPrinterOutline,
    label: 'Printable chart (8x)',
    order: 50,
    description: 'Scaled-up color chart for printing. Never feed this to the machine.',
    async run(project, { scope = 'tile' } = {}) {
      const grid = scope === 'tile' ? project.tile : expandPanel(project);
      download(
        await previewPNG(grid, project.palette, 8),
        `${safeName(project.name)}-${scope}-chart.png`
      );
    },
  },

  {
    id: 'plan-txt',
    icon: mdiTextBoxOutline,
    label: 'Knitting plan (text)',
    order: 60,
    description: 'Row-by-row threading changes, counted from the cast-on edge.',
    run(project, { scope = 'panel' } = {}) {
      downloadText(buildKnittingPlan(project, scope), `${safeName(project.name)}-plan.txt`);
    },
  },

  {
    id: 'project-json',
    icon: mdiContentSaveOutline,
    label: 'Project file (backup)',
    order: 70,
    description: 'The whole document including palette. Re-importable here.',
    run(project) {
      // .knitproj, not .knitproj.json: an OS registers only the last
      // extension, and the installed app opens these on a double-click.
      downloadJSON(serialize(project), `${safeName(project.name)}.knitproj`);
    },
  },
];

export function registerBuiltinExporters() {
  for (const exporter of EXPORTERS) registerExporter(exporter);
}
