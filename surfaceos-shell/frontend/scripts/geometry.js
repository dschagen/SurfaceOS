export const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

export function rectangleBetween(a, b) {
  return {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
  };
}

export function moveWithinCanvas(rect, dx, dy) {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, 1 - rect.width),
    y: clamp(rect.y + dy, 0, 1 - rect.height),
  };
}

export function resizeWithinCanvas(rect, dx, dy, minWidth = 0.12, minHeight = 0.1) {
  return {
    ...rect,
    width: clamp(rect.width + dx, minWidth, 1 - rect.x),
    height: clamp(rect.height + dy, minHeight, 1 - rect.y),
  };
}

export function contains(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height;
}
