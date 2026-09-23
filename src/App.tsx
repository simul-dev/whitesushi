import { SpaceWorkspace } from "./modules/space/ui";
import SimulatorApp from "./product/SimulatorApp";

export default function App() {
  return new URLSearchParams(window.location.search).get("workspace") === "space" ? <SpaceWorkspace /> : <SimulatorApp />;
}
