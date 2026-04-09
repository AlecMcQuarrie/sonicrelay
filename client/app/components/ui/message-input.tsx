import { useRef } from "react";
import { Paperclip, SendHorizontal } from "lucide-react";

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
      <div className="flex items-center gap-1 rounded-md border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
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
            if (e.key === "Enter" && !e.shiftKey && canSend) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none"
        />
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
