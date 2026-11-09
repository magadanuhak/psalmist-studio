let counter = 0;
export function uid(): string {
  const r = Math.random().toString(36).slice(2, 8);
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${counter.toString(36)}${r}`;
}
