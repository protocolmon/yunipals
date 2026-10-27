import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Yunipals page could not render", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-12 text-ink">
        <div role="alert">
          <h1 className="font-display text-3xl">This page couldn’t load.</h1>
          <p className="mt-4 text-muted">
            Reload to get the latest page. If the problem continues, return to
            the collection and try again later.
          </p>
          <p className="mt-3 text-sm text-muted">
            Submitted transactions remain onchain. Reloading does not submit
            another transaction.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-grape px-5 py-3 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-grape"
          >
            Reload page
          </button>
          <Link
            to="/"
            reloadDocument
            className="rounded-full border border-line px-5 py-3 text-sm font-bold focus-visible:ring-2 focus-visible:ring-grape"
          >
            Back to collection
          </Link>
        </div>
      </main>
    );
  }
}
