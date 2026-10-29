'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Search,
  Key,
  RotateCcw,
  Power,
  Trash2,
  Edit2,
  X,
  ArrowLeft,
  Sparkles,
  Eye,
  ScanLine
} from 'lucide-react';
import { generateSecureRandomPassword } from '@/lib/validation/password';

export interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    reportsProcessed: number;
    scanSessions: number;
  };
}

interface Props {
  initialUsers: UserItem[];
  currentUserId: string;
}

export default function UsersManagerClient({ initialUsers, currentUserId }: Props) {
  const [users, setUsers] = useState<UserItem[]>(initialUsers);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modais
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<UserItem | null>(null);
  const [showResetPwdModal, setShowResetPwdModal] = useState<UserItem | null>(null);
  const [showRevokeModal, setShowRevokeModal] = useState<UserItem | null>(null);
  const [showStatusModal, setShowStatusModal] = useState<UserItem | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<UserItem | null>(null);

  // Formulário de Criação
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    role: 'OPERATOR',
    password: ''
  });

  // Formulário de Edição
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    role: 'OPERATOR'
  });

  // Formulário de Reset de Senha
  const [resetPwdForm, setResetPwdForm] = useState({
    newPassword: ''
  });

  // Feedback e Loading
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {
      // ignore
    }
  };

  const handleGeneratePassword = (target: 'create' | 'reset') => {
    const pwd = generateSecureRandomPassword(16);
    if (target === 'create') {
      setCreateForm(prev => ({ ...prev, password: pwd }));
    } else {
      setResetPwdForm({ newPassword: pwd });
    }
  };

  // Submit Criar Usuário
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm)
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({
          type: 'error',
          message: data.error || (data.details ? data.details.join(' ') : 'Erro ao cadastrar usuário.')
        });
      } else {
        setFeedback({ type: 'success', message: `Usuário '${data.user.name}' cadastrado com sucesso.` });
        setShowCreateModal(false);
        setCreateForm({ name: '', email: '', role: 'OPERATOR', password: '' });
        await fetchUsers();
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erro de comunicação ao criar usuário.' });
    } finally {
      setLoading(false);
    }
  };

  // Submit Editar Usuário
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal) return;
    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/users/${showEditModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: 'error', message: data.error || 'Erro ao atualizar dados do usuário.' });
      } else {
        setFeedback({ type: 'success', message: `Dados de '${data.user.name}' atualizados com sucesso.` });
        setShowEditModal(null);
        await fetchUsers();
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erro de rede ao editar usuário.' });
    } finally {
      setLoading(false);
    }
  };

  // Submit Redefinir Senha
  const handleResetPwdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showResetPwdModal) return;
    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/users/${showResetPwdModal.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetPwdForm)
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({
          type: 'error',
          message: data.error || (data.details ? data.details.join(' ') : 'Erro ao redefinir senha.')
        });
      } else {
        setFeedback({
          type: 'success',
          message: `Senha de '${showResetPwdModal.name}' redefinida com sucesso. Sessões anteriores foram revogadas.`
        });
        setShowResetPwdModal(null);
        setResetPwdForm({ newPassword: '' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erro de rede ao redefinir senha.' });
    } finally {
      setLoading(false);
    }
  };

  // Submit Revogar Sessões
  const handleRevokeSessions = async () => {
    if (!showRevokeModal) return;
    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/users/${showRevokeModal.id}/revoke-sessions`, {
        method: 'POST'
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: 'error', message: data.error || 'Erro ao revogar sessões.' });
      } else {
        setFeedback({
          type: 'success',
          message: `Sessões ativas de '${showRevokeModal.name}' revogadas com sucesso.`
        });
        setShowRevokeModal(null);
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erro de rede ao revogar sessões.' });
    } finally {
      setLoading(false);
    }
  };

  // Submit Alterar Status (Ativar / Desativar)
  const handleToggleStatus = async () => {
    if (!showStatusModal) return;
    setLoading(true);
    setFeedback(null);

    const newStatus = !showStatusModal.isActive;

    try {
      const res = await fetch(`/api/admin/users/${showStatusModal.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newStatus })
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: 'error', message: data.error || 'Erro ao alterar status.' });
      } else {
        setFeedback({
          type: 'success',
          message: `Usuário '${showStatusModal.name}' ${newStatus ? 'ativado' : 'desativado'} com sucesso.`
        });
        setShowStatusModal(null);
        await fetchUsers();
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erro de rede ao alterar status do usuário.' });
    } finally {
      setLoading(false);
    }
  };

  // Submit Excluir
  const handleDeleteSubmit = async () => {
    if (!showDeleteModal) return;
    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/users/${showDeleteModal.id}`, {
        method: 'DELETE'
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: 'error', message: data.error || 'Erro ao excluir usuário.' });
      } else {
        setFeedback({
          type: 'success',
          message: data.message || `Usuário '${showDeleteModal.name}' processado com sucesso.`
        });
        setShowDeleteModal(null);
        await fetchUsers();
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erro de rede ao excluir usuário.' });
    } finally {
      setLoading(false);
    }
  };

  // Filtragem
  const filteredUsers = users.filter(user => {
    const matchesSearch =
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRole = roleFilter === 'ALL' || user.role === roleFilter;

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && user.isActive) ||
      (statusFilter === 'INACTIVE' && !user.isActive);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const adminCount = users.filter(u => u.role === 'ADMIN' && u.isActive).length;
  const operatorCount = users.filter(u => u.role === 'OPERATOR' && u.isActive).length;
  const viewerCount = users.filter(u => u.role === 'VIEWER' && u.isActive).length;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/admin"
              className="text-slate-400 hover:text-slate-200 transition-colors inline-flex items-center gap-1 text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Painel Geral
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Users className="w-6 h-6 text-indigo-400" />
            Gestão de Usuários e Permissões (RBAC)
          </h1>
          <p className="text-sm text-slate-400">
            Controle de acesso com perfis ADMIN, OPERATOR e VIEWER, controle de sessões e auditoria estrita.
          </p>
        </div>

        <button
          onClick={() => {
            setCreateForm({ name: '', email: '', role: 'OPERATOR', password: '' });
            setShowCreateModal(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-sm shadow-indigo-900/50 transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          <UserPlus className="w-4 h-4" />
          Novo Usuário
        </button>
      </div>

      {/* Alerta de Feedback */}
      {feedback && (
        <div
          className={`p-4 rounded-xl flex items-start gap-3 border ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 text-sm font-medium">{feedback.message}</div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Cards de Métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Cadastrado</div>
          <div className="text-2xl font-bold text-white">{users.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/40">
          <div className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            Administradores
          </div>
          <div className="text-2xl font-bold text-indigo-200">{adminCount}</div>
        </div>
        <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
          <div className="text-xs font-semibold text-emerald-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <ScanLine className="w-3.5 h-3.5 text-emerald-400" />
            Operadores
          </div>
          <div className="text-2xl font-bold text-emerald-200">{operatorCount}</div>
        </div>
        <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/40">
          <div className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-amber-400" />
            Visualizadores
          </div>
          <div className="text-2xl font-bold text-amber-200">{viewerCount}</div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="p-3 sm:p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Filtrar por nome ou email..."
            className="w-full pl-9 pr-4 py-2 bg-slate-850 bg-slate-800/70 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          >
            <option value="ALL">Todos os Papéis</option>
            <option value="ADMIN">ADMIN (Administradores)</option>
            <option value="OPERATOR">OPERATOR (Operadores)</option>
            <option value="VIEWER">VIEWER (Visualizadores)</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          >
            <option value="ALL">Todos os Status</option>
            <option value="ACTIVE">Apenas Ativos</option>
            <option value="INACTIVE">Apenas Inativos</option>
          </select>
        </div>
      </div>

      {/* Tabela de Usuários */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-800/80 text-slate-300 font-semibold border-b border-slate-800 text-xs uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Usuário</th>
                <th className="py-3 px-4">Papel (RBAC)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Cadastro</th>
                <th className="py-3 px-4 text-right">Ações de Segurança</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    Nenhum usuário encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredUsers.map(user => {
                  const isCurrent = user.id === currentUserId;
                  return (
                    <tr key={user.id} className="hover:bg-slate-800/30 transition-colors">
                      {/* Usuário */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-indigo-300 text-sm">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-white flex items-center gap-1.5">
                              {user.name}
                              {isCurrent && (
                                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded font-semibold">
                                  Você
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 font-mono">{user.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Papel */}
                      <td className="py-3 px-4">
                        {user.role === 'ADMIN' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-700/50">
                            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                            ADMIN
                          </span>
                        )}
                        {user.role === 'OPERATOR' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-700/50">
                            <ScanLine className="w-3.5 h-3.5 text-emerald-400" />
                            OPERATOR
                          </span>
                        )}
                        {user.role === 'VIEWER' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-950/60 text-amber-300 border border-amber-700/50">
                            <Eye className="w-3.5 h-3.5 text-amber-400" />
                            VIEWER
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        {user.isActive ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
                            <span className="w-2 h-2 rounded-full bg-slate-500" />
                            Inativo
                          </span>
                        )}
                      </td>

                      {/* Cadastro */}
                      <td className="py-3 px-4 text-xs text-slate-400">
                        {new Date(user.createdAt).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric'
                        })}
                      </td>

                      {/* Ações */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Editar */}
                          <button
                            title="Editar Dados"
                            onClick={() => {
                              setEditForm({ name: user.name, email: user.email, role: user.role });
                              setShowEditModal(user);
                            }}
                            className="p-1.5 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {/* Redefinir Senha */}
                          <button
                            title="Redefinir Senha"
                            onClick={() => {
                              setResetPwdForm({ newPassword: '' });
                              setShowResetPwdModal(user);
                            }}
                            className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Key className="w-4 h-4" />
                          </button>

                          {/* Revogar Sessões */}
                          <button
                            title="Revogar Sessões Ativas"
                            onClick={() => setShowRevokeModal(user)}
                            className="p-1.5 text-slate-400 hover:text-rose-300 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>

                          {/* Ativar/Desativar */}
                          <button
                            title={user.isActive ? 'Desativar Usuário' : 'Ativar Usuário'}
                            onClick={() => setShowStatusModal(user)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              user.isActive
                                ? 'text-slate-400 hover:text-amber-400 hover:bg-slate-800'
                                : 'text-slate-400 hover:text-emerald-400 hover:bg-slate-800'
                            }`}
                          >
                            <Power className="w-4 h-4" />
                          </button>

                          {/* Excluir */}
                          <button
                            title="Excluir Usuário"
                            onClick={() => setShowDeleteModal(user)}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: NOVO USUÁRIO */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-400" />
                Cadastrar Novo Usuário
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={createForm.name}
                  onChange={e => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: João Silva"
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">Email / Login</label>
                <input
                  type="text"
                  required
                  value={createForm.email}
                  onChange={e => setCreateForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="Ex: operador.concordia@apuracao.local"
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">Papel de Acesso (RBAC)</label>
                <select
                  value={createForm.role}
                  onChange={e => setCreateForm(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                >
                  <option value="OPERATOR">OPERATOR — Leitura de QRBU e conferência de seções</option>
                  <option value="ADMIN">ADMIN — Controle total, turnos, cobertura e usuários</option>
                  <option value="VIEWER">VIEWER — Apenas visualização de dashboards e auditoria</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300 uppercase">Senha de Acesso</label>
                  <button
                    type="button"
                    onClick={() => handleGeneratePassword('create')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Gerar Senha Forte
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={createForm.password}
                  onChange={e => setCreateForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Mínimo 8 caracteres, maiúscula, minúscula e número"
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Exige no mínimo 8 caracteres, com letras maiúsculas, minúsculas e número/símbolo.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition-all"
                >
                  {loading ? 'Cadastrando...' : 'Criar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR USUÁRIO */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-indigo-400" />
                Editar Dados do Usuário
              </h2>
              <button
                onClick={() => setShowEditModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">Email / Login</label>
                <input
                  type="text"
                  required
                  value={editForm.email}
                  onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">Papel de Acesso (RBAC)</label>
                <select
                  value={editForm.role}
                  onChange={e => setEditForm(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                >
                  <option value="OPERATOR">OPERATOR — Leitura de QRBU e conferência de seções</option>
                  <option value="ADMIN">ADMIN — Controle total, turnos, cobertura e usuários</option>
                  <option value="VIEWER">VIEWER — Apenas visualização de dashboards e auditoria</option>
                </select>
                {showEditModal.role === 'ADMIN' && editForm.role !== 'ADMIN' && (
                  <p className="text-xs text-amber-300 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    Atenção: alterar o papel de um ADMIN revogará suas permissões administrativas.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowEditModal(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition-all"
                >
                  {loading ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REDEFINIR SENHA */}
      {showResetPwdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-400" />
                Redefinir Senha
              </h2>
              <button
                onClick={() => setShowResetPwdModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-300">
              Definir nova senha para o usuário <strong className="text-white">{showResetPwdModal.name}</strong> ({showResetPwdModal.email}).
            </p>

            <form onSubmit={handleResetPwdSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300 uppercase">Nova Senha</label>
                  <button
                    type="button"
                    onClick={() => handleGeneratePassword('reset')}
                    className="text-xs text-amber-400 hover:text-amber-300 font-semibold inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Gerar Senha Forte
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={resetPwdForm.newPassword}
                  onChange={e => setResetPwdForm({ newPassword: e.target.value })}
                  placeholder="Mínimo 8 caracteres com maiúscula e número"
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </div>

              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Por segurança, todas as sessões ativas deste usuário em quaisquer dispositivos serão invalidadas imediatamente após a redefinição.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowResetPwdModal(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition-all"
                >
                  {loading ? 'Redefinindo...' : 'Confirmar Nova Senha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REVOGAR SESSÕES */}
      {showRevokeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-rose-400" />
              Revogar Sessões Ativas
            </h2>
            <p className="text-sm text-slate-300">
              Deseja invalidar imediatamente todos os cookies e tokens de acesso emitidos para{' '}
              <strong className="text-white">{showRevokeModal.name}</strong> ({showRevokeModal.email})?
            </p>
            <p className="text-xs text-slate-400">
              O usuário precisará realizar novo login para voltar a operar o sistema.
            </p>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowRevokeModal(null)}
                className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleRevokeSessions}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition-all"
              >
                {loading ? 'Revogando...' : 'Revogar Sessões'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ATIVAR / DESATIVAR */}
      {showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Power className={`w-5 h-5 ${showStatusModal.isActive ? 'text-amber-400' : 'text-emerald-400'}`} />
              {showStatusModal.isActive ? 'Desativar Usuário' : 'Ativar Usuário'}
            </h2>
            <p className="text-sm text-slate-300">
              Confirmar {showStatusModal.isActive ? 'a desativação' : 'a ativação'} de{' '}
              <strong className="text-white">{showStatusModal.name}</strong> ({showStatusModal.email})?
            </p>
            {showStatusModal.isActive && (
              <p className="text-xs text-amber-300 flex items-center gap-1.5 bg-amber-950/30 p-2.5 rounded-lg border border-amber-800/40">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                Usuários desativados perdem imediatamente o acesso e todas as suas sessões ativas são invalidadas.
              </p>
            )}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowStatusModal(null)}
                className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleToggleStatus}
                className={`px-4 py-2 text-white text-sm font-semibold rounded-lg shadow-sm transition-all ${
                  showStatusModal.isActive
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {loading ? 'Processando...' : showStatusModal.isActive ? 'Confirmar Desativação' : 'Confirmar Ativação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EXCLUIR USUÁRIO */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-400" />
              Excluir Usuário
            </h2>
            <p className="text-sm text-slate-300">
              Tem certeza de que deseja excluir o usuário <strong className="text-white">{showDeleteModal.name}</strong> ({showDeleteModal.email})?
            </p>
            <p className="text-xs text-slate-400 bg-slate-800/60 p-2.5 rounded-lg border border-slate-700/60">
              Caso este usuário possua registros eleitorais ou auditorias associadas, o sistema realizará uma desativação lógica segura para garantir que o histórico oficial nunca seja corrompido.
            </p>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowDeleteModal(null)}
                className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleDeleteSubmit}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition-all"
              >
                {loading ? 'Excluindo...' : 'Confirmar Exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
