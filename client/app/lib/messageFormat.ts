// Shared parsing for code spans in message text. Used both by the rendered
// message bubble (MessageContent) and by the composer's live overlay
// (MessageInput), so "what you typed" and "what you'll send" stay aligned.

const CODE_BLOCK_REGEX = /```(?:([a-zA-Z0-9_+\-]+)\n)?([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /`([^`\n]+)`/g;

// Parsed output for the rendered bubble — fences stripped, language separated.
export type RenderSegment =
  | { kind: "block"; lang?: string; code: string }
  | { kind: "inline"; code: string }
  | { kind: "text"; text: string };

function splitInlineForRender(text: string): RenderSegment[] {
  const out: RenderSegment[] = [];
  let i = 0;
  const re = new RegExp(INLINE_CODE_REGEX);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > i) out.push({ kind: "text", text: text.slice(i, m.index) });
    out.push({ kind: "inline", code: m[1] });
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push({ kind: "text", text: text.slice(i) });
  return out;
}

export function parseForRender(text: string): RenderSegment[] {
  const out: RenderSegment[] = [];
  let i = 0;
  const re = new RegExp(CODE_BLOCK_REGEX);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > i) {
      // Strip the newline that visually attaches text to the opening fence,
      // so the <pre> doesn't get a phantom blank line above it.
      let before = text.slice(i, m.index);
      if (before.endsWith("\n")) before = before.slice(0, -1);
      if (before) out.push(...splitInlineForRender(before));
    }
    // Closing fence is conventionally on its own line; trim the trailing \n
    // it leaves in the captured content.
    out.push({ kind: "block", lang: m[1], code: m[2].replace(/\n$/, "") });
    i = m.index + m[0].length;
    if (text[i] === "\n") i++;
  }
  if (i < text.length) out.push(...splitInlineForRender(text.slice(i)));
  return out;
}

// Parsed output for the composer overlay — preserves every character of the
// source verbatim (fences included), just tagged so we can tint the spans.
// Verbatim preservation is essential: the overlay must align character-for-
// character with the textarea text, or the cursor and the tint will desync.
export type InputSegment = { kind: "text" | "block" | "inline"; text: string };

// True when `cursor` sits inside a triple-backtick code block (open or
// closed). Algorithm: count completed ``` fences strictly before the cursor;
// odd = inside, even = outside. Each fence toggles the in-code state, so
// parity is sufficient.
export function isCursorInCodeBlock(text: string, cursor: number): boolean {
  let fenceCount = 0;
  let i = 0;
  while (i + 3 <= cursor) {
    if (text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`") {
      fenceCount++;
      i += 3;
    } else {
      i++;
    }
  }
  return fenceCount % 2 === 1;
}

export function parseForInput(text: string): InputSegment[] {
  type Range = { start: number; end: number; kind: "block" | "inline" };
  const ranges: Range[] = [];

  // Scan for every literal ``` fence and pair them: opener + closer = closed
  // block, lone trailing opener = open block that extends to end-of-text.
  // The "open block" behavior is what gives the input its Teams-like feel:
  // the moment you type the third backtick, the box appears and grows with
  // each keystroke until you type the closing fence.
  const fences: number[] = [];
  for (let i = 0; i <= text.length - 3; i++) {
    if (text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`") {
      fences.push(i);
      i += 2;
    }
  }
  for (let p = 0; p < fences.length; p += 2) {
    const start = fences[p];
    const end = p + 1 < fences.length ? fences[p + 1] + 3 : text.length;
    ranges.push({ start, end, kind: "block" });
  }

  // Inline `code`, but only outside any block range.
  const inlineRe = new RegExp(INLINE_CODE_REGEX);
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    const insideBlock = ranges.some(
      (r) => r.kind === "block" && start >= r.start && end <= r.end,
    );
    if (!insideBlock) ranges.push({ start, end, kind: "inline" });
  }
  ranges.sort((a, b) => a.start - b.start);

  const out: InputSegment[] = [];
  let i = 0;
  for (const r of ranges) {
    if (r.start > i) out.push({ kind: "text", text: text.slice(i, r.start) });
    out.push({ kind: r.kind, text: text.slice(r.start, r.end) });
    i = r.end;
  }
  if (i < text.length) out.push({ kind: "text", text: text.slice(i) });
  return out;
}
