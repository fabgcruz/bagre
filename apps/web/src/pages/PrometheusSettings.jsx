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

export default function PrometheusSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: cfg, isLoading } = useQuery({
    queryKey: ['prometheus-config'],
    queryFn: api.prometheusConfig,
  });
  // No ambiente de demonstração tudo é somente-leitura (a API bloqueia toda
  // escrita). Desabilitamos salvar/testar/sincronizar e os campos do form.
  const { data: appCfg } = useQuery({
    queryKey: ['app-config'],
    queryFn: api.config,
    staleTime: 60_000,
  });
  const demo = !!appCfg?.demo?.enabled;
  const [form, setForm] = useState(null);
  const [jobsCsv, setJobsCsv] = useState('');

  useEffect(() => {
    if (cfg && !form) {
      setForm({
        enabled: cfg.enabled,
        url: cfg.url || '',
        authType: cfg.authType || 'none',
        bearerToken: '',
        basicUsername: cfg.basicUsername || '',
        basicPassword: '',
        intervalMinutes: cfg.intervalMinutes ?? 15,
        staleAfterDays: cfg.staleAfterDays ?? 7,
      });
      setJobsCsv((cfg.jobFilter || []).join(', '));
    }
  }, [cfg, form]);

  const save = useMutation({
    mutationFn: api.updatePrometheusConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prometheus-config'] });
      toast.success('Configurações salvas.');
    },
    onError: (e) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: api.testPrometheusConfig,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['prometheus-config'] });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
    onError: (e) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: api.syncPrometheus,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['prometheus-config'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success(
        `Sincronizado: ${r.targets} targets · ${r.updated} IPs atualizados · ${r.ghosts?.length || 0} fantasmas`,
      );
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !form) return null;

  function update(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function onSave(e) {
    e.preventDefault();
    const payload = {
      ...form,
      jobFilter: jobsCsv.split(',').map((s) => s.trim()).filter(Boolean),
    };
    // Não envia secrets vazios — backend mantém o existente
    if (!payload.bearerToken) delete payload.bearerToken;
    if (!payload.basicPassword) delete payload.basicPassword;
    save.mutate(payload);
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Prometheus discovery"
        description="Conecte ao seu Prometheus pra descobrir hosts automaticamente a partir de /api/v1/targets. Targets viram pending discoveries (mesmo fluxo do Zabbix)."
      />

      <div className="card p-5 mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Estado da conexão</h2>
              {cfg.enabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Power size={11} /> ativa
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-600 border border-slate-200">
                  <Power size={11} /> inativa
                </span>
              )}
            </div>
            <div className="mt-2 text-xs text-slate-500 space-y-0.5">
              {cfg.lastTestedAt && (
                <div className="flex items-center gap-1">
                  {cfg.lastTestStatus === 'ok' ? (
                    <CheckCircle2 size={12} className="text-emerald-600" />
                  ) : (
                    <AlertCircle size={12} className="text-rose-600" />
                  )}
                  Último teste: {cfg.lastTestMessage || '—'}
                </div>
              )}
              {cfg.lastSyncAt && (
                <div className="flex items-center gap-1">
                  {cfg.lastSyncStatus === 'ok' ? (
                    <CheckCircle2 size={12} className="text-emerald-600" />
                  ) : (
                    <AlertCircle size={12} className="text-rose-600" />
                  )}
                  Última sync: {new Date(cfg.lastSyncAt).toLocaleString('pt-BR')} · {cfg.lastSyncMessage || '—'}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => test.mutate()}
              disabled={demo || test.isPending || !cfg.url}
              title={demo ? 'Desabilitado no ambiente de demonstração' : ''}
              className="text-xs px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Activity size={12} /> Testar conexão
            </button>
            <button
              onClick={() => sync.mutate()}
              disabled={demo || sync.isPending || !cfg.url}
              title={demo ? 'Desabilitado no ambiente de demonstração' : ''}
              className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCcw size={12} className={sync.isPending ? 'animate-spin' : ''} />
              {sync.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={onSave} className="card p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">URL do Prometheus</label>
          <input
            disabled={demo}
            className="input w-full font-mono text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            placeholder="http://prometheus.empresa.local:9090"
            value={form.url}
            onChange={(e) => update('url', e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Autenticação</label>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { id: 'none', label: 'Nenhuma', hint: 'Prometheus sem auth' },
              { id: 'bearer', label: 'Bearer', hint: 'Token Authorization' },
              { id: 'basic', label: 'Basic', hint: 'User + password' },
            ].map((opt) => (
              <button
                type="button"
                key={opt.id}
                disabled={demo}
                onClick={() => update('authType', opt.id)}
                className={`text-left px-3 py-2 rounded border text-sm transition disabled:opacity-60 disabled:cursor-not-allowed ${
                  form.authType === opt.id
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="font-medium">{opt.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{opt.hint}</div>
              </button>
            ))}
          </div>

          {form.authType === 'bearer' && (
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Bearer token</label>
              <input
                type="password"
                disabled={demo}
                className="input w-full font-mono text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                placeholder={cfg.hasBearerToken ? '(salvo — deixe vazio pra manter)' : '••••••••'}
                value={form.bearerToken}
                onChange={(e) => update('bearerToken', e.target.value)}
              />
            </div>
          )}

          {form.authType === 'basic' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Usuário</label>
                <input
                  disabled={demo}
                  className="input w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  value={form.basicUsername}
                  onChange={(e) => update('basicUsername', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Senha</label>
                <input
                  type="password"
                  disabled={demo}
                  className="input w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  placeholder={cfg.hasBasicPassword ? '(salva — deixe vazio pra manter)' : '••••••••'}
                  value={form.basicPassword}
                  onChange={(e) => update('basicPassword', e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">
            Filtro de jobs (CSV, vazio = todos)
          </label>
          <input
            disabled={demo}
            className="input w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            placeholder="ex: node, kubernetes, snmp"
            value={jobsCsv}
            onChange={(e) => setJobsCsv(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Intervalo de sync (min)</label>
            <input
              type="number"
              min="1"
              disabled={demo}
              className="input w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              value={form.intervalMinutes}
              onChange={(e) => update('intervalMinutes', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Considerar ghost após (dias sem ver)</label>
            <input
              type="number"
              min="1"
              disabled={demo}
              className="input w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              value={form.staleAfterDays}
              onChange={(e) => update('staleAfterDays', Number(e.target.value))}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            disabled={demo}
            checked={form.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
            className="accent-brand-600 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <span className="text-sm">Sync automático ativo (roda a cada {form.intervalMinutes} min)</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          {demo && (
            <p className="text-xs text-slate-400 mr-auto">
              Configuração somente leitura no ambiente de demonstração.
            </p>
          )}
          <button
            type="submit"
            disabled={demo || save.isPending}
            title={demo ? 'Desabilitado no ambiente de demonstração' : ''}
            className="btn-primary inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={14} />
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>

      {cfg.lastSyncStats && (
        <div className="card p-4 mt-5">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2 inline-flex items-center gap-1.5">
            <Database size={12} /> Última execução
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Targets" value={cfg.lastSyncStats.targets} />
            <Stat label="Atualizados" value={cfg.lastSyncStats.updated} />
            <Stat label="Pending criados" value={cfg.lastSyncStats.pendingCreated} />
            <Stat label="Jobs" value={cfg.lastSyncStats.jobs?.length} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold tabular-nums">{value ?? '—'}</div>
    </div>
  );
}
