import { useRef } from "react";
import { Paperclip, SendHorizontal } from "lucide-react";
import { cn } from "~/lib/utils";
import { isCursorInCodeBlock } from "~/lib/messageFormat";
import { highlightWithLang } from "~/lib/highlight";

// Imperatively insert `text` at the current selection of a React-controlled
// textarea. Uses the native value setter so React's onChange handler sees the
// change (a plain `el.value = ...` assignment is overwritten on next render).
function insertAtCursor(el: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.selectionStart = el.selectionEnd = start + text.length;
}

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  /** Whether the send action is currently possible (e.g. has text or files, not uploading) */
  canSend: boolean;
  onPaste?: (files: File[]) => void;
  onAttachClick?: () => void;
  /** External ref to the textarea for programmatic focus */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  placeholder,
  canSend,
  onPaste,
  onAttachClick,
  inputRef,
}: MessageInputProps) {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = inputRef || internalRef;

  const resetHeight = () => {
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleSend = () => {
    onSend();
    resetHeight();
  };

  return (
    <div className="p-4">
      <div className="flex items-start gap-1 rounded-md border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring min-w-0">
        <div className="relative flex-1 min-w-0">
          <InputOverlay text={value} />
          <textarea
            ref={textareaRef}
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              const el = textareaRef.current;
              if (el) {
                el.style.height = "auto";
                const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
                el.style.height = Math.min(el.scrollHeight, lineHeight * 6) + "px";
              }
            }}
            onPaste={onPaste ? (e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length > 0) {
                e.preventDefault();
                onPaste(files);
              }
            } : undefined}
            onKeyDown={(e) => {
              const el = textareaRef.current;
              const inCode = !!el && isCursorInCodeBlock(value, el.selectionStart);
              if (e.key === "Enter" && !e.shiftKey && !inCode && canSend) {
                e.preventDefault();
                handleSend();
              } else if (e.key === "Tab" && inCode && el) {
                // Default Tab moves focus away — inside code, treat it as
                // indentation instead.
                e.preventDefault();
                insertAtCursor(el, "\t");
              }
            }}
            rows={1}
            cols={1}
            // Text is rendered by the overlay; this textarea is the input
            // surface only. Caret stays visible via an explicit caret-color.
            style={{ color: "transparent", caretColor: "var(--foreground)" }}
            className="relative w-full min-w-0 resize-none bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none"
          />
        </div>
        {onAttachClick && (
          <button
            onClick={onAttachClick}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <Paperclip className="w-5 h-5" />
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 disabled:opacity-50 disabled:pointer-events-none"
        >
          <SendHorizontal className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// Renders behind the textarea, char-for-char aligned with the typed text.
// Each source line (split on \n) becomes its own block-level div so that
// in-code lines can paint a full-width background — which is what gives the
// composer its Teams-style "box" look. The textarea's wrapping rules
// (pre-wrap, break-word) are mirrored exactly on each line div, so a long
// in-code line that the textarea wraps to two visual lines also wraps to
// two visual lines in the overlay and the background still fills both.
//
// Highlight.js colors are applied per content line. Highlighting line-by-
// line keeps each line a self-contained HTML fragment (no open tags
// spilling across the line boundary), which is what makes per-line divs
// safe. Multi-line tokens (multi-line strings/comments) lose token state
// across the break — an acceptable trade-off for the simplicity gain.
function InputOverlay({ text }: { text: string }) {
  if (!text) return null;

  // Classify each line and track the language declared on the opening fence,
  // so content lines highlight against the same language until the closing
  // fence (or end of text) resets it.
  const lines = text.split("\n");
  const flags: boolean[] = new Array(lines.length);
  const langs: (string | undefined)[] = new Array(lines.length);
  let pos = 0;
  let activeLang: string | undefined;
  let prevInCode = false;
  for (let i = 0; i < lines.length; i++) {
    const startInCode = isCursorInCodeBlock(text, pos);
    const endInCode = isCursorInCodeBlock(text, pos + lines[i].length);
    const inCode = startInCode || endInCode;
    if (inCode && !prevInCode) {
      const m = lines[i].match(/^```([a-zA-Z0-9_+\-]+)/);
      activeLang = m ? m[1] : undefined;
    } else if (!inCode) {
      activeLang = undefined;
    }
    flags[i] = inCode;
    langs[i] = inCode ? activeLang : undefined;
    prevInCode = inCode;
    pos += lines[i].length + 1;
  }

  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none text-sm text-foreground select-none"
    >
      {lines.map((line, i) => {
        const inCode = flags[i];
        const isFirst = inCode && !flags[i - 1];
        const isLast = inCode && !flags[i + 1];
        const cls = cn(
          inCode && "bg-muted",
          isFirst && "rounded-t-sm",
          isLast && "rounded-b-sm",
        );
        const style = {
          whiteSpace: "pre-wrap" as const,
          overflowWrap: "break-word" as const,
          wordBreak: "break-word" as const,
        };

        if (inCode) {
          // Don't try to syntax-highlight the fence lines themselves; "```"
          // is markup, not code. Empty lines need a zero-width space so the
          // div retains line-height (matching the textarea's blank rows).
          const isFenceLine = /^```/.test(line);
          if (isFenceLine || !line) {
            return (
              <div key={i} className={cls} style={style}>
                {line || "​"}
              </div>
            );
          }
          const html = highlightWithLang(line, langs[i]);
          return (
            <div
              key={i}
              className={cls}
              style={style}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        return (
          <div key={i} className={cls} style={style}>
            {renderInlineCode(line)}
          </div>
        );
      })}
    </div>
  );
}

// Within a non-code line, highlight `inline` spans with a small tinted pill.
// Same alignment constraint as the line-level bg: no padding, no font change.
function renderInlineCode(line: string): React.ReactNode {
  if (line === "") return "​";
  const out: React.ReactNode[] = [];
  const re = /`([^`\n]+)`/g;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > i) out.push(line.slice(i, m.index));
    out.push(
      <span
        key={out.length}
        className="bg-muted rounded-sm"
        style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}
      >
        {m[0]}
      </span>,
    );
    i = m.index + m[0].length;
  }
  if (i < line.length) out.push(line.slice(i));
  return out;
}
