"use client";

import React, { useState } from "react";

/**
 * Throwaway style reference for login page + sign-in form UI.
 * - No auth logic
 * - No API calls
 * - Copy this into another project and wire to your own handlers
 */
export default function SignInStyleThrowaway() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-56px)] w-full max-w-5xl flex-col items-center justify-center gap-8 px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-stretch gap-6 rounded-2xl border border-accent/30 bg-surface p-5 shadow-lg shadow-accent/5 sm:p-8">
        <div className="w-full space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Sign in to Your App</h1>
            <p className="text-sm text-muted">Use your email or Google.</p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
              {error}
            </div>
          )}

          {!codeSent ? (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  setLoading("send-code");
                  setTimeout(() => {
                    setLoading(null);
                    setCodeSent(true);
                  }, 350);
                }}
                className="space-y-3"
              >
                <label htmlFor="email" className="sr-only">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  required
                  disabled={!!loading}
                  autoComplete="email"
                />
                <button
                  type="submit"
                  disabled={!!loading}
                  className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
                >
                  {loading === "send-code" ? "Sending…" : "Next"}
                </button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wide text-muted">
                  <span className="bg-surface px-2">Or</span>
                </div>
              </div>

              <button
                type="button"
                disabled={!!loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-surface-2 disabled:opacity-50"
              >
                {loading === "google" ? (
                  <span className="text-muted">Signing in…</span>
                ) : (
                  <>
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    Continue with Google
                  </>
                )}
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setLoading("verify-code");
                setTimeout(() => setLoading(null), 350);
              }}
              className="space-y-4"
            >
              <div className="rounded-xl border border-border bg-surface p-4 text-center text-sm text-foreground">
                <p>We sent a 6-digit code to</p>
                <p className="mt-1 font-medium">{email || "you@example.com"}</p>
                <button
                  type="button"
                  onClick={() => {
                    setCodeSent(false);
                    setCode("");
                    setError(null);
                  }}
                  className="mt-2 text-xs text-muted underline hover:text-foreground"
                >
                  Use a different email
                </button>
              </div>

              <div className="space-y-2">
                <label htmlFor="code" className="sr-only">
                  Code
                </label>
                <input
                  id="code"
                  type="text"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-center text-2xl font-mono tracking-widest text-foreground placeholder:text-muted"
                  required
                  disabled={!!loading}
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!!loading || code.length !== 6}
                  className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
                >
                  {loading === "verify-code" ? "Verifying…" : "Sign in"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <a href="#" className="text-sm text-muted hover:text-foreground">
        ← Back to home
      </a>
    </main>
  );
}

