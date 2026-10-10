import { createFileRoute } from "@tanstack/react-router";
import { BrandMark } from "../dashboard/components/Nav";
import { handleDashboardLogin } from "../start/auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  server: {
    handlers: {
      POST: async ({ request }) => handleDashboardLogin(request),
    },
  },
});

function LoginPage() {
  const hasError =
    typeof window !== "undefined" &&
    new URL(window.location.href).searchParams.get("error") === "1";

  return (
    <main className="grid min-h-screen place-items-center bg-ink px-4 text-fg">
      <form className="w-full max-w-sm space-y-4" method="post" action="/login">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <div>
            <h1 className="text-xl font-semibold text-fg">Appeal monitor</h1>
            <p className="text-sm text-dim">Enter your dashboard password</p>
          </div>
        </div>
        {hasError ? (
          <p className="rounded-xl bg-bad/12 p-3 text-[15px] text-bad" role="alert">
            That password didn't match. Check DASHBOARD_PASSWORD in Railway.
          </p>
        ) : null}
        <input
          className="w-full rounded-xl bg-panel px-4 py-3.5 text-[16px] text-fg outline-none ring-1 ring-line transition placeholder:text-faint focus:ring-2 focus:ring-live"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
          required
          autoFocus
        />
        <button
          className="w-full rounded-full bg-live px-4 py-3.5 text-[16px] font-semibold text-ink transition hover:brightness-110"
          type="submit"
        >
          Log in
        </button>
      </form>
    </main>
  );
}
