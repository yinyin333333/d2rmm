import type { ID2RLoaderPluginAPI } from 'bridge/D2RLoaderPluginAPI';
import { consumeAPI } from 'renderer/IPC';

const D2RLoaderPluginAPI = consumeAPI<ID2RLoaderPluginAPI>(
  'D2RLoaderPluginAPI',
  {},
  false,
  { destination: 'worker' },
);

export default D2RLoaderPluginAPI;
