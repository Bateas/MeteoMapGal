/**
 * Text from third parties inside a Telegram message: station and buoy names (anyone can register a
 * Wunderground or Meteoclimatic station and call it what they like). The alerts go through n8n with
 * parse_mode Markdown, the legacy one, where an unpaired `_`, `*`, `` ` `` or `[` makes Telegram
 * reject the whole message («can't parse entities») and the alert is lost without a trace (S-03 of
 * the 26-nov-2026 audit). Legacy Markdown takes those four escaped with a backslash, and nothing else
 * needs it. Our own text (titles in bold, spot names) is written knowing the rule and is not escaped.
 */
export function escapeTelegramMarkdown(text: string): string {
  return text.replace(/[_*`[]/g, (c) => '\\' + c);
}
