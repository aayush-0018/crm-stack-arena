import { ButtonLink } from '../components/ui/Button';
import { EmptyState } from '../components/ui/States';

export default function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you are looking for does not exist."
      action={<ButtonLink to="/">Go to dashboard</ButtonLink>}
    />
  );
}
