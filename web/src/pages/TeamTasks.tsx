import { Inbox } from "./Inbox";

/** Team tasks — the team queue as its own surface (June menu list).
 *  Same engine as the Inbox, locked to the "My team" view. */
export function TeamTasks({ onNavigate }: { onNavigate: (h: string) => void }) {
  return <Inbox onNavigate={onNavigate} fixedTab="team" />;
}
