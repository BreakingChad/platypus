import { useEffect, useRef, useState } from "react";
import { Input } from "./Input";

/** DraftInput — local-draft text input that commits on blur or Enter
 *  instead of writing to the database per keystroke (which makes typing
 *  lag behind the network round-trip and lets realtime echoes clobber
 *  what you're mid-typing). Promoted from AccessRoles after the same
 *  disease showed up in the module drawer.
 *
 *  While the field is focused, external value changes are ignored — your
 *  draft wins until you commit. */
export function DraftInput({
  value,
  onCommit,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <Input
      value={draft}
      className={className}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      placeholder={placeholder}
    />
  );
}
