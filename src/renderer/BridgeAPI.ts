import type { IBridgeAPI } from 'bridge/BridgeAPI';
import { consumeAPI } from 'renderer/IPC';

const BridgeAPI = consumeAPI<IBridgeAPI>('BridgeAPI', {}, false, {
  destination: 'worker',
});

export default BridgeAPI;
