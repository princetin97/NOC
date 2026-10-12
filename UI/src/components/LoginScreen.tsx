import React, { useState } from 'react';
import { Lock, User, Loader2 } from 'lucide-react';
import { login } from '../services/authService';
import type { AuthUser } from '../services/authService';

interface LoginScreenProps {
  darkMode: boolean;
  onLoginSuccess: (user: AuthUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ darkMode, onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const user = await login(username, password);
      onLoginSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`min-h-screen flex items-center justify-center font-mono ${
        darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'
      }`}
    >
      <div
        className={`w-full max-w-sm p-6 rounded-2xl border shadow-2xl ${
          darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex flex-col items-center space-y-2 mb-6">
          <div className="h-[4.5rem] w-[4.5rem] rounded-xl bg-slate-800 border border-slate-700 shadow-md shadow-emerald-500/20 overflow-hidden flex items-center justify-center">
            <img src="/logo-noc.png" alt="NOC logo" className="h-full w-full object-contain" />
          </div>
          <span className="font-bold text-xl tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            NOC
          </span>
          <p className="text-xs text-slate-400 text-center">Đăng nhập để truy cập Hệ thống Giám sát Mạng</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs" autoComplete="off">
          <div>
            <label className="block text-slate-400 mb-1">Tên đăng nhập:</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={`w-full pl-8 pr-3 py-2.5 rounded-lg border focus:ring-1 focus:ring-emerald-500 focus:outline-none ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
                }`}
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Mật khẩu:</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={`w-full pl-8 pr-3 py-2.5 rounded-lg border focus:ring-1 focus:ring-emerald-500 focus:outline-none ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
                }`}
              />
            </div>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <p className="text-[10px] text-slate-500">
            Lần đăng nhập đầu tiên với tài khoản "admin" sẽ tự động tạo quản trị viên mới.
          </p>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold transition-colors"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            <span>{isLoading ? 'Đang đăng nhập...' : 'Đăng nhập'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
