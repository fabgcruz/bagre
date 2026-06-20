import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Cloud, RefreshCw, ExternalLink } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import CatalogFormModal from '../components/CatalogFormModal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const STATIC_TABS = [
  { id: 'master', label: 'Ranges Mestre' },
  { id: 'datacenter', label: 'Datacenter VLANs' },
];

const MASTER_FIELDS = [
  { name: 'cidr', label: 'CIDR', required: true, placeholder: '10.0.0.0/24', mono: true },
  { name: 'description', label: 'Descrição', placeholder: 'opcional', span: 'full' },
  { name: 'category', label: 'Categoria', placeholder: 'ex: Datacenter, Cloud, Links' },
];

const DATACENTER_FIELDS = [
  { name: 'name', label: 'Nome', required: true, placeholder: 'ex: VLAN-PROD' },
  { name: 'provider', label: 'Provider / DC', placeholder: 'ex: Equinix, Ascenty, ODATA, Próprio DC' },
  { name: 'vlanId', label: 'VLAN ID', type: 'number', placeholder: 'opcional' },
  { name: 'network', label: 'Network', placeholder: '10.0.0.0/24', mono: true, span: 'full' },
  { name: 'usage', label: 'Range', placeholder: '10.0.0.1 - 10.0.0.254', mono: true },
  { name: 'broadcast', label: 'Broadcast', placeholder: '10.0.0.255', mono: true },
];

export default function Catalogs() {
  const [tab, setTab] = useState('master');
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';

  // Dynamic tabs: one per connected cloud account. Refetch periodically so
  // newly added accounts surface here without a page reload.
  const { data: cloudAccounts = [] } = useQuery({
    queryKey: ['cloud-accounts'],
    queryFn: api.cloudAccounts,
    refetchInterval: 30_000,
  });
  const cloudTabs = cloudAccounts.map((a) => ({
    id: `cloud-${a.id}`,
    label: `${a.provider} · ${a.displayName}`,
    accountId: a.id,
  }));
  const tabs = [...STATIC_TABS, ...cloudTabs];

  return (
    <div>
      <PageHeader
        title="Catálogos"
        description="Listas de referência: ranges mestre, VLANs de datacenters/colocations e subnets sincronizadas das contas cloud conectadas."
      />

      <div className="border-b border-slate-200 dark:border-slate-800 flex gap-1 mb-4 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap ${
              tab === t.id
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t.label.startsWith('AWS') || t.label.startsWith('AZURE') || t.label.startsWith('GCP') ? (
              <span className="inline-flex items-center gap-1.5">
                <Cloud size={12} />
                {t.label}
              </span>
            ) : (
              t.label
            )}
          </button>
        ))}
      </div>

      {tab === 'master' && <MasterRanges canEdit={canEdit} />}
      {tab === 'datacenter' && <DatacenterVlans canEdit={canEdit} />}
      {tab.startsWith('cloud-') && (
        <CloudAccountSubnets
          accountId={cloudTabs.find((t) => t.id === tab)?.accountId}
          account={cloudAccounts.find((a) => `cloud-${a.id}` === tab)}
        />
      )}
    </div>
  );
}

function fmtAge(date) {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function CloudAccountSubnets({ accountId, account }) {
  const { data: subnets = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['cloud-subnets', accountId],
    queryFn: () => api.cloudAccountSubnets(accountId),
    enabled: !!accountId,
  });

  if (isLoading) {
    return <div className="card p-8 text-center text-slate-500">Carregando…</div>;
  }

  if (!subnets.length) {
    return (
      <div className="card p-8 text-center">
        <Cloud size={36} className="mx-auto text-slate-300 mb-3" />
        <h3 className="font-semibold mb-1">Sem subnets sincronizadas ainda</h3>
        <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
          A conta <strong>{account?.displayName}</strong> ({account?.provider}) ainda não rodou um sync ou não retornou subnets.
        </p>
        <Link to="/admin/cloud-accounts" className="btn-primary inline-flex items-center gap-1.5">
          <RefreshCw size={14} />
          Ir para Cloud Accounts e sincronizar
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-slate-500">
          {subnets.length} subnet{subnets.length > 1 ? 's' : ''} · última sync {fmtAge(account?.lastSyncAt)}
          {' · '}
          <Link to="/admin/cloud-accounts" className="text-brand-600 hover:underline inline-flex items-center gap-0.5">
            gerenciar <ExternalLink size={10} />
          </Link>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm table-zebra">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Nome</th>
              <th className="px-3 py-2 text-left">CIDR</th>
              <th className="px-3 py-2 text-left">Cloud Resource ID</th>
              <th className="px-3 py-2 text-left">Region</th>
              <th className="px-3 py-2 text-right">IPs</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {subnets.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-1.5">{s.name}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{s.cidr || '—'}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{s.cloudResourceId || '—'}</td>
                <td className="px-3 py-1.5 text-xs">{s.cloudMetadata?.region || s.cloudMetadata?.availabilityZone || '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{s.ipCount}</td>
                <td className="px-3 py-1.5 text-right">
                  <Link
                    to={`/subnets/${s.id}`}
                    className="text-xs text-brand-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    abrir <ExternalLink size={10} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function useCrud({ key, list, create, update, remove }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: [key], queryFn: list });
  const inv = () => qc.invalidateQueries({ queryKey: [key] });
  return {
    data: query.data || [],
    isLoading: query.isLoading,
    create: useMutation({ mutationFn: create, onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, data }) => update(id, data), onSuccess: inv }),
    remove: useMutation({ mutationFn: remove, onSuccess: inv }),
  };
}

function Toolbar({ canEdit, onNew, label }) {
  if (!canEdit) return null;
  return (
    <div className="flex justify-end mb-2">
      <button onClick={onNew} className="btn-primary text-xs py-1.5">
        <Plus size={13} /> {label}
      </button>
    </div>
  );
}

function ActionCell({ canEdit, onEdit, onDelete }) {
  if (!canEdit) return null;
  return (
    <td className="px-3 py-1.5 text-right whitespace-nowrap">
      <button
        onClick={onEdit}
        className="text-slate-400 hover:text-brand-600 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
        title="Editar"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={onDelete}
        className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/30 ml-1"
        title="Excluir"
      >
        <Trash2 size={14} />
      </button>
    </td>
  );
}

function MasterRanges({ canEdit }) {
  const crud = useCrud({
    key: 'master-ranges',
    list: api.masterRanges,
    create: api.createMasterRange,
    update: api.updateMasterRange,
    remove: api.deleteMasterRange,
  });
  const [modal, setModal] = useState({ open: false, initial: null });
  const [confirm, setConfirm] = useState({ open: false, id: null, label: '' });
  const [err, setErr] = useState(null);

  return (
    <div>
      <Toolbar canEdit={canEdit} label="Novo range mestre" onNew={() => { setErr(null); setModal({ open: true, initial: null }); }} />
      <div className="card overflow-hidden">
        <table className="w-full text-sm table-zebra">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">CIDR</th>
              <th className="px-3 py-2 text-left">Descrição</th>
              <th className="px-3 py-2 text-left">Categoria</th>
              {canEdit && <th className="px-3 py-2 w-20" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {crud.data.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-1.5 font-mono text-xs">{r.cidr}</td>
                <td className="px-3 py-1.5">{r.description || '—'}</td>
                <td className="px-3 py-1.5 text-slate-500">{r.category || '—'}</td>
                <ActionCell
                  canEdit={canEdit}
                  onEdit={() => { setErr(null); setModal({ open: true, initial: r }); }}
                  onDelete={() => setConfirm({ open: true, id: r.id, label: r.cidr })}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CatalogFormModal
        open={modal.open}
        onClose={() => setModal({ open: false, initial: null })}
        title={modal.initial ? 'Editar range mestre' : 'Novo range mestre'}
        fields={MASTER_FIELDS}
        initial={modal.initial}
        loading={crud.create.isPending || crud.update.isPending}
        error={err}
        onSubmit={(data) => {
          const mutation = modal.initial
            ? crud.update.mutate({ id: modal.initial.id, data }, {
                onSuccess: () => setModal({ open: false, initial: null }),
                onError: (e) => setErr(e.message),
              })
            : crud.create.mutate(data, {
                onSuccess: () => setModal({ open: false, initial: null }),
                onError: (e) => setErr(e.message),
              });
        }}
      />
      <ConfirmDialog
        open={confirm.open}
        onClose={() => setConfirm({ open: false, id: null, label: '' })}
        title="Excluir range mestre"
        message={<>Tem certeza que quer excluir <strong>{confirm.label}</strong>?</>}
        confirmLabel="Excluir"
        destructive
        loading={crud.remove.isPending}
        onConfirm={() => crud.remove.mutate(confirm.id, {
          onSuccess: () => setConfirm({ open: false, id: null, label: '' }),
        })}
      />
    </div>
  );
}

function DatacenterVlans({ canEdit }) {
  const crud = useCrud({
    key: 'datacenter-vlans',
    list: api.datacenterVlans,
    create: api.createDatacenterVlan,
    update: api.updateDatacenterVlan,
    remove: api.deleteDatacenterVlan,
  });
  const [modal, setModal] = useState({ open: false, initial: null });
  const [confirm, setConfirm] = useState({ open: false, id: null, label: '' });
  const [err, setErr] = useState(null);

  return (
    <div>
      <Toolbar canEdit={canEdit} label="Nova VLAN" onNew={() => { setErr(null); setModal({ open: true, initial: null }); }} />
      <div className="card overflow-hidden">
        <table className="w-full text-sm table-zebra">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Nome</th>
              <th className="px-3 py-2 text-left">Provider / DC</th>
              <th className="px-3 py-2 text-left">VLAN</th>
              <th className="px-3 py-2 text-left">Network</th>
              <th className="px-3 py-2 text-left">Range</th>
              <th className="px-3 py-2 text-left">Broadcast</th>
              {canEdit && <th className="px-3 py-2 w-20" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {crud.data.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5 text-slate-600">{r.provider || '—'}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.vlanId ?? '—'}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.network || '—'}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.usage || '—'}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.broadcast || '—'}</td>
                <ActionCell
                  canEdit={canEdit}
                  onEdit={() => { setErr(null); setModal({ open: true, initial: r }); }}
                  onDelete={() => setConfirm({ open: true, id: r.id, label: r.name })}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CatalogFormModal
        open={modal.open}
        onClose={() => setModal({ open: false, initial: null })}
        title={modal.initial ? 'Editar VLAN de datacenter' : 'Nova VLAN de datacenter'}
        fields={DATACENTER_FIELDS}
        initial={modal.initial}
        loading={crud.create.isPending || crud.update.isPending}
        error={err}
        onSubmit={(data) => {
          if (modal.initial) {
            crud.update.mutate({ id: modal.initial.id, data }, {
              onSuccess: () => setModal({ open: false, initial: null }),
              onError: (e) => setErr(e.message),
            });
          } else {
            crud.create.mutate(data, {
              onSuccess: () => setModal({ open: false, initial: null }),
              onError: (e) => setErr(e.message),
            });
          }
        }}
      />
      <ConfirmDialog
        open={confirm.open}
        onClose={() => setConfirm({ open: false, id: null, label: '' })}
        title="Excluir VLAN de datacenter"
        message={<>Tem certeza que quer excluir <strong>{confirm.label}</strong>?</>}
        confirmLabel="Excluir"
        destructive
        loading={crud.remove.isPending}
        onConfirm={() => crud.remove.mutate(confirm.id, {
          onSuccess: () => setConfirm({ open: false, id: null, label: '' }),
        })}
      />
    </div>
  );
}

