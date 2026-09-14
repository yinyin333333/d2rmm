export type AppUpdateStatus = {
  supported: boolean;
  phase: string;
  message: string;
  progress: number | null;
  version: string | null;
  log: string | null;
  cleanupError?: string;
};
export interface IAppUpdaterAPI {
  status(): Promise<AppUpdateStatus>;
  ready(): Promise<void>;
  check(): Promise<AppUpdateStatus>;
  prepare(): Promise<void>;
  cancel(): Promise<void>;
  install(): Promise<void>;
}
