export function sanitizePathText(input: string): string {
  if (!input) return "";

  // 1. Quoted paths (single or double): "C:\...", '/home/...'
  let res = input.replace(/["'](?:[a-zA-Z]:[\\/]|\\\\|\/)[^"'\r\n]+["']/g, "[redacted-path]");

  // 2. Windows UNC paths: \\server\share\path...
  res = res.replace(/\\\\[^\s\\/:"*?<>|]+(?:\\[^\s\\/:"*?<>|]+)+/g, "[redacted-path]");

  // 3. Windows drive paths: C:\Program Files\App...
  res = res.replace(/[a-zA-Z]:(?:\\[^\r\n\\/:"*?<>|]+)+/g, (match: string) => {
    // Strip trailing English connectors (e.g. " or ...", " and ...") if spaces were consumed
    const clean = match.replace(/\s+(?:or|and|on|at|with|in)\s+.*$/i, "");
    return clean ? "[redacted-path]" : match;
  });

  // 4. Unix absolute paths: /home/user, /var/log/app, /Volumes/Storage/models
  res = res.replace(/(^|[\s("':])(?:\/[a-zA-Z0-9_.~-]+)+/g, "$1[redacted-path]");

  return res;
}

export function isValidOpaqueRootId(rootId: string | null | undefined): boolean {
  if (typeof rootId !== "string" || rootId.trim().length === 0) {
    return false;
  }
  // An opaque root ID must not be a filesystem path (no slashes, backslashes, colons, or traversal)
  if (rootId.includes("/") || rootId.includes("\\") || rootId.includes("..") || rootId.includes(":")) {
    return false;
  }
  return true;
}
