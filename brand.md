# Brand — FullTime

_Status: deferred_

The user chose to defer formal brand setup. Preserve the existing FullTime
palette, typography, spacing, imagery, and voice; do not treat this deferred
file as permission to replace them with defaults. The
`frontend-design-guidelines` skill will not prompt again.

To set up a real brand palette, typography, and voice at any time, run:

    /brand-design

or say: "pick brand colors"

When `brand-design` runs, it will detect this deferred state, skip the "confirm
overwrite" step, and proceed directly to the full brand setup. The resulting
palette will be applied to `apps/web/app/globals.css` and this file will be
replaced with the real brand documentation.

_Deferred at: 2026-07-13T00:00:00+01:00_
