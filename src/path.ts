export const joinQueryPath = (parentPrefix: string, path): string => {
	if (!parentPrefix) return path;
	return parentPrefix + "." + path;
};

export const normalizeQueryPath = (path: string) => {
	return path.replace(/\[\]/g, "");
};
