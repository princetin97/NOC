// Common SNMP OIDs used for polling and discovery (subset of standard MIB-II,
// HOST-RESOURCES-MIB and UCD-SNMP-MIB, enough to cover most vendors).
export const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysUptime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',

  // IF-MIB (ifTable / ifXTable) - walked per index.
  ifIndex: '1.3.6.1.2.1.2.2.1.1',
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifType: '1.3.6.1.2.1.2.2.1.3',
  ifSpeed: '1.3.6.1.2.1.2.2.1.5',
  ifPhysAddress: '1.3.6.1.2.1.2.2.1.6',
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifInOctets: '1.3.6.1.2.1.2.2.1.10',
  ifInErrors: '1.3.6.1.2.1.2.2.1.14',
  ifInDiscards: '1.3.6.1.2.1.2.2.1.13',
  ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
  ifOutErrors: '1.3.6.1.2.1.2.2.1.20',
  ifOutDiscards: '1.3.6.1.2.1.2.2.1.19',
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15', // Mbps
  // 64-bit high-capacity counters (ifXTable) - preferred to avoid 32-bit wrap on fast links.
  ifHCInOctets: '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',

  // HOST-RESOURCES-MIB (widely supported: Linux, Windows, many appliances)
  hrSystemUptime: '1.3.6.1.2.1.25.1.1.0', // OS boot uptime (better than sysUpTime on Windows)
  hrSystemProcesses: '1.3.6.1.2.1.25.1.6.0', // number of running processes
  hrSystemNumUsers: '1.3.6.1.2.1.25.1.5.0', // number of logged-in users
  hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2', // per CPU, walk
  hrStorageType: '1.3.6.1.2.1.25.2.3.1.2', // walk, storage class OID (fixed disk vs RAM)
  hrStorageDescr: '1.3.6.1.2.1.25.2.3.1.3',
  hrStorageAllocationUnits: '1.3.6.1.2.1.25.2.3.1.4',
  hrStorageSize: '1.3.6.1.2.1.25.2.3.1.5',
  hrStorageUsed: '1.3.6.1.2.1.25.2.3.1.6',

  // UCD-SNMP-MIB (common on Net-SNMP based Linux/Unix agents)
  ucdMemTotalReal: '1.3.6.1.4.1.2021.4.5.0',
  ucdMemAvailReal: '1.3.6.1.4.1.2021.4.6.0',
  ucdMemBuffer: '1.3.6.1.4.1.2021.4.14.0', // KiB held as kernel buffers (reclaimable)
  ucdMemCached: '1.3.6.1.4.1.2021.4.15.0', // KiB used as page cache (reclaimable)
  ucdLaLoad1: '1.3.6.1.4.1.2021.10.1.3.1',
  ucdCpuRawUser: '1.3.6.1.4.1.2021.11.50.0',
  ucdCpuRawSystem: '1.3.6.1.4.1.2021.11.52.0',
  ucdCpuRawIdle: '1.3.6.1.4.1.2021.11.53.0',
  ucdDskPath: '1.3.6.1.4.1.2021.9.1.2', // walk, mount path (e.g. /data)
  ucdDskPercent: '1.3.6.1.4.1.2021.9.1.9', // walk, integer usage percent like `df`

  // CISCO-PROCESS-MIB / CISCO-ENHANCED-MEMPOOL-MIB (Cisco IOS/IOS-XE routers & switches,
  // which don't implement HOST-RESOURCES-MIB or UCD-SNMP-MIB for CPU/memory).
  cpmCPUTotal5minRev: '1.3.6.1.4.1.9.9.109.1.1.1.1.8', // walk, per CPU, percentage
  cpmCPUMemoryUsed: '1.3.6.1.4.1.9.9.109.1.1.1.1.12', // walk, per CPU, bytes (32-bit, legacy IOS)
  cpmCPUMemoryFree: '1.3.6.1.4.1.9.9.109.1.1.1.1.13', // walk, per CPU, bytes (32-bit, legacy IOS)
  ciscoMemoryPoolUsed: '1.3.6.1.4.1.9.9.48.1.1.1.5', // walk, per pool, bytes
  ciscoMemoryPoolFree: '1.3.6.1.4.1.9.9.48.1.1.1.6', // walk, per pool, bytes
  // CISCO-ENHANCED-MEMPOOL-MIB - preferred over the two above on NX-OS (Nexus/MDS) and
  // modern IOS-XE, which often don't implement CISCO-MEMORY-POOL-MIB at all.
  cempMemPoolName: '1.3.6.1.4.1.9.9.221.1.1.1.1.2', // walk, pool label (e.g. "Kernel", "MTS")
  cempMemPoolValid: '1.3.6.1.4.1.9.9.221.1.1.1.1.6', // walk, true(1)/false(2)
  cempMemPoolUsed: '1.3.6.1.4.1.9.9.221.1.1.1.1.7', // walk, bytes (32-bit)
  cempMemPoolFree: '1.3.6.1.4.1.9.9.221.1.1.1.1.8', // walk, bytes (32-bit)
  cempMemPoolHCUsed: '1.3.6.1.4.1.9.9.221.1.1.1.1.18', // walk, bytes (64-bit, large platforms)
  cempMemPoolHCFree: '1.3.6.1.4.1.9.9.221.1.1.1.1.20', // walk, bytes (64-bit, large platforms)

  // ENTITY-SENSOR-MIB (broad vendor support: Cisco, Juniper, HP/Aruba, Arista, ...)
  entPhySensorType: '1.3.6.1.2.1.99.1.1.1.1', // walk, 8 = celsius
  entPhySensorScale: '1.3.6.1.2.1.99.1.1.1.2', // walk, 9 = units, 6 = milli, 3 = micro
  entPhySensorPrecision: '1.3.6.1.2.1.99.1.1.1.3', // walk, decimal places
  entPhySensorValue: '1.3.6.1.2.1.99.1.1.1.4', // walk
  entPhySensorOperStatus: '1.3.6.1.2.1.99.1.1.1.5', // walk, 1 = ok, 2 = unavailable, 3 = nonoperational

  // CISCO-ENTITY-SENSOR-MIB - Cisco's own pre-standard clone of the table above (same
  // Type/Scale/Precision/Value/Status column layout, keyed by entPhysicalIndex). Many
  // NX-OS platforms (Nexus/MDS) implement ONLY this, not the IETF ENTITY-SENSOR-MIB.
  cetSensorType: '1.3.6.1.4.1.9.9.91.1.1.1.1.1', // walk, 8 = celsius, 4 = voltsDC, 5 = amperes
  cetSensorScale: '1.3.6.1.4.1.9.9.91.1.1.1.1.2', // walk, 9 = units
  cetSensorPrecision: '1.3.6.1.4.1.9.9.91.1.1.1.1.3', // walk, decimal places
  cetSensorValue: '1.3.6.1.4.1.9.9.91.1.1.1.1.4', // walk
  cetSensorStatus: '1.3.6.1.4.1.9.9.91.1.1.1.1.5', // walk, 1 = ok

  // CISCO-ENVMON-MIB (older/most Cisco IOS routers & switches - more widely supported
  // than ENTITY-SENSOR-MIB, which is mostly on newer/modular platforms).
  ciscoEnvMonTemperatureStatusDescr: '1.3.6.1.4.1.9.9.13.1.3.1.2', // walk, sensor label
  ciscoEnvMonTemperatureStatusValue: '1.3.6.1.4.1.9.9.13.1.3.1.3', // walk, degrees Celsius
  ciscoEnvMonFanStatusDescr: '1.3.6.1.4.1.9.9.13.1.4.1.2', // walk, fan label
  ciscoEnvMonFanState: '1.3.6.1.4.1.9.9.13.1.4.1.3', // walk, 1=normal 2=warning 3=critical 4=shutdown 5=notPresent 6=notFunctioning
  ciscoEnvMonSupplyStatusDescr: '1.3.6.1.4.1.9.9.13.1.5.1.2', // walk, PSU label
  ciscoEnvMonSupplyState: '1.3.6.1.4.1.9.9.13.1.5.1.3', // walk, same states as fan

  // CISCO-ENTITY-FRU-CONTROL-MIB - fan-tray / power-supply discrete status, widely used on
  // chassis platforms (Nexus, MDS, Catalyst 6500+) that don't expose CISCO-ENVMON-MIB.
  cefcFanTrayOperStatus: '1.3.6.1.4.1.9.9.117.1.4.1.1.1', // walk, index=entPhysicalIndex, 1=unknown 2=up 3=down 4=warning
  cefcFRUPowerOperStatus: '1.3.6.1.4.1.9.9.117.1.1.2.1.2', // walk, index=entPhysicalIndex, 2=on is healthy

  // FORTINET-FORTIGATE-MIB (FortiGate firewalls don't implement HOST-RESOURCES-MIB or
  // UCD-SNMP-MIB for CPU/memory; they expose usage directly as percentages).
  fgSysCpuUsage: '1.3.6.1.4.1.12356.101.4.1.3.0', // integer percentage
  fgSysMemUsage: '1.3.6.1.4.1.12356.101.4.1.4.0', // integer percentage
  fgSysVersion: '1.3.6.1.4.1.12356.101.4.1.1.0', // firmware version string
  fgSysMemCapacity: '1.3.6.1.4.1.12356.101.4.1.5.0', // total RAM in KB
  fgHwSensorEntName: '1.3.6.1.4.1.12356.101.4.3.2.1.2', // walk, sensor name
  fgHwSensorEntValue: '1.3.6.1.4.1.12356.101.4.3.2.1.3', // walk, sensor value (temp/fan/voltage)
  fgHwSensorEntAlarmStatus: '1.3.6.1.4.1.12356.101.4.3.2.1.4', // walk, 0 = ok, 1 = alarm

  // FORTINET-FORTIGATE-MIB fgVpnTunTable - real IPsec tunnel state. The IF-MIB keeps the
  // logical IPsec interface up while the tunnel/SA is down, so we must read this instead.
  fgVpnTunEntPhase1Name: '1.3.6.1.4.1.12356.101.12.2.2.1.2', // walk, tunnel (phase1) name = ifName
  fgVpnTunEntStatus: '1.3.6.1.4.1.12356.101.12.2.2.1.20', // walk, down(1) / up(2)
  // FORTINET-FORTIGATE-MIB fgHaStatsTable - per-member HA status used by PRTG-like
  // cluster monitoring (sync state per node).
  fgHaStatsSerial: '1.3.6.1.4.1.12356.101.13.2.1.1.2', // walk, HA member serial number
  fgHaStatsHostname: '1.3.6.1.4.1.12356.101.13.2.1.1.11', // walk, HA member hostname
  fgHaStatsSyncStatus: '1.3.6.1.4.1.12356.101.13.2.1.1.12', // walk, synchronized(1)/unsynchronized(2)

  // F5-BIGIP-SYSTEM-MIB memory counters. BIG-IP reports memory in split pools
  // (TMM and non-TMM "other") and a host-total aggregate; UCD memory can be misleading here.
  f5SysStatMemoryTotal: '1.3.6.1.4.1.3375.2.1.1.2.1.44.0', // TMM memory total, bytes
  f5SysStatMemoryUsed: '1.3.6.1.4.1.3375.2.1.1.2.1.45.0', // TMM memory used, bytes
  f5SysGlobalHostMemTotal: '1.3.6.1.4.1.3375.2.1.1.2.20.2.0', // host memory total, bytes
  f5SysGlobalHostMemUsed: '1.3.6.1.4.1.3375.2.1.1.2.20.3.0', // host memory used, bytes
  f5SysGlobalHostOtherMemoryTotal: '1.3.6.1.4.1.3375.2.1.1.2.20.44.0', // non-TMM memory total, bytes
  f5SysGlobalHostOtherMemoryUsed: '1.3.6.1.4.1.3375.2.1.1.2.20.45.0', // non-TMM memory used, bytes

  // JUNIPER-MIB (jnxOperatingTable) - Junos routers/switches (MX/EX/SRX/QFX/ACX).
  // Compound-indexed; walk by suffix. CPU/buffer are percentages, temp in Celsius.
  jnxBoxDescr: '1.3.6.1.4.1.2636.3.1.2.0', // chassis hardware/model string
  jnxBoxSerialNo: '1.3.6.1.4.1.2636.3.1.3.0', // chassis serial number
  jnxOperatingDescr: '1.3.6.1.4.1.2636.3.1.13.1.5', // walk, component name
  jnxOperatingTemp: '1.3.6.1.4.1.2636.3.1.13.1.7', // walk, celsius
  jnxOperatingCPU: '1.3.6.1.4.1.2636.3.1.13.1.8', // walk, percentage
  jnxOperatingBuffer: '1.3.6.1.4.1.2636.3.1.13.1.11', // walk, memory used percentage

  // JUNIPER-SRX5000-SPU-MONITORING-MIB - SRX services processing unit health.
  jnxJsSPUMonitoringCPUUsage: '1.3.6.1.4.1.2636.3.39.1.12.1.1.1.4', // walk, percentage
  jnxJsSPUMonitoringMemoryUsage: '1.3.6.1.4.1.2636.3.39.1.12.1.1.1.5', // walk, percentage

  // HP/HPE ProCurve & Aruba switches (HP-ICF-OID / STATISTICS-MIB).
  hpSwitchCpuStat: '1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0', // scalar, percentage
  hpLocalMemTotalBytes: '1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.5', // walk, bytes
  hpLocalMemFreeBytes: '1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.6', // walk, bytes

  // HH3C-ENTITY-EXT-MIB - H3C / 3Com / HPE Comware (FlexFabric, 5900, A-series, S-series).
  hh3cEntityExtCpuUsage: '1.3.6.1.4.1.25506.2.6.1.1.1.1.6', // walk, percentage
  hh3cEntityExtMemUsage: '1.3.6.1.4.1.25506.2.6.1.1.1.1.8', // walk, percentage
  hh3cEntityExtTemperature: '1.3.6.1.4.1.25506.2.6.1.1.1.1.12', // walk, celsius

  // MIKROTIK-MIB - RouterOS devices do not implement ENTITY-MIB, so read identity here.
  mtxrSerialNumber: '1.3.6.1.4.1.14988.1.1.7.3.0', // chassis serial number
  mtxrLicVersion: '1.3.6.1.4.1.14988.1.1.4.4.0', // running RouterOS version (e.g. 6.48.6)

  // PURESTORAGE-MIB (enterprise 40482) - FlashArray performance + alert metadata.
  pureProductName: '1.3.6.1.4.1.40482.3.1.0',
  pureProductVersion: '1.3.6.1.4.1.40482.3.2.0',
  pureHost: '1.3.6.1.4.1.40482.3.3.0',
  pureArrayReadBandwidth: '1.3.6.1.4.1.40482.4.1.0', // B/s
  pureArrayWriteBandwidth: '1.3.6.1.4.1.40482.4.2.0', // B/s
  pureArrayReadIOPS: '1.3.6.1.4.1.40482.4.3.0', // op/s
  pureArrayWriteIOPS: '1.3.6.1.4.1.40482.4.4.0', // op/s
  pureArrayReadLatency: '1.3.6.1.4.1.40482.4.5.0', // us/op
  pureArrayWriteLatency: '1.3.6.1.4.1.40482.4.6.0', // us/op

  // OLD-CISCO-CPU-MIB - legacy Cisco (Aironet 1200/1100 APs, older IOS) lacking CISCO-PROCESS-MIB.
  oldCiscoAvgBusy5: '1.3.6.1.4.1.9.2.1.58.0', // scalar, percentage

  // CISCOSB / rlmgmt MIB (root switch001 = 1.3.6.1.4.1.9.6.1.101) - Cisco Small Business
  // (Sx200/300/350, CBS250/350) and Catalyst 1200/1300, which do NOT expose CISCO-PROCESS-MIB
  // or standard temperature MIBs. Model/serial from rlPhdUnitGenParamTable, sensors from rlEnv*.
  ciscosbModelName: '1.3.6.1.4.1.9.6.1.101.53.14.1.11.1', // rlPhdUnitGenParamModelName.1
  ciscosbSerialNum: '1.3.6.1.4.1.9.6.1.101.53.14.1.5.1', // rlPhdUnitGenParamSerialNum.1
  ciscosbSoftwareVersion: '1.3.6.1.4.1.9.6.1.101.53.14.1.2.1', // rlPhdUnitGenParamSoftwareVersion.1 (firmware, e.g. 4.1.3.36)
  ciscosbCpuLastMinute: '1.3.6.1.4.1.9.6.1.101.1.8', // walk, per-unit CPU percentage
  ciscosbCpuLastFiveMinutes: '1.3.6.1.4.1.9.6.1.101.1.9', // walk, per-unit CPU percentage (more stable on SG250)
  ciscosbEnvTemp: '1.3.6.1.4.1.9.6.1.101.83.5.1.1.2', // walk, celsius (skip 0)
  ciscosbEnvFanSpeed: '1.3.6.1.4.1.9.6.1.101.83.5.1.1.3', // walk, rpm
  ciscosbEnvFanState: '1.3.6.1.4.1.9.6.1.101.83.1.1.1.3', // walk, 1=normal..6
  ciscosbEnvPsuState: '1.3.6.1.4.1.9.6.1.101.83.1.2.1.3', // walk, 1=normal..6

  // A3COM-HUAWEI-LswDEVM-MIB - 3Com / H3C Comware switches (Switch 4500/4200/5500, enterprise 43).
  // hwDevice = 1.3.6.1.4.1.43.45.1.6.1 (huaweiUtility.1). CPU + memory per frame/slot.
  a3comCpuPer1Min: '1.3.6.1.4.1.43.45.1.6.1.1.1.3', // walk, hwCpuCostRatePer1Min percentage
  a3comMemSize: '1.3.6.1.4.1.43.45.1.6.1.2.1.1.2', // walk, hwMemSize bytes
  a3comMemFree: '1.3.6.1.4.1.43.45.1.6.1.2.1.1.3', // walk, hwMemFree bytes

  // ENTITY-MIB (physical entity table) - vendor-neutral model name / description.
  entPhysicalDescr: '1.3.6.1.2.1.47.1.1.1.1.2', // walk
  entPhysicalClass: '1.3.6.1.2.1.47.1.1.1.1.5', // walk, chassis = 3
  entPhysicalContainedIn: '1.3.6.1.2.1.47.1.1.1.1.4', // walk, parent index (0 = top-level chassis)
  entPhysicalName: '1.3.6.1.2.1.47.1.1.1.1.7', // walk, component label (sensor names)
  entPhysicalHardwareRev: '1.3.6.1.2.1.47.1.1.1.1.8', // walk, hardware revision
  entPhysicalFirmwareRev: '1.3.6.1.2.1.47.1.1.1.1.9', // walk, firmware revision
  entPhysicalSoftwareRev: '1.3.6.1.2.1.47.1.1.1.1.10', // walk, running software rev (Cisco version via .1)
  entPhysicalSerialNum: '1.3.6.1.2.1.47.1.1.1.1.11', // walk, serial number
  entPhysicalModelName: '1.3.6.1.2.1.47.1.1.1.1.13', // walk, vendor model string
  entPhysicalIsFru: '1.3.6.1.2.1.47.1.1.1.1.16', // walk, true(1)/false(2)

  // ENTITY-STATE-MIB (optional): operational/admin/alarm state per entPhysicalIndex.
  entStateAdmin: '1.3.6.1.2.1.131.1.1.1.2', // walk
  entStateOper: '1.3.6.1.2.1.131.1.1.1.3', // walk
  entStateAlarm: '1.3.6.1.2.1.131.1.1.1.4', // walk

  // HOST-RESOURCES-MIB installed software - Juniper JUNOS package holds the exact version.
  hrSWInstalledName: '1.3.6.1.2.1.25.6.3.1.2', // walk, installed software name

  // JUNIPER-VIRTUALCHASSIS-MIB - authoritative running JUNOS version (access .0).
  jnxVirtualChassisMemberSWVersion: '1.3.6.1.4.1.2636.3.40.1.4.1.1.1.5',

  // Q-BRIDGE-MIB (RFC 4363) / BRIDGE-MIB (RFC 4188) - VLAN discovery + port-to-VLAN
  // membership, used to build the per-device VLAN list (LibreNMS-style).
  dot1qVlanStaticName: '1.3.6.1.2.1.17.7.1.4.3.1.1', // walk, index = vlan id
  dot1qVlanStaticEgressPorts: '1.3.6.1.2.1.17.7.1.4.3.1.2', // walk, BITS bitmap of dot1dBasePort members (tagged+untagged)
  dot1qVlanStaticUntaggedPorts: '1.3.6.1.2.1.17.7.1.4.3.1.4', // walk, BITS bitmap of untagged (access) dot1dBasePort members
  dot1qPvid: '1.3.6.1.2.1.17.7.1.4.5.1.1', // walk (suffix), per-port default VLAN ID (authoritative access/untagged VLAN)
  dot1dBasePortIfIndex: '1.3.6.1.2.1.17.1.4.1.2', // walk, dot1dBasePort number -> ifIndex
  // Some devices (observed on Cisco Small Business / Catalyst 1200-1300 series) leave the
  // "static" (configured) egress/untagged bitmaps above completely empty while still exposing
  // VLAN names, but DO populate the "current" (operational) dot1qVlanCurrentTable instead.
  // Index is compound (dot1qVlanTimeMark.dot1qVlanIndex) per RFC 4363; walked with
  // snmpWalkSuffix and keyed by the LAST index component (the actual VLAN id).
  dot1qVlanCurrentEgressPorts: '1.3.6.1.2.1.17.7.1.4.2.1.4', // walk (suffix), BITS bitmap of dot1dBasePort members (tagged+untagged)
  dot1qVlanCurrentUntaggedPorts: '1.3.6.1.2.1.17.7.1.4.2.1.5', // walk (suffix), BITS bitmap of untagged (access) dot1dBasePort members

  // CISCO-VTP-MIB + CISCO-VLAN-MEMBERSHIP-MIB - fallback VLAN discovery for Cisco IOS/IOS-XE
  // switches, which commonly don't expose a useful Q-BRIDGE-MIB (its per-VLAN bridge data
  // requires a per-VLAN SNMP community/context on Cisco). Mirrors LibreNMS's Cisco::discoverVlans().
  vtpVlanName: '1.3.6.1.4.1.9.9.46.1.3.1.1.4', // walk, index = vtpVlanIndex (single VTP domain assumed)
  vmVlan: '1.3.6.1.4.1.9.9.68.1.2.2.1.2', // walk, index = ifIndex -> access/untagged VLAN id of a non-trunk port
  vlanTrunkPortNativeVlan: '1.3.6.1.4.1.9.9.46.1.6.1.1.5', // walk, index = ifIndex -> native (untagged) VLAN of a trunk port
  vlanTrunkPortDynamicStatus: '1.3.6.1.4.1.9.9.46.1.6.1.1.14', // walk, index = ifIndex -> trunking(1)/notTrunking(2), the ACTUAL runtime state (not just configured mode)
  vlanTrunkPortVlansXmitJoined: '1.3.6.1.4.1.9.9.46.1.6.1.1.11', // walk, BITS bitmap of VLANs 0-1023 ACTIVELY forwarded (tagged) on a trunk port
  vlanTrunkPortVlansXmitJoined2k: '1.3.6.1.4.1.9.9.46.1.6.1.1.23', // walk, BITS bitmap for VLANs 1024-2047
  vlanTrunkPortVlansXmitJoined3k: '1.3.6.1.4.1.9.9.46.1.6.1.1.24', // walk, BITS bitmap for VLANs 2048-3071
  vlanTrunkPortVlansXmitJoined4k: '1.3.6.1.4.1.9.9.46.1.6.1.1.25', // walk, BITS bitmap for VLANs 3072-4095
  // vlanTrunkPortVlansEnabled{,2k,3k,4k} is the *static configured* "allowed vlan" list (defaults
  // to ALL VLANs unless explicitly pruned) - NOT what's actually tagged. Many IOS switches never
  // populate XmitJoined at all (it only tracks VTP pruning join state, which is off by default),
  // so this is used as a fallback for ports confirmed to be actually trunking (see dynamicStatus).
  vlanTrunkPortVlansEnabled: '1.3.6.1.4.1.9.9.46.1.6.1.1.4', // walk, BITS bitmap of allowed VLANs 0-1023
  vlanTrunkPortVlansEnabled2k: '1.3.6.1.4.1.9.9.46.1.6.1.1.17', // walk, BITS bitmap of allowed VLANs 1024-2047
  vlanTrunkPortVlansEnabled3k: '1.3.6.1.4.1.9.9.46.1.6.1.1.18', // walk, BITS bitmap of allowed VLANs 2048-3071
  vlanTrunkPortVlansEnabled4k: '1.3.6.1.4.1.9.9.46.1.6.1.1.19', // walk, BITS bitmap of allowed VLANs 3072-4095

  // LLDP-MIB (IEEE 802.1AB) - link-layer neighbor discovery (compound index tables).
  lldpLocPortId: '1.0.8802.1.1.2.1.3.7.1.3', // walk by local port num -> local port id
  lldpRemChassisId: '1.0.8802.1.1.2.1.4.1.1.5', // walk, remote chassis id
  lldpRemPortId: '1.0.8802.1.1.2.1.4.1.1.7', // walk, remote port id
  lldpRemPortDesc: '1.0.8802.1.1.2.1.4.1.1.8', // walk, remote port description
  lldpRemSysName: '1.0.8802.1.1.2.1.4.1.1.9', // walk, remote system name

  // CISCO-CDP-MIB - Cisco Discovery Protocol neighbor table (index: ifIndex.deviceIndex).
  cdpCacheDeviceId: '1.3.6.1.4.1.9.9.23.1.2.1.1.6', // walk, remote device id / hostname
  cdpCacheDevicePort: '1.3.6.1.4.1.9.9.23.1.2.1.1.7', // walk, remote port name
  cdpCachePlatform: '1.3.6.1.4.1.9.9.23.1.2.1.1.8', // walk, remote platform

  // UPS-MIB (RFC 1628) - standard MIB implemented by APC/Eaton/Vertiv/CyberPower and most UPS SNMP cards.
  // Ident (scalars) - manufacturer/model drive auto-detection of vendor + type='ups'.
  upsIdentManufacturer: '1.3.6.1.2.1.33.1.1.1.0',
  upsIdentModel: '1.3.6.1.2.1.33.1.1.2.0',
  upsIdentUpsSoftwareVersion: '1.3.6.1.2.1.33.1.1.3.0',
  upsIdentAgentSoftwareVersion: '1.3.6.1.2.1.33.1.1.4.0',
  upsIdentName: '1.3.6.1.2.1.33.1.1.5.0',
  // Battery (scalars).
  upsBatteryStatus: '1.3.6.1.2.1.33.1.2.1.0', // unknown(1) batteryNormal(2) batteryLow(3) batteryDepleted(4)
  upsSecondsOnBattery: '1.3.6.1.2.1.33.1.2.2.0', // seconds, 0 = on utility power
  upsEstimatedMinutesRemaining: '1.3.6.1.2.1.33.1.2.3.0', // minutes of runtime left
  upsEstimatedChargeRemaining: '1.3.6.1.2.1.33.1.2.4.0', // percent charge
  upsBatteryVoltage: '1.3.6.1.2.1.33.1.2.5.0', // 0.1 V DC
  upsBatteryTemperature: '1.3.6.1.2.1.33.1.2.7.0', // deg C
  // Output (scalar + table).
  upsOutputSource: '1.3.6.1.2.1.33.1.4.1.0', // other(1) none(2) normal(3) bypass(4) battery(5) booster(6) reducer(7)
  upsOutputFrequency: '1.3.6.1.2.1.33.1.4.2.0', // 0.1 Hz
  upsOutputVoltage: '1.3.6.1.2.1.33.1.4.4.1.2', // walk per line, RMS V
  upsOutputCurrent: '1.3.6.1.2.1.33.1.4.4.1.3', // walk per line, 0.1 A
  upsOutputPower: '1.3.6.1.2.1.33.1.4.4.1.4', // walk per line, W
  upsOutputPercentLoad: '1.3.6.1.2.1.33.1.4.4.1.5', // walk per line, percent load
  // Input (table).
  upsInputFrequency: '1.3.6.1.2.1.33.1.3.3.1.2', // walk per line, 0.1 Hz
  upsInputVoltage: '1.3.6.1.2.1.33.1.3.3.1.3', // walk per line, RMS V
  upsInputCurrent: '1.3.6.1.2.1.33.1.3.3.1.4', // walk per line, 0.1 A

  // APC PowerNet-MIB (.1.3.6.1.4.1.318) - APC/Schneider Smart-UPS network cards. Many
  // older APC cards expose ONLY this MIB (not RFC 1628), so it is used as a fallback.
  apcIdentModel: '1.3.6.1.4.1.318.1.1.1.1.1.1.0', // string model
  apcIdentName: '1.3.6.1.4.1.318.1.1.1.1.1.2.0',
  apcIdentFirmwareRev: '1.3.6.1.4.1.318.1.1.1.1.2.1.0',
  apcIdentSerial: '1.3.6.1.4.1.318.1.1.1.1.2.3.0',
  apcBatteryStatus: '1.3.6.1.4.1.318.1.1.1.2.1.1.0', // unknown(1) batteryNormal(2) batteryLow(3)
  apcBatteryCapacity: '1.3.6.1.4.1.318.1.1.1.2.2.1.0', // percent charge
  apcBatteryTemperature: '1.3.6.1.4.1.318.1.1.1.2.2.2.0', // deg C
  apcBatteryRunTimeRemaining: '1.3.6.1.4.1.318.1.1.1.2.2.3.0', // TimeTicks (1/100 s)
  apcBatteryVoltage: '1.3.6.1.4.1.318.1.1.1.2.2.8.0', // V DC
  apcInputVoltage: '1.3.6.1.4.1.318.1.1.1.3.2.1.0', // V AC
  apcInputFrequency: '1.3.6.1.4.1.318.1.1.1.3.2.4.0', // Hz
  apcOutputStatus: '1.3.6.1.4.1.318.1.1.1.4.1.1.0', // onLine(2) onBattery(3) onSmartBoost(4)...
  apcOutputVoltage: '1.3.6.1.4.1.318.1.1.1.4.2.1.0', // V AC
  apcOutputFrequency: '1.3.6.1.4.1.318.1.1.1.4.2.2.0', // Hz
  apcOutputLoad: '1.3.6.1.4.1.318.1.1.1.4.2.3.0', // percent load
  apcOutputCurrent: '1.3.6.1.4.1.318.1.1.1.4.2.4.0', // A

  // HUAWEI VRP (HUAWEI-ENTITY-EXTENT-MIB, .1.3.6.1.4.1.2011.5.25.31) - per-entity CPU/mem/temp.
  hwEntityCpuUsage: '1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5', // walk, percent
  hwEntityMemUsage: '1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7', // walk, percent
  hwEntityTemperature: '1.3.6.1.4.1.2011.5.25.31.1.1.1.1.11', // walk, deg C (0xFFFF = invalid)

  // DELL iDRAC / OpenManage Server Administrator (IDRAC-MIB-SMIv2, .1.3.6.1.4.1.674.10892.5).
  // LibreNMS-style identity fields for hardware + serial/service tag.
  dellChassisModelName: '1.3.6.1.4.1.674.10892.5.4.300.10.1.9.1', // chassisModelTypeName.1
  dellChassisServiceTagName: '1.3.6.1.4.1.674.10892.5.4.300.10.1.11.1', // chassisServiceTagName.1
  // Legacy OMSA branch used on some Dell agents (MIB-Dell-10892 under .1).
  dellLegacyChassisModelName: '1.3.6.1.4.1.674.10892.1.300.10.1.9.1', // chassisModelName.1
  dellLegacyChassisServiceTagName: '1.3.6.1.4.1.674.10892.1.300.10.1.11.1', // chassisServiceTagName.1
  dellTempReading: '1.3.6.1.4.1.674.10892.5.4.700.20.1.6', // walk, tenths deg C
  dellTempLocation: '1.3.6.1.4.1.674.10892.5.4.700.20.1.8', // walk, probe name
  dellFanReading: '1.3.6.1.4.1.674.10892.5.4.700.12.1.6', // walk, RPM
  dellFanLocation: '1.3.6.1.4.1.674.10892.5.4.700.12.1.8', // walk, fan name
  dellPsuWattage: '1.3.6.1.4.1.674.10892.5.4.600.30.1.6', // walk, tenths W
  dellPsuLocation: '1.3.6.1.4.1.674.10892.5.4.600.30.1.8', // walk, PSU name
  dellVoltReading: '1.3.6.1.4.1.674.10892.5.4.600.20.1.6', // walk, millivolts
  dellVoltLocation: '1.3.6.1.4.1.674.10892.5.4.600.20.1.8', // walk, probe name

  // IBM / Lenovo IMM2 / XClarity Controller (IMM-MIB, .1.3.6.1.4.1.2.3.51.3) - server health.
  ibmTempName: '1.3.6.1.4.1.2.3.51.3.1.1.2.1.2', // walk, temp sensor name
  ibmTempReading: '1.3.6.1.4.1.2.3.51.3.1.1.2.1.3', // walk, deg C
  ibmVoltName: '1.3.6.1.4.1.2.3.51.3.1.2.2.1.2', // walk, voltage sensor name
  ibmVoltReading: '1.3.6.1.4.1.2.3.51.3.1.2.2.1.3', // walk, millivolts
  ibmFanName: '1.3.6.1.4.1.2.3.51.3.1.3.2.1.2', // walk, fan name
  ibmFanSpeed: '1.3.6.1.4.1.2.3.51.3.1.3.2.1.3', // walk, percent of max
} as const;

export const ENTITY_SENSOR_TYPE_CELSIUS = 8;

// ENTITY-SENSOR-MIB entPhySensorType -> our normalized sensor type + display unit.
export const ENTITY_SENSOR_TYPE_MAP: Record<number, { type: string; unit: string }> = {
  3: { type: 'voltage', unit: 'V' }, // voltsAC
  4: { type: 'voltage', unit: 'V' }, // voltsDC
  5: { type: 'current', unit: 'A' }, // amperes
  6: { type: 'power', unit: 'W' }, // watts
  7: { type: 'frequency', unit: 'Hz' }, // hertz
  8: { type: 'temperature', unit: '°C' }, // celsius
  9: { type: 'humidity', unit: '%' }, // percentRH
  10: { type: 'fan', unit: 'rpm' }, // rpm
  11: { type: 'airflow', unit: 'cmm' }, // cmm
};

// ENTITY-SENSOR-MIB entPhySensorScale -> multiplier relative to base units.
export const ENTITY_SENSOR_SCALE_FACTORS: Record<number, number> = {
  1: 1e-24, // yocto
  2: 1e-21, // zepto
  3: 1e-18, // atto
  4: 1e-15, // femto
  5: 1e-12, // pico
  6: 1e-9, // nano
  7: 1e-6, // micro
  8: 1e-3, // milli
  9: 1, // units
  10: 1e3, // kilo
  11: 1e6, // mega
  12: 1e9, // giga
};

export const IF_TABLE_COLUMNS = {
  ifDescr: OID.ifDescr,
  ifType: OID.ifType,
  ifSpeed: OID.ifSpeed,
  ifHighSpeed: OID.ifHighSpeed,
  ifPhysAddress: OID.ifPhysAddress,
  ifAdminStatus: OID.ifAdminStatus,
  ifOperStatus: OID.ifOperStatus,
  ifInOctets: OID.ifInOctets,
  ifInErrors: OID.ifInErrors,
  ifInDiscards: OID.ifInDiscards,
  ifOutOctets: OID.ifOutOctets,
  ifOutErrors: OID.ifOutErrors,
  ifOutDiscards: OID.ifOutDiscards,
  ifName: OID.ifName,
  ifAlias: OID.ifAlias,
};

const IF_ADMIN_OPER_STATUS: Record<number, string> = {
  1: 'up',
  2: 'down',
  3: 'testing',
};

export function decodeIfStatus(value: number): string {
  return IF_ADMIN_OPER_STATUS[value] ?? 'down';
}

const IF_TYPE_MAP: Record<number, string> = {
  6: 'ethernetCsmacd',
  22: 'propPointToPointSerial',
  24: 'softwareLoopback',
  53: 'propVirtual',
  56: 'fibreChannel', // Cisco MDS / SAN switch FC ports
  71: 'ieee80211',
  117: 'gigabitEthernet',
  131: 'tunnel',
  135: 'l2vlan',
  136: 'l3ipvlan',
  150: 'mplsTunnel',
  161: 'ieee8023adLag',
  209: 'bridge',
};

export function decodeIfType(value: number): string {
  return IF_TYPE_MAP[value] ?? `type-${value}`;
}
