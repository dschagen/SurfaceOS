import { button, text, grid, rows, rect, inset } from './layout.js';

// Evaluates + - × ÷ with parentheses and unary minus. Throws on invalid input.
export function evaluate(expression) {
  const tokens = expression.replace(/\s+/g, '').match(/\d+\.?\d*|\.\d+|[+\-×÷*/()]/g) || [];
  if (tokens.join('') !== expression.replace(/\s+/g, '')) throw new Error('Invalid character');
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function parseExpression() {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      value = take() === '+' ? value + parseTerm() : value - parseTerm();
    }
    return value;
  }
  function parseTerm() {
    let value = parseFactor();
    while (['×', '÷', '*', '/'].includes(peek())) {
      const operator = take();
      const right = parseFactor();
      if (operator === '÷' || operator === '/') {
        if (right === 0) throw new Error('Cannot divide by zero');
        value /= right;
      } else {
        value *= right;
      }
    }
    return value;
  }
  function parseFactor() {
    const token = take();
    if (token === '-') return -parseFactor();
    if (token === '+') return parseFactor();
    if (token === '(') {
      const value = parseExpression();
      if (take() !== ')') throw new Error('Missing )');
      return value;
    }
    if (token !== undefined && /^[\d.]/.test(token)) return parseFloat(token);
    throw new Error('Incomplete expression');
  }

  const result = parseExpression();
  if (position !== tokens.length) throw new Error('Unexpected input');
  if (!Number.isFinite(result)) throw new Error('Result too large');
  return result;
}

export function formatNumber(value) {
  if (Object.is(value, -0)) return '0';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) return value.toExponential(6).replace(/\.?0+e/, 'e');
  return String(parseFloat(value.toPrecision(12)));
}

const KEYS = [
  ['C', '(', ')', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['⌫', '0', '.', '='],
];
const KEY_IDS = { '(': 'open', ')': 'close', '÷': 'divide', '×': 'times', '-': 'minus', '+': 'plus', '⌫': 'back', '.': 'dot', '=': 'equals', C: 'clear' };
const keyId = (key) => `key-${KEY_IDS[key] ?? key}`;
const ID_TO_KEY = Object.fromEntries(KEYS.flat().map((key) => [keyId(key), key]));
const OPERATORS = new Set(['+', '-', '×', '÷']);

function create(ctx) {
  let expression = '';
  let error = '';
  let justEvaluated = false;

  function press(key) {
    error = '';
    // After "=", a digit starts a new calculation while an operator continues from the result.
    if (justEvaluated && /^[\d.(]$/.test(key)) expression = '';
    justEvaluated = false;
    if (key === 'C') { expression = ''; return; }
    if (key === '⌫') { expression = expression.slice(0, -1); return; }
    if (key === '=') {
      if (!expression) return;
      try {
        expression = formatNumber(evaluate(expression));
        justEvaluated = true;
      } catch (e) {
        error = e.message;
      }
      return;
    }
    const last = expression.slice(-1);
    if (OPERATORS.has(key) && OPERATORS.has(last) && !(key === '-' && last !== '-')) {
      // Replace a trailing operator instead of stacking two, except to allow "×-3".
      expression = expression.slice(0, -1) + key;
      return;
    }
    if (key === '.') {
      const currentNumber = expression.match(/[\d.]*$/)[0];
      if (currentNumber.includes('.')) return;
      if (!currentNumber) key = '0.';
    }
    if (expression.length < 40) expression += key;
  }

  function preview() {
    if (!expression || error) return '';
    try {
      const value = formatNumber(evaluate(expression));
      return value === expression ? '' : `= ${value}`;
    } catch {
      return '';
    }
  }

  return {
    widgets() {
      const [display, pad] = rows(inset(rect(0, 0, 1, 1), 0.035), [1.25, 4], 0.035);
      const [line1, line2] = rows(inset(display, 0.02, 0.015), [1, 1.5], 0);
      const cell = grid(pad, 5, 4, 0.022, 0.028);
      const widgets = [
        text('display-card', display, '', 'display'),
        text('expression', line1, error || preview() || ' ', ['right', 'mono', 'small', error ? 'error' : 'muted']),
        text('display', line2, expression || '0', ['right', 'mono', 'large']),
      ];
      KEYS.forEach((row, r) => row.forEach((key, c) => {
        let variant = ['key'];
        if (key === '=') variant = ['key', 'primary'];
        else if (key === 'C') variant = ['key', 'danger'];
        else if (OPERATORS.has(key) || key === '(' || key === ')') variant = ['key', 'op'];
        const extra = key === '⌫' ? { icon: 'backspace' } : {};
        const label = key === '⌫' ? '' : key === '-' ? '−' : key;
        widgets.push(button(keyId(key), cell(r, c), label, variant, extra));
      }));
      return widgets;
    },
    handleAction(action) {
      const key = ID_TO_KEY[action.widget_id];
      if (key) press(key);
    },
    handleKey(event) {
      if (event.type !== 'keydown') return false;
      const map = { '*': '×', x: '×', '/': '÷', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', c: 'C', Delete: 'C' };
      const key = map[event.key] ?? event.key;
      if (!/^[\d.+\-×÷()=C⌫]$/.test(key)) return false;
      press(key);
      return true;
    },
  };
}

export default { title: 'Calculator', create };
