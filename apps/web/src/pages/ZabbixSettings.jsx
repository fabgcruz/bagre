import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Save,
  RefreshCcw,
  CheckCircle2,
  AlertCircle,
  Power,
  Database,
} from 'lucide-react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { useToast } from '../components/Toast.jsx';

export default function ZabbixSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: cfg, isLoading } = useQuery({
    queryKey: ['zabbix-config'],
    queryFn: api.zabbixConfig,
  });
  const [form, setForm] = useState(null);
  const [groupsCsv, setGroupsCsv] = useState('');

  useEffect(() => {
    if (cfg && !form) {
      setForm({
        enabled: cfg.enabled,
        url: cfg.url || '',
        apiToken: '',
        username: cfg.username || '',
        password: '',
        intervalMinutes: cfg.intervalMinutes ?? 15,
        staleAfterDays: cfg.staleAfterDays ?? 7,
      });
      setGroupsCsv((cfg.groupFilter || []).join(', '));
    }
  }, [cfg, form]);

  const save = useMutation({
    mutationFn: api.updateZabbixConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zabbix-config'] });
      toast.success('Configurações salvas.');
    },
    onError: (e) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: api.testZabbixConfig,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['zabbix-config'] });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
    onError: (e) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: api.syncZabbix,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['zabbix-config'] });
      qc.invalidateQueries({ queryKey: ['network-health'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success(
        `Sincronizado: ${r.hosts} hosts · ${r.updated} IPs atualizados · ${r.ghosts?.length || 0} fantasmas`,
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const enable = useMutation({
    mutationFn: () => api.updateZabbixConfig({ enabled: !form.enabled }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['zabbix-config'] });
      setForm((f) => ({ ...f, enabled: r.enabled }));
      toast.success(r.enabled ? 'Sincronização automática ativada' : 'Sincronização automática desativada');
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !form) return <p className="text-slate-500">Carregando…</p>;

  const submit = (e) => {
    e.preventDefault();
    const data = {
      url: form.url.trim(),
      username: form.username.trim() || null,
      intervalMinutes: Number(form.intervalMinutes) || 15,
      staleAfterDays: Number(form.staleAfterDays) || 7,
      groupFilter: groupsCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (form.apiToken) data.apiToken = form.apiToken;
    if (form.password) data.password = form.password;
    save.mutate(data);
  };

  const fullyConfigured =
    cfg?.url && (cfg?.hasApiToken || (cfg?.username && cfg?.hasPassword));

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Integração com Zabbix"
        description="O Zabbix já monitora seus hosts. Esta integração lê o que ele sabe e atualiza o IPAM automaticamente — hostnames, status, presença na rede. Zero carga adicional: só leitura via API."
        actions={
          <button
            onClick={() => enable.mutate()}
            disabled={!fullyConfigured || enable.isPending}
            className={form.enabled ? 'btn-danger' : 'btn-primary'}
            title={!fullyConfigured ? 'Configure URL e token antes de habilitar' : ''}
          >
            <Power size={14} />
            {form.enabled ? 'Pausar' : 'Habilitar sincronização'}
          </button>
        }
      />

      <StatusBanner cfg={cfg} fullyConfigured={fullyConfigured} />

      <form onSubmit={submit} className="space-y-5">
        <Section title="Conexão">
          <Field
            label="URL do Zabbix"
            hint="Sem /api_jsonrpc.php no final. Ex: https://zabbix.empresa.local"
          >
            <input
              required
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://zabbix.empresa.local"
              className="input font-mono text-xs"
            />
          </Field>
          <Field
            label="API Token (recomendado)"
            hint={
              cfg?.hasApiToken
                ? 'Token salvo. Deixe em branco para manter, ou cole um novo.'
                : 'Zabbix 5.4+ → Users → API tokens. Permissão somente leitura é suficiente.'
            }
          >
            <input
              type="password"
              value={form.apiToken}
              onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
              placeholder={cfg?.hasApiToken ? '•••••••• (mantém o atual)' : ''}
              className="input"
            />
          </Field>
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-800">
              ou usar usuário/senha (Zabbix antigo)
            </summary>
            <div className="mt-3 space-y-3 pl-4 border-l-2 border-slate-100 dark:border-slate-700">
              <Field label="Usuário">
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Senha">
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={cfg?.hasPassword ? '•••••••• (mantém a atual)' : ''}
                  className="input"
                />
              </Field>
            </div>
          </details>
        </Section>

        <Section title="Sincronização">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Intervalo (minutos)"
              hint="A cada X minutos o IPAM lê o Zabbix automaticamente."
            >
              <input
                type="number"
                min="1"
                value={form.intervalMinutes}
                onChange={(e) => setForm({ ...form, intervalMinutes: e.target.value })}
                className="input"
              />
            </Field>
            <Field
              label="Marcar como stale após (dias)"
              hint="IP marcado USED que o Zabbix não vê há mais que isso vira ⚠️ stale."
            >
              <input
                type="number"
                min="1"
                value={form.staleAfterDays}
                onChange={(e) => setForm({ ...form, staleAfterDays: e.target.value })}
                className="input"
              />
            </Field>
          </div>
          <Field
            label="Filtrar por grupos do Zabbix (opcional)"
            hint="Deixe vazio para sincronizar todos os hosts. Nomes separados por vírgula."
          >
            <input
              value={groupsCsv}
              onChange={(e) => setGroupsCsv(e.target.value)}
              placeholder="Production, Equinix-SP3, Customer X"
              className="input"
            />
          </Field>
        </Section>

        <div className="flex items-center gap-2 sticky bottom-0 bg-white/90 dark:bg-slate-900/80 backdrop-blur p-3 rounded-xl border border-slate-100 dark:border-slate-800">
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            <Save size={14} />
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={() => test.mutate()}
            className="btn-ghost"
            disabled={test.isPending}
          >
            <Activity size={14} />
            {test.isPending ? 'Testando…' : 'Testar conexão'}
          </button>
          <button
            type="button"
            onClick={() => sync.mutate()}
            className="btn-ghost"
            disabled={sync.isPending || !fullyConfigured}
            title={!fullyConfigured ? 'Configure tudo antes' : ''}
          >
            <RefreshCcw
              size={14}
              className={sync.isPending ? 'animate-spin' : ''}
            />
            {sync.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
          {cfg?.lastTestedAt && (
            <span className="text-xs text-slate-500 ml-auto">
              último teste:{' '}
              <span
                className={
                  cfg.lastTestStatus === 'ok' ? 'text-emerald-600' : 'text-rose-600'
                }
              >
                {cfg.lastTestStatus === 'ok' ? '✓' : '✗'}{' '}
                {new Date(cfg.lastTestedAt).toLocaleString('pt-BR')}
              </span>
            </span>
          )}
        </div>

        {cfg?.lastSyncAt && (
          <Section title="Última sincronização">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat
                label="Quando"
                value={new Date(cfg.lastSyncAt).toLocaleString('pt-BR')}
              />
              <Stat
                label="Status"
                value={
                  <span
                    className={
                      cfg.lastSyncStatus === 'ok' ? 'text-emerald-600' : 'text-rose-600'
                    }
                  >
                    {cfg.lastSyncStatus === 'ok' ? '✓ OK' : '✗ erro'}
                  </span>
                }
              />
              <Stat
                label="Mensagem"
                value={
                  <span className="text-xs">{cfg.lastSyncMessage || '—'}</span>
                }
              />
              {cfg.lastSyncStats && (
                <Stat
                  label="Estatísticas"
                  value={
                    <span className="text-xs font-mono">
                      {cfg.lastSyncStats.hosts ?? 0}h /{' '}
                      {cfg.lastSyncStats.updated ?? 0} upd /{' '}
                      {(cfg.lastSyncStats.ghosts || []).length} 👻
                    </span>
                  }
                />
              )}
            </div>
          </Section>
        )}
      </form>
    </div>
  );
}

function StatusBanner({ cfg, fullyConfigured }) {
  if (!cfg) return null;
  if (cfg.enabled && fullyConfigured) {
    return (
      <div className="card p-4 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 flex items-start gap-3">
        <CheckCircle2 size={18} className="text-emerald-600 mt-0.5" />
        <div className="text-sm">
          <strong>Sincronização ativa.</strong> O IPAM lê o Zabbix automaticamente a
          cada {cfg.intervalMinutes} minutos.
        </div>
      </div>
    );
  }
  if (!fullyConfigured) {
    return (
      <div className="card p-4 border-slate-200 flex items-start gap-3">
        <Database size={18} className="text-slate-400 mt-0.5" />
        <div className="text-sm">
          <strong>Não configurado.</strong> Preencha a URL e o token, e clique em{' '}
          <em>Testar conexão</em>. O botão <em>Habilitar sincronização</em> destrava
          quando os campos obrigatórios estiverem preenchidos.
        </div>
      </div>
    );
  }
  return (
    <div className="card p-4 border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 flex items-start gap-3">
      <AlertCircle size={18} className="text-amber-600 mt-0.5" />
      <div className="text-sm">
        <strong>Configurado, mas pausado.</strong> Use <em>Habilitar sincronização</em>{' '}
        no topo, ou rode manualmente com <em>Sincronizar agora</em>.
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="card p-5 space-y-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md bg-slate-50 dark:bg-slate-800 p-2">
      <div className="text-[10px] uppercase text-slate-400 tracking-wider">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
