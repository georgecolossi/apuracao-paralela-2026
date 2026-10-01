'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, ShieldAlert, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (res.ok) {
        router.push('/admin/scanner');
      } else {
        setErrorMsg('Credenciais inválidas. Verifique seu e-mail e senha.');
        setLoading(false);
      }
    } catch {
      setErrorMsg('Erro de conexão. Tente novamente mais tarde.');
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100 font-sans p-4">
      <div className="w-full max-w-md">
        
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 mb-4">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">
            Apuração <span className="text-indigo-600">Paralela</span>
          </h1>
          <p className="text-slate-500 font-medium text-sm mt-1 uppercase tracking-widest">Acesso Administrativo</p>
        </div>

        {/* Formulário */}
        <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100">
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 shrink-0 text-red-500" />
                <span className="font-semibold">{errorMsg}</span>
              </div>
            )}
            
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">E-mail Operacional</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-5 h-5" />
                </div>
                <input 
                  type="email" 
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="operador@radio.com.br" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)}
                  className="w-full border border-slate-300 bg-slate-50 p-3 pl-11 rounded-xl text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white outline-none transition-all font-medium"
                  required
                />
              </div>
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Senha de Acesso</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-5 h-5" />
                </div>
                <input 
                  type="password" 
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)}
                  className="w-full border border-slate-300 bg-slate-50 p-3 pl-11 rounded-xl text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white outline-none transition-all font-medium"
                  required
                />
              </div>
            </div>
            
            <button 
              type="submit" 
              disabled={loading}
              className="mt-2 w-full bg-slate-900 text-white p-4 rounded-xl hover:bg-slate-800 font-bold uppercase tracking-wide transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Acessar Sistema
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
            
          </form>
        </div>
        
        <div className="mt-8 text-center text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Sistema de Apuração Paralela • 2026
        </div>
      </div>
    </div>
  );
}
