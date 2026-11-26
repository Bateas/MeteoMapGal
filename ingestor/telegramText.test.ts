import { describe, it, expect } from 'vitest';
import { escapeTelegramMarkdown } from './telegramText';

describe('escapeTelegramMarkdown — S-03: a station name must not break the alert', () => {
  it('escapes the four characters of the legacy Markdown', () => {
    expect(escapeTelegramMarkdown('Estacion_Vigo*')).toBe('Estacion\\_Vigo\\*');
    expect(escapeTelegramMarkdown('Casa `Pepe` [Baiona]')).toBe('Casa \\`Pepe\\` \\[Baiona]');
  });

  it('leaves ordinary names as they are', () => {
    expect(escapeTelegramMarkdown('Vigo - Porto (Bouzas), 2 m')).toBe('Vigo - Porto (Bouzas), 2 m');
    expect(escapeTelegramMarkdown('A Coruña · Cabo Vilán')).toBe('A Coruña · Cabo Vilán');
  });
});
