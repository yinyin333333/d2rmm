import type { IAppUpdaterAPI } from 'bridge/AppUpdaterAPI';
import { consumeAPI } from 'renderer/IPC';

export default consumeAPI<IAppUpdaterAPI>('AppUpdaterAPI');
