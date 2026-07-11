import { ConsoleArg } from './ConsoleAPI';
import { SerializableType } from './Serializable';

export type IPCMessageRequest = {
  id: string;
  namespace: string;
  api: string;
  args: SerializableType[];
  result?: never;
  error?: never;
};

export type IPCMessageSuccessResponse = {
  id: string;
  namespace?: never;
  api?: never;
  args?: never;
  result: void | SerializableType | SerializableType[];
  error?: never;
};

export type IPCSerializedError = {
  name: string;
  message: string;
  stack: string | undefined;
  __d2rmm_i18n_list?: ConsoleArg[];
};

export type IPCMessageErrorResponse = {
  id: string;
  namespace?: never;
  api?: never;
  args?: never;
  result?: never;
  error: IPCSerializedError;
};

export type IPCMessageResponse =
  | IPCMessageSuccessResponse
  | IPCMessageErrorResponse;

export type IPCMessage = IPCMessageRequest | IPCMessageResponse;

export type WorkerLifecycleIPCMessage =
  | { control: 'worker-ready' }
  | { control: 'worker-init-failed'; error: IPCSerializedError };

export type WorkerIPCMessage = IPCMessage | WorkerLifecycleIPCMessage;

export type IPCTransportClosedMessage = {
  control: 'transport-closed';
  destination: 'worker';
  error: IPCSerializedError;
  requestIds: string[];
};

export type RendererIPCMessage = IPCMessage | IPCTransportClosedMessage;
