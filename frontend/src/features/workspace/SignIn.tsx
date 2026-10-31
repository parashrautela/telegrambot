import type { FormEvent } from 'react';
import { ArrowUpRight, LockKeyhole } from 'lucide-react';

type Props = {
  login: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  error: string;
  busy: boolean;
};

export function SignIn({ login, error, busy }: Props) {
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="studio-wordmark">
          iksha<span>.</span>
          <small>SPACES, THOUGHTFULLY MADE</small>
        </div>
        <div>
          <span className="eyebrow">THE STUDIO, IN SYNC</span>
          <h2>
            Thoughtful spaces.
            <br />
            Connected people.
          </h2>
          <p>
            From the first client brief to the final detail.
            <br />
            One place for the work that brings it all together.
          </p>
        </div>
        <span className="login-story-footer">STUDIO IKSHA &nbsp; / &nbsp; PROJECT WORKSPACE</span>
      </section>
      <form className="login-card" onSubmit={login}>
        <span className="eyebrow">YOUR STUDIO WORKSPACE</span>
        <h1>Welcome back.</h1>
        <p>Sign in with your individual staff account.</p>
        <label>
          Staff ID
          <input name="id" required autoComplete="username" autoFocus />
        </label>
        <label>
          Password
          <input name="password" required type="password" autoComplete="current-password" />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
          <ArrowUpRight size={16} />
        </button>
        <small>
          <LockKeyhole size={12} />
          Clients continue to communicate through Telegram.
        </small>
      </form>
    </div>
  );
}
