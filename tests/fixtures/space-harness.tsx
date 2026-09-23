import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SpaceWorkspace } from "../../src/modules/space/ui";
import { createSamplePlan } from "../../src/modules/space/sample";
import type { FloorPlan } from "../../src/modules/space";
import "../../src/styles.css";

const first = createSamplePlan();
const second = createSamplePlan(); // Deliberately same name, different document.
second.objects = second.objects.slice(1);

function Harness() {
  const [document, setDocument] = useState(0);
  const [snapshot, setSnapshot] = useState<FloorPlan>();
  return <>
    <button onClick={() => setDocument(1)}>다른 문서 열기</button>
    <button onClick={() => { if (snapshot) snapshot.objects.length = 0; }}>콜백 사본 변경</button>
    <output data-testid="snapshot-count">{snapshot?.objects.length}</output>
    <SpaceWorkspace key={document} initialPlan={document ? second : first} onPlanChange={setSnapshot} />
  </>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Harness /></React.StrictMode>);
