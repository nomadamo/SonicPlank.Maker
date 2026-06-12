import { Link, useRouter } from "@tanstack/react-router";

export default function ErrorBoundary({ error }: { error: Error }) {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 text-center gap-4">
      <h2 className="text-xl font-bold text-destructive">Something went wrong</h2>
      <pre className="p-4 rounded-lg bg-muted text-xs font-mono max-w-md overflow-auto break-all">
        {error?.message || String(error)}
      </pre>
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => router.invalidate()}
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
        >
          Try Again
        </button>
        <Link
          to="/"
          className="px-4 py-2 text-sm font-medium rounded-md border border-input bg-transparent hover:bg-accent hover:text-accent-foreground"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
