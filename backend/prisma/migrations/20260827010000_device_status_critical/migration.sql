-- Distinguishes a genuinely unreachable device ("down") from one that is still
-- connected/online but reporting a critical alarm (e.g. an ESXi host with a
-- hardware health alert from vCenter) — previously both collapsed into "down".
ALTER TYPE "DeviceStatus" ADD VALUE 'critical';
