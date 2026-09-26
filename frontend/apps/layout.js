// Helpers for building widget rectangles in window-local normalized coordinates.

export function rect(x, y, width, height) {
  return { x, y, width, height };
}

export function inset(area, dx, dy = dx) {
  return rect(area.x + dx, area.y + dy, area.width - 2 * dx, area.height - 2 * dy);
}

// Splits an area into a rows x cols grid. cell(row, col, rowSpan, colSpan) returns one rectangle.
export function grid(area, rows, cols, gapX = 0.015, gapY = gapX) {
  const cellW = (area.width - gapX * (cols - 1)) / cols;
  const cellH = (area.height - gapY * (rows - 1)) / rows;
  return (row, col, rowSpan = 1, colSpan = 1) => rect(
    area.x + col * (cellW + gapX),
    area.y + row * (cellH + gapY),
    cellW * colSpan + gapX * (colSpan - 1),
    cellH * rowSpan + gapY * (rowSpan - 1),
  );
}

// Splits an area horizontally by weights, e.g. columns(area, [1, 3, 1]).
export function columns(area, weights, gap = 0.015) {
  const total = weights.reduce((a, b) => a + b, 0);
  const usable = area.width - gap * (weights.length - 1);
  let x = area.x;
  return weights.map((weight) => {
    const width = (usable * weight) / total;
    const cell = rect(x, area.y, width, area.height);
    x += width + gap;
    return cell;
  });
}

// Splits an area vertically by weights.
export function rows(area, weights, gap = 0.015) {
  const total = weights.reduce((a, b) => a + b, 0);
  const usable = area.height - gap * (weights.length - 1);
  let y = area.y;
  return weights.map((weight) => {
    const height = (usable * weight) / total;
    const cell = rect(area.x, y, area.width, height);
    y += height + gap;
    return cell;
  });
}

// Largest on-screen square inside an area, given the window aspect ratio (width / height in pixels).
export function squareIn(area, aspect, align = 'center') {
  const side = Math.min(area.width * aspect, area.height);
  const width = side / aspect;
  const x = align === 'left' ? area.x : area.x + (area.width - width) / 2;
  return rect(x, area.y + (area.height - side) / 2, width, side);
}

export function button(id, area, text, variant, extra = {}) {
  return { id, type: 'button', ...area, text, ...(variant ? { variant } : {}), ...extra };
}

export function text(id, area, value, variant, extra = {}) {
  return { id, type: 'text', ...area, text: value, ...(variant ? { variant } : {}), ...extra };
}
