export type INxmProtocolAPI = {
  getIsRegistered: () => Promise<boolean>;
  register: () => Promise<boolean>;
  rendererReady: () => Promise<void>;
  unregister: () => Promise<boolean>;
};
