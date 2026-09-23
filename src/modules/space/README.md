# Space module

기존 FloorPlan v1 문서는 이 모듈이 소유한다. 공개 데이터 API와 UI는 서로 다른 진입점을 사용한다.

- `index.ts`: pure data/validation/editing/geometry API. No worker, React or WebGL initialization.
- `ui.ts`: `SpaceWorkspace({ initialPlan?, onPlanChange? })`. Without props, the original sample workflow is unchanged.
- `sample.ts`: explicit bundled fixture; not part of the pure API.
- `layout.ts`: `toStoreLayout(plan, options)` derives core geometry and explicit operating assignments without modifying FloorPlan; observed chair count is not confirmed capacity.
- `browser.ts`: browser-only download helper, excluded from the pure data graph.
- `pdfImport.ts`: browser PDF API (`openPdf`, `calibratePage`); owns the PDF.js worker configuration.
- `exports.ts`: browser GLB/GLTF/PNG/ZIP exports.

`initialPlan` is validated and cloned once at mount. `onPlanChange` receives a detached snapshot, including undo/redo and imports. It does not own selection, undo history or review approval. Do not feed a callback snapshot back into a remount on every edit. When intentionally switching documents, use a different React `key`; this resets the entire editing session, including same-name documents. Future workflow navigation should keep the editor mounted to preserve session state.

The root `src/styles.css` remains the existing shared visual style sheet. This extraction changes ownership/import paths, not styling or document schema. Core/analysis code must consume the pure public API or StoreLayout adapter, never React components or Three objects.

The application checkpoint bridge is `src/application/spaceProject.ts`. It retains the complete original document separately, registers new layout revisions, and leaves a scenario's pinned older layout unchanged. It is not auto-save or a new Wizard UI. Unknown operating mappings remain explicit issues; a deleted support wall becomes an unresolved association in the projection while the original document remains untouched.
