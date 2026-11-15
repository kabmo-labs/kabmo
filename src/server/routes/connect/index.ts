import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as connectStatus from '@/server/routes/connect/status';
import * as connectTunnels from '@/server/routes/connect/tunnels';
import * as connectDevices from '@/server/routes/connect/devices';
import * as connectPair from '@/server/routes/connect/pair';
import * as connectPairQr from '@/server/routes/connect/pair-qr';
import * as connectPairPage from '@/server/routes/connect/pair-page';

export const connectBindings: HandlerBinding[] = [
  ...bindingsFor(connectStatus, '/api/connect/status'),
  ...bindingsFor(connectTunnels, '/api/connect/tunnels'),
  ...bindingsFor(connectDevices, '/api/connect/devices'),
  ...bindingsFor(connectPair, '/api/connect/pair'),
  ...bindingsFor(connectPairQr, '/api/connect/pair/qr.png'),
  ...bindingsFor(connectPair, '/api/connect/pair/claim'),
  ...bindingsFor(connectPairPage, '/pair'),
];
