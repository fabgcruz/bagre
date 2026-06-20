import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Cloud,
  CheckCircle2,
  AlertCircle,
  Clock,
  Plus,
  RefreshCw,
  Play,
  Trash2,
  Copy,
  ExternalLink,
  DollarSign,
  ChevronDown,
  ChevronRight,
  X,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { api, demoTryWrite } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';

const PROVIDER_INFO = {
  AWS: {
    name: 'Amazon Web Services',
    color: 'bg-orange-50 text-orange-700 border-orange-200',
    scopeLabel: 'AWS Account ID',
    scopePlaceholder: '123456789012',
    defaultRegions: ['us-east-1'],
    regionsHint: 'us-east-1, sa-east-1, eu-west-1, …',
    policy: `{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ec2:DescribeSubnets",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeAddresses",
      "sts:GetCallerIdentity"
    ],
    "Resource": "*"
  }]
}`,
  },
  AZURE: {
    name: 'Microsoft Azure',
    color: 'bg-sky-50 text-sky-700 border-sky-200',
    scopeLabel: 'Subscription ID',
    scopePlaceholder: '00000000-0000-0000-0000-000000000000',
    defaultRegions: [],
    regionsHint: 'Não usado — Azure descobre via subscription',
    policy: `Crie um App Registration em Microsoft Entra ID,
gere um client secret, e atribua a role "Reader"
do escopo da subscription (ou uma custom role com
exatamente estas 4 actions):

  Microsoft.Network/virtualNetworks/read
  Microsoft.Network/virtualNetworks/subnets/read
  Microsoft.Network/networkInterfaces/read
  Microsoft.Network/publicIPAddresses/read`,
  },
  GCP: {
    name: 'Google Cloud Platform',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    scopeLabel: 'Project ID',
    scopePlaceholder: 'my-gcp-project',
    defaultRegions: [],
    regionsHint: 'Não usado — GCP descobre via aggregated/* do projeto',
    policy: `Crie uma Service Account no projeto e atribua a role
"Compute Network Viewer" (ou role custom com as 3 actions):

  compute.subnetworks.list
  compute.instances.list
  compute.addresses.list

Gere uma chave JSON da service account
(Console → IAM → Service Accounts → Keys → Add Key)
e cole o conteúdo inteiro do arquivo no campo abaixo.`,
  },
};

function fmtAge(date) {
  if (!date) return 'nunca sincronizado';
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

function fmtMoney(usd) {
  if (!usd && usd !== 0) return '—';
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function StatusPill({ status, lastError }) {
  const cfg = {
    ACTIVE: { label: 'Funcionando', tone: 'emerald', Icon: CheckCircle2 },
    ERROR: { label: 'Com erro', tone: 'rose', Icon: AlertCircle },
    PAUSED: { label: 'Pausado', tone: 'amber', Icon: Clock },
    DISABLED: { label: 'Desativado', tone: 'slate', Icon: Clock },
  }[status] || { label: status, tone: 'slate', Icon: Clock };
  const TONES = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${TONES[cfg.tone]}`}
      title={lastError || cfg.label}
    >
      <cfg.Icon size={12} />
      {cfg.label}
    </span>
  );
}

function CopyButton({ text, label = 'Copiar' }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      <Copy size={12} />
      {copied ? 'Copiado!' : label}
    </button>
  );
}

function FinOpsHero({ data, isLoading, hasAccounts }) {
  if (isLoading) {
    return <div className="card p-5 mb-6 animate-pulse h-28" />;
  }
  const total = data?.summary?.estimatedMonthlyCostUsd ?? 0;
  const idleCount = data?.summary?.idleCount ?? 0;
  const totalPublic = data?.summary?.totalPublicIps ?? 0;

  // 1) Sem dados pra auditar (sem conta conectada OU contas sem sync)
  if (!hasAccounts || totalPublic === 0) {
    return (
      <div className="card p-5 mb-6 border-l-4 border-l-slate-300 bg-slate-50/40 dark:bg-slate-800/40">
        <div className="flex items-center gap-4">
          <DollarSign size={32} className="text-slate-400" />
          <div className="flex-1">
            <div className="text-lg font-semibold">
              Auditoria de IPs públicos cloud
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              {hasAccounts
                ? 'Sincronize uma conta cloud (botão Sync agora no card abaixo) para começar a auditar quais IPs públicos podem ser liberados.'
                : 'Conecte sua primeira conta cloud (AWS / Azure / GCP) para ver todos os IPs públicos alocados e avaliar quais valem manter.'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2) Tem dados, mas nenhum ocioso no momento
  if (idleCount === 0) {
    return (
      <div className="card p-5 mb-6 border-l-4 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-900/10">
        <div className="flex items-center gap-4">
          <DollarSign size={32} className="text-emerald-500" />
          <div className="flex-1">
            <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
              {totalPublic} IP{totalPublic > 1 ? 's' : ''} público{totalPublic > 1 ? 's' : ''} · nenhum ocioso identificado agora
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              Auditoria concluída na última sync — todos os IPs estão associados a um recurso. Re-sincronize periodicamente para reavaliar à medida que recursos forem desligados.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3) Tem ociosos — exibir pra avaliação
  return (
    <div className="card p-5 mb-6 border-l-4 border-l-amber-500 bg-amber-50/30 dark:bg-amber-900/10">
      <div className="flex items-center gap-4">
        <DollarSign size={32} className="text-amber-600" />
        <div className="flex-1">
          <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">
            {idleCount} IP{idleCount > 1 ? 's' : ''} público{idleCount > 1 ? 's' : ''} ocioso{idleCount > 1 ? 's' : ''}
            <span className="text-sm font-normal text-amber-700/70 dark:text-amber-300/80 ml-2">
              · ~{fmtMoney(total)}/mês se mantidos
            </span>
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Liste abaixo, avalie caso a caso — alguns IPs ociosos são propositais (reserva de range, DR, contrato com terceiros). Os que não tiverem motivo podem ser liberados no console do provider.
          </div>
        </div>
      </div>
    </div>
  );
}

function IdlePublicIpsTable({ items }) {
  if (!items?.length) return null;
  return (
    <div className="card p-0 mb-6 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
        <h2 className="font-semibold text-sm">IPs públicos ociosos — drill-down</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 dark:bg-slate-800/60 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-4 py-2">Endereço</th>
              <th className="text-left px-4 py-2">Account</th>
              <th className="text-left px-4 py-2">Tag Name</th>
              <th className="text-left px-4 py-2">Alocação</th>
              <th className="text-left px-4 py-2">Visto</th>
              <th className="text-right px-4 py-2">Custo estim.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.ipId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                <td className="px-4 py-2 font-mono">{it.address}</td>
                <td className="px-4 py-2">
                  <span className="text-xs text-slate-500">{it.provider}</span>
                  <div>{it.accountName}</div>
                </td>
                <td className="px-4 py-2 text-slate-600">{it.tags?.Name || '—'}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{it.allocationId || '—'}</td>
                <td className="px-4 py-2 text-slate-500 text-xs">{fmtAge(it.lastSeenAt)}</td>
                <td className="px-4 py-2 text-right font-semibold text-rose-700 dark:text-rose-300">
                  {fmtMoney(it.estimatedMonthlyCostUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountCard({ account, onSync, onTest, onDelete, syncing }) {
  const [expanded, setExpanded] = useState(false);
  const info = PROVIDER_INFO[account.provider] || PROVIDER_INFO.AWS;
  const { data: runs = [] } = useQuery({
    queryKey: ['cloud-runs', account.id],
    queryFn: () => api.cloudAccountRuns(account.id, 10),
    enabled: expanded,
  });

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`px-2 py-1 rounded text-xs font-medium border ${info.color}`}>
            {account.provider}
          </div>
          <div>
            <div className="font-semibold">{account.displayName}</div>
            <div className="text-xs text-slate-500 font-mono">{account.scope}</div>
          </div>
        </div>
        <StatusPill status={account.status} lastError={account.lastError} />
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
        <div>
          <div className="text-xs text-slate-500">Última sync</div>
          <div>{fmtAge(account.lastSyncAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Regions</div>
          <div className="font-mono text-xs">{account.regions?.join(', ') || '(padrão)'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Intervalo</div>
          <div>{account.pollIntervalMin} min</div>
        </div>
      </div>

      {account.lastError && (
        <div className="mt-3 px-3 py-2 rounded bg-rose-50 border border-rose-200 text-xs text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">
          <strong>Último erro:</strong> {account.lastError}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={() => onSync(account.id)}
          disabled={syncing}
          className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sincronizando…' : 'Sync agora'}
        </button>
        <button
          onClick={() => onTest(account.id)}
          className="text-xs px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 inline-flex items-center gap-1"
        >
          <Play size={12} />
          Test creds
        </button>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-xs px-3 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 text-slate-600"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Histórico
        </button>
        <div className="flex-1" />
        <button
          onClick={() => { if (demoTryWrite()) return; onDelete(account.id, account.displayName); }}
          className="text-xs px-2 py-1.5 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 inline-flex items-center gap-1"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
          {runs.length === 0 ? (
            <div className="text-xs text-slate-500 italic">Sem execuções ainda.</div>
          ) : (
            <div className="space-y-1 text-xs font-mono">
              {runs.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${r.status === 'ERROR' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                  <span className="text-slate-500">{new Date(r.startedAt).toLocaleString('pt-BR')}</span>
                  <span>read={r.itemsRead}</span>
                  <span>new={r.itemsCreated}</span>
                  <span>upd={r.itemsUpdated}</span>
                  {r.error && <span className="text-rose-600 truncate" title={r.error}>· {r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddAccountModal({ open, onClose, providers, onCreated }) {
  const toast = useToast();
  const [provider, setProvider] = useState('AWS');
  const [authMode, setAuthMode] = useState('ACCESS_KEY');
  const [displayName, setDisplayName] = useState('');
  const [scope, setScope] = useState('');
  const [regions, setRegions] = useState('us-east-1');
  // AWS
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  // Azure
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // GCP
  const [gcpServiceAccountJson, setGcpServiceAccountJson] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const info = PROVIDER_INFO[provider];
  const implemented = providers?.implemented || [];
  const isImplemented = implemented.includes(provider);

  function buildCredentials() {
    if (provider === 'AZURE') {
      return JSON.stringify({
        mode: 'SERVICE_PRINCIPAL',
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
    }
    if (provider === 'GCP') {
      // O backend valida o JSON. Aceita o conteúdo bruto do arquivo de chave.
      return gcpServiceAccountJson.trim();
    }
    // AWS
    if (authMode === 'ACCESS_KEY') {
      return JSON.stringify({ mode: 'ACCESS_KEY', accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() });
    }
    return JSON.stringify({
      mode: 'ASSUME_ROLE',
      roleArn: roleArn.trim(),
      externalId: externalId.trim() || undefined,
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (!isImplemented) {
      toast.error(`${provider} ainda não implementado.`);
      return;
    }
    setSubmitting(true);
    try {
      const account = await api.createCloudAccount({
        provider,
        displayName: displayName.trim(),
        scope: scope.trim(),
        regions: (provider === 'AZURE' || provider === 'GCP')
          ? []
          : regions.split(',').map((r) => r.trim()).filter(Boolean),
        credentials: buildCredentials(),
      });
      toast.success(`Account "${account.displayName}" conectado!`);
      onCreated(account);
      onClose();
      // reset
      setDisplayName(''); setScope(''); setAccessKeyId(''); setSecretAccessKey('');
      setRoleArn(''); setExternalId('');
      setTenantId(''); setClientId(''); setClientSecret('');
      setGcpServiceAccountJson('');
    } catch (err) {
      toast.error(`Falha: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Conectar conta cloud" size="xl">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Provider</label>
          <div className="grid grid-cols-3 gap-2">
            {['AWS', 'AZURE', 'GCP'].map((p) => {
              const ok = implemented.includes(p);
              const isActive = provider === p;
              return (
                <button
                  type="button"
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`px-3 py-2 rounded border text-sm font-medium transition ${
                    isActive
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30'
                      : 'border-slate-200 hover:border-slate-300'
                  } ${!ok ? 'opacity-60' : ''}`}
                >
                  {p}
                  {!ok && <div className="text-[10px] text-slate-500 mt-0.5">em breve</div>}
                </button>
              );
            })}
          </div>
        </div>

        {(provider === 'AWS' || provider === 'AZURE') && info.policy && (
          <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-3 text-xs">
            <div className="flex items-start gap-2">
              <ShieldCheck size={14} className="text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium mb-1">{provider === 'AWS' ? 'Policy mínima (read-only)' : 'Permissões mínimas (Reader role ou custom)'}</div>
                <pre className="text-[11px] font-mono bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700 overflow-x-auto whitespace-pre">{info.policy}</pre>
                <div className="mt-1.5 flex items-center gap-2">
                  <CopyButton text={info.policy} />
                  <a
                    href={provider === 'AWS'
                      ? 'https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_create.html'
                      : 'https://learn.microsoft.com/en-us/azure/active-directory/develop/howto-create-service-principal-portal'}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-brand-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    Como aplicar <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Nome (livre)</label>
            <input
              className="input w-full"
              placeholder="ex: Production AWS"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">{info.scopeLabel}</label>
            <input
              className="input w-full font-mono text-sm"
              placeholder={info.scopePlaceholder}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              required
            />
          </div>
        </div>

        {provider === 'AWS' && (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Regions (vírgula)</label>
            <input
              className="input w-full font-mono text-sm"
              placeholder={info.regionsHint}
              value={regions}
              onChange={(e) => setRegions(e.target.value)}
            />
          </div>
        )}

        {provider === 'AWS' && (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1.5">Modo de autenticação</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAuthMode('ACCESS_KEY')}
                className={`text-left px-3 py-2 rounded border text-sm transition ${
                  authMode === 'ACCESS_KEY'
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <KeyRound size={12} /> Access Key
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Mais simples. Chaves de IAM User read-only.</div>
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('ASSUME_ROLE')}
                className={`text-left px-3 py-2 rounded border text-sm transition ${
                  authMode === 'ASSUME_ROLE'
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck size={12} /> Assume Role
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Mais seguro. Bagre assume role temporário via STS.</div>
              </button>
            </div>
          </div>
        )}

        {provider === 'AWS' && authMode === 'ACCESS_KEY' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Access Key ID</label>
              <input
                className="input w-full font-mono text-sm"
                placeholder="AKIA…"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Secret Access Key</label>
              <input
                type="password"
                className="input w-full font-mono text-sm"
                placeholder="••••••••"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                required
              />
            </div>
          </div>
        )}

        {provider === 'AWS' && authMode === 'ASSUME_ROLE' && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
              ⚠ Bagre precisa ter credenciais base (env vars <code>AWS_ACCESS_KEY_ID</code>/<code>AWS_SECRET_ACCESS_KEY</code> ou EC2 instance role) para chamar STS:AssumeRole.
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Role ARN</label>
              <input
                className="input w-full font-mono text-sm"
                placeholder="arn:aws:iam::123456789012:role/BagreIPAMReader"
                value={roleArn}
                onChange={(e) => setRoleArn(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">External ID (opcional)</label>
              <input
                className="input w-full font-mono text-sm"
                placeholder="random-uuid"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
              />
            </div>
          </div>
        )}

        {provider === 'GCP' && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded p-2">
              <strong>Service Account JSON:</strong> baixe o arquivo de chave da service account (Console → IAM → Service Accounts → sua SA → Keys → Add Key → JSON) e cole o conteúdo inteiro abaixo.
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Service Account JSON</label>
              <textarea
                className="input w-full font-mono text-[11px]"
                rows={8}
                placeholder='{&#10;  "type": "service_account",&#10;  "project_id": "...",&#10;  "private_key_id": "...",&#10;  "private_key": "-----BEGIN PRIVATE KEY-----\n...",&#10;  "client_email": "...@...iam.gserviceaccount.com",&#10;  ...&#10;}'
                value={gcpServiceAccountJson}
                onChange={(e) => setGcpServiceAccountJson(e.target.value)}
                required
              />
              <p className="text-[11px] text-slate-500 mt-1">A chave fica criptografada AES-256-GCM no banco. Nunca volta pra UI em texto puro depois de salva.</p>
            </div>
          </div>
        )}

        {provider === 'AZURE' && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded p-2">
              <strong>Service Principal:</strong> crie um App Registration em Microsoft Entra ID, gere um client secret, e atribua role <code>Reader</code> na subscription.
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Tenant ID</label>
              <input
                className="input w-full font-mono text-sm"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Client ID (Application ID)</label>
              <input
                className="input w-full font-mono text-sm"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Client Secret</label>
              <input
                type="password"
                className="input w-full font-mono text-sm"
                placeholder="••••••••"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                required
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
            Cancelar
          </button>
          <button type="submit" disabled={submitting || !isImplemented} className="btn-primary disabled:opacity-50">
            {submitting ? 'Conectando…' : 'Conectar e testar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function CloudAccounts() {
  const qc = useQueryClient();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [syncing, setSyncing] = useState(null);

  const { data: providers } = useQuery({
    queryKey: ['cloud-providers'],
    queryFn: api.cloudProviders,
  });

  const { data: accounts = [], refetch } = useQuery({
    queryKey: ['cloud-accounts'],
    queryFn: api.cloudAccounts,
  });

  const { data: finops, isLoading: finopsLoading } = useQuery({
    queryKey: ['cloud-finops'],
    queryFn: api.cloudIdlePublicIps,
    refetchInterval: 30_000,
  });

  const syncMut = useMutation({
    mutationFn: (id) => api.syncCloudAccount(id),
    onMutate: (id) => setSyncing(id),
    onSettled: () => setSyncing(null),
    onSuccess: (r) => {
      toast.success(`Sync ok — read=${r.summary.itemsRead}, new=${r.summary.itemsCreated}, upd=${r.summary.itemsUpdated}`);
      qc.invalidateQueries({ queryKey: ['cloud-accounts'] });
      qc.invalidateQueries({ queryKey: ['cloud-finops'] });
      qc.invalidateQueries({ queryKey: ['cloud-runs'] });
    },
    onError: (err) => toast.error(`Sync falhou: ${err.message}`),
  });

  const testMut = useMutation({
    mutationFn: (id) => api.testCloudAccount(id),
    onSuccess: (r) => toast.success(`Credenciais OK — account ${r.detail?.account || '?'}`),
    onError: (err) => toast.error(`Test falhou: ${err.message}`),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.deleteCloudAccount(id),
    onSuccess: () => {
      toast.success('Account removido.');
      qc.invalidateQueries({ queryKey: ['cloud-accounts'] });
      qc.invalidateQueries({ queryKey: ['cloud-finops'] });
    },
  });

  function onDelete(id, name) {
    if (!confirm(`Remover "${name}"? IPs já importados continuam no Bagre, só a conexão e o histórico de sync somem.`)) return;
    deleteMut.mutate(id);
  }

  return (
    <div>
      <PageHeader
        title="Cloud Accounts"
        description="Conecte AWS / Azure / GCP e o Bagre importa subnets e IPs automaticamente. Use a auditoria abaixo para identificar IPs públicos ociosos e decidir o que pode ser liberado."
        actions={
          <button onClick={() => { if (demoTryWrite()) return; setAddOpen(true); }} className="btn-primary inline-flex items-center gap-1.5">
            <Plus size={14} />
            Conectar conta
          </button>
        }
      />

      <FinOpsHero data={finops} isLoading={finopsLoading} hasAccounts={accounts.length > 0} />
      <IdlePublicIpsTable items={finops?.items} />

      {accounts.length === 0 ? (
        <div className="card p-8 text-center">
          <Cloud size={36} className="mx-auto text-slate-300 mb-3" />
          <h3 className="font-semibold mb-1">Nenhuma conta cloud conectada ainda</h3>
          <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
            Conecte sua AWS em menos de 2 minutos. Cria-se um IAM User (ou Role) com permissão read-only, cola credenciais aqui — o Bagre testa e sincroniza na hora.
          </p>
          <button onClick={() => { if (demoTryWrite()) return; setAddOpen(true); }} className="btn-primary inline-flex items-center gap-1.5">
            <Plus size={14} />
            Conectar primeira conta
          </button>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              syncing={syncing === a.id}
              onSync={(id) => syncMut.mutate(id)}
              onTest={(id) => testMut.mutate(id)}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      <AddAccountModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        providers={providers}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['cloud-accounts'] });
          refetch();
        }}
      />
    </div>
  );
}
