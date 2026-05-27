import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";

/** ComingSoon — placeholder body for routes that are wired in the shell but
 *  not yet implemented. Always shipped on shell, never blank — gives the
 *  user a clear "this is the next thing I'll work on" signal. */
export function ComingSoon({
  kicker,
  title,
  description,
  iconName = "workflow",
  onBackToHome,
}: {
  kicker: string;
  title: string;
  description: string;
  iconName?: string;
  onBackToHome: () => void;
}) {
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
      <PageHeader kicker={kicker} title={title} subtitle={description} />
      <Card className="mt-6">
        <EmptyState
          iconName={iconName}
          title="Coming in the next build"
          sub="This surface is part of the planned operating model — it's wired in the navigation so you can see where it'll live. We'll fill it in next."
          action={
            <Button variant="primary" onClick={onBackToHome}>
              Back to home
            </Button>
          }
        />
      </Card>
    </div>
  );
}
