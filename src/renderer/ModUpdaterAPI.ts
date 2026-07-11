import type { IModUpdaterAPI } from 'bridge/ModUpdaterAPI';
import { consumeAPI } from 'renderer/IPC';

const ModUpdaterAPI = consumeAPI<IModUpdaterAPI>('ModUpdaterAPI', {}, false, {
  destination: 'worker',
});

export default ModUpdaterAPI;
