# Floor plan analysis: 260906_백초밥-3.pdf

## Source and method
The only architectural source is `260906_백초밥-3.pdf`, one portrait page, 841.68 × 1190.64 PDF points. The title block visibly reads 식당 / 평면도, scale 1/80, date 2026.08. The filename date is different and is preserved without attempting to reconcile it.

PyMuPDF rendered the full page at 3× and detailed upper/lower crops at 4–5×. Vector paths and text spans were extracted. There are 2,034 drawing paths. Korean text extraction is corrupted because the PDF's text encoding does not map reliably to Unicode; labels and dimension strings were therefore visually read in the rendered page and compared with vector rectangles. Many dimensions and TABLE labels are vector outlines and absent from extracted text. No OCR-only geometry was used.

## Dimension calibration
The source marks 8,800 mm between page x=261.84 and x=573.60 and 21,200 mm between page y=162.00 and y=913.20. Using top-left plan datum at the intersection (261.84, 162.00):

- x_mm = (x_pdf − 261.84) × 28.226840.
- y_mm = (y_pdf − 162.00) × 28.221512.
- The x/y scale difference is 0.019%, consistent with PDF coordinate rounding.
- Bottom chained widths: 3,900 + 100 + 1,180 + 100 + 3,520 = 8,800 mm.
- Right chained depths: 12,200 + 100 + 6,750 + 100 + 1,950 + 100 = 21,200 mm.
- Left chained depths visibly read 12,824 + 100 + 2,653 + 100 + 2,653 + 100 + 2,670 + 100 = 21,200 mm.

The coordinate datum is a drawing dimension datum, not an occupied floor corner. The upper facade is diagonal. A rectangular 8.8×21.2 m room would be materially wrong. Exterior wall strokes extend roughly 197 mm outside the left/right/bottom dimension references. The source has a stepped/recessed upper left boundary.

## Confirmed plan content
- Diagonal upper frontage, double-leaf swing entry, long left/right envelope, lower envelope.
- Open dining area, two enclosed lower-left dining rooms with three labeled sliding doors, lower-left 화장실, lower-right 주방 and bottom-right 다용도실.
- Dining tables: sixteen 1000×750 mm tables (eight adjacent pairs) and four left bench-side tables visibly labeled 1200×750 mm. The latter vector rectangles measure about 1250×705 mm, a drawing/label discrepancy; label dimensions take priority and the discrepancy must remain reviewable.
- Loose chair symbols and one long left-wall bench labeled W VAR × D500. The source symbols imply 72 loose chairs; bench capacity is not dimensioned.
- Labeled kitchen equipment includes sinks, work counters with wall shelves, undercounter refrigerators, 45-box freezer/refrigerator 1280×750, showcase 500×450 units, fryer/work counter, dishwasher 750×750, rice storage 845×500, and ice maker 350×600.
- Interior partitions are repeatedly dimensioned 100 mm. Furniture and equipment footprint dimensions are frequently printed explicitly.

## Inference and uncertainty
- Height, ceiling height, door height, furniture height, material, finish and lighting are not specified. Defaults must be documented in assumptions.md and remain editable.
- The diagonal multi-line facade plausibly represents glazing; its construction, glass extent, sill and head heights are not explicitly labeled. Model it as review-needed frontage, not confirmed windows.
- Table positions are vector-grounded. Furniture heights, chair size and material are provisional.
- Room names for the two dining rooms are semantic labels, not source text.
- The 화장실 room is labeled, with two basin-like circular plumbing symbols visible across that room and corridor. Do not invent toilets, cubicle partitions or concealed services absent from the drawing.
- Extraction provides an initial reviewed seed for this specific source. It does not establish reliable universal semantic recognition for arbitrary PDFs.

## Representation contract
JSON is the sole model source. Units are mm. Entity x/y is the top-left of the unrotated rectangle; z is elevation; width/depth/height are extents; rotation is clockwise in plan around the rectangle center. The full page overlay uses the same affine transform. `floorOutline` is a polygon, since bounds alone cannot represent this footprint. Walls, doors, windows, zones and objects are separate arrays. Entities carry confidence, source and notes; confidence concerns footprint/semantic evidence and never validates an assumed height.



## Seed inventory and visual verification

The initial vector trace contains24 wall rectangles. The final editable seed normalizes them into19 continuous wall supports, with6 door openings,7 zones and125 objects. The object counts are 20 tables, 72 loose chairs, 1 bench, 6 refrigerators/freezers, 5 sinks/basin counters, 4 showcases, 7 counters/worktops/dividers, 2 shelves/racks, 1 dishwasher, 1 fryer, 1 cooking range, 1 ice maker, 1 rice bin and 3 column-like projections. Kitchen units with wall shelves are represented by one footprint; unverified shelf geometry is not added separately. The 배식대 overlaps an undercounter refrigerator in plan; the JSON treats it as a shelf at an assumed elevation of 850 mm instead of placing two solids at floor level.

The source uses six doors: one diagonal double swing entrance, three explicitly labeled sliding doors, one toilet swing door and one utility room swing door. Model wall segments are interrupted at these openings. Door rectangles encode closed-position openings; original swing arcs remain available on the PDF overlay. No windows are asserted because the diagonal frontage is not explicitly identified as glazing.

Every loose chair was localized from a distinctive six-segment backrest vector path and the union of its twelve consecutive vector subpaths. This yields exactly 72 chair symbols. The chair model preserves the measured footprint and its orientation; its 820 mm height is assumed.

A diagnostic render drew each JSON rectangle back onto the PDF using the inverse calibration, with walls red, doors green and objects blue. Visual inspection confirmed that the source outlines align across the complete page, including the diagonal entrance, six table clusters in the open hall, both dining rooms, kitchen equipment and basin counters. Printed-dimension corrections create small intentional differences for the four bench tables and the two 600×750 worktops. This is a geometry check, not a claim that inferred heights, room names or construction types have been verified.

The nominal bounds describe the dimension references. Exterior wall solids may extend up to approximately 200 mm beyond those bounds, and the diagonal frontage is a pair of rotated rectangles around its door opening. Camera fitting and exports must calculate the geometry bounding box, not simply assume all geometry is inside the nominal bounds.

## Equipment footprint inventory

All heights below are assumptions. The JSON retains vector path indices and PDF-point sourceBounds for audit.

| Entity | Printed / adopted footprint (mm) | Evidence / review |
|---|---:|---|
| Standard dining tables ×16 | 1000×750 | Printed, vector agreement within rounding |
| Bench-side tables ×4 | 1200×750 | Printed prioritized; drawn symbol about 1250×705 |
| Long built-in bench | variable width ×500 | Depth printed; approximately6500 mm length from vectors |
| 45박스 냉동냉장고 | 1280×750 | Printed and vector-grounded |
| T냉장 벽선반 | 1500×750 | Printed, rotated footprint along east wall |
| T냉장 1/2 4칸 | 1200×750 | Printed |
| T냉장 units ×3 | 900×750 | Printed; worktop-style refrigerator meaning inferred from abbreviation |
| Sinks | 900×750 ×2, 600×600 ×1 | Printed |
| Basin counters ×2 | vector-derived | Basin-like circular symbols; no printed footprint |
| 3단 작업대 | 900×600, 1200×600, 1200×750 | Printed |
| 3단 작업대 and fryer worktop | 600×750 each | Printed prioritized; vector depth about700 |
| 간택기 / 닥트 | 900×750 | Label read visually; hood height/route absent |
| 세척기 | 750×750 | Printed |
| 제빙기 | 350×600 | Printed |
| 쇼케이스 ×4 | 500×450 | Printed |
| 셀프바 / 상부2단선반 | 900×750 | Printed footprint; shelf height unknown |
| 배식대 | 900×300 | Printed; overlaps undercounter fridge in plan |
| 퇴식대 | 600×600 | Label reading uncertain; needs review |
| 3말 쌀통 | 845×500 | Printed |

## Explicit defaults for review

- Wall / ceiling height:2800 mm; new-wall thickness:100 mm. Existing walls keep traced thicknesses (interior partitions approximately100 mm, exterior approximately197 mm, one uncertain private-room lining50 mm).
- Door height:2100 mm. Opening widths are measured rather than assumed:sliding doors about900 mm, main entry frame aperture about2027 mm (its leaf-only span was about1970 mm).
- General furniture/table height:750 mm; chairs820 mm overall; bench850 mm overall. These are low-poly review volumes, not manufacturer assets or confirmed elevations.
- Standard counters/sinks/cooking equipment/undercounter refrigerators:850 mm; tall refrigerator1900 mm; showcases1200 mm; dish rack1500 mm; self bar900 mm; rice bin900 mm; counter dividers1100 mm. All editable.
- Material preset:warm-neutral; lighting intensity:1. No finish schedule or electrical/lighting plan was supplied.
- The plant symbol in the top-right corner is decorative and is not modeled. Unseen plumbing, electrical, ventilation, roof, suspended ceiling, toilet fixtures and structural properties are not invented.

## Extraction limitations

This seed is a source-specific extraction reviewed against vector geometry and rendered labels. A general upload flow must disclose its draft nature, require calibration when a reliable dimension pair is absent, keep the PDF overlay visible for correction, and avoid presenting unverified room/equipment classification as confirmed. Raster-only PDFs do not expose these vector paths. Text extraction corruption means language labels cannot safely drive automatic classification on this source without visual review.

## Final normalization for movable door openings

The final JSON uses19 continuous wall supports instead of the initial24 separately traced segments. Four support groups were normalized: the private-room/toilet east wall (three door openings), the private-room divider, the utility north wall and the entire diagonal facade. Their doors reference the appropriate support through wallId. Openings are subtracted procedurally from the current JSON, so moving/deleting a door refills its previous location. The original PDF-derived wall outlines remain unchanged outside the openings apart from sub-millimetre common-axis normalization.

The main entrance aperture now uses the gap between facade frame segments:2027.3577 mm. The initial1969.1 mm value measured the leaf hinge line inside the facade. Its original rectangle is preserved in sourceLeafRectangle. The opening centre moves approximately100.9 mm to the facade support axis; this changes aperture semantics rather than the observed doorway location. The toilet aperture similarly uses its jamb-to-jamb gap900.8307 mm, replacing the873.7 mm leaf extent. Original leaf data is retained. The other four door openings retain their traced locations and dimensions, with their depths centred on the exact supporting wall thickness.

A continuous2800 mm wall above a2100 mm opening creates a700 mm lintel in3D. No lintel height or construction appears in the source. This is an explicit, editable schematic assumption; opening height can equal wall height to represent a full-height opening. The2D plan should omit above-door wall sections while a3D top projection may show their top surfaces.

The normalized seed was tested against the application's actual scene.ts getWallSegments function:24 assertions covered all6 doors, confirming the opening centre is clear, the assumed lintel exists, deletion refills the old opening and an along-wall move refills its old leading edge. The computed floor-level wall pieces were rendered over the source PDF and visually inspected for full-page alignment.

The bench local axes are also corrected to width6500/depth500/rotation270 around the same footprint centre, so its backrest follows the west wall without changing its traced position or footprint. Reproduce the raw trace with extract_sample.py, then apply merge_door_walls.py; see continuous-wall-mapping.md for the exact source-coordinate mapping.
