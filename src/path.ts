export const joinQueryPath = (parentPrefix: string, path): string => {
  if (!parentPrefix) return path;
  return parentPrefix + "." + path;
};

export const normalizeQueryPath = (path: string) => {
  return path.replace(/\[\]/g, "");
};

export function isSubPathOf(subst: string, string: string): boolean {
  if (string === subst || subst === "") return true;
  const indexOf = string.indexOf(subst);
  if (indexOf !== 0) return false;
  const nextChar = string[subst.length];
  if (nextChar === ".") return true;
  return false;
}
