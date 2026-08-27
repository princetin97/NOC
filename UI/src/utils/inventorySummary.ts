// Shared parser for the "key=value • key=value" inventorySummary/sysDescr strings
// produced by poller/vcenter.ts (VirtualizationHost.inventorySummary) and, for
// vCenter-synced Devices, mirrored into Device.sysDescr.
export type InventorySection = {
  title: string;
  keys: string[];
};

export const INVENTORY_LABELS: Record<string, string> = {
  overall_status: 'Trạng thái tổng',
  maintenance_mode: 'Bảo trì',
  boot_time: 'Boot time',
  esxi: 'ESXi',
  version: 'Version',
  vendor: 'Hãng',
  model: 'Model',
  serial_number: 'Serial',
  firmware: 'Firmware',
  host_uuid: 'UUID',
  cpu_model: 'CPU model',
  cpu_threads: 'CPU threads',
  physical_nics: 'Số NIC',
  hbas: 'HBA',
  dns_hostname: 'DNS host',
  dns_domain: 'DNS domain',
  default_gateway: 'Gateway',
  vmnics: 'VMNIC',
  datastore_summary: 'Datastore',
};

export const INVENTORY_SECTIONS: InventorySection[] = [
  { title: 'Hệ thống', keys: ['esxi', 'version', 'overall_status', 'maintenance_mode', 'boot_time'] },
  { title: 'Phần cứng', keys: ['vendor', 'model', 'serial_number', 'firmware', 'host_uuid', 'cpu_model', 'cpu_threads', 'physical_nics', 'hbas'] },
  { title: 'Mạng', keys: ['dns_hostname', 'dns_domain', 'default_gateway', 'vmnics'] },
  { title: 'Lưu trữ', keys: ['datastore_summary'] },
];

export function parseInventorySummary(summary?: string | null): Record<string, string> {
  if (!summary) return {};
  const map: Record<string, string> = {};
  for (const token of summary.split('•')) {
    const part = token.trim();
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || !value) continue;
    map[key] = value;
  }
  return map;
}

export function formatInventoryLabel(key: string): string {
  return INVENTORY_LABELS[key] ?? key.replace(/_/g, ' ');
}

export function compactInventoryPreview(summary?: string | null): string {
  const map = parseInventorySummary(summary);
  if (Object.keys(map).length === 0) return 'N/A';
  const keys = ['esxi', 'cpu_model', 'physical_nics', 'vmnics', 'datastore_summary'];
  const parts = keys
    .map((key) => {
      const value = map[key];
      if (!value) return null;
      if (key === 'datastore_summary') return value;
      return `${formatInventoryLabel(key)}: ${value}`;
    })
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) return summary ?? 'N/A';
  return parts.join(' | ');
}

/** True when a device/host's sysDescr or inventorySummary identifies it as a VMware ESXi host. */
export function isEsxiInventory(summary?: string | null): boolean {
  return !!summary && /(^|•)\s*esxi\s*=/i.test(summary);
}
