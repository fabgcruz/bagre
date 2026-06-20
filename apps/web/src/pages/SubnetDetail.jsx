import { useState, useMemo, useEffect } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Search,
  RefreshCw,
  Check,
  X,
  Lock,
  HelpCircle,
  CircleDot,
  Plus,
  Zap,
  Edit3,
  Trash2,
} from 'lucide-react';
import { api, demoTryWrite } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import PageHeader from '../components/PageHeader.jsx';
import AllocateIpModal from '../components/AllocateIpModal.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import UtilizationChart from '../components/UtilizationChart.jsx';

function EditableCell({ value, onSave, placeholder = '—', disabled }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);

  if (disabled) {
    return (
      <span className="px-2 py-1 truncate inline-block">
        {value ? value : <span className="text-slate-300 italic">{placeholder}</span>}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        onClick={() => {
          if (demoTryWrite()) return;
          setEditing(true);
        }}
        title="Clique para editar"
        className="w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 truncate"
      >
        {value ? (
          <span className="text-slate-900 dark:text-slate-100">{value}</span>
        ) : (
          <span className="text-slate-300 italic">{placeholder}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="input py-0.5 text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSave(v);
            setEditing(false);
          } else if (e.key === 'Escape') {
            setEditing(false);
            setV(value || '');
          }
        }}
      />
      <button
        onClick={() => {
          onSave(v);
          setEditing(false);
        }}
        className="text-emerald-600 hover:text-emerald-700 p-0.5"
        title="Salvar (Enter)"
      >
        <Check size={14} />
      </button>
      <button
        onClick={() => {
          setEditing(false);
          setV(value || '');
        }}
        className="text-slate-400 hover:text-slate-600 p-0.5"
        title="Cancelar (Esc)"
      >
        <X size={14} />
      </button>
    </div>
  );
}

const STATUS_FILTERS = [
  { id: '', label: 'Todos' },
  { id: 'USED', label: 'Em uso' },
  { id: 'RESERVED', label: 'Reservados' },
  { id: 'FREE', label: 'Livres' },
];

export default function SubnetDetail() {
  const { id } = useParams();
  const subnetId = Number(id);
  const [searchParams] = useSearchParams();
  const highlightIp = searchParams.get('ip');
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  const { data: subnet } = useQuery({
    queryKey: ['subnet', subnetId],
    queryFn: () => api.subnet(subnetId),
  });
  const { data: ips = [], isLoading } = useQuery({
    queryKey: ['subnet', subnetId, 'ips', { q, status }],
    queryFn: () =>
      api.subnetIps(subnetId, {
        ...(q ? { q } : {}),
        ...(status ? { status } : {}),
      }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => api.updateIp(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subnet', subnetId] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
  });
  const releaseMut = useMutation({
    mutationFn: (id) => api.releaseIp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subnet', subnetId] }),
  });
  const reserveMut = useMutation({
    mutationFn: (id) => api.reserveIp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subnet', subnetId] }),
  });

  const bulkMut = useMutation({
    mutationFn: (payload) => api.ipsBulk(payload),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['subnet', subnetId] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      setSelected(new Set());
      setBulkEditOpen(false);
      if (r.failed?.length) {
        toast.error(`Bulk ${r.action}: ${r.updated}/${r.requested} OK · ${r.failed.length} falharam`);
      } else {
        toast.success(`Bulk ${r.action}: ${r.updated} IP${r.updated > 1 ? 's' : ''} atualizado${r.updated > 1 ? 's' : ''}`);
      }
    },
    onError: (e) => toast.error(`Bulk falhou: ${e.message}`),
  });

  function toggleSelected(id) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((s) => {
      const visibleIds = ips.map((ip) => ip.id);
      const allSelected = visibleIds.every((id) => s.has(id));
      const next = new Set(s);
      if (allSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }
  // Limpa seleção quando filtros mudam pra não confundir
  useEffect(() => setSelected(new Set()), [q, status]);

  const [allocateModal, setAllocateModal] = useState({ open: false, ip: null });
  const [allocateError, setAllocateError] = useState(null);
  const allocateMut = useMutation({
    mutationFn: ({ ipId, payload }) => api.allocateIp(ipId, payload),
    onSuccess: () => {
      setAllocateModal({ open: false, ip: null });
      setAllocateError(null);
      qc.invalidateQueries({ queryKey: ['subnet', subnetId] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (e) => setAllocateError(e.message),
  });

  async function openNextFreeAllocate() {
    if (demoTryWrite()) return;
    try {
      const next = await api.subnetNextFreeIp(subnetId);
      setAllocateError(null);
      setAllocateModal({ open: true, ip: next });
    } catch (e) {
      setAllocateError(e.message);
      alert('Não há IP livre nesta subnet.');
    }
  }

  const utilization = subnet?.ipCount
    ? (subnet.usedCount / subnet.ipCount) * 100
    : 0;

  return (
    <div>
      <button onClick={() => navigate('/sites')} className="btn-ghost -ml-2 mb-4 inline-flex">
        <ArrowLeft size={14} /> Voltar para sites
      </button>

      <PageHeader
        breadcrumb={subnet?.site?.code}
        title={subnet?.name || 'Subnet'}
        description={
          canEdit
            ? 'Cada linha é um IP. Clique em qualquer célula (Tipo, Hostname, Função) para editar. Use os botões da direita para reservar ou liberar.'
            : 'Cada linha é um IP. Você está em modo somente leitura.'
        }
        actions={
          <div className="flex items-center gap-2 text-sm">
            {subnet?.cidr && (
              <code className="font-mono text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">
                {subnet.cidr}
              </code>
            )}
            {!canEdit && (
              <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                <Lock size={11} /> somente leitura
              </span>
            )}
          </div>
        }
      />

      {/* Summary card */}
      <div className="card p-5 mb-5">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="text-3xl font-semibold tabular-nums">
              {subnet?.usedCount ?? 0}
              <span className="text-slate-300 text-xl"> / {subnet?.ipCount ?? 0}</span>
            </div>
            <div className="text-xs text-slate-500">{utilization.toFixed(1)}% em uso</div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full ${
                  utilization > 80
                    ? 'bg-rose-500'
                    : utilization > 50
                      ? 'bg-amber-400'
                      : 'bg-emerald-500'
                }`}
                style={{ width: `${utilization}%` }}
              />
            </div>
            <div className="flex gap-4 mt-3 text-xs">
              <Legend color="bg-blue-500" label="Em uso" />
              <Legend color="bg-amber-400" label="Reservado" />
              <Legend color="bg-emerald-500" label="Livre" />
            </div>
          </div>
        </div>
      </div>

      <UtilizationChart subnetId={subnetId} ipCount={subnet?.ipCount ?? 0} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar IP, hostname, função…"
            className="input pl-9"
          />
        </div>
        <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800 rounded-md p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatus(f.id)}
              className={`text-xs px-3 py-1 rounded ${
                status === f.id
                  ? 'bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['subnet', subnetId, 'ips'] })}
          className="btn-ghost ml-auto"
          title="Recarregar"
        >
          <RefreshCw size={14} /> Recarregar
        </button>
        {canEdit && (
          <button
            onClick={openNextFreeAllocate}
            className="btn-primary"
            title="Pega o primeiro IP livre desta subnet e abre o formulário"
          >
            <Zap size={14} /> Alocar próximo livre
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm table-zebra">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              {canEdit && (
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={ips.length > 0 && ips.every((ip) => selected.has(ip.id))}
                    ref={(el) => {
                      if (el) {
                        const some = ips.some((ip) => selected.has(ip.id));
                        const all = ips.length > 0 && ips.every((ip) => selected.has(ip.id));
                        el.indeterminate = some && !all;
                      }
                    }}
                    onChange={toggleAllVisible}
                    className="accent-brand-600 cursor-pointer"
                    title="Selecionar/limpar todos visíveis"
                  />
                </th>
              )}
              <th className="px-3 py-2.5 w-36">Endereço</th>
              <th className="px-3 py-2.5 w-28">Status</th>
              <th className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1">
                  Equipamento
                  <Tooltip text="Tipo + OS + vendor/modelo (vem do Zabbix quando disponível)" />
                </span>
              </th>
              <th className="px-3 py-2.5">Hostname</th>
              <th className="px-3 py-2.5 w-40">
                <span className="inline-flex items-center gap-1">
                  MAC / Função
                  <Tooltip text="MAC address quando descoberto, função/grupo do equipamento" />
                </span>
              </th>
              {canEdit && <th className="px-3 py-2.5 w-44 text-right">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading && (
              <tr>
                <td colSpan={canEdit ? 7 : 5} className="p-8 text-center text-slate-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && ips.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 7 : 5} className="p-8 text-center text-slate-500">
                  Nenhum endereço com esse filtro.
                </td>
              </tr>
            )}
            {ips.map((ip) => (
              <tr
                key={ip.id}
                className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  highlightIp === ip.address ? 'bg-amber-50 dark:bg-amber-900/20' : ''
                } ${selected.has(ip.id) ? 'bg-brand-50/40 dark:bg-brand-900/15' : ''}`}
              >
                {canEdit && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(ip.id)}
                      onChange={() => toggleSelected(ip.id)}
                      className="accent-brand-600 cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <code className="font-mono text-xs">{ip.address}</code>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={ip.status} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <EditableCell
                      disabled={!canEdit}
                      value={ip.type}
                      onSave={(v) => updateMut.mutate({ id: ip.id, data: { type: v } })}
                    />
                    {(ip.osInfo || ip.vendor) && (
                      <span className="text-[10px] text-slate-400 px-2 mt-0.5 leading-tight">
                        {ip.osInfo}
                        {ip.vendor && ip.osInfo && ' · '}
                        {ip.vendor}{ip.model ? ` ${ip.model}` : ''}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <EditableCell
                    disabled={!canEdit}
                    value={ip.hostname}
                    onSave={(v) => updateMut.mutate({ id: ip.id, data: { hostname: v } })}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    {ip.macAddress && (
                      <code className="font-mono text-[10px] text-slate-500 px-2">
                        {ip.macAddress}
                      </code>
                    )}
                    <EditableCell
                      disabled={!canEdit}
                      value={ip.function}
                      onSave={(v) => updateMut.mutate({ id: ip.id, data: { function: v } })}
                    />
                  </div>
                </td>
                {canEdit && (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {(ip.status === 'FREE' || ip.status === 'RESERVED') && (
                      <button
                        onClick={() => {
                          if (demoTryWrite()) return;
                          setAllocateError(null);
                          setAllocateModal({ open: true, ip });
                        }}
                        title="Alocar este IP a um equipamento"
                        className="text-xs px-2 py-1 rounded bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 mr-1 inline-flex items-center gap-1"
                      >
                        <Plus size={12} />
                        Alocar
                      </button>
                    )}
                    {ip.status === 'FREE' && (
                      <button
                        onClick={() => reserveMut.mutate(ip.id)}
                        title="Marcar como reservado (sem alocar a equipamento ainda)"
                        className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 mr-1 inline-flex items-center gap-1"
                      >
                        <CircleDot size={12} />
                        Reservar
                      </button>
                    )}
                    {ip.status !== 'FREE' && (
                      <button
                        onClick={() => releaseMut.mutate(ip.id)}
                        title="Limpar e marcar como livre"
                        className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 inline-flex items-center gap-1"
                      >
                        Liberar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AllocateIpModal
        open={allocateModal.open}
        ip={allocateModal.ip}
        loading={allocateMut.isPending}
        error={allocateError}
        onClose={() => {
          setAllocateModal({ open: false, ip: null });
          setAllocateError(null);
        }}
        onSubmit={(payload) => allocateMut.mutate({ ipId: allocateModal.ip.id, payload })}
      />

      {canEdit && selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          loading={bulkMut.isPending}
          onClear={() => setSelected(new Set())}
          onRelease={() => {
            if (confirm(`Liberar ${selected.size} IP(s)? Hostname, tipo, função e device serão limpos; status → FREE.`)) {
              bulkMut.mutate({ ipIds: Array.from(selected), action: 'release' });
            }
          }}
          onReserve={() => {
            bulkMut.mutate({ ipIds: Array.from(selected), action: 'reserve' });
          }}
          onEdit={() => {
            if (demoTryWrite()) return;
            setBulkEditOpen(true);
          }}
        />
      )}

      <BulkEditModal
        open={bulkEditOpen}
        count={selected.size}
        loading={bulkMut.isPending}
        onClose={() => setBulkEditOpen(false)}
        onSubmit={(data) =>
          bulkMut.mutate({ ipIds: Array.from(selected), action: 'update', data })
        }
      />
    </div>
  );
}

function BulkActionBar({ count, onClear, onRelease, onReserve, onEdit, loading }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 card-elevated px-4 py-3 flex items-center gap-3 shadow-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-slate-900 animate-slide-up">
      <span className="text-sm font-medium">
        <strong className="text-brand-700 dark:text-brand-300">{count}</strong> selecionado{count > 1 ? 's' : ''}
      </span>
      <span className="text-slate-300">|</span>
      <button
        onClick={onEdit}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 inline-flex items-center gap-1 disabled:opacity-50"
      >
        <Edit3 size={12} /> Editar campos
      </button>
      <button
        onClick={onReserve}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 inline-flex items-center gap-1 disabled:opacity-50"
      >
        <CircleDot size={12} /> Reservar
      </button>
      <button
        onClick={onRelease}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center gap-1 disabled:opacity-50"
      >
        <Trash2 size={12} /> Liberar
      </button>
      <span className="text-slate-300">|</span>
      <button
        onClick={onClear}
        disabled={loading}
        className="text-xs px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 disabled:opacity-50"
        title="Limpar seleção"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function BulkEditModal({ open, count, onClose, onSubmit, loading }) {
  const [type, setType] = useState('');
  const [fn, setFn] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setType('');
      setFn('');
      setNotes('');
    }
  }, [open]);

  function submit(e) {
    e.preventDefault();
    const data = {};
    if (type.trim()) data.type = type.trim();
    if (fn.trim()) data.function = fn.trim();
    if (notes.trim()) data.notes = notes.trim();
    if (Object.keys(data).length === 0) return;
    onSubmit(data);
  }

  return (
    <Modal open={open} onClose={onClose} title={`Editar ${count} IP${count > 1 ? 's' : ''} em massa`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-slate-500">
          Preencha só os campos que quer aplicar. Vazios são ignorados. IPs com status FREE viram USED se você preencher hostname/tipo/função.
        </p>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Tipo</label>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="input w-full text-sm"
            placeholder="ex: Servidor Linux"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Função</label>
          <input
            value={fn}
            onChange={(e) => setFn(e.target.value)}
            className="input w-full text-sm"
            placeholder="ex: Production · Database"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Notas</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="input w-full text-sm"
            placeholder="Comentário aplicado a todos"
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || (!type.trim() && !fn.trim() && !notes.trim())}
            className="btn-primary disabled:opacity-50"
          >
            {loading ? 'Aplicando…' : `Aplicar a ${count}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Legend({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-500">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Tooltip({ text }) {
  return (
    <span className="group relative">
      <HelpCircle size={11} className="text-slate-300 hover:text-slate-500 cursor-help" />
      <span className="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 mt-1 z-10 whitespace-nowrap bg-slate-900 text-white text-[10px] px-2 py-1 rounded normal-case font-normal tracking-normal">
        {text}
      </span>
    </span>
  );
}
