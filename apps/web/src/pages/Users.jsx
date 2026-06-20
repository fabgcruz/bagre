import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus,
  Trash2,
  KeyRound,
  Shield,
  ShieldCheck,
  Power,
  Copy,
  CheckCircle2,
} from 'lucide-react';
import { api, demoTryWrite } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.users });
  const [showCreate, setShowCreate] = useState(false);
  const [linkInfo, setLinkInfo] = useState(null);

  const create = useMutation({
    mutationFn: api.createUser,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      if (res.resetToken) {
        setLinkInfo({
          email: res.user.email,
          token: res.resetToken,
          purpose: 'definição inicial de senha',
        });
      }
      setShowCreate(false);
    },
  });
  const update = useMutation({
    mutationFn: ({ id, data }) => api.updateUser(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const remove = useMutation({
    mutationFn: api.deleteUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const reset = useMutation({
    mutationFn: api.resetUser,
    onSuccess: (res, id) => {
      const u = users.find((x) => x.id === id);
      setLinkInfo({
        email: u?.email,
        token: res.token,
        purpose: 'reset de senha',
      });
    },
  });

  return (
    <div>
      <PageHeader
        title="Usuários"
        description="ADMIN pode editar tudo (incluindo criar usuários). READER só consulta. Ao criar uma conta sem senha, geramos um link único de definição."
        actions={
          <button onClick={() => { if (demoTryWrite()) return; setShowCreate(true); }} className="btn-primary">
            <UserPlus size={14} /> Novo usuário
          </button>
        }
      />

      {linkInfo && <ResetLinkBanner info={linkInfo} onClose={() => setLinkInfo(null)} />}

      <div className="card overflow-hidden">
        <table className="w-full text-sm table-zebra">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">E-mail</th>
              <th className="px-3 py-2 text-left">Nome</th>
              <th className="px-3 py-2 text-left">Perfil</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Último login</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                <td className="px-3 py-2">{u.name || '—'}</td>
                <td className="px-3 py-2">
                  <select
                    value={u.role}
                    disabled={u.id === me?.id}
                    onChange={(e) =>
                      update.mutate({ id: u.id, data: { role: e.target.value } })
                    }
                    className="input py-0.5 text-xs w-auto"
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="READER">READER</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  {u.active ? (
                    <span className="badge-free">
                      <ShieldCheck size={12} /> ativo
                    </span>
                  ) : (
                    <span className="badge-conf">
                      <Shield size={12} /> inativo
                    </span>
                  )}
                  {u.mustChangePwd && (
                    <span className="ml-2 text-xs text-amber-600">
                      precisa trocar senha
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {u.lastLoginAt
                    ? new Date(u.lastLoginAt).toLocaleString('pt-BR')
                    : 'nunca'}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => reset.mutate(u.id)}
                    title="Gerar link de reset"
                    className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 mr-1"
                  >
                    <KeyRound size={12} className="inline" /> reset
                  </button>
                  <button
                    onClick={() =>
                      update.mutate({ id: u.id, data: { active: !u.active } })
                    }
                    disabled={u.id === me?.id}
                    title={u.active ? 'Desativar' : 'Reativar'}
                    className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 mr-1"
                  >
                    <Power size={12} className="inline" /> {u.active ? 'desativar' : 'reativar'}
                  </button>
                  <button
                    onClick={() => {
                      if (demoTryWrite()) return;
                      if (confirm(`Remover ${u.email}?`)) remove.mutate(u.id);
                    }}
                    disabled={u.id === me?.id}
                    title="Remover"
                    className="text-rose-500 hover:text-rose-700 disabled:opacity-30 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onSubmit={(data) => create.mutate(data)}
          loading={create.isPending}
          error={create.error?.message}
        />
      )}
    </div>
  );
}

function ResetLinkBanner({ info, onClose }) {
  const link = `${window.location.origin}/reset?token=${info.token}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="card p-4 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
      <div className="flex items-start gap-3">
        <KeyRound size={18} className="text-amber-600 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            Token de {info.purpose} para <code>{info.email}</code>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input className="input font-mono text-xs" readOnly value={link} />
            <button
              onClick={() => {
                navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="btn-ghost"
            >
              {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              {copied ? 'copiado' : 'copiar'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Envie este link para o usuário. Válido por 7 dias e pode ser usado uma única vez.
          </p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          ×
        </button>
      </div>
    </div>
  );
}

function CreateUserModal({ onClose, onSubmit, loading, error }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'READER', password: '' });
  return (
    <div
      className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <form
        className="card p-6 w-full max-w-md space-y-3"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            ...form,
            password: form.password || undefined,
          });
        }}
      >
        <h2 className="font-semibold text-lg">Novo usuário</h2>
        {error && <div className="text-sm text-rose-600">{error}</div>}
        <div>
          <label className="block text-sm mb-1">E-mail</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Nome</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Perfil</label>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="input"
          >
            <option value="READER">READER (somente leitura)</option>
            <option value="ADMIN">ADMIN (acesso total)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">
            Senha inicial <span className="text-slate-400">(opcional)</span>
          </label>
          <input
            type="password"
            placeholder="vazio = gerar link de reset"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="input"
          />
          <p className="text-xs text-slate-500 mt-1">
            Se deixar em branco, o sistema vai gerar um link de definição de senha.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button className="btn-primary" disabled={loading}>
            {loading ? 'Criando…' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  );
}
