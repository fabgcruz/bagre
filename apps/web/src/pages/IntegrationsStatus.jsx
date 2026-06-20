import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Power,
  RefreshCw,
  Settings2,
  Clock,
  Activity,
  Globe,
  Building2,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { useToast } from '../components/Toast.jsx';

function fmtAge(date) {
  if (!date) return 'nunca';
  const ms = Date.now() - new Date(date).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function statusOf(integration) {
  if (!integration.configured) return 'idle';
  if (!integration.enabled) return 'paused';
  if (integration.lastTest?.ok === false) return 'error';
  if (integration.lastSync?.ok === false) return 'error';
  if (integration.enabled && !integration.lastSync && !integration.lastTest) return 'pending';
  return 'ok';
}

const STATUS_BADGE = {
  ok: { label: 'Funcionando', tone: 'emerald', icon: CheckCircle2 },
  error: { label: 'Com erro', tone: 'rose', icon: AlertCircle },
  paused: { label: 'Configurado · pausado', tone: 'amber', icon: AlertTriangle },
  pending: { label: 'Aguardando primeira execução', tone: 'amber', icon: Clock },
  idle: { label: 'Não configurado', tone: 'slate', icon: Settings2 },
};

const TONE_CLASSES = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  slate: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

const ENTITY_LABELS = {
  zabbix_config: 'Zabbix',
  prometheus_config: 'Prometheus',
  dns_config: 'DNS',
  oidc_config: 'Microsoft Entra',
  user: 'Login',
};
const ACTION_LABELS = {
  sync: 'Sincronizou',
  update: 'Editou config',
  login: 'Login',
};

export default function IntegrationsStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['integrations-status'],
    queryFn: api.integrationsStatus,
    refetchInterval: 15_000,
  });

  // Live test (per integration) hits the /test endpoint of each provider.
  const testZabbix = useMutation({
    mutationFn: api.testZabbixConfig,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['integrations-status'] });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
  });
  const testPrometheus = useMutation({
    mutationFn: api.testPrometheusConfig,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['integrations-status'] });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
  });
  const testDns = useMutation({
    mutationFn: api.testDnsConfig,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['integrations-status'] });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
  });
  const testOidc = useMutation({
    mutationFn: api.testOidcConfig,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['integrations-status'] });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
  });
  const testLdap = useMutation({
    mutationFn: api.testLdapConfig,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['integrations-status'] });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
  });

  const overall = data?.overall;
  const integrations = data?.integrations || [];

  // re-render to refresh "há X min"
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <PageHeader
        title="Status das integrações"
        description="Visão consolidada da saúde de cada conector externo. Atualizado a cada 15 segundos."
        actions={
          <button onClick={() => refetch()} className="btn-ghost" disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            Atualizar
          </button>
        }
      />

      {overall && <OverallBanner overall={overall} integrations={integrations} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {integrations.map((i) => (
          <IntegrationCard
            key={i.key}
            integration={i}
            onTest={() => {
              if (i.key === 'zabbix') testZabbix.mutate();
              else if (i.key === 'prometheus') testPrometheus.mutate();
              else if (i.key === 'dns') testDns.mutate();
              else if (i.key === 'oidc') testOidc.mutate();
              else if (i.key === 'ldap') testLdap.mutate();
            }}
            testing={
              (i.key === 'zabbix' && testZabbix.isPending) ||
              (i.key === 'prometheus' && testPrometheus.isPending) ||
              (i.key === 'dns' && testDns.isPending) ||
              (i.key === 'oidc' && testOidc.isPending) ||
              (i.key === 'ldap' && testLdap.isPending)
            }
          />
        ))}
      </div>

      <section className="card overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <Activity size={14} className="text-slate-400" />
          <h3 className="font-semibold text-sm">Eventos recentes</h3>
        </header>
        {!data?.events?.length ? (
          <p className="p-6 text-sm text-slate-500 text-center">
            Nenhum evento registrado ainda.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.events.map((e) => (
              <li key={e.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                <span className="text-xs text-slate-400 w-20">{fmtAge(e.createdAt)}</span>
                <span className="text-xs font-mono text-slate-500">
                  {e.actor || 'sistema'}
                </span>
                <span className="text-xs text-slate-400">·</span>
                <span className="text-slate-700 dark:text-slate-300 text-sm">
                  <strong>{ACTION_LABELS[e.action] || e.action}</strong>{' '}
                  {ENTITY_LABELS[e.entity] || e.entity}
                </span>
                {e.after?.updated !== undefined && (
                  <span className="text-xs text-slate-500 ml-auto">
                    {e.after.updated} IPs · {e.after.ghosts?.length || 0} fantasmas
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OverallBanner({ overall, integrations }) {
  const tones = {
    ok: { cls: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800', icon: CheckCircle2, iconCls: 'text-emerald-500' },
    warn: { cls: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800', icon: AlertTriangle, iconCls: 'text-amber-500' },
    error: { cls: 'bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-800', icon: AlertCircle, iconCls: 'text-rose-500' },
    idle: { cls: 'bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700', icon: Settings2, iconCls: 'text-slate-400' },
  };
  const t = tones[overall.tone] || tones.idle;
  const Icon = t.icon;
  const active = integrations.filter((i) => i.enabled && i.configured).length;
  const errors = integrations.filter((i) => i.lastTest?.ok === false || i.lastSync?.ok === false).length;

  return (
    <div className={`card p-5 mb-6 border ${t.cls} flex items-center gap-4`}>
      <Icon size={28} className={t.iconCls} />
      <div className="flex-1">
        <div className="font-semibold">{overall.label}</div>
        <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          {active} de {integrations.length} integrações ativas
          {errors > 0 && <> · <span className="text-rose-600">{errors} com erro</span></>}
        </div>
      </div>
    </div>
  );
}

// Logos das integrações. Prometheus e OpenID têm logo oficial (paths do
// simple-icons, marca preservada na cor original). Zabbix e PowerDNS não estão
// no simple-icons (restrição de marca), então usam um ícone limpo na cor da
// marca como fallback. O emoji da config vira último fallback.
const SI_PROMETHEUS =
  'M12 0C5.373 0 0 5.372 0 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-6.628-5.373-12-12-12zm0 22.46c-1.885 0-3.414-1.26-3.414-2.814h6.828c0 1.553-1.528 2.813-3.414 2.813zm5.64-3.745H6.36v-2.046h11.28v2.046zm-.04-3.098H6.391c-.037-.043-.075-.086-.111-.13-1.155-1.401-1.427-2.133-1.69-2.879-.005-.025 1.4.287 2.395.511 0 0 .513.119 1.262.255-.72-.843-1.147-1.915-1.147-3.01 0-2.406 1.845-4.508 1.18-6.207.648.053 1.34 1.367 1.387 3.422.689-.951.977-2.69.977-3.755 0-1.103.727-2.385 1.454-2.429-.648 1.069.168 1.984.894 4.256.272.854.237 2.29.447 3.201.07-1.892.395-4.652 1.595-5.605-.529 1.2.079 2.702.494 3.424.671 1.164 1.078 2.047 1.078 3.716a4.642 4.642 0 01-1.11 2.996c.792-.149 1.34-.283 1.34-.283l2.573-.502s-.374 1.538-1.81 3.019z';
const SI_OPENID =
  'M14.54.889l-3.63 1.773v18.17c-4.15-.52-7.27-2.78-7.27-5.5 0-2.58 2.8-4.75 6.63-5.41v-2.31C4.42 8.322 0 11.502 0 15.332c0 3.96 4.74 7.24 10.91 7.78l3.63-1.71V.888m.64 6.724v2.31c1.43.25 2.71.7 3.76 1.31l-1.97 1.11 7.03 1.53-.5-5.21-1.87 1.06c-1.74-1.06-3.96-1.81-6.45-2.11z';

function BrandSvg({ path, color }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill={color} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function IntegrationLogo({ k, fallback }) {
  switch (k) {
    case 'prometheus':
      return <BrandSvg path={SI_PROMETHEUS} color="#E6522C" />;
    case 'oidc':
      return <BrandSvg path={SI_OPENID} color="#F78C40" />;
    case 'zabbix':
      // Zabbix não está no simple-icons; ícone de monitoramento na cor da marca.
      return <Activity size={26} strokeWidth={2.4} style={{ color: '#D40000' }} />;
    case 'dns':
      return <Globe size={26} strokeWidth={2.2} style={{ color: '#2F6FED' }} />;
    case 'ldap':
      return <Building2 size={26} strokeWidth={2.2} style={{ color: '#4F46E5' }} />;
    default:
      return <span className="text-2xl leading-none">{fallback}</span>;
  }
}

function IntegrationCard({ integration, onTest, testing }) {
  const status = statusOf(integration);
  const badge = STATUS_BADGE[status];
  const BadgeIcon = badge.icon;

  return (
    <article className="card p-5 flex flex-col gap-3">
      <header className="flex items-start gap-3">
        <div className="flex h-7 w-7 items-center justify-center shrink-0">
          <IntegrationLogo k={integration.key} fallback={integration.icon} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">{integration.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{integration.description}</p>
        </div>
        <span className={`badge inline-flex items-center gap-1.5 px-2.5 py-1 ${TONE_CLASSES[badge.tone]}`}>
          <BadgeIcon size={12} />
          {badge.label}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-slate-100 dark:border-slate-800 pt-3">
        {integration.lastTest && (
          <>
            <dt className="text-xs text-slate-400 uppercase tracking-wider">Último teste</dt>
            <dd className="text-right">
              <span className={integration.lastTest.ok ? 'text-emerald-600' : 'text-rose-600'}>
                {integration.lastTest.ok ? '✓' : '✗'}
              </span>{' '}
              <span className="text-xs">{fmtAge(integration.lastTest.at)}</span>
            </dd>
          </>
        )}
        {integration.lastSync && (
          <>
            <dt className="text-xs text-slate-400 uppercase tracking-wider">Última sync</dt>
            <dd className="text-right">
              <span className={integration.lastSync.ok ? 'text-emerald-600' : 'text-rose-600'}>
                {integration.lastSync.ok ? '✓' : '✗'}
              </span>{' '}
              <span className="text-xs">{fmtAge(integration.lastSync.at)}</span>
              {integration.intervalMinutes && (
                <span className="block text-[10px] text-slate-400">
                  intervalo {integration.intervalMinutes} min
                </span>
              )}
            </dd>
          </>
        )}
        {integration.lastSync?.stats && (
          <>
            <dt className="text-xs text-slate-400 uppercase tracking-wider">Última leitura</dt>
            <dd className="text-right text-xs font-mono">
              {integration.lastSync.stats.hosts ?? integration.lastSync.stats.targets ?? 0} descobertos ·{' '}
              {integration.lastSync.stats.updated ?? 0} já no IPAM
            </dd>
            {(integration.lastSync.stats.ghosts || []).length > 0 && (
              <>
                <dt className="text-xs text-slate-400 uppercase tracking-wider">A aprovar</dt>
                <dd className="text-right">
                  <Link
                    to="/admin/pending-discoveries"
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    {(integration.lastSync.stats.ghosts || []).length} hosts em Aprovações →
                  </Link>
                </dd>
              </>
            )}
          </>
        )}
        {integration.ipsTouched > 0 && (
          <>
            <dt className="text-xs text-slate-400 uppercase tracking-wider">IPs alimentados</dt>
            <dd className="text-right text-sm font-medium">{integration.ipsTouched}</dd>
          </>
        )}
      </dl>

      {(integration.lastTest?.ok === false || integration.lastSync?.ok === false) && (
        <div className="text-xs bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 p-2 rounded-md border border-rose-200 dark:border-rose-800">
          {integration.lastTest?.message || integration.lastSync?.message}
        </div>
      )}

      <footer className="flex items-center gap-2 mt-auto pt-2">
        {integration.configured && (
          <button onClick={onTest} disabled={testing} className="btn-ghost">
            <Activity size={13} className={testing ? 'animate-pulse' : ''} />
            {testing ? 'Testando…' : 'Testar agora'}
          </button>
        )}
        <Link to={integration.configUrl} className="btn-ghost ml-auto">
          <Settings2 size={13} />
          {integration.configured ? 'Configurar' : 'Conectar'}
          <ExternalLink size={11} />
        </Link>
      </footer>
    </article>
  );
}

