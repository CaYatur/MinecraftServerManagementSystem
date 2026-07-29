/**
 * Glyphs for the things drawn on the map (#136).
 *
 * SVG path data rather than images: a canvas can build a `Path2D` from a path
 * string, so the same drawing serves the desktop's canvas, the two web canvases
 * and any HTML legend — one definition, no asset to ship, and it scales without
 * blurring the way a bitmap marker would.
 *
 * Every path is authored in a 24x24 box so a caller can scale by `size / 24`
 * and place it by its centre without knowing anything about the shape.
 */

export const ICON_BOX = 24

export interface MapIcon {
  /** SVG path data, filled with the marker colour. */
  path: string
  /** The dot behind the glyph. */
  colour: string
  /** For a legend, a tooltip, and anything that cannot draw. */
  label: string
}

/**
 * Deliberately simple silhouettes.
 *
 * A marker is drawn at about 16 device pixels across; anything with interior
 * detail turns to mud at that size, so each one is a single filled outline that
 * reads as a shape rather than as a picture.
 */
export const STRUCTURE_ICONS: Record<string, MapIcon> = {
  // A house: gable roof over a body with a door.
  village: {
    colour: '#e3b341',
    label: 'Village',
    path: 'M12 3 L22 11 L19.5 11 L19.5 21 L13.8 21 L13.8 14.5 L10.2 14.5 L10.2 21 L4.5 21 L4.5 11 L2 11 Z'
  },
  // A chest: lid, body, and a clasp.
  dungeon: {
    colour: '#b5504f',
    label: 'Dungeon or ruin',
    path: 'M3 7 H21 V11 H13.2 V13 H10.8 V11 H3 Z M3 12.6 H10.8 V14.6 H13.2 V12.6 H21 V20 H3 Z'
  },
  // A stepped pyramid.
  temple: {
    colour: '#c58bd6',
    label: 'Temple',
    path: 'M12 3 L16 8 H14 L18 13.5 H15.5 L21 20 H3 L8.5 13.5 H6 L10 8 H8 Z'
  },
  // A keep with battlements.
  fortress: {
    colour: '#c99a6a',
    label: 'Fortress',
    path: 'M3 6 H6 V8.5 H9 V6 H12 V8.5 H15 V6 H18 V8.5 H21 V6 H21 V20 H14 V15 H10 V20 H3 Z'
  },
  // A pickaxe.
  mine: {
    colour: '#9aa0a6',
    label: 'Mineshaft',
    path: 'M3.5 7.5 C8 4 16 4 20.5 7.5 L19 9.6 C15 6.9 9 6.9 5 9.6 Z M11 9.5 H13 L13.6 21 H10.4 Z'
  },
  // A marker pin, for anything unrecognised.
  other: {
    colour: '#6fa8dc',
    label: 'Structure',
    path: 'M12 2 C8.1 2 5 5.1 5 9 C5 14.2 12 22 12 22 C12 22 19 14.2 19 9 C19 5.1 15.9 2 12 2 Z M12 11.6 A2.6 2.6 0 1 1 12 6.4 A2.6 2.6 0 1 1 12 11.6 Z'
  }
}

export function iconFor(kind: string): MapIcon {
  return STRUCTURE_ICONS[kind] ?? STRUCTURE_ICONS.other
}

/**
 * The same glyph as standalone SVG, for a legend or a list.
 *
 * Deliberately does NOT call `iconFor`, and reads the table through a name the
 * pages also define. Both web pages embed this by stringifying it, and a
 * stringified function that calls another only works while the bundler leaves
 * the callee's name alone — the failure is a `ReferenceError` in the page with
 * nothing wrong in the source it was compiled from (#116).
 */
export function iconSvg(kind: string, size = 16): string {
  const table = STRUCTURE_ICONS
  const ic = table[kind] ?? table.other
  return (
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true">' +
    '<path d="' + ic.path + '" fill="' + ic.colour + '"/></svg>'
  )
}
