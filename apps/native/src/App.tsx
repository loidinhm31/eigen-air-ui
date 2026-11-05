import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { EigenAirApp } from "@eigen-air-ui/ui/embed";
import { startAutoConnect } from "@eigen-air-ui/ui";

export default function App() {
  useEffect(() => startAutoConnect(), []);

  return (
    <BrowserRouter>
      <EigenAirApp useRouter={false} />
    </BrowserRouter>
  );
}
