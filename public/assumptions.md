# Assumptions and review requirements

The source is `260906_백초밥-3.pdf`, page 1. The plan defines many horizontal dimensions but supplies no elevation drawing, material schedule, lighting plan, door schedule or equipment product models. The application is a spatial review model, not construction documentation.

## What is measured

- Units are millimetres. Dimension references are 8,800 mm across and 21,200 mm deep. These are not a rectangular floor shape: the upper facade is diagonal and the upper-left wall has a recess.
- Position comes from vector paths after calibration to dimension lines. Printed dimensions override a conflicting symbol size, while retaining the symbol centre and documenting the difference.
- Interior partition thicknesses are repeatedly dimensioned 100 mm. PDF line rounding produces measured thicknesses of about95–102 mm. The seed retains those measurements rather than moving the traced boundaries to an artificial grid.
- Exterior wall thickness is approximately197 mm from the two drawn lines. It is not explicitly labelled and is consequently less certain.
- Door opening widths come from visible gaps. The three sliding doors are approximately900 mm; the entrance double opening is approximately2027 mm at the outer frame (inner leaf span approximately1969 mm). No source door height is available.
- Bounds are dimension datums. Some external wall solids extend outside them by about200 mm. The floor outline and geometry extents, not just the bounds rectangle, must control floor shape and camera fitting.

## Editable defaults

These are practical visualization defaults, not facts inferred from the PDF. Changing them must update JSON and regenerated 3D consistently. Existing individual objects retain their editable entity heights; changing a default is not evidence that the new value is source-verified.

| Parameter | Default | Status |
|---|---:|---|
| Wall height | 2800 mm | Not specified |
| Ceiling height | 2800 mm | Not specified; no roof/ceiling structure inferred |
| New wall thickness | 100 mm | Based on common dimensioned interior partitions; existing traced walls retain their own thickness |
| Door height | 2100 mm | Not specified |
| General furniture / table height | 750 mm | Not specified |
| Chair overall height | 820 mm | Not specified; parametric review model |
| Built-in bench overall height | 850 mm | Not specified; seat/back construction unknown |
| Standard worktop / sink / undercounter equipment | 850 mm | Not specified |
| Tall refrigerator height | 1900 mm | Not specified |
| Showcase height | 1200 mm | Not specified |
| Dish rack height | 1500 mm | Not specified |
| Self bar / rice bin height | 900 mm | Not specified |
| Kitchen counter-divider height | 1100 mm | Low-divider interpretation only |
| Material preset | warm-neutral | Neutral illustrative palette, not a finish schedule |
| Lighting intensity | 1 | Generic renderer illumination, not a lighting design |

The 900×300 배식대 overlaps an undercounter refrigerator in plan. It is represented at an assumed elevation of850 mm and thickness250 mm so both footprints can coexist. This elevation and thickness require human review. The seed stores entity `z` separately from height.

## Known differences and ambiguity

1. Four tables against the long bench are labelled1200×750 mm but drawn approximately1250×705 mm. The model uses750 mm across and1200 mm down the plan, centred on each source symbol. This preserves the explicit dimensions and exposes the discrepancy for review.
2. Two cooking/worktop units are labelled600×750 mm but their vector footprint is approximately600×700 mm. The seed uses the printed values at the original centres.
3. The two diagonal facade segments look like a thin framed/glazed frontage. The source does not label glass, wall construction, sill height or head height. They are review-needed facade wall volumes; `windows` remains empty. A glass finish should be a user decision.
4. One line along the west side of the private dining rooms does not have a clearly dimensioned paired wall line. It is represented as a50 mm lining with confidence0.55. It may be a built-in finish or cabinet edge rather than a full wall.
5. Kitchen dividers and the kitchen top partition have no height information. Some may be counter backs instead of full-height partitions. Their source footprints are visible; the 3D vertical interpretation is provisional.
6. Three square envelope projections are treated as column-like objects. Their structural function and height are unconfirmed.
7. The two enclosed dining-room names and the corridor name are inferred descriptions. 주방, 화장실, 다용도실 and 슬라이딩도어 are visible source labels.
8. Two circular symbols are interpreted as washbasins on counter footprints. Precise fixture types need review. Toilet fixtures or internal cubicle walls are not added because they are not shown.
9. The 퇴식대 label is difficult to read; its600×600 footprint is clear. Under-counter refrigeration is inferred from the T냉장 label and surrounding layout; actual product construction is unknown.
10. Chair positions and outlines were traced from72 symbols. A plan symbol is not a manufacturer-verified footprint. Bench capacity is not specified; the model must not claim72 is the total restaurant seating capacity.
11. Equipment nameplates and wall-shelf labels do not provide elevation details. Most shelf/counter combinations are a single review volume. Clearances above counters, ventilation routing and service access are not reconstructed.
12. The title block reads2026.08, while the filename begins260906. Both are preserved without inventing a document revision date.

## Confidence semantics

Confidence is an editable review indicator for footprint and semantic interpretation, not a statistical guarantee. A0.98 table confidence means its label and footprint are strongly supported; its750 mm height remains assumed. Values0.85 and above can be displayed green,0.60–0.84 yellow, and below0.60 red. Manually edited geometry should use source `manual` and remain distinguishable from the seed. No color replaces approval of the complete plan.

## Automation boundary

The bundled sample is a vector-grounded, visually reviewed seed. It is not proof of universal automatic extraction. An arbitrary uploaded PDF may lack vectors, dimension labels, scale consistency or usable Unicode text. Such uploads must retain their source preview, expose a draft JSON, and require manual calibration/correction where evidence is absent. Never substitute this restaurant's seed for an unrelated uploaded plan merely because both are PDFs.

The full-page PDF overlay is calibrated by an explicit affine transformation in JSON. Imported PDFs require their own calibration; arbitrary user editing of a source screenshot is not a replacement for a measured scale.

No paid external service, invented product CAD, hidden floor, roof, plumbing, ventilation, electrical system or structural engineering judgement is required for this MVP.

## Renderer conventions

- The floor slab is a schematic 100 mm thick layer below z=0; it does not represent structural construction.
- No ceiling mesh is generated, to keep the interior visible. Ceiling height is metadata.
- Door/window panels are schematic translucent review geometry and do not assert glazing or product materials.
- Source wall fragments are normalized into continuous supports. Openings cut the explicitly associated support at their current position and height. Any generated material above an opening is a schematic, unverified lintel.
- Front looks from the bottom edge of the drawing (+drawing Y); Back looks from the top; Left/Right follow drawing X. These are coordinate views, not named building facades.
- JSON uses mm; glTF/GLB coordinates use metres as required by glTF.
- Changing geometry changes source to manual and caps footprint confidence at 0.50, while retaining originalSource/originalConfidence and the source measurements.
- New chair default is 800 mm, while traced source chairs use 820 mm; both heights are editable assumptions.

## Continuous wall and lintel assumptions

For door editing,24 source wall fragments are normalized to19 continuous supports with explicit wallId associations. Current door positions create current apertures; moved/deleted doors do not leave permanently stored old gaps. The main entrance uses its approximately2027 mm frame gap instead of the1969 mm inner leaf span; the toilet uses its approximately901 mm jamb gap instead of the874 mm leaf extent. sourceLeafRectangle preserves the earlier source measurements for audit.

The vertical material above each door is schematic: a2800 mm wall with a2100 mm door creates a700 mm lintel. Its existence, material and structural capacity are not established by this plan. A full-height opening can be modeled by making its height equal the wall height.3D top images project the lintel while2D plan footprints omit above-door material.

Moving a door onto another wall requires selecting that wall or automatic association. Moving it away from every wall produces a freestanding door and must not silently carve an unrelated wall. Intersecting perpendicular walls require separate review when relocating openings across wall junctions.
