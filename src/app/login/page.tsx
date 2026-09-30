'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (res.ok) {
      router.push('/admin/scanner');
    } else {
      alert('Login falhou (Use admin/admin para testar)');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <form onSubmit={handleLogin} className="bg-white p-8 rounded shadow-md w-96">
        <h2 className="text-2xl font-bold mb-4 text-center text-black">Login</h2>
        <input 
          type="email" placeholder="E-mail" 
          value={email} onChange={e => setEmail(e.target.value)}
          className="w-full border p-2 mb-4 rounded text-black"
        />
        <input 
          type="password" placeholder="Senha" 
          value={password} onChange={e => setPassword(e.target.value)}
          className="w-full border p-2 mb-4 rounded text-black"
        />
        <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 font-bold">Entrar</button>
      </form>
    </div>
  );
}
