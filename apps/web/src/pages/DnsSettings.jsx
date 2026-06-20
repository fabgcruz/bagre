import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, Save, RefreshCcw, CheckCircle2, AlertCircle, Power, Eye, Globe } from 'lucide-react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { useToast } from '../components/Toast.jsx';

const PROVIDERS = [
  { id: 'powerdns', label: 'PowerDNS', impl: true, hint: 'DNS em sincronia automática com o inventário (API HTTP nativa)' },
  { id: 'bind', label: 'BIND', impl: false, hint: 'via nsupdate (próxima iteração)' },
  { id: 'route53', label: 'Route 53', impl: false, hint: 'AWS SDK (próxima iteração)' },
  { id: 'cloudflare', label: 'Cloudflare', impl: false, hint: 'API REST (próxima iteração)' },
];

export default function DnsSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: cfg, isLoading } = useQuery({ queryKey: ['dns-config'], queryFn: api.dnsConfig });
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (cfg && !form) {
      setForm({
        enabled: cfg.enabled,
        provider: cfg.provider || 'powerdns',
        baseUrl: cfg.baseUrl || '',
        apiKey: '',
        serverId: cfg.serverId || 'localhost',
        defaultZone: cfg.defaultZone || '',
        intervalMinutes: cfg.intervalMinutes ?? 60,
      });
    }
  }, [cfg, form]);

  const save = useMutation({
    mutationFn: api.updateDnsConfig,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dns-config'] }); toast.success('Configurações salvas.'); },
    onError: (e) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: api.testDnsConfig,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['dns-config'] }); r.ok ? toast.success(r.message) : toast.error(r.message); },
    onError: (e) => toast.error(e.message),
  });
  const previewMut = useMutation({
    mutationFn: api.dnsPreview,
    onError: (e) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: api.dnsSync,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['dns-config'] });
      toast.success(`Sync ok — aplicado ${r.applied} RRsets (criados ${r.toCreate.length}, atualizados ${r.toUpdate.length}, deletados ${r.toDelete.length})`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !form) return null;

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function onSave(e) {
    e.preventDefault();
    const payload = { ...form };
    if (!payload.apiKey) delete payload.apiKey;
    save.mutate(payload);
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="DNS sync (PowerDNS)"
        description="Mantenha o DNS sempre em sincronia com o inventário de IPs — automático, sem editar zona na mão."
      />

      <div className="card p-4 mb-5 border-l-4 border-l-blue-500 bg-blue-50/40 dark:bg-blue-900/10">
        <div className="flex gap-3">
          <Globe size={18} className="text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-navy-900 dark:text-white">A vantagem:</span> seu IPAM já sabe qual
            hostname pertence a cada IP. Em vez de manter o DNS na mão (e ele sempre desatualizar), o Bagre publica
            esses nomes como <span className="font-medium">registros A</span> na sua zona automaticamente — o DNS fica
            sempre batendo com o inventário, <span className="font-medium">sem drift e sem trabalho manual</span>. O
            Bagre só mexe nos registros que ele criou (marcados como gerenciados); seus registros manuais ficam intactos.
          </div>
        </div>
      </div>

      <div className="card p-5 mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Estado</h2>
              {cfg.enabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200"><Power size={11} /> ativo</span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-600 border border-slate-200"><Power size={11} /> inativo</span>
              )}
            </div>
            <div className="mt-2 text-xs text-slate-500 space-y-0.5">
              {cfg.lastTestedAt && (
                <div className="flex items-center gap-1">
                  {cfg.lastTestStatus === 'ok' ? <CheckCircle2 size={12} className="text-emerald-600" /> : <AlertCircle size={12} className="text-rose-600" />}
                  Último teste: {cfg.lastTestMessage || '—'}
                </div>
              )}
              {cfg.lastSyncAt && (
                <div className="flex items-center gap-1">
                  {cfg.lastSyncStatus === 'ok' ? <CheckCircle2 size={12} className="text-emerald-600" /> : <AlertCircle size={12} className="text-rose-600" />}
                  Última sync: {new Date(cfg.lastSyncAt).toLocaleString('pt-BR')} · {cfg.lastSyncMessage || '—'}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button onClick={() => test.mutate()} disabled={test.isPending || !cfg.baseUrl}
              className="text-xs px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-50">
              <Activity size={12} /> Testar conexão
            </button>
            <button onClick={() => previewMut.mutate()} disabled={previewMut.isPending || !cfg.defaultZone}
              className="text-xs px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-50">
              <Eye size={12} /> Preview diff
            </button>
            <button onClick={() => { if (confirm('Aplicar sync no PowerDNS agora?')) sync.mutate(); }} disabled={sync.isPending || !cfg.defaultZone}
              className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50">
              <RefreshCcw size={12} className={sync.isPending ? 'animate-spin' : ''} />
              {sync.isPending ? 'Sincronizando…' : 'Sync agora'}
            </button>
          </div>
        </div>
      </div>

      {previewMut.data && (
        <div className="card p-4 mb-5">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Preview do diff · zona {previewMut.data.zone}</div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded border border-emerald-200 bg-emerald-50/30 dark:bg-emerald-900/10 p-2">
              <div className="text-xs text-slate-500">A criar</div>
              <div className="text-2xl font-semibold text-emerald-700 tabular-nums">{previewMut.data.toCreate.length}</div>
            </div>
            <div className="rounded border border-amber-200 bg-amber-50/30 dark:bg-amber-900/10 p-2">
              <div className="text-xs text-slate-500">A atualizar</div>
              <div className="text-2xl font-semibold text-amber-700 tabular-nums">{previewMut.data.toUpdate.length}</div>
            </div>
            <div className="rounded border border-rose-200 bg-rose-50/30 dark:bg-rose-900/10 p-2">
              <div className="text-xs text-slate-500">A deletar</div>
              <div className="text-2xl font-semibold text-rose-700 tabular-nums">{previewMut.data.toDelete.length}</div>
            </div>
          </div>
          {previewMut.data.toCreate.length === 0 && previewMut.data.toUpdate.length === 0 && previewMut.data.toDelete.length === 0 && (
            <p className="text-xs text-slate-500 mt-2">Tudo já sincronizado.</p>
          )}
        </div>
      )}

      <form onSubmit={onSave} className="card p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Provider DNS</label>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button" onClick={() => p.impl && update('provider', p.id)}
                className={`text-left px-3 py-2 rounded border text-sm transition ${
                  form.provider === p.id
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                    : 'border-slate-200 hover:border-slate-300'
                } ${!p.impl ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <div className="flex items-center gap-1.5 font-medium"><Globe size={12} /> {p.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{p.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">URL da API</label>
          <input className="input w-full font-mono text-sm" placeholder="https://powerdns.empresa.local:8081/api/v1" value={form.baseUrl} onChange={(e) => update('baseUrl', e.target.value)} />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">API Key (X-API-Key)</label>
          <input type="password" className="input w-full font-mono text-sm" placeholder={cfg.hasApiKey ? '(salva — deixe vazio pra manter)' : '••••••••'} value={form.apiKey} onChange={(e) => update('apiKey', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Server ID</label>
            <input className="input w-full font-mono text-sm" placeholder="localhost" value={form.serverId} onChange={(e) => update('serverId', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Intervalo (min)</label>
            <input type="number" min="5" className="input w-full text-sm" value={form.intervalMinutes} onChange={(e) => update('intervalMinutes', Number(e.target.value))} />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Zona padrão</label>
          <input className="input w-full font-mono text-sm" placeholder="internal.empresa.local." value={form.defaultZone} onChange={(e) => update('defaultZone', e.target.value)} />
          <p className="text-[11px] text-slate-500 mt-1">Pode incluir o ponto final (padrão PowerDNS). Os hostnames do Bagre vão virar <code>&lt;hostname&gt;.&lt;zona&gt;</code>.</p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.enabled} onChange={(e) => update('enabled', e.target.checked)} className="accent-brand-600" />
          <span className="text-sm">Sync automático ativo</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button type="submit" disabled={save.isPending} className="btn-primary inline-flex items-center gap-1 disabled:opacity-50">
            <Save size={14} /> {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  );
}
