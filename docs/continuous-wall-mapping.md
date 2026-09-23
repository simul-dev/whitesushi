# Continuous-wall normalization for editable openings

`floorplan-continuous.json` is generated from the current root `floorplan.json`; the floor outline, calibration, settings and source metadata are preserved. A second correction rotates the bench local axes270 degrees around its unchanged footprint centre, so its parametric backrest follows the west wall. `merge_door_walls.py` is a source-specific reproducible transform, not an arbitrary-PDF inference algorithm.

The sample changes from24 wall entities to19. All6 door IDs are unchanged. The four wall supports below are continuous rectangles; holes are derived from their associated doors, using the existing `getWallSegments` function. Thus moving or deleting a door removes its prior hole instead of leaving a historical gap in the JSON wall arrangement.

| Continuous support | Replaces | PDF coordinate extent / endpoints | Associated doors |
|---|---|---|---|
| `wall-private-east-continuous` | `wall-private-east-a`, `wall-private-east-b`, `wall-private-east-c`, `wall-toilet-east` | rectangle400.08,619.92 →403.44,909.60 | `door-private-1`, `door-private-2`, `door-toilet` |
| `wall-private-divider` | `wall-private-divider-a`, `wall-private-divider-b` | rectangle286.56,713.76 →400.08,717.36 | `door-private-link` |
| `wall-utility-top` | prior `wall-utility-top`, extended across its doorway | rectangle445.44,836.88 →573.60,840.48 | `door-utility` |
| `wall-facade-continuous` | `wall-facade-west`, `wall-facade-east` | axis280.08,352.32 →573.60,162.00; assumed100 mm thickness | `door-entry` |

All PDF coordinates map through the existing calibration (28.2268411599 mm/pt x,28.2215122471 mm/pt y, datum261.84,162). The diagonal source segment angles differ by roughly0.018 degrees due to PDF path rounding. The new common line preserves the outer endpoints; source-segment deviations are below approximately1 mm.

## Opening rectangle corrections

The previous entry rectangle described the swung door-leaf hinge line, approximately100.9 mm inside the facade's outer support axis. It therefore did not robustly intersect a100 mm-thick continuous wall. The new `door-entry` represents the actual aperture between the two facade segments: source gap endpoints411.12,267.36 and471.36,228.24, projected onto the common frontage axis. Aperture width is2027.3577 mm instead of the previous1969.1 mm leaf measurement. Neither width is explicitly labelled in the PDF; both are vector measurements with different meanings. The old leaf rectangle remains in `sourceLeafRectangle` metadata.

The toilet's opening is between the wall jambs at source y815.04 and846.96. The previous leaf-based entity began at816.00. The corrected aperture width is900.8307 mm instead of873.7 mm. Its original leaf rectangle also remains in `sourceLeafRectangle` metadata. This avoids an invented27 mm wall nub where the door jamb connects to the toilet top wall.

Door depths are matched to the supporting wall thickness (94.8422 mm on the private/corridor wall;101.5974 mm on the two horizontal dividers;100 mm on the facade). The other four openings retain their prior measured locations and widths, with only sub-millimetre centering adjustments. Visible wall source outlines outside the openings are preserved.

## Vertical assumptions

Continuous walls plus2100 mm door heights beneath2800 mm walls imply700 mm lintels. The source plan contains no elevation or lintel detail. Each merged wall and corrected door records this as an explicit schematic assumption. Full-height unheaded openings remain possible in reality. The user can make an opening full height by editing its height to the wall height.

There is no need to add a second hidden wall representation: the normalized wall rectangles and door objects in exported JSON are the complete source of truth. Do not merge again at render time.

## Rendering and editing implications

- The existing3D `getWallSegments` supports this JSON directly. Door deletion refills the entire prior opening; door movement along its wall cuts at the new position.
- The2D SVG should derive the plan-level wall pieces too. For each segment returned by `getWallSegments`, include it only if its bottom `segment.y - segment.height /2` is at or below the chosen plan cut elevation (e.g.1 mm or1000 mm), then apply the wall rotation. Otherwise a full continuous wall would still show behind a door symbol. Exclude lintels from the2D wall footprints.
- Top-view3D projection naturally sees the assumed lintels. This is a projection of the model, whereas the2D plan is a wall cut; keep the difference clear.
- Moving a door to another wall requires changing `wallId` or choosing auto-detection; an explicit association restricts the opening to its selected support. Moving it away from every support leaves a freestanding door, which should be reviewed rather than silently carving an unrelated wall.
- On this sample, a moved door can intersect a perpendicular wall at a junction. The explicit association intentionally avoids cutting that perpendicular wall. Users must adjust intersecting geometry when making that structural change.

## Reproduction

```powershell
python merge_door_walls.py --input floorplan.json --output floorplan-continuous.json
```

Use the transform immediately after the source-specific extraction script, or fold the same mapping into that extraction script. The SHA-256 source guard rejects unrelated drawings.

## Verification

The external `validate-continuous.mjs` imported the application's actual `scene.ts` and ran24 passing assertions across the6 openings: clear centre, assumed lintel present, deletion refills the old opening, and a300 mm along-wall movement refills the former leading edge. Its computed floor-level wall footprints were overlaid on the PDF in `continuous-geometry-qa.png`; full-page visual inspection confirmed preserved alignment and all6 correct apertures.
