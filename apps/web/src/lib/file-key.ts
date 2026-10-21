export const fileKey = (file: File): string => `${file.name}-${file.size}-${file.lastModified}`;

export function fileExtension(name: string): string | undefined {
  const dot = name.lastIndexOf(".");

  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : undefined;
}

export function fileBasename(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(0, dot) : name;
}
