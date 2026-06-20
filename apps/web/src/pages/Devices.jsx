import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, Plus, Pencil, Trash2, ExternalLink, Server } from 'lucide-react';
import { api, demoTryWrite } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import CatalogFormModal from '../components/CatalogFormModal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const DEVICE_FIELDS = [
  { name: 'name', label: 'Nome / Hostname', required: true, span: 'full' },
  { name: 'type', label: 'Tipo', placeholder: 'ex: Servidor Linux' },
  { name: 'role', label: 'Função / Papel', placeholder: 'ex: Web Server' },
  { name: 'vendor', label: 'Vendor', placeholder: 'ex: Dell, Cisco' },
  { name: 'model', label: 'Modelo', placeholder: 'ex: PowerEdge R740' },
  { name: 'serial', label: 'Serial' },
  { name: 'osInfo', label: 'Sistema operacional', placeholder: 'ex: Ubuntu 22.04', span: 'full' },
  { name: 'ownerEmail', label: 'Responsável (email)', placeholder: 'dono@bagre.com.br', span: 'full' },
  { name: 'notes', label: 'Notas', span: 'full' },
];

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function Devices() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';
  const qc = useQueryClient();

  const [q, setQ] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modal, setModal] = useState({ open: false, initial: null });
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, device: null });
  const [err, setErr] = useState(null);

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices', { q, siteFilter, typeFilter }],
    queryFn: () =>
      api.devices({
        ...(q ? { q } : {}),
        ...(siteFilter ? { siteId: siteFilter } : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
      }),
  });
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: api.sites });

  const typeOptions = useMemo(() => {
    const s = new Set();
    for (const d of devices) if (d.type) s.add(d.type);
    return Array.from(s).sort();
  }, [devices]);

  const inv = () => qc.invalidateQueries({ queryKey: ['devices'] });
  const createMut = useMutation({ mutationFn: api.createDevice, onSuccess: inv });
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => api.updateDevice(id, data),
    onSuccess: inv,
  });
  const deleteMut = useMutation({ mutationFn: api.deleteDevice, onSuccess: inv });

  function submitDevice(data) {
    if (modal.initial) {
      updateMut.mutate(
        { id: modal.initial.id, data },
        {
          onSuccess: () => setModal({ open: false, initial: null }),
          onError: (e) => setErr(e.message),
        },
      );
    } else {
      createMut.mutate(data, {
        onSuccess: () => setModal({ open: false, initial: null }),
        onError: (e) => setErr(e.message),
      });
    }
  }

  return (
    <div>
      <PageHeader
        title="Equipamentos"
        description={
          canEdit
            ? 'Inventário consolidado. Cada equipamento pode ter um ou mais IPs vinculados.'
            : 'Inventário consolidado (somente leitura).'
        }
        actions={
          canEdit && (
            <button
              onClick={() => {
                if (demoTryWrite()) return;
                setErr(null);
                setModal({ open: true, initial: null });
              }}
              className="btn-primary"
            >
              <Plus size={14} /> Novo equipamento
            </button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, vendor, modelo, serial, responsável…"
            className="input pl-9"
          />
        </div>
        <select
          value={siteFilter}
          onChange={(e) => setSiteFilter(e.target.value)}
          className="input max-w-[180px]"
        >
          <option value="">Todos os sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input max-w-[180px]"
        >
          <option value="">Todos os tipos</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="ml-auto text-xs text-slate-500">
          {isLoading ? 'Carregando…' : `${devices.length} equipamento(s)`}
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm table-zebra">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Nome</th>
              <th className="px-3 py-2.5">Tipo</th>
              <th className="px-3 py-2.5">Vendor / Modelo</th>
              <th className="px-3 py-2.5">Site</th>
              <th className="px-3 py-2.5">IPs</th>
              <th className="px-3 py-2.5">Responsável</th>
              <th className="px-3 py-2.5">Última vez visto</th>
              {canEdit && <th className="px-3 py-2.5 w-24" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {!isLoading && devices.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="p-8 text-center text-slate-500">
                  Nenhum equipamento com esse filtro.
                </td>
              </tr>
            )}
            {devices.map((d) => (
              <tr
                key={d.id}
                className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                onClick={() => setDetail(d.id)}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Server size={14} className="text-slate-400" />
                    <span className="font-medium">{d.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{d.type || '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {d.vendor || '—'}
                  {d.model && <span className="text-slate-400"> · {d.model}</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {d.site ? (
                    <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {d.site.code}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs font-medium">{d._count?.ips ?? 0}</td>
                <td className="px-3 py-2 text-xs text-slate-500 truncate max-w-[180px]">
                  {d.ownerEmail || '—'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{formatDate(d.lastSeenAt)}</td>
                {canEdit && (
                  <td
                    className="px-3 py-2 text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        if (demoTryWrite()) return;
                        setErr(null);
                        setModal({ open: true, initial: d });
                      }}
                      className="text-slate-400 hover:text-brand-600 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Editar"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (demoTryWrite()) return;
                        setConfirm({ open: true, device: d });
                      }}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/30 ml-1"
                      title="Excluir (libera IPs vinculados)"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CatalogFormModal
        open={modal.open}
        onClose={() => setModal({ open: false, initial: null })}
        title={modal.initial ? 'Editar equipamento' : 'Novo equipamento'}
        fields={DEVICE_FIELDS}
        initial={modal.initial}
        loading={createMut.isPending || updateMut.isPending}
        error={err}
        onSubmit={submitDevice}
      />

      <ConfirmDialog
        open={confirm.open}
        onClose={() => setConfirm({ open: false, device: null })}
        title="Excluir equipamento"
        message={
          <>
            Tem certeza que quer excluir <strong>{confirm.device?.name}</strong>?
            {confirm.device?._count?.ips > 0 && (
              <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                ⚠️ {confirm.device._count.ips} IP(s) vinculado(s) serão desvinculados (não apagados).
              </div>
            )}
          </>
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteMut.isPending}
        onConfirm={() =>
          deleteMut.mutate(confirm.device.id, {
            onSuccess: () => setConfirm({ open: false, device: null }),
          })
        }
      />

      <DeviceDetailModal
        deviceId={detail}
        onClose={() => setDetail(null)}
        canEdit={canEdit}
        onEdit={(d) => {
          setDetail(null);
          setErr(null);
          setModal({ open: true, initial: d });
        }}
      />
    </div>
  );
}

function DeviceDetailModal({ deviceId, onClose, canEdit, onEdit }) {
  const { data, isLoading } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => api.device(deviceId),
    enabled: deviceId != null,
  });

  if (deviceId == null) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card-elevated p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading || !data ? (
          <div className="text-center text-slate-500 py-6">Carregando…</div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Server size={12} />
                  Equipamento
                </div>
                <h2 className="text-lg font-semibold">{data.name}</h2>
              </div>
              <div className="flex gap-2">
                {canEdit && (
                  <button
                    onClick={() => {
                      if (demoTryWrite()) return;
                      onEdit(data);
                    }}
                    className="btn-ghost text-xs"
                  >
                    <Pencil size={13} /> Editar
                  </button>
                )}
                <button onClick={onClose} className="btn-ghost text-xs">
                  Fechar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm mb-5">
              <Field label="Tipo" value={data.type} />
              <Field label="Função / Papel" value={data.role} />
              <Field label="Vendor" value={data.vendor} />
              <Field label="Modelo" value={data.model} />
              <Field label="Serial" value={data.serial} />
              <Field label="Sistema operacional" value={data.osInfo} />
              <Field
                label="Site"
                value={data.site ? `${data.site.code} — ${data.site.name}` : null}
              />
              <Field label="Última vez visto" value={formatDate(data.lastSeenAt)} />
              <Field label="Responsável" value={data.ownerEmail} span={2} />
              <Field label="Notas" value={data.notes} span={2} />
              <Field label="Ref. externa" value={data.externalRef} span={2} />
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
                IPs vinculados ({data.ips.length})
              </div>
              {data.ips.length === 0 ? (
                <div className="text-sm text-slate-400 italic">Nenhum IP vinculado.</div>
              ) : (
                <div className="border rounded overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                  {data.ips.map((ip) => (
                    <Link
                      key={ip.id}
                      to={`/subnets/${ip.subnetId}?ip=${encodeURIComponent(ip.address)}`}
                      onClick={onClose}
                      className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <code className="font-mono text-xs">{ip.address}</code>
                        <span className="text-xs text-slate-500">
                          {ip.subnet?.name || `subnet ${ip.subnetId}`}
                          {ip.subnet?.cidr && ` · ${ip.subnet.cidr}`}
                        </span>
                      </div>
                      <ExternalLink size={12} className="text-slate-400" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, span = 1 }) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
      <div className="text-sm">
        {value ? (
          value
        ) : (
          <span className="text-slate-300 italic text-xs">—</span>
        )}
      </div>
    </div>
  );
}
