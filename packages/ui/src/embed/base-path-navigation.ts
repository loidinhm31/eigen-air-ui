import { createContext, useContext } from "react";
import { useNavigate, type NavigateOptions } from "react-router-dom";

export const BasePathContext = createContext<string>("");

function normalizeBasePath(basePath?: string): string {
  if (!basePath) return "";
  return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
}

export function resolveBasePath(basePath?: string): string {
  return normalizeBasePath(basePath);
}

export function useBasePathNavigation() {
  const basePath = useContext(BasePathContext);
  const rawNavigate = useNavigate();

  const to = (path: string) => {
    if (!basePath) return path;
    if (path === "" || path === "/") return basePath;
    return `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
  };

  const navigate = (pathOrDelta: string | number, options?: NavigateOptions) => {
    if (typeof pathOrDelta === "number") {
      rawNavigate(pathOrDelta);
      return;
    }
    rawNavigate(to(pathOrDelta), options);
  };

  return { basePath, to, navigate };
}
