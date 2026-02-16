import React, { useState } from 'react';
import { Eye, EyeOff, LogIn } from 'lucide-react';

interface LoginScreenProps {
  loading: boolean;
  error: string;
  onLogin: (username: string, password: string) => Promise<void>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ loading, error, onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    await onLogin(username.trim(), password);
  };

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-xl p-6 sm:p-8">
        <div className="flex flex-col items-center gap-3">
          <img
            src="/logo.png"
            alt="optimAIzer"
            className="w-20 h-20 rounded-2xl border border-zinc-200/80 dark:border-zinc-700/80 bg-white/90 dark:bg-zinc-900/90 object-contain"
          />
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">optimAIzer</h1>
          <p className="text-sm text-zinc-500 text-center">Accede con tu cuenta para continuar.</p>
        </div>

        <form onSubmit={submit} autoComplete="off" className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Usuario</label>
            <input
              type="text"
              name="login-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
              placeholder="Tu usuario"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="login-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 pr-10 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary hover:bg-primaryHover text-white px-4 py-2.5 font-medium transition-colors disabled:opacity-60"
          >
            <LogIn size={16} />
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
};
