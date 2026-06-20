import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Inbox,
  Check,
  X,
  Search,
  Server,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';

const STATUS_FILTERS = [
  { id: 'PENDING', label: 'Pendentes', icon: Inbox, color: 'amber' },
  { id: 'APPROVED', label: 'Aprovados', icon: CheckCircle2, color: 'emerald' },
  { id: 'REJECTED', label: 'Rejeitados', icon: XCircle, color: 'rose' },
];

// De onde veio a descoberta. Tag visual pra bater o olho (Zabbix x Prometheus x ...).
const SOURCE_BADGE = {
  zabbix: { label: 'Zabbix', cls: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20' },
  prometheus: { label: 'Prometheus', cls: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/20' },
  ingest: { label: 'Ingest', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20' },
  manual: { label: 'Manual', cls: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600/30' },
};

function SourceBadge({ source }) {
  if (!source) return null;
  const b = SOURCE_BADGE[source] || { label: source, cls: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600/30' };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${b.cls}`}>
      {b.label}
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function PendingDiscoveries() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';
  const qc = useQueryClient();

  const [status, setStatus] = useState('PENDING');
  const [q, setQ] = useState('');
  const [subnetFilter, setSubnetFilter] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [approveModal, setApproveModal] = useState({ open: false, ids: [], suggested: null });
  const [rejectModal, setRejectModal] = useState({ open: false, id: null });
  const [err, setErr] = useState(null);

  const { data: discoveries = [], isLoading } = useQuery({
    queryKey: ['pending-discoveries', { status, q, subnetFilter }],
    queryFn: () =>
      api.pendingDiscoveries({
        ...(status ? { status } : {}),
        ...(q ? { q } : {}),
        ...(subnetFilter ? { suggestedSubnet: subnetFilter } : {}),
      }),
  });
  const { data: stats } = useQuery({
    queryKey: ['pending-discoveries-stats'],
    queryFn: api.pendingDiscoveriesStats,
    refetchInterval: 60_000,
  });
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: api.sites });

  const inv = () => {
    qc.invalidateQueries({ queryKey: ['pending-discoveries'] });
    qc.invalidateQueries({ queryKey: ['pending-discoveries-stats'] });
    qc.invalidateQueries({ queryKey: ['sites'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const approveMut = useMutation({
    mutationFn: ({ id, payload }) => api.approvePendingDiscovery(id, payload),
    onSuccess: inv,
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }) => api.rejectPendingDiscovery(id, { reason }),
    onSuccess: inv,
  });
  const bulkMut = useMutation({
    mutationFn: (payload) => api.bulkApprovePendingDiscoveries(payload),
    onSuccess: inv,
  });

  // Agrupa pendentes por subnet sugerida (pra facilitar bulk)
  const bySubnet = useMemo(() => {
    const map = new Map();
    for (const d of discoveries) {
      const cidr = d.suggestedSubnetCidr || '(sem CIDR)';
      if (!map.has(cidr)) map.set(cidr, []);
      map.get(cidr).push(d);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [discoveries]);

  const toggleSelect = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectSubnetGroup = (group) => {
    setSelected((s) => {
      const next = new Set(s);
      const allIn = group.every((d) => next.has(d.id));
      if (allIn) group.forEach((d) => next.delete(d.id));
      else group.forEach((d) => next.add(d.id));
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        title="Aprovação de descobertas"
        description={
          canEdit
            ? 'Hosts descobertos pelas integrações (Zabbix, Prometheus, DNS…) com IPs que não estão em nenhuma subnet do IPAM. A coluna Fonte mostra de onde veio cada um. Aprovar cria/popula a subnet. Rejeitar ignora permanentemente.'
            : 'Hosts descobertos pelas integrações (somente leitura). A coluna Fonte mostra de onde veio cada um.'
        }
      />

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {STATUS_FILTERS.map((f) => {
          const c = stats?.counts?.[f.id] ?? 0;
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              onClick={() => {
                setStatus(f.id);
                setSelected(new Set());
              }}
              className={`card p-4 text-left transition border ${
                status === f.id
                  ? 'border-brand-500 ring-2 ring-brand-100 dark:ring-brand-900/30'
                  : 'border-transparent hover:border-slate-200 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wider mb-2">
                <Icon size={13} />
                {f.label}
              </div>
              <div className="text-2xl font-semibold tabular-nums">{c}</div>
            </button>
          );
        })}
      </div>

      {/* Top filter row */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar IP, hostname, vendor…"
            className="input pl-9"
          />
        </div>
        <select
          value={subnetFilter}
          onChange={(e) => setSubnetFilter(e.target.value)}
          className="input max-w-[200px]"
        >
          <option value="">Todas subnets sugeridas</option>
          {stats?.pendingBySubnet?.map((s) => (
            <option key={s.cidr || 'null'} value={s.cidr || ''}>
              {s.cidr || '(sem CIDR)'} · {s.count}
            </option>
          ))}
        </select>
        <div className="ml-auto text-xs text-slate-500">
          {isLoading ? 'Carregando…' : `${discoveries.length} registro(s)`}
        </div>
      </div>

      {/* Bulk action bar */}
      {canEdit && selected.size > 0 && status === 'PENDING' && (
        <div className="card-elevated p-3 mb-3 flex items-center gap-3 border-2 border-brand-500">
          <div className="text-sm">
            <strong>{selected.size}</strong> selecionado(s)
          </div>
          <button
            onClick={() => {
              setErr(null);
              const ids = Array.from(selected);
              const subset = discoveries.filter((d) => selected.has(d.id));
              const cidrs = new Set(subset.map((d) => d.suggestedSubnetCidr));
              const siteCodes = new Set(subset.map((d) => d.suggestedSiteCode).filter(Boolean));
              setApproveModal({
                open: true,
                ids,
                suggested: cidrs.size === 1 ? Array.from(cidrs)[0] : null,
                suggestedSite: siteCodes.size === 1 ? Array.from(siteCodes)[0] : null,
              });
            }}
            className="btn-primary text-xs py-1.5"
          >
            <Check size={13} /> Aprovar selecionados
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="btn-ghost text-xs py-1.5"
          >
            Limpar
          </button>
        </div>
      )}

      {/* Lista agrupada por subnet quando status=PENDING */}
      {status === 'PENDING' ? (
        <div className="space-y-4">
          {!isLoading && bySubnet.length === 0 && (
            <div className="card p-12 text-center text-slate-400">
              <Inbox size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm">Nenhuma descoberta pendente.</p>
              <p className="text-xs mt-1">Quando o Zabbix encontrar um host com IP fora das subnets cadastradas, ele aparece aqui.</p>
            </div>
          )}
          {bySubnet.map(([cidr, group]) => (
            <div key={cidr} className="card overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
                <code className="font-mono text-sm font-semibold">{cidr}</code>
                <span className="text-xs text-slate-500">
                  {group.length} host{group.length > 1 ? 's' : ''}
                </span>
                {canEdit && (
                  <>
                    <button
                      onClick={() => selectSubnetGroup(group)}
                      className="ml-auto text-xs text-brand-600 hover:underline"
                    >
                      {group.every((d) => selected.has(d.id)) ? 'desmarcar grupo' : 'selecionar grupo'}
                    </button>
                    <button
                      onClick={() => {
                        setErr(null);
                        setApproveModal({
                          open: true,
                          ids: group.map((d) => d.id),
                          suggested: cidr,
                          suggestedSite:
                            new Set(group.map((d) => d.suggestedSiteCode).filter(Boolean)).size === 1
                              ? group.find((d) => d.suggestedSiteCode)?.suggestedSiteCode || null
                              : null,
                        });
                      }}
                      className="btn-primary text-xs py-1"
                    >
                      <Check size={12} /> Aprovar todos
                    </button>
                  </>
                )}
              </div>
              <DiscoveryTable
                rows={group}
                canEdit={canEdit}
                selected={selected}
                onToggle={toggleSelect}
                onApprove={(d) => {
                  setErr(null);
                  setApproveModal({
                    open: true,
                    ids: [d.id],
                    suggested: d.suggestedSubnetCidr,
                    suggestedSite: d.suggestedSiteCode || null,
                  });
                }}
                onReject={(d) => setRejectModal({ open: true, id: d.id })}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {!isLoading && discoveries.length === 0 && (
            <div className="p-12 text-center text-slate-400 text-sm">
              Nenhum registro com esse filtro.
            </div>
          )}
          {discoveries.length > 0 && (
            <DiscoveryTable
              rows={discoveries}
              canEdit={false}
              showStatusInfo
            />
          )}
        </div>
      )}

      <ApproveModal
        open={approveModal.open}
        ids={approveModal.ids}
        suggestedCidr={approveModal.suggested}
        suggestedSiteCode={approveModal.suggestedSite}
        sites={sites}
        loading={approveMut.isPending || bulkMut.isPending}
        error={err}
        onClose={() => {
          setApproveModal({ open: false, ids: [], suggested: null });
          setErr(null);
        }}
        onSubmit={(payload) => {
          if (approveModal.ids.length === 1) {
            approveMut.mutate(
              { id: approveModal.ids[0], payload },
              {
                onSuccess: () => {
                  setApproveModal({ open: false, ids: [], suggested: null });
                  setSelected(new Set());
                },
                onError: (e) => setErr(e.message),
              },
            );
          } else {
            bulkMut.mutate(
              { ids: approveModal.ids, ...payload },
              {
                onSuccess: () => {
                  setApproveModal({ open: false, ids: [], suggested: null });
                  setSelected(new Set());
                },
                onError: (e) => setErr(e.message),
              },
            );
          }
        }}
      />

      <RejectModal
        open={rejectModal.open}
        onClose={() => setRejectModal({ open: false, id: null })}
        loading={rejectMut.isPending}
        onSubmit={(reason) =>
          rejectMut.mutate(
            { id: rejectModal.id, reason },
            { onSuccess: () => setRejectModal({ open: false, id: null }) },
          )
        }
      />
    </div>
  );
}

function DiscoveryTable({ rows, canEdit, selected, onToggle, onApprove, onReject, showStatusInfo }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 dark:bg-slate-800/30 text-left text-xs uppercase tracking-wider text-slate-500">
        <tr>
          {canEdit && <th className="w-8 px-3 py-2"></th>}
          <th className="px-3 py-2">IP</th>
          <th className="px-3 py-2">Hostname</th>
          <th className="px-3 py-2">Fonte</th>
          <th className="px-3 py-2">Tipo</th>
          <th className="px-3 py-2">Vendor / Modelo</th>
          <th className="px-3 py-2">Visto há</th>
          <th className="px-3 py-2 w-14">Vezes</th>
          {showStatusInfo && <th className="px-3 py-2">Decidido por</th>}
          {canEdit && <th className="px-3 py-2 w-32 text-right">Ações</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((d) => (
          <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
            {canEdit && (
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(d.id)}
                  onChange={() => onToggle(d.id)}
                />
              </td>
            )}
            <td className="px-3 py-2">
              <code className="font-mono text-xs">{d.address}</code>
            </td>
            <td className="px-3 py-2 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Server size={12} className="text-slate-400" />
                {d.hostname || <span className="text-slate-300 italic">—</span>}
              </span>
            </td>
            <td className="px-3 py-2">
              <SourceBadge source={d.source} />
            </td>
            <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{d.type || '—'}</td>
            <td className="px-3 py-2 text-xs text-slate-500">
              {d.vendor || '—'}
              {d.model && <span className="text-slate-400"> · {d.model}</span>}
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">{formatDate(d.lastSeenAt)}</td>
            <td className="px-3 py-2 text-xs text-slate-500 tabular-nums">{d.occurrences}</td>
            {showStatusInfo && (
              <td className="px-3 py-2 text-xs text-slate-500">
                {d.decidedBy || '—'}
                {d.rejectedReason && (
                  <span className="ml-1 text-rose-500" title={d.rejectedReason}>
                    <AlertTriangle size={11} className="inline" />
                  </span>
                )}
              </td>
            )}
            {canEdit && (
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <button
                  onClick={() => onApprove(d)}
                  title="Aprovar (criar/popular subnet e IP)"
                  className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 mr-1 inline-flex items-center gap-1"
                >
                  <Check size={12} />
                  Aprovar
                </button>
                <button
                  onClick={() => onReject(d)}
                  title="Rejeitar (não cria nada, fica registrado)"
                  className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 inline-flex items-center gap-1"
                >
                  <X size={12} />
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ApproveModal({ open, ids, suggestedCidr, suggestedSiteCode, sites, loading, error, onClose, onSubmit }) {
  const [mode, setMode] = useState('new');
  const [subnetId, setSubnetId] = useState('');
  const [newSubnet, setNewSubnet] = useState({ siteId: '', name: '', cidr: '', vlanId: '' });

  // Pré-preenche o formulário com os dados da descoberta ao ABRIR o modal.
  // (Tinha que ser useEffect — useState ignora o array de deps e nunca re-rodava,
  // por isso os campos vinham vazios mesmo com sugestão. Ver issue #46.)
  useEffect(() => {
    if (!open) return;
    const matchSite = suggestedSiteCode
      ? sites.find((s) => s.code === suggestedSiteCode)
      : null;
    setMode(suggestedCidr ? 'new' : 'existing');
    setSubnetId('');
    setNewSubnet({
      siteId: matchSite ? String(matchSite.id) : '',
      name: suggestedCidr ? `Auto · ${suggestedCidr}` : '',
      cidr: suggestedCidr || '',
      vlanId: '',
    });
  }, [open, suggestedCidr, suggestedSiteCode, sites]);

  // Buscar subnets pra modo "existente"
  const allSubnets = sites.flatMap((s) =>
    (s.subnets || []).map((sub) => ({ ...sub, siteCode: s.code, siteId: s.id })),
  );

  function submit(e) {
    e.preventDefault();
    if (mode === 'existing') {
      if (!subnetId) return;
      onSubmit({ subnetId: Number(subnetId) });
    } else {
      if (!newSubnet.siteId || !newSubnet.name || !newSubnet.cidr) return;
      onSubmit({
        newSubnet: {
          siteId: Number(newSubnet.siteId),
          name: String(newSubnet.name).trim(),
          cidr: String(newSubnet.cidr).trim(),
          vlanId: newSubnet.vlanId ? Number(newSubnet.vlanId) : null,
        },
      });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Aprovar ${ids.length} descoberta${ids.length > 1 ? 's' : ''}`}
      size="lg"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/30 p-2 rounded">
            {error}
          </div>
        )}

        <div className="inline-flex bg-slate-100 dark:bg-slate-800 rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`text-xs px-3 py-1.5 rounded ${
              mode === 'new'
                ? 'bg-white dark:bg-slate-900 shadow-sm font-medium'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Criar subnet nova
          </button>
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={`text-xs px-3 py-1.5 rounded ${
              mode === 'existing'
                ? 'bg-white dark:bg-slate-900 shadow-sm font-medium'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Usar subnet existente
          </button>
        </div>

        {mode === 'new' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm mb-1">
                Site <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={newSubnet.siteId}
                onChange={(e) => setNewSubnet({ ...newSubnet, siteId: e.target.value })}
                className="input"
              >
                <option value="">— selecione —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">
                Nome <span className="text-rose-500">*</span>
              </label>
              <input
                required
                value={newSubnet.name}
                onChange={(e) => setNewSubnet({ ...newSubnet, name: e.target.value })}
                placeholder="ex: LAN-PROD"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">
                CIDR <span className="text-rose-500">*</span>
              </label>
              <input
                required
                value={newSubnet.cidr}
                onChange={(e) => setNewSubnet({ ...newSubnet, cidr: e.target.value })}
                placeholder="10.0.0.0/24"
                className="input font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">VLAN ID</label>
              <input
                type="number"
                value={newSubnet.vlanId}
                onChange={(e) => setNewSubnet({ ...newSubnet, vlanId: e.target.value })}
                placeholder="opcional"
                className="input"
              />
            </div>
            <div className="col-span-2 text-xs text-slate-500 -mt-1">
              {suggestedCidr && (
                <>
                  💡 CIDR sugerido pela heurística: <code>{suggestedCidr}</code>
                </>
              )}
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm mb-1">
              Subnet existente <span className="text-rose-500">*</span>
            </label>
            <select
              required
              value={subnetId}
              onChange={(e) => setSubnetId(e.target.value)}
              className="input"
            >
              <option value="">— selecione —</option>
              {allSubnets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.siteCode} · {s.name} {s.cidr ? `(${s.cidr})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button className="btn-primary" disabled={loading}>
            {loading ? 'Aprovando…' : `Aprovar ${ids.length}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RejectModal({ open, onClose, onSubmit, loading }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Rejeitar descoberta" size="sm">
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          O host fica registrado como rejeitado e não será recriado em syncs futuros.
        </p>
        <div>
          <label className="block text-sm mb-1">Motivo (opcional)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ex: host de teste / não pertence à rede"
            className="input"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            onClick={() => onSubmit(reason)}
            disabled={loading}
            className="btn bg-rose-600 hover:bg-rose-700 text-white"
          >
            {loading ? 'Rejeitando…' : 'Rejeitar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
