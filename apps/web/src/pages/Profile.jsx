import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, KeyRound, Lock } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import AuthProviderBadge from '../components/AuthProviderBadge.jsx';

export default function Profile() {
  const { user, refresh } = useAuth();
  const { data: cfg } = useQuery({ queryKey: ['app-config'], queryFn: api.config, staleTime: 60_000 });
  const isDemo = !!cfg?.demo?.enabled;
  const [params] = useSearchParams();
  const force = params.get('force') === '1';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    if (next !== confirm) {
      setErr('As senhas não conferem');
      return;
    }
    if (next.length < 8) {
      setErr('Mínimo 8 caracteres');
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(current, next);
      setMsg('Senha atualizada.');
      setCurrent('');
      setNext('');
      setConfirm('');
      await refresh();
      if (force) setTimeout(() => navigate('/'), 800);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <PageHeader
        title="Meu perfil"
        description={
          <>
            Você está logado como <span className="font-medium">{user?.email}</span> ·{' '}
            <span className="font-mono text-xs">{user?.role}</span>
          </>
        }
      />

      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium text-slate-700 dark:text-slate-200">Origem da conta</div>
            <div className="text-slate-500 text-xs mt-0.5">
              {user?.authProvider === 'ldap'
                ? 'Sua sessão foi autenticada contra o diretório (LDAP/Active Directory).'
                : user?.authProvider === 'oidc'
                  ? 'Sua sessão foi autenticada via SSO (OIDC).'
                  : 'Conta local — autenticada pelo Bagre.'}
            </div>
          </div>
          <AuthProviderBadge
            provider={user?.authProvider}
            externalId={user?.externalId}
            groups={user?.externalGroups}
            detail
          />
        </div>
      </div>

      {force && (
        <div className="card p-4 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-start gap-2 text-sm">
            <AlertCircle size={16} className="text-amber-500 mt-0.5" />
            <div>
              <strong>Troca de senha obrigatória.</strong> Você precisa definir
              uma nova senha antes de continuar.
            </div>
          </div>
        </div>
      )}

      {isDemo ? (
        <div className="card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <Lock size={18} /> Ambiente de demonstração
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Este é um ambiente público e <strong>somente leitura</strong>. A troca de senha e a
            gestão de conta ficam desabilitadas para todos os usuários. Os dados são reiniciados
            diariamente às 04h (BRT).
          </p>
        </div>
      ) : (
      <form onSubmit={submit} className="card p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <KeyRound size={18} /> Trocar senha
        </h2>
        {err && (
          <div className="flex items-start gap-2 text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/30 dark:text-rose-300 p-2 rounded">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}
        {msg && (
          <div className="flex items-start gap-2 text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300 p-2 rounded">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <span>{msg}</span>
          </div>
        )}
        <div>
          <label className="block text-sm mb-1">Senha atual</label>
          <input
            type="password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Nova senha</label>
          <input
            type="password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Confirme a nova senha</label>
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="input"
          />
        </div>
        <button className="btn-primary" disabled={loading}>
          {loading ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
      )}
    </div>
  );
}
