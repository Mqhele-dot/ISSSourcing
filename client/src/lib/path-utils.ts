/** Strip query string from a path or full location string (wouter passes path+query together). */
export function pathWithoutQuery(path: string): string {
  const i = path.indexOf("?");
  return i === -1 ? path : path.slice(0, i);
}
